import {
  indentLess,
  insertNewlineAndIndent,
  insertTab,
} from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import {
  type ChangeSpec,
  EditorSelection,
  type EditorState,
  type StateCommand,
} from "@codemirror/state";
import {
  deleteMarkupBackward,
  insertNewlineContinueMarkupCommand,
} from "@codemirror/lang-markdown";
import { keymap } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

const insertNewListItemOrExit =
  insertNewlineContinueMarkupCommand({ nonTightLists: false });

function listItemAncestor(node: SyntaxNode | null): SyntaxNode | null {
  for (let current = node; current; current = current.parent) {
    if (current.name === "ListItem") {
      return current;
    }
  }

  return null;
}

function startsWithMarkdownBlockMarker(text: string) {
  return /^\s*(?:[-+*](?:\s+\[[ xX]\])?\s+|\d+[.)]\s+|>\s*)/.test(text);
}

function listItemContentColumn(text: string) {
  const bullet = /^( *)([-+*])( {1,4}\[[ xX]\])?( +)/.exec(text);

  if (bullet) {
    return bullet[0].length;
  }

  const ordered = /^( *)\d+([.)])( +)/.exec(text);

  if (ordered) {
    return ordered[0].length;
  }

  return null;
}

export function isPlainListContinuationLine(state: EditorState, position: number) {
  const line = state.doc.lineAt(position);

  if (!line.text.trim()) {
    return false;
  }

  const listItem = listItemAncestor(syntaxTree(state).resolveInner(position, -1));

  if (!listItem || line.from <= listItem.from) {
    return false;
  }

  return !startsWithMarkdownBlockMarker(line.text);
}

export function listContinuationIndentForPosition(
  state: EditorState,
  position: number,
) {
  const listItem = listItemAncestor(syntaxTree(state).resolveInner(position, -1));

  if (!listItem) {
    return null;
  }

  const firstLine = state.doc.lineAt(listItem.from);
  const contentColumn = listItemContentColumn(firstLine.text);

  return contentColumn === null ? null : " ".repeat(contentColumn);
}

export function isEmptyBlockquoteMarkerLine(state: EditorState, position: number) {
  const line = state.doc.lineAt(position);

  return position <= line.to && /^\s*>\s*$/.test(line.text);
}

