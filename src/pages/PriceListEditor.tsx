import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Check, Loader2, Search, Store, Tag, Trash2, X } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { PriceTiers } from "@/components/price-lists/PriceTiers";
import { nextCell, focusCell, isRangePaste, parseClipboard } from "@/lib/grid-nav";
import {
  type PriceRow, effective, toCardPct, marginPct, applyPct, belowCost, changes, normalizePrice, ruled,
} from "@/lib/price-sheet";

const GRID = "price";
/** Строк сетки за раз: каталог бывает на тысячи позиций, нужное находят поиском. */
const SHOWN = 300;

const pctText = (p: number | null) => (p == null ? "" : `${p > 0 ? "+" : ""}${p}%`);

/**
 * Прайс-лист — страница, а не блок в настройках.
 *
 * Две вещи, которые с ним делают: «за сколько этот товар» и «каким
 * магазинам». Цены — сеткой по всему каталогу, уже заполненной ценами
 * карточек: правят только то, что для этих магазинов другое, столбцом, с
 * Enter и вставкой из Excel; «найденным −7 %» — одной кнопкой. Магазины —
 * списком с отметками и «все найденные»; магазин в одном списке, и видно,
 * из какого он уйдёт. Раньше товар добавлялся поиском по одному, магазин —
 * выпадающим списком по одному.
 */
