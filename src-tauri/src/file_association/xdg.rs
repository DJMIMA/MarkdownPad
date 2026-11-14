//! Per-user Markdown file association on Linux (Freedesktop / XDG).
//!
//! Registering writes a desktop entry (`markdownpad.desktop`) whose Exec runs
//! this binary, the app icon, and makes the entry the default for Markdown in
//! the user's `mimeapps.list` ("Association between MIME types and
//! applications"). Unlike Windows, the default lives in the user's own
//! config file, so the app sets it when the user asks it to register.
//! Everything is written under the user's XDG data and config homes.

// Also built for the unit tests on other platforms, where the file system
// side goes unused.
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use super::{AssociationStatus, ExtensionStatus};
use std::{
    env, fs, io,
    path::{Path, PathBuf},
    process::Command,
};

pub const DESKTOP_ID: &str = "markdownpad.desktop";
/// `text/x-markdown` is an alias of `text/markdown` in shared-mime-info;
/// some apps still ask for it by that name.
pub const MIME_TYPES: &[&str] = &["text/markdown", "text/x-markdown"];
/// The extensions `text/markdown` covers, as shown in the settings dialog.
const EXTENSIONS_LABEL: &str = ".md / .markdown";
const ICON_NAME: &str = "markdownpad";
const ICONS: &[(&str, &[u8])] = &[
    ("32x32", include_bytes!("../../icons/32x32.png")),
    ("128x128", include_bytes!("../../icons/128x128.png")),
];
const DEFAULT_APPLICATIONS: &str = "Default Applications";
const ADDED_ASSOCIATIONS: &str = "Added Associations";

/// The XDG base directories and desktop names that decide where desktop
/// entries live and which `mimeapps.list` wins.
#[derive(Clone, Debug)]
pub struct XdgDirs {
    pub config_home: PathBuf,
    pub config_dirs: Vec<PathBuf>,
    pub data_home: PathBuf,
    pub data_dirs: Vec<PathBuf>,
    /// `XDG_CURRENT_DESKTOP`, lower-cased, most specific first.
    pub desktops: Vec<String>,
}

fn env_path(name: &str) -> Option<PathBuf> {
    env::var_os(name)
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
}

fn env_paths(name: &str, default: &str) -> Vec<PathBuf> {
    let value = env::var(name)
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| default.to_string());

    value
        .split(':')
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .collect()
}

impl XdgDirs {
    pub fn from_env() -> Result<Self, String> {
        let home = env_path("HOME")
            .ok_or_else(|| "ホームフォルダの場所が分かりませんでした。".to_string())?;

        Ok(Self {
            config_home: env_path("XDG_CONFIG_HOME").unwrap_or_else(|| home.join(".config")),
            config_dirs: env_paths("XDG_CONFIG_DIRS", "/etc/xdg"),
            data_home: env_path("XDG_DATA_HOME").unwrap_or_else(|| home.join(".local/share")),
            data_dirs: env_paths("XDG_DATA_DIRS", "/usr/local/share:/usr/share"),
            desktops: env::var("XDG_CURRENT_DESKTOP")
                .unwrap_or_default()
                .split(':')
                .filter(|name| !name.is_empty())
                .map(str::to_lowercase)
                .collect(),
        })
    }

    fn applications_dir(&self) -> PathBuf {
        self.data_home.join("applications")
    }

    fn own_desktop_file(&self) -> PathBuf {
        self.applications_dir().join(DESKTOP_ID)
    }

    fn icon_file(&self, size: &str) -> PathBuf {
        self.data_home
            .join("icons/hicolor")
            .join(size)
            .join("apps")
            .join(format!("{ICON_NAME}.png"))
    }

    /// The `mimeapps.list` files in precedence order: desktop-specific before
    /// generic, user config, system config, then the (deprecated) data dirs.
    fn mimeapps_files(&self) -> Vec<PathBuf> {
        let mut directories = vec![self.config_home.clone()];
        directories.extend(self.config_dirs.iter().cloned());
        directories.push(self.applications_dir());
        directories.extend(self.data_dirs.iter().map(|dir| dir.join("applications")));

        let mut files = Vec::new();

        for directory in directories {
            for desktop in &self.desktops {
                files.push(directory.join(format!("{desktop}-mimeapps.list")));
            }

            files.push(directory.join("mimeapps.list"));
        }

        files
    }

