import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { changelogSection } from "../scripts/changelog.mjs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const packageVersion: string = JSON.parse(read("package.json")).version;

test("version is the same in package.json, tauri.conf.json and Cargo.toml", () => {
  const tauriVersion = JSON.parse(read("src-tauri/tauri.conf.json")).version;
  const cargoVersion = read("src-tauri/Cargo.toml").match(/^version = "([^"]+)"/m)?.[1];
  const lockVersion = read("src-tauri/Cargo.lock").match(
    /name = "markdownpad"\r?\nversion = "([^"]+)"/,
  )?.[1];

  assert.equal(tauriVersion, packageVersion);
  assert.equal(cargoVersion, packageVersion);
  assert.equal(lockVersion, packageVersion);
});

test("CHANGELOG.md has a dated section for the current version", () => {
  const changelog = read("CHANGELOG.md");
  const escaped = packageVersion.replaceAll(".", "\\.");
  assert.match(changelog, new RegExp(`^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m"));
  assert.notEqual(changelogSection(changelog, packageVersion), "");
});

test("changelogSection stops at the next version and the link references", () => {
  const changelog = [
    "## [Unreleased]",
    "",
    "## [0.2.0] - 2026-12-01",
    "",
    "- New",
    "",
    "## [0.1.0] - 2026-11-01",
    "",
    "- First",
    "",
    "[0.1.0]: https://example.com",
  ].join("\n");
  assert.equal(changelogSection(changelog, "0.2.0"), "- New");
  assert.equal(changelogSection(changelog, "0.1.0"), "- First");
  assert.equal(changelogSection(changelog, "0.3.0"), "");
});
