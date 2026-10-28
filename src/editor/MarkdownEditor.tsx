import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  closeSearchPanel,
  findNext as findNextMatch,
  findPrevious as findPreviousMatch,
  getSearchQuery,
  highlightSelectionMatches,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  searchKeymap,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  keymap,
  type Panel,
} from "@codemirror/view";
import { GFM } from "@lezer/markdown";
import { tags } from "@lezer/highlight";
import { livePreview } from "./livePreview";
import { markdownPadKeymap } from "./markdownKeymap";

interface MarkdownEditorProps {
  value: string;
  cursor: {
    anchor: number;
    head: number;
  };
  scroll: {
    x: number;
    y: number;
  };
  wordWrap: boolean;
  zoom: number;
  onChange: (value: string) => void;
  onCursorChange: (cursor: { anchor: number; head: number }) => void;
  onScrollChange: (scroll: { x: number; y: number }) => void;
}

export interface MarkdownEditorHandle {
  focus: () => void;
  openSearch: () => void;
  openReplace: () => void;
  findNext: () => void;
  findPrevious: () => void;
  replaceNext: () => void;
  replaceAll: () => void;
  selectAll: () => void;
}

type SearchPanelMode = "search" | "replace";

const searchPanelModes = new WeakMap<EditorView, SearchPanelMode>();

function applySearchPanelMode(view: EditorView, mode: SearchPanelMode) {
  searchPanelModes.set(view, mode);

  const panel = view.dom.querySelector<HTMLElement>(".cm-md-search-panel");

  if (!panel) {
    return;
  }

  panel.dataset.mode = mode;
  const toggle = panel.querySelector<HTMLButtonElement>(
    ".cm-md-search-mode-toggle",
  );

  if (toggle) {
    toggle.textContent = mode === "replace" ? "⌄" : "⌃";
    toggle.title = mode === "replace" ? "置換を閉じる" : "置換を開く";
  }
}

function openMarkdownPadSearchPanel(
  view: EditorView,
  mode: SearchPanelMode,
) {
  applySearchPanelMode(view, mode);
  openSearchPanel(view);
  applySearchPanelMode(view, mode);
  view.dom
    .querySelector<HTMLInputElement>(".cm-md-search-input")
    ?.focus();
}

function button(
  className: string,
  label: string,
  title: string,
  onClick: () => void,
) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  element.title = title;
  element.ariaLabel = title;
  element.addEventListener("click", (event) => {
    event.preventDefault();
    onClick();
  });
  return element;
}

class MarkdownPadSearchPanel implements Panel {
  readonly dom: HTMLElement;
  readonly top = true;

  private readonly searchField: HTMLInputElement;
  private readonly replaceField: HTMLInputElement;
  private readonly caseButton: HTMLButtonElement;
  private readonly wordButton: HTMLButtonElement;
  private readonly regexpButton: HTMLButtonElement;

