//! Per-user Markdown file association for the portable exe (no installer).
//!
//! Registering writes only under HKEY_CURRENT_USER: a ProgID whose open
//! command points at this exe, "Open with" entries for the Markdown
//! extensions, and the Capabilities / RegisteredApplications entries that make
//! MarkdownPad appear in Windows' "Default apps" settings. Since Windows 8 an
//! app cannot make itself the default (the user's choice is protected), so
//! the user picks MarkdownPad there; the settings dialog opens that page.
//!
//! On Linux the association uses the Freedesktop desktop entry and
//! `mimeapps.list` instead (see `xdg`).

#[cfg(any(target_os = "linux", test))]
mod xdg;

/// Name under `Software\RegisteredApplications`, also used to open the app's
/// page in the Default apps settings.
pub const REGISTERED_APP_NAME: &str = "MarkdownPad";

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionStatus {
    pub extension: String,
    /// Explorer opens this extension with this exe.
    pub is_default: bool,
    /// The app Explorer opens it with now, if any.
    pub default_app: Option<String>,
    /// That app's exe, so another copy of MarkdownPad can be told apart.
    pub default_path: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssociationStatus {
    pub supported: bool,
    /// `"windows"` or `"linux"`: how the default app is chosen differs.
    pub platform: Option<&'static str>,
    /// The exe that is running now.
    pub exe_path: Option<String>,
    /// The exe the registered ProgID opens, when MarkdownPad is registered
    /// (it differs from `exe_path` after the portable exe was moved).
    pub registered_path: Option<String>,
    pub extensions: Vec<ExtensionStatus>,
}

/// The registry layout that registering writes on Windows. It is plain
/// data, so the tests check it on every OS.
#[cfg(any(target_os = "windows", test))]
mod registry_layout {
    use super::REGISTERED_APP_NAME;

    /// The ProgID Explorer uses to open Markdown files with MarkdownPad.
    pub const PROG_ID: &str = "MarkdownPad.Markdown";
    pub const EXTENSIONS: &[&str] = &[".md", ".markdown"];

    pub const CLASSES_KEY: &str = r"Software\Classes";
    #[cfg(target_os = "windows")]
    pub const APP_KEY: &str = r"Software\MarkdownPad";
    pub const CAPABILITIES_KEY: &str = r"Software\MarkdownPad\Capabilities";
    pub const REGISTERED_APPLICATIONS_KEY: &str = r"Software\RegisteredApplications";

    /// One registry value to write under HKEY_CURRENT_USER. `name: None` is the
    /// key's default value.
    #[derive(Debug, PartialEq, Eq)]
    pub struct RegistryValue {
        pub key: String,
        pub name: Option<&'static str>,
        pub data: String,
    }

    pub fn open_command(exe: &str) -> String {
        format!("\"{exe}\" \"%1\"")
    }

    /// The exe an open command runs: the quoted first part, or everything up to
    /// the first space.
    pub fn exe_from_command(command: &str) -> Option<String> {
        let command = command.trim();

        let exe = if let Some(rest) = command.strip_prefix('"') {
            rest.split('"').next()?
        } else {
            command.split(' ').next()?
        };

        (!exe.is_empty()).then(|| exe.to_string())
    }

    /// Windows' "How do you want to open this file?" picker, which
    /// `AssocQueryString` reports when no app is the default yet.
    pub fn is_app_picker(executable: &str) -> bool {
        executable
            .rsplit(['\\', '/'])
            .next()
            .is_some_and(|name| name.eq_ignore_ascii_case("OpenWith.exe"))
    }

    pub fn same_path(a: &str, b: &str) -> bool {
        let normalize = |path: &str| path.replace('/', "\\").to_lowercase();
        normalize(a) == normalize(b)
    }

    pub fn prog_id_key() -> String {
        format!(r"{CLASSES_KEY}\{PROG_ID}")
    }

    pub fn extension_key(extension: &str) -> String {
        format!(r"{CLASSES_KEY}\{extension}")
    }

    pub fn open_command_key() -> String {
        format!(r"{}\shell\open\command", prog_id_key())
    }

    /// Everything registering writes, for the exe at `exe`.
    pub fn registry_values(exe: &str) -> Vec<RegistryValue> {
        let value = |key: String, name: Option<&'static str>, data: &str| RegistryValue {
            key,
            name,
            data: data.to_string(),
        };
        let prog_id = prog_id_key();
        let mut values = vec![
            value(prog_id.clone(), None, "Markdown 文書"),
            value(
                format!(r"{prog_id}\DefaultIcon"),
                None,
                &format!("\"{exe}\",0"),
            ),
            value(
                format!(r"{prog_id}\shell\open"),
                Some("FriendlyAppName"),
                "MarkdownPad",
            ),
            value(open_command_key(), None, &open_command(exe)),
            value(
                CAPABILITIES_KEY.to_string(),
                Some("ApplicationName"),
                "MarkdownPad",
            ),
            value(
                CAPABILITIES_KEY.to_string(),
                Some("ApplicationDescription"),
                "軽量な Markdown エディタ",
            ),
        ];

        for extension in EXTENSIONS {
            values.push(value(
                format!(r"{}\OpenWithProgids", extension_key(extension)),
                Some(PROG_ID),
                "",
            ));
            values.push(RegistryValue {
                key: format!(r"{CAPABILITIES_KEY}\FileAssociations"),
                name: Some(*extension),
                data: PROG_ID.to_string(),
            });
        }

        values.push(value(
            REGISTERED_APPLICATIONS_KEY.to_string(),
            Some(REGISTERED_APP_NAME),
            CAPABILITIES_KEY,
        ));
        values
    }
}

