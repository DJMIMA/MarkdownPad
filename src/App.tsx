import { useMemo, useState } from "react";
import { MarkdownEditor } from "./editor/MarkdownEditor";
import type { DocumentTab, EditorSettings } from "./types";

const sampleMarkdown = `# MarkdownPad

MarkdownPad は、単体の Markdown ファイルを軽く開き、美しく読みながら編集するためのデスクトップアプリです。

## 最初の目標

- Tauri v2 + React + TypeScript + Vite で軽いアプリ基盤を作る
- CodeMirror 6 で Markdown 編集を扱う
- カーソル行は Markdown ソース、それ以外は読みやすいライブプレビューへ近づける

> 保存は手動保存を基本にし、復元スナップショットはアプリ内に持ちます。

\`\`\`ts
export interface DocumentTab {
  id: string;
  title: string;
  dirty: boolean;
}
\`\`\`
`;

function createUntitledTab(index: number): DocumentTab {
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

function positionToLineColumn(content: string, offset: number) {
  const safeOffset = Math.min(Math.max(offset, 0), content.length);
  const beforeCursor = content.slice(0, safeOffset);
  const lines = beforeCursor.split("\n");

  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

function countWords(content: string) {
  const tokens = content.trim().split(/\s+/).filter(Boolean);
  return tokens.length;
}

function App() {
  const [tabs, setTabs] = useState<DocumentTab[]>(() => [
    createUntitledTab(1),
  ]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const [settings, setSettings] = useState<EditorSettings>({
    zoom: 100,
    wordWrap: true,
    showStatusBar: true,
  });

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const nextUntitledIndex = tabs.filter((tab) => tab.isUntitled).length + 1;

  const status = useMemo(() => {
    const cursor = positionToLineColumn(activeTab.content, activeTab.cursor.head);

    return {
      ...cursor,
      characters: activeTab.content.length,
      words: countWords(activeTab.content),
    };
  }, [activeTab.content, activeTab.cursor.head]);

  function addTab() {
    const tab = createUntitledTab(nextUntitledIndex);

    setTabs((currentTabs) => [...currentTabs, tab]);
    setActiveTabId(tab.id);
  }

  function closeTab(tabId: string) {
    if (tabs.length === 1) {
      const replacement = createUntitledTab(1);
      setTabs([replacement]);
      setActiveTabId(replacement.id);
      return;
    }

    const remainingTabs = tabs.filter((tab) => tab.id !== tabId);
    setTabs(remainingTabs);

    if (activeTabId === tabId) {
      setActiveTabId(remainingTabs[0].id);
    }
  }

  function updateActiveTab(update: Partial<DocumentTab>) {
    setTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.id === activeTabId
          ? {
              ...tab,
              ...update,
            }
          : tab,
      ),
    );
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand-group" aria-label="Application">
          <span className="brand-mark">M</span>
          <span className="brand-name">MarkdownPad</span>
        </div>

        <div className="tab-strip" role="tablist" aria-label="Open tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`tab-button ${tab.id === activeTabId ? "active" : ""}`}
              type="button"
              role="tab"
              aria-selected={tab.id === activeTabId}
              onClick={() => setActiveTabId(tab.id)}
            >
              <span className="tab-title">
                {tab.dirty ? `${tab.title} *` : tab.title}
              </span>
              <span
                className="close-tab"
                role="button"
                aria-label={`${tab.title} を閉じる`}
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    closeTab(tab.id);
                  }
                }}
              >
                x
              </span>
            </button>
          ))}

          <button
            className="new-tab-button"
            type="button"
            title="新しいタブ"
            aria-label="新しいタブ"
            onClick={addTab}
          >
            +
          </button>
        </div>

        <div className="view-controls" aria-label="View controls">
          <button
            type="button"
            aria-pressed={settings.wordWrap}
            onClick={() =>
              setSettings((current) => ({
                ...current,
                wordWrap: !current.wordWrap,
              }))
            }
          >
            折り返し
          </button>
          <button
            type="button"
            onClick={() =>
              setSettings((current) => ({
                ...current,
                zoom: Math.max(70, current.zoom - 10),
              }))
            }
          >
            -
          </button>
          <span className="zoom-label">{settings.zoom}%</span>
          <button
            type="button"
            onClick={() =>
              setSettings((current) => ({
                ...current,
                zoom: Math.min(160, current.zoom + 10),
              }))
            }
          >
            +
          </button>
        </div>
      </header>

      <main className="workspace">
        <MarkdownEditor
          value={activeTab.content}
          wordWrap={settings.wordWrap}
          zoom={settings.zoom}
          onChange={(content) => updateActiveTab({ content, dirty: true })}
          onCursorChange={(cursor) => updateActiveTab({ cursor })}
        />
      </main>

      {settings.showStatusBar ? (
        <footer className="status-bar">
          <span>{activeTab.path ?? "未保存の Markdown"}</span>
          <span>行 {status.line}, 列 {status.column}</span>
          <span>{status.characters} 文字</span>
          <span>{status.words} 語</span>
          <span>{activeTab.dirty ? "未保存" : "保存済み"}</span>
        </footer>
      ) : null}
    </div>
  );
}

export default App;