  constructor(private readonly view: EditorView) {
    const query = getSearchQuery(view.state);
    const mode = searchPanelModes.get(view) ?? "search";
    const root = document.createElement("div");
    root.className = "cm-md-search-panel";
    root.dataset.mode = mode;

    const searchRow = document.createElement("div");
    searchRow.className = "cm-md-search-row";

    const modeToggle = button(
      "cm-md-search-icon-button cm-md-search-mode-toggle",
      mode === "replace" ? "⌄" : "⌃",
      mode === "replace" ? "置換を閉じる" : "置換を開く",
      () => {
        const nextMode = root.dataset.mode === "replace" ? "search" : "replace";
        applySearchPanelMode(view, nextMode);
        this.searchField.focus();
      },
    );

    this.searchField = document.createElement("input");
    this.searchField.className = "cm-md-search-input";
    this.searchField.name = "search";
    this.searchField.placeholder = "検索する";
    this.searchField.value = query.search;
    this.searchField.setAttribute("main-field", "true");
    this.searchField.autocomplete = "off";
    this.searchField.spellcheck = false;
    this.searchField.addEventListener("input", () => this.commitQuery());
    this.searchField.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        (event.shiftKey ? findPreviousMatch : findNextMatch)(view);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeSearchPanel(view);
        view.focus();
      }
    });

    const searchFieldWrap = document.createElement("label");
    searchFieldWrap.className = "cm-md-search-input-wrap";
    searchFieldWrap.append(this.searchField);
    const searchIcon = document.createElement("span");
    searchIcon.className = "cm-md-search-input-icon";
    searchIcon.textContent = "⌕";
    searchFieldWrap.append(searchIcon);

    searchRow.append(
      modeToggle,
      searchFieldWrap,
      button("cm-md-search-icon-button", "↓", "次を検索", () =>
        findNextMatch(view),
      ),
      button("cm-md-search-icon-button", "↑", "前を検索", () =>
        findPreviousMatch(view),
      ),
    );

    const options = document.createElement("div");
    options.className = "cm-md-search-options";
    this.caseButton = button("cm-md-search-toggle", "Aa", "大文字小文字を区別", () =>
      this.toggleQueryOption("caseSensitive"),
    );
    this.wordButton = button("cm-md-search-toggle", "単", "単語単位で検索", () =>
      this.toggleQueryOption("wholeWord"),
    );
    this.regexpButton = button("cm-md-search-toggle", ".*", "正規表現", () =>
      this.toggleQueryOption("regexp"),
    );
    options.append(this.caseButton, this.wordButton, this.regexpButton);
    searchRow.append(
      button("cm-md-search-icon-button", "☷", "検索オプション", () => {
        options.classList.toggle("open");
      }),
      button("cm-md-search-icon-button", "×", "閉じる", () => {
        closeSearchPanel(view);
        view.focus();
      }),
    );

    const replaceRow = document.createElement("div");
    replaceRow.className = "cm-md-replace-row";

    this.replaceField = document.createElement("input");
    this.replaceField.className = "cm-md-replace-input";
    this.replaceField.name = "replace";
    this.replaceField.placeholder = "置換";
    this.replaceField.value = query.replace;
    this.replaceField.autocomplete = "off";
    this.replaceField.spellcheck = false;
    this.replaceField.addEventListener("input", () => this.commitQuery());
    this.replaceField.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        replaceNext(view);
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeSearchPanel(view);
        view.focus();
      }
    });

    replaceRow.append(
      this.replaceField,
      button("cm-md-search-command-button", "置換", "次の一致を置換", () =>
        replaceNext(view),
      ),
      button("cm-md-search-command-button", "すべて置換", "すべて置換", () =>
        replaceAll(view),
      ),
    );

    root.append(searchRow, options, replaceRow);
    this.dom = root;
    this.syncOptionButtons(query);
  }

  update(update: { state: EditorState }) {
    const query = getSearchQuery(update.state);

    if (this.searchField.value !== query.search) {
      this.searchField.value = query.search;
    }

    if (this.replaceField.value !== query.replace) {
      this.replaceField.value = query.replace;
    }

    this.syncOptionButtons(query);
  }

  private commitQuery(overrides: Partial<SearchQuery> = {}) {
    const current = getSearchQuery(this.view.state);
    const next = new SearchQuery({
      search: this.searchField.value,
      replace: this.replaceField.value,
      caseSensitive: overrides.caseSensitive ?? current.caseSensitive,
      regexp: overrides.regexp ?? current.regexp,
      wholeWord: overrides.wholeWord ?? current.wholeWord,
      literal: overrides.literal ?? current.literal,
    });

    this.view.dispatch({
      effects: setSearchQuery.of(next),
    });
  }

  private toggleQueryOption(
    option: "caseSensitive" | "wholeWord" | "regexp",
  ) {
    const current = getSearchQuery(this.view.state);

    this.commitQuery({
      [option]: !current[option],
    });
    this.searchField.focus();
  }

  private syncOptionButtons(query: SearchQuery) {
    this.caseButton.classList.toggle("active", query.caseSensitive);
    this.wordButton.classList.toggle("active", query.wholeWord);
    this.regexpButton.classList.toggle("active", query.regexp);
  }
}

