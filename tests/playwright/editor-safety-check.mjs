// Guards against edits landing in the wrong place: undo history stays with
// its own tab, and a table cell selection never outlives the document it was
// made in (stale offsets used to delete unrelated text, even in another tab).
import assert from "node:assert/strict";
import { launchBrowser } from "./launch.mjs";

const baseUrl = process.env.MARKDOWNPAD_URL ?? "http://127.0.0.1:1420";
const blankUrl = new URL("?blank=1", baseUrl).toString();

const tableMarkdown = [
  "前の段落",
  "",
  "| A | B |",
  "| --- | --- |",
  "| a1 | b1 |",
  "| a2 | b2 |",
  "",
  "後ろの段落テキスト",
].join("\n");

function editorDoc(page) {
  return page.evaluate(
    () => document.querySelector(".cm-content").cmTile.root.view.state.doc.toString(),
  );
}

function tabStates(page) {
  return page.$$eval(".tab-button", (tabs) =>
    tabs.map((tab) => ({
      active: tab.classList.contains("active"),
      dirty: Boolean(tab.querySelector(".is-dirty")),
    })),
  );
}

async function openBlankPage(browser, errors) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.goto(blankUrl, { waitUntil: "networkidle" });
  await page.waitForSelector(".cm-content");
  return page;
}

