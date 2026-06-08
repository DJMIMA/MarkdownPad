import type { DocumentTab, EditorSettings, RecoverySnapshot } from "./types";

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
    content: index === 1 ? sampleMarkdown : "",
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
  };
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

export function isRecoverySnapshot(value: unknown): value is RecoverySnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as RecoverySnapshot;

  return (
    candidate.version === 1 &&
    typeof candidate.updatedAt === "string" &&
    Array.isArray(candidate.tabs) &&
    !!candidate.settings &&
    typeof candidate.settings.zoom === "number" &&
    typeof candidate.settings.wordWrap === "boolean" &&
    typeof candidate.settings.showStatusBar === "boolean"
  );
}
