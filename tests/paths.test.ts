import assert from "node:assert/strict";
import test from "node:test";
import {
  decodePathReference,
  directoryOf,
  fileUrlToPath,
  isAbsolutePath,
  joinPath,
  resolveImageReference,
} from "../src/paths.ts";

test("joinPath resolves relative image references against a Windows folder", () => {
  assert.equal(joinPath("C:\\notes\\daily", "images/a.png"), "C:\\notes\\daily\\images\\a.png");
  assert.equal(joinPath("C:\\notes\\daily", "../shared/./b.png"), "C:\\notes\\shared\\b.png");
  assert.equal(joinPath("C:\\notes", "../../../x.png"), "C:\\x.png");
  assert.equal(joinPath("\\\\server\\share\\notes", "a.png"), "\\\\server\\share\\notes\\a.png");
  assert.equal(joinPath("/home/me/notes", "../pics/c.png"), "/home/me/pics/c.png");
});

test("path helpers recognise absolute paths and folders", () => {
  assert.equal(isAbsolutePath("C:\\a.png"), true);
  assert.equal(isAbsolutePath("D:/a.png"), true);
  assert.equal(isAbsolutePath("/home/a.png"), true);
  assert.equal(isAbsolutePath("images/a.png"), false);
  assert.equal(directoryOf("C:\\notes\\a.md"), "C:\\notes");
  assert.equal(decodePathReference("my%20image.png"), "my image.png");
  assert.equal(decodePathReference("100%.png"), "100%.png");
});

test("fileUrlToPath turns file URLs into paths", () => {
  assert.equal(fileUrlToPath("file:///C:/My%20Notes/a.png"), "C:\\My Notes\\a.png");
  assert.equal(fileUrlToPath("file://server/share/a.png"), "\\\\server\\share\\a.png");
  assert.equal(fileUrlToPath("file:///home/me/a.png"), "/home/me/a.png");
});

test("resolveImageReference keeps web images and drops other schemes outside Tauri", () => {
  assert.equal(resolveImageReference("https://example.com/a.png", null, null), "https://example.com/a.png");
  assert.equal(resolveImageReference("data:image/png;base64,AAAA", null, null), "data:image/png;base64,AAAA");
  assert.equal(resolveImageReference("javascript:alert(1)", null, null), null);
  assert.equal(resolveImageReference("images/a.png", null, null), "images/a.png");
  assert.equal(resolveImageReference("  ", null, null), null);
});

test("resolveImageReference serves local images through the file URL scheme in Tauri", () => {
  const toFileUrl = (path: string) => `asset:${path}`;
  const document = "C:\\notes\\memo.md";

  assert.equal(resolveImageReference("images/my%20cat.png", document, toFileUrl), "asset:C:\\notes\\images\\my cat.png");
  assert.equal(resolveImageReference("D:\\pics\\a.png", document, toFileUrl), "asset:D:\\pics\\a.png");
  assert.equal(resolveImageReference("file:///C:/pics/b.png", document, toFileUrl), "asset:C:\\pics\\b.png");
  assert.equal(resolveImageReference("https://example.com/a.png", document, toFileUrl), "https://example.com/a.png");
  assert.equal(resolveImageReference("javascript:alert(1)", document, toFileUrl), null);
  assert.equal(resolveImageReference("images/a.png", null, toFileUrl), null, "unsaved documents have no folder");
});
