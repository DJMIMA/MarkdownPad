import { syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import {
  EditorSelection,
  EditorState,
  RangeSetBuilder,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  WidgetType,
  EditorView,
  ViewPlugin,
} from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";

type SourceRange = {
  from: number;
  to: number;
};

type TableCellSource = SourceRange & {
  text: string;
};

type TableCellPosition = {
  row: number;
  column: number;
};

type SelectedTableCell = TableCellPosition &
  SourceRange & {
    text: string;
  };

type TableCellSelection = {
  wrapper: HTMLElement;
  rowFrom: number;
  rowTo: number;
  columnFrom: number;
  columnTo: number;
  cells: SelectedTableCell[];
};

type SourceRanges = {
  all: SourceRange[];
  structural: SourceRange[];
};

type PreviewDecoration = Range<Decoration>;

const headingLineDecorations = new Map<number, Decoration>();
const quoteLineDecoration = Decoration.line({
  class: "cm-md-quote-line",
});
const hiddenMarkDecoration = Decoration.replace({});

export function headingLevelForNode(name: string): number | null {
  const match = /^ATXHeading([1-6])$/.exec(name);
  return match ? Number(match[1]) : null;
}

export function isStructuralBlock(name: string): boolean {
  return name === "FencedCode" || name === "Table" || name === "HorizontalRule";
}

export function shouldHideMarkdownNode(name: string): boolean {
  return (
    name === "HeaderMark" ||
    name === "QuoteMark" ||
    name === "EmphasisMark" ||
    name === "StrikethroughMark" ||
    name === "LinkMark" ||
    name === "CodeMark" ||
    name === "CodeInfo"
  );
}

export function listMarkerLabel(marker: string): string {
  if (/^\d+[.)]$/.test(marker.trim())) {
    return marker.trim();
  }

  return "•";
}

function headingLineDecoration(level: number) {
  const existing = headingLineDecorations.get(level);

  if (existing) {
    return existing;
  }

  const decoration = Decoration.line({
    class: `cm-md-heading-line cm-md-heading-${level}`,
  });
  headingLineDecorations.set(level, decoration);
  return decoration;
}

function rangeContainsPosition(range: SourceRange, position: number) {
  return position >= range.from && position <= range.to;
}

function rangesIntersect(first: SourceRange, second: SourceRange) {
  return first.from <= second.to && second.from <= first.to;
}

function sourceRangesForSelection(state: EditorState): SourceRanges {
  const ranges: SourceRanges = {
    all: [],
    structural: [],
  };
  const tree = syntaxTree(state);

  for (const selectionRange of state.selection.ranges) {
    const from = Math.min(selectionRange.from, selectionRange.to);
    const to = Math.max(selectionRange.from, selectionRange.to);
    const startLine = state.doc.lineAt(from);
    const endLine = state.doc.lineAt(to);

    ranges.all.push({
      from: startLine.from,
      to: endLine.to,
    });

    tree.iterate({
      enter(node) {
        if (!isStructuralBlock(node.name)) {
          return;
        }

        if (
          selectionRange.empty &&
          rangeContainsPosition({ from: node.from, to: node.to }, selectionRange.head)
        ) {
          const structuralRange = {
            from: node.from,
            to: node.to,
          };

          ranges.all.push(structuralRange);
          ranges.structural.push(structuralRange);
        }
      },
    });
  }

  return ranges;
}

function isInSourceRange(node: SyntaxNodeRef, ranges: SourceRange[]) {
  return isRangeInSourceRange(
    {
      from: node.from,
      to: node.to,
    },
    ranges,
  );
}

function isRangeInSourceRange(nodeRange: SourceRange, ranges: SourceRange[]) {
  return ranges.some((range) => rangesIntersect(nodeRange, range));
}

function addDecoration(
  decorations: PreviewDecoration[],
  from: number,
  to: number,
  decoration: Decoration,
) {
  decorations.push(decoration.range(from, to));
}

function sourceLineDecoration(from: number, to: number) {
  return Decoration.line({
    attributes: {
      "data-source-from": String(from),
      "data-source-to": String(to),
    },
  });
}

function structuralSourceLineDecoration(from: number, to: number) {
  return Decoration.line({
    class: "cm-md-structural-source-line",
    attributes: {
      "data-source-from": String(from),
      "data-source-to": String(to),
    },
  });
}

function tokenEndWithTrailingSpace(state: EditorState, to: number) {
  return state.doc.sliceString(to, to + 1) === " " ? to + 1 : to;
}

function lineHasContentAfterToken(state: EditorState, tokenTo: number) {
  const line = state.doc.lineAt(tokenTo);

  return state.doc.sliceString(tokenTo, line.to).trim().length > 0;
}

function urlTextForNode(state: EditorState, node: SyntaxNode) {
  if (node.name === "URL") {
    return state.doc.sliceString(node.from, node.to);
  }

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "URL") {
      return state.doc.sliceString(child.from, child.to);
    }
  }

  return null;
}

function clickableLinkDecoration(url: string) {
  return Decoration.mark({
    class: "cm-md-clickable-link",
    attributes: {
      "data-markdown-url": url,
    },
  });
}

function dispatchOpenUrl(url: string) {
  window.dispatchEvent(
    new CustomEvent<string>("markdownpad-open-url", {
      detail: url,
    }),
  );
}

const suppressedVisualLineClicks = new WeakMap<EditorView, number>();
const draggedVisualLineClicks = new WeakMap<EditorView, number>();
const tableCellSelections = new WeakMap<EditorView, TableCellSelection>();
const tableCellSelectionMenus = new WeakMap<EditorView, HTMLElement>();

function suppressNextVisualLineClick(view: EditorView) {
  const token = Date.now();

  suppressedVisualLineClicks.set(view, token);

  window.setTimeout(() => {
    if (suppressedVisualLineClicks.get(view) === token) {
      suppressedVisualLineClicks.delete(view);
    }
  }, 400);
}

