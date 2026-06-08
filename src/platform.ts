import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
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

export async function printMarkdownHtml(html: string) {
  if (isTauriRuntime()) {
    try {
      await invoke("print_html", {
        html,
      });
      return;
    } catch {
      // Browser print fallback is enough for dev-server verification.
    }
  }

  const printWindow = window.open("", "_blank", "noopener,noreferrer");

  if (!printWindow) {
    return;
  }

  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
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
