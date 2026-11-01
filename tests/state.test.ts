import assert from "node:assert/strict";
import test from "node:test";
import {
  countWords,
  createUntitledTab,
  defaultEditorSettings,
  isPristineUntitledTab,
  isRecoverySnapshot,
  mergeRecoveredTabs,
  nextUntitledIndex,
  normalizeLineEndings,
  positionToLineColumn,
  snapshotHasUnsavedChanges,
} from "../src/state.ts";
import type { DocumentTab, RecoverySnapshot } from "../src/types.ts";

function fileTab(id: string, path: string | null, dirty = false): DocumentTab {
  return {
    ...createUntitledTab(1),
    id,
    title: path ?? id,
    path,
    content: `${id} text`,
    dirty,
    isUntitled: path === null,
  };
}

function snapshotOf(tabs: DocumentTab[], activeTabId: string | null = null): RecoverySnapshot {
  return {
    version: 1,
    updatedAt: "2026-10-31T00:00:00.000Z",
    activeTabId,
    tabs,
    settings: { ...defaultEditorSettings, zoom: 120 },
  };
}

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

test("createUntitledTab starts with a blank document", () => {
  const tab = createUntitledTab(1);

  assert.equal(tab.title, "無題-1");
  assert.equal(tab.content, "");
  assert.equal(tab.dirty, false);
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

test("isRecoverySnapshot rejects snapshots with malformed tabs", () => {
  const snapshot = snapshotOf([fileTab("a", "C:\\a.md")]);

  assert.equal(isRecoverySnapshot(snapshot), true);
  assert.equal(
    isRecoverySnapshot({ ...snapshot, tabs: [{ id: "a", title: "a" }] }),
    false,
  );
  assert.equal(
    isRecoverySnapshot({
      ...snapshot,
      tabs: [{ ...fileTab("a", null), cursor: undefined }],
    }),
    false,
  );
});

test("normalizeLineEndings keeps the dominant line ending", () => {
  assert.deepEqual(normalizeLineEndings("a\nb"), { content: "a\nb", lineEnding: "lf" });
  assert.deepEqual(normalizeLineEndings("a\r\nb\r\nc"), {
    content: "a\nb\nc",
    lineEnding: "crlf",
  });
  assert.deepEqual(normalizeLineEndings("a\nb\nc\r\nd"), {
    content: "a\nb\nc\nd",
    lineEnding: "lf",
  });
  assert.equal(normalizeLineEndings("a\rb").content, "a\nb");
});

test("nextUntitledIndex reuses the lowest free number", () => {
  const first = createUntitledTab(1);
  const second = { ...createUntitledTab(2) };

  assert.equal(nextUntitledIndex([]), 1);
  assert.equal(nextUntitledIndex([first, second]), 3);
  assert.equal(nextUntitledIndex([second]), 1);
});

test("isPristineUntitledTab is true only for an untouched empty tab", () => {
  const tab = createUntitledTab(1);

  assert.equal(isPristineUntitledTab(tab), true);
  assert.equal(isPristineUntitledTab({ ...tab, content: "x" }), false);
  assert.equal(isPristineUntitledTab({ ...tab, dirty: true }), false);
});

test("snapshotHasUnsavedChanges looks for dirty tabs", () => {
  assert.equal(snapshotHasUnsavedChanges(snapshotOf([fileTab("a", "C:\\a.md")])), false);
  assert.equal(
    snapshotHasUnsavedChanges(snapshotOf([fileTab("a", "C:\\a.md"), fileTab("b", null, true)])),
    true,
  );
});

test("mergeRecoveredTabs combines windows and launch files without duplicates", () => {
  const mainWindow = snapshotOf(
    [fileTab("a", "C:\\a.md"), fileTab("b", "C:\\b.md", true)],
    "b",
  );
  const otherWindow = snapshotOf([
    fileTab("c", null, true),
    fileTab("a2", "C:\\a.md", true),
  ]);
  const launchA = fileTab("launch-a", "C:\\a.md");
  const launchB = fileTab("launch-b", "C:\\b.md");

  const merged = mergeRecoveredTabs([mainWindow, otherWindow], []);
  assert.deepEqual(merged?.tabs.map((tab) => tab.id), ["a2", "b", "c"]);
  assert.equal(merged?.activeTabId, "b");
  assert.equal(merged?.settings.zoom, 120);

  // A launch file replaces a saved recovered copy but never unsaved text.
  const withLaunch = mergeRecoveredTabs([snapshotOf([fileTab("a", "C:\\a.md"), fileTab("b", "C:\\b.md", true)])], [launchA, launchB]);
  assert.deepEqual(withLaunch?.tabs.map((tab) => tab.id), ["launch-a", "b"]);
  assert.equal(withLaunch?.activeTabId, "b");

  assert.equal(mergeRecoveredTabs([], [launchA]), null);
});
