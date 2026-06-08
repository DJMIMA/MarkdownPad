import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "./editor/MarkdownEditor";
import { markdownPrintDocument } from "./markdown";
import {
  listenToMenuActions,
  type MenuAction,
  openMarkdownFile,
  printMarkdownHtml,
  saveMarkdownFile,
  loadRecoverySnapshot,
  saveRecoverySnapshot,
  isTauriRuntime,
} from "./platform";
import {
  countWords,
  createUntitledTab,
  defaultEditorSettings,
  isRecoverySnapshot,
  positionToLineColumn,
} from "./state";
import type { DocumentTab, EditorSettings } from "./types";

type MenuItem = {
  action: MenuAction;
  label: string;
  checked?: boolean;
  separatorBefore?: boolean;
};

type MenuGroup = {
  id: string;
  label: string;
  items: MenuItem[];
};

function menuGroups(settings: EditorSettings): MenuGroup[] {
  return [
    {
      id: "file",
      label: "ファイル",
      items: [
        { action: "new-tab", label: "新しいタブ" },
        { action: "new-window", label: "新しいウインドウ" },
        { action: "open", label: "開く", separatorBefore: true },
        { action: "save", label: "保存" },
        { action: "save-as", label: "名前を付けて保存" },
        { action: "print", label: "印刷", separatorBefore: true },
        { action: "close-tab", label: "タブを閉じる", separatorBefore: true },
        { action: "close-window", label: "ウィンドウを閉じる" },
        { action: "quit", label: "終了" },
      ],
    },
    {
      id: "edit",
      label: "編集",
      items: [
        { action: "cut", label: "切り取り" },
        { action: "copy", label: "コピー" },
        { action: "paste", label: "貼り付け" },
        { action: "find", label: "検索", separatorBefore: true },
        { action: "replace", label: "置換" },
        { action: "select-all", label: "全てを選択", separatorBefore: true },
      ],
    },
    {
      id: "view",
      label: "表示",
      items: [
        { action: "zoom-in", label: "拡大" },
        { action: "zoom-out", label: "縮小" },
        { action: "zoom-reset", label: "既定値に戻す" },
        {
          action: "toggle-word-wrap",
          label: "右端で折り返す",
          checked: settings.wordWrap,
          separatorBefore: true,
        },
        {
          action: "toggle-status-bar",
          label: "ステータスバー",
          checked: settings.showStatusBar,
        },
      ],
    },
  ];
}

function commandEdit(action: "cut" | "copy" | "paste") {
  document.execCommand(action);
}

function updateTabById(
  tabs: DocumentTab[],
  tabId: string,
  update: Partial<DocumentTab>,
) {
  return tabs.map((tab) =>
    tab.id === tabId
      ? {
          ...tab,
          ...update,
        }
      : tab,
  );
}