    /// Where a desktop entry with this id is installed, user entries first.
    /// An id like `kde-okular.desktop` may also live at `kde/okular.desktop`.
    fn find_desktop_file(&self, id: &str) -> Option<PathBuf> {
        let mut roots = vec![self.applications_dir()];
        roots.extend(self.data_dirs.iter().map(|dir| dir.join("applications")));

        roots.iter().find_map(|root| {
            let direct = root.join(id);

            if direct.is_file() {
                return Some(direct);
            }

            let (prefix, rest) = id.split_once('-')?;
            let nested = root.join(prefix).join(rest);
            nested.is_file().then_some(nested)
        })
    }
}

/// The parts of a desktop entry the settings dialog needs.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct DesktopEntry {
    pub name: Option<String>,
    pub exec: Option<String>,
    pub hidden: bool,
}

/// Undoes the escapes of a desktop-entry string value.
fn unescape_value(value: &str) -> String {
    let mut text = String::with_capacity(value.len());
    let mut chars = value.chars();

    while let Some(c) = chars.next() {
        if c != '\\' {
            text.push(c);
            continue;
        }

        match chars.next() {
            Some('s') => text.push(' '),
            Some('n') => text.push('\n'),
            Some('t') => text.push('\t'),
            Some('r') => text.push('\r'),
            Some(other) => text.push(other),
            None => text.push('\\'),
        }
    }

    text
}

fn escape_value(value: &str) -> String {
    let mut text = String::with_capacity(value.len());

    for c in value.chars() {
        match c {
            '\\' => text.push_str("\\\\"),
            '\n' => text.push_str("\\n"),
            '\t' => text.push_str("\\t"),
            '\r' => text.push_str("\\r"),
            _ => text.push(c),
        }
    }

    text
}

pub fn parse_desktop_entry(content: &str) -> DesktopEntry {
    let mut entry = DesktopEntry::default();
    let mut in_entry = false;

    for line in content.lines() {
        let line = line.trim();

        if line.starts_with('[') {
            in_entry = line == "[Desktop Entry]";
            continue;
        }

        if !in_entry || line.starts_with('#') {
            continue;
        }

        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let value = unescape_value(value.trim());

        match key.trim() {
            "Name" => entry.name = Some(value),
            "Exec" => entry.exec = Some(value),
            "Hidden" => entry.hidden = value == "true",
            _ => {}
        }
    }

    entry
}

/// The Exec value that runs `exe` with the files to open, quoted as the
/// Desktop Entry spec asks (then escaped again as a string value).
pub fn exec_value(exe: &str) -> String {
    let mut quoted = String::from("\"");

    for c in exe.chars() {
        match c {
            '"' | '`' | '$' | '\\' => {
                quoted.push('\\');
                quoted.push(c);
            }
            '%' => quoted.push_str("%%"),
            _ => quoted.push(c),
        }
    }

    quoted.push('"');
    format!("{} %F", escape_value(&quoted))
}

/// The program an (already unescaped) Exec value runs: its first argument.
pub fn exec_program(exec: &str) -> Option<String> {
    let exec = exec.trim_start();
    let mut program = String::new();

    if let Some(rest) = exec.strip_prefix('"') {
        let mut chars = rest.chars();

        loop {
            match chars.next()? {
                '"' => break,
                '\\' => program.push(chars.next()?),
                c => program.push(c),
            }
        }
    } else {
        program.extend(exec.chars().take_while(|c| !c.is_whitespace()));
    }

    let program = program.replace("%%", "%");
    (!program.is_empty()).then_some(program)
}

pub fn desktop_entry(exe: &str) -> String {
    let mime_types: String = MIME_TYPES.iter().map(|mime| format!("{mime};")).collect();

    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=MarkdownPad\n\
         Comment=軽量な Markdown エディタ\n\
         Exec={}\n\
         Icon={ICON_NAME}\n\
         Terminal=false\n\
         Categories=Utility;TextEditor;\n\
         MimeType={mime_types}\n\
         StartupWMClass=markdownpad\n",
        exec_value(exe)
    )
}

fn group_name(line: &str) -> Option<&str> {
    line.trim().strip_prefix('[')?.strip_suffix(']')
}

fn app_list(value: &str) -> Vec<String> {
    value
        .split(';')
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .collect()
}

fn list_line(mime: &str, ids: &[String]) -> String {
    let ids: String = ids.iter().map(|id| format!("{id};")).collect();
    format!("{mime}={ids}")
}

