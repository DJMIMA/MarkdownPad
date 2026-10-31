import type {
  DocumentTab,
  EditorSettings,
  LineEnding,
  RecoverySnapshot,
  TextEncoding,
} from "./types";

export const defaultEditorSettings: EditorSettings = {
  zoom: 100,
  wordWrap: true,
  showStatusBar: true,
};

export const sampleMarkdown = `# MarkdownPad

MarkdownPad は、単体の Markdown ファイルを軽く開き、美しく読みながら編集するためのデスクトップアプリです。

## 見出しの確認

### ライブプレビュー

- **太字** と *強調* は記号を隠して読みやすく表示します
- [MarkdownPad](https://example.com) のリンクはラベル中心で表示します
- [x] タスクリストも自然なチェック表示にします

エスケープした \\*記号\\* と ; ^ ＾ は文字として残ります。

> 保存は手動保存を基本にし、復元スナップショットはアプリ内に持ちます。

---

| 機能 | 状態 |
| --- | --- |
| 見出し | h1 / h2 / h3 を階層表示 |
| 表 | カーソル外では表として表示 |

\`\`\`ts
export interface DocumentTab {
  id: string;
  title: string;
  dirty: boolean;
}
\`\`\`
`;

export function createUntitledTab(index: number): DocumentTab {
  return {
    id: crypto.randomUUID(),
    title: `無題-${index}`,
    path: null,
    content: "",
    dirty: false,
    cursor: {
      anchor: 0,
      head: 0,
    },
    scroll: {
      x: 0,
      y: 0,
    },
    isUntitled: true,
    encoding: "utf-8",
    lineEnding: "lf",
    diskStamp: null,
  };
}

/** The lowest "無題-N" number not used by an open tab. */
export function nextUntitledIndex(tabs: readonly DocumentTab[]) {
  const used = new Set(tabs.map((tab) => tab.title));
  let index = 1;

  while (used.has(`無題-${index}`)) {
    index += 1;
  }

  return index;
}

/** An empty, untouched new tab that opening a file may simply replace. */
export function isPristineUntitledTab(tab: DocumentTab) {
  return tab.isUntitled && tab.path === null && !tab.dirty && tab.content === "";
}

/**
 * Detects the dominant line ending and turns every line ending into "\n",
 * matching what the Rust side does for files read from disk.
 */
export function normalizeLineEndings(text: string): {
  content: string;
  lineEnding: LineEnding;
} {
  if (!text.includes("\r")) {
    return { content: text, lineEnding: "lf" };
  }

  const crlf = text.split("\r\n").length - 1;
  const loneLf = text.split("\n").length - 1 - crlf;

  return {
    content: text.replace(/\r\n?/g, "\n"),
    lineEnding: crlf > 0 && crlf >= loneLf ? "crlf" : "lf",
  };
}

export function encodingLabel(encoding: TextEncoding | undefined) {
  switch (encoding) {
    case "utf-8-bom":
      return "UTF-8 (BOM 付き)";
    case "utf-16le":
      return "UTF-16 LE";
    case "utf-16be":
      return "UTF-16 BE";
    case "shift_jis":
      return "Shift_JIS";
    default:
      return "UTF-8";
  }
}

export function lineEndingLabel(lineEnding: LineEnding | undefined) {
  return lineEnding === "crlf" ? "CRLF" : "LF";
}

export function positionToLineColumn(content: string, offset: number) {
  const safeOffset = Math.min(Math.max(offset, 0), content.length);
  const beforeCursor = content.slice(0, safeOffset);
  const lines = beforeCursor.split("\n");

  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

export function countWords(content: string) {
  const japaneseRuns = content.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]+/gu) ?? [];
  const latinTokens =
    content
      .replace(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]+/gu, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean) ?? [];

  return japaneseRuns.length + latinTokens.length;
}

function isPosition(value: unknown, keys: [string, string]) {
  return (
    !!value &&
    typeof value === "object" &&
    keys.every(
      (key) => typeof (value as Record<string, unknown>)[key] === "number",
    )
  );
}

export function isDocumentTab(value: unknown): value is DocumentTab {
  if (!value || typeof value !== "object") {
    return false;
  }

  const tab = value as DocumentTab;

  return (
    typeof tab.id === "string" &&
    typeof tab.title === "string" &&
    (tab.path === null || typeof tab.path === "string") &&
    typeof tab.content === "string" &&
    typeof tab.dirty === "boolean" &&
    typeof tab.isUntitled === "boolean" &&
    isPosition(tab.cursor, ["anchor", "head"]) &&
    isPosition(tab.scroll, ["x", "y"])
  );
}

export function isRecoverySnapshot(value: unknown): value is RecoverySnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as RecoverySnapshot;

  return (
    candidate.version === 1 &&
    typeof candidate.updatedAt === "string" &&
    Array.isArray(candidate.tabs) &&
    candidate.tabs.every(isDocumentTab) &&
    !!candidate.settings &&
    typeof candidate.settings.zoom === "number" &&
    typeof candidate.settings.wordWrap === "boolean" &&
    typeof candidate.settings.showStatusBar === "boolean"
  );
}

/**
 * Only a snapshot with unsaved text is worth the restore question: tabs that
 * were all saved can simply be opened again from disk.
 */
export function snapshotHasUnsavedChanges(snapshot: RecoverySnapshot) {
  return snapshot.tabs.some((tab) => tab.dirty);
}

/**
 * Combines the tabs of every recovered snapshot with the files the app was
 * started with. A file appears once: unsaved recovered text wins over the
 * launch copy, otherwise the fresh launch copy replaces the recovered one.
 */
export function mergeRecoveredTabs(
  snapshots: readonly RecoverySnapshot[],
  launchTabs: readonly DocumentTab[],
): { tabs: DocumentTab[]; activeTabId: string; settings: EditorSettings } | null {
  const tabs: DocumentTab[] = [];
  const ids = new Set<string>();

  for (const snapshot of snapshots) {
    for (const tab of snapshot.tabs) {
      const samePath = tab.path
        ? tabs.findIndex((existing) => existing.path === tab.path)
        : -1;

      if (samePath >= 0) {
        if (tab.dirty && !tabs[samePath].dirty) {
          tabs[samePath] = tab;
        }

        continue;
      }

      tabs.push(ids.has(tab.id) ? { ...tab, id: crypto.randomUUID() } : tab);
      ids.add(tab.id);
    }
  }

  let activeTabId =
    snapshots
      .map((snapshot) => snapshot.activeTabId)
      .find((id) => id !== null && tabs.some((tab) => tab.id === id)) ?? null;

  for (const launchTab of launchTabs) {
    const samePath = tabs.findIndex((tab) => tab.path === launchTab.path);

    if (samePath < 0) {
      tabs.push(launchTab);
      activeTabId = launchTab.id;
    } else if (tabs[samePath].dirty) {
      activeTabId = tabs[samePath].id;
    } else {
      tabs[samePath] = launchTab;
      activeTabId = launchTab.id;
    }
  }

  if (tabs.length === 0 || snapshots.length === 0) {
    return null;
  }

  return {
    tabs,
    activeTabId: activeTabId ?? tabs[0].id,
    settings: snapshots[0].settings,
  };
}