// A Markdown-source highlight style whose colors come from CSS variables, so a
// single data-theme flip restyles the revealed Markdown source (such as the
// `---` horizontal-rule token) without reconfiguring the editor. Formatting
// marks (`#`, `**`, `-`, `>` and so on) are drawn in a faint tone so the
// revealed source on the cursor line stays quiet, as in Obsidian.
const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.processingInstruction, color: "var(--mp-ed-syntax)" },
  { tag: tags.meta, color: "var(--mp-hl-meta)" },
  { tag: tags.link, color: "var(--mp-ed-link)" },
  { tag: tags.heading, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.keyword, color: "var(--mp-hl-keyword)" },
  {
    tag: [tags.atom, tags.bool, tags.url, tags.contentSeparator, tags.labelName],
    color: "var(--mp-hl-atom)",
  },
  { tag: [tags.literal, tags.inserted], color: "var(--mp-hl-literal)" },
  { tag: [tags.string, tags.deleted], color: "var(--mp-hl-string)" },
  {
    tag: [tags.regexp, tags.escape, tags.special(tags.string)],
    color: "var(--mp-hl-escape)",
  },
  { tag: tags.definition(tags.variableName), color: "var(--mp-hl-def)" },
  { tag: tags.local(tags.variableName), color: "var(--mp-hl-local)" },
  { tag: [tags.typeName, tags.namespace], color: "var(--mp-hl-type)" },
  { tag: tags.className, color: "var(--mp-hl-class)" },
  {
    tag: [tags.special(tags.variableName), tags.macroName],
    color: "var(--mp-hl-special)",
  },
  { tag: tags.definition(tags.propertyName), color: "var(--mp-hl-property)" },
  { tag: tags.comment, color: "var(--mp-hl-comment)" },
  { tag: tags.invalid, color: "var(--mp-hl-invalid)" },
]);

const bodyFont =
  '"Segoe UI Variable Text", "Segoe UI", "Yu Gothic UI", "Hiragino Sans", "Meiryo", system-ui, sans-serif';
const monoFont = '"Cascadia Mono", "Consolas", "BIZ UDGothic", monospace';