const insertPlainNewline: StateCommand = ({ state, dispatch }) => {
  const transaction = state.changeByRange((range) => {
    const insert = state.lineBreak;

    return {
      changes: {
        from: range.from,
        to: range.to,
        insert,
      },
      range: EditorSelection.cursor(range.from + insert.length),
    };
  });

  dispatch(state.update(transaction, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

const insertListContinuationParagraph: StateCommand = ({ state, dispatch }) => {
  const indents = state.selection.ranges.map((range) =>
    range.empty ? listContinuationIndentForPosition(state, range.from) : null,
  );

  if (indents.some((indent) => indent === null)) {
    return insertNewlineAndIndent({ state, dispatch });
  }

  const transaction = state.changeByRange((range) => {
    const indent = listContinuationIndentForPosition(state, range.from) ?? "";
    const insert = state.lineBreak + indent;

    return {
      changes: {
        from: range.from,
        to: range.to,
        insert,
      },
      range: EditorSelection.cursor(range.from + insert.length),
    };
  });

  dispatch(state.update(transaction, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

const insertMarkdownPadNewline: StateCommand = (target) => {
  const shouldUsePlainNewline = target.state.selection.ranges.some((range) =>
    range.empty &&
    (isPlainListContinuationLine(target.state, range.from) ||
      isEmptyBlockquoteMarkerLine(target.state, range.from)),
  );

  if (shouldUsePlainNewline) {
    return insertPlainNewline(target);
  }

  return insertNewListItemOrExit(target) || insertNewlineAndIndent(target);
};

const listItemLinePattern = /^([ \t]*)([-+*]|\d{1,9}[.)])([ \t]+|$)/;

interface ListItemLine {
  indent: number;
  contentColumn: number;
}

function listItemLine(text: string): ListItemLine | null {
  const match = listItemLinePattern.exec(text);

  return match
    ? { indent: match[1].length, contentColumn: match[0].length }
    : null;
}

function leadingWhitespace(text: string) {
  return /^[ \t]*/.exec(text)?.[0].length ?? 0;
}

// The nearest list item above `lineNumber` that `accept` takes, looking past
// blank lines, continuation lines and deeper nested items, and stopping at
// the start of the list.
function precedingListItem(
  state: EditorState,
  lineNumber: number,
  item: ListItemLine,
  accept: (candidate: ListItemLine) => "take" | "skip" | "stop",
) {
  for (let number = lineNumber - 1; number >= 1; number -= 1) {
    const text = state.doc.line(number).text;

    if (!text.trim()) {
      continue;
    }

    const candidate = listItemLine(text);

    if (!candidate) {
      if (leadingWhitespace(text) === 0 && item.indent === 0) {
        return null;
      }

      continue;
    }

    const verdict = accept(candidate);

    if (verdict === "take") {
      return candidate;
    }

    if (verdict === "stop") {
      return null;
    }
  }

  return null;
}

function shiftIndentation(text: string, from: number, delta: number): ChangeSpec | null {
  const current = leadingWhitespace(text);

  if (delta > 0) {
    return { from, insert: " ".repeat(delta) };
  }

  const remove = Math.min(current, -delta);
  return remove > 0 ? { from, to: from + remove } : null;
}

/**
 * Tab nests the list items on the selected lines under the item above them
 * (indenting to its text column, as CommonMark requires); Shift+Tab moves
 * them out to their parent's level. The lines nested under each item move
 * with it. Outside lists the key falls through to normal tab handling.
 */
function shiftListItems(outdent: boolean): StateCommand {
  return ({ state, dispatch }) => {
    const lineNumbers = new Set<number>();

    for (const range of state.selection.ranges) {
      const first = state.doc.lineAt(range.from).number;
      const last = state.doc.lineAt(range.to).number;

      for (let number = first; number <= last; number += 1) {
        lineNumbers.add(number);
      }
    }

    const items = [...lineNumbers]
      .sort((first, second) => first - second)
      .map((number) => ({ number, item: listItemLine(state.doc.line(number).text) }))
      .filter((entry): entry is { number: number; item: ListItemLine } => entry.item !== null);

    if (items.length === 0) {
      return false;
    }

    if (state.readOnly) {
      return true;
    }

    const changes: ChangeSpec[] = [];
    const moved = new Set<number>();

    for (const { number, item } of items) {
      if (moved.has(number)) {
        continue;
      }

      let target: number | null;

      if (outdent) {
        const parent = item.indent === 0
          ? null
          : precedingListItem(state, number, item, (candidate) =>
              candidate.indent < item.indent ? "take" : "skip",
            );
        target = item.indent === 0 ? null : parent ? parent.indent : 0;
      } else {
        const sibling = precedingListItem(state, number, item, (candidate) =>
          candidate.indent === item.indent
            ? "take"
            : candidate.indent < item.indent
              ? "stop"
              : "skip",
        );
        target = sibling ? sibling.contentColumn : null;
      }

      if (target === null || target === item.indent) {
        continue;
      }

      const delta = target - item.indent;

      // The item itself, then every following line nested deeper than it.
      for (let current = number; current <= state.doc.lines; current += 1) {
        const line = state.doc.line(current);

        if (current > number) {
          if (!line.text.trim()) {
            continue;
          }

          if (leadingWhitespace(line.text) <= item.indent) {
            break;
          }
        }

        moved.add(current);
        const change = shiftIndentation(line.text, line.from, delta);

        if (change) {
          changes.push(change);
        }
      }
    }

    if (changes.length > 0) {
      dispatch(
        state.update({
          changes,
          scrollIntoView: true,
          userEvent: outdent ? "delete.dedent" : "input.indent",
        }),
      );
    }

    // Inside a list, Tab never moves the focus away, even when the item
    // cannot be nested further. (Escape, then Tab, still leaves the editor.)
    return true;
  };
}

export const indentListItems = shiftListItems(false);
export const outdentListItems = shiftListItems(true);

export const markdownPadKeymap = keymap.of([
  {
    key: "Tab",
    run: (view) => indentListItems(view) || insertTab(view),
    shift: (view) => outdentListItems(view) || indentLess(view),
  },
  {
    key: "Shift-Enter",
    run: insertListContinuationParagraph,
  },
  {
    key: "Enter",
    run: insertMarkdownPadNewline,
  },
  {
    key: "Backspace",
    run: deleteMarkupBackward,
  },
]);
