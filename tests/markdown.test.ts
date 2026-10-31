import assert from "node:assert/strict";
import test from "node:test";
import {
  markdownPrintDocument,
  markdownPrintDocumentHtml,
  markdownToSafeHtml,
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

test("task list items print as check boxes", () => {
  const html = markdownToSafeHtml("- [x] 完了\n- [ ] 未完了\n- 普通");

  assert.match(html, /<li class="task-list-item"><span class="task-box checked" aria-hidden="true">☑<\/span> 完了<\/li>/);
  assert.match(html, /<li class="task-list-item"><span class="task-box" aria-hidden="true">☐<\/span> 未完了<\/li>/);
  assert.match(html, /<li>普通<\/li>/);
});

test("printing keeps punctuation as typed", () => {
  assert.match(markdownToSafeHtml('"quote" (c) -- ...'), /&quot;quote&quot; \(c\) -- \.\.\./);
});

test("image sources go through the resolver", () => {
  const html = markdownToSafeHtml("![猫](images/cat.png)\n\n![x](javascript:alert(1))", (source) =>
    source.startsWith("images/") ? `http://asset.localhost/${source}` : null,
  );

  assert.match(html, /<img src="http:\/\/asset\.localhost\/images\/cat\.png" alt="猫">/);
  assert.doesNotMatch(html, /<img src="javascript/);
});