function consumeSuppressedVisualLineClick(view: EditorView) {
  if (!suppressedVisualLineClicks.has(view)) {
    return false;
  }

  suppressedVisualLineClicks.delete(view);
  return true;
}

function markDraggedVisualLineClick(view: EditorView) {
  const token = Date.now();

  draggedVisualLineClicks.set(view, token);

  window.setTimeout(() => {
    if (draggedVisualLineClicks.get(view) === token) {
      draggedVisualLineClicks.delete(view);
    }
  }, 400);
}

function consumeDraggedVisualLineClick(view: EditorView) {
  if (!draggedVisualLineClicks.has(view)) {
    return false;
  }

  draggedVisualLineClicks.delete(view);
  return true;
}

function removeTableCellSelectionMenu(view: EditorView) {
  const menu = tableCellSelectionMenus.get(view);

  if (!menu) {
    return;
  }

  menu.remove();
  tableCellSelectionMenus.delete(view);
}

function clearTableCellSelection(view: EditorView) {
  const selection = tableCellSelections.get(view);

  if (!selection) {
    removeTableCellSelectionMenu(view);
    return;
  }

  removeTableCellSelectionMenu(view);

  if (selection.wrapper.isConnected) {
    selection.wrapper
      .querySelectorAll(".cm-md-table-cell-selected")
      .forEach((cell) => cell.classList.remove("cm-md-table-cell-selected"));
  }

  tableCellSelections.delete(view);
}

function selectedTableCellRect(selection: TableCellSelection) {
  let selectedRect: DOMRect | null = null;

  for (const cell of selection.wrapper.querySelectorAll<HTMLElement>(
    ".cm-md-table-cell-selected",
  )) {
    const rect = cell.getBoundingClientRect();

    if (!selectedRect) {
      selectedRect = rect;
      continue;
    }

    const left = Math.min(selectedRect.left, rect.left);
    const top = Math.min(selectedRect.top, rect.top);
    const right = Math.max(selectedRect.right, rect.right);
    const bottom = Math.max(selectedRect.bottom, rect.bottom);
    selectedRect = new DOMRect(left, top, right - left, bottom - top);
  }

  return selectedRect;
}

function clampMenuPosition(value: number, size: number, max: number) {
  return Math.max(6, Math.min(value, Math.max(6, max - size - 6)));
}

async function writeClipboardText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to the older copy command below.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.append(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

async function copyTableCellSelection(view: EditorView) {
  const selection = tableCellSelections.get(view);

  if (!selection) {
    return false;
  }

  return writeClipboardText(tableCellSelectionText(selection));
}

async function cutTableCellSelection(view: EditorView) {
  if (!(await copyTableCellSelection(view))) {
    return false;
  }

  deleteTableCellSelection(view);
  return true;
}

function showTableCellSelectionMenu(
  view: EditorView,
  selection: TableCellSelection,
  anchor?: { x: number; y: number },
) {
  removeTableCellSelectionMenu(view);

  const selectedRect = selectedTableCellRect(selection);

  if (!selectedRect && !anchor) {
    return;
  }

  const menu = document.createElement("div");
  menu.className = "cm-md-table-selection-menu";
  menu.role = "menu";
  menu.ariaLabel = "表セル編集";
  menu.style.visibility = "hidden";

  const addButton = (
    label: string,
    action: () => Promise<void> | void,
  ) => {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "menuitem";
    button.textContent = label;
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void Promise.resolve(action()).finally(() => {
        removeTableCellSelectionMenu(view);
        view.focus();
      });
    });
    menu.append(button);
  };

  addButton("コピー", async () => {
    await copyTableCellSelection(view);
  });
  addButton("切り取り", async () => {
    await cutTableCellSelection(view);
  });
  addButton("削除", () => {
    deleteTableCellSelection(view);
  });

  document.body.append(menu);

  const menuRect = menu.getBoundingClientRect();
  const left = anchor?.x ?? selectedRect?.left ?? 0;
  const bottom = anchor?.y ?? selectedRect?.bottom ?? 0;
  let top = bottom + 8;

  if (top + menuRect.height > window.innerHeight - 6) {
    top = bottom - menuRect.height - 8;
  }

  menu.style.left = `${clampMenuPosition(left, menuRect.width, window.innerWidth)}px`;
  menu.style.top = `${clampMenuPosition(top, menuRect.height, window.innerHeight)}px`;
  menu.style.visibility = "visible";
  tableCellSelectionMenus.set(view, menu);
}

function setTableCellSelection(
  view: EditorView,
  selection: TableCellSelection,
  options: {
    menuAnchor?: { x: number; y: number };
  } = {},
) {
  const current = tableCellSelections.get(view);

  if (current && current.wrapper !== selection.wrapper) {
    clearTableCellSelection(view);
  }

  tableCellSelections.set(view, selection);

  if (options.menuAnchor) {
    showTableCellSelectionMenu(view, selection, options.menuAnchor);
  } else {
    removeTableCellSelectionMenu(view);
  }
}

function tableCellSelectionContainsPosition(
  selection: TableCellSelection,
  position: TableCellPosition,
) {
  return (
    selection.rowFrom <= position.row &&
    selection.rowTo >= position.row &&
    selection.columnFrom <= position.column &&
    selection.columnTo >= position.column
  );
}

function tableCellSelectionText(selection: TableCellSelection) {
  const byPosition = new Map<string, string>();

  for (const cell of selection.cells) {
    byPosition.set(`${cell.row}:${cell.column}`, cell.text);
  }

  const rows: string[] = [];

  for (let row = selection.rowFrom; row <= selection.rowTo; row += 1) {
    const values: string[] = [];

    for (
      let column = selection.columnFrom;
      column <= selection.columnTo;
      column += 1
    ) {
      values.push(byPosition.get(`${row}:${column}`) ?? "");
    }

    rows.push(values.join("\t"));
  }

  return rows.join("\n");
}

