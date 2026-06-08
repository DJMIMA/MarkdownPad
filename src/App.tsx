import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "./editor/MarkdownEditor";
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
import { commandEdit, menuGroups, shortcutCommandFromEvent } from "./menu";
import { MenuBar } from "./components/MenuBar";
import { TabStrip } from "./components/TabStrip";
import { StatusBar } from "./components/StatusBar";
import { ThemeToggle } from "./components/ThemeToggle";
import { ModalDialog } from "./components/ModalDialog";
import { useTheme } from "./useTheme";
import {
  countWords,
  createUntitledTab,
  defaultEditorSettings,
  isRecoverySnapshot,
  positionToLineColumn,
} from "./state";
import type { DocumentTab, EditorSettings, RecoverySnapshot } from "./types";

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
  const { resolvedTheme, toggleTheme } = useTheme();

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
        case "print": {
          const { markdownPrintDocument } = await import("./markdown");
          await printMarkdownDocument(
            markdownPrintDocument(activeTab.content, activeTab.title),
          );
          break;
        }
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
          <MenuBar
            groups={groups}
            openMenuId={openMenuId}
            onToggleMenu={(id) =>
              setOpenMenuId((current) => (current === id ? null : id))
            }
            onAction={(action) => void handleAction(action)}
          />
        ) : null}

        <TabStrip
          tabs={tabs}
          activeTabId={activeTabId}
          onSelect={setActiveTabId}
          onClose={(tabId) => void closeTab(tabId)}
          onAdd={addTab}
        />

        <div className="top-status" aria-label="View">
          <ThemeToggle resolvedTheme={resolvedTheme} onToggle={toggleTheme} />
          <span className="zoom-indicator">{settings.zoom}%</span>
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
        <StatusBar
          path={activeTab.path}
          dirty={activeTab.dirty}
          line={status.line}
          column={status.column}
          characters={status.characters}
          words={status.words}
          wordWrap={settings.wordWrap}
        />
      ) : null}

      {recoveryDialog ? (
        <ModalDialog
          id="recovery-dialog"
          title="MarkdownPad"
          message="前回アプリが異常終了しています。復元しますか？"
          buttons={[
            {
              label: "はい",
              primary: true,
              autoFocus: true,
              onClick: () => void chooseRecoveryDialog(true),
            },
            {
              label: "いいえ",
              onClick: () => void chooseRecoveryDialog(false),
            },
          ]}
        />
      ) : null}

      {unsavedDialog ? (
        <ModalDialog
          id="unsaved-dialog"
          title={unsavedDialog.title}
          message={unsavedDialog.message}
          buttons={[
            {
              label: "保存",
              primary: true,
              autoFocus: true,
              onClick: () => chooseUnsavedDialog("save"),
            },
            {
              label: "保存しない",
              onClick: () => chooseUnsavedDialog("discard"),
            },
            {
              label: "キャンセル",
              onClick: () => chooseUnsavedDialog("cancel"),
            },
          ]}
        />
      ) : null}
    </div>
  );
}

export default App;