#[cfg(any(target_os = "windows", test))]
use registry_layout::*;

/// The Default apps settings page for MarkdownPad (Windows 11; older
/// versions open the general Default apps page).
pub fn default_apps_settings_uri() -> String {
    format!("ms-settings:defaultapps?registeredAppUser={REGISTERED_APP_NAME}")
}

#[cfg(target_os = "windows")]
mod windows_registry {
    use super::*;
    use std::ptr;
    use windows_sys::Win32::Foundation::ERROR_FILE_NOT_FOUND;
    use windows_sys::Win32::System::Registry::{
        RegDeleteKeyValueW, RegDeleteTreeW, RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER,
        REG_SZ, RRF_RT_REG_SZ,
    };
    use windows_sys::Win32::UI::Shell::{
        AssocQueryStringW, SHChangeNotify, ASSOCF_NONE, ASSOCSTR, ASSOCSTR_EXECUTABLE,
        ASSOCSTR_FRIENDLYAPPNAME, SHCNE_ASSOCCHANGED, SHCNF_IDLIST,
    };

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn wide_or_null(value: Option<&str>) -> (Option<Vec<u16>>, *const u16) {
        match value {
            Some(value) => {
                let buffer = wide(value);
                let pointer = buffer.as_ptr();
                (Some(buffer), pointer)
            }
            None => (None, ptr::null()),
        }
    }

    fn registry_error(action: &str, code: u32) -> String {
        format!("レジストリを{action}できませんでした（エラー {code}）。")
    }

