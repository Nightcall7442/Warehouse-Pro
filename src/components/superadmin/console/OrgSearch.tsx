import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Search, Building2, CornerDownLeft, X } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useOverlay } from "@/lib/overlay";
import { formatUzPhone } from "@contracts/signup";
import { matches, statusOf, type OrgRow } from "./orgs";
import { PlanPill, Pill } from "./ui";
import { OPEN_EVENT, isOrgSearchKey, openOrgSearch } from "./org-search-events";

/* ═══════════════════════════════════════════════════════════════════════════
   Поиск организации из любого места консоли: строка в шапке и Ctrl/Cmd+K.

   Звонит владелец организации — у владельца платформы в руках название,
   телефон или ИНН с платёжки. Раньше путь был «Super Admin → пролистать до
   списка → набрать в поле → щёлкнуть строку»; теперь — Ctrl+K, три буквы,
   Enter, и открыта карточка.

   Клавиша — по месту (e.code), как у всей клавиатуры приложения
   (hooks/useHotkeys.ts): в русской раскладке Ctrl+K даёт «л». Палитра команд
   склада (components/CommandPalette.tsx) суперадмину не ставится — её
   разделы (товары, заказы, магазины) ему закрыты, и одно сочетание не должно
   открывать два окна.
   ═══════════════════════════════════════════════════════════════════════════ */


/** Строка поиска в шапке компьютера: выглядит полем, открывает окно поиска. */
export function OrgSearchBar() {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <button type="button" onClick={openOrgSearch} data-testid="console-search-bar"
      className="flex items-center gap-3 w-full text-left"
      style={{ minHeight: 44, maxWidth: 520, padding: "0 14px", borderRadius: 14, background: "var(--color-field, var(--color-surface))", boxShadow: "var(--shadow-pressed)", color: "var(--color-text-tertiary)" }}>
      <Search size={17} className="flex-shrink-0" />
      <span className="flex-1 truncate" style={{ fontSize: 13.5 }}>Найти организацию — название, slug, ИНН, телефон</span>
      <kbd style={{ fontSize: 11, fontWeight: 700, padding: "3px 7px", borderRadius: 7, background: "var(--color-surface)", boxShadow: "var(--shadow-xs)", color: "var(--color-text-secondary)", fontFamily: "inherit" }}>
        {mac ? "⌘K" : "Ctrl K"}
      </kbd>
    </button>
  );
}

export function OrgSearchPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const close = () => setOpen(false);
  useOverlay({ open, onClose: close });

  // Данные — тот же список, что в «Организациях»: обычно он уже в кеше.
  const { data, isLoading } = trpc.tenant.list.useQuery(undefined, { enabled: open, staleTime: 60_000 });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isOrgSearchKey(e)) return;
      e.preventDefault();
      setOpen(v => !v);
    };
    const onOpen = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    document.addEventListener(OPEN_EVENT, onOpen);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener(OPEN_EVENT, onOpen); };
  }, []);

  // Открылось — чистое поле и каретка в нём. Сброс при открытии, а не при
  // закрытии: закрытие бывает и «назад» в браузере (useOverlay).
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setQuery(""); setCursor(0); }
  }
  useEffect(() => { if (open) requestAnimationFrame(() => input.current?.focus()); }, [open]);

  const results = useMemo(() => {
    const rows = data ?? [];
    if (!query.trim()) {
      return [...rows].sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()).slice(0, 6);
    }
    return rows.filter(o => matches(o, query)).slice(0, 8);
  }, [data, query]);

  const pick = (o: OrgRow | undefined) => {
    if (!o) return;
    setOpen(false);
    navigate(`/super-admin/orgs/${o.id}`);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center" role="dialog" aria-modal="true" aria-label="Поиск организации"
      style={{ padding: "max(10vh, calc(env(safe-area-inset-top, 0px) + 16px)) 16px 16px", background: "rgba(10,12,14,0.55)", backdropFilter: "blur(6px)" }}
      onClick={close} data-testid="org-search">
      <div className="w-full neo-card neo-card-static" style={{ maxWidth: 600, padding: 0, borderRadius: 22, overflow: "hidden", boxShadow: "var(--shadow-popover, var(--shadow-lg))" }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3" style={{ padding: "14px 16px" }}>
          <Search size={19} color="var(--color-text-tertiary)" className="flex-shrink-0" />
          <input ref={input} value={query} data-testid="org-search-input"
            onChange={e => { setQuery(e.target.value); setCursor(0); }}
            onKeyDown={e => {
              if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, Math.max(0, results.length - 1))); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); pick(results[cursor]); }
            }}
            placeholder="Название, slug, ИНН, телефон или почта"
            autoComplete="off" spellCheck={false}
            style={{ flex: 1, minWidth: 0, minHeight: 44, border: "none", outline: "none", background: "transparent", fontSize: 16, color: "var(--color-text-primary)" }} />
          <button type="button" onClick={close} aria-label="Закрыть поиск" className="neo-btn flex-shrink-0" style={{ minHeight: 44, minWidth: 44, padding: "0 12px", fontSize: 12 }}>
            <span className="hidden md:inline">Esc</span><X size={18} className="md:hidden" />
          </button>
        </div>
        <div style={{ height: 1, background: "var(--color-border-subtle)" }} />
        <div className="premium-scrollbar" style={{ maxHeight: "min(60vh, 460px)", overflowY: "auto", padding: 8 }}>
          {!query.trim() && results.length > 0 && (
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--color-text-tertiary)", margin: "6px 10px 6px" }}>Недавно активные</p>
          )}
          {isLoading ? (
            <p style={{ padding: 20, fontSize: 13, color: "var(--color-text-tertiary)", margin: 0 }}>Загрузка…</p>
          ) : results.length === 0 ? (
            <p style={{ padding: 20, fontSize: 13, color: "var(--color-text-tertiary)", margin: 0 }} data-testid="org-search-empty">Ничего не найдено — проверьте название, ИНН или номер.</p>
          ) : results.map((o, i) => {
            const st = statusOf(o);
            const meta = [o.slug, o.inn ? `ИНН ${o.inn}` : null, o.contactPhone ? formatUzPhone(o.contactPhone) : null].filter(Boolean).join(" · ");
            return (
              <button key={o.id} type="button" data-testid="org-search-result"
                onMouseEnter={() => setCursor(i)} onClick={() => pick(o)}
                className="flex items-center gap-3 w-full text-left"
                style={{ minHeight: 56, padding: "8px 10px", borderRadius: 14, background: i === cursor ? "var(--color-primary-subtle)" : "transparent" }}>
                <span className="flex items-center justify-center flex-shrink-0" style={{ width: 38, height: 38, borderRadius: 12, background: "var(--color-surface-light)", fontWeight: 800, fontSize: 15, color: "var(--color-primary-text)" }}>
                  {o.name.trim()[0]?.toUpperCase() ?? <Building2 size={16} />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate" style={{ fontSize: 14.5, fontWeight: 700, color: "var(--color-text-primary)" }}>{o.name}</span>
                  <span className="block truncate" style={{ fontSize: 12.5, color: "var(--color-text-secondary)" }}>{meta}</span>
                </span>
                <span className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
                  <PlanPill plan={o.subscription?.plan ?? o.plan} />
                  {st.tone !== "success" && st.tone !== "info" && <Pill tone={st.tone}>{st.label}</Pill>}
                </span>
                {i === cursor && <CornerDownLeft size={15} color="var(--color-text-tertiary)" className="hidden sm:block flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
