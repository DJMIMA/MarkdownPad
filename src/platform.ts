import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  WebviewWindow,
  getCurrentWebviewWindow,
} from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MarkdownPrintDocument } from "./markdown";
import { resolveImageReference } from "./paths";
import { normalizeLineEndings } from "./state";
import type {
  DocumentTab,
  FileStamp,
  LineEnding,
  RecoverySnapshot,
  TextEncoding,
} from "./types";

export type MenuAction =
  | "new-tab"
  | "new-window"
  | "open"
  | "save"
  | "save-as"
  | "print"
  | "close-tab"
  | "close-window"
  | "quit"
  | "cut"
  | "copy"
  | "paste"
  | "find"
  | "replace"
  | "select-all"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "toggle-reading-mode"
  | "toggle-word-wrap"
  | "toggle-status-bar";

export interface OpenedMarkdownFile {
  title: string;
  path: string | null;
  content: string;
  encoding?: TextEncoding;
  lineEnding?: LineEnding;
  stamp?: FileStamp | null;
}

/** A file passed on the command line: its contents, or why it failed. */
export interface PendingOpenFile {
  path: string;
  file: OpenedMarkdownFile | null;
  error: string | null;
}

export type SaveResult =
  | {
      status: "saved";
      title: string;
      path: string | null;
      isUntitled: boolean;
      stamp: FileStamp | null;
      encoding: TextEncoding;
    }
  | { status: "canceled" }
  /** The file changed on disk since it was opened or last saved. */
  | { status: "conflict" }
  /** The text has characters the chosen encoding cannot represent. */
  | { status: "unencodable" };

export interface RecoveryCandidate {
  id: string;
  fromPreviousSession: boolean;
  snapshot: unknown;
}

const recoveryStorageKey = "markdownpad.recovery.v1";
const printStorageKeyPrefix = "markdownpad.print.";

export function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Image reference -> loadable URL for the document at `documentPath`. */
export function resolveImageSource(
  source: string,
  documentPath: string | null,
): string | null {
  return resolveImageReference(
    source,
    documentPath,
    isTauriRuntime() ? (path) => convertFileSrc(path) : null,
  );
}

/** Turns an error from a command (a string from Rust) into a message. */
export function errorMessage(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function fileTitleFromPath(path: string) {
  const normalizedPath = path.replace(/\\/g, "/");
  return normalizedPath.split("/").pop() || "Markdown";
}

function readBrowserFile(file: File): Promise<OpenedMarkdownFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      const { content, lineEnding } = normalizeLineEndings(text);

      resolve({
        title: file.name,
        path: null,
        content,
        encoding: "utf-8",
        lineEnding,
        stamp: null,
      });
    });

    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsText(file);
  });
}

function pickBrowserFile(): Promise<OpenedMarkdownFile | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,text/markdown,text/plain";
    input.style.position = "fixed";
    input.style.left = "-9999px";

    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0] ?? null;
        input.remove();

        if (!file) {
          resolve(null);
          return;
        }

        readBrowserFile(file).then(resolve, reject);
      },
      { once: true },
    );

    document.body.append(input);
    input.click();
  });
}