    fn set_string(key: &str, name: Option<&str>, data: &str) -> Result<(), String> {
        let key = wide(key);
        let (_name, name_ptr) = wide_or_null(name);
        let data = wide(data);
        let code = unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                name_ptr,
                REG_SZ,
                data.as_ptr().cast(),
                (data.len() * 2) as u32,
            )
        };

        if code == 0 {
            Ok(())
        } else {
            Err(registry_error("書き込み", code))
        }
    }

    fn get_string(key: &str, name: Option<&str>) -> Option<String> {
        let key = wide(key);
        let (_name, name_ptr) = wide_or_null(name);
        let mut buffer = vec![0u16; 2048];
        let mut size = (buffer.len() * 2) as u32;
        let code = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                name_ptr,
                RRF_RT_REG_SZ,
                ptr::null_mut(),
                buffer.as_mut_ptr().cast(),
                &mut size,
            )
        };

        if code != 0 {
            return None;
        }

        let len = buffer.iter().position(|value| *value == 0).unwrap_or(0);
        Some(String::from_utf16_lossy(&buffer[..len]))
    }

    fn ignore_missing(action: &str, code: u32) -> Result<(), String> {
        if code == 0 || code == ERROR_FILE_NOT_FOUND {
            Ok(())
        } else {
            Err(registry_error(action, code))
        }
    }

    fn delete_value(key: &str, name: Option<&str>) -> Result<(), String> {
        let key = wide(key);
        let (_name, name_ptr) = wide_or_null(name);
        let code = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name_ptr) };
        ignore_missing("削除", code)
    }

    fn delete_tree(key: &str) -> Result<(), String> {
        let key = wide(key);
        let code = unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, key.as_ptr()) };
        ignore_missing("削除", code)
    }

    fn notify_association_changed() {
        unsafe {
            SHChangeNotify(
                SHCNE_ASSOCCHANGED as i32,
                SHCNF_IDLIST,
                ptr::null(),
                ptr::null(),
            )
        };
    }

    fn query_association(extension: &str, what: ASSOCSTR) -> Option<String> {
        let extension = wide(extension);
        let verb = wide("open");
        let mut buffer = vec![0u16; 2048];
        let mut len = buffer.len() as u32;
        let result = unsafe {
            AssocQueryStringW(
                ASSOCF_NONE,
                what,
                extension.as_ptr(),
                verb.as_ptr(),
                buffer.as_mut_ptr(),
                &mut len,
            )
        };

        if result != 0 {
            return None;
        }

        let end = buffer.iter().position(|value| *value == 0).unwrap_or(0);
        let text = String::from_utf16_lossy(&buffer[..end]);
        (!text.is_empty()).then_some(text)
    }

    pub fn status(exe: &str) -> AssociationStatus {
        let registered_path =
            get_string(&open_command_key(), None).and_then(|command| exe_from_command(&command));
        let extensions = EXTENSIONS
            .iter()
            .map(|extension| {
                let executable = query_association(extension, ASSOCSTR_EXECUTABLE)
                    .filter(|executable| !is_app_picker(executable));
                ExtensionStatus {
                    extension: extension.to_string(),
                    is_default: executable
                        .as_deref()
                        .map(|executable| same_path(executable, exe))
                        .unwrap_or(false),
                    default_app: executable
                        .as_ref()
                        .and(query_association(extension, ASSOCSTR_FRIENDLYAPPNAME)),
                    default_path: executable,
                }
            })
            .collect();

        AssociationStatus {
            supported: true,
            platform: Some("windows"),
            exe_path: Some(exe.to_string()),
            registered_path,
            extensions,
        }
    }

    pub fn register(exe: &str) -> Result<(), String> {
        for value in registry_values(exe) {
            set_string(&value.key, value.name, &value.data)?;
        }

        // An extension no app claims for this user points at MarkdownPad.
        // Windows still asks which app to use when there are several
        // candidates, so the user may need to choose in the Default apps
        // settings anyway; an extension that has an app keeps it.
        for extension in EXTENSIONS {
            let key = extension_key(extension);

            if get_string(&key, None).is_none_or(|prog_id| prog_id.is_empty()) {
                set_string(&key, None, PROG_ID)?;
            }
        }

        notify_association_changed();
        Ok(())
    }

    pub fn unregister() -> Result<(), String> {
        for extension in EXTENSIONS {
            let key = extension_key(extension);

            if get_string(&key, None).as_deref() == Some(PROG_ID) {
                delete_value(&key, None)?;
            }

            delete_value(&format!(r"{key}\OpenWithProgids"), Some(PROG_ID))?;
        }

        delete_value(REGISTERED_APPLICATIONS_KEY, Some(REGISTERED_APP_NAME))?;
        delete_tree(APP_KEY)?;
        delete_tree(&prog_id_key())?;
        notify_association_changed();
        Ok(())
    }
}

fn current_exe_path() -> Result<String, String> {
    let exe = std::env::current_exe()
        .map_err(|error| format!("実行ファイルの場所を取得できませんでした。\n{error}"))?;
    let exe = dunce::canonicalize(&exe).unwrap_or(exe);
    Ok(exe.to_string_lossy().to_string())
}

#[cfg(target_os = "windows")]
pub fn status() -> Result<AssociationStatus, String> {
    Ok(windows_registry::status(&current_exe_path()?))
}

#[cfg(target_os = "windows")]
pub fn register() -> Result<AssociationStatus, String> {
    let exe = current_exe_path()?;
    windows_registry::register(&exe)?;
    Ok(windows_registry::status(&exe))
}

#[cfg(target_os = "windows")]
pub fn unregister() -> Result<AssociationStatus, String> {
    windows_registry::unregister()?;
    status()
}

/// The binary to register: an AppImage's own file rather than the copy
/// mounted while it runs.
#[cfg(target_os = "linux")]
fn linux_exe_path() -> Result<String, String> {
    match std::env::var("APPIMAGE") {
        Ok(path) if path.starts_with('/') => Ok(path),
        _ => current_exe_path(),
    }
}

#[cfg(target_os = "linux")]
pub fn status() -> Result<AssociationStatus, String> {
    Ok(xdg::status(&xdg::XdgDirs::from_env()?, &linux_exe_path()?))
}

