//! Reading and writing the user's text files.
//!
//! Files are decoded to a plain `\n`-separated string for the editor, and the
//! encoding, byte order mark and line ending found on disk are remembered so
//! that saving writes the file back in the same form. Writes go to a
//! temporary file that then replaces the original, so a crash or a full disk
//! never leaves a half-written Markdown file behind.

use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TextEncoding {
    #[serde(rename = "utf-8")]
    Utf8,
    #[serde(rename = "utf-8-bom")]
    Utf8Bom,
    #[serde(rename = "utf-16le")]
    Utf16Le,
    #[serde(rename = "utf-16be")]
    Utf16Be,
    #[serde(rename = "shift_jis")]
    ShiftJis,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LineEnding {
    Lf,
    Crlf,
}

/// Identifies the version of a file on disk, to notice changes made by other
/// programs between opening (or saving) a file and saving it again.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStamp {
    pub modified_ms: u64,
    pub size: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub struct DecodedText {
    pub content: String,
    pub encoding: TextEncoding,
    pub line_ending: LineEnding,
}

#[derive(Debug, PartialEq, Eq)]
pub enum EncodeError {
    /// The text has characters the target encoding cannot represent.
    Unencodable,
}

const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];
const UTF16LE_BOM: &[u8] = &[0xFF, 0xFE];
const UTF16BE_BOM: &[u8] = &[0xFE, 0xFF];

fn decode_utf16(bytes: &[u8], little_endian: bool) -> Option<String> {
    if !bytes.len().is_multiple_of(2) {
        return None;
    }

    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| {
            if little_endian {
                u16::from_le_bytes([pair[0], pair[1]])
            } else {
                u16::from_be_bytes([pair[0], pair[1]])
            }
        })
        .collect();

    String::from_utf16(&units).ok()
}

/// Detects the dominant line ending and returns the text with every line
/// ending turned into `\n`.
pub fn normalize_line_endings(text: &str) -> (String, LineEnding) {
    if !text.contains('\r') {
        return (text.to_string(), LineEnding::Lf);
    }

    let crlf = text.matches("\r\n").count();
    let lone_lf = text.matches('\n').count() - crlf;
    let line_ending = if crlf > 0 && crlf >= lone_lf {
        LineEnding::Crlf
    } else {
        LineEnding::Lf
    };

    (text.replace("\r\n", "\n").replace('\r', "\n"), line_ending)
}

pub fn decode_text(bytes: &[u8]) -> Result<DecodedText, String> {
    let (text, encoding) = if let Some(rest) = bytes.strip_prefix(UTF8_BOM) {
        let text = std::str::from_utf8(rest)
            .map_err(|_| "UTF-8 (BOM 付き) として読み込めませんでした。".to_string())?;
        (text.to_string(), TextEncoding::Utf8Bom)
    } else if let Some(rest) = bytes.strip_prefix(UTF16LE_BOM) {
        let text = decode_utf16(rest, true)
            .ok_or_else(|| "UTF-16 として読み込めませんでした。".to_string())?;
        (text, TextEncoding::Utf16Le)
    } else if let Some(rest) = bytes.strip_prefix(UTF16BE_BOM) {
        let text = decode_utf16(rest, false)
            .ok_or_else(|| "UTF-16 として読み込めませんでした。".to_string())?;
        (text, TextEncoding::Utf16Be)
    } else if let Ok(text) = std::str::from_utf8(bytes) {
        (text.to_string(), TextEncoding::Utf8)
    } else if let Some(text) =
        encoding_rs::SHIFT_JIS.decode_without_bom_handling_and_without_replacement(bytes)
    {
        (text.into_owned(), TextEncoding::ShiftJis)
    } else {
        return Err(
            "対応していない文字コードです。UTF-8、UTF-16、Shift_JIS のファイルを開けます。"
                .to_string(),
        );
    };

    let (content, line_ending) = normalize_line_endings(&text);

    Ok(DecodedText {
        content,
        encoding,
        line_ending,
    })
}