function deleteTableCellSelection(view: EditorView) {
  const selection = tableCellSelections.get(view);

  if (!selection) {
    return false;
  }

  const editableCells = selection.cells.filter((cell) =>
    Number.isFinite(cell.from) &&
    Number.isFinite(cell.to) &&
    cell.from <= cell.to
  );

  if (editableCells.length === 0) {
    clearTableCellSelection(view);
    return true;
  }

  const firstPosition = Math.min(...editableCells.map((cell) => cell.from));
  clearTableCellSelection(view);
  view.dispatch({
    changes: editableCells
      .sort((first, second) => second.from - first.from)
      .map((cell) => ({
        from: cell.from,
        to: cell.to,
        insert: "",
      })),
    selection: EditorSelection.cursor(firstPosition),
    scrollIntoView: true,
    userEvent: "delete.tableCell",
  });
  view.focus();
  return true;
}

const linkClickHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) {
      return false;
    }

    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-markdown-url]")
      : null;

    if (!target) {
      return false;
    }

    const url = target.dataset.markdownUrl;

    if (!url) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    dispatchOpenUrl(url);
    return true;
  },
});

function clampPositionToLine(state: EditorState, position: number, lineFrom: number) {
  const line = state.doc.lineAt(lineFrom);

  return Math.min(Math.max(position, line.from), line.to);
}

function caretPositionFromPoint(event: MouseEvent) {
  const documentWithCaret = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => {
      offsetNode: Node;
      offset: number;
    } | null;
    caretRangeFromPoint?: (x: number, y: number) => globalThis.Range | null;
  };

  const caretPosition = documentWithCaret.caretPositionFromPoint?.(
    event.clientX,
    event.clientY,
  );

  if (caretPosition) {
    return {
      node: caretPosition.offsetNode,
      offset: caretPosition.offset,
    };
  }

  const caretRange = documentWithCaret.caretRangeFromPoint?.(
    event.clientX,
    event.clientY,
  );

  return caretRange
    ? {
        node: caretRange.startContainer,
        offset: caretRange.startOffset,
      }
    : null;
}

function clampToDocument(view: EditorView, position: number) {
  return Math.min(Math.max(position, 0), view.state.doc.length);
}

function domCaretPosition(view: EditorView, event: MouseEvent) {
  const caret = caretPositionFromPoint(event);

  if (!caret || !view.contentDOM.contains(caret.node)) {
    return null;
  }

  try {
    return clampToDocument(view, view.posAtDOM(caret.node, caret.offset));
  } catch {
    return null;
  }
}

function clickedLinePosition(
  view: EditorView,
  lineElement: HTMLElement,
  event: MouseEvent,
) {
  const sourceFrom = Number(lineElement.dataset.sourceFrom);
  const lineStart = Number.isFinite(sourceFrom)
    ? sourceFrom
    : view.posAtDOM(lineElement, 0);
  const line = view.state.doc.lineAt(lineStart);
  const text = view.state.doc.sliceString(line.from, line.to);

  if (!text) {
    return line.from;
  }

  const caret = caretPositionFromPoint(event);

  if (caret && lineElement.contains(caret.node)) {
    try {
      return clampPositionToLine(
        view.state,
        view.posAtDOM(caret.node, caret.offset),
        line.from,
      );
    } catch {
      // Fall back to a coarse line-relative estimate below.
    }
  }

  const rect = lineElement.getBoundingClientRect();
  const ratio = rect.width > 0
    ? Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1)
    : 0;

  return line.from + Math.round(text.length * ratio);
}

function dispatchCursorToClickedLine(
  view: EditorView,
  lineElement: HTMLElement,
  event: MouseEvent,
) {
  clearTableCellSelection(view);
  window.getSelection()?.removeAllRanges();
  view.dispatch({
    selection: EditorSelection.cursor(
      clickedLinePosition(view, lineElement, event),
    ),
    scrollIntoView: true,
  });
  view.focus();
}

function lineElementAtPoint(event: MouseEvent) {
  const element = document.elementFromPoint(event.clientX, event.clientY);

  return element instanceof Element
    ? element.closest<HTMLElement>(".cm-line")
    : null;
}

function editorPositionAtPoint(view: EditorView, event: MouseEvent) {
  // Resolve the source position straight from the rendered DOM. CodeMirror's
  // posAtCoords relies on the height map, which drifts from the real layout in
  // long documents with many block widgets (tables): blocks scrolled far out of
  // view fall back to estimated heights, so the drag head would jump to the
  // wrong line the further down you go. Hit-testing the actual DOM always
  // tracks the pointer, matching how clicks already resolve their position.
  const domPosition = domCaretPosition(view, event);

  if (domPosition !== null) {
    return domPosition;
  }

  const lineElement = lineElementAtPoint(event);

  if (lineElement) {
    return clickedLinePosition(view, lineElement, event);
  }

  const position = view.posAtCoords({
    x: event.clientX,
    y: event.clientY,
  });

  return typeof position === "number" ? clampToDocument(view, position) : null;
}