async function writeBrowserDownload(title: string, content: string) {
  const blob = new Blob([content], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = title.endsWith(".md") || title.endsWith(".markdown")
    ? title
    : `${title}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function openMarkdownFile(): Promise<OpenedMarkdownFile | null> {
  if (isTauriRuntime()) {
    return await invoke<OpenedMarkdownFile | null>("open_markdown_file_dialog");
  }

  return pickBrowserFile();
}

/** Files the app was started with (file association, "Open with"). */
export async function loadLaunchMarkdownFiles(): Promise<PendingOpenFile[]> {
  if (!isTauriRuntime()) {
    return [];
  }

  try {
    return (await invoke<PendingOpenFile[] | null>("load_launch_markdown_files")) ?? [];
  } catch (error) {
    return [{ path: "", file: null, error: errorMessage(error) }];
  }
}

/** Reads a file that is already open again, e.g. after a conflict. */
export async function reloadMarkdownFile(path: string): Promise<OpenedMarkdownFile> {
  return await invoke<OpenedMarkdownFile>("reload_markdown_file", { path });
}

type RustSaveResult =
  | { status: "saved"; stamp: FileStamp | null }
  | { status: "conflict" }
  | { status: "unencodable" };

type RustSaveAsResult =
  | { status: "saved"; title: string; path: string; stamp: FileStamp | null }
  | { status: "canceled" }
  | { status: "unencodable" };

export async function saveMarkdownFile(
  tab: DocumentTab,
  options: {
    saveAs?: boolean;
    /** Write even if the file changed on disk since it was read. */
    overwrite?: boolean;
    encoding?: TextEncoding;
  } = {},
): Promise<SaveResult> {
  const encoding = options.encoding ?? tab.encoding ?? "utf-8";
  const lineEnding = tab.lineEnding ?? "lf";

  if (isTauriRuntime() && tab.path && !options.saveAs) {
    const result = await invoke<RustSaveResult>("save_markdown_file", {
      path: tab.path,
      content: tab.content,
      encoding,
      lineEnding,
      expectedStamp: tab.diskStamp ?? null,
      overwrite: options.overwrite ?? false,
    });

    if (result.status !== "saved") {
      return result;
    }

    return {
      status: "saved",
      title: tab.title,
      path: tab.path,
      isUntitled: false,
      stamp: result.stamp,
      encoding,
    };
  }

  const suggestedName = tab.path ? fileTitleFromPath(tab.path) : `${tab.title}.md`;

  if (isTauriRuntime()) {
    const result = await invoke<RustSaveAsResult>("save_markdown_file_as_dialog", {
      suggestedName,
      content: tab.content,
      encoding,
      lineEnding,
    });

    if (result.status !== "saved") {
      return result;
    }

    return {
      status: "saved",
      title: result.title,
      path: result.path,
      isUntitled: false,
      stamp: result.stamp,
      encoding,
    };
  }

  const picker = (window as Window & {
    showSaveFilePicker?: (options?: unknown) => Promise<{
      name?: string;
      createWritable: () => Promise<{
        write: (content: string) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  }).showSaveFilePicker;

  if (picker) {
    let handle;

    try {
      handle = await picker({
        suggestedName,
        types: [
          {
            description: "Markdown",
            accept: {
              "text/markdown": [".md", ".markdown"],
            },
          },
        ],
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return { status: "canceled" };
      }

      throw error;
    }

    const writable = await handle.createWritable();
    await writable.write(tab.content);
    await writable.close();

    return {
      status: "saved",
      title: handle.name ?? tab.title,
      path: null,
      isUntitled: false,
      stamp: null,
      encoding: "utf-8",
    };
  }

  await writeBrowserDownload(tab.title, tab.content);

  return {
    status: "saved",
    title: tab.title,
    path: tab.path,
    isUntitled: tab.isUntitled,
    stamp: null,
    encoding: "utf-8",
  };
}

// In the browser (development and the Playwright checks) a single
// localStorage entry stands in for the snapshot files; extra windows opened
// with ?blank=1 neither read nor write it.
function browserRecoveryEnabled() {
  return !new URLSearchParams(window.location.search).has("blank");
}

/** Saves this window's own crash-recovery snapshot. */
export async function saveRecoverySnapshot(snapshot: RecoverySnapshot) {
  if (isTauriRuntime()) {
    await invoke("save_recovery_snapshot", { snapshot });
    return;
  }

  if (browserRecoveryEnabled()) {
    localStorage.setItem(recoveryStorageKey, JSON.stringify(snapshot));
  }
}

/** Removes this window's own snapshot when it closes normally. */
export async function discardRecoverySnapshot() {
  if (isTauriRuntime()) {
    await invoke("discard_recovery_snapshot");
    return;
  }

  if (browserRecoveryEnabled()) {
    localStorage.removeItem(recoveryStorageKey);
  }
}

/**
 * Snapshots this window should offer to restore: those left by a session
 * that did not end normally (main window only), and this window's own
 * snapshot if its page was reloaded.
 */
export async function loadRecoverySnapshots(): Promise<RecoveryCandidate[]> {
  if (isTauriRuntime()) {
    return (await invoke<RecoveryCandidate[] | null>("load_recovery_snapshots")) ?? [];
  }

  if (!browserRecoveryEnabled()) {
    return [];
  }

  const stored = localStorage.getItem(recoveryStorageKey);

  if (!stored) {
    return [];
  }

  let snapshot: unknown = null;

  try {
    snapshot = JSON.parse(stored);
  } catch {
    // Returned as unreadable so it is removed with the decision.
  }

  return [{ id: "local", fromPreviousSession: true, snapshot }];
}

/** Removes the snapshots that were offered once the user has decided. */
export async function discardRecoverySnapshots(ids: string[]) {
  if (ids.length === 0) {
    return;
  }

  if (isTauriRuntime()) {
    await invoke("discard_recovery_snapshots", { ids });
    return;
  }

  localStorage.removeItem(recoveryStorageKey);
}

function printStorageKey(id: string) {
  return `${printStorageKeyPrefix}${id}`;
}

function printDocumentRoute(id: string) {
  return `/?print=${encodeURIComponent(id)}`;
}

function isMarkdownPrintDocument(
  value: unknown,
): value is MarkdownPrintDocument {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as MarkdownPrintDocument).title === "string" &&
    typeof (value as MarkdownPrintDocument).bodyHtml === "string" &&
    typeof (value as MarkdownPrintDocument).styles === "string"
  );
}

export function readStoredPrintDocument(
  id: string,
): MarkdownPrintDocument | null {
  const stored = localStorage.getItem(printStorageKey(id));

  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as unknown;
    return isMarkdownPrintDocument(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function discardStoredPrintDocument(id: string) {
  localStorage.removeItem(printStorageKey(id));
}

function storePrintDocument(document: MarkdownPrintDocument) {
  const id = crypto.randomUUID();

  try {
    localStorage.setItem(
      printStorageKey(id),
      JSON.stringify({ ...document, createdAt: Date.now() }),
    );
  } catch {
    throw new Error("文書が大きすぎるため印刷できませんでした。");
  }

  return id;
}

/**
 * Removes print data that a print window never picked up (for example when
 * it was closed before printing). Print windows read theirs right away.
 */
export function discardStalePrintDocuments(maxAgeMs = 10 * 60 * 1000) {
  const now = Date.now();

  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);

    if (!key?.startsWith(printStorageKeyPrefix)) {
      continue;
    }

    let createdAt = 0;

    try {
      createdAt = Number(JSON.parse(localStorage.getItem(key) ?? "{}").createdAt) || 0;
    } catch {
      // Unreadable entries are removed.
    }

    if (now - createdAt > maxAgeMs) {
      localStorage.removeItem(key);
    }
  }
}

function openBrowserPrintWindow(route: string) {
  const printWindow = window.open(route, "_blank");

  if (!printWindow) {
    return false;
  }

  printWindow.focus();
  return true;
}

function openTauriPrintWindow(route: string, title: string, printDocumentId: string) {
  const printWindow = new WebviewWindow(
    `print-${crypto.randomUUID()}`,
    {
      url: route,
      title: `印刷 - ${title}`,
      width: 900,
      height: 720,
      minWidth: 640,
      minHeight: 480,
      center: true,
      focus: true,
    },
  );

  void printWindow.once("tauri://error", () => {
    discardStoredPrintDocument(printDocumentId);
  });
}

export async function printMarkdownDocument(document: MarkdownPrintDocument) {
  const printDocumentId = storePrintDocument(document);
  const route = printDocumentRoute(printDocumentId);

  if (isTauriRuntime()) {
    try {
      openTauriPrintWindow(route, document.title, printDocumentId);
      return;
    } catch {
      discardStoredPrintDocument(printDocumentId);
    }
  }

  if (!openBrowserPrintWindow(route)) {
    discardStoredPrintDocument(printDocumentId);
    return;
  }
}

function normalizedExternalUrl(url: string) {
  const trimmedUrl = url.trim();

  if (/^https?:\/\//i.test(trimmedUrl)) {
    return trimmedUrl;
  }

  if (/^(mailto|tel):/i.test(trimmedUrl)) {
    return trimmedUrl;
  }

  if (/^www\./i.test(trimmedUrl)) {
    return `https://${trimmedUrl}`;
  }

  return null;
}

