import type { MenuAction } from "./platform";
import type { EditorSettings } from "./types";

export interface MenuItem {
  action: MenuAction;
  label: string;
  shortcut?: string;
  checked?: boolean;
  separatorBefore?: boolean;
}

export interface MenuGroup {
  id: string;
  label: string;
  items: MenuItem[];
}

export type ShortcutCommand = MenuAction | "find-next" | "find-previous";

export function menuGroups(settings: EditorSettings): MenuGroup[] {
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

export function shortcutCommandFromEvent(
  event: KeyboardEvent,
): ShortcutCommand | null {
  if (event.altKey) {
    return null;
  }

  if (event.key === "F3" && !event.ctrlKey && !event.metaKey) {
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

export function commandEdit(action: "cut" | "copy" | "paste") {
  document.execCommand(action);
}
