import assert from "node:assert/strict";
import test from "node:test";
import {
  countWords,
  defaultEditorSettings,
  isRecoverySnapshot,
  positionToLineColumn,
} from "../src/state.ts";

test("positionToLineColumn clamps offsets and reports 1-based coordinates", () => {
  assert.deepEqual(positionToLineColumn("abc\ndef", -20), {
    line: 1,
    column: 1,
  });
  assert.deepEqual(positionToLineColumn("abc\ndef", 5), {
    line: 2,
    column: 2,
  });
  assert.deepEqual(positionToLineColumn("abc\ndef", 200), {
    line: 2,
    column: 4,
  });
});

test("countWords handles mixed Japanese and latin markdown text", () => {
  assert.equal(countWords("MarkdownPad は軽い editor"), 3);
  assert.equal(countWords(""), 0);
});

test("isRecoverySnapshot accepts the persisted recovery shape", () => {
  assert.equal(
    isRecoverySnapshot({
      version: 1,
      updatedAt: "2026-06-07T00:00:00.000Z",
      activeTabId: null,
      tabs: [],
      settings: defaultEditorSettings,
    }),
    true,
  );

  assert.equal(
    isRecoverySnapshot({
      version: 2,
      tabs: [],
      settings: defaultEditorSettings,
    }),
    false,
  );
});