pub fn encode_text(
    content: &str,
    encoding: TextEncoding,
    line_ending: LineEnding,
) -> Result<Vec<u8>, EncodeError> {
    let (normalized, _) = normalize_line_endings(content);
    let text = match line_ending {
        LineEnding::Lf => normalized,
        LineEnding::Crlf => normalized.replace('\n', "\r\n"),
    };

    match encoding {
        TextEncoding::Utf8 => Ok(text.into_bytes()),
        TextEncoding::Utf8Bom => {
            let mut bytes = UTF8_BOM.to_vec();
            bytes.extend_from_slice(text.as_bytes());
            Ok(bytes)
        }
        TextEncoding::Utf16Le => {
            let mut bytes = UTF16LE_BOM.to_vec();
            bytes.extend(text.encode_utf16().flat_map(u16::to_le_bytes));
            Ok(bytes)
        }
        TextEncoding::Utf16Be => {
            let mut bytes = UTF16BE_BOM.to_vec();
            bytes.extend(text.encode_utf16().flat_map(u16::to_be_bytes));
            Ok(bytes)
        }
        TextEncoding::ShiftJis => {
            let (bytes, _, had_errors) = encoding_rs::SHIFT_JIS.encode(&text);

            if had_errors {
                Err(EncodeError::Unencodable)
            } else {
                Ok(bytes.into_owned())
            }
        }
    }
}

pub fn file_stamp(path: &Path) -> io::Result<FileStamp> {
    let metadata = fs::metadata(path)?;
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);

    Ok(FileStamp {
        modified_ms,
        size: metadata.len(),
    })
}

/// Canonical form of a path without Windows' `\\?\` verbatim prefix, so paths
/// shown to the user look the way Explorer shows them.
pub fn canonical_path(path: &Path) -> PathBuf {
    dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn temporary_sibling(path: &Path) -> io::Result<PathBuf> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);

    let file_name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "the path has no file name"))?;
    let directory = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.subsec_nanos())
        .unwrap_or(0);
    let unique = format!(
        "{}-{}-{}",
        std::process::id(),
        nanos,
        COUNTER.fetch_add(1, Ordering::Relaxed)
    );

    Ok(directory.join(format!(
        ".{}.{unique}.markdownpad-tmp",
        file_name.to_string_lossy()
    )))
}

#[cfg(target_os = "windows")]
fn replace_with(temporary: &Path, target: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        ReplaceFileW, REPLACEFILE_IGNORE_ACL_ERRORS, REPLACEFILE_IGNORE_MERGE_ERRORS,
    };

    if !target.exists() {
        return fs::rename(temporary, target);
    }

    let wide = |path: &Path| -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    };
    let target_wide = wide(target);
    let temporary_wide = wide(temporary);

    // ReplaceFileW keeps the original file's attributes, ACL and creation
    // time, which a plain rename would lose.
    let replaced = unsafe {
        ReplaceFileW(
            target_wide.as_ptr(),
            temporary_wide.as_ptr(),
            std::ptr::null(),
            REPLACEFILE_IGNORE_MERGE_ERRORS | REPLACEFILE_IGNORE_ACL_ERRORS,
            std::ptr::null(),
            std::ptr::null(),
        )
    };

    if replaced != 0 {
        return Ok(());
    }

    let error = io::Error::last_os_error();

    // Some file systems do not support ReplaceFileW; a rename still replaces
    // the file in one step.
    fs::rename(temporary, target).map_err(|_| error)
}

#[cfg(not(target_os = "windows"))]
fn replace_with(temporary: &Path, target: &Path) -> io::Result<()> {
    if let Ok(metadata) = fs::metadata(target) {
        fs::set_permissions(temporary, metadata.permissions())?;
    }

    fs::rename(temporary, target)
}

