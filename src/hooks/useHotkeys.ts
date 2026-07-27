import { useEffect } from "react";
import { useNavigate } from "react-router";

function isInputFocused() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    (el as HTMLElement).isContentEditable
  );
}

export function useHotkeys() {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isInputFocused()) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // N → new order
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        navigate("/orders/new");
        return;
      }

      // / → focus search input
      if (e.key === "/") {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>(
          'input[placeholder*="Поиск"], input[placeholder*="Qidirish"], input[placeholder*="поиск"], input[placeholder*="Search"]'
        );
        if (searchInput) {
          searchInput.focus();
        } else {
          // Open CommandPalette via Ctrl+K shortcut
          document.dispatchEvent(
            new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })
          );
        }
        return;
      }

      // Escape → close any open modal/dialog
      if (e.key === "Escape") {
        // Click visible overlay backdrops (Radix dialogs, custom modals)
        const backdrops = document.querySelectorAll<HTMLElement>(
          '[data-state="open"][class*="overlay"], [class*="backdrop"], [class*="overlay"]'
        );
        for (const backdrop of backdrops) {
          if (backdrop.offsetParent !== null) {
            backdrop.click();
            return;
          }
        }
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [navigate]);
}
