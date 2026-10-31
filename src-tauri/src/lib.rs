mod recovery;
mod text_file;

use std::{
    collections::{HashMap, HashSet},
    env,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use tauri::{
    menu::{
        CheckMenuItem, CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder,
    },
    AppHandle, Emitter, Manager, Runtime, State, WebviewWindow, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;
use text_file::{EncodeError, FileStamp, LineEnding, TextEncoding};

/// Event that tells an editor window to pull the files queued for it with
/// `take_pending_open_files`.
const OPEN_FILES_REQUESTED_EVENT: &str = "open-files-requested";
const PRINT_WINDOW_LABEL_PREFIX: &str = "markdownpad-print-";
const MAIN_WINDOW_LABEL: &str = "main";
/// Event that asks an editor window to close as part of quitting the app.
const QUIT_REQUESTED_EVENT: &str = "quit-requested";

/// Extensions accepted from the command line (file association, "Open with",
/// a second launch). The open dialog additionally offers "All files".
const OPENABLE_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "mkdn", "txt"];

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenedMarkdownFile {
    title: String,
    path: String,
    content: String,
    encoding: TextEncoding,
    line_ending: LineEnding,
    stamp: Option<FileStamp>,
}

/// A file handed to a window from the command line: its contents, or why it
/// could not be read (so the window can tell the user).
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingOpenFile {
    path: String,
    file: Option<OpenedMarkdownFile>,
    error: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum SaveOutcome {
    Saved {
        stamp: Option<FileStamp>,
    },
    /// The file changed on disk since it was opened or last saved.
    Conflict,
    /// The text has characters the file's encoding cannot represent.
    Unencodable,
}

#[derive(serde::Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum SaveAsOutcome {
    Saved {
        title: String,
        path: String,
        stamp: Option<FileStamp>,
    },
    Canceled,
    Unencodable,
}

/// Files the frontend may read or write: only paths the user picked in a
/// dialog, passed on the command line, or that were open in a recovered
/// session. The webview can never name an arbitrary path to overwrite.
#[derive(Default)]
struct FileAccess {
    allowed: Mutex<HashSet<String>>,
}

impl FileAccess {
    fn allow(&self, path: &str) {
        if let Ok(mut allowed) = self.allowed.lock() {
            allowed.insert(path.to_string());
        }
    }

    fn check(&self, path: &str) -> Result<(), String> {
        let allowed = self
            .allowed
            .lock()
            .map(|allowed| allowed.contains(path))
            .unwrap_or(false);

        if allowed {
            Ok(())
        } else {
            Err("このファイルへのアクセスは許可されていません。".to_string())
        }
    }
}

/// Editor windows still to be closed while the app quits, in order; `None`
/// when no quit is in progress. Windows are asked one at a time, so each can
/// show its own unsaved-changes question, and a "Cancel" stops the quit.
#[derive(Default)]
struct QuitState {
    remaining: Mutex<Option<Vec<String>>>,
}

fn start_quit<R: Runtime>(app: &AppHandle<R>, initiator: &str) {
    let mut labels: Vec<String> = app
        .webview_windows()
        .into_keys()
        .filter(|label| is_editor_window_label(label))
        .collect();
    labels.sort_by_key(|label| (label != initiator, label.clone()));

    let Some(first) = labels.first().cloned() else {
        app.exit(0);
        return;
    };

    if let Ok(mut remaining) = app.state::<QuitState>().remaining.lock() {
        *remaining = Some(labels);
    }

    let _ = app.emit_to(first.as_str(), QUIT_REQUESTED_EVENT, ());
}

/// Called when an editor window is gone: asks the next one, or exits once
/// every editor window has closed (print windows close with the app).
fn continue_quit<R: Runtime>(app: &AppHandle<R>, closed_label: &str) {
    let quit = app.state::<QuitState>();
    let next = {
        let Ok(mut state) = quit.remaining.lock() else {
            return;
        };
        let Some(remaining) = state.as_mut() else {
            return;
        };
        let was_current = remaining.first().map(String::as_str) == Some(closed_label);
        remaining.retain(|label| label != closed_label);

        if remaining.is_empty() {
            *state = None;
            None
        } else if was_current {
            Some(remaining[0].clone())
        } else {
            return;
        }
    };

    match next {
        Some(label) => {
            let _ = app.emit_to(label.as_str(), QUIT_REQUESTED_EVENT, ());
        }
        None => app.exit(0),
    }
}

#[tauri::command]
fn request_quit<R: Runtime>(app: AppHandle<R>, window: WebviewWindow<R>) {
    start_quit(&app, window.label());
}

/// The window was kept open (the user chose Cancel): stop quitting.
#[tauri::command]
fn cancel_quit(quit: State<'_, QuitState>) {
    if let Ok(mut remaining) = quit.remaining.lock() {
        *remaining = None;
    }
}

/// Snapshot ids that were on disk when this process started, i.e. left by a
/// session that did not end normally.
#[derive(Default)]
struct RecoveryState {
    previous_session: Mutex<Vec<String>>,
}

fn file_title_from_path(path: &Path) -> String {
    path.file_name()
        .and_then(|file_name| file_name.to_str())
        .unwrap_or("Markdown")
        .to_string()
}

fn is_openable_file_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            let extension = extension.to_ascii_lowercase();
            OPENABLE_EXTENSIONS.contains(&extension.as_str())
        })
        .unwrap_or(false)
}

