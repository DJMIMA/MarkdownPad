// File and recovery flows as they run inside Tauri, against a scripted IPC
// mock: restoring snapshots left by several windows, keeping them when the
// window closes before the user answers, conflicts with changes made by other
// programs, text the file's encoding cannot hold, and failures being shown
// instead of swallowed.
import assert from "node:assert/strict";
import { launchBrowser } from "./launch.mjs";
import { installTauriMock, setTauriResponse, tauriCalls } from "./tauri-mock.mjs";

const baseUrl = process.env.MARKDOWNPAD_URL ?? "http://127.0.0.1:1420";

const settings = { zoom: 100, wordWrap: true, showStatusBar: true };

function tab(id, overrides = {}) {
  return {
    id,
    title: `${id}.md`,
    path: `C:\\notes\\${id}.md`,
    content: `# ${id}`,
    dirty: false,
    cursor: { anchor: 0, head: 0 },
    scroll: { x: 0, y: 0 },
    isUntitled: false,
    encoding: "utf-8",
    lineEnding: "lf",
    diskStamp: { modifiedMs: 1, size: 3 },
    ...overrides,
  };
}

function snapshot(tabs, activeTabId = null) {
  return {
    version: 1,
    updatedAt: "2026-10-31T00:00:00.000Z",
    activeTabId,
    tabs,
    settings,
  };
}

const openedFile = {
  title: "memo.md",
  path: "C:\\notes\\memo.md",
  content: "# メモ\n\n本文",
  encoding: "shift_jis",
  lineEnding: "crlf",
  stamp: { modifiedMs: 10, size: 20 },
};

async function openApp(browser, responses, errors) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  await installTauriMock(page, { responses });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector(".cm-content");
  return page;
}

async function dialogText(page) {
  await page.waitForSelector("[role=dialog]");
  return page.textContent("[role=dialog] p");
}

function tabTitles(page) {
  return page.$$eval(".tab-title", (titles) => titles.map((title) => title.textContent));
}

const browser = await launchBrowser();
const errors = [];

