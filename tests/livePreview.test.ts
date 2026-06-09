import assert from "node:assert/strict";
import test from "node:test";
import { markdown } from "@codemirror/lang-markdown";
import { SearchQuery } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import {
  headingLevelForNode,
  isStructuralBlock,
  listMarkerLabel,
  searchMatchRanges,
  shouldHideMarkdownNode,
  splitTextByMatches,
} from "../src/editor/livePreview.ts";

const sampleDocument = [
  "# Title",
  "",
  "| Name | Value |",
  "| ---- | ----- |",
  "| needle | 123 |",
  "",
  "```js",
  "const needle = 1;",
  "```",
  "",
  "plain needle text",
  "",
].join("\n");

function stateFor(doc: string) {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: [GFM] })],
  });
}

function matchTexts(doc: string, query: SearchQuery) {
  const state = stateFor(doc);

  return searchMatchRanges(state, query).map((range) =>
    state.doc.sliceString(range.from, range.to),
  );
}

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

test("searchMatchRanges finds every match across paragraphs, tables, and code", () => {
  const texts = matchTexts(sampleDocument, new SearchQuery({ search: "needle" }));

  // One match in the table cell, one in the code block, one in the paragraph.
  assert.deepEqual(texts, ["needle", "needle", "needle"]);
});

test("searchMatchRanges is case-insensitive by default and respects caseSensitive", () => {
  assert.equal(
    matchTexts(sampleDocument, new SearchQuery({ search: "NEEDLE" })).length,
    3,
  );
  assert.deepEqual(
    matchTexts(
      sampleDocument,
      new SearchQuery({ search: "NEEDLE", caseSensitive: true }),
    ),
    [],
  );
});

test("searchMatchRanges returns nothing for empty or unmatched queries", () => {
  assert.deepEqual(matchTexts(sampleDocument, new SearchQuery({ search: "" })), []);
  assert.deepEqual(
    matchTexts(sampleDocument, new SearchQuery({ search: "zzz-not-here" })),
    [],
  );
});

test("searchMatchRanges supports regular expression queries", () => {
  assert.equal(
    matchTexts(sampleDocument, new SearchQuery({ search: "n.edle", regexp: true }))
      .length,
    3,
  );
});

test("splitTextByMatches highlights matches inside a run of widget text", () => {
  // "needle" sits at document offset 100..106 inside this cell text.
  const segments = splitTextByMatches(
    "a needle here",
    98,
    [{ from: 100, to: 106 }],
    null,
  );

  assert.deepEqual(segments, [
    { text: "a ", match: false, selected: false },
    { text: "needle", match: true, selected: false },
    { text: " here", match: false, selected: false },
  ]);
});

test("splitTextByMatches marks only the active (selected) match", () => {
  const segments = splitTextByMatches(
    "needle and needle",
    0,
    [
      { from: 0, to: 6 },
      { from: 11, to: 17 },
    ],
    { from: 11, to: 17 },
  );

  assert.deepEqual(segments, [
    { text: "needle", match: true, selected: false },
    { text: " and ", match: false, selected: false },
    { text: "needle", match: true, selected: true },
  ]);
});

test("splitTextByMatches clips matches to the text and ignores outside matches", () => {
  // A match that starts before the text only highlights the overlapping part.
  assert.deepEqual(
    splitTextByMatches("needle", 100, [{ from: 98, to: 103 }], null),
    [
      { text: "nee", match: true, selected: false },
      { text: "dle", match: false, selected: false },
    ],
  );

  // A match entirely outside the text leaves it untouched.
  assert.deepEqual(splitTextByMatches("needle", 100, [{ from: 0, to: 5 }], null), [
    { text: "needle", match: false, selected: false },
  ]);

  // No matches at all.
  assert.deepEqual(splitTextByMatches("needle", 100, [], null), [
    { text: "needle", match: false, selected: false },
  ]);
});