function installLineSelectionDrag(
  view: EditorView,
  anchor: number,
  startEvent: MouseEvent,
) {
  const startX = startEvent.clientX;
  const startY = startEvent.clientY;
  let moved = false;

  const updateSelection = (event: MouseEvent) => {
    const distance =
      Math.abs(event.clientX - startX) + Math.abs(event.clientY - startY);

    if (!moved && distance < 4) {
      return;
    }

    moved = true;
    markDraggedVisualLineClick(view);
    event.preventDefault();
    event.stopPropagation();

    const head = editorPositionAtPoint(view, event);

    if (head === null) {
      return;
    }

    view.dispatch({
      selection: EditorSelection.single(
        anchor,
        head,
      ),
      scrollIntoView: true,
      userEvent: "select.pointer",
    });
    view.focus();
  };

  const stop = (event: MouseEvent) => {
    updateSelection(event);
    window.removeEventListener("mousemove", updateSelection, true);
    window.removeEventListener("mouseup", stop, true);
  };

  window.addEventListener("mousemove", updateSelection, true);
  window.addEventListener("mouseup", stop, true);
}

const structuralSourceLineMouseDownHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) {
      return false;
    }

    if (event.detail > 1 || event.altKey || event.ctrlKey || event.metaKey) {
      return false;
    }

    if (
      event.target instanceof Element &&
      event.target.closest("[data-markdown-url]")
    ) {
      return false;
    }

    const lineElement = event.target instanceof Element
      ? event.target.closest<HTMLElement>(".cm-md-structural-source-line")
      : null;

    if (!lineElement) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    suppressNextVisualLineClick(view);
    clearTableCellSelection(view);
    const anchor = clickedLinePosition(view, lineElement, event);
    window.getSelection()?.removeAllRanges();
    view.dispatch({
      selection: EditorSelection.cursor(anchor),
      scrollIntoView: true,
      userEvent: "select.pointer",
    });
    view.focus();
    installLineSelectionDrag(view, anchor, event);
    return true;
  },
});

const visualLineMouseDownHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) {
      return false;
    }

    if (
      event.detail > 1 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return false;
    }

    if (
      event.target instanceof Element &&
      event.target.closest("[data-markdown-url]")
    ) {
      return false;
    }

    const lineElement = event.target instanceof Element
      ? event.target.closest<HTMLElement>(".cm-line")
      : null;

    if (!lineElement || lineElement.classList.contains("cm-md-structural-source-line")) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    suppressNextVisualLineClick(view);
    clearTableCellSelection(view);

    const anchor = clickedLinePosition(view, lineElement, event);
    window.getSelection()?.removeAllRanges();
    view.dispatch({
      selection: EditorSelection.cursor(anchor),
      scrollIntoView: true,
      userEvent: "select.pointer",
    });
    view.focus();
    installLineSelectionDrag(view, anchor, event);
    return true;
  },
});

const visualLineClickHandler = EditorView.domEventHandlers({
  click(event, view) {
    if (event.button !== 0) {
      return false;
    }

    if (event.detail > 1) {
      return false;
    }

    if (consumeDraggedVisualLineClick(view)) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    if (consumeSuppressedVisualLineClick(view)) {
      event.preventDefault();
      event.stopPropagation();
      window.getSelection()?.removeAllRanges();
      return true;
    }

    if (
      event.target instanceof Element &&
      event.target.closest("[data-markdown-url]")
    ) {
      return false;
    }

    const lineElement = event.target instanceof Element
      ? event.target.closest<HTMLElement>(".cm-line")
      : null;

    if (!lineElement) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    dispatchCursorToClickedLine(view, lineElement, event);
    return true;
  },
});

