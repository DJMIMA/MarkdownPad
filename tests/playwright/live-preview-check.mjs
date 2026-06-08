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
      horizontalRuleCount: document.querySelectorAll(".cm-md-horizontal-rule hr").length,
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
    assert.equal(metrics.horizontalRuleCount, 1);
    assert.equal(metrics.taskCount, 1);
    assert.equal(metrics.listMarkerCount, 3);
    assert.ok(
      metrics.visibleLines.includes(
        "• 太字 と 強調 は記号を隠して読みやすく表示します",
      ),
    );
    assert.ok(
      metrics.visibleLines.includes(
        "エスケープした *記号* と ; ^ ＾ は文字として残ります。",
      ),
    );
    assert.equal(metrics.visibleLines.includes("## 見出しの確認"), false);
    assert.equal(metrics.visibleLines.includes("---"), false);

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

    const requestedUrls = [];
    page.context().on("request", (request) => {
      requestedUrls.push(request.url());
    });
    const popupPromise = page.waitForEvent("popup");
    const explicitLink = page.locator('[data-markdown-url="https://example.com"]').first();
    const normalColor = await explicitLink.evaluate(
      (element) => getComputedStyle(element).color,
    );
    await explicitLink.hover();
    const hoverColor = await explicitLink.evaluate(
      (element) => getComputedStyle(element).color,
    );
    assert.notEqual(normalColor, hoverColor);
    await explicitLink.click();
    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded").catch(() => {});
    assert.ok(requestedUrls.includes("https://example.com/"));
    await popup.close();
    assert.deepEqual(consoleErrors, []);

    await page.locator(".cm-content .cm-line").nth(2).click();
    await page.locator(".cm-md-horizontal-rule").click();
    const afterRuleClick = await page.evaluate(() => ({
      horizontalRuleCount: document.querySelectorAll(".cm-md-horizontal-rule").length,
      active: document.querySelector(".cm-activeLine")?.textContent,
    }));
    assert.equal(afterRuleClick.horizontalRuleCount, 0);
    assert.equal(afterRuleClick.active, "---");

    await page.keyboard.type("*");
    const afterRuleEdit = await page.evaluate(
      () => document.querySelector(".cm-activeLine")?.textContent,
    );
    assert.equal(afterRuleEdit, "*---");

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
    assert.equal(mobileMetrics.horizontalRuleCount, 1);

    const plainUrlPage = await browser.newPage({
      viewport: {
        width: 900,
        height: 600,
      },
    });
    await plainUrlPage.goto(baseUrl, {
      waitUntil: "networkidle",
    });
    await plainUrlPage.waitForSelector(".cm-content");
    await plainUrlPage.click(".cm-content");
    await plainUrlPage.keyboard.press("Control+A");
    await plainUrlPage.keyboard.press("Backspace");
    await plainUrlPage.keyboard.type(
      "bare https://example.com?a=1;b=2#x^y stays plain",
    );
    await plainUrlPage.waitForTimeout(100);
    const bareUrlState = await plainUrlPage.evaluate(() => ({
      text: document.querySelector(".cm-content")?.textContent,
      explicitLinks: document.querySelectorAll("[data-markdown-url]").length,
      clickableLinks: document.querySelectorAll(".cm-md-clickable-link").length,
    }));
    assert.match(
      bareUrlState.text ?? "",
      /bare https:\/\/example\.com\?a=1;b=2#x\^y stays plain/,
    );
    assert.equal(bareUrlState.explicitLinks, 0);
    assert.equal(bareUrlState.clickableLinks, 0);

    const shortInputPage = await browser.newPage({
      viewport: {
        width: 900,
        height: 600,
      },
    });
    await shortInputPage.goto(baseUrl, {
      waitUntil: "networkidle",
    });
    await shortInputPage.waitForSelector(".cm-content");

    const shortInputResults = [];

    for (const text of ["a", "aa", "aaa", ";", "^", "＾", "#", ">", "-", "あ"]) {
      await shortInputPage.click(".cm-content");
      await shortInputPage.keyboard.press("Control+A");
      await shortInputPage.keyboard.press("Backspace");
      await shortInputPage.keyboard.type(text);
      await shortInputPage.keyboard.press("Enter");
      await shortInputPage.waitForTimeout(100);
      shortInputResults.push({
        text,
        lines: await shortInputPage.evaluate(() =>
          [...document.querySelectorAll(".cm-content .cm-line")].map(
            (line) => line.textContent,
          ),
        ),
      });
    }

    for (const result of shortInputResults) {
      assert.equal(result.lines[0], result.text);
      assert.equal(result.lines[1], "");
    }

    const listKeyResults = {};

    await shortInputPage.click(".cm-content");
    await shortInputPage.keyboard.press("Control+A");
    await shortInputPage.keyboard.press("Backspace");
    await shortInputPage.keyboard.type("- item");
    await shortInputPage.keyboard.press("Enter");
    await shortInputPage.keyboard.type("a");
    await shortInputPage.waitForTimeout(100);
    listKeyResults.enterCreatesNextItemBefore = await shortInputPage.evaluate(() =>
      [...document.querySelectorAll(".cm-content .cm-line")].map(
        (line) => line.textContent,
      ),
    );
    await shortInputPage.keyboard.press("Enter");
    await shortInputPage.waitForTimeout(100);
    listKeyResults.enterCreatesNextItemAfter = await shortInputPage.evaluate(() =>
      [...document.querySelectorAll(".cm-content .cm-line")].map(
        (line) => line.textContent,
      ),
    );
    await shortInputPage.keyboard.press("Enter");
    await shortInputPage.waitForTimeout(100);
    listKeyResults.emptyItemEnterExits = await shortInputPage.evaluate(() =>
      [...document.querySelectorAll(".cm-content .cm-line")].map(
        (line) => line.textContent,
      ),
    );

    assert.deepEqual(listKeyResults.enterCreatesNextItemBefore.slice(0, 2), [
      "• item",
      "- a",
    ]);
    assert.deepEqual(listKeyResults.enterCreatesNextItemAfter.slice(0, 3), [
      "• item",
      "• a",
      "- ",
    ]);
    assert.deepEqual(listKeyResults.emptyItemEnterExits.slice(0, 3), [
      "• item",
      "• a",
      "",
    ]);

    await shortInputPage.click(".cm-content");
    await shortInputPage.keyboard.press("Control+A");
    await shortInputPage.keyboard.press("Backspace");
    await shortInputPage.keyboard.type("- item");
    await shortInputPage.keyboard.press("Shift+Enter");
    await shortInputPage.keyboard.type("a");
    await shortInputPage.keyboard.press("Enter");
    await shortInputPage.waitForTimeout(100);
    listKeyResults.shiftEnterContinuation = await shortInputPage.evaluate(() =>
      [...document.querySelectorAll(".cm-content .cm-line")].map(
        (line) => line.textContent,
      ),
    );
    assert.deepEqual(listKeyResults.shiftEnterContinuation.slice(0, 3), [
      "• item",
      "  a",
      "",
    ]);

    listKeyResults.pastedContinuationResults = [];

    for (const text of ["a", "aa", ";", "^", "＾", "あ", "ああ"]) {
      await shortInputPage.click(".cm-content");
      await shortInputPage.keyboard.press("Control+A");
      await shortInputPage.keyboard.press("Backspace");
      await shortInputPage.keyboard.insertText(`- item\n  ${text}`);
      await shortInputPage.keyboard.press("End");
      await shortInputPage.keyboard.press("Enter");
      await shortInputPage.waitForTimeout(100);
      listKeyResults.pastedContinuationResults.push({
        text,
        lines: await shortInputPage.evaluate(() =>
          [...document.querySelectorAll(".cm-content .cm-line")].map(
            (line) => line.textContent,
          ),
        ),
      });
    }

    for (const result of listKeyResults.pastedContinuationResults) {
      assert.equal(result.lines[0], "• item");
      assert.equal(result.lines[1], `  ${result.text}`);
      assert.equal(result.lines[2], "");
    }

    console.log(
      JSON.stringify(
        {
          desktop: metrics,
          afterParagraphClick,
          afterHeadingClick,
          afterRuleClick,
          afterRuleEdit,
          afterCodeBlockClick,
          afterCodeEdit,
          afterTableClick,
          afterTableEdit,
          mobile: mobileMetrics,
          bareUrlState,
          shortInputResults,
          listKeyResults,
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