fn key_value(line: &str) -> Option<(&str, &str)> {
    let line = line.trim();

    if line.starts_with('#') {
        return None;
    }

    let (key, value) = line.split_once('=')?;
    Some((key.trim(), value.trim()))
}

/// The apps a `mimeapps.list` makes the default for `mime`, in order.
pub fn default_apps(content: &str, mime: &str) -> Vec<String> {
    let mut group = None;

    for line in content.lines() {
        if let Some(name) = group_name(line) {
            group = Some(name);
        } else if group == Some(DEFAULT_APPLICATIONS) {
            if let Some((key, value)) = key_value(line) {
                if key == mime {
                    return app_list(value);
                }
            }
        }
    }

    Vec::new()
}

fn join_lines(lines: Vec<String>) -> String {
    let mut text = lines.join("\n");
    text.push('\n');
    text
}

/// `content` with `id` as the first default app for each MIME type; the apps
/// listed before stay as fallbacks after it. Everything else is kept.
pub fn with_default(content: &str, mime_types: &[&str], id: &str) -> String {
    let mut lines: Vec<String> = content.lines().map(str::to_string).collect();
    let header = format!("[{DEFAULT_APPLICATIONS}]");
    let header_index = match lines
        .iter()
        .position(|line| group_name(line) == Some(DEFAULT_APPLICATIONS))
    {
        Some(index) => index,
        None => {
            if lines.last().is_some_and(|line| !line.trim().is_empty()) {
                lines.push(String::new());
            }

            lines.push(header);
            lines.len() - 1
        }
    };

    for mime in mime_types {
        let group_end = lines[header_index + 1..]
            .iter()
            .position(|line| group_name(line).is_some())
            .map_or(lines.len(), |index| header_index + 1 + index);
        let existing = (header_index + 1..group_end)
            .find(|&index| key_value(&lines[index]).is_some_and(|(key, _)| key == *mime));

        match existing {
            Some(index) => {
                let (_, value) = key_value(&lines[index]).unwrap_or_default();
                let mut ids = vec![id.to_string()];
                ids.extend(app_list(value).into_iter().filter(|other| other != id));
                lines[index] = list_line(mime, &ids);
            }
            None => {
                // After the group's last entry, before the blank lines that
                // separate it from the next group.
                let at = (header_index + 1..group_end)
                    .rev()
                    .find(|&index| !lines[index].trim().is_empty())
                    .map_or(header_index + 1, |index| index + 1);
                lines.insert(at, list_line(mime, &[id.to_string()]));
            }
        }
    }

    join_lines(lines)
}

/// `content` without `id` among the default apps and added associations; a
/// line left with no app is dropped. Everything else is kept.
pub fn without_app(content: &str, id: &str) -> String {
    let mut group = None;
    let mut lines = Vec::new();

    for line in content.lines() {
        if let Some(name) = group_name(line) {
            group = Some(name.to_string());
            lines.push(line.to_string());
            continue;
        }

        let in_app_group = matches!(
            group.as_deref(),
            Some(DEFAULT_APPLICATIONS) | Some(ADDED_ASSOCIATIONS)
        );

        match key_value(line).filter(|_| in_app_group) {
            Some((key, value)) => {
                let ids = app_list(value);

                if !ids.iter().any(|other| other == id) {
                    lines.push(line.to_string());
                    continue;
                }

                let rest: Vec<String> = ids.into_iter().filter(|other| other != id).collect();

                if !rest.is_empty() {
                    lines.push(list_line(key, &rest));
                }
            }
            None => lines.push(line.to_string()),
        }
    }

    join_lines(lines)
}

fn read_desktop_entry(path: &Path) -> Option<DesktopEntry> {
    fs::read_to_string(path)
        .ok()
        .map(|content| parse_desktop_entry(&content))
}

/// The desktop entry id that opens `mime` by default: the first listed app
/// that is installed, from the first `mimeapps.list` that names one.
pub fn default_app(dirs: &XdgDirs, mime: &str) -> Option<String> {
    dirs.mimeapps_files().iter().find_map(|file| {
        let content = fs::read_to_string(file).ok()?;

        default_apps(&content, mime).into_iter().find(|id| {
            dirs.find_desktop_file(id)
                .and_then(|path| read_desktop_entry(&path))
                .is_some_and(|entry| !entry.hidden)
        })
    })
}

