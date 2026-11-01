/** Character encoding a file was read in, and is written back in. */
export type TextEncoding =
  | "utf-8"
  | "utf-8-bom"
  | "utf-16le"
  | "utf-16be"
  | "shift_jis";

/** Line ending a file uses on disk. The editor always works with "\n". */
export type LineEnding = "lf" | "crlf";

/** Modification time and size of a file when it was last read or saved. */
export interface FileStamp {
  modifiedMs: number;
  size: number;
}

export interface DocumentTab {
  id: string;
  title: string;
  path: string | null;
  content: string;
  dirty: boolean;
  cursor: {
    anchor: number;
    head: number;
  };
  scroll: {
    x: number;
    y: number;
  };
  isUntitled: boolean;
  // How the file is stored on disk. Optional so snapshots written before
  // these fields existed still restore (as UTF-8 with LF).
  encoding?: TextEncoding;
  lineEnding?: LineEnding;
  diskStamp?: FileStamp | null;
}

export interface EditorSettings {
  zoom: number;
  wordWrap: boolean;
  showStatusBar: boolean;
}

export interface RecoverySnapshot {
  version: number;
  updatedAt: string;
  activeTabId: string | null;
  tabs: DocumentTab[];
  settings: EditorSettings;
}
