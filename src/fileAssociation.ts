export interface ExtensionAssociation {
  extension: string;
  /** Explorer opens this extension with the running MarkdownPad. */
  isDefault: boolean;
  /** The app Explorer opens it with now, if any. */
  defaultApp: string | null;
  /** That app's exe. */
  defaultPath?: string | null;
}

export interface FileAssociationStatus {
  supported: boolean;
  /** The exe that is running now. */
  exePath: string | null;
  /** The exe the registered association opens, if MarkdownPad is registered. */
  registeredPath: string | null;
  extensions: ExtensionAssociation[];
}

export type AssociationState =
  | "unsupported"
  | "unregistered"
  /** Registered for an exe in another place (the portable exe was moved). */
  | "moved"
  /** Registered, but not every extension opens with MarkdownPad yet. */
  | "registered"
  | "default";

export const unsupportedAssociationStatus: FileAssociationStatus = {
  supported: false,
  exePath: null,
  registeredPath: null,
  extensions: [],
};

function samePath(a: string, b: string) {
  const normalize = (path: string) => path.replace(/\//g, "\\").toLowerCase();
  return normalize(a) === normalize(b);
}

export function associationState(status: FileAssociationStatus): AssociationState {
  if (!status.supported) {
    return "unsupported";
  }

  if (!status.registeredPath) {
    return "unregistered";
  }

  if (status.exePath && !samePath(status.registeredPath, status.exePath)) {
    return "moved";
  }

  return status.extensions.length > 0 &&
    status.extensions.every((extension) => extension.isDefault)
    ? "default"
    : "registered";
}

export function associationStateLabel(state: AssociationState) {
  switch (state) {
    case "unsupported":
      return "この環境では利用できません（Windows 版のみ）";
    case "unregistered":
      return "未登録";
    case "moved":
      return "別の場所の MarkdownPad が登録されています";
    case "registered":
      return "登録済み（既定のアプリは未設定）";
    case "default":
      return "登録済み・既定のアプリ";
  }
}

export function extensionAppLabel(extension: ExtensionAssociation) {
  if (extension.isDefault) {
    return "MarkdownPad";
  }

  if (!extension.defaultApp) {
    return "なし";
  }

  // Another copy of MarkdownPad (in another folder) has the same name.
  if (extension.defaultPath && /markdownpad/i.test(extension.defaultApp)) {
    return `${extension.defaultApp}（${extension.defaultPath}）`;
  }

  return extension.defaultApp;
}
