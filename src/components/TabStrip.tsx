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
        <button
          key={tab.id}
          className={`tab-button ${tab.id === activeTabId ? "active" : ""}`}
          type="button"
          role="tab"
          aria-selected={tab.id === activeTabId}
          onClick={() => onSelect(tab.id)}
        >
          <span className="tab-title">
            {tab.dirty ? `${tab.title} *` : tab.title}
          </span>
          <span
            className="close-tab"
            role="button"
            aria-label={`${tab.title} を閉じる`}
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              onClose(tab.id);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onClose(tab.id);
              }
            }}
          >
            ×
          </span>
        </button>
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
