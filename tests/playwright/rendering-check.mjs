// Rendering of tables, code blocks and images in the live preview: inline
// Markdown and alignment inside table cells, escaped pipes, links in cells,
// unclosed code fences, and images next to the opened file.
import assert from "node:assert/strict";
import { launchBrowser } from "./launch.mjs";
import { installTauriMock, tauriCalls } from "./tauri-mock.mjs";

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

  // Inside Tauri, each image the document refers to is made readable on its
  // own (also outside the document's folder) and loaded from there; one that
  // cannot be shown leaves its alt text instead of a broken icon.
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
              content: [
                "本文",
                "",
                '![猫](images/cat%201.png "タイトル")',
                "",
                "![共有](../shared/dog.png)",
                "",
                "![ない画像](missing.png)",
                "",
                "末尾",
              ].join("\n"),
              encoding: "utf-8",
              lineEnding: "lf",
              stamp: { modifiedMs: 1, size: 1 },
            },
            error: null,
          },
        ],
        load_recovery_snapshots: [],
        allow_image_file: {
          byArg: "path",
          values: {
            "C:\\notes\\images\\cat 1.png": "C:\\notes\\images\\cat 1.png",
            "C:\\shared\\dog.png": "C:\\shared\\dog.png",
          },
          otherwise: null,
        },
      },
    });
    // Stand-in for Tauri's asset protocol: serve a 1x1 PNG.
    await page.route("http://asset.localhost/**", (route) =>
      route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          "base64",
        ),
      }),
    );
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForSelector(".cm-md-image-unavailable");
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".cm-md-image-preview img[src]")].every(
        (image) => image.complete,
      ),
    );
    const images = await page.evaluate(() =>
      [...document.querySelectorAll(".cm-md-image-preview")].map((figure) => ({
        src: figure.querySelector("img").getAttribute("src"),
        caption: figure.querySelector("figcaption").textContent,
        unavailable: figure.classList.contains("cm-md-image-unavailable"),
      })),
    );
    const assetUrl = (path) => `http://asset.localhost/${encodeURIComponent(path)}`;
    assert.deepEqual(images, [
      { src: assetUrl("C:\\notes\\images\\cat 1.png"), caption: "猫", unavailable: false },
      { src: assetUrl("C:\\shared\\dog.png"), caption: "共有", unavailable: false },
      { src: null, caption: "ない画像", unavailable: true },
    ]);
    assert.deepEqual(
      (await tauriCalls(page, "allow_image_file")).map((call) => call.path).sort(),
      ["C:\\notes\\images\\cat 1.png", "C:\\notes\\missing.png", "C:\\shared\\dog.png"],
    );
    await page.close();
  }

  assert.deepEqual(errors, []);
  console.log("PASS: tables, code blocks and images render like the Markdown says");
} finally {
  await browser.close();
}
