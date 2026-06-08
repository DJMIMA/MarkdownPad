import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "./editor/MarkdownEditor";
import { markdownPrintDocument } from "./markdown";
import {
  listenToMenuActions,
  type MenuAction,
  type OpenedMarkdownFile,
  openMarkdownFile,
  loadLaunchMarkdownFile,
  printMarkdownDocument,
  saveMarkdownFile,
  loadRecoverySnapshot,
  discardRecoverySnapshot,
  saveRecoverySnapshot,
  isTauriRuntime,
  openExternalUrl,
  openApplicationWindow,
  closeCurrentWindow,
  listenToCloseRequested,
} from "./platform";
import {
  countWords,
  createUntitledTab,
  defaultEditorSettings,
  isRecoverySnapshot,
  positionToLineColumn,
} from "./state";
import type { DocumentTab, EditorSettings, RecoverySnapshot } from "./types";

type MenuItem = {
  action: MenuAction;
  label: string;
  shortcut?: string;
  checked?: boolean;
  separatorBefore?: boolean;
};

type MenuGroup = {
  id: string;
  label: string;
  items: MenuItem[];
};

type UnsavedDialogDecision = "save" | "discard" | "cancel";

type UnsavedDialogState = {
  title: string;
  message: string;
  resolve: (decision: UnsavedDialogDecision) => void;
};

type RecoveryDialogState = {
  snapshot: RecoverySnapshot;
  launchTab: DocumentTab | null;
};

type ShortcutCommand = MenuAction | "find-next" | "find-previous";

