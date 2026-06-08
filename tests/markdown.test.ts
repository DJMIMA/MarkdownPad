import assert from "node:assert/strict";
import test from "node:test";
import {
  markdownPrintDocument,
  markdownPrintDocumentHtml,
} from "../src/markdown.ts";

test("markdownPrintDocument renders explicit links without linkifying bare URLs", () => {
  const document = markdownPrintDocument(
    "Visit https://example.com and [site](https://example.com).",
    "Links",
  );

  assert.match(document.bodyHtml, /Visit https:\/\/example\.com/);
  assert.match(
    document.bodyHtml,
    /<a href="https:\/\/example\.com">site<\/a>/,
  );
  assert.doesNotMatch(
    document.bodyHtml,
    /<a href="https:\/\/example\.com">https:\/\/example\.com<\/a>/,
  );
});

test("markdownPrintDocumentHtml wraps print content in the print document shell", () => {
  const document = markdownPrintDocument("# Title", "A <B>");
  const html = markdownPrintDocumentHtml(document);

  assert.match(html, /<title>A &lt;B&gt;<\/title>/);
  assert.match(html, /<main class="markdown-print-document">/);
  assert.match(html, /<h1>Title<\/h1>/);
});
