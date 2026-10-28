// Regression guard for the native caret after a mouse click. The live-preview
// mouse handlers place the cursor themselves, and CodeMirror only rewrites the
// DOM selection when its cached copy differs. Clearing the DOM selection around
// those dispatches left the focused editor with no native caret, so typing (and
// IME composition in WebView2) did nothing until an arrow key re-synced it, and
// a second click on the same spot let the browser drop the cursor at offset 0.
// Also checks the caret follows the theme token instead of staying black in
// dark mode.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.MARKDOWNPAD_URL ?? "http://127.0.0.1:1420";
const blankUrl = new URL("?blank=1", baseUrl).toString();

const sampleMarkdown = [
  "# 見出し",
  "",
  "本文の一行目です。",
  "",
  "- 項目A",
  "- 項目B",
  "",
  "最後の段落 alpha beta",
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
  await page.waitForTimeout(300);

  const caretInfo = () =>
    page.evaluate(() => {
      const content = document.querySelector(".cm-content");
      const v = content?.cmTile?.root?.view;
      const selection = window.getSelection();
      let domPosition = null;

      if (selection?.rangeCount && content.contains(selection.anchorNode)) {
        try {
          domPosition = v.posAtDOM(selection.anchorNode, selection.anchorOffset);
        } catch {
          domPosition = null;
        }
      }

      return {
        head: v.state.selection.main.head,
        domPosition,
        focused: v.hasFocus,
        doc: v.state.doc.toString(),
      };
    });

  const lineOf = (doc, position) => doc.slice(0, position).split("\n").length;

  // Stay clear of the double-click interval so every click has detail === 1.
  const clickLine = async (text) => {
    const box = await page
      .locator(".cm-content .cm-line", { hasText: text })
      .boundingBox();
    assert.ok(box, `line "${text}" visible`);
    await page.mouse.click(box.x + 40, box.y + box.height / 2);
    await page.waitForTimeout(700);
    return caretInfo();
  };

  for (const text of ["本文の一行目", "項目A", "最後の段落"]) {
    const first = await clickLine(text);
    assert.equal(first.focused, true, `editor focused after clicking "${text}"`);
    assert.equal(
      first.domPosition,
      first.head,
      `DOM caret after clicking "${text}" should sit at the cursor (${first.head})`,
    );

    // The first click may reveal source markers (e.g. "- "), shifting the
    // column by a character, but the cursor must stay on the clicked line.
    const second = await clickLine(text);
    assert.equal(
      lineOf(second.doc, second.head),
      lineOf(first.doc, first.head),
      `clicking "${text}" again moved the cursor to ${second.head}`,
    );
    assert.equal(second.domPosition, second.head);

    await page.keyboard.type("X");
    const typed = await caretInfo();
    assert.equal(
      typed.doc,
      `${second.doc.slice(0, second.head)}X${second.doc.slice(second.head)}`,
      `typing right after clicking "${text}" inserts at the cursor`,
    );
    await page.keyboard.press("Backspace");
  }

  const caretColors = await page.evaluate(() => {
    const content = document.querySelector(".cm-content");
    const read = () => ({
      caret: getComputedStyle(content).caretColor,
      token: getComputedStyle(document.documentElement)
        .getPropertyValue("--mp-ed-cursor")
        .trim(),
    });
    document.documentElement.dataset.theme = "light";
    const light = read();
    document.documentElement.dataset.theme = "dark";
    const dark = read();
    return { light, dark };
  });
  const toRgb = (hex) => {
    const value = Number.parseInt(hex.replace("#", ""), 16);
    return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
  };

  console.log(JSON.stringify(caretColors, null, 2));
  assert.equal(caretColors.light.caret, toRgb(caretColors.light.token));
  assert.equal(caretColors.dark.caret, toRgb(caretColors.dark.token));
  assert.notEqual(caretColors.dark.caret, "rgb(0, 0, 0)");
  assert.deepEqual(consoleErrors, []);
  console.log("PASS: clicks leave a usable native caret that follows the theme");
} finally {
  await browser.close();
}
