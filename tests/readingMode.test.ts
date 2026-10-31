import assert from "node:assert/strict";
import test from "node:test";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { type DecorationSet, EditorView } from "@codemirror/view";
import { GFM } from "@lezer/markdown";
import { livePreview } from "../src/editor/livePreview.ts";
import {
  externalDocumentSync,
  isReadingMode,
  readingMode,
} from "../src/editor/readingMode.ts";
import { menuGroups, shortcutCommandFromEvent } from "../src/menu.ts";
import { defaultEditorSettings } from "../src/state.ts";

const tableDocument = [
  "# Title",
  "",
  "| Name | Value |",
  "| ---- | ----- |",
  "| one | 1 |",
  "",
  "after",
].join("\n");

function stateFor(doc: string, reading: boolean, cursor: number) {
  return EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [
      markdown({ extensions: [GFM] }),
      livePreview,
      readingMode(reading),
    ],
  });
}

function blockWidgetNames(state: EditorState) {
  const names: string[] = [];

  for (const source of state.facet(EditorView.decorations)) {
    if (typeof source === "function") {
      continue;
    }

    (source as DecorationSet).between(0, state.doc.length, (_from, _to, value) => {
      const widget = value.spec.widget as object | undefined;

      if (value.spec.block && widget) {
        names.push(widget.constructor.name);
      }
    });
  }

  return names;
}

test("readingMode is off unless enabled", () => {
  assert.equal(isReadingMode(stateFor("text", false, 0)), false);
  assert.equal(isReadingMode(stateFor("text", true, 0)), true);
  assert.equal(stateFor("text", true, 0).readOnly, true);
});

test("a cursor inside a table reveals its source only outside reading mode", () => {
  const insideTable = tableDocument.indexOf("one");

  assert.deepEqual(blockWidgetNames(stateFor(tableDocument, false, insideTable)), []);
  assert.deepEqual(blockWidgetNames(stateFor(tableDocument, true, insideTable)), [
    "TableWidget",
  ]);
});

test("reading mode drops edits but keeps selection changes", () => {
  const state = stateFor(tableDocument, true, 0);
  const edited = state.update({
    changes: { from: 0, insert: "x" },
    selection: { anchor: 1 },
  }).state;

  assert.equal(edited.doc.toString(), tableDocument);

  const selected = state.update({ selection: { anchor: 5 } }).state;

  assert.equal(selected.selection.main.head, 5);
});

test("reading mode lets another tab's content be loaded", () => {
  const state = stateFor(tableDocument, true, 0);
  const loaded = state.update({
    changes: { from: 0, to: state.doc.length, insert: "other tab" },
    annotations: externalDocumentSync.of(true),
  }).state;

  assert.equal(loaded.doc.toString(), "other tab");
});

test("edits are allowed again outside reading mode", () => {
  const state = stateFor("text", false, 0);
  const edited = state.update({ changes: { from: 0, insert: "x" } }).state;

  assert.equal(edited.doc.toString(), "xtext");
});

test("the View menu lists reading mode as a Ctrl+E toggle", () => {
  const view = menuGroups(defaultEditorSettings, { readingMode: true }).find(
    (group) => group.id === "view",
  );
  const item = view?.items.find((entry) => entry.action === "toggle-reading-mode");

  assert.equal(item?.label, "リーディングモード");
  assert.equal(item?.shortcut, "Ctrl+E");
  assert.equal(item?.checked, true);
  assert.deepEqual(
    view?.items.map((entry) => entry.action),
    [
      "zoom-in",
      "zoom-out",
      "zoom-reset",
      "toggle-reading-mode",
      "toggle-word-wrap",
      "toggle-status-bar",
    ],
  );
  assert.equal(
    menuGroups(defaultEditorSettings)
      .find((group) => group.id === "view")
      ?.items.find((entry) => entry.action === "toggle-reading-mode")?.checked,
    false,
  );
});

test("Ctrl+E toggles reading mode; Ctrl+Shift+E does nothing", () => {
  const key = (init: Partial<KeyboardEvent>) =>
    ({
      key: "e",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      ...init,
    }) as KeyboardEvent;

  assert.equal(shortcutCommandFromEvent(key({ ctrlKey: true })), "toggle-reading-mode");
  assert.equal(shortcutCommandFromEvent(key({ ctrlKey: true, key: "E" })), "toggle-reading-mode");
  assert.equal(shortcutCommandFromEvent(key({ ctrlKey: true, shiftKey: true })), null);
  assert.equal(shortcutCommandFromEvent(key({})), null);
});
