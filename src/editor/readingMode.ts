import {
  Annotation,
  EditorState,
  type Extension,
  Facet,
  Prec,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

// Reading mode shows the whole document rendered, with no Markdown source
// revealed anywhere, and blocks every edit. It reuses the live preview
// rendering instead of a separate renderer, so the look, the scroll position
// and search stay exactly as in the editor.

export const readingModeFacet = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

// Marks the transaction that loads another tab's content into the shared
// editor. That replacement is not a user edit, so reading mode lets it through.
export const externalDocumentSync = Annotation.define<boolean>();

export function isReadingMode(state: EditorState) {
  return state.facet(readingModeFacet);
}

// EditorState.readOnly only stops user input commands; direct dispatches (list
// continuation, table cell deletion and so on) would still change the text.
// This filter drops any document change made while reading mode is on.
export const readingModeChangeGuard = EditorState.transactionFilter.of(
  (transaction) => {
    if (
      transaction.docChanged &&
      isReadingMode(transaction.startState) &&
      isReadingMode(transaction.state) &&
      !transaction.annotation(externalDocumentSync)
    ) {
      return [];
    }

    return transaction;
  },
);

function scrollReadingView(
  view: EditorView,
  update: (scroller: HTMLElement) => { top?: number; left?: number },
) {
  const scroller = view.scrollDOM;
  const { top, left } = update(scroller);

  scroller.scrollTo({
    top: top ?? scroller.scrollTop,
    left: left ?? scroller.scrollLeft,
  });
  return true;
}

function lineStep(view: EditorView) {
  return Math.round(view.defaultLineHeight * 2);
}

function pageStep(view: EditorView) {
  return Math.max(lineStep(view), Math.round(view.scrollDOM.clientHeight * 0.9));
}

// Without a caret the arrow and paging keys would move an invisible cursor;
// in reading mode they scroll the page instead, as in a document viewer.
// Shift variants are left alone so keyboard selection still works.
const readingModeKeymap = Prec.highest(
  keymap.of([
    {
      key: "ArrowDown",
      run: (view) =>
        scrollReadingView(view, (scroller) => ({
          top: scroller.scrollTop + lineStep(view),
        })),
    },
    {
      key: "ArrowUp",
      run: (view) =>
        scrollReadingView(view, (scroller) => ({
          top: scroller.scrollTop - lineStep(view),
        })),
    },
    {
      key: "ArrowRight",
      run: (view) =>
        scrollReadingView(view, (scroller) => ({
          left: scroller.scrollLeft + lineStep(view),
        })),
    },
    {
      key: "ArrowLeft",
      run: (view) =>
        scrollReadingView(view, (scroller) => ({
          left: scroller.scrollLeft - lineStep(view),
        })),
    },
    {
      key: "PageDown",
      run: (view) =>
        scrollReadingView(view, (scroller) => ({
          top: scroller.scrollTop + pageStep(view),
        })),
    },
    {
      key: "PageUp",
      run: (view) =>
        scrollReadingView(view, (scroller) => ({
          top: scroller.scrollTop - pageStep(view),
        })),
    },
    {
      key: "Space",
      run: (view) =>
        scrollReadingView(view, (scroller) => ({
          top: scroller.scrollTop + pageStep(view),
        })),
      shift: (view) =>
        scrollReadingView(view, (scroller) => ({
          top: scroller.scrollTop - pageStep(view),
        })),
    },
    {
      key: "Home",
      run: (view) => scrollReadingView(view, () => ({ top: 0 })),
    },
    {
      key: "Mod-Home",
      run: (view) => scrollReadingView(view, () => ({ top: 0 })),
    },
    {
      key: "End",
      run: (view) =>
        scrollReadingView(view, (scroller) => ({ top: scroller.scrollHeight })),
    },
    {
      key: "Mod-End",
      run: (view) =>
        scrollReadingView(view, (scroller) => ({ top: scroller.scrollHeight })),
    },
  ]),
);

export function readingMode(enabled: boolean): Extension {
  if (!enabled) {
    return [];
  }

  return [
    readingModeFacet.of(true),
    EditorView.editable.of(false),
    EditorState.readOnly.of(true),
    // A non-editable content element is not focusable by default. Keep it
    // focusable so keyboard scrolling, Ctrl+A and Ctrl+C keep working.
    EditorView.contentAttributes.of({
      tabindex: "0",
      "aria-readonly": "true",
    }),
    EditorView.editorAttributes.of({ class: "cm-md-reading-mode" }),
    readingModeKeymap,
  ];
}