fn launch_file_paths_from_args(args: impl IntoIterator<Item = OsString>) -> Vec<PathBuf> {
    args.into_iter()
        .skip(1)
        .filter(|arg| !arg.to_string_lossy().starts_with('-'))
        .map(PathBuf::from)
        .filter(|path| is_openable_file_path(path))
        .collect()
}

/// Resolves the files a second instance was launched with. Its arguments may
/// be relative to the second instance's working directory, not to this
/// process's.
fn forwarded_file_paths(args: Vec<String>, cwd: &str) -> Vec<PathBuf> {
    launch_file_paths_from_args(args.into_iter().map(OsString::from))
        .into_iter()
        .map(|path| {
            if path.is_absolute() || cwd.is_empty() {
                path
            } else {
                Path::new(cwd).join(path)
            }
        })
        .collect()
}

fn read_markdown_file(path: &Path) -> Result<OpenedMarkdownFile, String> {
    let bytes = fs::read(path).map_err(|error| {
        format!(
            "{} を読み込めませんでした。\n{error}",
            file_title_from_path(path)
        )
    })?;
    let decoded = text_file::decode_text(&bytes).map_err(|error| {
        format!(
            "{} を開けませんでした。\n{error}",
            file_title_from_path(path)
        )
    })?;
    let canonical_path = text_file::canonical_path(path);

    Ok(OpenedMarkdownFile {
        title: file_title_from_path(path),
        stamp: text_file::file_stamp(&canonical_path).ok(),
        path: canonical_path.to_string_lossy().to_string(),
        content: decoded.content,
        encoding: decoded.encoding,
        line_ending: decoded.line_ending,
    })
}

/// Reads a file the user chose and allows the frontend to save back to it.
fn open_user_file<R: Runtime>(
    app: &AppHandle<R>,
    path: &Path,
) -> Result<OpenedMarkdownFile, String> {
    let file = read_markdown_file(path)?;
    app.state::<FileAccess>().allow(&file.path);
    Ok(file)
}

fn pending_open_file<R: Runtime>(app: &AppHandle<R>, path: &Path) -> PendingOpenFile {
    let path_text = path.to_string_lossy().to_string();
    let result = if path.is_file() {
        open_user_file(app, path)
    } else {
        Err(format!("ファイルが見つかりません。\n{path_text}"))
    };

    match result {
        Ok(file) => PendingOpenFile {
            path: path_text,
            file: Some(file),
            error: None,
        },
        Err(error) => PendingOpenFile {
            path: path_text,
            file: None,
            error: Some(error),
        },
    }
}

