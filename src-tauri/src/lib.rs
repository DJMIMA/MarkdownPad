use std::{fs, path::PathBuf};

use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    AppHandle, Emitter, Manager, Runtime, WebviewWindow,
};
use tauri_plugin_opener::OpenerExt;

fn recovery_snapshot_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?;

    Ok(app_data_dir.join("recovery.snapshot.json"))
}

#[tauri::command]
fn load_recovery_snapshot<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<serde_json::Value>, String> {
    let snapshot_path = recovery_snapshot_path(&app)?;

    if !snapshot_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(snapshot_path)
        .map_err(|error| format!("failed to read recovery snapshot: {error}"))?;
    let snapshot = serde_json::from_str(&content)
        .map_err(|error| format!("failed to parse recovery snapshot: {error}"))?;

    Ok(Some(snapshot))
}

#[tauri::command]
fn save_recovery_snapshot<R: Runtime>(
    app: AppHandle<R>,
    snapshot: serde_json::Value,
) -> Result<(), String> {
    let snapshot_path = recovery_snapshot_path(&app)?;
    let snapshot_dir = snapshot_path
        .parent()
        .ok_or_else(|| "failed to resolve recovery snapshot directory".to_string())?;
    fs::create_dir_all(snapshot_dir)
        .map_err(|error| format!("failed to create recovery directory: {error}"))?;
    let content = serde_json::to_string_pretty(&snapshot)
        .map_err(|error| format!("failed to serialize recovery snapshot: {error}"))?;

    fs::write(snapshot_path, content)
        .map_err(|error| format!("failed to write recovery snapshot: {error}"))
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| format!("failed to read file: {error}"))
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    fs::write(path, content).map_err(|error| format!("failed to write file: {error}"))
}

fn normalized_external_url(url: &str) -> Option<String> {
    let trimmed = url.trim();
    let lower = trimmed.to_ascii_lowercase();

    if lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("mailto:")
        || lower.starts_with("tel:")
    {
        return Some(trimmed.to_string());
    }

    if lower.starts_with("www.") {
        return Some(format!("https://{trimmed}"));
    }

    None
}

#[tauri::command]
fn open_external_url<R: Runtime>(app: AppHandle<R>, url: String) -> Result<(), String> {
    let normalized_url =
        normalized_external_url(&url).ok_or_else(|| "unsupported external URL".to_string())?;

    app.opener()
        .open_url(normalized_url, None::<&str>)
        .map_err(|error| format!("failed to open external URL: {error}"))
}

#[tauri::command]
fn print_html(window: WebviewWindow, html: String) -> Result<(), String> {
    let html_json = serde_json::to_string(&html)
        .map_err(|error| format!("failed to serialize print document: {error}"))?;
    let script = format!(
        r#"
        (() => {{
          const printWindow = window.open("", "_blank", "noopener,noreferrer");
          if (!printWindow) return;
          printWindow.document.write({html_json});
          printWindow.document.close();
          printWindow.focus();
          printWindow.print();
        }})();
        "#
    );

    window
        .eval(&script)
        .map_err(|error| format!("failed to start print bridge: {error}"))
}

fn markdownpad_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let new_tab = MenuItemBuilder::with_id("new-tab", "新しいタブ")
        .accelerator("Ctrl+N")
        .build(app)?;
    let new_window = MenuItemBuilder::with_id("new-window", "新しいウインドウ")
        .accelerator("Ctrl+Shift+N")
        .build(app)?;
    let open = MenuItemBuilder::with_id("open", "開く")
        .accelerator("Ctrl+O")
        .build(app)?;
    let save = MenuItemBuilder::with_id("save", "保存")
        .accelerator("Ctrl+S")
        .build(app)?;
    let save_as = MenuItemBuilder::with_id("save-as", "名前を付けて保存")
        .accelerator("Ctrl+Shift+S")
        .build(app)?;
    let print = MenuItemBuilder::with_id("print", "印刷")
        .accelerator("Ctrl+P")
        .build(app)?;
    let close_tab = MenuItemBuilder::with_id("close-tab", "タブを閉じる")
        .accelerator("Ctrl+W")
        .build(app)?;
    let close_window = MenuItemBuilder::with_id("close-window", "ウィンドウを閉じる")
        .accelerator("Ctrl+Shift+W")
        .build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "終了").build(app)?;

    let file_menu = SubmenuBuilder::new(app, "ファイル")
        .item(&new_tab)
        .item(&new_window)
        .separator()
        .item(&open)
        .item(&save)
        .item(&save_as)
        .separator()
        .item(&print)
        .separator()
        .item(&close_tab)
        .item(&close_window)
        .item(&quit)
        .build()?;

    let cut = MenuItemBuilder::with_id("cut", "切り取り")
        .accelerator("Ctrl+X")
        .build(app)?;
    let copy = MenuItemBuilder::with_id("copy", "コピー")
        .accelerator("Ctrl+C")
        .build(app)?;
    let paste = MenuItemBuilder::with_id("paste", "貼り付け")
        .accelerator("Ctrl+V")
        .build(app)?;
    let find = MenuItemBuilder::with_id("find", "検索")
        .accelerator("Ctrl+F")
        .build(app)?;
    let replace = MenuItemBuilder::with_id("replace", "置換")
        .accelerator("Ctrl+H")
        .build(app)?;
    let select_all = MenuItemBuilder::with_id("select-all", "全てを選択")
        .accelerator("Ctrl+A")
        .build(app)?;

    let edit_menu = SubmenuBuilder::new(app, "編集")
        .item(&cut)
        .item(&copy)
        .item(&paste)
        .separator()
        .item(&find)
        .item(&replace)
        .separator()
        .item(&select_all)
        .build()?;

    let zoom_in = MenuItemBuilder::with_id("zoom-in", "拡大")
        .accelerator("Ctrl+=")
        .build(app)?;
    let zoom_out = MenuItemBuilder::with_id("zoom-out", "縮小")
        .accelerator("Ctrl+-")
        .build(app)?;
    let zoom_reset = MenuItemBuilder::with_id("zoom-reset", "既定値に戻す")
        .accelerator("Ctrl+0")
        .build(app)?;

    let view_menu = SubmenuBuilder::new(app, "表示")
        .item(&zoom_in)
        .item(&zoom_out)
        .item(&zoom_reset)
        .separator()
        .check("toggle-word-wrap", "右端で折り返す")
        .check("toggle-status-bar", "ステータスバー")
        .build()?;

    MenuBuilder::new(app)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .menu(markdownpad_menu)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref().to_string();
            let focused_window = app
                .webview_windows()
                .into_values()
                .find(|window| window.is_focused().unwrap_or(false));

            if let Some(window) = focused_window.or_else(|| app.get_webview_window("main")) {
                let _ = window.emit("menu-action", id);
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_recovery_snapshot,
            save_recovery_snapshot,
            read_text_file,
            write_text_file,
            open_external_url,
            print_html
        ])
        .run(tauri::generate_context!())
        .expect("failed to run MarkdownPad");
}
