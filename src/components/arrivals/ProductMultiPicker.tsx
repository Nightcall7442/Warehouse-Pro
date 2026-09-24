import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { AppModal } from "@/components/ui/AppModal";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { formatQty } from "@/lib/format";
import type { ProductLike } from "@/lib/arrival-sheet";

export type PickerProduct = ProductLike & { category?: string | null; available?: string | number | null; barcode?: string | null };

/** Сколько строк рисуем за раз: каталог бывает на тысячи позиций, выбирают поиском. */
const SHOWN = 200;

/**
 * Выбор товаров пачкой.
 *
 * Отмечаются сразу все позиции накладной — поиском, категорией, «все
 * найденные», — и одной кнопкой встают в приход строками. Уже стоящие в
 * приходе видны отмеченными и второй раз не добавляются.
 */
export function ProductMultiPicker({ open, onClose, products, already, onPick }: {
  open: boolean;
  onClose: () => void;
  products: PickerProduct[];
  already: Set<number>;
  onPick: (picked: PickerProduct[]) => void;
}) {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("");
  const [sel, setSel] = useState<Set<number>>(new Set());

  const categories = useMemo(() => [...new Set(products.map(p => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)), [products]);
  const found = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter(p =>
      (!cat || p.category === cat) &&
      (!s || p.name.toLowerCase().includes(s) || (p.code ?? "").toLowerCase().includes(s) || (p.barcode ?? "").toLowerCase() === s));
  }, [products, q, cat]);
  const shown = found.slice(0, SHOWN);
  const selectable = found.filter(p => !already.has(p.id));

  const toggle = (id: number) => setSel(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const allFound = selectable.length > 0 && selectable.every(p => sel.has(p.id));
  const toggleAll = () => setSel(prev => {
    const n = new Set(prev);
    for (const p of selectable) { if (allFound) n.delete(p.id); else n.add(p.id); }
    return n;
  });
  const submit = () => {
    const picked = products.filter(p => sel.has(p.id));
    if (picked.length === 0) return;
    onPick(picked);
    setSel(new Set()); setQ(""); setCat("");
  };

  return (
    <AppModal
      open={open}
      onClose={onClose}
      dirty={sel.size > 0}
      title={t("Товары в приход", "Kelishga mahsulotlar")}
      subtitle={t("Отметьте все позиции накладной сразу", "Hujjatdagi barcha pozitsiyalarni birdaniga belgilang")}
      maxWidth={760}
      footer={
        <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
          <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }} data-testid="picker-count">
            {t("Выбрано", "Tanlandi")}: <b style={{ color: "var(--color-text-primary)" }}>{sel.size}</b>
          </span>
          <span style={{ flex: 1 }} />
          <button className="neo-btn" onClick={onClose}>{t("Отмена", "Bekor qilish")}</button>
          <button className="neo-btn-primary" disabled={sel.size === 0} onClick={submit} data-testid="picker-add">
            {t(`Добавить ${sel.size}`, `${sel.size} ta qo'shish`)}
          </button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ position: "relative" }}>
          <Search size={15} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary)" }} />
          <input
            autoFocus className="neo-input" style={{ paddingLeft: 38 }}
            placeholder={t("Название, код или штрих-код", "Nomi, kodi yoki shtrix-kodi")}
            value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              // Enter при единственной находке — отметить её: так набирают по накладной, не трогая мышь.
              if (e.key === "Enter" && selectable.length === 1) { e.preventDefault(); toggle(selectable[0].id); setQ(""); }
            }}
            data-testid="picker-search"
          />
        </div>

        {categories.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["", ...categories].map(c => (
              <button key={c || "all"} onClick={() => setCat(c)} className="tap"
                style={{
                  padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  border: `1px solid ${cat === c ? "var(--color-primary)" : "var(--color-border)"}`,
                  background: cat === c ? "var(--color-primary-subtle)" : "transparent",
                  color: cat === c ? "var(--color-primary-text)" : "var(--color-text-secondary)",
                }}>
                {c || t("Все", "Barchasi")}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, color: "var(--color-text-tertiary)" }}>
          <span>{t(`Найдено: ${found.length}`, `Topildi: ${found.length}`)}{found.length > SHOWN ? t(` · показаны первые ${SHOWN}, уточните поиск`, ` · birinchi ${SHOWN} tasi, qidiruvni aniqlang`) : ""}</span>
          {selectable.length > 0 && (
            <button onClick={toggleAll} style={{ border: "none", background: "none", color: "var(--color-primary-text)", fontWeight: 600, cursor: "pointer", fontSize: 12 }} data-testid="picker-all">
              {allFound ? t("Снять отметки", "Belgilarni olib tashlash") : t(`Отметить все найденные (${selectable.length})`, `Topilganlarni belgilash (${selectable.length})`)}
            </button>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: "52vh", overflowY: "auto" }}>
          {shown.map(p => {
            const inSheet = already.has(p.id);
            const on = inSheet || sel.has(p.id);
            return (
              <button key={p.id} disabled={inSheet} onClick={() => toggle(p.id)} data-testid={`picker-item-${p.id}`}
                style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 12, textAlign: "left",
                  border: "none", cursor: inSheet ? "default" : "pointer",
                  background: on ? "var(--color-primary-subtle)" : "transparent", opacity: inSheet ? 0.6 : 1,
                }}>
                <span style={{
                  width: 20, height: 20, borderRadius: 6, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                  border: `1.5px solid ${on ? "var(--color-primary)" : "var(--color-border-strong)"}`,
                  background: on ? "var(--color-primary)" : "transparent", color: "var(--color-on-primary)",
                }}>{on && <Check size={13} strokeWidth={3} />}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>{p.name}</span>
                  <span style={{ display: "block", fontSize: 11, color: "var(--color-text-tertiary)" }}>
                    {[p.code, p.category].filter(Boolean).join(" · ")}
                    {inSheet ? ` · ${t("уже в приходе", "kelishda bor")}` : ""}
                  </span>
                </span>
                <span style={{ textAlign: "right", fontSize: 12, color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  <span style={{ display: "block" }}>{t("остаток", "qoldiq")} {formatQty(Number(p.available ?? 0))}</span>
                  {Number(p.costPrice ?? 0) > 0 && <span style={{ display: "block", color: "var(--color-text-tertiary)" }}>{fmt(Number(p.costPrice))}</span>}
                </span>
              </button>
            );
          })}
          {found.length === 0 && (
            <p style={{ textAlign: "center", padding: "24px 0", fontSize: 13, color: "var(--color-text-tertiary)" }}>{t("Ничего не нашлось", "Hech narsa topilmadi")}</p>
          )}
        </div>
      </div>
    </AppModal>
  );
}
