import assert from "node:assert/strict";
import test from "node:test";
import {
  headingLevelForNode,
  isStructuralBlock,
  listMarkerLabel,
  shouldHideMarkdownNode,
} from "../src/editor/livePreview.ts";

test("headingLevelForNode maps ATX heading nodes to display levels", () => {
  assert.equal(headingLevelForNode("ATXHeading1"), 1);
  assert.equal(headingLevelForNode("ATXHeading3"), 3);
  assert.equal(headingLevelForNode("ATXHeading6"), 6);
  assert.equal(headingLevelForNode("SetextHeading1"), null);
});

test("live preview hides source-only markdown marks outside the active range", () => {
  assert.equal(shouldHideMarkdownNode("HeaderMark"), true);
  assert.equal(shouldHideMarkdownNode("QuoteMark"), true);
  assert.equal(shouldHideMarkdownNode("EmphasisMark"), true);
  assert.equal(shouldHideMarkdownNode("LinkMark"), true);
  assert.equal(shouldHideMarkdownNode("URL"), false);
  assert.equal(shouldHideMarkdownNode("Paragraph"), false);
});

test("structural blocks are rendered as preview widgets when inactive", () => {
  assert.equal(isStructuralBlock("FencedCode"), true);
  assert.equal(isStructuralBlock("Table"), true);
  assert.equal(isStructuralBlock("HorizontalRule"), true);
  assert.equal(isStructuralBlock("Blockquote"), false);
});

test("listMarkerLabel keeps ordered markers and normalizes bullets", () => {
  assert.equal(listMarkerLabel("1."), "1.");
  assert.equal(listMarkerLabel("23)"), "23)");
  assert.equal(listMarkerLabel("-"), "•");
});
