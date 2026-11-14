// Writes the licenses of the npm packages and Rust crates built into the
// app, which the release zip / tar.gz ships next to it as
// THIRD-PARTY-NOTICES.txt.
// Usage: node scripts/third-party-notices.mjs <output file> [target triple]
// The target triple (x86_64-pc-windows-msvc by default) picks the crates
// that build for that OS. The Windows file uses CRLF line endings.
// The Rust part needs cargo-about (cargo install cargo-about --locked).
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = process.argv[2];
const target = process.argv[3] ?? "x86_64-pc-windows-msvc";
if (!output) {
  console.error("Usage: node scripts/third-party-notices.mjs <output file> [target triple]");
  process.exit(1);
}

function licenseFile(dir, license) {
  const files = readdirSync(dir).filter((name) => /^(licen[cs]e|copying)/i.test(name));
  // A dual-licensed package (MIT OR Apache-2.0) is used under MIT, like
  // the crates in src-tauri/about.toml.
  const mit = /\bMIT\b/.test(license) && files.find((name) => /mit/i.test(name));
  const file = mit || files.find((name) => !/\.spdx$/i.test(name));
  if (!file) {
    throw new Error(`No license file in ${dir}`);
  }
  return readFileSync(`${dir}/${file}`, "utf8").trim();
}

function npmNotices() {
  const lock = JSON.parse(readFileSync(`${root}/package-lock.json`, "utf8"));
  return Object.entries(lock.packages)
    .filter(([path, info]) => path !== "" && !info.dev)
    .map(([path, info]) => ({ name: path.replace(/^.*node_modules\//, ""), path, info }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ name, path, info }) =>
      [
        "-".repeat(80),
        `${name} ${info.version} (${info.license})`,
        `https://www.npmjs.com/package/${name}/v/${info.version}`,
        "",
        licenseFile(`${root}/${path}`, info.license),
        "",
      ].join("\n"),
    )
    .join("\n");
}

function rustNotices() {
  return execFileSync(
    "cargo",
    [
      "about",
      "generate",
      "--locked",
      "--fail",
      "--target",
      target,
      "-c",
      "about.toml",
      "about.hbs",
    ],
    { cwd: `${root}/src-tauri`, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  ).trim();
}

const notices = [
  "MarkdownPad includes the following third-party software.",
  "Each is listed with its license and the page its source code is available from.",
  "",
  "=".repeat(80),
  "npm packages",
  "=".repeat(80),
  npmNotices(),
  "=".repeat(80),
  "Rust crates",
  "=".repeat(80),
  rustNotices(),
  "",
].join("\n");

const lf = notices.replace(/\r\n/g, "\n");
writeFileSync(output, target.includes("windows") ? lf.replace(/\n/g, "\r\n") : lf);
console.log(`Wrote ${output}`);