function App() {
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  const [tabs, setTabs] = useState<DocumentTab[]>(() => [createUntitledTab(1)]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const [settings, setSettings] = useState<EditorSettings>(
    defaultEditorSettings,
  );
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [recoveryReady, setRecoveryReady] = useState(false);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const nextUntitledIndex = tabs.filter((tab) => tab.isUntitled).length + 1;
  const groups = useMemo(() => menuGroups(settings), [settings]);
  const showFallbackMenu = !isTauriRuntime();

  const status = useMemo(() => {
    const cursor = positionToLineColumn(activeTab.content, activeTab.cursor.head);

    return {
      ...cursor,
      characters: activeTab.content.length,
      words: countWords(activeTab.content),
    };
  }, [activeTab.content, activeTab.cursor.head]);

  const updateActiveTab = useCallback(
    (update: Partial<DocumentTab>) => {
      setTabs((currentTabs) => updateTabById(currentTabs, activeTabId, update));
    },
    [activeTabId],
  );

  const addTab = useCallback(() => {
    const tab = createUntitledTab(nextUntitledIndex);

    setTabs((currentTabs) => [...currentTabs, tab]);
    setActiveTabId(tab.id);
  }, [nextUntitledIndex]);

  const closeTab = useCallback(
    (tabId: string) => {
      const targetTab = tabs.find((tab) => tab.id === tabId);

      if (
        targetTab?.dirty &&
        !window.confirm(`${targetTab.title} には未保存の変更があります。閉じますか？`)
      ) {
        return;
      }

      if (tabs.length === 1) {
        const replacement = createUntitledTab(1);
        setTabs([replacement]);
        setActiveTabId(replacement.id);
        return;
      }

      const targetIndex = tabs.findIndex((tab) => tab.id === tabId);
      const remainingTabs = tabs.filter((tab) => tab.id !== tabId);
      setTabs(remainingTabs);

      if (activeTabId === tabId) {
        const nextIndex = Math.min(Math.max(targetIndex, 0), remainingTabs.length - 1);
        setActiveTabId(remainingTabs[nextIndex].id);
      }
    },
    [activeTabId, tabs],
  );

  const openFile = useCallback(async () => {
    const file = await openMarkdownFile();

    if (!file) {
      return;
    }

    const tab: DocumentTab = {
      id: crypto.randomUUID(),
      title: file.title,
      path: file.path,
      content: file.content,
      dirty: false,
      cursor: {
        anchor: 0,
        head: 0,
      },
      scroll: {
        x: 0,
        y: 0,
      },
      isUntitled: false,
    };

    setTabs((currentTabs) => [...currentTabs, tab]);
    setActiveTabId(tab.id);
  }, []);

  const saveActiveTab = useCallback(
    async (saveAs = false) => {
      const saved = await saveMarkdownFile(activeTab, {
        saveAs,
      });

      updateActiveTab(saved);
    },
    [activeTab, updateActiveTab],
  );

  const allDirtyTabsCanClose = useCallback(() => {
    const dirtyTabs = tabs.filter((tab) => tab.dirty);

    if (dirtyTabs.length === 0) {
      return true;
    }

    return window.confirm(
      `未保存のタブが ${dirtyTabs.length} 件あります。変更を破棄して閉じますか？`,
    );
  }, [tabs]);

  const handleAction = useCallback(
    async (action: MenuAction) => {
      setOpenMenuId(null);

      switch (action) {
        case "new-tab":
          addTab();
          break;
        case "new-window":
          window.open(window.location.href, "_blank", "noopener,noreferrer");
          break;
        case "open":
          await openFile();
          break;
        case "save":
          await saveActiveTab(false);
          break;
        case "save-as":
          await saveActiveTab(true);
          break;
        case "print":
          await printMarkdownHtml(
            markdownPrintDocument(activeTab.content, activeTab.title),
          );
          break;
        case "close-tab":
          closeTab(activeTab.id);
          break;
        case "close-window":
        case "quit":
          if (allDirtyTabsCanClose()) {
            window.close();
          }
          break;
        case "cut":
        case "copy":
        case "paste":
          editorRef.current?.focus();
          requestAnimationFrame(() => commandEdit(action));
          break;
        case "find":
          editorRef.current?.openSearch();
          break;
        case "replace":
          editorRef.current?.openReplace();
          break;
        case "select-all":
          editorRef.current?.selectAll();
          break;
        case "zoom-in":
          setSettings((current) => ({
            ...current,
            zoom: Math.min(180, current.zoom + 10),
          }));
          break;
        case "zoom-out":
          setSettings((current) => ({
            ...current,
            zoom: Math.max(70, current.zoom - 10),
          }));
          break;
        case "zoom-reset":
          setSettings((current) => ({
            ...current,
            zoom: 100,
          }));
          break;
        case "toggle-word-wrap":
          setSettings((current) => ({
            ...current,
            wordWrap: !current.wordWrap,
          }));
          break;
        case "toggle-status-bar":
          setSettings((current) => ({
            ...current,
            showStatusBar: !current.showStatusBar,
          }));
          break;
        default:
          break;
      }
    },
    [
      activeTab,
      addTab,
      allDirtyTabsCanClose,
      closeTab,
      openFile,
      saveActiveTab,
    ],
  );

  useEffect(() => {
    let mounted = true;

    loadRecoverySnapshot().then((snapshot) => {
      if (!mounted) {
        return;
      }

      if (isRecoverySnapshot(snapshot) && snapshot.tabs.length > 0) {
        setTabs(snapshot.tabs);
        setActiveTabId(snapshot.activeTabId ?? snapshot.tabs[0].id);
        setSettings(snapshot.settings);
      }

      setRecoveryReady(true);
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!recoveryReady) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void saveRecoverySnapshot({
        version: 1,
        updatedAt: new Date().toISOString(),
        activeTabId,
        tabs,
        settings,
      });
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [activeTabId, recoveryReady, settings, tabs]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    listenToMenuActions((action) => {
      void handleAction(action);
    }).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => {
      unlisten?.();
    };
  }, [handleAction]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenuId(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="app-shell">
      <header className="top-bar">
        {showFallbackMenu ? (
          <nav className="menu-bar" aria-label="Application menu">
            {groups.map((group) => (
              <div className="menu-root" key={group.id}>
                <button
                  className="menu-root-button"
                  type="button"
                  aria-expanded={openMenuId === group.id}
                  onClick={() =>
                    setOpenMenuId((current) =>
                      current === group.id ? null : group.id,
                    )
                  }
                >
                  {group.label}
                </button>

                {openMenuId === group.id ? (
                  <div className="menu-popover" role="menu">
                    {group.items.map((item) => (
                      <button
                        key={item.action}
                        className={
                          item.separatorBefore
                            ? "menu-item separator-before"
                            : "menu-item"
                        }
                        type="button"
                        role="menuitem"
                        onClick={() => void handleAction(item.action)}
                      >
                        <span>{item.label}</span>
                        {item.checked !== undefined ? (
                          <span className="menu-check" aria-hidden="true">
                            {item.checked ? "✓" : ""}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </nav>
        ) : null}

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
                ×
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

        <div className="top-status" aria-label="View">
          <span>{settings.zoom}%</span>
        </div>
      </header>

      <main className="workspace" onClick={() => setOpenMenuId(null)}>
        <MarkdownEditor
          ref={editorRef}
          value={activeTab.content}
          cursor={activeTab.cursor}
          scroll={activeTab.scroll}
          wordWrap={settings.wordWrap}
          zoom={settings.zoom}
          onChange={(content) =>
            updateActiveTab({
              content,
              dirty: true,
            })
          }
          onCursorChange={(cursor) => updateActiveTab({ cursor })}
          onScrollChange={(scroll) => updateActiveTab({ scroll })}
        />
      </main>

      {settings.showStatusBar ? (
        <footer className="status-bar">
          <span>{activeTab.path ?? "未保存の Markdown"}</span>
          <span>行 {status.line}, 列 {status.column}</span>
          <span>{status.characters} 文字</span>
          <span>{status.words} 語</span>
          <span>{activeTab.dirty ? "未保存" : "保存済み"}</span>
          <span>{settings.wordWrap ? "折り返し" : "折り返しなし"}</span>
        </footer>
      ) : null}
    </div>
  );
}

export default App;
