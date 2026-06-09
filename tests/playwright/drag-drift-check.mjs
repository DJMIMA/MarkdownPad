// Regression guard for cursor/mouse drift during drag selection in long,
// table-heavy documents. CodeMirror's posAtCoords resolves a point through the
// height map, which drifts from the real layout once block widgets (tables)
// scroll far enough out of view to fall back to their estimated heights. The
// editor's drag handler therefore must hit-test the real DOM instead, so the
// selection head keeps tracking the pointer no matter how far down you scroll.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.MARKDOWNPAD_URL ?? "http://127.0.0.1:1420";
const blankUrl = new URL("?blank=1", baseUrl).toString();

// Build a tall document: a band of many wide tables (so a large run of blocks
// scrolls out of the measured viewport margin and reverts to estimated
// heights), a block of plainly-labelled text lines in the MIDDLE to drag
// between, then more tables below. The drift in CodeMirror's posAtCoords peaks
// in the middle of the viewport, so the draggable lines must sit there — not
// pinned to the clamped top/bottom edges — for this to be a real test.
const DRAG_LINE_COUNT = 10;

function tableSection(i) {
  return [
    `## ${i}. セクション${i}`,
    "",
    "| 薬剤 | NCT ID | Phase | 対象 | Sponsor | 状態 | 登録数 |",
    "|---|---|---|---|---|---|---|",
    `| Drug${i}A | NCT0${i}000001 | Phase 2 | wAIHA | Sponsor ${i} | Recruiting | ${i * 3} |`,
    `| Drug${i}B | NCT0${i}000002 | Phase 3 | R/R wAIHA | Sponsor ${i} | Active | ${i * 4} |`,
    "",
  ];
}

function buildTallDocument() {
  const sections = [];
  for (let i = 1; i <= 12; i += 1) sections.push(...tableSection(i));
  sections.push("## 注記ブロック");
  sections.push("");
  for (let n = 1; n <= DRAG_LINE_COUNT; n += 1) {
    sections.push(`- 注記テキスト行 DRAGLINE-${String(n).padStart(2, "0")} です。`);
  }
  sections.push("");
  for (let i = 13; i <= 18; i += 1) sections.push(...tableSection(i));
  return sections.join("\n");
}

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
  await page.keyboard.insertText(buildTallDocument());
  await page.waitForTimeout(300);

  // Bring the text band into the rendered viewport (CodeMirror virtualizes, so
  // it is not in the DOM while we are at the top). Jump there via the height map
  // first, then precisely center it via the real DOM. The tables above are now
  // well outside the measured margin and keep their estimated heights, so the
  // height map is offset from the real DOM right where we are about to drag.
  await page.evaluate(() => {
    const content = document.querySelector(".cm-content");
    const v = content?.cmTile?.root?.view;
    const idx = v.state.doc.toString().indexOf("DRAGLINE-05");
    const block = v.lineBlockAt(idx);
    v.scrollDOM.scrollTop = block.top - v.scrollDOM.clientHeight / 2;
  });
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const middle = [...document.querySelectorAll(".cm-content .cm-line")].find(
      (line) => line.textContent.includes("DRAGLINE-05"),
    );
    middle?.scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(300);

  const lineNoAtPoint = (x, y) =>
    page.evaluate(
      ([px, py]) => {
        const content = document.querySelector(".cm-content");
        const v = content?.cmTile?.root?.view ?? null;
        const lineEl = document.elementFromPoint(px, py)?.closest?.(".cm-line");
        if (!v || !lineEl || lineEl.dataset.sourceFrom == null) return null;
        return v.state.doc.lineAt(Number(lineEl.dataset.sourceFrom)).number;
      },
      [x, y],
    );

  const selectionInfo = () =>
    page.evaluate(() => {
      const content = document.querySelector(".cm-content");
      const v = content?.cmTile?.root?.view ?? null;
      const sel = v.state.selection.main;
      return {
        anchorLine: v.state.doc.lineAt(sel.anchor).number,
        headLine: v.state.doc.lineAt(sel.head).number,
        empty: sel.empty,
      };
    });

  const startLine = page.locator(".cm-content .cm-line", {
    hasText: "DRAGLINE-03",
  });
  const endLine = page.locator(".cm-content .cm-line", {
    hasText: "DRAGLINE-07",
  });
  const startBox = await startLine.boundingBox();
  const endBox = await endLine.boundingBox();
  assert.ok(startBox, "start line visible mid-viewport");
  assert.ok(endBox, "end line visible mid-viewport");

  const startX = startBox.x + 30;
  const startY = startBox.y + startBox.height / 2;
  const endX = endBox.x + 60;
  const endY = endBox.y + endBox.height / 2;

  // Ground truth from the real DOM.
  const physStartLine = await lineNoAtPoint(startX, startY);
  const physEndLine = await lineNoAtPoint(endX, endY);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 16 });
  const sel = await selectionInfo();
  await page.mouse.up();

  console.log(JSON.stringify({ physStartLine, physEndLine, sel }, null, 2));

  assert.equal(
    sel.headLine,
    physEndLine,
    `drag head landed on line ${sel.headLine}, but the pointer was over line ${physEndLine}`,
  );
  assert.equal(
    sel.anchorLine,
    physStartLine,
    `drag anchor on line ${sel.anchorLine}, but the pointer started on line ${physStartLine}`,
  );
  assert.equal(sel.empty, false, "drag should produce a non-empty selection");
  assert.deepEqual(consoleErrors, []);
  console.log("PASS: drag selection tracks the pointer with no height-map drift");
} finally {
  await browser.close();
}