function menuGroups(settings: EditorSettings): MenuGroup[] {
  return [
    {
      id: "file",
      label: "ファイル",
      items: [
        { action: "new-tab", label: "新しいタブ", shortcut: "Ctrl+N" },
        {
          action: "new-window",
          label: "新しいウインドウ",
          shortcut: "Ctrl+Shift+N",
        },
        {
          action: "open",
          label: "開く",
          shortcut: "Ctrl+O",
          separatorBefore: true,
        },
        { action: "save", label: "保存", shortcut: "Ctrl+S" },
        {
          action: "save-as",
          label: "名前を付けて保存",
          shortcut: "Ctrl+Shift+S",
        },
        {
          action: "print",
          label: "印刷",
          shortcut: "Ctrl+P",
          separatorBefore: true,
        },
        {
          action: "close-tab",
          label: "タブを閉じる",
          shortcut: "Ctrl+W",
          separatorBefore: true,
        },
        {
          action: "close-window",
          label: "ウィンドウを閉じる",
          shortcut: "Ctrl+Shift+W",
        },
        { action: "quit", label: "終了" },
      ],
    },
    {
      id: "edit",
      label: "編集",
      items: [
        { action: "cut", label: "切り取り", shortcut: "Ctrl+X" },
        { action: "copy", label: "コピー", shortcut: "Ctrl+C" },
        { action: "paste", label: "貼り付け", shortcut: "Ctrl+V" },
        {
          action: "find",
          label: "検索",
          shortcut: "Ctrl+F",
          separatorBefore: true,
        },
        { action: "replace", label: "置換", shortcut: "Ctrl+H" },
        {
          action: "select-all",
          label: "全てを選択",
          shortcut: "Ctrl+A",
          separatorBefore: true,
        },
      ],
    },
    {
      id: "view",
      label: "表示",
      items: [
        { action: "zoom-in", label: "拡大", shortcut: "Ctrl++" },
        { action: "zoom-out", label: "縮小", shortcut: "Ctrl+-" },
        { action: "zoom-reset", label: "既定値に戻す", shortcut: "Ctrl+0" },
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

function shortcutCommandFromEvent(event: KeyboardEvent): ShortcutCommand | null {
  if (event.altKey) {
    return null;
  }

  if (
    event.key === "F3" &&
    !event.ctrlKey &&
    !event.metaKey
  ) {
    return event.shiftKey ? "find-previous" : "find-next";
  }

  const hasPrimaryModifier = event.ctrlKey || event.metaKey;

  if (!hasPrimaryModifier) {
    return null;
  }

  const key = event.key.toLowerCase();

  switch (key) {
    case "n":
      return event.shiftKey ? "new-window" : "new-tab";
    case "o":
      return event.shiftKey ? null : "open";
    case "s":
      return event.shiftKey ? "save-as" : "save";
    case "p":
      return event.shiftKey ? null : "print";
    case "w":
      return event.shiftKey ? "close-window" : "close-tab";
    case "f":
      return event.shiftKey ? null : "find";
    case "h":
      return event.shiftKey ? null : "replace";
    case "+":
    case "=":
      return "zoom-in";
    case "-":
      return "zoom-out";
    case "0":
      return "zoom-reset";
    default:
      return null;
  }
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

function createTabFromOpenedFile(file: OpenedMarkdownFile): DocumentTab {
  return {
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
}

function App() {
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  const handleActionRef = useRef<((action: MenuAction) => Promise<void>) | null>(
    null,
  );
  const unsavedDialogRef = useRef<UnsavedDialogState | null>(null);
  const recoveryDialogRef = useRef<RecoveryDialogState | null>(null);
  const skipRecovery = useMemo(
    () => new URLSearchParams(window.location.search).has("blank"),
    [],
  );
  const [tabs, setTabs] = useState<DocumentTab[]>(() => [createUntitledTab(1)]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const [settings, setSettings] = useState<EditorSettings>(
    defaultEditorSettings,
  );
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [unsavedDialog, setUnsavedDialog] =
    useState<UnsavedDialogState | null>(null);
  const [recoveryDialog, setRecoveryDialog] =
    useState<RecoveryDialogState | null>(null);

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

  const requestUnsavedDecision = useCallback((tabsToClose: DocumentTab[]) => {
    const message = tabsToClose.length === 1
      ? `${tabsToClose[0].title} への変更内容を保存しますか？`
      : `未保存のタブ ${tabsToClose.length} 件への変更内容を保存しますか？`;

    return new Promise<UnsavedDialogDecision>((resolve) => {
      setUnsavedDialog({
        title: "MarkdownPad",
        message,
        resolve,
      });
    });
  }, []);

  const chooseUnsavedDialog = useCallback(
    (decision: UnsavedDialogDecision) => {
      const dialog = unsavedDialog;

      if (!dialog) {
        return;
      }

      setUnsavedDialog(null);
      dialog.resolve(decision);
    },
    [unsavedDialog],
  );

  const chooseRecoveryDialog = useCallback(
    async (shouldRestore: boolean) => {
      const dialog = recoveryDialog;

      if (!dialog) {
        return;
      }

      setRecoveryDialog(null);

      if (shouldRestore) {
        const restoredTabs = dialog.launchTab
          ? [...dialog.snapshot.tabs, dialog.launchTab]
          : dialog.snapshot.tabs;
        const snapshotActiveTabId =
          dialog.snapshot.activeTabId &&
          restoredTabs.some((tab) => tab.id === dialog.snapshot.activeTabId)
            ? dialog.snapshot.activeTabId
            : restoredTabs[0].id;

        setTabs(restoredTabs);
        setActiveTabId(dialog.launchTab?.id ?? snapshotActiveTabId);
        setSettings(dialog.snapshot.settings);
        setRecoveryReady(true);
        return;
      }

      await discardRecoverySnapshot();

      if (dialog.launchTab) {
        setTabs([dialog.launchTab]);
        setActiveTabId(dialog.launchTab.id);
      } else {
        const replacement = createUntitledTab(1);
        setTabs([replacement]);
        setActiveTabId(replacement.id);
      }

      setRecoveryReady(true);
    },
    [recoveryDialog],
  );

  const saveTabBeforeClose = useCallback(async (tab: DocumentTab) => {
    try {
      const saved = await saveMarkdownFile(tab, {
        saveAs: tab.path === null,
      });

      setTabs((currentTabs) => updateTabById(currentTabs, tab.id, saved));
      return true;
    } catch {
      return false;
    }
  }, []);

  const dirtyTabsCanClose = useCallback(
    async (tabsToClose: DocumentTab[]) => {
      const dirtyTabs = tabsToClose.filter((tab) => tab.dirty);

      if (dirtyTabs.length === 0) {
        return true;
      }

      const decision = await requestUnsavedDecision(dirtyTabs);

      if (decision === "cancel") {
        return false;
      }

      if (decision === "discard") {
        return true;
      }

      for (const tab of dirtyTabs) {
        if (!(await saveTabBeforeClose(tab))) {
          return false;
        }
      }

      return true;
    },
    [requestUnsavedDecision, saveTabBeforeClose],
  );

  const closeTab = useCallback(
    async (tabId: string) => {
      const targetTab = tabs.find((tab) => tab.id === tabId);

      if (!targetTab || !(await dirtyTabsCanClose([targetTab]))) {
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
    [activeTabId, dirtyTabsCanClose, tabs],
  );

  const openFile = useCallback(async () => {
    const file = await openMarkdownFile();

    if (!file) {
      return;
    }

    const tab = createTabFromOpenedFile(file);

    setTabs((currentTabs) => [...currentTabs, tab]);
    setActiveTabId(tab.id);
  }, []);

  const saveActiveTab = useCallback(
    async (saveAs = false) => {
      const saved = await saveMarkdownFile(activeTab, {
        saveAs: saveAs || activeTab.path === null,
      });

      updateActiveTab(saved);
    },
    [activeTab, updateActiveTab],
  );

  const handleAction = useCallback(
    async (action: MenuAction) => {
      setOpenMenuId(null);

      switch (action) {
        case "new-tab":
          addTab();
          break;
        case "new-window":
          await openApplicationWindow();
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
          await printMarkdownDocument(
            markdownPrintDocument(activeTab.content, activeTab.title),
          );
          break;
        case "close-tab":
          await closeTab(activeTab.id);
          break;
        case "close-window":
        case "quit":
          if (await dirtyTabsCanClose(tabs)) {
            await discardRecoverySnapshot();
            await closeCurrentWindow();
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
      closeTab,
      dirtyTabsCanClose,
      openFile,
      saveActiveTab,
      tabs,
    ],
  );

  useEffect(() => {
    handleActionRef.current = handleAction;
  }, [handleAction]);

  useEffect(() => {
    unsavedDialogRef.current = unsavedDialog;
  }, [unsavedDialog]);

  useEffect(() => {
    recoveryDialogRef.current = recoveryDialog;
  }, [recoveryDialog]);

  useEffect(() => {
    if (skipRecovery) {
      setRecoveryReady(true);
      return;
    }

    let mounted = true;

    Promise.all([loadLaunchMarkdownFile(), loadRecoverySnapshot()]).then(([
      launchFile,
      snapshot,
    ]) => {
      if (!mounted) {
        return;
      }

      const recoverySnapshot =
        isRecoverySnapshot(snapshot) && snapshot.tabs.length > 0
          ? snapshot
          : null;

      if (launchFile) {
        const launchTab = createTabFromOpenedFile(launchFile);
        setTabs([launchTab]);
        setActiveTabId(launchTab.id);

        if (recoverySnapshot) {
          setRecoveryDialog({
            snapshot: recoverySnapshot,
            launchTab,
          });
          return;
        }

        setRecoveryReady(true);
        return;
      }

      if (recoverySnapshot) {
        setRecoveryDialog({
          snapshot: recoverySnapshot,
          launchTab: null,
        });
        return;
      }

      setRecoveryReady(true);
    });

    return () => {
      mounted = false;
    };
  }, [skipRecovery]);

  useEffect(() => {
    if (!recoveryReady || skipRecovery) {
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
  }, [activeTabId, recoveryReady, settings, skipRecovery, tabs]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    listenToMenuActions((action) => {
      void handleActionRef.current?.(action);
    }).then((cleanup) => {
      if (disposed) {
        cleanup?.();
        return;
      }

      unlisten = cleanup;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    listenToCloseRequested(() => {
      void handleActionRef.current?.("close-window");
    }).then((cleanup) => {
      if (disposed) {
        cleanup?.();
        return;
      }

      unlisten = cleanup;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (unsavedDialogRef.current || recoveryDialogRef.current) {
        return;
      }

      if (event.key === "Escape") {
        setOpenMenuId(null);
        return;
      }

      const command = shortcutCommandFromEvent(event);

      if (!command) {
        return;
      }

      event.preventDefault();
      setOpenMenuId(null);

      if (command === "find-next") {
        editorRef.current?.findNext();
        return;
      }

      if (command === "find-previous") {
        editorRef.current?.findPrevious();
        return;
      }

      void handleActionRef.current?.(command);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!unsavedDialog) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        chooseUnsavedDialog("cancel");
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chooseUnsavedDialog, unsavedDialog]);

  useEffect(() => {
    function onOpenUrl(event: Event) {
      const url = (event as CustomEvent<string>).detail;

      if (typeof url === "string") {
        void openExternalUrl(url);
      }
    }

    window.addEventListener("markdownpad-open-url", onOpenUrl);
    return () => window.removeEventListener("markdownpad-open-url", onOpenUrl);
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
                        <span className="menu-shortcut">{item.shortcut ?? ""}</span>
                        <span className="menu-check" aria-hidden="true">
                          {item.checked ? "✓" : ""}
                        </span>
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
                  void closeTab(tab.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    void closeTab(tab.id);
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

      {recoveryDialog ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="unsaved-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="recovery-dialog-title"
            aria-describedby="recovery-dialog-message"
          >
            <h2 id="recovery-dialog-title">MarkdownPad</h2>
            <p id="recovery-dialog-message">
              前回アプリが異常終了しています。復元しますか？
            </p>
            <div className="unsaved-dialog-actions">
              <button
                type="button"
                className="primary"
                autoFocus
                onClick={() => void chooseRecoveryDialog(true)}
              >
                はい
              </button>
              <button
                type="button"
                onClick={() => void chooseRecoveryDialog(false)}
              >
                いいえ
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {unsavedDialog ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="unsaved-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="unsaved-dialog-title"
            aria-describedby="unsaved-dialog-message"
          >
            <h2 id="unsaved-dialog-title">{unsavedDialog.title}</h2>
            <p id="unsaved-dialog-message">{unsavedDialog.message}</p>
            <div className="unsaved-dialog-actions">
              <button
                type="button"
                className="primary"
                autoFocus
                onClick={() => chooseUnsavedDialog("save")}
              >
                保存
              </button>
              <button
                type="button"
                onClick={() => chooseUnsavedDialog("discard")}
              >
                保存しない
              </button>
              <button
                type="button"
                onClick={() => chooseUnsavedDialog("cancel")}
              >
                キャンセル
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default App;