function editorTheme(zoom: number, wordWrap: boolean) {
  const fontSize = Math.max(12, Math.round(16 * (zoom / 100)));
  // Readable line length: like Obsidian, the note is a centered column of
  // about 700px at the default size, scaled with zoom.
  const readableWidth = `${44 * fontSize}px`;

  return EditorView.theme({
    "&": {
      height: "100%",
      fontSize: `${fontSize}px`,
      backgroundColor: "var(--mp-ed-bg)",
      color: "var(--mp-ed-fg)",
    },
    ".cm-scroller": {
      fontFamily: bodyFont,
      lineHeight: "1.6",
    },
    ".cm-content": {
      // CodeMirror sizes .cm-content as border-box, so add the side padding.
      maxWidth: wordWrap ? `calc(${readableWidth} + 64px)` : "none",
      width: wordWrap ? "auto" : "max-content",
      minWidth: wordWrap ? "0" : "100%",
      minHeight: "100%",
      margin: "0 auto",
      padding: "28px 32px 30vh",
      // The editor uses the native caret (no drawSelection), whose color the
      // CodeMirror base theme pins to black for non-dark themes. Follow the
      // theme token instead so the caret stays visible in dark mode.
      caretColor: "var(--mp-ed-cursor)",
    },
    ".cm-line": {
      padding: "0",
      minWidth: wordWrap ? "0" : "max-content",
    },
    ".cm-activeLine": {
      backgroundColor: "transparent",
    },
    ".cm-selectionBackground": {
      backgroundColor: "var(--mp-ed-selection) !important",
    },
    ".cm-selectionMatch": {
      backgroundColor: "var(--mp-ed-selection-match)",
    },
    ".cm-searchMatch": {
      backgroundColor: "var(--mp-ed-search-match)",
      borderRadius: "2px",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "var(--mp-ed-search-match-active)",
    },
    ".cm-md-table-wrapper .cm-md-table-cell-selected": {
      backgroundColor: "var(--mp-ed-cell-sel-bg)",
      boxShadow: "inset 0 0 0 2px var(--mp-ed-cell-sel-ring)",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--mp-ed-cursor)",
      borderLeftWidth: "1.5px",
    },
    ".cm-matchingBracket, .cm-nonmatchingBracket": {
      backgroundColor: "transparent",
      outline: "none",
    },
    ".cm-line .cm-header": {
      color: "var(--mp-ed-heading)",
      textDecoration: "none",
    },
    // Heading scale and spacing follow Obsidian's default theme.
    ".cm-md-heading-line": {
      color: "var(--mp-ed-heading)",
      fontWeight: "700",
      lineHeight: "1.3",
      letterSpacing: "-0.005em",
      textDecoration: "none",
    },
    ".cm-md-heading-line span": {
      textDecoration: "none !important",
    },
    ".cm-md-heading-1": {
      fontSize: "1.8em",
      paddingTop: "0.5em",
      paddingBottom: "0.1em",
    },
    ".cm-md-heading-2": {
      fontSize: "1.5em",
      paddingTop: "0.45em",
      paddingBottom: "0.08em",
    },
    ".cm-md-heading-3": {
      fontSize: "1.3em",
      paddingTop: "0.4em",
      paddingBottom: "0.06em",
    },
    ".cm-md-heading-4": {
      fontSize: "1.15em",
      paddingTop: "0.35em",
    },
    ".cm-md-heading-5": {
      fontSize: "1.05em",
      paddingTop: "0.3em",
    },
    ".cm-md-heading-6": {
      fontSize: "1em",
      paddingTop: "0.3em",
      color: "var(--mp-ed-heading-muted)",
    },
    ".cm-line .cm-strong": {
      fontWeight: "700",
    },
    ".cm-line .cm-emphasis": {
      fontStyle: "italic",
    },
    ".cm-line .cm-link": {
      color: "var(--mp-ed-link)",
      textDecoration: "none",
    },
    ".cm-md-clickable-link": {
      color: "var(--mp-ed-link) !important",
      cursor: "pointer",
      textDecoration: "underline",
      textDecorationThickness: "1px",
      textUnderlineOffset: "2px",
    },
    ".cm-md-clickable-link span": {
      color: "var(--mp-ed-link) !important",
    },
    ".cm-md-clickable-link:hover, .cm-md-clickable-link:hover span": {
      color: "var(--mp-ed-link-hover) !important",
    },
    ".cm-line .cm-url": {
      color: "var(--mp-ed-syntax)",
    },
    ".cm-md-inline-code": {
      fontFamily: monoFont,
      fontSize: "0.875em",
      color: "var(--mp-ed-inline-code-fg)",
      backgroundColor: "var(--mp-ed-inline-code-bg)",
      borderRadius: "3px",
      padding: "0.1em 0.25em",
    },
    // List items use a hanging indent so wrapped lines line up with the text
    // after the marker. The indent widths are set per line by livePreview.
    ".cm-md-list-line": {
      paddingLeft: "var(--mp-list-indent)",
      textIndent: "calc(-1 * var(--mp-list-marker))",
    },
    ".cm-md-list-continuation": {
      paddingLeft: "var(--mp-list-indent)",
    },
    ".cm-md-list-marker, .cm-md-task-marker": {
      display: "inline-block",
      textIndent: "0",
      verticalAlign: "baseline",
    },
    ".cm-md-list-marker": {
      boxSizing: "border-box",
      width: "var(--mp-list-marker)",
      color: "var(--mp-ed-list-marker)",
      fontVariantNumeric: "tabular-nums",
    },
    // An empty inline-block would sit on the baseline; give the bullet slot
    // the full line height so the dot centres on the text.
    ".cm-md-list-marker.bullet": {
      position: "relative",
      color: "transparent",
    },
    ".cm-md-list-marker.bullet::before": {
      content: "''",
      position: "absolute",
      left: "0.3em",
      top: "50%",
      width: "0.32em",
      height: "0.32em",
      borderRadius: "50%",
      backgroundColor: "var(--mp-ed-list-marker)",
      transform: "translateY(-50%)",
    },
    ".cm-md-task-marker": {
      position: "relative",
      width: "var(--mp-list-marker)",
      height: "1em",
      cursor: "default",
    },
    ".cm-md-task-marker::before": {
      content: "''",
      position: "absolute",
      left: "0.05em",
      top: "0.12em",
      boxSizing: "border-box",
      width: "0.95em",
      height: "0.95em",
      border: "1.5px solid var(--mp-ed-task-border)",
      borderRadius: "3px",
    },
    ".cm-md-task-marker.checked::before": {
      borderColor: "var(--mp-ed-task-checked-bg)",
      backgroundColor: "var(--mp-ed-task-checked-bg)",
    },
    ".cm-md-task-marker.checked::after": {
      content: "''",
      position: "absolute",
      left: "0.37em",
      top: "0.24em",
      boxSizing: "border-box",
      width: "0.3em",
      height: "0.55em",
      border: "solid var(--mp-ed-task-check)",
      borderWidth: "0 2px 2px 0",
      transform: "rotate(42deg)",
    },
    ".cm-md-task-done": {
      color: "var(--mp-ed-task-done-fg)",
      textDecoration: "line-through",
    },
    ".cm-md-quote-line": {
      borderLeft: "2px solid var(--mp-ed-quote-border)",
      paddingLeft: "1em",
      color: "var(--mp-ed-quote-fg)",
    },
    ".cm-md-code-block": {
      position: "relative",
      margin: "0.35em 0",
      borderRadius: "4px",
      backgroundColor: "var(--mp-ed-code-bg)",
      overflow: "hidden",
      cursor: "text",
    },
    ".cm-md-code-block:focus, .cm-md-table-wrapper:focus, .cm-md-horizontal-rule:focus": {
      outline: "2px solid var(--mp-ed-focus-ring)",
      outlineOffset: "2px",
    },
    ".cm-md-code-language": {
      position: "absolute",
      top: "6px",
      right: "10px",
      color: "var(--mp-ed-code-lang)",
      fontSize: "0.75em",
      fontFamily: monoFont,
    },
    ".cm-md-code-block pre": {
      margin: "0",
      padding: "12px 16px",
      overflowX: "auto",
      fontFamily: monoFont,
      fontSize: "0.875em",
      lineHeight: "1.55",
      userSelect: "text",
    },
    ".cm-md-code-block code": {
      userSelect: "text",
    },
    ".cm-md-table-wrapper": {
      width: "fit-content",
      maxWidth: "100%",
      margin: "0.35em 0",
      overflowX: "auto",
      cursor: "text",
    },
    ".cm-md-table-wrapper table": {
      width: "max-content",
      maxWidth: "none",
      borderCollapse: "collapse",
      fontSize: "0.94em",
      lineHeight: "1.5",
    },
    ".cm-md-table-wrapper th": {
      backgroundColor: "var(--mp-ed-th-bg)",
      color: "var(--mp-ed-th-fg)",
      fontWeight: "600",
    },
    ".cm-md-table-wrapper th, .cm-md-table-wrapper td": {
      padding: "5px 12px",
      border: "1px solid var(--mp-ed-table-border)",
      textAlign: "left",
      whiteSpace: "nowrap",
    },
    ".cm-md-horizontal-rule": {
      display: "flex",
      alignItems: "center",
      minHeight: "1.6em",
      margin: "0.4em 0",
      cursor: "text",
    },
    ".cm-md-horizontal-rule hr": {
      width: "100%",
      height: "1px",
      margin: "0",
      border: "0",
      backgroundColor: "var(--mp-ed-hr)",
    },
    ".cm-md-image-preview": {
      textIndent: "0",
      display: "inline-flex",
      flexDirection: "column",
      gap: "4px",
      maxWidth: "100%",
      margin: "0.35em 0",
    },
    ".cm-md-image-preview img": {
      maxWidth: "100%",
      maxHeight: "420px",
      borderRadius: "4px",
    },
    ".cm-md-image-preview figcaption": {
      color: "var(--mp-ed-caption)",
      fontSize: "0.86em",
    },
    ".cm-panels": {
      borderTop: "0",
      backgroundColor: "var(--mp-ed-panel-bg)",
      color: "var(--mp-ed-panel-fg)",
      fontFamily: bodyFont,
      fontSize: "13px",
    },
    ".cm-panels.cm-panels-top": {
      borderBottom: "1px solid var(--mp-ed-panel-border)",
    },
    ".cm-md-search-panel": {
      display: "grid",
      gap: "4px",
      maxWidth: `calc(${readableWidth} + 64px)`,
      margin: "0 auto",
      padding: "6px 32px",
    },
    ".cm-md-search-row": {
      display: "grid",
      gridTemplateColumns: "26px minmax(160px, 1fr) 26px 26px 26px 26px",
      gap: "2px",
      alignItems: "center",
    },
    ".cm-md-search-input-wrap": {
      position: "relative",
      display: "block",
      minWidth: "0",
      marginRight: "4px",
    },
    ".cm-md-search-input, .cm-md-replace-input": {
      boxSizing: "border-box",
      width: "100%",
      minWidth: "0",
      height: "28px",
      border: "1px solid var(--mp-ed-input-border)",
      borderRadius: "4px",
      padding: "0 28px 0 8px",
      backgroundColor: "var(--mp-ed-input-bg)",
      color: "var(--mp-ed-input-fg)",
      font: "inherit",
    },
    ".cm-md-search-input:focus, .cm-md-replace-input:focus": {
      borderColor: "var(--mp-accent)",
      outline: "none",
    },
    ".cm-md-search-input-icon": {
      position: "absolute",
      right: "8px",
      top: "50%",
      transform: "translateY(-50%)",
      color: "var(--mp-ed-input-icon)",
      pointerEvents: "none",
    },
    ".cm-md-search-icon-button, .cm-md-search-command-button, .cm-md-search-toggle": {
      height: "26px",
      border: "0",
      borderRadius: "4px",
      backgroundColor: "var(--mp-ed-btn-bg)",
      color: "var(--mp-ed-btn-fg)",
      font: "inherit",
    },
    ".cm-md-search-icon-button": {
      width: "26px",
      padding: "0",
      fontSize: "14px",
      lineHeight: "1",
    },
    ".cm-md-search-command-button": {
      padding: "0 10px",
      border: "1px solid var(--mp-ed-input-border)",
    },
    ".cm-md-search-icon-button:hover, .cm-md-search-command-button:hover, .cm-md-search-toggle:hover": {
      backgroundColor: "var(--mp-ed-btn-hover-bg)",
      color: "var(--mp-ed-panel-fg)",
    },
    ".cm-md-search-toggle.active": {
      backgroundColor: "var(--mp-ed-btn-active-bg)",
      color: "var(--mp-ed-btn-active-fg)",
    },
    ".cm-md-search-options": {
      display: "none",
      gap: "2px",
      paddingLeft: "28px",
    },
    ".cm-md-search-options.open": {
      display: "flex",
    },
    ".cm-md-search-toggle": {
      minWidth: "34px",
      padding: "0 6px",
      fontSize: "12px",
    },
    ".cm-md-replace-row": {
      display: "grid",
      gridTemplateColumns: "minmax(160px, 1fr) auto auto",
      gap: "4px",
      paddingLeft: "28px",
      paddingRight: "108px",
    },
    ".cm-md-search-panel[data-mode='search'] .cm-md-replace-row": {
      display: "none",
    },
    "@media (max-width: 760px)": {
      ".cm-content": {
        paddingLeft: "16px",
        paddingRight: "16px",
      },
      ".cm-md-search-panel": {
        padding: "6px 12px",
      },
      ".cm-md-search-row": {
        gridTemplateColumns: "26px minmax(90px, 1fr) 26px 26px 26px 26px",
      },
      ".cm-md-replace-row": {
        gridTemplateColumns: "minmax(90px, 1fr) auto auto",
        paddingRight: "0",
      },
    },
  });
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
function MarkdownEditor({
  value,
  cursor,
  scroll,
  wordWrap,
  zoom,
  onChange,
  onCursorChange,
  onScrollChange,
}: MarkdownEditorProps, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const onScrollChangeRef = useRef(onScrollChange);
  const syncingValueRef = useRef(false);
  const syncingScrollRef = useRef(false);
  const wrapCompartment = useMemo(() => new Compartment(), []);
  const themeCompartment = useMemo(() => new Compartment(), []);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onCursorChangeRef.current = onCursorChange;
  }, [onCursorChange]);

  useEffect(() => {
    onScrollChangeRef.current = onScrollChange;
  }, [onScrollChange]);

  useImperativeHandle(ref, () => ({
    focus() {
      viewRef.current?.focus();
    },
    openSearch() {
      const view = viewRef.current;

      if (view) {
        openMarkdownPadSearchPanel(view, "search");
      }
    },
    openReplace() {
      const view = viewRef.current;

      if (view) {
        openMarkdownPadSearchPanel(view, "replace");
      }
    },
    findNext() {
      const view = viewRef.current;

      if (view) {
        findNextMatch(view);
        view.focus();
      }
    },
    findPrevious() {
      const view = viewRef.current;

      if (view) {
        findPreviousMatch(view);
        view.focus();
      }
    },
    replaceNext() {
      const view = viewRef.current;

      if (view) {
        replaceNext(view);
      }
    },
    replaceAll() {
      const view = viewRef.current;

      if (view) {
        replaceAll(view);
      }
    },
    selectAll() {
      const view = viewRef.current;

      if (view) {
        view.dispatch({
          selection: {
            anchor: 0,
            head: view.state.doc.length,
          },
        });
        view.focus();
      }
    },
  }), []);

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !syncingValueRef.current) {
        onChangeRef.current(update.state.doc.toString());
      }

      if (update.selectionSet || update.docChanged) {
        const selection = update.state.selection.main;
        onCursorChangeRef.current({
          anchor: selection.anchor,
          head: selection.head,
        });
      }
    });

    const scrollListener = EditorView.domEventHandlers({
      scroll(_event, view) {
        if (syncingScrollRef.current) {
          return;
        }

        onScrollChangeRef.current({
          x: view.scrollDOM.scrollLeft,
          y: view.scrollDOM.scrollTop,
        });
      },
    });

    const initialSelection = EditorSelection.single(
      Math.min(cursor.anchor, value.length),
      Math.min(cursor.head, value.length),
    );

    const state = EditorState.create({
      doc: value,
      selection: initialSelection,
      extensions: [
        history(),
        indentOnInput(),
        syntaxHighlighting(markdownHighlightStyle, { fallback: true }),
        bracketMatching(),
        markdown({
          addKeymap: false,
          extensions: [GFM],
        }),
        search({
          top: true,
          createPanel(view) {
            return new MarkdownPadSearchPanel(view);
          },
        }),
        highlightSelectionMatches(),
        // Kept for its .cm-activeLine marker (tests and tooling rely on it);
        // the theme leaves it unpainted, as Obsidian does.
        highlightActiveLine(),
        scrollListener,
        markdownPadKeymap,
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        livePreview,
        wrapCompartment.of(wordWrap ? EditorView.lineWrapping : []),
        themeCompartment.of(editorTheme(zoom, wordWrap)),
        updateListener,
      ],
    });

    const view = new EditorView({
      state,
      parent: hostRef.current,
    });

    viewRef.current = view;

    requestAnimationFrame(() => {
      syncingScrollRef.current = true;
      view.scrollDOM.scrollLeft = scroll.x;
      view.scrollDOM.scrollTop = scroll.y;
      syncingScrollRef.current = false;
    });

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [themeCompartment, wrapCompartment]);

  useEffect(() => {
    const view = viewRef.current;

    if (!view) {
      return;
    }

    const currentValue = view.state.doc.toString();

    if (currentValue !== value) {
      syncingValueRef.current = true;
      view.dispatch({
        changes: {
          from: 0,
          to: currentValue.length,
          insert: value,
        },
      });
      syncingValueRef.current = false;
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;

    if (!view) {
      return;
    }

    const anchor = Math.min(cursor.anchor, view.state.doc.length);
    const head = Math.min(cursor.head, view.state.doc.length);
    const currentSelection = view.state.selection.main;

    if (currentSelection.anchor !== anchor || currentSelection.head !== head) {
      view.dispatch({
        selection: {
          anchor,
          head,
        },
      });
    }
  }, [cursor.anchor, cursor.head]);

  useEffect(() => {
    const view = viewRef.current;

    if (!view) {
      return;
    }

    if (
      Math.abs(view.scrollDOM.scrollLeft - scroll.x) > 1 ||
      Math.abs(view.scrollDOM.scrollTop - scroll.y) > 1
    ) {
      syncingScrollRef.current = true;
      view.scrollDOM.scrollLeft = scroll.x;
      view.scrollDOM.scrollTop = scroll.y;
      requestAnimationFrame(() => {
        syncingScrollRef.current = false;
      });
    }
  }, [scroll.x, scroll.y]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: wrapCompartment.reconfigure(
        wordWrap ? EditorView.lineWrapping : [],
      ),
    });
  }, [wordWrap, wrapCompartment]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.reconfigure(editorTheme(zoom, wordWrap)),
    });
  }, [themeCompartment, wordWrap, zoom]);

  return <div ref={hostRef} className="editor-host" />;
});
