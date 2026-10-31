import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "./editor/MarkdownEditor";
import {
  cancelQuit,
  closeCurrentWindow,
  discardRecoverySnapshot,
  discardRecoverySnapshots,
  errorMessage,
  isTauriRuntime,
  listenToCloseRequested,
  listenToMenuActions,
  listenToOpenFilesRequested,
  listenToQuitRequested,
  listenToWindowFocus,
  loadLaunchMarkdownFiles,
  loadRecoverySnapshots,
  type MenuAction,
  openApplicationWindow,
  openExternalUrl,
  type OpenedMarkdownFile,
  openMarkdownFile,
  type PendingOpenFile,
  printMarkdownDocument,
  type RecoveryCandidate,
  reloadMarkdownFile,
  requestQuit,
  resolveImageSource,
  saveMarkdownFile,
  saveRecoverySnapshot,
  syncNativeViewMenu,
  takePendingOpenFiles,
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
  encodingLabel,
  isPristineUntitledTab,
  isRecoverySnapshot,
  mergeRecoveredTabs,
  nextUntitledIndex,
  positionToLineColumn,
  snapshotHasUnsavedChanges,
} from "./state";
import type {
  DocumentTab,
  EditorSettings,
  RecoverySnapshot,
  TextEncoding,
} from "./types";

interface ChoiceButton<T extends string> {
  label: string;
  value: T;
  primary?: boolean;
}

interface ChoiceDialogState {
  message: string;
  buttons: ChoiceButton<string>[];
  cancelValue: string;
  resolve: (value: string) => void;
}

interface RecoveryDialogState {
  message: string;
  snapshots: RecoverySnapshot[];
  candidateIds: string[];
  launchTabs: DocumentTab[];
}

const previousSessionMessage = "前回アプリが異常終了しています。復元しますか？";
const reloadedWindowMessage =
  "このウインドウに保存されていない内容が残っています。復元しますか？";

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
    encoding: file.encoding ?? "utf-8",
    lineEnding: file.lineEnding ?? "lf",
    diskStamp: file.stamp ?? null,
  };
}

/** The tab showing the file as it is on disk now, with no unsaved edits. */
function tabWithFile(tab: DocumentTab, file: OpenedMarkdownFile): DocumentTab {
  return {
    ...tab,
    title: file.title,
    path: file.path ?? tab.path,
    content: file.content,
    dirty: false,
    isUntitled: false,
    encoding: file.encoding ?? "utf-8",
    lineEnding: file.lineEnding ?? "lf",
    diskStamp: file.stamp ?? null,
  };
}

