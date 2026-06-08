import { syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import { EditorState, RangeSetBuilder, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  WidgetType,
  EditorView,
} from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";

type SourceRange = {
  from: number;
  to: number;
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

function splitTableRow(line: string) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");

  return trimmed.split("|").map((cell) => cell.trim());
}

function parseMarkdownTable(markdown: string) {
  const lines = markdown
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return {
      headers: [],
      rows: [],
    };
  }

  return {
    headers: splitTableRow(lines[0]),
    rows: lines.slice(2).map(splitTableRow),
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
  private readonly editAt: number;

  constructor(markdown: string, editAt: number) {
    super();
    const parsed = parseMarkdownTable(markdown);
    this.headers = parsed.headers;
    this.rows = parsed.rows;
    this.editAt = editAt;
  }

  eq(widget: WidgetType) {
    return (
      widget instanceof TableWidget &&
      JSON.stringify(widget.headers) === JSON.stringify(this.headers) &&
      JSON.stringify(widget.rows) === JSON.stringify(this.rows) &&
      widget.editAt === this.editAt
    );
  }

  toDOM(view: EditorView) {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-table-wrapper";
    wrapper.tabIndex = 0;
    wrapper.role = "button";
    wrapper.ariaLabel = "表を Markdown ソースで編集";
    wrapper.title = "クリックして Markdown ソースで編集";

    const reveal = makeSourceRevealHandler(view, this.editAt);
    wrapper.addEventListener("mousedown", reveal);
    wrapper.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        reveal(event);
      }
    });

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");

    for (const header of this.headers) {
      const cell = document.createElement("th");
      cell.append(textNode(header));
      headerRow.append(cell);
    }

    thead.append(headerRow);
    table.append(thead);

    const tbody = document.createElement("tbody");

    for (const row of this.rows) {
      const tableRow = document.createElement("tr");

      for (const cellValue of row) {
        const cell = document.createElement("td");
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

export const livePreview = [livePreviewField, linkClickHandler];
