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
  highlightSelectionMatches,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  searchKeymap,
} from "@codemirror/search";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
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
  replaceNext: () => void;
  replaceAll: () => void;
  selectAll: () => void;
}

function editorTheme(zoom: number) {
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
      maxWidth: "920px",
      minHeight: "100%",
      padding: "34px 44px 48px",
    },
    ".cm-line": {
      padding: "0 4px",
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
    },
    ".cm-md-table-wrapper": {
      margin: "0.9em 0 1em",
      overflowX: "auto",
      cursor: "text",
    },
    ".cm-md-table-wrapper table": {
      width: "100%",
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
      borderTop: "1px solid #ddd6c8",
      borderBottom: "1px solid #ddd6c8",
      backgroundColor: "#fbfaf7",
      color: "#263233",
      fontFamily:
        '"Segoe UI", "Yu Gothic UI", "Hiragino Sans", "Meiryo", sans-serif',
    },
    ".cm-search": {
      display: "flex",
      flexWrap: "wrap",
      gap: "6px",
      alignItems: "center",
      padding: "8px 12px",
    },
    ".cm-search input": {
      minHeight: "28px",
      border: "1px solid #c9d2d0",
      borderRadius: "5px",
      padding: "3px 7px",
      backgroundColor: "#ffffff",
      color: "#202d30",
    },
    ".cm-search button": {
      minHeight: "28px",
      border: "1px solid #c7d0ce",
      borderRadius: "5px",
      backgroundColor: "#f4f7f6",
      color: "#263233",
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
        openSearchPanel(view);
        view.focus();
      }
    },
    openReplace() {
      const view = viewRef.current;

      if (view) {
        openSearchPanel(view);
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
        drawSelection(),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        markdown({
          addKeymap: false,
          extensions: [GFM],
        }),
        search({
          top: true,
        }),
        highlightSelectionMatches(),
        livePreview,
        highlightActiveLine(),
        scrollListener,
        markdownPadKeymap,
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        wrapCompartment.of(wordWrap ? EditorView.lineWrapping : []),
        themeCompartment.of(editorTheme(zoom)),
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
      effects: themeCompartment.reconfigure(editorTheme(zoom)),
    });
  }, [themeCompartment, zoom]);

  return <div ref={hostRef} className="editor-host" />;
});
