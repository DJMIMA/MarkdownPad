// The settings dialog (File > 設定, Ctrl+,) and its file association flow,
// against a scripted Tauri IPC mock: status shown per extension, registering
// then opening Windows' Default apps page, unregistering, a moved exe, errors
// shown inline, Linux (where registering sets the default itself), and the
// plain browser where association is unavailable.
import assert from "node:assert/strict";
import { launchBrowser } from "./launch.mjs";
import { installTauriMock, setTauriResponse, tauriCalls } from "./tauri-mock.mjs";

const baseUrl = process.env.MARKDOWNPAD_URL ?? "http://127.0.0.1:1420";
const exePath = "C:\\Tools\\MarkdownPad\\markdownpad.exe";

function status(registeredPath, defaults = [false, false]) {
  return {
    supported: true,
    exePath,
    registeredPath,
    extensions: [
      { extension: ".md", isDefault: defaults[0], defaultApp: defaults[0] ? "MarkdownPad" : "メモ帳" },
      { extension: ".markdown", isDefault: defaults[1], defaultApp: defaults[1] ? "MarkdownPad" : null },
    ],
  };
}

async function openApp(browser, responses, errors, { tauri = true } = {}) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  if (tauri) {
    await installTauriMock(page, {
      responses: { load_launch_markdown_files: [], load_recovery_snapshots: [], ...responses },
    });
  }
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector(".cm-content");
  return page;
}

function stateText(page) {
  return page.textContent("[data-testid=association-state]");
}

function rows(page) {
  return page.$$eval(".settings-table tr", (trs) =>
    trs.map((tr) => [...tr.children].map((cell) => cell.textContent)),
  );
}

const browser = await launchBrowser();
const errors = [];