/// Writes `bytes` to `path` without ever leaving a partly written file: the
/// data goes to a temporary file in the same directory, is flushed to disk,
/// and then replaces the target in one step.
pub fn write_atomically(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let temporary = temporary_sibling(path)?;
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        replace_with(&temporary, path)
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_plain_utf8_with_lf() {
        let decoded = decode_text("# 見出し\n本文\n".as_bytes()).unwrap();

        assert_eq!(decoded.content, "# 見出し\n本文\n");
        assert_eq!(decoded.encoding, TextEncoding::Utf8);
        assert_eq!(decoded.line_ending, LineEnding::Lf);
    }

    #[test]
    fn strips_the_utf8_bom_and_remembers_it() {
        let mut bytes = UTF8_BOM.to_vec();
        bytes.extend_from_slice("# 見出し\r\n本文".as_bytes());
        let decoded = decode_text(&bytes).unwrap();

        assert_eq!(decoded.content, "# 見出し\n本文");
        assert_eq!(decoded.encoding, TextEncoding::Utf8Bom);
        assert_eq!(decoded.line_ending, LineEnding::Crlf);
        assert_eq!(
            encode_text(&decoded.content, decoded.encoding, decoded.line_ending).unwrap(),
            bytes
        );
    }

    #[test]
    fn reads_and_writes_shift_jis() {
        let (bytes, _, _) = encoding_rs::SHIFT_JIS.encode("# 日本語の見出し\r\n本文です\r\n");
        let decoded = decode_text(&bytes).unwrap();

        assert_eq!(decoded.content, "# 日本語の見出し\n本文です\n");
        assert_eq!(decoded.encoding, TextEncoding::ShiftJis);
        assert_eq!(decoded.line_ending, LineEnding::Crlf);
        assert_eq!(
            encode_text(&decoded.content, decoded.encoding, decoded.line_ending).unwrap(),
            bytes.into_owned()
        );
    }

    #[test]
    fn reports_text_that_shift_jis_cannot_hold() {
        assert_eq!(
            encode_text("絵文字 😀", TextEncoding::ShiftJis, LineEnding::Lf),
            Err(EncodeError::Unencodable)
        );
    }

    #[test]
    fn round_trips_utf16_with_bom() {
        for encoding in [TextEncoding::Utf16Le, TextEncoding::Utf16Be] {
            let bytes = encode_text("a\nあ\n", encoding, LineEnding::Crlf).unwrap();
            let decoded = decode_text(&bytes).unwrap();

            assert_eq!(decoded.content, "a\nあ\n");
            assert_eq!(decoded.encoding, encoding);
            assert_eq!(decoded.line_ending, LineEnding::Crlf);
        }
    }

    #[test]
    fn picks_the_dominant_line_ending_for_mixed_files() {
        assert_eq!(
            normalize_line_endings("a\r\nb\r\nc\nd"),
            ("a\nb\nc\nd".to_string(), LineEnding::Crlf)
        );
        assert_eq!(
            normalize_line_endings("a\nb\nc\r\nd"),
            ("a\nb\nc\nd".to_string(), LineEnding::Lf)
        );
        assert_eq!(normalize_line_endings("a\rb").0, "a\nb");
    }

    #[test]
    fn rejects_bytes_in_no_supported_encoding() {
        assert!(decode_text(&[0x82, 0xA0, 0xFF, 0xFF, 0x80]).is_err());
    }

    #[test]
    fn writes_atomically_and_replaces_existing_files() {
        let directory =
            std::env::temp_dir().join(format!("markdownpad-atomic-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("note.md");

        write_atomically(&path, b"first").unwrap();
        write_atomically(&path, b"second").unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"second");
        let leftovers: Vec<_> = fs::read_dir(&directory)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name() != "note.md")
            .collect();
        assert!(
            leftovers.is_empty(),
            "temporary files must not be left behind"
        );

        fs::remove_dir_all(&directory).unwrap();
    }
}