fn is_editor_window_label(label: &str) -> bool {
    !label.starts_with(PRINT_WINDOW_LABEL_PREFIX)
}

/// Routes files that a second launch (for example a double-click in
/// Explorer) hands over to the running instance.
#[derive(Default)]
struct OpenFileRouting {
    last_focused_editor: Mutex<Option<String>>,
    pending_by_window: Mutex<HashMap<String, Vec<PendingOpenFile>>>,
}

fn target_editor_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    let last_focused = app
        .state::<OpenFileRouting>()
        .last_focused_editor
        .lock()
        .ok()
        .and_then(|label| label.clone());

    last_focused
        .and_then(|label| app.get_webview_window(&label))
        .or_else(|| app.get_webview_window(MAIN_WINDOW_LABEL))
        .or_else(|| {
            app.webview_windows()
                .into_values()
                .find(|window| is_editor_window_label(window.label()))
        })
}

fn open_forwarded_files<R: Runtime>(app: &AppHandle<R>, args: Vec<String>, cwd: String) {
    let Some(window) = target_editor_window(app) else {
        return;
    };
    let paths = forwarded_file_paths(args, &cwd);

    // Launching the app again without a file (Start menu, middle-click on the
    // taskbar button) still gives the user another window.
    if paths.is_empty() {
        let _ = app.emit_to(window.label(), "menu-action", "new-window");
        return;
    }

    let files: Vec<PendingOpenFile> = paths
        .iter()
        .map(|path| pending_open_file(app, path))
        .collect();

    if let Ok(mut pending) = app.state::<OpenFileRouting>().pending_by_window.lock() {
        pending
            .entry(window.label().to_string())
            .or_default()
            .extend(files);
    }

    let _ = app.emit_to(window.label(), OPEN_FILES_REQUESTED_EVENT, ());
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

#[tauri::command]
fn take_pending_open_files<R: Runtime>(
    window: WebviewWindow<R>,
    routing: State<'_, OpenFileRouting>,
) -> Vec<PendingOpenFile> {
    routing
        .pending_by_window
        .lock()
        .ok()
        .and_then(|mut pending| pending.remove(window.label()))
        .unwrap_or_default()
}

#[tauri::command]
fn load_launch_markdown_files<R: Runtime>(app: AppHandle<R>) -> Vec<PendingOpenFile> {
    launch_file_paths_from_args(env::args_os())
        .iter()
        .map(|path| pending_open_file(&app, path))
        .collect()
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
fn choose_markdown_file_path<R: Runtime>(
    window: &WebviewWindow<R>,
    suggested_name: Option<&str>,
    save: bool,
) -> Result<Option<PathBuf>, String> {
    use windows_sys::Win32::UI::Controls::Dialogs::{
        CommDlgExtendedError, GetOpenFileNameW, GetSaveFileNameW, OFN_ENABLESIZING, OFN_EXPLORER,
        OFN_FILEMUSTEXIST, OFN_NOCHANGEDIR, OFN_OVERWRITEPROMPT, OFN_PATHMUSTEXIST, OPENFILENAMEW,
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

    // Owned by the window the command came from, so the dialog is modal to
    // it even if another program has the focus.
    let owner = window
        .hwnd()
        .map(|hwnd| hwnd.0 as _)
        .unwrap_or_else(|_| unsafe { GetForegroundWindow() });

    let mut dialog = OPENFILENAMEW {
        lStructSize: std::mem::size_of::<OPENFILENAMEW>() as u32,
        hwndOwner: owner,
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
        let error = unsafe { CommDlgExtendedError() };

        if error == 0 {
            return Ok(None);
        }

        return Err(format!(
            "ファイルダイアログを開けませんでした（エラー {error}）。"
        ));
    }

    Ok(selected_path_from_buffer(&file_buffer))
}

#[cfg(not(target_os = "windows"))]
fn choose_markdown_file_path<R: Runtime>(
    _window: &WebviewWindow<R>,
    _suggested_name: Option<&str>,
    _save: bool,
) -> Result<Option<PathBuf>, String> {
    Err("ファイルダイアログは Windows でのみ利用できます。".to_string())
}

// The native file dialogs run on the main thread (synchronous commands do),
// which already has the COM apartment the dialogs need.
#[tauri::command]
fn open_markdown_file_dialog<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<Option<OpenedMarkdownFile>, String> {
    let Some(path) = choose_markdown_file_path(&window, None, false)? else {
        return Ok(None);
    };

    open_user_file(&app, &path).map(Some)
}

fn encode_for_save(
    content: &str,
    encoding: TextEncoding,
    line_ending: LineEnding,
) -> Result<Option<Vec<u8>>, String> {
    match text_file::encode_text(content, encoding, line_ending) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(EncodeError::Unencodable) => Ok(None),
    }
}

fn write_user_file(path: &Path, bytes: &[u8]) -> Result<Option<FileStamp>, String> {
    text_file::write_atomically(path, bytes).map_err(|error| {
        format!(
            "{} を保存できませんでした。\n{error}",
            file_title_from_path(path)
        )
    })?;

    Ok(text_file::file_stamp(path).ok())
}

#[tauri::command]
fn save_markdown_file_as_dialog<R: Runtime>(
    window: WebviewWindow<R>,
    access: State<'_, FileAccess>,
    suggested_name: String,
    content: String,
    encoding: TextEncoding,
    line_ending: LineEnding,
) -> Result<SaveAsOutcome, String> {
    // Check before asking for a file name, so the user is not asked twice.
    let Some(bytes) = encode_for_save(&content, encoding, line_ending)? else {
        return Ok(SaveAsOutcome::Unencodable);
    };
    let Some(path) = choose_markdown_file_path(&window, Some(suggested_name.as_str()), true)?
    else {
        return Ok(SaveAsOutcome::Canceled);
    };

    write_user_file(&path, &bytes)?;
    let canonical_path = text_file::canonical_path(&path);
    let path_text = canonical_path.to_string_lossy().to_string();
    access.allow(&path_text);

    Ok(SaveAsOutcome::Saved {
        title: file_title_from_path(&path),
        stamp: text_file::file_stamp(&canonical_path).ok(),
        path: path_text,
    })
}

/// Saves over a file the user opened or saved before. Unless `overwrite` is
/// set, a file that changed on disk since `expected_stamp` is left alone and
/// reported as a conflict.
#[tauri::command]
async fn save_markdown_file(
    access: State<'_, FileAccess>,
    path: String,
    content: String,
    encoding: TextEncoding,
    line_ending: LineEnding,
    expected_stamp: Option<FileStamp>,
    overwrite: bool,
) -> Result<SaveOutcome, String> {
    access.check(&path)?;

    let Some(bytes) = encode_for_save(&content, encoding, line_ending)? else {
        return Ok(SaveOutcome::Unencodable);
    };
    let target = PathBuf::from(&path);

    if !overwrite {
        if let (Some(expected), Ok(current)) = (expected_stamp, text_file::file_stamp(&target)) {
            if current != expected {
                return Ok(SaveOutcome::Conflict);
            }
        }
    }

    let stamp = write_user_file(&target, &bytes)?;
    Ok(SaveOutcome::Saved { stamp })
}

#[tauri::command]
async fn reload_markdown_file(
    access: State<'_, FileAccess>,
    path: String,
) -> Result<OpenedMarkdownFile, String> {
    access.check(&path)?;
    read_markdown_file(Path::new(&path))
}

fn app_data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryCandidate {
    id: String,
    /// False for this window's own snapshot, found after its page reloaded.
    from_previous_session: bool,
    /// None when the file could not be read; the id is still returned so the
    /// file is removed together with the others.
    snapshot: Option<serde_json::Value>,
}

/// Snapshots this window should offer to restore: for the main window, the
/// ones left by a session that did not end normally; for any window, its own
/// snapshot if its page was reloaded.
#[tauri::command]
async fn load_recovery_snapshots<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    recovery: State<'_, RecoveryState>,
    access: State<'_, FileAccess>,
) -> Result<Vec<RecoveryCandidate>, String> {
    let app_data = app_data_dir(&app)?;
    let mut ids: Vec<(String, bool)> = Vec::new();

    if window.label() == MAIN_WINDOW_LABEL {
        if let Ok(previous) = recovery.previous_session.lock() {
            ids.extend(previous.iter().map(|id| (id.clone(), true)));
        }
    }

    let own_id = recovery::snapshot_id_for_window(window.label());

    if !ids.iter().any(|(id, _)| id == &own_id) {
        ids.push((own_id, false));
    }

    Ok(ids
        .into_iter()
        .filter_map(|(id, from_previous_session)| {
            let path = recovery::snapshot_path(&app_data, &id)?;

            if !path.is_file() {
                return None;
            }

            let snapshot = fs::read_to_string(&path)
                .ok()
                .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok());

            if let Some(snapshot) = &snapshot {
                for tab_path in recovery::tab_paths(snapshot) {
                    access.allow(&tab_path);
                }
            }

            Some(RecoveryCandidate {
                id,
                from_previous_session,
                snapshot,
            })
        })
        .collect())
}

