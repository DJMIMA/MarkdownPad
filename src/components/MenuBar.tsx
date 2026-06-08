import type { MenuAction } from "../platform";
import type { MenuGroup } from "../menu";

interface MenuBarProps {
  groups: MenuGroup[];
  openMenuId: string | null;
  onToggleMenu: (id: string) => void;
  onAction: (action: MenuAction) => void;
}

export function MenuBar({
  groups,
  openMenuId,
  onToggleMenu,
  onAction,
}: MenuBarProps) {
  return (
    <nav className="menu-bar" aria-label="Application menu">
      {groups.map((group) => (
        <div className="menu-root" key={group.id}>
          <button
            className="menu-root-button"
            type="button"
            aria-expanded={openMenuId === group.id}
            onClick={() => onToggleMenu(group.id)}
          >
            {group.label}
          </button>

          {openMenuId === group.id ? (
            <div className="menu-popover" role="menu">
              {group.items.map((item) => (
                <button
                  key={item.action}
                  className={
                    item.separatorBefore
                      ? "menu-item separator-before"
                      : "menu-item"
                  }
                  type="button"
                  role="menuitem"
                  onClick={() => onAction(item.action)}
                >
                  <span>{item.label}</span>
                  <span className="menu-shortcut">{item.shortcut ?? ""}</span>
                  <span className="menu-check" aria-hidden="true">
                    {item.checked ? "✓" : ""}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </nav>
  );
}
