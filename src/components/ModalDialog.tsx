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

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="unsaved-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
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