#[tauri::command]
async fn discard_recovery_snapshots<R: Runtime>(
    app: AppHandle<R>,
    recovery: State<'_, RecoveryState>,
    ids: Vec<String>,
) -> Result<(), String> {
    let app_data = app_data_dir(&app)?;

    for id in &ids {
        if let Some(path) = recovery::snapshot_path(&app_data, id) {
            match fs::remove_file(&path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(format!("failed to discard recovery snapshot: {error}")),
            }
        }
    }

    if let Ok(mut previous) = recovery.previous_session.lock() {
        previous.retain(|id| !ids.contains(id));
    }

    Ok(())
}

#[tauri::command]
async fn save_recovery_snapshot<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    snapshot: serde_json::Value,
) -> Result<(), String> {
    let app_data = app_data_dir(&app)?;
    let directory = recovery::snapshot_directory(&app_data);
    let path =
        recovery::snapshot_path(&app_data, &recovery::snapshot_id_for_window(window.label()))
            .ok_or_else(|| "invalid recovery snapshot name".to_string())?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("failed to create recovery directory: {error}"))?;
    let content = serde_json::to_vec(&snapshot)
        .map_err(|error| format!("failed to serialize recovery snapshot: {error}"))?;

    text_file::write_atomically(&path, &content)
        .map_err(|error| format!("failed to write recovery snapshot: {error}"))
}

