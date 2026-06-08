use std::{
    env,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
};

use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    AppHandle, Emitter, Manager, Runtime,
};
use tauri_plugin_opener::OpenerExt;

#[derive(serde::Serialize)]
struct OpenedMarkdownFile {
    title: String,
    path: String,
    content: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedMarkdownFile {
    title: String,
    path: String,
    dirty: bool,
    is_untitled: bool,
}

fn file_title_from_path(path: &Path) -> String {
    path.file_name()
        .and_then(|file_name| file_name.to_str())
        .unwrap_or("Markdown")
        .to_string()
}

fn is_markdown_file_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "md" | "markdown"))
        .unwrap_or(false)
}

fn launch_markdown_path_from_args(args: impl IntoIterator<Item = OsString>) -> Option<PathBuf> {
    args.into_iter().skip(1).find_map(|arg| {
        let text = arg.to_string_lossy();

        if text == "--" || text.starts_with('-') {
            return None;
        }

        let path = PathBuf::from(arg);
        is_markdown_file_path(&path).then_some(path)
    })
}

#[cfg(target_os = "windows")]
fn wide_null_terminated(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn markdown_filter_wide() -> Vec<u16> {
    "Markdown files (*.md;*.markdown)\0*.md;*.markdown\0Text files (*.txt)\0*.txt\0All files (*.*)\0*.*\0\0"
        .encode_utf16()
        .collect()
}

#[cfg(target_os = "windows")]
fn selected_path_from_buffer(buffer: &[u16]) -> Option<PathBuf> {
    let len = buffer.iter().position(|value| *value == 0)?;

    if len == 0 {
        return None;
    }

    Some(PathBuf::from(String::from_utf16_lossy(&buffer[..len])))
}

#[cfg(target_os = "windows")]
fn common_dialog_error_message(action: &str) -> String {
    let error = unsafe { windows_sys::Win32::UI::Controls::Dialogs::CommDlgExtendedError() };

    if error == 0 {
        format!("{action} canceled")
    } else {
        format!("{action} failed with common dialog error {error}")
    }
}

#[cfg(target_os = "windows")]
fn choose_markdown_file_path(
    action: &str,
    suggested_name: Option<&str>,
    save: bool,
) -> Result<Option<PathBuf>, String> {
    use windows_sys::Win32::UI::Controls::Dialogs::{
        GetOpenFileNameW, GetSaveFileNameW, OFN_ENABLESIZING, OFN_EXPLORER, OFN_FILEMUSTEXIST,
        OFN_NOCHANGEDIR, OFN_OVERWRITEPROMPT, OFN_PATHMUSTEXIST, OPENFILENAMEW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    let filter = markdown_filter_wide();
    let default_extension = wide_null_terminated("md");
    let title = wide_null_terminated(if save {
        "名前を付けて保存"
    } else {
        "Markdown ファイルを開く"
    });
    let mut file_buffer = vec![0u16; 32768];

    if let Some(name) = suggested_name {
        for (index, value) in name.encode_utf16().take(file_buffer.len() - 1).enumerate() {
            file_buffer[index] = value;
        }
    }

    let mut flags = OFN_EXPLORER | OFN_ENABLESIZING | OFN_NOCHANGEDIR | OFN_PATHMUSTEXIST;

    if save {
        flags |= OFN_OVERWRITEPROMPT;
    } else {
        flags |= OFN_FILEMUSTEXIST;
    }

    let mut dialog = OPENFILENAMEW {
        lStructSize: std::mem::size_of::<OPENFILENAMEW>() as u32,
        hwndOwner: unsafe { GetForegroundWindow() },
        lpstrFilter: filter.as_ptr(),
        nFilterIndex: 1,
        lpstrFile: file_buffer.as_mut_ptr(),
        nMaxFile: file_buffer.len() as u32,
        lpstrTitle: title.as_ptr(),
        Flags: flags,
        lpstrDefExt: default_extension.as_ptr(),
        ..Default::default()
    };

    let accepted = unsafe {
        if save {
            GetSaveFileNameW(&mut dialog)
        } else {
            GetOpenFileNameW(&mut dialog)
        }
    };

    if accepted == 0 {
        let error = unsafe { windows_sys::Win32::UI::Controls::Dialogs::CommDlgExtendedError() };

        if error == 0 {
            return Ok(None);
        }

        return Err(common_dialog_error_message(action));
    }

    Ok(selected_path_from_buffer(&file_buffer))
}

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
fn load_launch_markdown_file() -> Result<Option<OpenedMarkdownFile>, String> {
    let Some(path) = launch_markdown_path_from_args(env::args_os()) else {
        return Ok(None);
    };

    if !path.is_file() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read launch file: {error}"))?;
    let canonical_path = path.canonicalize().unwrap_or_else(|_| path.clone());

    Ok(Some(OpenedMarkdownFile {
        title: file_title_from_path(&path),
        path: canonical_path.to_string_lossy().to_string(),
        content,
    }))
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn open_markdown_file_dialog() -> Result<Option<OpenedMarkdownFile>, String> {
    let Some(path) = choose_markdown_file_path("open Markdown file", None, false)? else {
        return Ok(None);
    };
    let content =
        fs::read_to_string(&path).map_err(|error| format!("failed to read file: {error}"))?;
    let canonical_path = path.canonicalize().unwrap_or_else(|_| path.clone());

    Ok(Some(OpenedMarkdownFile {
        title: file_title_from_path(&path),
        path: canonical_path.to_string_lossy().to_string(),
        content,
    }))
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn open_markdown_file_dialog() -> Result<Option<OpenedMarkdownFile>, String> {
    Err("native file dialogs are only implemented on Windows".to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn save_markdown_file_as_dialog(
    suggested_name: String,
    content: String,
) -> Result<Option<SavedMarkdownFile>, String> {
    let Some(path) =
        choose_markdown_file_path("save Markdown file", Some(suggested_name.as_str()), true)?
    else {
        return Ok(None);
    };

    fs::write(&path, content).map_err(|error| format!("failed to write file: {error}"))?;
    let canonical_path = path.canonicalize().unwrap_or_else(|_| path.clone());

    Ok(Some(SavedMarkdownFile {
        title: file_title_from_path(&path),
        path: canonical_path.to_string_lossy().to_string(),
        dirty: false,
        is_untitled: false,
    }))
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn save_markdown_file_as_dialog(
    _suggested_name: String,
    _content: String,
) -> Result<Option<SavedMarkdownFile>, String> {
    Err("native file dialogs are only implemented on Windows".to_string())
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
fn discard_recovery_snapshot<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let snapshot_path = recovery_snapshot_path(&app)?;

    match fs::remove_file(snapshot_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("failed to discard recovery snapshot: {error}")),
    }
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
            load_launch_markdown_file,
            open_markdown_file_dialog,
            save_markdown_file_as_dialog,
            save_recovery_snapshot,
            discard_recovery_snapshot,
            read_text_file,
            write_text_file,
            open_external_url
        ])
        .run(tauri::generate_context!())
        .expect("failed to run MarkdownPad");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }

    #[test]
    fn launch_markdown_path_from_args_uses_first_markdown_path() {
        assert_eq!(
            launch_markdown_path_from_args(args(&[
                "markdownpad.exe",
                "--some-tauri-flag",
                "C:\\tmp\\note.txt",
                "C:\\tmp\\note.md",
                "C:\\tmp\\second.markdown",
            ])),
            Some(PathBuf::from("C:\\tmp\\note.md"))
        );
    }

    #[test]
    fn launch_markdown_path_from_args_accepts_markdown_extension_case_insensitively() {
        assert_eq!(
            launch_markdown_path_from_args(args(&["markdownpad.exe", "C:\\tmp\\NOTE.MD"])),
            Some(PathBuf::from("C:\\tmp\\NOTE.MD"))
        );
    }

    #[test]
    fn launch_markdown_path_from_args_ignores_non_markdown_args() {
        assert_eq!(
            launch_markdown_path_from_args(args(&["markdownpad.exe", "--", "C:\\tmp\\note.txt",])),
            None
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn selected_path_from_buffer_reads_until_first_null() {
        let mut buffer: Vec<u16> = "C:\\tmp\\note.md".encode_utf16().collect();
        buffer.push(0);
        buffer.extend("ignored".encode_utf16());

        assert_eq!(
            selected_path_from_buffer(&buffer),
            Some(PathBuf::from("C:\\tmp\\note.md"))
        );
    }
}
