import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import {
  associationState,
  associationStateLabel,
  extensionAppLabel,
  type FileAssociationStatus,
} from "../fileAssociation";
import {
  errorMessage,
  listenToWindowFocus,
  loadFileAssociationStatus,
  openDefaultAppsSettings,
  registerFileAssociation,
  unregisterFileAssociation,
} from "../platform";

interface SettingsDialogProps {
  onClose: () => void;
}

const chooseDefaultMessage =
  "Windows の設定で、.md と .markdown の既定のアプリに MarkdownPad を選んでください。";

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const [status, setStatus] = useState<FileAssociationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await loadFileAssociationStatus());
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The default app is chosen in Windows' Settings app; show the result when
  // the user comes back to this window.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const onFocus = () => void refresh();

    window.addEventListener("focus", onFocus);
    listenToWindowFocus(onFocus).then((cleanup) => {
      if (disposed) {
        cleanup?.();
        return;
      }

      unlisten = cleanup;
    });

    return () => {
      disposed = true;
      window.removeEventListener("focus", onFocus);
      unlisten?.();
    };
  }, [refresh]);

  async function run(task: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      setNotice(await task());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const register = () =>
    run(async () => {
      const next = await registerFileAssociation();
      setStatus(next);

      if (associationState(next) === "default") {
        return "登録しました。";
      }

      await openDefaultAppsSettings();
      return chooseDefaultMessage;
    });

  const chooseDefault = () =>
    run(async () => {
      await openDefaultAppsSettings();
      return chooseDefaultMessage;
    });

  const unregister = () =>
    run(async () => {
      setStatus(await unregisterFileAssociation());
      return "登録を解除しました。";
    });

  useEffect(() => {
    function onEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [onClose]);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    // Keep Tab / Shift+Tab inside the dialog, away from the editor.
    if (event.key !== "Tab") {
      return;
    }

    const focusable = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    ];

    if (focusable.length === 0) {
      return;
    }

    const index = focusable.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.shiftKey
      ? (index <= 0 ? focusable.length : index) - 1
      : (index + 1) % focusable.length;

    event.preventDefault();
    focusable[next].focus();
  }

  const state = status ? associationState(status) : null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="unsaved-dialog settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        onKeyDown={onKeyDown}
      >
        <h2 id="settings-dialog-title">設定</h2>

        <div className="settings-section" aria-labelledby="settings-association-title">
          <h3 id="settings-association-title">ファイルの関連付け</h3>
          <p className="settings-note">
            エクスプローラーでダブルクリックした Markdown ファイルを MarkdownPad で開きます。
          </p>

          <table className="settings-table">
            <tbody>
              <tr>
                <th scope="row">状態</th>
                <td data-testid="association-state">
                  {state ? associationStateLabel(state) : "確認しています…"}
                </td>
              </tr>
              {state === "moved" && status?.registeredPath ? (
                <tr>
                  <th scope="row">登録先</th>
                  <td className="settings-path">{status.registeredPath}</td>
                </tr>
              ) : null}
              {status?.extensions.map((extension) => (
                <tr key={extension.extension}>
                  <th scope="row">{extension.extension}</th>
                  <td>{extensionAppLabel(extension)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {state && state !== "unsupported" ? (
            <div className="settings-actions">
              {state === "unregistered" || state === "moved" ? (
                <button type="button" className="primary" disabled={busy} onClick={register}>
                  {state === "moved" ? "この場所で登録し直す" : "関連付けを登録"}
                </button>
              ) : null}
              {state === "registered" ? (
                <button type="button" className="primary" disabled={busy} onClick={chooseDefault}>
                  既定のアプリを選ぶ…
                </button>
              ) : null}
              {state !== "unregistered" ? (
                <button type="button" className="danger" disabled={busy} onClick={unregister}>
                  登録を解除
                </button>
              ) : null}
            </div>
          ) : null}

          {notice ? (
            <p className="settings-message" role="status">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p className="settings-message settings-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="unsaved-dialog-actions">
          <button type="button" autoFocus onClick={onClose}>
            閉じる
          </button>
        </div>
      </section>
    </div>
  );
}
