import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.MARKDOWNPAD_URL ?? "http://127.0.0.1:1420";
const outputDir = "output/playwright";

async function collectPreviewMetrics(page) {
  return page.evaluate(() => {
    const pick = (selector) => {
      const element = document.querySelector(selector);

      if (!element) {
        return null;
      }

      return {
        text: element.textContent,
        size: Number.parseFloat(getComputedStyle(element).fontSize),
      };
    };

    return {
      h1: pick(".cm-md-heading-1"),
      h2: pick(".cm-md-heading-2"),
      h3: pick(".cm-md-heading-3"),
      tableCount: document.querySelectorAll(".cm-md-table-wrapper table").length,
      codeBlockCount: document.querySelectorAll(".cm-md-code-block pre").length,
      taskCount: document.querySelectorAll(".cm-md-task-marker").length,
      listMarkerCount: document.querySelectorAll(".cm-md-list-marker").length,
      visibleLines: [...document.querySelectorAll(".cm-content .cm-line")]
        .slice(0, 14)
        .map((line) => line.textContent),
    };
  });
}

async function run() {
  await mkdir(outputDir, {
    recursive: true,
  });

  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
  });

  try {
    const page = await browser.newPage({
      viewport: {
        width: 1280,
        height: 900,
      },
    });
    const consoleErrors = [];

    page.on("console", (message) => {
      if (
        ["error", "warning"].includes(message.type()) &&
        !message.text().includes("React DevTools")
      ) {
        consoleErrors.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

    await page.goto(baseUrl, {
      waitUntil: "networkidle",
    });
    await page.waitForSelector(".cm-md-heading-1");
    await page.screenshot({
      path: `${outputDir}/live-preview-desktop.png`,
      fullPage: true,
    });

    const metrics = await collectPreviewMetrics(page);
    assert.deepEqual(consoleErrors, []);
    assert.ok(metrics.h1 && metrics.h2 && metrics.h3);
    assert.ok(metrics.h1.size > metrics.h2.size);
    assert.ok(metrics.h2.size > metrics.h3.size);
    assert.equal(metrics.h2.text, "見出しの確認");
    assert.equal(metrics.h3.text, "ライブプレビュー");
    assert.equal(metrics.tableCount, 1);
    assert.equal(metrics.codeBlockCount, 1);
    assert.equal(metrics.taskCount, 1);
    assert.equal(metrics.listMarkerCount, 3);
    assert.equal(metrics.visibleLines.includes("## 見出しの確認"), false);

    await page.locator(".cm-content .cm-line").nth(2).click();
    const afterParagraphClick = await page.evaluate(() => ({
      h1: document.querySelector(".cm-md-heading-1")?.textContent,
      active: document.querySelector(".cm-activeLine")?.textContent,
    }));
    assert.equal(afterParagraphClick.h1, "MarkdownPad");
    assert.match(afterParagraphClick.active ?? "", /単体の Markdown ファイル/);

    await page.locator(".cm-md-heading-2").click();
    const afterHeadingClick = await page.evaluate(() => ({
      h2: document.querySelector(".cm-md-heading-2")?.textContent,
      active: document.querySelector(".cm-activeLine")?.textContent,
    }));
    assert.equal(afterHeadingClick.h2, "## 見出しの確認");
    assert.equal(afterHeadingClick.active, "## 見出しの確認");

    await page.locator(".cm-content .cm-line").nth(2).click();
    await page.locator(".cm-md-code-block").click();
    const afterCodeBlockClick = await page.evaluate(() => ({
      codeBlockCount: document.querySelectorAll(".cm-md-code-block").length,
      active: document.querySelector(".cm-activeLine")?.textContent,
      sourceLines: [...document.querySelectorAll(".cm-content .cm-line")]
        .map((line) => line.textContent)
        .filter((text) => text.includes("```") || text.includes("export interface")),
    }));
    assert.equal(afterCodeBlockClick.codeBlockCount, 0);
    assert.equal(afterCodeBlockClick.active, "export interface DocumentTab {");
    assert.deepEqual(afterCodeBlockClick.sourceLines, [
      "```ts",
      "export interface DocumentTab {",
      "```",
    ]);

    await page.keyboard.type("// edited ");
    const afterCodeEdit = await page.evaluate(
      () => document.querySelector(".cm-activeLine")?.textContent,
    );
    assert.equal(afterCodeEdit, "// edited export interface DocumentTab {");

    await page.locator(".cm-content .cm-line").nth(2).click();
    await page.locator(".cm-md-table-wrapper").click();
    const afterTableClick = await page.evaluate(() => ({
      tableCount: document.querySelectorAll(".cm-md-table-wrapper").length,
      active: document.querySelector(".cm-activeLine")?.textContent,
      sourceLines: [...document.querySelectorAll(".cm-content .cm-line")]
        .map((line) => line.textContent)
        .filter((text) => text.includes("|")),
    }));
    assert.equal(afterTableClick.tableCount, 0);
    assert.equal(afterTableClick.active, "| 機能 | 状態 |");
    assert.deepEqual(afterTableClick.sourceLines, [
      "| 機能 | 状態 |",
      "| --- | --- |",
      "| 見出し | h1 / h2 / h3 を階層表示 |",
      "| 表 | カーソル外では表として表示 |",
    ]);

    await page.keyboard.press("ArrowRight");
    await page.keyboard.type("編集");
    const afterTableEdit = await page.evaluate(
      () => document.querySelector(".cm-activeLine")?.textContent,
    );
    assert.equal(afterTableEdit, "|編集 機能 | 状態 |");
    assert.deepEqual(consoleErrors, []);

    const mobilePage = await browser.newPage({
      viewport: {
        width: 390,
        height: 800,
      },
      deviceScaleFactor: 2,
      isMobile: true,
    });
    await mobilePage.goto(baseUrl, {
      waitUntil: "networkidle",
    });
    await mobilePage.waitForSelector(".cm-md-heading-1");
    await mobilePage.screenshot({
      path: `${outputDir}/live-preview-mobile.png`,
      fullPage: true,
    });

    const mobileMetrics = await collectPreviewMetrics(mobilePage);
    assert.equal(mobileMetrics.h2?.text, "見出しの確認");
    assert.equal(mobileMetrics.tableCount, 1);

    console.log(
      JSON.stringify(
        {
          desktop: metrics,
          afterParagraphClick,
          afterHeadingClick,
          afterCodeBlockClick,
          afterCodeEdit,
          afterTableClick,
          afterTableEdit,
          mobile: mobileMetrics,
          screenshots: [
            `${outputDir}/live-preview-desktop.png`,
            `${outputDir}/live-preview-mobile.png`,
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
