import assert from "node:assert/strict";
import test from "node:test";
import { isReloadShortcut, shortcutCommandFromEvent } from "../src/menu.ts";

function key(init: Partial<KeyboardEvent>) {
  return {
    key: "",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...init,
  } as KeyboardEvent;
}

test("reload shortcuts are recognised so the app can swallow them", () => {
  assert.equal(isReloadShortcut(key({ key: "F5" })), true);
  assert.equal(isReloadShortcut(key({ key: "F5", ctrlKey: true })), true);
  assert.equal(isReloadShortcut(key({ key: "r", ctrlKey: true })), true);
  assert.equal(isReloadShortcut(key({ key: "R", ctrlKey: true, shiftKey: true })), true);
  assert.equal(isReloadShortcut(key({ key: "r" })), false);
  assert.equal(isReloadShortcut(key({ key: "r", ctrlKey: true, altKey: true })), false);
});

test("F3 and Ctrl+F remain app shortcuts", () => {
  assert.equal(shortcutCommandFromEvent(key({ key: "F3" })), "find-next");
  assert.equal(shortcutCommandFromEvent(key({ key: "F3", shiftKey: true })), "find-previous");
  assert.equal(shortcutCommandFromEvent(key({ key: "f", ctrlKey: true })), "find");
});
