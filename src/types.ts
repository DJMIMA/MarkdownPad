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

