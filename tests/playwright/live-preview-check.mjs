import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.MARKDOWNPAD_URL ?? "http://127.0.0.1:1420";
const outputDir = "output/playwright";
const tableHeavyMarkdown = `# Table cursor check

## 1. BTK阻害薬

| 薬剤 | NCT ID | Phase | 対象 | Sponsor | 状態 | 登録数 |
|---|---|---|---|---|---|---|
| Rilzabrutinib | NCT07086976 | Phase 3 | wAIHA | Sanofi | Recruiting | 90 |
| Zanubrutinib | NCT05922839 | Phase 2 | R/R wAIHA | Chen Miao (中国) | Recruiting | 22 |

## 2. SYK阻害薬

| 薬剤 | NCT ID | Phase | 対象 | Sponsor | 状態 | 登録数 |
|---|---|---|---|---|---|---|
| HMPL-523 | NCT05535933 | Phase 2/3 | wAIHA | Hutchison Medipharma | Recruiting | 110 |

## 3. 抗BAFF-R抗体

| 薬剤 | NCT ID | Phase | 対象 | Sponsor | 状態 | 登録数 |
|---|---|---|---|---|---|---|
| Ianalumab | NCT05648968 | Phase 3 | wAIHA | Novartis | Active | 90 |

## 4. 抗CD19抗体

| 薬剤 | NCT ID | Phase | 対象 | Sponsor | 状態 | 登録数 |
|---|---|---|---|---|---|---|
| Obexelimab | NCT05786573 | Phase 3 | wAIHA | Zenas BioPharma | Active | 134 |

## 5. 抗CD19抗体（その他）

| 薬剤 | NCT ID | Phase | 対象 | Sponsor | 状態 | 登録数 |
|---|---|---|---|---|---|---|
| Tafasitamab | NCT07104565 | Phase 2a | 自己免疫性血球減少 | Incyte | Recruiting | 56 |

## 6. FcRn阻害薬

| 薬剤 | NCT ID | Phase | 対象 | Sponsor | 状態 | 登録数 |
|---|---|---|---|---|---|---|
| Nipocalimab | NCT04119050 | Phase 2/3 | wAIHA | Janssen | Recruiting | 111 |

## 7. TACI-Fc融合蛋白

| 薬剤 | NCT ID | Phase | 対象 | Sponsor | 状態 | 登録数 |
|---|---|---|---|---|---|---|
| Povetacicept | NCT05757570 | Phase 1/2 | wAIHA | Alpine | Active | 30 |

## 8. 補体阻害薬

| 薬剤 | NCT ID | Phase | 対象 | Sponsor | 状態 | 登録数 |
|---|---|---|---|---|---|---|
| Iptacopan | NCT06847607 | 探索的 | R/R AIHA | Bing Han | Not yet recruiting | 20 |

## 9. CAR-T細胞療法

| 薬剤 | NCT ID | Phase | 標的 | Sponsor | 状態 | 登録数 |
|---|---|---|---|---|---|---|
| CNCT19 | NCT06231368 | Phase 1 | CD19 | 中国血液病研究所 | Active | 6 |
`;

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
      tableSizing: (() => {
        const wrapper = document.querySelector(".cm-md-table-wrapper");
        const table = wrapper?.querySelector("table");
        const content = document.querySelector(".cm-content");

        if (!wrapper || !table || !content) {
          return null;
        }

        return {
          wrapperWidth: wrapper.getBoundingClientRect().width,
          tableWidth: table.getBoundingClientRect().width,
          contentWidth: content.getBoundingClientRect().width,
          wrapperScrollWidth: wrapper.scrollWidth,
        };
      })(),
      visibleLines: [...document.querySelectorAll(".cm-content .cm-line")]
        .slice(0, 14)
        .map((line) => line.textContent),
    };
  });
}

