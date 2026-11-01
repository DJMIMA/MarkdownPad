// Prints the CHANGELOG.md section for a version (the release notes).
// Usage: node scripts/changelog.mjs 0.1.0
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function changelogSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  // The section ends at the next version heading or the link references.
  const end = rest.findIndex((line) => line.startsWith("## [") || /^\[[^\]]+\]: /.test(line));
  return rest
    .slice(0, end < 0 ? rest.length : end)
    .join("\n")
    .trim();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2];
  const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  const notes = changelogSection(changelog, version);
  if (!version || !notes) {
    console.error(`CHANGELOG.md has no section for ${version ?? "(no version given)"}`);
    process.exit(1);
  }
  console.log(notes);
}