export async function openExternalUrl(url: string) {
  const normalizedUrl = normalizedExternalUrl(url);

  if (!normalizedUrl) {
    return;
  }

  if (isTauriRuntime()) {
    try {
      await invoke("open_external_url", {
        url: normalizedUrl,
      });
      return;
    } catch {
      // Fall through to browser behavior in dev-like runtimes.
    }
  }

  window.open(normalizedUrl, "_blank", "noopener,noreferrer");
}

export async function openApplicationWindow() {
  if (isTauriRuntime()) {
    new WebviewWindow(`markdownpad-${crypto.randomUUID()}`, {
      url: "/?blank=1",
      title: "MarkdownPad",
      width: 1120,
      height: 760,
      minWidth: 760,
      minHeight: 520,
      center: true,
      focus: true,
    });
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.set("blank", "1");
  window.open(url.toString(), "_blank", "noopener,noreferrer");
}

export async function closeCurrentWindow() {
  if (isTauriRuntime()) {
    await getCurrentWindow().destroy();
    return;
  }

  window.close();
}

/**
 * Starts quitting the whole app: each editor window is asked in turn to
 * close (with its own unsaved-changes question). Returns false outside Tauri,
 * where only the current window can be closed.
 */
export async function requestQuit() {
  if (!isTauriRuntime()) {
    return false;
  }

  await invoke("request_quit");
  return true;
}

/** Tells the Rust side this window stays open, which stops the quit. */
export async function cancelQuit() {
  if (isTauriRuntime()) {
    await invoke("cancel_quit");
  }
}

export async function listenToQuitRequested(
  onQuitRequested: () => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  return getCurrentWebviewWindow().listen("quit-requested", () => {
    onQuitRequested();
  });
}

export async function listenToCloseRequested(
  onCloseRequested: () => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  return getCurrentWindow().onCloseRequested((event) => {
    event.preventDefault();
    onCloseRequested();
  });
}

export interface ViewMenuState {
  readingMode: boolean;
  wordWrap: boolean;
  showStatusBar: boolean;
}

// Keeps the native View menu check marks in line with this window's state.
export async function syncNativeViewMenu(state: ViewMenuState) {
  if (!isTauriRuntime()) {
    return;
  }

  try {
    await invoke("sync_view_menu", { ...state });
  } catch {
    // A stale check mark is cosmetic; never let it break the editor.
  }
}

export async function listenToWindowFocus(
  onFocus: () => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  return getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (focused) {
      onFocus();
    }
  });
}

export async function listenToMenuActions(
  onAction: (action: MenuAction) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  // Listen on this window only: the Rust side sends menu actions to the
  // window the menu was used in.
  return getCurrentWebviewWindow().listen<MenuAction>("menu-action", (event) => {
    onAction(event.payload);
  });
}

/**
 * Files the running instance received from a second launch, such as a
 * double-click on a Markdown file in Explorer. The Rust side queues them per
 * window, so nothing is lost while this window is still starting up.
 */
export async function takePendingOpenFiles(): Promise<PendingOpenFile[]> {
  if (!isTauriRuntime()) {
    return [];
  }

  try {
    return (await invoke<PendingOpenFile[] | null>("take_pending_open_files")) ?? [];
  } catch (error) {
    return [{ path: "", file: null, error: errorMessage(error) }];
  }
}

export async function listenToOpenFilesRequested(
  onRequested: () => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  return getCurrentWebviewWindow().listen("open-files-requested", () => {
    onRequested();
  });
}
