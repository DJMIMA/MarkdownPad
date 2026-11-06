import assert from "node:assert/strict";
import test from "node:test";
import {
  associationState,
  extensionAppLabel,
  type FileAssociationStatus,
  unsupportedAssociationStatus,
} from "../src/fileAssociation.ts";

const exePath = "C:\\Tools\\MarkdownPad\\markdownpad.exe";

function status(overrides: Partial<FileAssociationStatus> = {}): FileAssociationStatus {
  return {
    supported: true,
    exePath,
    registeredPath: exePath,
    extensions: [
      { extension: ".md", isDefault: true, defaultApp: "MarkdownPad" },
      { extension: ".markdown", isDefault: true, defaultApp: "MarkdownPad" },
    ],
    ...overrides,
  };
}

test("association state follows registration and default apps", () => {
  assert.equal(associationState(unsupportedAssociationStatus), "unsupported");
  assert.equal(associationState(status({ registeredPath: null })), "unregistered");
  assert.equal(associationState(status()), "default");
  assert.equal(
    associationState(
      status({
        extensions: [
          { extension: ".md", isDefault: true, defaultApp: "MarkdownPad" },
          { extension: ".markdown", isDefault: false, defaultApp: "メモ帳" },
        ],
      }),
    ),
    "registered",
  );
});

test("a registration for a moved exe is reported, ignoring path case", () => {
  assert.equal(
    associationState(status({ registeredPath: "c:/tools/markdownpad/MARKDOWNPAD.EXE" })),
    "default",
  );
  assert.equal(
    associationState(status({ registeredPath: "D:\\Old\\markdownpad.exe" })),
    "moved",
  );
});

test("extension rows name the app that opens them", () => {
  assert.equal(extensionAppLabel({ extension: ".md", isDefault: true, defaultApp: "x" }), "MarkdownPad");
  assert.equal(extensionAppLabel({ extension: ".md", isDefault: false, defaultApp: "メモ帳" }), "メモ帳");
  assert.equal(extensionAppLabel({ extension: ".md", isDefault: false, defaultApp: null }), "なし");
});

test("another copy of MarkdownPad as the default shows where it is", () => {
  assert.equal(
    extensionAppLabel({
      extension: ".md",
      isDefault: false,
      defaultApp: "MarkdownPad",
      defaultPath: "C:\\User\\bin\\markdownpad.exe",
    }),
    "MarkdownPad（C:\\User\\bin\\markdownpad.exe）",
  );
  assert.equal(
    extensionAppLabel({ extension: ".md", isDefault: false, defaultApp: "メモ帳", defaultPath: "C:\\Windows\\notepad.exe" }),
    "メモ帳",
  );
});
