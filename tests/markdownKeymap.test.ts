import assert from "node:assert/strict";
import test from "node:test";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState, type Transaction } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import {
  indentListItems,
  isEmptyBlockquoteMarkerLine,
  outdentListItems,
  isPlainListContinuationLine,
  listContinuationIndentForPosition,
} from "../src/editor/markdownKeymap.ts";

function markdownState(doc: string) {
  return EditorState.create({
    doc,
    extensions: [
      markdown({
        addKeymap: false,
        extensions: [GFM],
      }),
    ],
  });
}

test("plain lines inside a list item are treated as continuation paragraphs", () => {
  const state = markdownState("- item\naa");

  assert.equal(isPlainListContinuationLine(state, state.doc.length), true);
});

test("list marker lines are not treated as continuation paragraphs", () => {
  const state = markdownState("- item\n- aa");

  assert.equal(isPlainListContinuationLine(state, state.doc.length), false);
});

test("the first line of a list item is not treated as a continuation paragraph", () => {
  const state = markdownState("- item");

  assert.equal(isPlainListContinuationLine(state, state.doc.length), false);
});

test("empty blockquote marker lines can fall back to normal newlines", () => {
  const state = markdownState(">");

  assert.equal(isEmptyBlockquoteMarkerLine(state, state.doc.length), true);
});

test("blockquotes with content keep markdown continuation behavior", () => {
  const state = markdownState("> quote");

  assert.equal(isEmptyBlockquoteMarkerLine(state, state.doc.length), false);
});

test("continuation paragraph indentation aligns with unordered list content", () => {
  const state = markdownState("- item");

  assert.equal(listContinuationIndentForPosition(state, state.doc.length), "  ");
});

test("continuation paragraph indentation aligns with ordered list content", () => {
  const state = markdownState("10. item");

  assert.equal(listContinuationIndentForPosition(state, state.doc.length), "    ");
});

test("continuation paragraph indentation keeps nested list offset", () => {
  const state = markdownState("  - item");

  assert.equal(listContinuationIndentForPosition(state, state.doc.length), "    ");
});

test("continuation paragraph indentation aligns with task list content", () => {
  const state = markdownState("- [ ] item");

  assert.equal(listContinuationIndentForPosition(state, state.doc.length), "      ");
});

function runCommand(
  command: typeof indentListItems,
  doc: string,
  anchor: number,
  head = anchor,
) {
  let state = EditorState.create({ doc, selection: { anchor, head } });
  const handled = command({
    state,
    dispatch: (transaction: Transaction) => {
      state = transaction.state;
    },
  });

  return { handled, doc: state.doc.toString() };
}

test("Tab nests a list item under the item above it, children included", () => {
  const doc = "- one\n- two\n  - child\n- three";
  const at = doc.indexOf("two");

  assert.deepEqual(runCommand(indentListItems, doc, at), {
    handled: true,
    doc: "- one\n  - two\n    - child\n- three",
  });
});

test("Tab indents ordered items to the parent's text column", () => {
  const doc = "1. one\n2. two";

  assert.equal(runCommand(indentListItems, doc, doc.length).doc, "1. one\n   2. two");
});

test("Tab on the first item keeps the focus but changes nothing", () => {
  assert.deepEqual(runCommand(indentListItems, "- only", 3), {
    handled: true,
    doc: "- only",
  });
});

test("Tab outside a list is left to the default handling", () => {
  assert.equal(runCommand(indentListItems, "plain text", 3).handled, false);
});

test("Shift+Tab moves an item out to its parent's level", () => {
  const doc = "- one\n  - two\n    - child\n- three";

  assert.equal(
    runCommand(outdentListItems, doc, doc.indexOf("two")).doc,
    "- one\n- two\n  - child\n- three",
  );
});

test("Tab indents every selected item once", () => {
  const doc = "- a\n- b\n- c";

  assert.equal(
    runCommand(indentListItems, doc, doc.indexOf("b"), doc.length).doc,
    "- a\n  - b\n  - c",
  );
});