try {
  // Snapshots from two windows are offered together and merged on restore.
  {
    const page = await openApp(
      browser,
      {
        load_launch_markdown_files: [],
        load_recovery_snapshots: [
          {
            id: "main.json",
            fromPreviousSession: true,
            snapshot: snapshot([tab("a"), tab("u", { path: null, title: "無題-1", content: "未保存", dirty: true, isUntitled: true })], "u"),
          },
          {
            id: "markdownpad-1.json",
            fromPreviousSession: true,
            snapshot: snapshot([tab("b", { content: "# b 編集中", dirty: true })]),
          },
          { id: "broken.json", fromPreviousSession: true, snapshot: null },
        ],
        reload_markdown_file: { ...openedFile, title: "a.md", path: "C:\\notes\\a.md", content: "# a ディスク上の新しい内容" },
      },
      errors,
    );

    assert.equal(await dialogText(page), "前回アプリが異常終了しています。復元しますか？");
    await page.click("[role=dialog] button:has-text('はい')");
    await page.waitForSelector("[role=dialog]", { state: "detached" });
    assert.deepEqual(await tabTitles(page), ["a.md", "無題-1", "b.md"]);
    assert.deepEqual(await tauriCalls(page, "discard_recovery_snapshots"), [
      { ids: ["main.json", "markdownpad-1.json", "broken.json"] },
    ]);
    // Saved tabs are read from disk again; unsaved ones keep their text.
    assert.deepEqual(await tauriCalls(page, "reload_markdown_file"), [{ path: "C:\\notes\\a.md" }]);
    const restored = await tauriCalls(page, "save_recovery_snapshot");
    assert.equal(restored.length, 1, "the restored session is written right away");
    assert.equal(restored[0].snapshot.tabs[0].content, "# a ディスク上の新しい内容");
    assert.equal(restored[0].snapshot.tabs[2].content, "# b 編集中");
    await page.close();
  }

  // Closing the window before answering keeps the snapshots.
  {
    const page = await openApp(
      browser,
      {
        load_launch_markdown_files: [],
        load_recovery_snapshots: [
          { id: "main.json", fromPreviousSession: true, snapshot: snapshot([tab("a", { dirty: true })]) },
        ],
      },
      errors,
    );

    await dialogText(page);
    await page.evaluate(() => window.__tauriMock.emit("tauri://close-requested", null));
    await page.waitForTimeout(200);
    assert.equal((await tauriCalls(page, "plugin:window|destroy")).length, 1);
    assert.deepEqual(await tauriCalls(page, "discard_recovery_snapshot"), []);
    assert.deepEqual(await tauriCalls(page, "discard_recovery_snapshots"), []);
    await page.close();
  }

  // Snapshots without unsaved text are removed without asking; files that
  // could not be opened at launch are reported.
  {
    const page = await openApp(
      browser,
      {
        load_launch_markdown_files: [
          { path: "C:\\notes\\memo.md", file: openedFile, error: null },
          { path: "C:\\notes\\sjis.md", file: null, error: "sjis.md を開けませんでした。" },
        ],
        load_recovery_snapshots: [
          { id: "main.json", fromPreviousSession: true, snapshot: snapshot([tab("a")]) },
        ],
      },
      errors,
    );

    assert.equal(await dialogText(page), "sjis.md を開けませんでした。");
    await page.click("[role=dialog] button:has-text('OK')");
    assert.deepEqual(await tauriCalls(page, "discard_recovery_snapshots"), [{ ids: ["main.json"] }]);
    assert.deepEqual(await tabTitles(page), ["memo.md"]);
    const status = await page.textContent(".status-bar");
    assert.match(status, /Shift_JIS/);
    assert.match(status, /CRLF/);
    await page.close();
  }

  // Saving: conflicts, unencodable text, and failures.
  {
    const page = await openApp(
      browser,
      {
        load_launch_markdown_files: [],
        load_recovery_snapshots: [],
        open_markdown_file_dialog: openedFile,
        save_markdown_file: {
          sequence: [
            { status: "conflict" },
            { status: "saved", stamp: { modifiedMs: 11, size: 21 } },
          ],
        },
      },
      errors,
    );

    await page.keyboard.press("Control+o");
    await page.waitForTimeout(200);
    assert.deepEqual(await tabTitles(page), ["memo.md"], "the open file replaces the untouched new tab");
    await page.click(".cm-content");
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("追記");
    await page.keyboard.press("Control+s");
    assert.match(await dialogText(page), /ほかのアプリで変更されています/);
    await page.click("[role=dialog] button:has-text('上書き保存')");
    await page.waitForSelector("[role=dialog]", { state: "detached" });
    const saves = await tauriCalls(page, "save_markdown_file");
    assert.equal(saves.length, 2);
    assert.equal(saves[0].overwrite, false);
    assert.deepEqual(saves[0].expectedStamp, { modifiedMs: 10, size: 20 });
    assert.equal(saves[0].encoding, "shift_jis");
    assert.equal(saves[0].lineEnding, "crlf");
    assert.equal(saves[0].content, "# メモ\n\n本文追記");
    assert.equal(saves[1].overwrite, true);
    assert.equal(await page.$(".close-tab.is-dirty"), null);

    // Shift_JIS cannot hold the emoji: offer UTF-8 instead.
    await setTauriResponse(page, "save_markdown_file", {
      sequence: [{ status: "unencodable" }, { status: "saved", stamp: { modifiedMs: 12, size: 30 } }],
    });
    await page.keyboard.insertText("😀");
    await page.keyboard.press("Control+s");
    assert.match(await dialogText(page), /Shift_JIS で保存できない文字/);
    await page.click("[role=dialog] button:has-text('UTF-8 で保存')");
    await page.waitForSelector("[role=dialog]", { state: "detached" });
    const retried = (await tauriCalls(page, "save_markdown_file")).at(-1);
    assert.equal(retried.encoding, "utf-8");
    assert.match(await page.textContent(".status-bar"), /UTF-8/);

    // A failed write is reported and the tab stays unsaved.
    await setTauriResponse(page, "save_markdown_file", { error: "memo.md を保存できませんでした。\nAccess is denied." });
    await page.keyboard.insertText("!");
    await page.keyboard.press("Control+s");
    assert.match(await dialogText(page), /保存できませんでした/);
    await page.click("[role=dialog] button:has-text('OK')");
    assert.notEqual(await page.$(".close-tab.is-dirty"), null);

    // A conflict can also be resolved by reloading the file.
    await setTauriResponse(page, "save_markdown_file", { status: "conflict" });
    await setTauriResponse(page, "reload_markdown_file", { ...openedFile, content: "# 外部で変更", encoding: "utf-8", lineEnding: "lf" });
    await page.keyboard.press("Control+s");
    await dialogText(page);
    await page.click("[role=dialog] button:has-text('再読み込み')");
    await page.waitForTimeout(200);
    assert.equal(
      await page.evaluate(() => document.querySelector(".cm-content").cmTile.root.view.state.doc.toString()),
      "# 外部で変更",
    );
    assert.equal(await page.$(".close-tab.is-dirty"), null);
    await page.close();
  }

  // Files from a second launch: opened, or their failure reported.
  {
    const page = await openApp(
      browser,
      {
        load_launch_markdown_files: [],
        load_recovery_snapshots: [],
        take_pending_open_files: [
          { path: "C:\\notes\\memo.md", file: openedFile, error: null },
          { path: "C:\\notes\\gone.md", file: null, error: "ファイルが見つかりません。\nC:\\notes\\gone.md" },
        ],
      },
      errors,
    );

    await page.evaluate(() => window.__tauriMock.emit("open-files-requested", null));
    assert.match(await dialogText(page), /ファイルが見つかりません/);
    assert.deepEqual(await tabTitles(page), ["memo.md"]);
    await page.close();
  }

  // Quit asks the Rust side to close every window; a window that is kept
  // open (Cancel) stops the quit.
  {
    const page = await openApp(
      browser,
      { load_launch_markdown_files: [], load_recovery_snapshots: [] },
      errors,
    );

    await page.evaluate(() => window.__tauriMock.emit("menu-action", "quit"));
    await page.waitForTimeout(100);
    assert.equal((await tauriCalls(page, "request_quit")).length, 1);

    await page.click(".cm-content");
    await page.keyboard.insertText("未保存");
    await page.evaluate(() => window.__tauriMock.emit("quit-requested", null));
    await dialogText(page);

    // The keyboard stays on the dialog's buttons.
    for (let index = 0; index < 5; index += 1) {
      await page.keyboard.press("Tab");
    }
    assert.equal(
      await page.evaluate(() => Boolean(document.activeElement?.closest("[role=dialog]"))),
      true,
    );

    await page.click("[role=dialog] button:has-text('キャンセル')");
    await page.waitForTimeout(100);
    assert.equal((await tauriCalls(page, "cancel_quit")).length, 1);
    assert.equal((await tauriCalls(page, "plugin:window|destroy")).length, 0);

    await page.evaluate(() => window.__tauriMock.emit("quit-requested", null));
    await dialogText(page);
    await page.click("[role=dialog] button:has-text('保存しない')");
    await page.waitForTimeout(100);
    assert.equal((await tauriCalls(page, "plugin:window|destroy")).length, 1);
    assert.equal((await tauriCalls(page, "discard_recovery_snapshot")).length, 1);
    assert.equal((await tauriCalls(page, "cancel_quit")).length, 1);
    await page.close();
  }

  assert.deepEqual(errors, []);
  console.log("PASS: recovery, conflicts, encodings and failures are handled visibly");
} finally {
  await browser.close();
}