function App() {
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  const handleActionRef = useRef<((action: MenuAction) => Promise<void>) | null>(
    null,
  );
  const choiceDialogRef = useRef<ChoiceDialogState | null>(null);
  const recoveryDialogRef = useRef<RecoveryDialogState | null>(null);
  const recoveryReadyRef = useRef(false);
  const pendingErrorsRef = useRef<string[]>([]);
  // Windows opened from the menu start empty; only the first window opens
  // the files the app was launched with.
  const isExtraWindow = useMemo(
    () => new URLSearchParams(window.location.search).has("blank"),
    [],
  );
  const [tabs, setTabs] = useState<DocumentTab[]>(() => [createUntitledTab(1)]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  // Always the latest tabs, also between a state update and its render, so
  // async flows (saving, closing) never act on an outdated list.
  const tabsRef = useRef(tabs);
  const [settings, setSettings] = useState<EditorSettings>(
    defaultEditorSettings,
  );
  // Reading mode is a per-tab view state. It is kept beside the tabs rather
  // than in DocumentTab or EditorSettings, so the recovery snapshot keeps its
  // shape (and a restored session opens in editing mode).
  const [readingTabIds, setReadingTabIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [choiceDialog, setChoiceDialog] = useState<ChoiceDialogState | null>(
    null,
  );
  const [recoveryDialog, setRecoveryDialog] =
    useState<RecoveryDialogState | null>(null);
  const { resolvedTheme, toggleTheme } = useTheme();

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const readingMode = readingTabIds.has(activeTab.id);
  const openTabIds = useMemo(() => tabs.map((tab) => tab.id), [tabs]);
  const groups = useMemo(
    () => menuGroups(settings, { readingMode }),
    [readingMode, settings],
  );
  const showFallbackMenu = !isTauriRuntime();

  const cursorPosition = useMemo(
    () => positionToLineColumn(activeTab.content, activeTab.cursor.head),
    [activeTab.content, activeTab.cursor.head],
  );
  // Counting words scans the whole text; let React do it after the keystroke
  // has been drawn instead of before.
  const deferredContent = useDeferredValue(activeTab.content);
  const wordCount = useMemo(() => countWords(deferredContent), [deferredContent]);
  const status = {
    ...cursorPosition,
    characters: activeTab.content.length,
    words: wordCount,
  };

  const applyTabs = useCallback(
    (update: (current: DocumentTab[]) => DocumentTab[]) => {
      setTabs((current) => {
        const next = update(current);
        tabsRef.current = next;
        return next;
      });
    },
    [],
  );

  const updateTab = useCallback(
    (tabId: string, update: Partial<DocumentTab>) => {
      applyTabs((current) => updateTabById(current, tabId, update));
    },
    [applyTabs],
  );

  const updateActiveTab = useCallback(
    (update: Partial<DocumentTab>) => updateTab(activeTabId, update),
    [activeTabId, updateTab],
  );

  const replaceAllTabs = useCallback(
    (nextTabs: DocumentTab[], nextActiveId: string) => {
      applyTabs(() => nextTabs);
      setActiveTabId(nextActiveId);
    },
    [applyTabs],
  );

  const requestChoice = useCallback(
    <T extends string>(
      message: string,
      buttons: ChoiceButton<T>[],
      cancelValue: T,
    ) =>
      new Promise<T>((resolve) => {
        // A new question replaces one still open; the old one is canceled.
        const open = choiceDialogRef.current;
        open?.resolve(open.cancelValue);

        const dialog: ChoiceDialogState = {
          message,
          buttons,
          cancelValue,
          resolve: (value) => resolve(value as T),
        };

        choiceDialogRef.current = dialog;
        setChoiceDialog(dialog);
      }),
    [],
  );

  const settleChoice = useCallback((value: string) => {
    const dialog = choiceDialogRef.current;

    if (!dialog) {
      return;
    }

    choiceDialogRef.current = null;
    setChoiceDialog(null);
    dialog.resolve(value);
  }, []);

  const showError = useCallback(
    async (message: string) => {
      await requestChoice(message, [{ label: "OK", value: "ok", primary: true }], "ok");
    },
    [requestChoice],
  );

  const addTab = useCallback(() => {
    const tab = createUntitledTab(nextUntitledIndex(tabsRef.current));

    applyTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
  }, [applyTabs]);

  const reloadTab = useCallback(
    async (tabId: string) => {
      const tab = tabsRef.current.find((candidate) => candidate.id === tabId);

      if (!tab?.path) {
        return;
      }

      const file = await reloadMarkdownFile(tab.path);
      applyTabs((current) =>
        current.map((candidate) =>
          candidate.id === tabId ? tabWithFile(candidate, file) : candidate,
        ),
      );
    },
    [applyTabs],
  );

  /**
   * Saves one tab. Resolves to false when nothing was written (canceled,
   * conflict not overwritten); throws when writing failed.
   */
  const saveTab = useCallback(
    async (tabId: string, saveAs: boolean): Promise<boolean> => {
      let overwrite = false;
      let encoding: TextEncoding | undefined;

      for (;;) {
        const tab = tabsRef.current.find((candidate) => candidate.id === tabId);

        if (!tab) {
          return false;
        }

        const result = await saveMarkdownFile(tab, {
          saveAs: saveAs || tab.path === null,
          overwrite,
          encoding,
        });

        switch (result.status) {
          case "saved":
            applyTabs((current) =>
              current.map((candidate) =>
                candidate.id === tabId
                  ? {
                      ...candidate,
                      title: result.title,
                      path: result.path,
                      isUntitled: result.isUntitled,
                      encoding: result.encoding,
                      diskStamp: result.stamp,
                      // Edits typed while the file was being written are
                      // still unsaved.
                      dirty: candidate.content !== tab.content,
                    }
                  : candidate,
              ),
            );
            return true;
          case "canceled":
            return false;
          case "conflict": {
            const decision = await requestChoice(
              `${tab.title} は、開いた後にほかのアプリで変更されています。\n上書き保存すると、その変更は失われます。`,
              [
                { label: "上書き保存", value: "overwrite" },
                { label: "再読み込み（編集を破棄）", value: "reload" },
                { label: "キャンセル", value: "cancel", primary: true },
              ],
              "cancel",
            );

            if (decision === "overwrite") {
              overwrite = true;
              continue;
            }

            if (decision === "reload") {
              await reloadTab(tabId);
            }

            return false;
          }
          case "unencodable": {
            const decision = await requestChoice(
              `${tab.title} には ${encodingLabel(encoding ?? tab.encoding)} で保存できない文字が含まれています。\nUTF-8 で保存しますか？`,
              [
                { label: "UTF-8 で保存", value: "utf-8", primary: true },
                { label: "キャンセル", value: "cancel" },
              ],
              "cancel",
            );

            if (decision !== "utf-8") {
              return false;
            }

            encoding = "utf-8";
            continue;
          }
        }
      }
    },
    [applyTabs, reloadTab, requestChoice],
  );

  const dirtyTabsCanClose = useCallback(
    async (tabIds: readonly string[]) => {
      const dirtyTabs = tabsRef.current.filter(
        (tab) => tab.dirty && tabIds.includes(tab.id),
      );

      if (dirtyTabs.length === 0) {
        return true;
      }

      const message = dirtyTabs.length === 1
        ? `${dirtyTabs[0].title} への変更内容を保存しますか？`
        : `未保存のタブ ${dirtyTabs.length} 件への変更内容を保存しますか？`;
      const decision = await requestChoice(
        message,
        [
          { label: "保存", value: "save", primary: true },
          { label: "保存しない", value: "discard" },
          { label: "キャンセル", value: "cancel" },
        ],
        "cancel",
      );

      if (decision === "cancel") {
        return false;
      }

      if (decision === "discard") {
        return true;
      }

      for (const tab of dirtyTabs) {
        try {
          if (!(await saveTab(tab.id, false))) {
            return false;
          }
        } catch (error) {
          await showError(errorMessage(error));
          return false;
        }
      }

      return true;
    },
    [requestChoice, saveTab, showError],
  );

  const closeTab = useCallback(
    async (tabId: string) => {
      if (!(await dirtyTabsCanClose([tabId]))) {
        return;
      }

      const current = tabsRef.current;
      const index = current.findIndex((tab) => tab.id === tabId);

      if (index < 0) {
        return;
      }

      if (current.length === 1) {
        const replacement = createUntitledTab(1);
        replaceAllTabs([replacement], replacement.id);
        return;
      }

      const remaining = current.filter((tab) => tab.id !== tabId);
      applyTabs((tabsNow) => tabsNow.filter((tab) => tab.id !== tabId));
      setActiveTabId((active) =>
        active === tabId
          ? remaining[Math.min(index, remaining.length - 1)].id
          : active,
      );
    },
    [applyTabs, dirtyTabsCanClose, replaceAllTabs],
  );

  const openFilesInTabs = useCallback(
    (files: OpenedMarkdownFile[]) => {
      if (files.length === 0) {
        return;
      }

      const created = files.map(createTabFromOpenedFile);
      const known = tabsRef.current;
      const lastFile = files[files.length - 1];
      const lastId =
        (lastFile.path
          ? known.find((tab) => tab.path === lastFile.path)?.id
          : undefined) ??
        created.find((tab) => tab.path === lastFile.path)?.id ??
        created[created.length - 1].id;

      applyTabs((current) => {
        // Opening a file replaces an empty, untouched new tab.
        const next =
          current.length === 1 && isPristineUntitledTab(current[0])
            ? []
            : [...current];

        files.forEach((file, index) => {
          const existing = file.path
            ? next.findIndex((tab) => tab.path === file.path)
            : -1;

          if (existing < 0) {
            next.push(created[index]);
          } else if (!next[existing].dirty) {
            // An open tab without edits shows the file as it is now; one
            // with unsaved edits keeps them and is only brought forward.
            next[existing] = tabWithFile(next[existing], file);
          }
        });

        return next;
      });
      setActiveTabId(lastId);
    },
    [applyTabs],
  );

  const openPendingEntries = useCallback(
    async (entries: PendingOpenFile[]) => {
      openFilesInTabs(entries.flatMap((entry) => (entry.file ? [entry.file] : [])));

      for (const entry of entries) {
        if (entry.error) {
          await showError(entry.error);
        }
      }
    },
    [openFilesInTabs, showError],
  );

  const openFile = useCallback(async () => {
    const file = await openMarkdownFile();

    if (file) {
      openFilesInTabs([file]);
    }
  }, [openFilesInTabs]);

  // Files handed over by a second launch wait in the Rust-side queue until
  // this window has settled its startup tabs and any recovery choice, so the
  // startup state cannot overwrite them.
  const openPendingFiles = useCallback(async () => {
    if (!recoveryReadyRef.current) {
      return;
    }

    await openPendingEntries(await takePendingOpenFiles());
  }, [openPendingEntries]);

  const buildSnapshot = useCallback(
    (snapshotTabs: DocumentTab[], snapshotActiveId: string, snapshotSettings: EditorSettings): RecoverySnapshot => ({
      version: 1,
      updatedAt: new Date().toISOString(),
      activeTabId: snapshotActiveId,
      tabs: snapshotTabs,
      settings: snapshotSettings,
    }),
    [],
  );

  const chooseRecoveryDialog = useCallback(
    async (shouldRestore: boolean) => {
      const dialog = recoveryDialogRef.current;

      if (!dialog) {
        return;
      }

      recoveryDialogRef.current = null;
      setRecoveryDialog(null);

      let nextTabs: DocumentTab[];
      let nextActiveId: string;
      let nextSettings = settings;
      const merged = shouldRestore
        ? mergeRecoveredTabs(dialog.snapshots, dialog.launchTabs)
        : null;

      if (merged) {
        // Tabs that were saved when the app stopped are read from disk again,
        // in case the files changed since. A file that cannot be read keeps
        // the recovered text and counts as unsaved.
        nextTabs = await Promise.all(
          merged.tabs.map(async (tab) => {
            if (!tab.path || tab.dirty) {
              return tab;
            }

            try {
              return tabWithFile(tab, await reloadMarkdownFile(tab.path));
            } catch {
              return { ...tab, dirty: true };
            }
          }),
        );
        nextActiveId = merged.activeTabId;
        nextSettings = merged.settings;
        setSettings(merged.settings);
      } else if (dialog.launchTabs.length > 0) {
        nextTabs = dialog.launchTabs;
        nextActiveId = dialog.launchTabs[dialog.launchTabs.length - 1].id;
      } else {
        const replacement = createUntitledTab(1);
        nextTabs = [replacement];
        nextActiveId = replacement.id;
      }

      replaceAllTabs(nextTabs, nextActiveId);

      try {
        await discardRecoverySnapshots(dialog.candidateIds);

        // Write the restored session right away instead of after the usual
        // delay, so it is never unprotected.
        if (merged) {
          await saveRecoverySnapshot(buildSnapshot(nextTabs, nextActiveId, nextSettings));
        }
      } catch {
        // The snapshot is rewritten on the next change anyway.
      }

      setRecoveryReady(true);
    },
    [buildSnapshot, replaceAllTabs, settings],
  );

  /** Closes this window after the unsaved-changes question; false if kept. */
  const closeThisWindow = useCallback(async () => {
    if (!(await dirtyTabsCanClose(tabsRef.current.map((tab) => tab.id)))) {
      return false;
    }

    // Until the restore question is answered, the snapshot is the only copy
    // of the previous session's unsaved text: keep it so the question comes
    // back on the next start.
    if (recoveryReadyRef.current) {
      await discardRecoverySnapshot().catch(() => undefined);
    }

    await closeCurrentWindow();
    return true;
  }, [dirtyTabsCanClose]);

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
          await saveTab(activeTab.id, false);
          break;
        case "save-as":
          await saveTab(activeTab.id, true);
          break;
        case "print": {
          const { markdownPrintDocument } = await import("./markdown");
          await printMarkdownDocument(
            markdownPrintDocument(activeTab.content, activeTab.title, (source) =>
              resolveImageSource(source, activeTab.path),
            ),
          );
          break;
        }
        case "close-tab":
          await closeTab(activeTab.id);
          break;
        case "close-window":
          await closeThisWindow();
          break;
        case "quit":
          // Inside Tauri every window is asked in turn; in a browser only
          // this one can close.
          if (!(await requestQuit())) {
            await closeThisWindow();
          }
          break;
        case "cut":
        case "paste":
          if (readingMode) {
            break;
          }

          editorRef.current?.focus();
          requestAnimationFrame(() => commandEdit(action));
          break;
        case "copy":
          editorRef.current?.focus();
          requestAnimationFrame(() => commandEdit(action));
          break;
        case "find":
          editorRef.current?.openSearch();
          break;
        case "replace":
          // Reading mode cannot replace text, so Ctrl+H does nothing there.
          if (!readingMode) {
            editorRef.current?.openReplace();
          }
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
        case "toggle-reading-mode":
          setReadingTabIds((current) => {
            const next = new Set(current);

            if (!next.delete(activeTab.id)) {
              next.add(activeTab.id);
            }

            return next;
          });
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
      closeThisWindow,
      openFile,
      readingMode,
      saveTab,
    ],
  );

  // Every menu, shortcut and window action goes through here, so a failure
  // (a file that cannot be written or read) is always shown to the user.
  const runAction = useCallback(
    async (action: MenuAction) => {
      try {
        await handleActionRef.current?.(action);
      } catch (error) {
        await showError(errorMessage(error));
      }
    },
    [showError],
  );

  useEffect(() => {
    handleActionRef.current = handleAction;
  }, [handleAction]);

  const closeThisWindowRef = useRef(closeThisWindow);

  useEffect(() => {
    closeThisWindowRef.current = closeThisWindow;
  }, [closeThisWindow]);

  // Quitting the app reaches each window in turn; keeping this window open
  // (Cancel, or a failed save) stops the quit for the remaining windows.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    listenToQuitRequested(() => {
      void (async () => {
        let closed = false;

        try {
          closed = await closeThisWindowRef.current();
        } catch (error) {
          await showError(errorMessage(error));
        }

        if (!closed) {
          await cancelQuit().catch(() => undefined);
        }
      })();
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
  }, [showError]);

  useEffect(() => {
    recoveryDialogRef.current = recoveryDialog;
  }, [recoveryDialog]);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    recoveryReadyRef.current = recoveryReady;

    if (!recoveryReady) {
      return;
    }

    void (async () => {
      // Launch files that could not be read are reported once the window is
      // usable.
      const errors = pendingErrorsRef.current.splice(0);

      for (const error of errors) {
        await showError(error);
      }

      await openPendingFiles();
    })();
  }, [openPendingFiles, recoveryReady, showError]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    listenToOpenFilesRequested(() => {
      void openPendingFiles();
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
  }, [openPendingFiles]);

  useEffect(() => {
    let mounted = true;

    void (async () => {
      const [launchEntries, candidates] = await Promise.all([
        isExtraWindow ? Promise.resolve([]) : loadLaunchMarkdownFiles(),
        loadRecoverySnapshots().catch((): RecoveryCandidate[] => []),
      ]);

      if (!mounted) {
        return;
      }

      const launchTabs = launchEntries.flatMap((entry) =>
        entry.file ? [createTabFromOpenedFile(entry.file)] : [],
      );
      pendingErrorsRef.current.push(
        ...launchEntries.flatMap((entry) => (entry.error ? [entry.error] : [])),
      );

      if (launchTabs.length > 0) {
        replaceAllTabs(launchTabs, launchTabs[launchTabs.length - 1].id);
      }

      const snapshots = candidates
        .map((candidate) => candidate.snapshot)
        .filter(isRecoverySnapshot)
        .filter((snapshot) => snapshot.tabs.length > 0);

      if (snapshots.some(snapshotHasUnsavedChanges)) {
        setRecoveryDialog({
          message: candidates.some((candidate) => candidate.fromPreviousSession)
            ? previousSessionMessage
            : reloadedWindowMessage,
          snapshots,
          candidateIds: candidates.map((candidate) => candidate.id),
          launchTabs,
        });
        return;
      }

      // Nothing unsaved to recover: the files can simply be opened again.
      await discardRecoverySnapshots(candidates.map((candidate) => candidate.id)).catch(
        () => undefined,
      );

      if (mounted) {
        setRecoveryReady(true);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [isExtraWindow, replaceAllTabs]);

  // Snapshot as soon as the text or the set of tabs changes; changes of only
  // the cursor or scroll position are written less often.
  const snapshotSignatureRef = useRef<unknown[]>([]);

  useEffect(() => {
    if (!recoveryReady) {
      return;
    }

    const signature: unknown[] = [activeTabId, settings];

    for (const tab of tabs) {
      signature.push(
        tab.id,
        tab.content,
        tab.dirty,
        tab.path,
        tab.title,
        tab.encoding,
        tab.lineEnding,
        tab.diskStamp,
      );
    }

    const previous = snapshotSignatureRef.current;
    const contentChanged =
      signature.length !== previous.length ||
      signature.some((value, index) => value !== previous[index]);

    const timeoutId = window.setTimeout(() => {
      snapshotSignatureRef.current = signature;
      void saveRecoverySnapshot(buildSnapshot(tabs, activeTabId, settings)).catch(
        (error) => console.error("recovery snapshot failed", error),
      );
    }, contentChanged ? 350 : 2000);

    return () => window.clearTimeout(timeoutId);
  }, [activeTabId, buildSnapshot, recoveryReady, settings, tabs]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    listenToMenuActions((action) => {
      void runAction(action);
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
  }, [runAction]);

  // Forget closed (or replaced) tabs so their ids do not pile up.
  useEffect(() => {
    setReadingTabIds((current) => {
      const openIds = new Set(tabs.map((tab) => tab.id));
      const kept = [...current].filter((id) => openIds.has(id));

      return kept.length === current.size ? current : new Set(kept);
    });
  }, [tabs]);

  const viewMenuStateRef = useRef({
    readingMode,
    wordWrap: settings.wordWrap,
    showStatusBar: settings.showStatusBar,
  });

  useEffect(() => {
    viewMenuStateRef.current = {
      readingMode,
      wordWrap: settings.wordWrap,
      showStatusBar: settings.showStatusBar,
    };
    void syncNativeViewMenu(viewMenuStateRef.current);
  }, [readingMode, settings.showStatusBar, settings.wordWrap]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    // The native menu is shared by every window; show this window's state
    // whenever it becomes the focused one.
    listenToWindowFocus(() => {
      void syncNativeViewMenu(viewMenuStateRef.current);
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
      void runAction("close-window");
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
  }, [runAction]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // A key the editor already handled must not run a second action.
      if (
        event.defaultPrevented ||
        choiceDialogRef.current ||
        recoveryDialogRef.current
      ) {
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

      void runAction(command);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runAction]);

  useEffect(() => {
    if (!choiceDialog) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        const dialog = choiceDialogRef.current;

        if (dialog) {
          settleChoice(dialog.cancelValue);
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [choiceDialog, settleChoice]);

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
            onAction={(action) => void runAction(action)}
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
          docId={activeTab.id}
          openDocIds={openTabIds}
          documentPath={activeTab.path}
          value={activeTab.content}
          cursor={activeTab.cursor}
          scroll={activeTab.scroll}
          wordWrap={settings.wordWrap}
          zoom={settings.zoom}
          readingMode={readingMode}
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
          readingMode={readingMode}
          encoding={activeTab.encoding}
          lineEnding={activeTab.lineEnding}
        />
      ) : null}

      {recoveryDialog ? (
        <ModalDialog
          id="recovery-dialog"
          title="MarkdownPad"
          message={recoveryDialog.message}
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

      {choiceDialog ? (
        <ModalDialog
          id="choice-dialog"
          title="MarkdownPad"
          message={choiceDialog.message}
          buttons={choiceDialog.buttons.map((button) => ({
            label: button.label,
            primary: button.primary,
            autoFocus: button.primary,
            onClick: () => settleChoice(button.value),
          }))}
        />
      ) : null}
    </div>
  );
}

export default App;