pub fn status(dirs: &XdgDirs, exe: &str) -> AssociationStatus {
    let registered_path = read_desktop_entry(&dirs.own_desktop_file())
        .and_then(|entry| entry.exec)
        .and_then(|exec| exec_program(&exec));
    let default_id = default_app(dirs, MIME_TYPES[0]);
    let default_entry = default_id
        .as_deref()
        .and_then(|id| dirs.find_desktop_file(id))
        .and_then(|path| read_desktop_entry(&path));
    let default_path = default_entry
        .as_ref()
        .and_then(|entry| entry.exec.as_deref())
        .and_then(exec_program);
    let is_default =
        default_id.as_deref() == Some(DESKTOP_ID) && default_path.as_deref() == Some(exe);
    let default_app = default_entry
        .and_then(|entry| entry.name)
        .or_else(|| default_id.clone());

    AssociationStatus {
        supported: true,
        platform: Some("linux"),
        exe_path: Some(exe.to_string()),
        registered_path,
        extensions: vec![ExtensionStatus {
            extension: EXTENSIONS_LABEL.to_string(),
            is_default,
            default_app,
            default_path,
        }],
    }
}

fn write_error(path: &Path, error: io::Error) -> String {
    format!("{} を書き込めませんでした。\n{error}", path.display())
}

/// Writes `bytes` to `path` in one step, through a symbolic link (a dotfiles
/// manager may own the real file).
fn write_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let target = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());

    if let Some(directory) = target.parent() {
        fs::create_dir_all(directory).map_err(|error| write_error(directory, error))?;
    }

    crate::text_file::write_atomically(&target, bytes).map_err(|error| write_error(path, error))
}

fn read_optional(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(content) => Ok(Some(content)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!(
            "{} を読み込めませんでした。\n{error}",
            path.display()
        )),
    }
}

fn remove_optional(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "{} を削除できませんでした。\n{error}",
            path.display()
        )),
    }
}

/// Rebuilds the "Open with" cache and the icon cache when the tools are
/// installed. Both are optional: desktops also scan the folders themselves.
fn refresh_caches(dirs: &XdgDirs) {
    let _ = Command::new("update-desktop-database")
        .arg(dirs.applications_dir())
        .status();

    let icon_theme = dirs.data_home.join("icons/hicolor");

    // Only refresh a cache that exists; a missing one makes GTK scan the
    // folder, while a stale one hides the new icon.
    if icon_theme.join("icon-theme.cache").is_file() {
        let _ = Command::new("gtk-update-icon-cache")
            .args(["-q", "-f", "-t"])
            .arg(&icon_theme)
            .status();
    }
}

pub fn register(dirs: &XdgDirs, exe: &str) -> Result<(), String> {
    write_file(&dirs.own_desktop_file(), desktop_entry(exe).as_bytes())?;

    for (size, png) in ICONS {
        write_file(&dirs.icon_file(size), png)?;
    }

    // The user's mimeapps.list, and a desktop-specific one that would
    // otherwise keep another default for Markdown.
    let generic = dirs.config_home.join("mimeapps.list");
    let mut files = vec![generic.clone()];

    for desktop in &dirs.desktops {
        let file = dirs.config_home.join(format!("{desktop}-mimeapps.list"));

        if let Some(content) = read_optional(&file)? {
            if MIME_TYPES
                .iter()
                .any(|mime| !default_apps(&content, mime).is_empty())
            {
                files.push(file);
            }
        }
    }

    for file in files {
        let content = read_optional(&file)?.unwrap_or_default();
        write_file(
            &file,
            with_default(&content, MIME_TYPES, DESKTOP_ID).as_bytes(),
        )?;
    }

    refresh_caches(dirs);
    Ok(())
}

