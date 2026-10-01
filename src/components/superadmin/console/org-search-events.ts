/* Открыть поиск организации — из шапки, с телефона или Ctrl/Cmd+K (OrgSearch.tsx). */

export const OPEN_EVENT = "console:org-search";

/** Открыть поиск программно — из кнопки в шапке или с телефона. */
export function openOrgSearch() {
  document.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

export function isOrgSearchKey(e: Pick<KeyboardEvent, "code" | "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">): boolean {
  return (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.code === "KeyK" || e.key === "k" || e.key === "K");
}
