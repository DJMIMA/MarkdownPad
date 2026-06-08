import assert from "node:assert/strict";
import test from "node:test";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import {
  isEmptyBlockquoteMarkerLine,
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
