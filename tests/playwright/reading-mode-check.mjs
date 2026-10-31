// Reading mode (表示 > リーディングモード, Ctrl+E): the whole document stays
// rendered wherever the user clicks, nothing can be typed or deleted, the mode
// belongs to each tab, and leaving it restores normal live-preview editing.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.MARKDOWNPAD_URL ?? "http://127.0.0.1:1420";
const blankUrl = new URL("?blank=1", baseUrl).toString();

const sampleMarkdown = [
  "# 見出し",
  "",
  "本文の段落 alpha beta",
  "",
  "| 機能 | 状態 |",
  "| --- | --- |",
  "| 表 | needle |",
  "",
  "```ts",
  "const value = 1;",
  "```",
  "",
  "---",
  "",
  ...Array.from({ length: 80 }, (_, index) => `行 ${index + 1} の本文`),
].join("\n");

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
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

  await page.goto(blankUrl, { waitUntil: "networkidle" });
  await page.waitForSelector(".cm-content");
  await page.click(".cm-content");
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText(sampleMarkdown);
  await page.keyboard.press("Control+Home");
  await page.waitForTimeout(300);

  const editorInfo = () =>
    page.evaluate(() => {
      const content = document.querySelector(".cm-content");
      const view = content?.cmTile?.root?.view;

      return {
        doc: view.state.doc.toString(),
        editable: content.getAttribute("contenteditable"),
        reading: !!document.querySelector(".cm-editor.cm-md-reading-mode"),
        tables: document.querySelectorAll(".cm-md-table-wrapper").length,
        codeBlocks: document.querySelectorAll(".cm-md-code-block").length,
        rules: document.querySelectorAll(".cm-md-horizontal-rule").length,
        structuralSourceLines: document.querySelectorAll(
          ".cm-md-structural-source-line",
        ).length,
        headingText:
          document.querySelector(".cm-md-heading-1")?.textContent ?? null,
        statusBar: document.querySelector(".status-bar")?.textContent ?? "",
        scrollTop: view.scrollDOM.scrollTop,
        focused: view.hasFocus,
      };
    });

  const clickCenter = async (selector) => {
    const box = await page.locator(selector).first().boundingBox();
    assert.ok(box, `${selector} visible`);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(700);
  };

  // Ctrl+E enters reading mode and keeps keyboard focus in the editor.
  await page.keyboard.press("Control+E");
  await page.waitForTimeout(200);
  let info = await editorInfo();
  assert.equal(info.reading, true, "Ctrl+E turns reading mode on");
  assert.equal(info.editable, "false", "content is not editable");
  assert.equal(info.focused, true, "the editor keeps the focus");
  assert.match(info.statusBar, /リーディングモード/, "status bar shows the mode");
  // With the cursor on the heading line, the `#` source would show in edit
  // mode; reading mode renders it.
  assert.equal(info.headingText, "見出し", "heading source stays hidden");

  // Clicking the table, the code block and the rule keeps them rendered.
  for (const selector of [
    ".cm-md-table-wrapper td",
    ".cm-md-code-block pre",
    ".cm-md-horizontal-rule",
    ".cm-content .cm-line >> text=本文の段落",
  ]) {
    await clickCenter(selector);
    info = await editorInfo();
    assert.equal(info.tables, 1, `table stays rendered after clicking ${selector}`);
    assert.equal(info.codeBlocks, 1, `code block stays rendered after clicking ${selector}`);
    assert.equal(info.rules, 1, `rule stays rendered after clicking ${selector}`);
    assert.equal(info.structuralSourceLines, 0, `no block source after clicking ${selector}`);
  }

  // Nothing typed, pasted or deleted reaches the document.
  await clickCenter(".cm-content .cm-line >> text=本文の段落");
  await page.keyboard.type("xyz");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Delete");
  await page.keyboard.press("Control+Z");
  await page.keyboard.insertText("inserted");
  await page.waitForTimeout(200);
  info = await editorInfo();
  assert.equal(info.doc, sampleMarkdown, "reading mode never changes the text");

  // Ctrl+H (replace) does nothing in reading mode: not even the search panel.
  await page.keyboard.press("Control+H");
  await page.waitForTimeout(200);
  assert.equal(
    await page.locator(".cm-md-search-panel").count(),
    0,
    "Ctrl+H opens no panel in reading mode",
  );

  // Ctrl+F still searches, with no way into the replace row.
  await page.keyboard.press("Control+F");
  await page.waitForSelector(".cm-md-search-panel");
  assert.equal(
    await page.locator(".cm-md-replace-row").isVisible(),
    false,
    "no replace row in reading mode",
  );
  assert.equal(
    await page.locator(".cm-md-search-mode-toggle").isVisible(),
    false,
    "no replace toggle in reading mode",
  );
  await page.keyboard.insertText("needle");
  await page.waitForTimeout(200);
  assert.ok(
    await page.locator(".cm-md-table-wrapper .cm-searchMatch").count(),
    "search still highlights matches inside the rendered table",
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // Paging keys scroll the document instead of moving a hidden cursor.
  await page.evaluate(() => {
    document.querySelector(".cm-content").cmTile.root.view.scrollDOM.scrollTop = 0;
  });
  await page.keyboard.press("PageDown");
  await page.waitForTimeout(300);
  info = await editorInfo();
  assert.ok(info.scrollTop > 200, `PageDown scrolls (scrollTop ${info.scrollTop})`);
  await page.keyboard.press("Home");
  await page.waitForTimeout(300);
  info = await editorInfo();
  assert.equal(info.scrollTop, 0, "Home scrolls back to the top");

  // Ctrl+E again leaves reading mode; clicking the table reveals its source.
  await page.keyboard.press("Control+E");
  await page.waitForTimeout(200);
  info = await editorInfo();
  assert.equal(info.reading, false, "Ctrl+E turns reading mode off");
  assert.equal(info.editable, "true", "content is editable again");
  assert.doesNotMatch(info.statusBar, /リーディングモード/);
  await clickCenter(".cm-md-table-wrapper td");
  info = await editorInfo();
  assert.ok(info.structuralSourceLines > 0, "editing mode reveals the table source");

  // The 表示 menu offers the toggle with its shortcut and a check mark.
  await page.click(".menu-root-button >> text=表示");
  const menuItem = page.locator(".menu-item", { hasText: "リーディングモード" });
  assert.match(await menuItem.textContent(), /Ctrl\+E/);
  assert.doesNotMatch(await menuItem.textContent(), /✓/);
  await menuItem.click();
  await page.waitForTimeout(200);
  info = await editorInfo();
  assert.equal(info.reading, true, "the menu item turns reading mode on");
  assert.equal(info.structuralSourceLines, 0, "the revealed table renders again");
  await page.click(".menu-root-button >> text=表示");
  assert.match(
    await page.locator(".menu-item", { hasText: "リーディングモード" }).textContent(),
    /✓/,
  );
  await page.keyboard.press("Escape");

  // Reading mode belongs to the tab: a new tab opens in editing mode, and
  // switching tabs switches the mode with them.
  await page.keyboard.press("Control+N");
  await page.waitForTimeout(200);
  info = await editorInfo();
  assert.equal(info.reading, false, "a new tab opens in editing mode");
  await page.keyboard.insertText("second tab");
  await page.waitForTimeout(200);

  const selectTab = async (index) => {
    await page.locator(".tab-button").nth(index).click();
    await page.waitForTimeout(300);
    return editorInfo();
  };

  info = await selectTab(0);
  assert.equal(info.reading, true, "the first tab is still in reading mode");
  assert.equal(info.doc, sampleMarkdown, "the first tab shows its own text");
  assert.match(info.statusBar, /リーディングモード/);

  info = await selectTab(1);
  assert.equal(info.reading, false, "the second tab stays in editing mode");
  assert.equal(info.doc, "second tab", "the second tab shows its own text");
  assert.equal(info.editable, "true");
  assert.doesNotMatch(info.statusBar, /リーディングモード/);
  await page.click(".menu-root-button >> text=表示");
  assert.doesNotMatch(
    await page.locator(".menu-item", { hasText: "リーディングモード" }).textContent(),
    /✓/,
    "the menu check follows the active tab",
  );
  await page.keyboard.press("Escape");

  assert.deepEqual(consoleErrors, []);
  console.log("PASS: reading mode keeps blocks rendered and blocks edits");
} finally {
  await browser.close();
}