function moveBySourceLine(view: EditorView, direction: "down" | "up") {
  const selection = view.state.selection.main;

  if (!selection.empty) {
    return false;
  }

  const line = view.state.doc.lineAt(selection.head);
  const targetLineNumber = direction === "down"
    ? line.number + 1
    : line.number - 1;

  if (targetLineNumber < 1 || targetLineNumber > view.state.doc.lines) {
    return false;
  }

  const targetLine = view.state.doc.line(targetLineNumber);
  const column = selection.head - line.from;
  const targetPosition = Math.min(targetLine.from + column, targetLine.to);

  view.dispatch({
    selection: EditorSelection.cursor(targetPosition),
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
}

const sourceLineNavigation = ViewPlugin.fromClass(
  class {
    private readonly view: EditorView;

    private readonly handleCopy = (event: ClipboardEvent) => {
      const selection = tableCellSelections.get(this.view);

      if (!selection || !event.clipboardData) {
        return;
      }

      event.clipboardData.setData("text/plain", tableCellSelectionText(selection));
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    private readonly handleCut = (event: ClipboardEvent) => {
      const selection = tableCellSelections.get(this.view);

      if (!selection || !event.clipboardData) {
        return;
      }

      event.clipboardData.setData("text/plain", tableCellSelectionText(selection));
      event.preventDefault();
      event.stopImmediatePropagation();
      deleteTableCellSelection(this.view);
    };

    private readonly handleKeyDown = (event: KeyboardEvent) => {
      if (tableCellSelections.has(this.view)) {
        if (event.key === "Backspace" || event.key === "Delete") {
          if (deleteTableCellSelection(this.view)) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }

          return;
        }

        if (event.key === "Escape") {
          clearTableCellSelection(this.view);
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
      }

      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }

      const direction = event.key === "ArrowDown"
        ? "down"
        : event.key === "ArrowUp"
          ? "up"
          : null;

      if (!direction || !moveBySourceLine(this.view, direction)) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
    };

    constructor(view: EditorView) {
      this.view = view;
      this.view.contentDOM.addEventListener("copy", this.handleCopy, true);
      this.view.contentDOM.addEventListener("cut", this.handleCut, true);
      this.view.contentDOM.addEventListener("keydown", this.handleKeyDown, true);
    }

    destroy() {
      this.view.contentDOM.removeEventListener("copy", this.handleCopy, true);
      this.view.contentDOM.removeEventListener("cut", this.handleCut, true);
      this.view.contentDOM.removeEventListener("keydown", this.handleKeyDown, true);
    }
  },
);

function parseCodeFence(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const firstLine = lines[0] ?? "";
  const language = firstLine.replace(/^(```+|~~~+)/, "").trim();
  const body = lines.length > 2 ? lines.slice(1, -1).join("\n") : "";

  return {
    language,
    body,
  };
}

function trimCellSource(line: string, from: number, to: number) {
  let cellFrom = from;
  let cellTo = to;

  while (cellFrom < cellTo && /\s/.test(line[cellFrom] ?? "")) {
    cellFrom += 1;
  }

  while (cellTo > cellFrom && /\s/.test(line[cellTo - 1] ?? "")) {
    cellTo -= 1;
  }

  return {
    from: cellFrom,
    to: cellTo,
    text: line.slice(cellFrom, cellTo),
  };
}

function splitTableRowWithSource(line: string, lineStart: number) {
  const segments: SourceRange[] = [];
  let segmentStart = 0;

  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "|") {
      segments.push({
        from: segmentStart,
        to: index,
      });
      segmentStart = index + 1;
    }
  }

  segments.push({
    from: segmentStart,
    to: line.length,
  });

  if (line.trimStart().startsWith("|")) {
    segments.shift();
  }

  if (line.trimEnd().endsWith("|")) {
    segments.pop();
  }

  return segments.map((segment) => {
    const cell = trimCellSource(line, segment.from, segment.to);

    return {
      from: lineStart + cell.from,
      to: lineStart + cell.to,
      text: cell.text,
    };
  });
}

function sourceLines(markdown: string) {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  let offset = 0;

  return lines.map((line) => {
    const sourceLine = {
      text: line,
      from: offset,
    };
    offset += line.length + 1;
    return sourceLine;
  });
}

function parseMarkdownTable(markdown: string) {
  const lines = sourceLines(markdown).filter((line) => line.text.trim());

  if (lines.length < 2) {
    return {
      headers: [],
      rows: [],
      headerCells: [],
      rowCells: [],
    };
  }

  const headerCells = splitTableRowWithSource(lines[0].text, lines[0].from);
  const rowCells = lines
    .slice(2)
    .map((line) => splitTableRowWithSource(line.text, line.from));

  return {
    headers: headerCells.map((cell) => cell.text),
    rows: rowCells.map((row) => row.map((cell) => cell.text)),
    headerCells,
    rowCells,
  };
}

function textNode(value: string) {
  return document.createTextNode(value);
}

function revealSourceBlock(view: EditorView, position: number) {
  clearTableCellSelection(view);
  window.getSelection()?.removeAllRanges();
  view.dispatch({
    selection: {
      anchor: Math.min(position, view.state.doc.length),
    },
    scrollIntoView: true,
  });
  view.focus();
}

function makeSourceRevealHandler(view: EditorView, position: number) {
  return (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event instanceof MouseEvent) {
      suppressNextVisualLineClick(view);
    }
    revealSourceBlock(view, position);
  };
}

class ListMarkerWidget extends WidgetType {
  private readonly marker: string;

  constructor(marker: string) {
    super();
    this.marker = marker;
  }

  eq(widget: WidgetType) {
    return widget instanceof ListMarkerWidget && widget.marker === this.marker;
  }

  toDOM() {
    const marker = document.createElement("span");
    marker.className = "cm-md-list-marker";
    marker.textContent = `${listMarkerLabel(this.marker)} `;
    marker.setAttribute("aria-hidden", "true");
    return marker;
  }
}

class TaskMarkerWidget extends WidgetType {
  private readonly checked: boolean;

  constructor(checked: boolean) {
    super();
    this.checked = checked;
  }

  eq(widget: WidgetType) {
    return widget instanceof TaskMarkerWidget && widget.checked === this.checked;
  }

  toDOM() {
    const checkbox = document.createElement("span");
    checkbox.className = this.checked
      ? "cm-md-task-marker checked"
      : "cm-md-task-marker";
    checkbox.setAttribute("aria-hidden", "true");
    return checkbox;
  }
}

class CodeBlockWidget extends WidgetType {
  private readonly language: string;
  private readonly body: string;
  private readonly editAt: number;

  constructor(markdown: string, editAt: number) {
    super();
    const parsed = parseCodeFence(markdown);
    this.language = parsed.language;
    this.body = parsed.body;
    this.editAt = editAt;
  }

  eq(widget: WidgetType) {
    return (
      widget instanceof CodeBlockWidget &&
      widget.language === this.language &&
      widget.body === this.body &&
      widget.editAt === this.editAt
    );
  }

  get estimatedHeight() {
    const lines = Math.max(1, this.body.split("\n").length);

    return lines * 23 + 64;
  }

  private handlePointerDown(event: MouseEvent, view: EditorView) {
    if (event.button !== 0) {
      return;
    }

    event.stopPropagation();
    clearTableCellSelection(view);

    const startX = event.clientX;
    const startY = event.clientY;
    let dragged = false;

    const move = (moveEvent: MouseEvent) => {
      const distance =
        Math.abs(moveEvent.clientX - startX) +
        Math.abs(moveEvent.clientY - startY);

      if (distance < 4) {
        return;
      }

      dragged = true;
      markDraggedVisualLineClick(view);
    };

    const stop = (stopEvent: MouseEvent) => {
      window.removeEventListener("mousemove", move, true);
      window.removeEventListener("mouseup", stop, true);

      if (dragged || window.getSelection()?.toString()) {
        markDraggedVisualLineClick(view);
        return;
      }

      stopEvent.preventDefault();
      stopEvent.stopPropagation();
      suppressNextVisualLineClick(view);
      revealSourceBlock(view, this.editAt);
    };

    window.addEventListener("mousemove", move, true);
    window.addEventListener("mouseup", stop, true);
  }

  toDOM(view: EditorView) {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-code-block";
    wrapper.tabIndex = 0;
    wrapper.role = "button";
    wrapper.ariaLabel = "コードブロックを Markdown ソースで編集";
    wrapper.title = "クリックして Markdown ソースで編集";

    const reveal = makeSourceRevealHandler(view, this.editAt);
    wrapper.addEventListener("mousedown", (event) =>
      this.handlePointerDown(event, view),
    );
    wrapper.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        reveal(event);
      }
    });

    if (this.language) {
      const label = document.createElement("span");
      label.className = "cm-md-code-language";
      label.textContent = this.language;
      wrapper.append(label);
    }

    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = this.body;
    pre.append(code);
    wrapper.append(pre);

    return wrapper;
  }
}

class TableWidget extends WidgetType {
  private readonly headers: string[];
  private readonly rows: string[][];
  private readonly headerCells: TableCellSource[];
  private readonly rowCells: TableCellSource[][];
  private readonly editAt: number;

  constructor(markdown: string, editAt: number) {
    super();
    const parsed = parseMarkdownTable(markdown);
    this.headers = parsed.headers;
    this.rows = parsed.rows;
    this.headerCells = parsed.headerCells;
    this.rowCells = parsed.rowCells;
    this.editAt = editAt;
  }

  get estimatedHeight() {
    const visibleRows = Math.max(1, this.rows.length + 1);

    return visibleRows * 40 + 30;
  }

  eq(widget: WidgetType) {
    return (
      widget instanceof TableWidget &&
      JSON.stringify(widget.headers) === JSON.stringify(this.headers) &&
      JSON.stringify(widget.rows) === JSON.stringify(this.rows) &&
      JSON.stringify(widget.headerCells) === JSON.stringify(this.headerCells) &&
      JSON.stringify(widget.rowCells) === JSON.stringify(this.rowCells) &&
      widget.editAt === this.editAt
    );
  }

  private sourcePositionForEvent(event: MouseEvent) {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-source-from][data-source-to]")
      : null;

    if (!target) {
      return this.editAt;
    }

    const sourceFrom = Number(target.dataset.sourceFrom);
    const sourceTo = Number(target.dataset.sourceTo);

    if (!Number.isFinite(sourceFrom) || !Number.isFinite(sourceTo)) {
      return this.editAt;
    }

    const rect = target.getBoundingClientRect();
    const ratio =
      rect.width > 0
        ? Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1)
        : 0;

    return Math.round(sourceFrom + (sourceTo - sourceFrom) * ratio);
  }

  private applyCellSource(cell: HTMLElement, source?: TableCellSource) {
    if (!source) {
      return;
    }

    cell.dataset.sourceFrom = String(this.editAt + source.from);
    cell.dataset.sourceTo = String(this.editAt + source.to);
  }

  private applyCellPosition(
    cell: HTMLElement,
    position: TableCellPosition,
  ) {
    cell.dataset.tableRow = String(position.row);
    cell.dataset.tableColumn = String(position.column);
  }

  private clearCellSelection(wrapper: HTMLElement) {
    wrapper
      .querySelectorAll(".cm-md-table-cell-selected")
      .forEach((cell) => cell.classList.remove("cm-md-table-cell-selected"));
  }

  private cellPosition(cell: HTMLElement): TableCellPosition | null {
    const row = Number(cell.dataset.tableRow);
    const column = Number(cell.dataset.tableColumn);

    if (!Number.isFinite(row) || !Number.isFinite(column)) {
      return null;
    }

    return {
      row,
      column,
    };
  }

  private markCellSelection(
    wrapper: HTMLElement,
    from: TableCellPosition,
    to: TableCellPosition,
  ) {
    const rowFrom = Math.min(from.row, to.row);
    const rowTo = Math.max(from.row, to.row);
    const columnFrom = Math.min(from.column, to.column);
    const columnTo = Math.max(from.column, to.column);
    const cells: SelectedTableCell[] = [];

    for (const cell of wrapper.querySelectorAll<HTMLElement>(
      "[data-table-row][data-table-column]",
    )) {
      const position = this.cellPosition(cell);

      if (!position) {
        continue;
      }

      const selected =
        position.row >= rowFrom &&
        position.row <= rowTo &&
        position.column >= columnFrom &&
        position.column <= columnTo;

      cell.classList.toggle("cm-md-table-cell-selected", selected);

      if (selected) {
        cells.push({
          ...position,
          from: Number(cell.dataset.sourceFrom),
          to: Number(cell.dataset.sourceTo),
          text: cell.textContent ?? "",
        });
      }
    }

    return {
      wrapper,
      rowFrom,
      rowTo,
      columnFrom,
      columnTo,
      cells,
    };
  }

  private tableCellForEvent(event: MouseEvent) {
    return event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-table-row][data-table-column]")
      : null;
  }

  private handleTablePointerDown(
    event: MouseEvent,
    view: EditorView,
    wrapper: HTMLElement,
  ) {
    if (event.button !== 0) {
      return;
    }

    const startCell = this.tableCellForEvent(event);

    if (!startCell) {
      event.preventDefault();
      event.stopPropagation();
      clearTableCellSelection(view);
      suppressNextVisualLineClick(view);
      revealSourceBlock(view, this.sourcePositionForEvent(event));
      return;
    }

    const startPosition = this.cellPosition(startCell);

    if (!startPosition) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    let selectingCells = false;
    clearTableCellSelection(view);

    const move = (moveEvent: MouseEvent) => {
      const distance =
        Math.abs(moveEvent.clientX - startX) +
        Math.abs(moveEvent.clientY - startY);

      if (!selectingCells && distance < 4) {
        return;
      }

      const targetCell = this.tableCellForEvent(moveEvent);
      const targetPosition = targetCell ? this.cellPosition(targetCell) : null;

      if (!targetPosition) {
        return;
      }

      selectingCells = true;
      markDraggedVisualLineClick(view);
      moveEvent.preventDefault();
      moveEvent.stopPropagation();
      window.getSelection()?.removeAllRanges();
      setTableCellSelection(
        view,
        this.markCellSelection(wrapper, startPosition, targetPosition),
      );
    };

    const stop = (stopEvent: MouseEvent) => {
      window.removeEventListener("mousemove", move, true);
      window.removeEventListener("mouseup", stop, true);

      if (selectingCells) {
        markDraggedVisualLineClick(view);
        stopEvent.preventDefault();
        stopEvent.stopPropagation();
        view.focus();
        const selection = tableCellSelections.get(view);

        if (selection) {
          showTableCellSelectionMenu(view, selection, {
            x: stopEvent.clientX,
            y: stopEvent.clientY,
          });
        }
        return;
      }

      clearTableCellSelection(view);
      suppressNextVisualLineClick(view);
      revealSourceBlock(view, this.sourcePositionForEvent(event));
    };

    clearTableCellSelection(view);
    this.clearCellSelection(wrapper);
    window.addEventListener("mousemove", move, true);
    window.addEventListener("mouseup", stop, true);
  }

  private handleTableContextMenu(
    event: MouseEvent,
    view: EditorView,
    wrapper: HTMLElement,
  ) {
    const targetCell = this.tableCellForEvent(event);

    if (!targetCell) {
      return;
    }

    const targetPosition = this.cellPosition(targetCell);

    if (!targetPosition) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const currentSelection = tableCellSelections.get(view);

    if (
      currentSelection?.wrapper === wrapper &&
      tableCellSelectionContainsPosition(currentSelection, targetPosition)
    ) {
      showTableCellSelectionMenu(view, currentSelection, {
        x: event.clientX,
        y: event.clientY,
      });
      view.focus();
      return;
    }

    clearTableCellSelection(view);
    setTableCellSelection(
      view,
      this.markCellSelection(wrapper, targetPosition, targetPosition),
      {
        menuAnchor: {
          x: event.clientX,
          y: event.clientY,
        },
      },
    );
    view.focus();
  }

  toDOM(view: EditorView) {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-table-wrapper";
    wrapper.tabIndex = 0;
    wrapper.role = "button";
    wrapper.ariaLabel = "表を Markdown ソースで編集";
    wrapper.title = "クリックして Markdown ソースで編集";

    wrapper.addEventListener("mousedown", (event) =>
      this.handleTablePointerDown(event, view, wrapper),
    );
    wrapper.addEventListener("contextmenu", (event) =>
      this.handleTableContextMenu(event, view, wrapper),
    );
    wrapper.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        makeSourceRevealHandler(view, this.editAt)(event);
      }
    });

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");

    for (const [index, header] of this.headers.entries()) {
      const cell = document.createElement("th");
      this.applyCellSource(cell, this.headerCells[index]);
      this.applyCellPosition(cell, {
        row: 0,
        column: index,
      });
      cell.append(textNode(header));
      headerRow.append(cell);
    }

    thead.append(headerRow);
    table.append(thead);

    const tbody = document.createElement("tbody");

    for (const [rowIndex, row] of this.rows.entries()) {
      const tableRow = document.createElement("tr");

      for (const [cellIndex, cellValue] of row.entries()) {
        const cell = document.createElement("td");
        this.applyCellSource(cell, this.rowCells[rowIndex]?.[cellIndex]);
        this.applyCellPosition(cell, {
          row: rowIndex + 1,
          column: cellIndex,
        });
        cell.append(textNode(cellValue));
        tableRow.append(cell);
      }

      tbody.append(tableRow);
    }

    table.append(tbody);
    wrapper.append(table);

    return wrapper;
  }
}

class HorizontalRuleWidget extends WidgetType {
  private readonly marker: string;
  private readonly editAt: number;

  constructor(marker: string, editAt: number) {
    super();
    this.marker = marker;
    this.editAt = editAt;
  }

  eq(widget: WidgetType) {
    return (
      widget instanceof HorizontalRuleWidget &&
      widget.marker === this.marker &&
      widget.editAt === this.editAt
    );
  }

  get estimatedHeight() {
    return 50;
  }

  toDOM(view: EditorView) {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-horizontal-rule";
    wrapper.tabIndex = 0;
    wrapper.role = "button";
    wrapper.ariaLabel = "罫線を Markdown ソースで編集";
    wrapper.title = "クリックして Markdown ソースで編集";

    const reveal = makeSourceRevealHandler(view, this.editAt);
    wrapper.addEventListener("mousedown", reveal);
    wrapper.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        reveal(event);
      }
    });

    const rule = document.createElement("hr");
    wrapper.append(rule);

    return wrapper;
  }
}

class ImageWidget extends WidgetType {
  private readonly alt: string;
  private readonly url: string;

  constructor(alt: string, url: string) {
    super();
    this.alt = alt;
    this.url = url;
  }

  eq(widget: WidgetType) {
    return (
      widget instanceof ImageWidget &&
      widget.alt === this.alt &&
      widget.url === this.url
    );
  }

  toDOM() {
    const figure = document.createElement("figure");
    figure.className = "cm-md-image-preview";

    const image = document.createElement("img");
    image.alt = this.alt;
    image.src = this.url;
    image.loading = "lazy";
    figure.append(image);

    if (this.alt) {
      const caption = document.createElement("figcaption");
      caption.textContent = this.alt;
      figure.append(caption);
    }

    return figure;
  }
}

function imageParts(markdown: string) {
  const match = /^!\[(.*)]\((.*)\)$/.exec(markdown.trim());

  return {
    alt: match?.[1] ?? "",
    url: match?.[2] ?? "",
  };
}

function buildLivePreviewDecorations(state: EditorState): DecorationSet {
  const decorations: PreviewDecoration[] = [];
  const sourceRanges = sourceRangesForSelection(state);
  const tree = syntaxTree(state);

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const lineRange = {
      from: line.from,
      to: line.to,
    };
    const decoration = isRangeInSourceRange(lineRange, sourceRanges.structural)
      ? structuralSourceLineDecoration(line.from, line.to)
      : sourceLineDecoration(line.from, line.to);

    addDecoration(
      decorations,
      line.from,
      line.from,
      decoration,
    );
  }

  tree.iterate({
    enter(node) {
      const level = headingLevelForNode(node.name);

      if (level) {
        const line = state.doc.lineAt(node.from);
        addDecoration(
          decorations,
          line.from,
          line.from,
          headingLineDecoration(level),
        );
        return;
      }

      if (node.name === "Blockquote") {
        const fromLine = state.doc.lineAt(node.from);
        const toLine = state.doc.lineAt(node.to);

        for (let lineNumber = fromLine.number; lineNumber <= toLine.number; lineNumber += 1) {
          const line = state.doc.line(lineNumber);
          addDecoration(decorations, line.from, line.from, quoteLineDecoration);
        }

        return;
      }

      if (node.name === "Link" && !isInSourceRange(node, sourceRanges.all)) {
        const url = urlTextForNode(state, node.node);

        if (url) {
          addDecoration(
            decorations,
            node.from,
            node.to,
            clickableLinkDecoration(url),
          );
        }
      }

      if (
        isStructuralBlock(node.name) &&
        !isInSourceRange(node, sourceRanges.structural)
      ) {
        const text = state.doc.sliceString(node.from, node.to);
        const firstLine = state.doc.lineAt(node.from);
        const editAt =
          node.name === "FencedCode" && firstLine.to < node.to
            ? firstLine.to + 1
            : node.from;
        let widget: WidgetType;

        if (node.name === "FencedCode") {
          widget = new CodeBlockWidget(text, editAt);
        } else if (node.name === "Table") {
          widget = new TableWidget(text, editAt);
        } else {
          widget = new HorizontalRuleWidget(text, editAt);
        }

        addDecoration(
          decorations,
          node.from,
          node.to,
          Decoration.replace({
            widget,
            block: true,
          }),
        );
        return false;
      }

      if (node.name === "Image" && !isInSourceRange(node, sourceRanges.all)) {
        const text = state.doc.sliceString(node.from, node.to);
        const image = imageParts(text);

        if (image.url) {
          addDecoration(
            decorations,
            node.from,
            node.to,
            Decoration.replace({
              widget: new ImageWidget(image.alt, image.url),
            }),
          );
          return false;
        }
      }

      if (isInSourceRange(node, sourceRanges.all)) {
        return;
      }

      if (node.name === "ListMark") {
        if (!lineHasContentAfterToken(state, node.to)) {
          return;
        }

        const marker = state.doc.sliceString(node.from, node.to);
        addDecoration(
          decorations,
          node.from,
          tokenEndWithTrailingSpace(state, node.to),
          Decoration.replace({
            widget: new ListMarkerWidget(marker),
          }),
        );
        return;
      }

      if (node.name === "TaskMarker") {
        if (!lineHasContentAfterToken(state, node.to)) {
          return;
        }

        const marker = state.doc.sliceString(node.from, node.to);
        addDecoration(
          decorations,
          node.from,
          tokenEndWithTrailingSpace(state, node.to),
          Decoration.replace({
            widget: new TaskMarkerWidget(/x/i.test(marker)),
          }),
        );
        return;
      }

      if (node.name === "URL") {
        const parentName = node.node.parent?.name;

        if (parentName === "Link" || parentName === "Image") {
          addDecoration(decorations, node.from, node.to, hiddenMarkDecoration);
        }

        return;
      }

      if (node.name === "Escape") {
        addDecoration(decorations, node.from, node.from + 1, hiddenMarkDecoration);
        return;
      }

      if (shouldHideMarkdownNode(node.name)) {
        if (
          (node.name === "HeaderMark" || node.name === "QuoteMark") &&
          !lineHasContentAfterToken(state, node.to)
        ) {
          return;
        }

        const to =
          node.name === "HeaderMark" || node.name === "QuoteMark"
            ? tokenEndWithTrailingSpace(state, node.to)
            : node.to;
        addDecoration(decorations, node.from, to, hiddenMarkDecoration);
      }
    },
  });

  decorations.sort((first, second) => {
    if (first.from !== second.from) {
      return first.from - second.from;
    }

    const firstStartSide = (first.value as Decoration & { startSide?: number })
      .startSide ?? 0;
    const secondStartSide = (second.value as Decoration & { startSide?: number })
      .startSide ?? 0;

    if (firstStartSide !== secondStartSide) {
      return firstStartSide - secondStartSide;
    }

    if (first.to !== second.to) {
      return first.to - second.to;
    }

    const firstEndSide = (first.value as Decoration & { endSide?: number })
      .endSide ?? 0;
    const secondEndSide = (second.value as Decoration & { endSide?: number })
      .endSide ?? 0;

    return firstEndSide - secondEndSide;
  });

  const builder = new RangeSetBuilder<Decoration>();

  for (const decoration of decorations) {
    builder.add(decoration.from, decoration.to, decoration.value);
  }

  return builder.finish();
}

const livePreviewField = StateField.define<DecorationSet>({
  create(state) {
    return buildLivePreviewDecorations(state);
  },
  update(decorations, transaction) {
    if (transaction.docChanged || transaction.selection) {
      return buildLivePreviewDecorations(transaction.state);
    }

    return decorations.map(transaction.changes);
  },
  provide(field) {
    return EditorView.decorations.from(field);
  },
});

export const livePreview = [
  livePreviewField,
  sourceLineNavigation,
  structuralSourceLineMouseDownHandler,
  visualLineMouseDownHandler,
  visualLineClickHandler,
  linkClickHandler,
];
