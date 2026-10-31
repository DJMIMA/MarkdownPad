//! Locations of the crash-recovery snapshots.
//!
//! Every editor window writes its own snapshot (`recovery/<label>.json`), so
//! windows never overwrite or delete each other's data. Snapshots found when
//! the process starts belong to a session that did not end normally; they are
//! offered to the main window and removed only once the user has decided.

use std::{
    fs,
    path::{Path, PathBuf},
};

/// Id of the single snapshot file written by earlier versions.
pub const LEGACY_ID: &str = "legacy";
const LEGACY_FILE: &str = "recovery.snapshot.json";
const DIRECTORY: &str = "recovery";

pub fn snapshot_id_for_window(label: &str) -> String {
    let safe: String = label
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect();

    format!("{safe}.json")
}

/// Ids come back from the frontend, so only plain file names inside the
/// recovery directory are accepted.
pub fn is_snapshot_id(id: &str) -> bool {
    id == LEGACY_ID
        || (id.len() > ".json".len()
            && id.ends_with(".json")
            && !id.starts_with('.')
            && id.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
            }))
}

pub fn snapshot_path(app_data: &Path, id: &str) -> Option<PathBuf> {
    if id == LEGACY_ID {
        return Some(app_data.join(LEGACY_FILE));
    }

    is_snapshot_id(id).then(|| app_data.join(DIRECTORY).join(id))
}

pub fn snapshot_directory(app_data: &Path) -> PathBuf {
    app_data.join(DIRECTORY)
}

/// Snapshot ids present on disk, the main window's first.
pub fn existing_snapshot_ids(app_data: &Path) -> Vec<String> {
    let mut ids = Vec::new();
    let main_id = snapshot_id_for_window("main");

    if app_data.join(LEGACY_FILE).is_file() {
        ids.push(LEGACY_ID.to_string());
    }

    if let Ok(entries) = fs::read_dir(app_data.join(DIRECTORY)) {
        let mut names: Vec<String> = entries
            .filter_map(Result::ok)
            .filter(|entry| entry.path().is_file())
            .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
            .filter(|name| name != LEGACY_ID && is_snapshot_id(name))
            .collect();
        names.sort_by_key(|name| (name != &main_id, name.clone()));
        ids.extend(names);
    }

    ids
}

/// File paths of the tabs stored in a snapshot.
pub fn tab_paths(snapshot: &serde_json::Value) -> Vec<String> {
    snapshot
        .get("tabs")
        .and_then(serde_json::Value::as_array)
        .map(|tabs| {
            tabs.iter()
                .filter_map(|tab| tab.get("path").and_then(serde_json::Value::as_str))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_labels_become_safe_file_names() {
        assert_eq!(snapshot_id_for_window("main"), "main.json");
        assert_eq!(
            snapshot_id_for_window("markdownpad-0f0e-12"),
            "markdownpad-0f0e-12.json"
        );
        assert_eq!(snapshot_id_for_window("../x"), "___x.json");
    }

    #[test]
    fn ids_cannot_leave_the_recovery_directory() {
        assert!(is_snapshot_id("main.json"));
        assert!(is_snapshot_id(LEGACY_ID));
        assert!(!is_snapshot_id("../main.json"));
        assert!(!is_snapshot_id("..\\main.json"));
        assert!(!is_snapshot_id(".json"));
        assert!(!is_snapshot_id(".main.json.1.markdownpad-tmp"));
        assert!(!is_snapshot_id("C:main.json"));
        assert_eq!(snapshot_path(Path::new("/data"), "../x.json"), None);
    }

    #[test]
    fn lists_snapshots_with_the_main_window_first() {
        let app_data =
            std::env::temp_dir().join(format!("markdownpad-recovery-test-{}", std::process::id()));
        let directory = snapshot_directory(&app_data);
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("markdownpad-aaa.json"), "{}").unwrap();
        fs::write(directory.join("main.json"), "{}").unwrap();
        fs::write(directory.join(".main.json.1.markdownpad-tmp"), "").unwrap();
        fs::write(app_data.join(LEGACY_FILE), "{}").unwrap();

        assert_eq!(
            existing_snapshot_ids(&app_data),
            vec![LEGACY_ID, "main.json", "markdownpad-aaa.json"]
        );

        fs::remove_dir_all(&app_data).unwrap();
    }

    #[test]
    fn reads_tab_paths() {
        let snapshot = serde_json::json!({
            "tabs": [{ "path": "C:\\notes\\a.md" }, { "path": null }, {}]
        });

        assert_eq!(tab_paths(&snapshot), vec!["C:\\notes\\a.md"]);
    }
}
