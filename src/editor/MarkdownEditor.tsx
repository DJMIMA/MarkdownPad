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
  defaultHighlightStyle,
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
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type Panel,
} from "@codemirror/view";
import { GFM } from "@lezer/markdown";
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

function editorTheme(zoom: number, wordWrap: boolean) {
  const fontSize = Math.max(13, Math.round(15 * (zoom / 100)));

  return EditorView.theme({
    "&": {
      height: "100%",
      fontSize: `${fontSize}px`,
      backgroundColor: "#fbfaf7",
      color: "#232624",
    },
    ".cm-scroller": {
      fontFamily:
        '"Segoe UI", "Yu Gothic UI", "Hiragino Sans", "Meiryo", sans-serif',
      lineHeight: "1.7",
    },
    ".cm-content": {
      maxWidth: wordWrap ? "920px" : "none",
      width: wordWrap ? "auto" : "max-content",
      minWidth: "100%",
      minHeight: "100%",
      padding: "34px 44px 48px",
    },
    ".cm-line": {
      padding: "0 4px",
      minWidth: wordWrap ? "0" : "max-content",
    },
    ".cm-activeLine": {
      backgroundColor: "#eef6f7",
      outline: "1px solid #d7e8ea",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#eef6f7",
      color: "#3d4752",
    },
    ".cm-gutters": {
      backgroundColor: "#f5f2ea",
      borderRight: "1px solid #ddd6c8",
      color: "#77756d",
    },
    ".cm-selectionBackground": {
      backgroundColor: "#b7d7ff !important",
    },
    ".cm-md-table-wrapper .cm-md-table-cell-selected": {
      backgroundColor: "#cfe0ff",
      boxShadow: "inset 0 0 0 2px #6b94d6",
    },
    ".cm-cursor": {
      borderLeftColor: "#1f6feb",
    },
    ".cm-line .cm-header": {
      color: "#17406d",
      fontWeight: "700",
      textDecoration: "none",
    },
    ".cm-md-heading-line": {
      color: "#12364f",
      fontFamily:
        '"Segoe UI", "Yu Gothic UI", "Hiragino Sans", "Meiryo", sans-serif',
      fontWeight: "800",
      lineHeight: "1.28",
      textDecoration: "none",
    },
    ".cm-md-heading-line span": {
      textDecoration: "none !important",
    },
    ".cm-md-heading-1": {
      fontSize: "2em",
      paddingTop: "0.42em",
      paddingBottom: "0.18em",
      borderBottom: "1px solid #d9e2e4",
    },
    ".cm-md-heading-2": {
      fontSize: "1.55em",
      paddingTop: "0.38em",
      paddingBottom: "0.12em",
    },
    ".cm-md-heading-3": {
      fontSize: "1.28em",
      paddingTop: "0.28em",
      paddingBottom: "0.08em",
    },
    ".cm-md-heading-4": {
      fontSize: "1.12em",
      paddingTop: "0.22em",
    },
    ".cm-md-heading-5, .cm-md-heading-6": {
      fontSize: "1em",
      color: "#355467",
      letterSpacing: "0",
      textTransform: "none",
    },
    ".cm-line .cm-strong": {
      fontWeight: "700",
    },
    ".cm-line .cm-emphasis": {
      fontStyle: "italic",
    },
    ".cm-line .cm-link": {
      color: "#0b57d0",
      textDecoration: "underline",
    },
    ".cm-md-clickable-link": {
      color: "#0b57d0 !important",
      cursor: "pointer",
      textDecoration: "underline",
    },
    ".cm-md-clickable-link span": {
      color: "#0b57d0 !important",
      textDecoration: "underline",
    },
    ".cm-md-clickable-link:hover, .cm-md-clickable-link:hover span": {
      color: "#063f9e !important",
    },
    ".cm-line .cm-url": {
      color: "inherit",
    },
    ".cm-line .cm-monospace, .cm-line .cm-inlineCode": {
      fontFamily: '"Cascadia Mono", "Consolas", monospace',
      backgroundColor: "#ece8df",
      borderRadius: "4px",
      padding: "0 3px",
    },
    ".cm-md-list-marker": {
      display: "inline-block",
      minWidth: "1.25em",
      color: "#0f686f",
      fontWeight: "700",
    },
    ".cm-md-task-marker": {
      display: "inline-block",
      width: "0.95em",
      height: "0.95em",
      marginRight: "0.34em",
      transform: "translateY(0.12em)",
      border: "1.5px solid #6f8588",
      borderRadius: "3px",
      backgroundColor: "#fffdf8",
    },
    ".cm-md-task-marker.checked": {
      position: "relative",
      borderColor: "#17726f",
      backgroundColor: "#dff1ed",
    },
    ".cm-md-task-marker.checked::after": {
      content: "''",
      position: "absolute",
      left: "0.22em",
      top: "0.06em",
      width: "0.34em",
      height: "0.56em",
      border: "solid #0d5957",
      borderWidth: "0 2px 2px 0",
      transform: "rotate(42deg)",
    },
    ".cm-md-quote-line": {
      borderLeft: "3px solid #8fb3b5",
      color: "#4a5e62",
      backgroundColor: "#f3f7f6",
    },
    ".cm-md-code-block": {
      position: "relative",
      margin: "0.75em 0 1em",
      border: "1px solid #d9d4ca",
      borderRadius: "8px",
      backgroundColor: "#f1f4f2",
      overflow: "hidden",
      cursor: "text",
    },
    ".cm-md-code-block:focus, .cm-md-table-wrapper:focus, .cm-md-horizontal-rule:focus": {
      outline: "2px solid #79aeb4",
      outlineOffset: "2px",
    },
    ".cm-md-code-language": {
      position: "absolute",
      top: "8px",
      right: "12px",
      color: "#6c7775",
      fontSize: "0.78em",
      fontFamily: '"Cascadia Mono", "Consolas", monospace',
    },
    ".cm-md-code-block pre": {
      margin: "0",
      padding: "18px 20px",
      overflowX: "auto",
      fontFamily: '"Cascadia Mono", "Consolas", monospace',
      fontSize: "0.92em",
      lineHeight: "1.6",
      userSelect: "text",
    },
    ".cm-md-code-block code": {
      userSelect: "text",
    },
    ".cm-md-table-wrapper": {
      width: "fit-content",
      maxWidth: "100%",
      margin: "0.9em 0 1em",
      overflowX: "auto",
      cursor: "text",
    },
    ".cm-md-table-wrapper table": {
      width: "max-content",
      maxWidth: "none",
      borderCollapse: "collapse",
      fontSize: "0.95em",
    },
    ".cm-md-table-wrapper th": {
      backgroundColor: "#edf3f2",
      color: "#263a3d",
      fontWeight: "700",
    },
    ".cm-md-table-wrapper th, .cm-md-table-wrapper td": {
      padding: "7px 10px",
      border: "1px solid #d6ddd9",
      textAlign: "left",
      whiteSpace: "nowrap",
    },
    ".cm-md-horizontal-rule": {
      display: "flex",
      alignItems: "center",
      minHeight: "2.2em",
      margin: "0.45em 0 0.65em",
      cursor: "text",
    },
    ".cm-md-horizontal-rule hr": {
      width: "100%",
      height: "1px",
      margin: "0",
      border: "0",
      backgroundColor: "#c8d8db",
    },
    ".cm-md-image-preview": {
      display: "inline-flex",
      flexDirection: "column",
      gap: "6px",
      maxWidth: "100%",
      margin: "0.5em 0",
    },
    ".cm-md-image-preview img": {
      maxWidth: "100%",
      maxHeight: "420px",
      borderRadius: "6px",
      border: "1px solid #d9d4ca",
    },
    ".cm-md-image-preview figcaption": {
      color: "#637174",
      fontSize: "0.86em",
    },
    ".cm-panels": {
      borderTop: "0",
      borderBottom: "1px solid #d0d8da",
      backgroundColor: "#eef2f4",
      color: "#263233",
      fontFamily:
        '"Segoe UI", "Yu Gothic UI", "Hiragino Sans", "Meiryo", sans-serif',
    },
    ".cm-md-search-panel": {
      display: "grid",
      gap: "6px",
      padding: "8px",
      border: "1px solid #c5d0d3",
      borderRadius: "8px",
      margin: "8px",
      backgroundColor: "#f9fbfb",
      boxShadow: "0 8px 24px rgb(24 43 50 / 10%)",
    },
    ".cm-md-search-row": {
      display: "grid",
      gridTemplateColumns: "34px minmax(180px, 1fr) 34px 34px 34px 34px",
      gap: "6px",
      alignItems: "center",
    },
    ".cm-md-search-input-wrap": {
      position: "relative",
      display: "block",
      minWidth: "0",
    },
    ".cm-md-search-input, .cm-md-replace-input": {
      width: "100%",
      minWidth: "0",
      minHeight: "34px",
      border: "1px solid #c7d3d5",
      borderRadius: "6px",
      padding: "4px 34px 4px 10px",
      backgroundColor: "#ffffff",
      color: "#202d30",
      font: "inherit",
    },
    ".cm-md-search-input:focus, .cm-md-replace-input:focus": {
      borderColor: "#7aa8b0",
      outline: "none",
      boxShadow: "0 0 0 2px rgb(122 168 176 / 22%)",
    },
    ".cm-md-search-input-icon": {
      position: "absolute",
      right: "10px",
      top: "50%",
      transform: "translateY(-50%)",
      color: "#5e7074",
      pointerEvents: "none",
    },
    ".cm-md-search-icon-button, .cm-md-search-command-button, .cm-md-search-toggle": {
      minHeight: "34px",
      border: "1px solid transparent",
      borderRadius: "6px",
      backgroundColor: "#f4f7f6",
      color: "#263233",
      font: "inherit",
    },
    ".cm-md-search-icon-button": {
      width: "34px",
      padding: "0",
      fontSize: "16px",
      lineHeight: "1",
    },
    ".cm-md-search-command-button": {
      minWidth: "86px",
      padding: "0 12px",
    },
    ".cm-md-search-icon-button:hover, .cm-md-search-command-button:hover, .cm-md-search-toggle:hover, .cm-md-search-toggle.active": {
      borderColor: "#bed0d2",
      backgroundColor: "#e7f0f1",
    },
    ".cm-md-search-options": {
      display: "none",
      gap: "6px",
      paddingLeft: "40px",
    },
    ".cm-md-search-options.open": {
      display: "flex",
    },
    ".cm-md-search-toggle": {
      minWidth: "42px",
      padding: "0 8px",
      fontSize: "12px",
    },
    ".cm-md-replace-row": {
      display: "grid",
      gridTemplateColumns: "minmax(180px, 1fr) auto auto",
      gap: "8px",
      paddingLeft: "40px",
    },
    ".cm-md-search-panel[data-mode='search'] .cm-md-replace-row": {
      display: "none",
    },
    "@media (max-width: 760px)": {
      ".cm-md-search-row": {
        gridTemplateColumns: "34px minmax(90px, 1fr) 34px 34px 34px 34px",
      },
      ".cm-md-replace-row": {
        gridTemplateColumns: "minmax(90px, 1fr)",
      },
      ".cm-md-search-command-button": {
        width: "100%",
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
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
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
