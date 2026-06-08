import { insertNewlineAndIndent } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState, type StateCommand } from "@codemirror/state";
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

export const markdownPadKeymap = keymap.of([
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
