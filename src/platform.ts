import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MarkdownPrintDocument } from "./markdown";
import type { DocumentTab, RecoverySnapshot } from "./types";

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
  | "toggle-word-wrap"
  | "toggle-status-bar";

export interface OpenedMarkdownFile {
  title: string;
  path: string | null;
  content: string;
}

const recoveryStorageKey = "markdownpad.recovery.v1";
const printStorageKeyPrefix = "markdownpad.print.";

export function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function fileTitleFromPath(path: string) {
  const normalizedPath = path.replace(/\\/g, "/");
  return normalizedPath.split("/").pop() || "Markdown";
}

function readBrowserFile(file: File): Promise<OpenedMarkdownFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      resolve({
        title: file.name,
        path: null,
        content: typeof reader.result === "string" ? reader.result : "",
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
  return pickBrowserFile();
}

export async function loadLaunchMarkdownFile(): Promise<OpenedMarkdownFile | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  try {
    return await invoke<OpenedMarkdownFile | null>("load_launch_markdown_file");
  } catch {
    return null;
  }
}

export async function saveMarkdownFile(
  tab: DocumentTab,
  options: { saveAs?: boolean } = {},
): Promise<Pick<DocumentTab, "title" | "path" | "dirty" | "isUntitled">> {
  if (isTauriRuntime() && tab.path && !options.saveAs) {
    await invoke("write_text_file", {
      path: tab.path,
      content: tab.content,
    });

    return {
      title: tab.title,
      path: tab.path,
      dirty: false,
      isUntitled: false,
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
    const handle = await picker({
      suggestedName: tab.path ? fileTitleFromPath(tab.path) : `${tab.title}.md`,
      types: [
        {
          description: "Markdown",
          accept: {
            "text/markdown": [".md", ".markdown"],
          },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(tab.content);
    await writable.close();

    return {
      title: handle.name ?? tab.title,
      path: null,
      dirty: false,
      isUntitled: false,
    };
  }

  await writeBrowserDownload(tab.title, tab.content);

  return {
    title: tab.title,
    path: tab.path,
    dirty: false,
    isUntitled: tab.isUntitled,
  };
}

export async function saveRecoverySnapshot(snapshot: RecoverySnapshot) {
  if (isTauriRuntime()) {
    try {
      await invoke("save_recovery_snapshot", {
        snapshot,
      });
      return;
    } catch {
      // Browser storage fallback keeps development and Playwright flows usable.
    }
  }

  localStorage.setItem(recoveryStorageKey, JSON.stringify(snapshot));
}

export async function discardRecoverySnapshot() {
  if (isTauriRuntime()) {
    try {
      await invoke("discard_recovery_snapshot");
      return;
    } catch {
      // Fall through to browser storage cleanup.
    }
  }

  localStorage.removeItem(recoveryStorageKey);
}

export async function loadRecoverySnapshot(): Promise<RecoverySnapshot | null> {
  if (isTauriRuntime()) {
    try {
      return await invoke<RecoverySnapshot | null>("load_recovery_snapshot");
    } catch {
      // Fall through to browser storage.
    }
  }

  const stored = localStorage.getItem(recoveryStorageKey);

  if (!stored) {
    return null;
  }

  try {
    return JSON.parse(stored) as RecoverySnapshot;
  } catch {
    return null;
  }
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
  localStorage.setItem(printStorageKey(id), JSON.stringify(document));
  return id;
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
    `markdownpad-print-${crypto.randomUUID()}`,
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

export async function listenToMenuActions(
  onAction: (action: MenuAction) => void,
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  return listen<MenuAction>("menu-action", (event) => {
    onAction(event.payload);
  });
}
