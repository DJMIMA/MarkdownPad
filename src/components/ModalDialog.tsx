import type { KeyboardEvent } from "react";

export interface DialogButton {
  label: string;
  onClick: () => void;
  primary?: boolean;
  autoFocus?: boolean;
}

interface ModalDialogProps {
  id: string;
  title: string;
  message: string;
  buttons: DialogButton[];
}

export function ModalDialog({ id, title, message, buttons }: ModalDialogProps) {
  const titleId = `${id}-title`;
  const messageId = `${id}-message`;

  // Keep Tab / Shift+Tab on the dialog's buttons, so the keyboard cannot
  // reach (and type into) the editor behind it.
  function trapFocus(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") {
      return;
    }

    const focusable = [...event.currentTarget.querySelectorAll("button")];

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

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="unsaved-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onKeyDown={trapFocus}
      >
        <h2 id={titleId}>{title}</h2>
        <p id={messageId}>{message}</p>
        <div className="unsaved-dialog-actions">
          {buttons.map((button, index) => (
            <button
              key={button.label}
              type="button"
              className={button.primary ? "primary" : undefined}
              autoFocus={button.autoFocus ?? index === 0}
              onClick={button.onClick}
            >
              {button.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