/// On Linux registering also makes MarkdownPad the default app: the default
/// lives in the user's own mimeapps.list, which apps are expected to edit.
#[cfg(target_os = "linux")]
pub fn register() -> Result<AssociationStatus, String> {
    let dirs = xdg::XdgDirs::from_env()?;
    let exe = linux_exe_path()?;
    xdg::register(&dirs, &exe)?;
    Ok(xdg::status(&dirs, &exe))
}

#[cfg(target_os = "linux")]
pub fn unregister() -> Result<AssociationStatus, String> {
    xdg::unregister(&xdg::XdgDirs::from_env()?)?;
    status()
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn unsupported_status() -> AssociationStatus {
    AssociationStatus {
        supported: false,
        platform: None,
        exe_path: None,
        registered_path: None,
        extensions: Vec::new(),
    }
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
pub fn status() -> Result<AssociationStatus, String> {
    let _ = current_exe_path;
    Ok(unsupported_status())
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
pub fn register() -> Result<AssociationStatus, String> {
    Err("ファイルの関連付けは Windows と Linux でのみ利用できます。".to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
pub fn unregister() -> Result<AssociationStatus, String> {
    Err("ファイルの関連付けは Windows と Linux でのみ利用できます。".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXE: &str = r"C:\Tools\MarkdownPad\markdownpad.exe";

    #[test]
    fn open_command_quotes_the_exe_and_the_file() {
        assert_eq!(
            open_command(r"C:\Program Files\MarkdownPad\markdownpad.exe"),
            r#""C:\Program Files\MarkdownPad\markdownpad.exe" "%1""#
        );
    }

    #[test]
    fn exe_from_command_reads_quoted_and_bare_commands() {
        assert_eq!(
            exe_from_command(&open_command(r"C:\Program Files\M\markdownpad.exe")).as_deref(),
            Some(r"C:\Program Files\M\markdownpad.exe")
        );
        assert_eq!(
            exe_from_command(r"C:\M\markdownpad.exe %1").as_deref(),
            Some(r"C:\M\markdownpad.exe")
        );
        assert_eq!(exe_from_command("  "), None);
        assert_eq!(exe_from_command(r#""" "%1""#), None);
    }

    #[test]
    fn the_open_with_picker_is_not_an_app() {
        assert!(is_app_picker(r"C:\Windows\system32\OpenWith.exe"));
        assert!(is_app_picker("c:/windows/system32/openwith.exe"));
        assert!(!is_app_picker(EXE));
    }

    #[test]
    fn same_path_ignores_case_and_slash_style() {
        assert!(same_path(EXE, r"c:/tools/markdownpad/MARKDOWNPAD.EXE"));
        assert!(!same_path(EXE, r"C:\Other\markdownpad.exe"));
    }

    #[test]
    fn registry_values_stay_under_this_app_and_the_markdown_extensions() {
        let values = registry_values(EXE);

        for value in &values {
            assert!(
                value
                    .key
                    .starts_with(r"Software\Classes\MarkdownPad.Markdown")
                    || value.key.starts_with(r"Software\Classes\.md\")
                    || value.key.starts_with(r"Software\Classes\.markdown\")
                    || value.key.starts_with(r"Software\MarkdownPad\")
                    || value.key == CAPABILITIES_KEY
                    || value.key == REGISTERED_APPLICATIONS_KEY,
                "unexpected key {}",
                value.key
            );
        }

        let command = values
            .iter()
            .find(|value| value.key.ends_with(r"shell\open\command"))
            .unwrap();
        assert_eq!(command.data, open_command(EXE));

        for extension in EXTENSIONS {
            assert!(values.iter().any(|value| {
                value.key == format!(r"Software\Classes\{extension}\OpenWithProgids")
                    && value.name == Some(PROG_ID)
            }));
            assert!(values.iter().any(|value| {
                value.key.ends_with(r"Capabilities\FileAssociations")
                    && value.name == Some(*extension)
                    && value.data == PROG_ID
            }));
        }

        assert!(values.iter().any(|value| {
            value.key == REGISTERED_APPLICATIONS_KEY
                && value.name == Some(REGISTERED_APP_NAME)
                && value.data == CAPABILITIES_KEY
        }));
    }

    #[test]
    fn default_apps_settings_uri_names_the_registered_app() {
        assert_eq!(
            default_apps_settings_uri(),
            "ms-settings:defaultapps?registeredAppUser=MarkdownPad"
        );
    }
}