async function waitForAnimationFrame(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
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
    assert.ok(metrics.tableSizing);
    assert.ok(
      metrics.tableSizing.tableWidth < metrics.tableSizing.contentWidth * 0.8,
      JSON.stringify(metrics.tableSizing),
    );
    assert.ok(
      metrics.tableSizing.wrapperWidth < metrics.tableSizing.contentWidth * 0.8,
      JSON.stringify(metrics.tableSizing),
    );
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

    const paragraphBox = await page.locator(".cm-content .cm-line").nth(2).boundingBox();
    assert.ok(paragraphBox);
    await page.mouse.move(
      paragraphBox.x + 30,
      paragraphBox.y + paragraphBox.height * 0.5,
    );
    await page.mouse.down();
    await waitForAnimationFrame(page);
    const afterParagraphMouseDown = await page.evaluate(() => ({
      active: document.querySelector(".cm-activeLine")?.textContent,
      selected: window.getSelection()?.toString(),
    }));
    await page.mouse.up();
    assert.match(
      afterParagraphMouseDown.active ?? "",
      /単体の Markdown ファイル/,
    );
    assert.equal(afterParagraphMouseDown.selected, "");

    const afterParagraphClick = await page.evaluate(() => ({
      h1: document.querySelector(".cm-md-heading-1")?.textContent,
      active: document.querySelector(".cm-activeLine")?.textContent,
    }));
    assert.equal(afterParagraphClick.h1, "MarkdownPad");
    assert.match(afterParagraphClick.active ?? "", /単体の Markdown ファイル/);

    const paragraphSelectionBox = await page
      .locator(".cm-content .cm-line")
      .nth(2)
      .boundingBox();
    assert.ok(paragraphSelectionBox);
    await page.mouse.move(
      paragraphSelectionBox.x + 35,
      paragraphSelectionBox.y + paragraphSelectionBox.height * 0.5,
    );
    await page.mouse.down();
    await page.mouse.move(
      paragraphSelectionBox.x + 170,
      paragraphSelectionBox.y + paragraphSelectionBox.height * 0.5,
      {
        steps: 8,
      },
    );
    const afterParagraphPartialSelection = await page.evaluate(() => ({
      selected: window.getSelection()?.toString(),
      active: document.querySelector(".cm-activeLine")?.textContent,
    }));
    await page.mouse.up();
    assert.ok((afterParagraphPartialSelection.selected ?? "").length > 0);
    assert.doesNotMatch(
      afterParagraphPartialSelection.selected ?? "",
      /デスクトップアプリです。$/,
    );
    assert.match(
      afterParagraphPartialSelection.active ?? "",
      /単体の Markdown ファイル/,
    );
    await page.locator(".cm-content .cm-line").nth(2).click();

    await page.locator(".cm-md-heading-2").click();
    const afterHeadingClick = await page.evaluate(() => ({
      h2: document.querySelector(".cm-md-heading-2")?.textContent,
      active: document.querySelector(".cm-activeLine")?.textContent,
      status: [...document.querySelectorAll(".status-bar span")].map(
        (span) => span.textContent,
      ),
    }));
    assert.equal(afterHeadingClick.h2, "## 見出しの確認");
    assert.equal(afterHeadingClick.active, "## 見出しの確認");
    assert.ok(
      Number(/列 (\d+)/.exec(afterHeadingClick.status[1] ?? "")?.[1] ?? 0) > 4,
    );

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
    const codeBlockCodeBox = await page.locator(".cm-md-code-block code").boundingBox();
    assert.ok(codeBlockCodeBox);
    await page.mouse.move(
      codeBlockCodeBox.x + 10,
      codeBlockCodeBox.y + codeBlockCodeBox.height * 0.5,
    );
    await page.mouse.down();
    await page.mouse.move(
      codeBlockCodeBox.x + 170,
      codeBlockCodeBox.y + codeBlockCodeBox.height * 0.5,
      {
        steps: 8,
      },
    );
    const afterCodeBlockDragSelection = await page.evaluate(() => ({
      codeBlockCount: document.querySelectorAll(".cm-md-code-block").length,
      selected: window.getSelection()?.toString(),
    }));
    await page.mouse.up();
    assert.equal(afterCodeBlockDragSelection.codeBlockCount, 1);
    assert.match(
      afterCodeBlockDragSelection.selected ?? "",
      /export interface|title: string/,
    );
    await page.evaluate(() => window.getSelection()?.removeAllRanges());

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

    const codeSourceLineBox = await page
      .locator(".cm-content .cm-line", {
        hasText: "// edited export interface DocumentTab {",
      })
      .boundingBox();
    assert.ok(codeSourceLineBox);
    await page.mouse.click(
      codeSourceLineBox.x + 20,
      codeSourceLineBox.y + codeSourceLineBox.height * 0.9,
    );
    const afterCodeSourceBottomClick = await page.evaluate(() => ({
      codeBlockCount: document.querySelectorAll(".cm-md-code-block").length,
      active: document.querySelector(".cm-activeLine")?.textContent,
      selected: window.getSelection()?.toString(),
    }));
    assert.equal(afterCodeSourceBottomClick.codeBlockCount, 0);
    assert.equal(
      afterCodeSourceBottomClick.active,
      "// edited export interface DocumentTab {",
    );
    assert.equal(afterCodeSourceBottomClick.selected, "");

    await page.locator(".cm-content .cm-line").nth(2).click();
    await page
      .locator(".cm-md-table-wrapper tbody tr")
      .first()
      .locator("td")
      .nth(1)
      .click({
        position: {
          x: 8,
          y: 8,
        },
      });
    const afterTableCellClick = await page.evaluate(() => ({
      tableCount: document.querySelectorAll(".cm-md-table-wrapper").length,
      active: document.querySelector(".cm-activeLine")?.textContent,
    }));
    assert.equal(afterTableCellClick.tableCount, 0);
    assert.equal(
      afterTableCellClick.active,
      "| 見出し | h1 / h2 / h3 を階層表示 |",
    );

    await page.locator(".cm-content .cm-line").nth(2).click();
    await page.locator(".cm-md-table-wrapper th").first().click({
      position: {
        x: 4,
        y: 8,
      },
    });
    const afterTableHeaderClick = await page.evaluate(() => ({
      tableCount: document.querySelectorAll(".cm-md-table-wrapper").length,
      active: document.querySelector(".cm-activeLine")?.textContent,
      sourceLines: [...document.querySelectorAll(".cm-content .cm-line")]
        .map((line) => line.textContent)
        .filter((text) => text.includes("|")),
    }));
    assert.equal(afterTableHeaderClick.tableCount, 0);
    assert.equal(afterTableHeaderClick.active, "| 機能 | 状態 |");
    assert.deepEqual(afterTableHeaderClick.sourceLines, [
      "| 機能 | 状態 |",
      "| --- | --- |",
      "| 見出し | h1 / h2 / h3 を階層表示 |",
      "| 表 | カーソル外では表として表示 |",
    ]);

    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type("編集");
    const afterTableEdit = await page.evaluate(
      () => document.querySelector(".cm-activeLine")?.textContent,
    );
    assert.equal(afterTableEdit, "|編集 機能 | 状態 |");

    const tableSourceLastLineBox = await page
      .locator(".cm-content .cm-line", {
        hasText: "| 表 | カーソル外では表として表示 |",
      })
      .boundingBox();
    assert.ok(tableSourceLastLineBox);
    await page.mouse.click(
      tableSourceLastLineBox.x + 20,
      tableSourceLastLineBox.y + tableSourceLastLineBox.height * 0.9,
    );
    const afterTableSourceBottomClick = await page.evaluate(() => ({
      tableCount: document.querySelectorAll(".cm-md-table-wrapper").length,
      active: document.querySelector(".cm-activeLine")?.textContent,
      selected: window.getSelection()?.toString(),
    }));
    assert.equal(afterTableSourceBottomClick.tableCount, 0);
    assert.equal(
      afterTableSourceBottomClick.active,
      "| 表 | カーソル外では表として表示 |",
    );
    assert.equal(afterTableSourceBottomClick.selected, "");
    assert.deepEqual(consoleErrors, []);

    const tableSelectionPage = await browser.newPage({
      viewport: {
        width: 1000,
        height: 650,
      },
    });
    await tableSelectionPage.goto(baseUrl, {
      waitUntil: "networkidle",
    });
    await tableSelectionPage.waitForSelector(".cm-content");
    await tableSelectionPage.click(".cm-content");
    await tableSelectionPage.keyboard.press("Control+A");
    await tableSelectionPage.keyboard.press("Backspace");
    await tableSelectionPage.keyboard.insertText(
      "Before table\n\n| A | B |\n|---|---|\n| row1 | value1 |\n| row2 | value2 |\n\nAfter table",
    );
    const tableSelectionStartBox = await tableSelectionPage
      .locator(".cm-content .cm-line", {
        hasText: "Before table",
      })
      .boundingBox();
    const tableSelectionEndBox = await tableSelectionPage
      .locator(".cm-content .cm-line", {
        hasText: "After table",
      })
      .boundingBox();
    assert.ok(tableSelectionStartBox);
    assert.ok(tableSelectionEndBox);
    await tableSelectionPage.mouse.move(
      tableSelectionStartBox.x + 10,
      tableSelectionStartBox.y + tableSelectionStartBox.height * 0.5,
    );
    await tableSelectionPage.mouse.down();
    await tableSelectionPage.mouse.move(
      tableSelectionEndBox.x + 80,
      tableSelectionEndBox.y + tableSelectionEndBox.height * 0.5,
      {
        steps: 12,
      },
    );
    const afterTablePartialSelection = await tableSelectionPage.evaluate(() => ({
      tableCount: document.querySelectorAll(".cm-md-table-wrapper").length,
      sourceTableLineCount: document.querySelectorAll(
        ".cm-md-structural-source-line",
      ).length,
      active: document.querySelector(".cm-activeLine")?.textContent,
      selected: window.getSelection()?.toString(),
    }));
    await tableSelectionPage.mouse.up();
    assert.equal(afterTablePartialSelection.tableCount, 1);
    assert.equal(afterTablePartialSelection.sourceTableLineCount, 0);
    assert.equal(afterTablePartialSelection.active, "After table");
    assert.match(afterTablePartialSelection.selected ?? "", /row1\s+value1/);
    assert.match(afterTablePartialSelection.selected ?? "", /row2\s+value2/);

    const tableCellSelectionPage = await browser.newPage({
      viewport: {
        width: 1000,
        height: 650,
      },
    });
    await tableCellSelectionPage.goto(baseUrl, {
      waitUntil: "networkidle",
    });
    await tableCellSelectionPage.waitForSelector(".cm-content");
    await tableCellSelectionPage.click(".cm-content");
    await tableCellSelectionPage.keyboard.press("Control+A");
    await tableCellSelectionPage.keyboard.press("Backspace");
    await tableCellSelectionPage.keyboard.insertText(
      "| A | B |\n|---|---|\n| row1 | value1 |\n| row2 | value2 |\n\nAfter table",
    );
    await tableCellSelectionPage
      .locator(".cm-content .cm-line", {
        hasText: "After table",
      })
      .click();
    const firstCellBox = await tableCellSelectionPage
      .locator(".cm-md-table-wrapper tbody tr")
      .first()
      .locator("td")
      .first()
      .boundingBox();
    const lastCellBox = await tableCellSelectionPage
      .locator(".cm-md-table-wrapper tbody tr")
      .nth(1)
      .locator("td")
      .nth(1)
      .boundingBox();
    assert.ok(firstCellBox);
    assert.ok(lastCellBox);
    await tableCellSelectionPage.mouse.move(
      firstCellBox.x + 8,
      firstCellBox.y + 8,
    );
    await tableCellSelectionPage.mouse.down();
    await tableCellSelectionPage.mouse.move(
      lastCellBox.x + 20,
      lastCellBox.y + 10,
      {
        steps: 8,
      },
    );
    const afterTableCellRangeDrag = await tableCellSelectionPage.evaluate(() => ({
      tableCount: document.querySelectorAll(".cm-md-table-wrapper").length,
      sourceTableLineCount: document.querySelectorAll(
        ".cm-md-structural-source-line",
      ).length,
      selectedCells: document.querySelectorAll(
        ".cm-md-table-cell-selected",
      ).length,
      selected: window.getSelection()?.toString(),
    }));
    await tableCellSelectionPage.mouse.up();
    assert.equal(afterTableCellRangeDrag.tableCount, 1);
    assert.equal(afterTableCellRangeDrag.sourceTableLineCount, 0);
    assert.equal(afterTableCellRangeDrag.selectedCells, 4);
    assert.equal(afterTableCellRangeDrag.selected, "");
    const afterTableCellCopy = await tableCellSelectionPage.evaluate(() => {
      const copied = new Map();
      const event = new Event("copy", {
        bubbles: true,
        cancelable: true,
      });

      Object.defineProperty(event, "clipboardData", {
        value: {
          setData: (type, value) => copied.set(type, value),
          getData: (type) => copied.get(type) ?? "",
        },
      });

      document.activeElement?.dispatchEvent(event);

      return {
        defaultPrevented: event.defaultPrevented,
        text: copied.get("text/plain") ?? "",
      };
    });
    assert.equal(afterTableCellCopy.defaultPrevented, true);
    assert.equal(afterTableCellCopy.text, "row1\tvalue1\nrow2\tvalue2");

    await tableCellSelectionPage.keyboard.press("Backspace");
    const afterTableCellDelete = await tableCellSelectionPage.evaluate(() => ({
      selectedCells: document.querySelectorAll(
        ".cm-md-table-cell-selected",
      ).length,
      sourceLines: [...document.querySelectorAll(".cm-content .cm-line")]
        .map((line) => line.textContent)
        .filter((text) => text.startsWith("|")),
    }));
    assert.equal(afterTableCellDelete.selectedCells, 0);
    assert.deepEqual(afterTableCellDelete.sourceLines.slice(0, 4), [
      "| A | B |",
      "|---|---|",
      "|  |  |",
      "|  |  |",
    ]);

    const tableNavigationPage = await browser.newPage({
      viewport: {
        width: 1280,
        height: 900,
      },
    });
    await tableNavigationPage.goto(baseUrl, {
      waitUntil: "networkidle",
    });
    await tableNavigationPage.waitForSelector(".cm-content");
    await tableNavigationPage.click(".cm-content");
    await tableNavigationPage.keyboard.press("Control+A");
    await tableNavigationPage.keyboard.press("Backspace");
    await tableNavigationPage.keyboard.insertText(tableHeavyMarkdown);
    await tableNavigationPage.keyboard.press("Control+Home");
    await tableNavigationPage
      .locator(".cm-md-heading-2", { hasText: "2. SYK阻害薬" })
      .click({
        position: {
          x: 20,
          y: 20,
        },
      });
    const afterSecondHeadingClick = await tableNavigationPage.evaluate(() => ({
      active: document.querySelector(".cm-activeLine")?.textContent,
      selected: window.getSelection()?.toString(),
      status: [...document.querySelectorAll(".status-bar span")].map(
        (span) => span.textContent,
      ),
    }));
    assert.equal(afterSecondHeadingClick.active, "## 2. SYK阻害薬");
    assert.equal(afterSecondHeadingClick.selected, "");
    assert.match(afterSecondHeadingClick.status[1] ?? "", /^行 10, 列 \d+$/);

    const secondHeadingBox = await tableNavigationPage
      .locator(".cm-md-heading-2", { hasText: "2. SYK阻害薬" })
      .boundingBox();
    assert.ok(secondHeadingBox);
    await tableNavigationPage.mouse.move(
      secondHeadingBox.x + 30,
      secondHeadingBox.y + secondHeadingBox.height + 14,
    );
    await tableNavigationPage.mouse.down();
    await waitForAnimationFrame(tableNavigationPage);
    const afterSecondHeadingBlankMouseDown = await tableNavigationPage.evaluate(() => ({
      active: document.querySelector(".cm-activeLine")?.textContent,
      selected: window.getSelection()?.toString(),
      status: [...document.querySelectorAll(".status-bar span")].map(
        (span) => span.textContent,
      ),
    }));
    await tableNavigationPage.mouse.up();
    const afterSecondHeadingBlankClick = await tableNavigationPage.evaluate(() => ({
      active: document.querySelector(".cm-activeLine")?.textContent,
      selected: window.getSelection()?.toString(),
      status: [...document.querySelectorAll(".status-bar span")].map(
        (span) => span.textContent,
      ),
    }));
    assert.equal(afterSecondHeadingBlankMouseDown.active, "");
    assert.equal(afterSecondHeadingBlankMouseDown.selected, "");
    assert.ok(afterSecondHeadingBlankMouseDown.status.includes("行 11, 列 1"));
    assert.equal(afterSecondHeadingBlankClick.active, "");
    assert.equal(afterSecondHeadingBlankClick.selected, "");
    assert.ok(afterSecondHeadingBlankClick.status.includes("行 11, 列 1"));

    await tableNavigationPage.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await tableNavigationPage.waitForTimeout(100);
    await tableNavigationPage
      .locator(".cm-md-heading-2", { hasText: "9. CAR-T細胞療法" })
      .click({
        position: {
          x: 20,
          y: 20,
        },
      });
    const afterNinthHeadingClick = await tableNavigationPage.evaluate(() => ({
      active: document.querySelector(".cm-activeLine")?.textContent,
      selected: window.getSelection()?.toString(),
    }));
    assert.equal(afterNinthHeadingClick.active, "## 9. CAR-T細胞療法");
    assert.equal(afterNinthHeadingClick.selected, "");

    await tableNavigationPage.keyboard.press("Control+Home");
    await tableNavigationPage.locator(".cm-md-heading-2").first().click({
      position: {
        x: 20,
        y: 20,
      },
    });
    await tableNavigationPage.keyboard.press("ArrowDown");
    await tableNavigationPage.keyboard.press("ArrowDown");
    const afterArrowIntoTable = await tableNavigationPage.evaluate(() => ({
      active: document.querySelector(".cm-activeLine")?.textContent,
      status: [...document.querySelectorAll(".status-bar span")].map(
        (span) => span.textContent,
      ),
    }));
    assert.equal(
      afterArrowIntoTable.active,
      "| 薬剤 | NCT ID | Phase | 対象 | Sponsor | 状態 | 登録数 |",
    );
    assert.ok(afterArrowIntoTable.status.includes("行 5, 列 1"));

    await tableNavigationPage.keyboard.press("ArrowDown");
    await tableNavigationPage.keyboard.press("ArrowDown");
    await tableNavigationPage.keyboard.press("ArrowDown");
    await tableNavigationPage.keyboard.press("ArrowDown");
    await tableNavigationPage.keyboard.press("ArrowUp");
    const afterArrowUpIntoTable = await tableNavigationPage.evaluate(() => ({
      active: document.querySelector(".cm-activeLine")?.textContent,
      status: [...document.querySelectorAll(".status-bar span")].map(
        (span) => span.textContent,
      ),
    }));
    assert.equal(
      afterArrowUpIntoTable.active,
      "| Zanubrutinib | NCT05922839 | Phase 2 | R/R wAIHA | Chen Miao (中国) | Recruiting | 22 |",
    );
    assert.ok(afterArrowUpIntoTable.status.includes("行 8, 列 1"));

    await tableNavigationPage.locator(".cm-content .cm-line").first().click();
    await tableNavigationPage
      .locator(".cm-md-table-wrapper tbody tr")
      .first()
      .locator("td")
      .nth(4)
      .click({
        position: {
          x: 12,
          y: 8,
        },
      });
    const afterTableHeavyCellClick = await tableNavigationPage.evaluate(() => ({
      active: document.querySelector(".cm-activeLine")?.textContent,
      selected: window.getSelection()?.toString(),
      status: [...document.querySelectorAll(".status-bar span")].map(
        (span) => span.textContent,
      ),
    }));
    assert.equal(
      afterTableHeavyCellClick.active,
      "| Rilzabrutinib | NCT07086976 | Phase 3 | wAIHA | Sanofi | Recruiting | 90 |",
    );
    assert.equal(afterTableHeavyCellClick.selected, "");
    assert.match(afterTableHeavyCellClick.status[1] ?? "", /^行 7, 列 5\d$/);

    const heavyTableLastLineBox = await tableNavigationPage
      .locator(".cm-content .cm-line", {
        hasText:
          "| Zanubrutinib | NCT05922839 | Phase 2 | R/R wAIHA | Chen Miao (中国) | Recruiting | 22 |",
      })
      .boundingBox();
    assert.ok(heavyTableLastLineBox);
    await tableNavigationPage.mouse.click(
      heavyTableLastLineBox.x + 20,
      heavyTableLastLineBox.y + heavyTableLastLineBox.height * 0.9,
    );
    const afterHeavyTableLastLineBottomClick = await tableNavigationPage.evaluate(() => ({
      tableCount: document.querySelectorAll(".cm-md-table-wrapper").length,
      sourceTableLineCount: document.querySelectorAll(
        ".cm-md-structural-source-line",
      ).length,
      active: document.querySelector(".cm-activeLine")?.textContent,
      selected: window.getSelection()?.toString(),
      status: [...document.querySelectorAll(".status-bar span")].map(
        (span) => span.textContent,
      ),
    }));
    assert.equal(afterHeavyTableLastLineBottomClick.tableCount, 8);
    assert.equal(afterHeavyTableLastLineBottomClick.sourceTableLineCount, 4);
    assert.equal(
      afterHeavyTableLastLineBottomClick.active,
      "| Zanubrutinib | NCT05922839 | Phase 2 | R/R wAIHA | Chen Miao (中国) | Recruiting | 22 |",
    );
    assert.equal(afterHeavyTableLastLineBottomClick.selected, "");
    assert.ok(afterHeavyTableLastLineBottomClick.status.includes("行 8, 列 4"));

    const noWrapPage = await browser.newPage({
      viewport: {
        width: 1280,
        height: 700,
      },
    });
    await noWrapPage.goto(baseUrl, {
      waitUntil: "networkidle",
    });
    await noWrapPage.waitForSelector(".cm-content");
    await noWrapPage.locator(".menu-root-button", { hasText: "表示" }).click();
    await noWrapPage.locator(".menu-item", { hasText: "右端で折り返す" }).click();
    await noWrapPage.click(".cm-content");
    await noWrapPage.keyboard.press("Control+A");
    await noWrapPage.keyboard.press("Backspace");
    await noWrapPage.keyboard.insertText("長い行 ".repeat(240));
    const noWrapMetrics = await noWrapPage.evaluate(() => {
      const active = document.querySelector(".cm-activeLine");
      const line = document.querySelector(".cm-content .cm-line");
      const content = document.querySelector(".cm-content");

      return {
        activeWidth: active?.getBoundingClientRect().width ?? 0,
        lineScrollWidth: line?.scrollWidth ?? 0,
        contentMaxWidth: content ? getComputedStyle(content).maxWidth : "",
        lineWhiteSpace: line ? getComputedStyle(line).whiteSpace : "",
      };
    });
    assert.equal(noWrapMetrics.contentMaxWidth, "none");
    assert.equal(noWrapMetrics.lineWhiteSpace, "pre");
    assert.ok(noWrapMetrics.activeWidth >= noWrapMetrics.lineScrollWidth);

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
          afterParagraphMouseDown,
          afterCodeBlockClick,
          afterCodeEdit,
          afterTableCellClick,
          afterTableHeaderClick,
          afterTableEdit,
          afterSecondHeadingClick,
          afterSecondHeadingBlankMouseDown,
          afterSecondHeadingBlankClick,
          afterNinthHeadingClick,
          afterArrowIntoTable,
          afterArrowUpIntoTable,
          afterTableHeavyCellClick,
          noWrapMetrics,
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