try {
  // Registering, then choosing the default in Windows' settings.
  {
    const page = await openApp(
      browser,
      {
        file_association_status: status(null),
        register_file_association: status(exePath, [true, false]),
      },
      errors,
    );

    await page.evaluate(() => window.__tauriMock.emit("menu-action", "open-settings"));
    await page.waitForSelector(".settings-dialog");
    await page.waitForFunction(
      () => document.querySelector("[data-testid=association-state]")?.textContent === "未登録",
    );
    assert.deepEqual(await rows(page), [
      ["状態", "未登録"],
      [".md", "メモ帳"],
      [".markdown", "なし"],
    ]);
    assert.equal(await page.locator(".settings-actions button.danger").count(), 0);

    // Shortcuts meant for the editor do nothing while the dialog is open.
    await page.keyboard.press("Control+n");
    assert.equal(await page.locator(".tab-title").count(), 1);

    await page.click("button:has-text('関連付けを登録')");
    await page.waitForSelector("[role=status]");
    assert.equal((await tauriCalls(page, "register_file_association")).length, 1);
    assert.equal(
      (await tauriCalls(page, "open_default_apps_settings")).length,
      1,
      "not every extension opens with MarkdownPad, so the Default apps page opens",
    );
    assert.match(await page.textContent("[role=status]"), /既定のアプリに MarkdownPad を選んで/);
    assert.equal(await stateText(page), "登録済み（既定のアプリは未設定）");

    // Coming back from the Settings app shows the new state.
    await setTauriResponse(page, "file_association_status", status(exePath, [true, true]));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForFunction(
      () =>
        document.querySelector("[data-testid=association-state]")?.textContent ===
        "登録済み・既定のアプリ",
    );
    assert.deepEqual((await rows(page)).slice(1), [
      [".md", "MarkdownPad"],
      [".markdown", "MarkdownPad"],
    ]);

    // Unregistering.
    await setTauriResponse(page, "unregister_file_association", status(null));
    await page.click("button:has-text('登録を解除')");
    await page.waitForFunction(
      () => document.querySelector("[data-testid=association-state]")?.textContent === "未登録",
    );
    assert.equal((await tauriCalls(page, "unregister_file_association")).length, 1);

    // Escape closes the dialog and gives the keyboard back to the editor.
    await page.keyboard.press("Escape");
    await page.waitForSelector(".settings-dialog", { state: "detached" });
    await page.keyboard.press("Control+Comma");
    await page.waitForSelector(".settings-dialog");
    await page.click(".settings-dialog button:has-text('閉じる')");
    await page.waitForSelector(".settings-dialog", { state: "detached" });
    await page.close();
  }

  // A registration that points at another copy of the exe, and a failure.
  {
    const page = await openApp(
      browser,
      {
        file_association_status: status("D:\\Old\\markdownpad.exe"),
        register_file_association: { error: "レジストリを書き込みできませんでした（エラー 5）。" },
      },
      errors,
    );

    await page.keyboard.press("Control+Comma");
    await page.waitForFunction(
      () =>
        document.querySelector("[data-testid=association-state]")?.textContent ===
        "別の場所の MarkdownPad が登録されています",
    );
    assert.deepEqual((await rows(page))[1], ["登録先", "D:\\Old\\markdownpad.exe"]);
    await page.click("button:has-text('この場所で登録し直す')");
    await page.waitForSelector("[role=alert]");
    assert.equal(await page.textContent("[role=alert]"), "レジストリを書き込みできませんでした（エラー 5）。");
    assert.equal((await tauriCalls(page, "open_default_apps_settings")).length, 0);
    await page.close();
  }

  // Linux: registering also makes MarkdownPad the default, so no settings page
  // opens; a registration that lost the default offers to take it back.
  {
    const linuxExe = "/home/user/.local/bin/markdownpad";
    const linuxStatus = (registeredPath, isDefault, defaultApp) => ({
      supported: true,
      platform: "linux",
      exePath: linuxExe,
      registeredPath,
      extensions: [{ extension: ".md / .markdown", isDefault, defaultApp, defaultPath: null }],
    });
    const page = await openApp(
      browser,
      {
        file_association_status: linuxStatus(null, false, "Okular"),
        register_file_association: linuxStatus(linuxExe, true, "MarkdownPad"),
      },
      errors,
    );

    await page.keyboard.press("Control+Comma");
    await page.waitForFunction(
      () => document.querySelector("[data-testid=association-state]")?.textContent === "未登録",
    );
    assert.match(await page.textContent(".settings-note"), /^ファイルマネージャーでダブルクリック/);
    assert.deepEqual((await rows(page)).slice(1), [[".md / .markdown", "Okular"]]);

    await page.click("button:has-text('関連付けを登録')");
    await page.waitForSelector("[role=status]");
    assert.equal(await page.textContent("[role=status]"), "登録しました。");
    assert.equal(await stateText(page), "登録済み・既定のアプリ");
    assert.equal((await tauriCalls(page, "open_default_apps_settings")).length, 0);

    // Another app took the default back.
    await setTauriResponse(page, "file_association_status", linuxStatus(linuxExe, false, "Okular"));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForFunction(
      () =>
        document.querySelector("[data-testid=association-state]")?.textContent ===
        "登録済み（既定のアプリは未設定）",
    );
    assert.equal(await page.locator("button:has-text('既定のアプリを選ぶ')").count(), 0);
    await page.click("button:has-text('既定のアプリにする')");
    await page.waitForFunction(
      () =>
        document.querySelector("[data-testid=association-state]")?.textContent ===
        "登録済み・既定のアプリ",
    );
    assert.equal((await tauriCalls(page, "register_file_association")).length, 2);
    assert.equal((await tauriCalls(page, "open_default_apps_settings")).length, 0);
    await page.close();
  }

  // Outside Tauri the File menu still has 設定, without association actions.
  {
    const page = await openApp(browser, {}, errors, { tauri: false });
    await page.click(".menu-root-button:has-text('ファイル')");
    await page.click(".menu-item:has-text('設定')");
    await page.waitForSelector(".settings-dialog");
    assert.equal(await stateText(page), "この環境では利用できません（Windows 版・Linux 版のみ）");
    assert.equal(await page.locator(".settings-actions").count(), 0);
    await page.close();
  }

  assert.deepEqual(errors, []);
  console.log("settings-check passed");
} finally {
  await browser.close();
}
