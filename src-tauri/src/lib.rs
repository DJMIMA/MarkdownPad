use std::{fs, path::PathBuf};

use tauri::{
    menu::{Menu, MenuBuilder, SubmenuBuilder},
    AppHandle, Emitter, Manager, Runtime, WebviewWindow,
};

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
    let file_menu = SubmenuBuilder::new(app, "ファイル")
        .text("new-tab", "新しいタブ")
        .text("new-window", "新しいウインドウ")
        .separator()
        .text("open", "開く")
        .text("save", "保存")
        .text("save-as", "名前を付けて保存")
        .separator()
        .text("print", "印刷")
        .separator()
        .text("close-tab", "タブを閉じる")
        .text("close-window", "ウィンドウを閉じる")
        .text("quit", "終了")
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "編集")
        .text("cut", "切り取り")
        .text("copy", "コピー")
        .text("paste", "貼り付け")
        .separator()
        .text("find", "検索")
        .text("replace", "置換")
        .separator()
        .text("select-all", "全てを選択")
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "表示")
        .text("zoom-in", "拡大")
        .text("zoom-out", "縮小")
        .text("zoom-reset", "既定値に戻す")
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
            let id = event.id().as_ref();
            let _ = app.emit("menu-action", id);
        })
        .invoke_handler(tauri::generate_handler![
            load_recovery_snapshot,
            save_recovery_snapshot,
            read_text_file,
            write_text_file,
            print_html
        ])
        .run(tauri::generate_context!())
        .expect("failed to run MarkdownPad");
}
