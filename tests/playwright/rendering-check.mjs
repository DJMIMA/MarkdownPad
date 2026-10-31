// Rendering of tables, code blocks and images in the live preview: inline
// Markdown and alignment inside table cells, escaped pipes, links in cells,
// unclosed code fences, and images next to the opened file.
import assert from "node:assert/strict";
import { launchBrowser } from "./launch.mjs";
import { installTauriMock } from "./tauri-mock.mjs";

const baseUrl = process.env.MARKDOWNPAD_URL ?? "http://127.0.0.1:1420";
const blankUrl = new URL("?blank=1", baseUrl).toString();

const markdown = [
  "先頭の段落",
  "",
  "| 左 | 中央 | 右 |",
  "| :--- | :---: | ---: |",
  "| **太字** と *斜体* | `a \\| b` | [リンク](https://example.com/table) |",
  "| x \\| y | | 1 | 余分 |",
  "",
  "```js",
  "const a = 1;",
  "const b = 2;",
].join("\n");

const browser = await launchBrowser();
const errors = [];

try {
  {
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(blankUrl, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      window.__openedUrls = [];
      window.open = (url) => {
        window.__openedUrls.push(url);
        return null;
      };
    });
    await page.click(".cm-content");
    await page.keyboard.insertText(markdown);
    await page.keyboard.press("Control+Home");
    await page.waitForTimeout(300);

    const table = await page.evaluate(() => {
      const wrapper = document.querySelector(".cm-md-table-wrapper");
      const cells = [...wrapper.querySelectorAll("tr")].map((row) =>
        [...row.children].map((cell) => ({
          text: cell.textContent,
          align: cell.style.textAlign,
          html: cell.innerHTML,
        })),
      );
      return cells;
    });

    assert.deepEqual(
      table.map((row) => row.map((cell) => cell.text)),
      [
        ["左", "中央", "右"],
        ["太字 と 斜体", "a | b", "リンク"],
        ["x | y", "", "1"],
      ],
      "cells render inline Markdown, keep escaped pipes and follow the header's columns",
    );
    assert.deepEqual(table[1].map((cell) => cell.align), ["left", "center", "right"]);
    assert.match(table[1][0].html, /<strong>太字<\/strong>/);
    assert.match(table[1][0].html, /<em>斜体<\/em>/);
    assert.match(table[1][1].html, /<code class="cm-md-inline-code">/);

    await page.click(".cm-md-table-wrapper [data-markdown-url]");
    await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(() => window.__openedUrls), ["https://example.com/table"]);

    const code = await page.textContent(".cm-md-code-block code");
    assert.equal(code, "const a = 1;\nconst b = 2;", "an unclosed fence keeps its last line");
    await page.close();
  }

  // Inside Tauri, a relative image is loaded from the document's folder.
  {
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    page.on("pageerror", (error) => errors.push(error.message));
    await installTauriMock(page, {
      responses: {
        load_launch_markdown_files: [
          {
            path: "C:\\notes\\memo.md",
            file: {
              title: "memo.md",
              path: "C:\\notes\\memo.md",
              content: "本文\n\n![猫](images/cat%201.png \"タイトル\")\n\n末尾",
              encoding: "utf-8",
              lineEnding: "lf",
              stamp: { modifiedMs: 1, size: 1 },
            },
            error: null,
          },
        ],
        load_recovery_snapshots: [],
      },
    });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForSelector(".cm-md-image-preview img");
    const image = await page.evaluate(() => {
      const img = document.querySelector(".cm-md-image-preview img");
      return { src: img.getAttribute("src"), alt: img.alt };
    });
    assert.deepEqual(image, {
      src: `http://asset.localhost/${encodeURIComponent("C:\\notes\\images\\cat 1.png")}`,
      alt: "猫",
    });
    await page.close();
  }

  assert.deepEqual(errors, []);
  console.log("PASS: tables, code blocks and images render like the Markdown says");
} finally {
  await browser.close();
}