export default function PriceListEditor() {
  const { id } = useParams();
  const listId = Number(id);
  const navigate = useNavigate();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { fmt } = useCurrency();
  const { confirm, dialog } = useConfirm();
  const utils = trpc.useUtils();

  const detailQ = trpc.priceList.getById.useQuery({ id: listId }, { enabled: listId > 0 });
  const listsQ = trpc.priceList.list.useQuery();
  const productsQ = trpc.product.list.useQuery({ page: 1, pageSize: 10000, includeAll: true });
  const shopsQ = trpc.shop.list.useQuery({ page: 1, pageSize: 10000 });
  const mapQ = trpc.priceList.shopMap.useQuery();

  const detail = detailQ.data ?? null;
  const markup = detail?.markupPct == null ? null : Number(detail.markupPct);

  /* ── Цены ───────────────────────────────────────────────────────────── */
  const base = useMemo(() => {
    const own = new Map<number, string>();
    const tiers = new Map<number, number>();
    for (const i of detail?.items ?? []) {
      if (Number(i.minQuantity) <= 1) own.set(Number(i.productId), String(Number(i.price)));
      else tiers.set(Number(i.productId), (tiers.get(Number(i.productId)) ?? 0) + 1);
    }
    return { own, tiers };
  }, [detail]);
  const catalogRows = useMemo<PriceRow[]>(() => (productsQ.data?.data ?? []).map(p => ({
    productId: p.id, name: p.name, code: p.code ?? "", category: p.category ?? "",
    costPrice: Number(p.costPrice ?? 0), cardPrice: Number(p.unitPrice ?? 0),
    price: base.own.get(p.id) ?? "", tiers: base.tiers.get(p.id) ?? 0,
  })), [productsQ.data, base]);
  const [edits, setEdits] = useState<Map<number, string>>(new Map());
  const rows = useMemo(() => catalogRows.map(r => (edits.has(r.productId) ? { ...r, price: edits.get(r.productId)! } : r)), [catalogRows, edits]);
  const pending = useMemo(() => changes(base.own, rows), [base.own, rows]);

  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [onlyOwn, setOnlyOwn] = useState(false);
  const categories = useMemo(() => [...new Set(catalogRows.map(r => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [catalogRows]);
  const found = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter(r => (!cat || r.category === cat) && (!onlyOwn || r.price !== "")
      && (!s || r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s)));
  }, [rows, q, cat, onlyOwn]);
  const shown = found.slice(0, SHOWN);

  const setPrice = (productId: number, v: string) => setEdits(m => new Map(m).set(productId, v));
  const [bulkPct, setBulkPct] = useState("");
  const applyBulk = () => {
    const pct = Number(bulkPct);
    if (!bulkPct.trim() || !Number.isFinite(pct)) return notify.error(t("Укажите процент, например −7", "Foizni kiriting, masalan −7"));
    const ids = new Set(found.map(r => r.productId));
    const next = applyPct(found, ids, pct);
    setEdits(m => { const n = new Map(m); for (const r of next) n.set(r.productId, r.price); return n; });
    notify.info(t(`Цена «карточка ${pctText(pct)}» — ${ids.size} товарам`, `${ids.size} ta mahsulotga «karta ${pctText(pct)}»`));
  };
  const clearFound = () => setEdits(m => { const n = new Map(m); for (const r of found) n.set(r.productId, ""); return n; });

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, row: number) => {
    const to = nextCell(e.key, { row, col: "price" }, shown.length, e.shiftKey);
    if (!to) return;
    e.preventDefault();
    focusCell(GRID, to);
  };
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>, row: number) => {
    const text = e.clipboardData.getData("text");
    if (!isRangePaste(text)) return;
    e.preventDefault();
    const lines = parseClipboard(text);
    setEdits(m => {
      const n = new Map(m);
      lines.forEach((line, i) => {
        const r = shown[row + i];
        const v = r ? normalizePrice(line[0] ?? "") : null;
        if (r && v != null) n.set(r.productId, v);
      });
      return n;
    });
  };

  const saveItems = trpc.priceList.setItems.useMutation();
  const onSavePrices = async () => {
    if (pending.length === 0) return;
    try {
      const r = await saveItems.mutateAsync({ priceListId: listId, items: pending });
      await Promise.all([utils.priceList.getById.invalidate({ id: listId }), utils.priceList.list.invalidate(), utils.product.invalidate()]);
      setEdits(new Map());
      notify.success(t(`Цены сохранены: ${r.set}, убрано: ${r.cleared}`, `Narxlar saqlandi: ${r.set}, olib tashlandi: ${r.cleared}`));
    } catch (e) { notify.error(e instanceof Error ? e.message : String(e)); }
  };

  /* ── Магазины ───────────────────────────────────────────────────────── */
  const listName = useMemo(() => new Map((listsQ.data ?? []).map(l => [l.id, l.name])), [listsQ.data]);
  const currentOf = useMemo(() => new Map((mapQ.data ?? []).map(m => [Number(m.shopId), Number(m.priceListId)])), [mapQ.data]);
  const assigned = useMemo(() => new Set((detail?.assignments ?? []).map(a => Number(a.shopId))), [detail]);
  const [shopSel, setShopSel] = useState<Set<number> | null>(null);
  const selected = shopSel ?? assigned;
  const shopsDirty = shopSel != null && (shopSel.size !== assigned.size || [...shopSel].some(s => !assigned.has(s)));
  const [sq, setSq] = useState("");
  type ShopLike = { id: number; name: string; address?: string | null; city?: string | null };
  const shopRows = useMemo(() => ((shopsQ.data?.data ?? []) as ShopLike[]), [shopsQ.data]);
  const shopsFound = useMemo(() => {
    const s = sq.trim().toLowerCase();
    return shopRows.filter(sh => !s || sh.name.toLowerCase().includes(s) || (sh.address ?? "").toLowerCase().includes(s) || (sh.city ?? "").toLowerCase().includes(s));
  }, [shopRows, sq]);
  const toggleShop = (sid: number) => setShopSel(prev => { const n = new Set(prev ?? assigned); if (n.has(sid)) n.delete(sid); else n.add(sid); return n; });
  const allShopsOn = shopsFound.length > 0 && shopsFound.every(sh => selected.has(sh.id));
  const toggleAllShops = () => setShopSel(prev => { const n = new Set(prev ?? assigned); for (const sh of shopsFound) { if (allShopsOn) n.delete(sh.id); else n.add(sh.id); } return n; });
  const moving = [...selected].filter(sid => !assigned.has(sid) && currentOf.has(sid) && currentOf.get(sid) !== listId).length;

  const saveShops = trpc.priceList.setShops.useMutation();
  const onSaveShops = async () => {
    try {
      const r = await saveShops.mutateAsync({ priceListId: listId, shopIds: [...selected] });
      await Promise.all([utils.priceList.getById.invalidate({ id: listId }), utils.priceList.list.invalidate(), utils.priceList.shopMap.invalidate(), utils.priceList.forShop.invalidate()]);
      setShopSel(null);
      notify.success(t(`Магазины сохранены: +${r.added}, −${r.removed}${r.moved ? `, перешли из других списков: ${r.moved}` : ""}`, `Do'konlar saqlandi: +${r.added}, −${r.removed}`));
    } catch (e) { notify.error(e instanceof Error ? e.message : String(e)); }
  };

  /* ── Список: правило, приоритет, включён ────────────────────────────── */
  const update = trpc.priceList.update.useMutation();
  const remove = trpc.priceList.delete.useMutation();
  const [ruleDraft, setRuleDraft] = useState<string | null>(null);
  const ruleValue = ruleDraft ?? (markup == null ? "" : String(markup));
  const saveRule = async () => {
    const v = ruleValue.trim() === "" ? null : Number(ruleValue);
    if (v != null && (!Number.isFinite(v) || v < -99 || v > 1000)) return notify.error(t("Правило — от −99 до 1000 %", "Qoida — −99 dan 1000 % gacha"));
    try {
      await update.mutateAsync({ id: listId, markupPct: v });
      await Promise.all([utils.priceList.getById.invalidate({ id: listId }), utils.priceList.list.invalidate()]);
      setRuleDraft(null);
      notify.success(t("Правило сохранено", "Qoida saqlandi"));
    } catch (e) { notify.error(e instanceof Error ? e.message : String(e)); }
  };
  const toggleActive = async () => {
    if (!detail) return;
    try { await update.mutateAsync({ id: listId, isActive: !detail.isActive }); await Promise.all([utils.priceList.getById.invalidate({ id: listId }), utils.priceList.list.invalidate()]); }
    catch (e) { notify.error(e instanceof Error ? e.message : String(e)); }
  };
  const onDelete = async () => {
    if (!detail) return;
    const ok = await confirm({
      title: t("Удалить прайс-лист?", "Narx ro'yxati o'chirilsinmi?"),
      message: t(`«${detail.name}»: магазины, которым он назначен, вернутся к обычной цене товара.`, `«${detail.name}»: unga bog'langan do'konlar oddiy narxga qaytadi.`),
      confirmText: t("Удалить", "O'chirish"), danger: true,
    });
    if (!ok) return;
    try { await remove.mutateAsync({ id: listId }); await utils.priceList.list.invalidate(); navigate("/settings?section=prices"); }
    catch (e) { notify.error(e instanceof Error ? e.message : String(e)); }
  };

  const [tab, setTab] = useState<"prices" | "shops">("prices");

  if (detailQ.isError) return <QueryErrorFallback onRetry={() => detailQ.refetch()} />;
  if (detailQ.isLoading || productsQ.isLoading) return <div style={{ display: "flex", justifyContent: "center", padding: 64 }}><Loader2 className="animate-spin" style={{ color: "var(--color-primary-text)" }} /></div>;
  if (!detail) return <p style={{ padding: 32, color: "var(--color-text-secondary)" }}>{t("Прайс-лист не найден", "Narx ro'yxati topilmadi")}</p>;

  const ownCount = rows.filter(r => r.price !== "").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1280 }}>
      {dialog}
      {/* ── Заголовок ─────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button className="neo-btn" onClick={() => navigate("/settings?section=prices")} style={{ display: "flex", alignItems: "center", gap: 6 }} data-testid="price-list-back">
          <ArrowLeft size={15} />{t("Прайс-листы", "Narx ro'yxatlari")}
        </button>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>{detail.name}</h1>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
            {t("приоритет", "ustuvorlik")} {detail.priority}
            {" · "}{ownCount} {t("своих цен", "o'z narxi")}
            {" · "}{assigned.size} {t("магазинов", "do'kon")}
            {!detail.isActive && <b style={{ color: "var(--color-warning-text)" }}>{" · "}{t("выключен", "o'chirilgan")}</b>}
          </div>
        </div>
        <span style={{ flex: 1 }} />
        <button className="neo-btn" onClick={toggleActive} disabled={update.isPending}>{detail.isActive ? t("Выключить", "O'chirish") : t("Включить", "Yoqish")}</button>
        <button className="neo-btn text-danger" onClick={onDelete} aria-label={t("Удалить", "O'chirish")}><Trash2 size={14} /></button>
      </div>

      {/* ── Правило: «−7 % к карточке» — без строк вовсе ──────────────── */}
      <div className="neo-card neo-card-static" style={{ borderRadius: 20, padding: 16, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, width: 200 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--color-text-tertiary)" }}>{t("Ко всей карточке, %", "Butun kartaga, %")}</span>
          <input className="neo-input" inputMode="decimal" value={ruleValue} placeholder={t("нет правила", "qoida yo'q")} data-testid="price-list-rule"
            onChange={e => setRuleDraft(e.target.value.replace(/[^0-9.,-]/g, "").replace(",", "."))} />
        </label>
        <p style={{ flex: "1 1 280px", margin: 0, fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
          {t("Правило даёт цену всем товарам без своей цены: −7 — на 7 % дешевле карточки, 5 — наценка. Своя цена в сетке — исключение поверх правила.",
             "Qoida o'z narxi yo'q barcha mahsulotlarga narx beradi: −7 — kartadan 7 % arzon, 5 — ustama. Jadvaldagi o'z narxi — qoidadan ustun.")}
        </p>
        {ruleDraft != null && <button className="neo-btn-primary" onClick={saveRule} disabled={update.isPending} data-testid="price-list-rule-save">{t("Сохранить правило", "Qoidani saqlash")}</button>}
      </div>

      {/* ── Вкладки ───────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--color-border)" }}>
        {([["prices", Tag, t(`Цены товаров · ${ownCount}`, `Mahsulot narxlari · ${ownCount}`)], ["shops", Store, t(`Магазины · ${selected.size}`, `Do'konlar · ${selected.size}`)]] as const).map(([k, Icon, label]) => (
          <button key={k} onClick={() => setTab(k)} data-testid={`price-list-tab-${k}`}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "12px 16px", border: "none", background: "none", cursor: "pointer", fontSize: 14, fontWeight: tab === k ? 700 : 500, color: tab === k ? "var(--color-primary-text)" : "var(--color-text-secondary)", borderBottom: `2px solid ${tab === k ? "var(--color-primary)" : "transparent"}`, marginBottom: -1 }}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

      {tab === "prices" && (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: "1 1 240px", maxWidth: 360 }}>
              <Search size={15} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary)" }} />
              <input className="neo-input" style={{ paddingLeft: 38 }} placeholder={t("Название или код", "Nomi yoki kodi")} value={q} onChange={e => setQ(e.target.value)} data-testid="price-grid-search" />
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--color-text-secondary)", cursor: "pointer" }}>
              <input type="checkbox" checked={onlyOwn} onChange={e => setOnlyOwn(e.target.checked)} data-testid="price-grid-only-own" />{t("только со своей ценой", "faqat o'z narxi bilan")}
            </label>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{t("Найденным:", "Topilganlarga:")}</span>
            <DecimalInput className="neo-input" style={{ width: 90, textAlign: "right", padding: "8px 12px" }} placeholder="−7" value={bulkPct}
              onValueChange={setBulkPct} data-testid="price-grid-bulk-pct" />
            <button className="neo-btn" onClick={applyBulk} data-testid="price-grid-bulk-apply">{t("% к карточке", "% kartaga")}</button>
            <button className="neo-btn" onClick={clearFound} data-testid="price-grid-clear">{t("Убрать свои цены", "O'z narxlarini olib tashlash")}</button>
          </div>

          {categories.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["", ...categories].map(c => (
                <button key={c || "all"} onClick={() => setCat(c)} style={{
                  padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  border: `1px solid ${cat === c ? "var(--color-primary)" : "var(--color-border)"}`,
                  background: cat === c ? "var(--color-primary-subtle)" : "transparent",
                  color: cat === c ? "var(--color-primary-text)" : "var(--color-text-secondary)",
                }}>{c || t("Все", "Barchasi")}</button>
              ))}
            </div>
          )}

          <div className="neo-card" style={{ borderRadius: 20, padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto", maxHeight: "min(68vh, 900px)", overflowY: "auto" }}>
              <table className="sheet-table" style={{ minWidth: 860 }} data-testid="price-grid">
                <thead>
                  <tr>
                    <th className="sticky-col" style={{ minWidth: 260 }}>{t("Товар", "Mahsulot")}</th>
                    <th className="num">{t("Себест.", "Tannarx")}</th>
                    <th className="num">{t("Карточка", "Karta")}</th>
                    <th className="num" style={{ minWidth: 140 }}>{t("Цена в списке", "Ro'yxatdagi narx")}</th>
                    <th className="num">{t("К карточке", "Kartaga")}</th>
                    <th className="num">{t("Маржа", "Marja")}</th>
                    <th aria-label={t("Убрать", "Olib tashlash")} />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r, i) => {
                    const eff = effective(r, markup);
                    const k = toCardPct(eff.price, r.cardPrice);
                    const m = marginPct(eff.price, r.costPrice);
                    const loss = belowCost(r, markup);
                    const rule = ruled(r.cardPrice, markup);
                    return (
                      <tr key={r.productId} data-testid={`price-row-${r.productId}`}>
                        <td className="sticky-col" style={{ padding: "6px 10px" }}>
                          <div style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>{r.name}</div>
                          <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                            {[r.code, r.category].filter(Boolean).join(" · ")}
                            {r.tiers > 0 && <b style={{ color: "var(--color-primary-text)" }}>{" · "}{t(`ступеней: ${r.tiers}`, `pog'onalar: ${r.tiers}`)}</b>}
                          </div>
                        </td>
                        <td className="num" style={{ padding: "0 8px", color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>{r.costPrice > 0 ? fmt(r.costPrice) : "—"}</td>
                        <td className="num" style={{ padding: "0 8px", color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>{fmt(r.cardPrice)}</td>
                        <td className="num">
                          <DecimalInput
                            data-grid={GRID} data-row={i} data-col="price"
                            className="sheet-input num" aria-invalid={loss ? true : undefined}
                            title={loss ? t("Ниже себестоимости", "Tannarxdan past") : undefined}
                            placeholder={rule != null ? String(rule) : String(r.cardPrice)}
                            value={r.price}
                            onValueChange={v => setPrice(r.productId, v)}
                            onKeyDown={e => onKey(e, i)}
                            onPaste={e => onPaste(e, i)}
                            onFocus={e => e.currentTarget.select()}
                            data-testid={`price-cell-${r.productId}`}
                          />
                        </td>
                        <td className="num" style={{ padding: "0 8px", fontVariantNumeric: "tabular-nums", color: k != null && k < 0 ? "var(--color-success-text)" : "var(--color-text-secondary)" }}>
                          {pctText(k)}{eff.source === "rule" && <span style={{ fontSize: 10, color: "var(--color-text-tertiary)" }}> {t("правило", "qoida")}</span>}
                        </td>
                        <td className="num" style={{ padding: "0 8px", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: loss ? "var(--color-danger-text)" : "var(--color-text-primary)" }} data-testid={`price-margin-${r.productId}`}>
                          {pctText(m)}
                        </td>
                        <td style={{ width: 36, textAlign: "center" }}>
                          {r.price !== "" && (
                            <button onClick={() => setPrice(r.productId, "")} aria-label={t("Убрать свою цену", "O'z narxini olib tashlash")}
                              style={{ border: "none", background: "transparent", color: "var(--color-text-tertiary)", cursor: "pointer", padding: 6 }}>
                              <X size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--color-text-tertiary)", borderTop: "1px solid var(--color-border)" }}>
              {t(`Найдено: ${found.length}`, `Topildi: ${found.length}`)}
              {found.length > SHOWN ? t(` · показаны первые ${SHOWN}, уточните поиск`, ` · birinchi ${SHOWN} tasi`) : ""}
              {" · "}{t("пустая клетка — цена по правилу или карточке (серым); Enter — вниз; столбец из Excel вставляется целиком",
                        "bo'sh katak — qoida yoki karta narxi; Enter — pastga; Excel ustuni to'liq qo'yiladi")}
            </div>
          </div>

          <PriceTiers
            listId={listId}
            tiers={(detail.items ?? []).filter(i => Number(i.minQuantity) > 1).map(i => ({ ...i, productId: Number(i.productId), price: String(i.price), minQuantity: String(i.minQuantity), unitPrice: i.unitPrice == null ? null : String(i.unitPrice) }))}
            products={productsQ.data?.data ?? []}
          />

          {pending.length > 0 && (
            <div className="neo-card neo-card-static" style={{ borderRadius: 20, padding: 14, display: "flex", alignItems: "center", gap: 10, position: "sticky", bottom: 12, zIndex: 5 }} data-testid="price-grid-pending">
              <span style={{ fontSize: 13, color: "var(--color-text-secondary)", flex: 1 }}>
                {t(`Изменено цен: ${pending.length}`, `O'zgargan narxlar: ${pending.length}`)}
              </span>
              <button className="neo-btn" onClick={() => setEdits(new Map())}>{t("Отменить", "Bekor qilish")}</button>
              <button className="neo-btn-primary" onClick={onSavePrices} disabled={saveItems.isPending} data-testid="price-grid-save">
                {saveItems.isPending ? <Loader2 size={14} className="animate-spin" /> : t("Сохранить цены", "Narxlarni saqlash")}
              </button>
            </div>
          )}
        </>
      )}

      {tab === "shops" && (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: "1 1 240px", maxWidth: 360 }}>
              <Search size={15} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary)" }} />
              <input className="neo-input" style={{ paddingLeft: 38 }} placeholder={t("Магазин, адрес, город", "Do'kon, manzil, shahar")} value={sq} onChange={e => setSq(e.target.value)} data-testid="price-shops-search" />
            </div>
            {shopsFound.length > 0 && (
              <button className="neo-btn" onClick={toggleAllShops} data-testid="price-shops-all">
                {allShopsOn ? t("Снять найденные", "Topilganlarni olib tashlash") : t(`Отметить найденные (${shopsFound.length})`, `Topilganlarni belgilash (${shopsFound.length})`)}
              </button>
            )}
            <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", flex: "1 1 260px" }}>
              {t("Магазин — в одном списке: отмеченный здесь уйдёт из прежнего.", "Do'kon bitta ro'yxatda: bu yerda belgilangani avvalgisidan chiqadi.")}
            </span>
          </div>
          <div className="neo-card" style={{ borderRadius: 20, padding: 6, maxHeight: "min(64vh, 860px)", overflowY: "auto" }} data-testid="price-shops">
            {shopsFound.map(sh => {
              const on = selected.has(sh.id);
              const cur = currentOf.get(sh.id);
              const elsewhere = cur != null && cur !== listId ? listName.get(cur) : null;
              return (
                <button key={sh.id} onClick={() => toggleShop(sh.id)} data-testid={`price-shop-${sh.id}`}
                  style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "10px 12px", borderRadius: 12, border: "none", cursor: "pointer", textAlign: "left", background: on ? "var(--color-primary-subtle)" : "transparent" }}>
                  <span style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: `1.5px solid ${on ? "var(--color-primary)" : "var(--color-border-strong)"}`, background: on ? "var(--color-primary)" : "transparent", color: "var(--color-on-primary)" }}>
                    {on && <Check size={13} strokeWidth={3} />}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>{sh.name}</span>
                    <span style={{ display: "block", fontSize: 11, color: "var(--color-text-tertiary)" }}>{[sh.city, sh.address].filter(Boolean).join(", ")}</span>
                  </span>
                  {elsewhere && (
                    <span style={{ fontSize: 11, fontWeight: 600, color: on ? "var(--color-warning-text)" : "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>
                      {on ? t(`уйдёт из «${elsewhere}»`, `«${elsewhere}» dan chiqadi`) : t(`сейчас: ${elsewhere}`, `hozir: ${elsewhere}`)}
                    </span>
                  )}
                </button>
              );
            })}
            {shopsFound.length === 0 && <p style={{ textAlign: "center", padding: 24, fontSize: 13, color: "var(--color-text-tertiary)" }}>{t("Ничего не нашлось", "Hech narsa topilmadi")}</p>}
          </div>
          {shopsDirty && (
            <div className="neo-card neo-card-static" style={{ borderRadius: 20, padding: 14, display: "flex", alignItems: "center", gap: 10, position: "sticky", bottom: 12, zIndex: 5 }} data-testid="price-shops-pending">
              <span style={{ fontSize: 13, color: "var(--color-text-secondary)", flex: 1 }}>
                {t(`Отмечено магазинов: ${selected.size}`, `Belgilangan do'konlar: ${selected.size}`)}
                {moving > 0 && <b style={{ color: "var(--color-warning-text)" }}>{t(` · перейдут из других списков: ${moving}`, ` · boshqa ro'yxatlardan o'tadi: ${moving}`)}</b>}
              </span>
              <button className="neo-btn" onClick={() => setShopSel(null)}>{t("Отменить", "Bekor qilish")}</button>
              <button className="neo-btn-primary" onClick={onSaveShops} disabled={saveShops.isPending} data-testid="price-shops-save">
                {saveShops.isPending ? <Loader2 size={14} className="animate-spin" /> : t("Сохранить магазины", "Do'konlarni saqlash")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
