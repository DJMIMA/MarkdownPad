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
  keymap,
} from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";

type SourceRange = {
  from: number;
  to: number;
};

type TableCellSource = SourceRange & {
  text: string;
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

function sourceRangesForSelection(state: EditorState): SourceRange[] {
  const ranges: SourceRange[] = [];
  const tree = syntaxTree(state);

  for (const selectionRange of state.selection.ranges) {
    const from = Math.min(selectionRange.from, selectionRange.to);
    const to = Math.max(selectionRange.from, selectionRange.to);
    const startLine = state.doc.lineAt(from);
    const endLine = state.doc.lineAt(to);

    ranges.push({
      from: startLine.from,
      to: endLine.to,
    });

    tree.iterate({
      enter(node) {
        if (!isStructuralBlock(node.name)) {
          return;
        }

        if (
          rangeContainsPosition({ from: node.from, to: node.to }, selectionRange.head)
        ) {
          ranges.push({
            from: node.from,
            to: node.to,
          });
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

function headingEditPosition(state: EditorState, position: number) {
  const line = state.doc.lineAt(position);
  const text = state.doc.sliceString(line.from, line.to);
  const marker = /^(#{1,6}\s*)/.exec(text);

  return line.from + (marker?.[0].length ?? 0);
}

const headingClickHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) {
      return false;
    }

    const lineElement = event.target instanceof Element
      ? event.target.closest<HTMLElement>(".cm-md-heading-line")
      : null;

    if (!lineElement) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    view.dispatch({
      selection: {
        anchor: headingEditPosition(view.state, view.posAtDOM(lineElement, 0)),
      },
      scrollIntoView: true,
    });
    view.focus();
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

const sourceLineNavigation = keymap.of([
  {
    key: "ArrowDown",
    run: (view) => moveBySourceLine(view, "down"),
  },
  {
    key: "ArrowUp",
    run: (view) => moveBySourceLine(view, "up"),
  },
]);

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

  toDOM(view: EditorView) {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-code-block";
    wrapper.tabIndex = 0;
    wrapper.role = "button";
    wrapper.ariaLabel = "コードブロックを Markdown ソースで編集";
    wrapper.title = "クリックして Markdown ソースで編集";

    const reveal = makeSourceRevealHandler(view, this.editAt);
    wrapper.addEventListener("mousedown", reveal);
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

    return visibleRows * 40;
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

  toDOM(view: EditorView) {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-table-wrapper";
    wrapper.tabIndex = 0;
    wrapper.role = "button";
    wrapper.ariaLabel = "表を Markdown ソースで編集";
    wrapper.title = "クリックして Markdown ソースで編集";

    wrapper.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      revealSourceBlock(view, this.sourcePositionForEvent(event));
    });
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

      if (node.name === "Link" && !isInSourceRange(node, sourceRanges)) {
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

      if (isStructuralBlock(node.name) && !isInSourceRange(node, sourceRanges)) {
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

      if (node.name === "Image" && !isInSourceRange(node, sourceRanges)) {
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

      if (isInSourceRange(node, sourceRanges)) {
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

    return first.to - second.to;
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
  headingClickHandler,
  linkClickHandler,
];