/// Removes this window's own snapshot when it closes normally. Other windows'
/// snapshots are never touched.
#[tauri::command]
async fn discard_recovery_snapshot<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<(), String> {
    let app_data = app_data_dir(&app)?;
    let Some(path) =
        recovery::snapshot_path(&app_data, &recovery::snapshot_id_for_window(window.label()))
    else {
        return Ok(());
    };

    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("failed to discard recovery snapshot: {error}")),
    }
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

fn view_menu_check_item<R: Runtime>(menu: &Menu<R>, id: &str) -> Option<CheckMenuItem<R>> {
    menu.items().ok()?.into_iter().find_map(|item| {
        item.as_submenu()
            .and_then(|submenu| submenu.get(id))
            .and_then(|found| found.as_check_menuitem().cloned())
    })
}

// Native check items flip themselves when clicked, but the frontend also
// toggles these settings from keyboard shortcuts and owns their real state
// (which can differ per window). The frontend calls this after every change
// and when a window gains focus, so the check marks always match that window.
#[tauri::command]
fn sync_view_menu<R: Runtime>(
    app: AppHandle<R>,
    reading_mode: bool,
    word_wrap: bool,
    show_status_bar: bool,
) -> Result<(), String> {
    let Some(menu) = app.menu() else {
        return Ok(());
    };

    for (id, checked) in [
        ("toggle-reading-mode", reading_mode),
        ("toggle-word-wrap", word_wrap),
        ("toggle-status-bar", show_status_bar),
    ] {
        if let Some(item) = view_menu_check_item(&menu, id) {
            item.set_checked(checked)
                .map_err(|error| format!("failed to update view menu: {error}"))?;
        }
    }

    Ok(())
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
    let reading_mode = CheckMenuItemBuilder::with_id("toggle-reading-mode", "リーディングモード")
        .accelerator("Ctrl+E")
        .checked(false)
        .build(app)?;
    let word_wrap = CheckMenuItemBuilder::with_id("toggle-word-wrap", "右端で折り返す")
        .checked(true)
        .build(app)?;
    let status_bar = CheckMenuItemBuilder::with_id("toggle-status-bar", "ステータスバー")
        .checked(true)
        .build(app)?;

    let view_menu = SubmenuBuilder::new(app, "表示")
        .item(&zoom_in)
        .item(&zoom_out)
        .item(&zoom_reset)
        .separator()
        .item(&reading_mode)
        .item(&word_wrap)
        .item(&status_bar)
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
        // Must be the first plugin: a second launch hands its arguments to
        // this instance and exits before creating any window.
        .plugin(tauri_plugin_single_instance::init(open_forwarded_files))
        .plugin(tauri_plugin_opener::init())
        .manage(OpenFileRouting::default())
        .manage(FileAccess::default())
        .manage(QuitState::default())
        .setup(|app| {
            // Snapshots still on disk now were left by a session that did not
            // end normally.
            let previous_session = app
                .path()
                .app_data_dir()
                .map(|app_data| recovery::existing_snapshot_ids(&app_data))
                .unwrap_or_default();
            app.manage(RecoveryState {
                previous_session: Mutex::new(previous_session),
            });
            Ok(())
        })
        .menu(markdownpad_menu)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref().to_string();
            let focused_window = app
                .webview_windows()
                .into_values()
                .find(|window| window.is_focused().unwrap_or(false));

            if let Some(window) =
                focused_window.or_else(|| app.get_webview_window(MAIN_WINDOW_LABEL))
            {
                if id == "quit" {
                    // Quit closes every window, not just this one.
                    start_quit(app, window.label());
                    return;
                }

                // `emit` would broadcast to every window; deliver only to the
                // window the menu was used in.
                let _ = app.emit_to(window.label(), "menu-action", id);
            }
        })
        .on_window_event(|window, event| {
            let label = window.label();

            if !is_editor_window_label(label) {
                return;
            }

            let routing = window.state::<OpenFileRouting>();

            match event {
                WindowEvent::Focused(true) => {
                    if let Ok(mut last_focused) = routing.last_focused_editor.lock() {
                        *last_focused = Some(label.to_string());
                    }
                }
                WindowEvent::Destroyed => {
                    if let Ok(mut last_focused) = routing.last_focused_editor.lock() {
                        if last_focused.as_deref() == Some(label) {
                            *last_focused = None;
                        }
                    }

                    if let Ok(mut pending) = routing.pending_by_window.lock() {
                        pending.remove(label);
                    }

                    continue_quit(window.app_handle(), label);
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_recovery_snapshots,
            discard_recovery_snapshots,
            save_recovery_snapshot,
            discard_recovery_snapshot,
            load_launch_markdown_files,
            open_markdown_file_dialog,
            save_markdown_file_as_dialog,
            save_markdown_file,
            reload_markdown_file,
            open_external_url,
            sync_view_menu,
            take_pending_open_files,
            request_quit,
            cancel_quit
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
    fn launch_file_paths_keep_every_openable_file_in_order() {
        assert_eq!(
            launch_file_paths_from_args(args(&[
                "markdownpad.exe",
                "--some-tauri-flag",
                "C:\\tmp\\image.png",
                "C:\\tmp\\note.md",
                "C:\\tmp\\second.markdown",
                "C:\\tmp\\plain.txt",
            ])),
            vec![
                PathBuf::from("C:\\tmp\\note.md"),
                PathBuf::from("C:\\tmp\\second.markdown"),
                PathBuf::from("C:\\tmp\\plain.txt"),
            ]
        );
    }

    #[test]
    fn launch_file_paths_accept_extensions_case_insensitively() {
        assert_eq!(
            launch_file_paths_from_args(args(&["markdownpad.exe", "C:\\tmp\\NOTE.MD"])),
            vec![PathBuf::from("C:\\tmp\\NOTE.MD")]
        );
    }

    #[test]
    fn launch_file_paths_ignore_flags_and_other_files() {
        assert!(launch_file_paths_from_args(args(&[
            "markdownpad.exe",
            "--",
            "C:\\tmp\\photo.jpg",
        ]))
        .is_empty());
    }

    #[test]
    fn forwarded_file_paths_resolve_relative_paths_against_second_instance_cwd() {
        let cwd = env::temp_dir();
        let cwd_text = cwd.to_string_lossy().to_string();

        assert_eq!(
            forwarded_file_paths(
                vec!["markdownpad.exe".to_string(), "note.md".to_string()],
                &cwd_text,
            ),
            vec![cwd.join("note.md")]
        );
    }

    #[test]
    fn forwarded_file_paths_keep_absolute_paths() {
        let absolute = env::temp_dir().join("note.md");

        assert_eq!(
            forwarded_file_paths(
                vec![
                    "markdownpad.exe".to_string(),
                    absolute.to_string_lossy().to_string(),
                ],
                "/somewhere/else",
            ),
            vec![absolute]
        );
    }

    #[test]
    fn forwarded_file_paths_are_empty_for_a_launch_without_files() {
        assert!(forwarded_file_paths(vec!["markdownpad.exe".to_string()], "/tmp").is_empty());
    }

    #[test]
    fn print_windows_are_not_open_file_targets() {
        assert!(is_editor_window_label("main"));
        assert!(is_editor_window_label("markdownpad-0f0e"));
        assert!(!is_editor_window_label("markdownpad-print-0f0e"));
    }

    #[test]
    fn file_access_only_allows_registered_paths() {
        let access = FileAccess::default();

        assert!(access.check("C:\\notes\\a.md").is_err());
        access.allow("C:\\notes\\a.md");
        assert!(access.check("C:\\notes\\a.md").is_ok());
        assert!(access.check("C:\\Windows\\win.ini").is_err());
    }

    #[test]
    fn read_markdown_file_decodes_and_stamps_the_file() {
        let directory =
            env::temp_dir().join(format!("markdownpad-read-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("crlf.md");
        fs::write(&path, b"\xEF\xBB\xBF# Title\r\nBody\r\n").unwrap();

        let file = read_markdown_file(&path).unwrap();

        assert_eq!(file.content, "# Title\nBody\n");
        assert_eq!(file.encoding, TextEncoding::Utf8Bom);
        assert_eq!(file.line_ending, LineEnding::Crlf);
        assert_eq!(file.stamp.map(|stamp| stamp.size), Some(18));
        assert!(!file.path.starts_with("\\\\?\\"));

        fs::remove_dir_all(&directory).unwrap();
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
