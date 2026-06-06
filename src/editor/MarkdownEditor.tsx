import { useEffect, useMemo, useRef } from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";

interface MarkdownEditorProps {
  value: string;
  wordWrap: boolean;
  zoom: number;
  onChange: (value: string) => void;
  onCursorChange: (cursor: { anchor: number; head: number }) => void;
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
      lineHeight: "1.65",
    },
    ".cm-content": {
      maxWidth: "920px",
      minHeight: "100%",
      padding: "28px 36px 40px",
    },
    ".cm-line": {
      padding: "0 4px",
    },
    ".cm-activeLine": {
      backgroundColor: "#fff3cf",
      outline: "1px solid #eadcae",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#efe7d2",
      color: "#3d4752",
    },
    ".cm-gutters": {
      backgroundColor: "#f1eee7",
      borderRight: "1px solid #ded8ca",
      color: "#7b786f",
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
    },
    ".cm-line .cm-strong": {
      fontWeight: "700",
    },
    ".cm-line .cm-emphasis": {
      fontStyle: "italic",
    },
    ".cm-line .cm-link": {
      color: "#075f6a",
      textDecoration: "underline",
    },
    ".cm-line .cm-url": {
      color: "#586069",
    },
    ".cm-line .cm-monospace": {
      fontFamily: '"Cascadia Mono", "Consolas", monospace',
      backgroundColor: "#efede7",
      borderRadius: "4px",
      padding: "0 3px",
    },
  });
}

export function MarkdownEditor({
  value,
  wordWrap,
  zoom,
  onChange,
  onCursorChange,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onCursorChangeRef = useRef(onCursorChange);
  const syncingValueRef = useRef(false);
  const wrapCompartment = useMemo(() => new Compartment(), []);
  const themeCompartment = useMemo(() => new Compartment(), []);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onCursorChangeRef.current = onCursorChange;
  }, [onCursorChange]);

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

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        markdown(),
        highlightSelectionMatches(),
        highlightActiveLine(),
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
}