async function selectFirstRowCells(page, expected = ["a1", "b1"]) {
  const cells = await page.$$(".cm-md-table-wrapper td");
  const first = await cells[0].boundingBox();
  const second = await cells[1].boundingBox();
  await page.mouse.move(first.x + 5, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + 30, first.y + first.height / 2, { steps: 3 });
  await page.mouse.move(second.x + 10, second.y + second.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  assert.deepEqual(
    await page.$$eval(".cm-md-table-cell-selected", (selected) =>
      selected.map((cell) => cell.textContent),
    ),
    expected,
  );
}

const browser = await launchBrowser();
const errors = [];

try {
  // Undo never crosses tabs.
  {
    const page = await openBlankPage(browser, errors);
    await page.click(".cm-content");
    await page.keyboard.insertText("ファイルAの本文");
    await page.waitForTimeout(600);
    await page.click(".new-tab-button");
    await page.waitForTimeout(300);
    await page.click(".cm-content");
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(200);
    assert.equal(await editorDoc(page), "", "Ctrl+Z in a new tab must not bring back another tab's text");
    assert.deepEqual(await tabStates(page), [
      { active: false, dirty: true },
      { active: true, dirty: false },
    ]);

    await page.keyboard.insertText("B");
    await page.waitForTimeout(600);
    await page.click(".tab-button >> nth=0");
    await page.waitForTimeout(300);
    assert.equal(await editorDoc(page), "ファイルAの本文");
    await page.click(".cm-content");
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(200);
    assert.equal(await editorDoc(page), "", "Ctrl+Z undoes the tab's own edit");
    await page.keyboard.press("Control+Shift+z");
    await page.waitForTimeout(200);
    assert.equal(await editorDoc(page), "ファイルAの本文", "redo stays with the tab");
    await page.click(".tab-button >> nth=1");
    await page.waitForTimeout(300);
    assert.equal(await editorDoc(page), "B");
    await page.close();
  }

  // Typing over a cell selection edits the first selected cell only.
  {
    const page = await openBlankPage(browser, errors);
    await page.click(".cm-content");
    await page.keyboard.insertText(tableMarkdown);
    await page.keyboard.press("Control+End");
    await page.waitForTimeout(200);
    await selectFirstRowCells(page);
    await page.keyboard.type("Z");
    await page.waitForTimeout(150);
    assert.equal(await editorDoc(page), tableMarkdown.replace("| a1 |", "| Z |"));
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(150);
    assert.equal(
      await editorDoc(page),
      tableMarkdown.replace("| a1 |", "|  |"),
      "Backspace after typing removes the typed character, not stale cell text",
    );

    // Other shortcuts drop the cell selection and act on the text as usual.
    await page.keyboard.press("Control+End");
    await selectFirstRowCells(page, ["", "b1"]);
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Delete");
    await page.waitForTimeout(150);
    assert.equal(await editorDoc(page), "", "Ctrl+A then Delete clears the whole text");
    await page.close();
  }

  // A cell selection and its menu do not survive a tab switch.
  {
    const page = await openBlankPage(browser, errors);
    await page.click(".cm-content");
    await page.keyboard.insertText(tableMarkdown);
    await page.click(".new-tab-button");
    await page.waitForTimeout(200);
    await page.click(".cm-content");
    const otherText = "別タブの大事な文章です。消えては困る内容。".repeat(4);
    await page.keyboard.insertText(otherText);
    await page.click(".tab-button >> nth=0");
    await page.waitForTimeout(300);
    await page.keyboard.press("Control+End");
    await selectFirstRowCells(page);
    assert.ok(await page.isVisible(".cm-md-table-selection-menu"));
    await page.click(".tab-button >> nth=1");
    await page.waitForTimeout(300);
    assert.equal(await page.$(".cm-md-table-selection-menu"), null, "the cell menu closes on a tab switch");
    await page.keyboard.press("Delete");
    assert.equal(await editorDoc(page), otherText);
    await page.close();
  }

  // Keyboard: F3 steps one match, Up/Down walk through a wrapped paragraph,
  // Tab nests list items and keeps the focus in the editor.
  {
    const page = await openBlankPage(browser, errors);
    await page.click(".cm-content");
    await page.keyboard.insertText("m0 m1 m2 m3 m4");
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("Control+f");
    await page.keyboard.insertText("m");
    const selectedText = () =>
      page.evaluate(() => {
        const view = document.querySelector(".cm-content").cmTile.root.view;
        const { from, to } = view.state.selection.main;
        return view.state.sliceDoc(from, to + 1);
      });
    const found = [];

    for (let index = 0; index < 3; index += 1) {
      await page.keyboard.press("F3");
      found.push(await selectedText());
    }

    assert.deepEqual(found, ["m0", "m1", "m2"], "F3 moves to the next match only");
    await page.keyboard.press("Escape");

    const paragraph = "これは折り返される長い段落です。".repeat(30);
    await page.click(".cm-content");
    await page.keyboard.press("Control+a");
    await page.keyboard.insertText(`${paragraph}\n次の段落`);
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("ArrowDown");
    const afterDown = await page.evaluate(
      () => document.querySelector(".cm-content").cmTile.root.view.state.selection.main.head,
    );
    assert.ok(
      afterDown > 0 && afterDown < paragraph.length,
      `ArrowDown stays inside the wrapped paragraph (got ${afterDown})`,
    );

    await page.keyboard.press("Control+a");
    await page.keyboard.insertText("- 親\n- 子にしたい");
    await page.keyboard.press("Tab");
    assert.equal(await editorDoc(page), "- 親\n  - 子にしたい");
    assert.equal(
      await page.evaluate(() => document.activeElement?.classList.contains("cm-content")),
      true,
      "Tab keeps the focus in the editor",
    );
    await page.keyboard.press("Shift+Tab");
    assert.equal(await editorDoc(page), "- 親\n- 子にしたい");
    await page.close();
  }

  // Edit menu: copy, cut and paste work through the Clipboard API.
  {
    const page = await openBlankPage(browser, errors);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(baseUrl).origin,
    });
    const menu = async (item) => {
      await page.click(".menu-root-button:has-text('編集')");
      await page.click(`.menu-item:has-text('${item}')`);
      await page.waitForTimeout(150);
    };
    await page.click(".cm-content");
    await page.keyboard.insertText("コピー元 / ");
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await menu("コピー");
    await page.keyboard.press("End");
    await menu("貼り付け");
    assert.equal(await editorDoc(page), "コピー元 / コピー元 / ");
    await page.keyboard.press("Control+a");
    await menu("切り取り");
    assert.equal(await editorDoc(page), "");
    await menu("貼り付け");
    assert.equal(await editorDoc(page), "コピー元 / コピー元 / ");
    await page.close();
  }

  // Long documents: the end renders once the background parser gets there,
  // without having to move the caret first.
  {
    const page = await openBlankPage(browser, errors);
    const headingClass = await page.evaluate(async () => {
      const view = document.querySelector(".cm-content").cmTile.root.view;
      const body = Array.from({ length: 6000 }, (_, index) => `- item ${index} **bold** text`);
      const text = `${body.join("\n")}\n\n# 最後の見出し\n\n終わり`;
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      view.dispatch({ changes: { from: 0, insert: text }, selection: { anchor: 0 } });
      view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
      await sleep(1500);
      view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
      await sleep(1500);
      return [...document.querySelectorAll(".cm-line")]
        .find((line) => line.textContent.includes("最後の見出し"))?.className;
    });
    assert.match(headingClass ?? "", /cm-md-heading-1/);
    await page.close();
  }

  assert.deepEqual(errors, []);
  console.log("PASS: undo and table cell selections stay with their own document");
} finally {
  await browser.close();
}
