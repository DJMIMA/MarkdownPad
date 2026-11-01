import assert from "node:assert/strict";
import test from "node:test";
import { markdown } from "@codemirror/lang-markdown";
import { SearchQuery } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { GFM } from "@lezer/markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import {
  codeBlockModel,
  headingLevelForNode,
  imageParts,
  inlineRuns,
  tableModel,
  isStructuralBlock,
  listMarkerLabel,
  listMarkerWidthEm,
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

test("listMarkerWidthEm reserves a fixed slot for bullets and tasks", () => {
  assert.equal(listMarkerWidthEm("-", false), 1.45);
  assert.equal(listMarkerWidthEm("*", false), 1.45);
  assert.equal(listMarkerWidthEm("-", true), 1.5);
  assert.equal(listMarkerWidthEm("1.", true), 1.5);
});

test("listMarkerWidthEm widens ordered markers with their digit count", () => {
  assert.equal(listMarkerWidthEm("1.", false), 1.7);
  assert.ok(listMarkerWidthEm("10.", false) > listMarkerWidthEm("9.", false));
  assert.ok(listMarkerWidthEm("100)", false) > listMarkerWidthEm("10)", false));
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

function parsedState(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [GFM] })],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

function firstNode(state: EditorState, name: string): SyntaxNode {
  let found: SyntaxNode | null = null;

  syntaxTree(state).iterate({
    enter(node) {
      if (!found && node.name === name) {
        found = node.node;
      }

      return !found;
    },
  });

  assert.ok(found, `no ${name} node`);
  return found;
}

function cellTexts(cells: { runs: { text: string }[] }[]) {
  return cells.map((cell) => cell.runs.map((run) => run.text).join(""));
}

test("tableModel keeps escaped pipes in their cell, counts empty cells and pads rows", () => {
  const state = parsedState(
    "| a | b \\| c | `x \\| y` |\n| :-: | --: | --- |\n| **太字** |  | [l](https://e.com) | extra |\n| 1 |",
  );
  const model = tableModel(state, firstNode(state, "Table"));

  assert.deepEqual(model.alignments, ["center", "right", null]);
  assert.deepEqual(cellTexts(model.header), ["a", "b | c", "x | y"]);
  assert.deepEqual(model.rows.map(cellTexts), [
    ["太字", "", "l"],
    ["1", "", ""],
  ]);
  assert.deepEqual(model.rows[0][0].runs[0].styles, ["strong"]);
  assert.equal(model.rows[0][2].runs[0].url, "https://e.com");
  assert.deepEqual(model.header[2].runs[0].styles, ["code"]);
});

test("inlineRuns hides marks and keeps source offsets for highlighting", () => {
  const doc = "a *b* ~~c~~";
  const runs = inlineRuns(parsedState(doc), 0, doc.length);

  assert.deepEqual(
    runs.map((run) => [run.text, run.styles.join(), doc.slice(run.from, run.to)]),
    [
      ["a ", "", "a "],
      ["b", "em", "b"],
      [" ", "", " "],
      ["c", "del", "c"],
    ],
  );
});

test("codeBlockModel keeps the last line of an unclosed fence", () => {
  const doc = "text\n\n```js\nconst a = 1;\nconst b = 2;";
  const state = parsedState(doc);
  const block = firstNode(state, "FencedCode");
  const model = codeBlockModel(state, block.from, block.to);

  assert.equal(model.language, "js");
  assert.deepEqual(model.lines.map((line) => line.text), ["const a = 1;", "const b = 2;"]);
  assert.equal(doc.slice(model.lines[1].from, model.lines[1].from + 5), "const");
});

test("codeBlockModel drops the closing fence and the list indentation", () => {
  const doc = "- item\n\n  ```\n  code\n  ```\n";
  const state = parsedState(doc);
  const block = firstNode(state, "FencedCode");

  assert.deepEqual(
    codeBlockModel(state, block.from, block.to).lines.map((line) => line.text),
    ["code"],
  );
});

test("imageParts separates the URL from a title and angle brackets", () => {
  const state = parsedState('![猫の写真](<images/cat 1.png> "タイトル")');

  assert.deepEqual(imageParts(state, firstNode(state, "Image")), {
    alt: "猫の写真",
    url: "images/cat 1.png",
  });
});
