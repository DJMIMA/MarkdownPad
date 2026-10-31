import type { DocumentTab } from "../types";

interface TabStripProps {
  tabs: DocumentTab[];
  activeTabId: string;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onAdd: () => void;
}

export function TabStrip({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onAdd,
}: TabStripProps) {
  return (
    <div className="tab-strip" role="tablist" aria-label="Open tabs">
      {tabs.map((tab) => (
        // A tab is not a <button>, so the close button inside it is not an
        // interactive element nested in another one.
        <div
          key={tab.id}
          className={`tab-button ${tab.id === activeTabId ? "active" : ""}`}
          role="tab"
          tabIndex={tab.id === activeTabId ? 0 : -1}
          aria-selected={tab.id === activeTabId}
          onClick={() => onSelect(tab.id)}
          onMouseDown={(event) => {
            // Middle click closes the tab, as in browsers.
            if (event.button === 1) {
              event.preventDefault();
              onClose(tab.id);
            }
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) {
              return;
            }

            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect(tab.id);
            }
          }}
        >
          <span className="tab-title" title={tab.path ?? tab.title}>
            {tab.title}
          </span>
          <button
            type="button"
            className={tab.dirty ? "close-tab is-dirty" : "close-tab"}
            aria-label={
              tab.dirty
                ? `${tab.title}（未保存）を閉じる`
                : `${tab.title} を閉じる`
            }
            title={tab.dirty ? "未保存の変更があります" : undefined}
            onClick={(event) => {
              event.stopPropagation();
              onClose(tab.id);
            }}
          >
            ×
          </button>
        </div>
      ))}

      <button
        className="new-tab-button"
        type="button"
        title="新しいタブ"
        aria-label="新しいタブ"
        onClick={onAdd}
      >
        +
      </button>
    </div>
  );
}