pub fn unregister(dirs: &XdgDirs) -> Result<(), String> {
    // Every mimeapps.list the user owns, including other desktops' ones.
    let mut files: Vec<PathBuf> = fs::read_dir(&dirs.config_home)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .filter(|path| {
                    path.file_name()
                        .and_then(|name| name.to_str())
                        .is_some_and(|name| name.ends_with("mimeapps.list"))
                })
                .collect()
        })
        .unwrap_or_default();
    files.push(dirs.applications_dir().join("mimeapps.list"));

    for file in files {
        let Some(content) = read_optional(&file)? else {
            continue;
        };
        let updated = without_app(&content, DESKTOP_ID);

        if updated != content {
            write_file(&file, updated.as_bytes())?;
        }
    }

    remove_optional(&dirs.own_desktop_file())?;

    for (size, _) in ICONS {
        remove_optional(&dirs.icon_file(size))?;
    }

    refresh_caches(dirs);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXE: &str = "/home/user/Apps/Markdown Pad/markdownpad";

    fn temp_dirs(name: &str) -> (PathBuf, XdgDirs) {
        let root = env::temp_dir().join(format!("markdownpad-xdg-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let dirs = XdgDirs {
            config_home: root.join("config"),
            config_dirs: vec![root.join("etc-xdg")],
            data_home: root.join("data"),
            data_dirs: vec![root.join("usr-share")],
            desktops: vec!["lxqt".to_string()],
        };
        (root, dirs)
    }

    fn put(path: &Path, content: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    #[test]
    fn exec_value_quotes_the_program_and_reads_back() {
        assert_eq!(exec_value("/opt/markdownpad"), "\"/opt/markdownpad\" %F");

        for exe in [
            EXE,
            "/tmp/odd \"quote\" $HOME `x` back\\slash 100%/markdownpad",
        ] {
            let entry = parse_desktop_entry(&desktop_entry(exe));
            assert_eq!(
                entry.exec.as_deref().and_then(exec_program).as_deref(),
                Some(exe),
                "{exe}"
            );
        }
    }

    #[test]
    fn exec_program_reads_bare_commands() {
        assert_eq!(
            exec_program("/home/u/.local/bin/markdownpad %F").as_deref(),
            Some("/home/u/.local/bin/markdownpad")
        );
        assert_eq!(exec_program("okular %U").as_deref(), Some("okular"));
        assert_eq!(exec_program("  "), None);
        assert_eq!(exec_program("\"unterminated"), None);
    }

    #[test]
    fn desktop_entry_lists_the_markdown_types() {
        let entry = desktop_entry(EXE);
        assert!(entry.starts_with("[Desktop Entry]\n"));
        assert!(entry.contains("\nMimeType=text/markdown;text/x-markdown;\n"));
        assert!(entry.contains("\nIcon=markdownpad\n"));
        assert_eq!(
            parse_desktop_entry(&entry).name.as_deref(),
            Some("MarkdownPad")
        );
    }

    #[test]
    fn parse_desktop_entry_reads_only_the_main_group() {
        let entry = parse_desktop_entry(
            "[Desktop Entry]\nName=Okular\nName[ja]=オキュラー\nExec=okular %U\n\
             # Name=comment\n[Desktop Action new]\nName=New\nExec=okular --new\n",
        );
        assert_eq!(
            entry,
            DesktopEntry {
                name: Some("Okular".to_string()),
                exec: Some("okular %U".to_string()),
                hidden: false,
            }
        );
        assert!(parse_desktop_entry("[Desktop Entry]\nHidden=true\n").hidden);
    }

    #[test]
    fn with_default_puts_markdownpad_first_and_keeps_the_rest() {
        let content = "[Default Applications]\n\
                       text/html=firefox.desktop\n\
                       text/markdown=okular.desktop;markdownpad.desktop;\n\
                       \n\
                       [Added Associations]\n\
                       text/markdown=emacs.desktop;\n";
        assert_eq!(
            with_default(content, MIME_TYPES, DESKTOP_ID),
            "[Default Applications]\n\
             text/html=firefox.desktop\n\
             text/markdown=markdownpad.desktop;okular.desktop;\n\
             text/x-markdown=markdownpad.desktop;\n\
             \n\
             [Added Associations]\n\
             text/markdown=emacs.desktop;\n"
        );
    }

    #[test]
    fn with_default_adds_the_group_when_missing() {
        assert_eq!(
            with_default("", MIME_TYPES, DESKTOP_ID),
            "[Default Applications]\n\
             text/markdown=markdownpad.desktop;\n\
             text/x-markdown=markdownpad.desktop;\n"
        );
        assert_eq!(
            with_default(
                "[Added Associations]\na/b=c.desktop;",
                &["text/markdown"],
                DESKTOP_ID
            ),
            "[Added Associations]\na/b=c.desktop;\n\n\
             [Default Applications]\ntext/markdown=markdownpad.desktop;\n"
        );
    }

    #[test]
    fn without_app_removes_only_markdownpad() {
        let content = "[Default Applications]\n\
                       text/markdown=markdownpad.desktop\n\
                       text/x-markdown=markdownpad.desktop;okular.desktop;\n\
                       text/html=firefox.desktop\n\
                       [Added Associations]\n\
                       text/markdown=markdownpad.desktop;\n\
                       [Removed Associations]\n\
                       text/plain=markdownpad.desktop;\n";
        assert_eq!(
            without_app(content, DESKTOP_ID),
            "[Default Applications]\n\
             text/x-markdown=okular.desktop;\n\
             text/html=firefox.desktop\n\
             [Added Associations]\n\
             [Removed Associations]\n\
             text/plain=markdownpad.desktop;\n"
        );
    }

    #[test]
    fn the_desktop_specific_list_wins_and_uninstalled_apps_are_skipped() {
        let (root, dirs) = temp_dirs("lookup");
        put(
            &dirs.data_dirs[0].join("applications/okular.desktop"),
            "[Desktop Entry]\nName=Okular\nExec=okular %U\n",
        );
        put(
            &dirs.config_home.join("mimeapps.list"),
            "[Default Applications]\ntext/markdown=okular.desktop;\n",
        );
        assert_eq!(
            default_app(&dirs, "text/markdown").as_deref(),
            Some("okular.desktop")
        );

        put(
            &dirs.config_home.join("lxqt-mimeapps.list"),
            "[Default Applications]\ntext/markdown=gone.desktop;markdownpad.desktop;\n",
        );
        assert_eq!(
            default_app(&dirs, "text/markdown").as_deref(),
            Some("okular.desktop"),
            "markdownpad.desktop is not installed yet"
        );

        put(&dirs.own_desktop_file(), &desktop_entry(EXE));
        assert_eq!(
            default_app(&dirs, "text/markdown").as_deref(),
            Some(DESKTOP_ID)
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn register_then_unregister_round_trips() {
        let (root, dirs) = temp_dirs("register");
        put(
            &dirs.data_dirs[0].join("applications/okular.desktop"),
            "[Desktop Entry]\nName=Okular\nExec=okular %U\n",
        );
        let lxqt_list = dirs.config_home.join("lxqt-mimeapps.list");
        let lxqt_before = "[Default Applications]\n\
                           application/pdf=okular.desktop\n\
                           text/markdown=okular.desktop\n";
        put(&lxqt_list, lxqt_before);
        put(
            &dirs.config_home.join("mimeapps.list"),
            "[Default Applications]\ntext/html=firefox.desktop\n",
        );

        let before = status(&dirs, EXE);
        assert_eq!(before.registered_path, None);
        assert!(!before.extensions[0].is_default);
        assert_eq!(before.extensions[0].default_app.as_deref(), Some("Okular"));
        assert_eq!(before.extensions[0].default_path.as_deref(), Some("okular"));

        register(&dirs, EXE).unwrap();
        let registered = status(&dirs, EXE);
        assert_eq!(registered.registered_path.as_deref(), Some(EXE));
        assert!(registered.extensions[0].is_default);
        assert_eq!(
            registered.extensions[0].default_app.as_deref(),
            Some("MarkdownPad")
        );
        assert!(dirs.icon_file("128x128").is_file());

        // Another copy of the binary sees the registration as moved.
        let elsewhere = status(&dirs, "/usr/local/bin/markdownpad");
        assert_eq!(elsewhere.registered_path.as_deref(), Some(EXE));
        assert!(!elsewhere.extensions[0].is_default);

        unregister(&dirs).unwrap();
        let after = status(&dirs, EXE);
        assert_eq!(after.registered_path, None);
        assert_eq!(after.extensions[0].default_app.as_deref(), Some("Okular"));
        assert!(!dirs.own_desktop_file().exists());
        assert!(!dirs.icon_file("128x128").exists());
        assert_eq!(
            fs::read_to_string(&lxqt_list).unwrap(),
            "[Default Applications]\n\
             application/pdf=okular.desktop\n\
             text/markdown=okular.desktop;\n",
            "the earlier default is back"
        );
        assert_eq!(
            fs::read_to_string(dirs.config_home.join("mimeapps.list")).unwrap(),
            "[Default Applications]\ntext/html=firefox.desktop\n"
        );

        fs::remove_dir_all(root).unwrap();
    }
}
