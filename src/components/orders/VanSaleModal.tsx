import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/hooks/useCurrency";
import { useInvalidateOrderCaches } from "@/hooks/useOrderCacheSync";
import { AppModal, modalSectionLabel } from "@/components/ui/AppModal";
import { PremiumSelect } from "@/components/PremiumSelect";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { notify } from "@/lib/toast";
import { formatQty } from "@/lib/format";
import { COLORS, F } from "@/components/users/types";
import { Truck, Search, Plus, Minus, Check, X } from "lucide-react";

/*
  Продажа с машины.

  Не мастер заказа в три шага, а одно окно: в кузове товаров мало, они все
  перед глазами. Выбрал магазин, набрал количество, назвал, чем заплатили —
  заказ родился доставленным, товар ушёл с машины, деньги легли туда же,
  куда у любой доставки: наличные — на руки водителю, перевод — «в пути».
*/
type Method = "cash" | "card" | "transfer" | "debt";

export function VanSaleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { user } = useAuth();
  const { fmt } = useCurrency();
  const invalidate = useInvalidateOrderCaches();
  const utils = trpc.useUtils();
  const isField = user?.role === "agent" || user?.role === "merchandiser" || user?.role === "courier";

  const vans = trpc.van.list.useQuery(undefined, { enabled: open });
  const [vanId, setVanId] = useState<string>("");
  const effectiveVan = vanId || (vans.data?.length === 1 ? String(vans.data[0].id) : "");
  const stock = trpc.van.stock.useQuery({ vanId: Number(effectiveVan) }, { enabled: open && !!effectiveVan });
  const myShops = trpc.agent.myShops.useQuery(undefined, { enabled: open && isField });
  const allShops = trpc.shop.list.useQuery({ pageSize: 500 }, { enabled: open && !isField });
  const shops = useMemo(() => (isField ? myShops.data ?? [] : allShops.data?.data ?? []), [isField, myShops.data, allShops.data]);

  const [shopSearch, setShopSearch] = useState("");
  const [shopId, setShopId] = useState<number | null>(null);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [method, setMethod] = useState<Method>("cash");
  const [paid, setPaid] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [key] = useState(() => crypto.randomUUID());

  const reset = () => { setShopId(null); setQty({}); setMethod("cash"); setPaid(null); setNotes(""); setShopSearch(""); };
  const sale = trpc.van.sale.useMutation({
    onSuccess: r => {
      notify.success(r.idempotent ? t(`Заказ ${r.orderNumber} уже проведён`, `${r.orderNumber} buyurtma allaqachon o'tkazilgan`) : t(`Продано с машины: ${r.orderNumber} на ${fmt(r.total)}`, `Mashinadan sotildi: ${r.orderNumber}, ${fmt(r.total)}`));
      invalidate(); utils.van.stock.invalidate(); utils.van.list.invalidate(); utils.cash.mine.invalidate(); utils.cash.overview.invalidate();
      reset(); onClose();
    },
    onError: e => notify.error(e.message),
  });

  const filteredShops = useMemo(() => {
    const q = shopSearch.trim().toLowerCase();
    return (q ? shops.filter(s => s.name?.toLowerCase().includes(q) || s.ownerName?.toLowerCase().includes(q)) : shops).slice(0, 8);
  }, [shops, shopSearch]);
  const shop = shops.find(s => s.id === shopId);
  const lines = (stock.data ?? []).filter(r => (qty[r.productId] ?? 0) > 0);
  const total = lines.reduce((s, r) => s + r.unitPrice * (qty[r.productId] ?? 0), 0);
  const paidValue = paid == null ? (method === "debt" ? 0 : total) : Number(paid) || 0;
  const set = (productId: number, n: number, max: number) => setQty(q => ({ ...q, [productId]: Math.max(0, Math.min(max, n)) }));

  const submit = () => {
    if (!effectiveVan) return notify.error(t("Выберите машину", "Mashinani tanlang"));
    if (!shopId) return notify.error(t("Выберите магазин", "Do'konni tanlang"));
    if (!lines.length) return notify.error(t("Наберите товар", "Tovar tanlang"));
    sale.mutate({
      vanId: Number(effectiveVan), shopId, items: lines.map(r => ({ productId: r.productId, quantity: String(qty[r.productId]) })),
      paymentMethod: method, paidAmount: paidValue, notes: notes || undefined, idempotencyKey: key,
    });
  };

  const METHODS: Array<[Method, string]> = [["cash", t("Наличные", "Naqd")], ["card", t("Карта", "Karta")], ["transfer", t("Перевод", "O'tkazma")], ["debt", t("В долг", "Qarzga")]];
  return (
    <AppModal open={open} onClose={() => { reset(); onClose(); }} title={t("Продажа с машины", "Mashinadan sotuv")} maxWidth={820} dirty={lines.length > 0}>
      <div className="space-y-4">
        {(vans.data?.length ?? 0) > 1 && (
          <div>
            <span className={modalSectionLabel} style={{ color: COLORS.textTertiary }}>{t("Машина", "Mashina")}</span>
            <PremiumSelect value={effectiveVan} onChange={v => { setVanId(v); setQty({}); }} options={[{ value: "", label: t("— выберите —", "— tanlang —") }, ...(vans.data ?? []).map(v => ({ value: String(v.id), label: `${v.name}${v.plate ? ` · ${v.plate}` : ""}${v.driverName ? ` · ${v.driverName}` : ""}` }))]} width="100%" />
          </div>
        )}
        {vans.data?.length === 0 && <p className="text-sm" style={{ color: "var(--color-danger-text)" }}>{t("У вас нет машины — директор назначает водителя в Настройки → Ван-селлинг", "Sizda mashina yo'q — direktor Sozlamalar → Van-selling da haydovchi tayinlaydi")}</p>}

        <div>
          <span className={modalSectionLabel} style={{ color: COLORS.textTertiary }}>{t("Магазин", "Do'kon")}</span>
          {shop ? (
            <div className="flex items-center justify-between gap-2 p-3 rounded-xl" style={{ background: "var(--color-primary-subtle)" }}>
              <div><b style={{ color: COLORS.textPrimary }}>{shop.name}</b>{Number(shop.debt ?? 0) > 0 && <span className="font-data text-xs" style={{ color: "var(--color-warning-text)", marginLeft: 8 }}>{t("долг", "qarz")} {fmt(Number(shop.debt))}</span>}</div>
              <button type="button" className="neo-btn neo-btn-xs" onClick={() => setShopId(null)}>{t("Сменить", "Almashtirish")}</button>
            </div>
          ) : (
            <div>
              <div className="relative"><Search size={14} style={{ position: "absolute", left: 12, top: 13, color: COLORS.textTertiary }} /><input className="neo-input w-full" style={{ paddingLeft: 34 }} value={shopSearch} onChange={e => setShopSearch(e.target.value)} placeholder={t("Название магазина или владелец", "Do'kon nomi yoki egasi")} data-testid="van-sale-shop" autoFocus /></div>
              <div className="mt-2 rounded-xl overflow-hidden" style={{ border: `1px solid ${COLORS.border}` }}>
                {filteredShops.map(s => (
                  <button key={s.id} type="button" className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface-light flex items-center justify-between gap-3" style={{ borderTop: `1px solid ${COLORS.border}` }} onClick={() => setShopId(s.id)}>
                    <span style={{ color: COLORS.textPrimary }}>{s.name} <span style={{ color: COLORS.textTertiary, fontSize: 12 }}>{s.ownerName ?? ""}</span></span>
                    {Number(s.debt ?? 0) > 0 && <span className="font-data text-xs" style={{ color: "var(--color-warning-text)" }}>{t("долг", "qarz")} {fmt(Number(s.debt))}</span>}
                  </button>
                ))}
                {filteredShops.length === 0 && <div className="px-4 py-3 text-sm" style={{ color: COLORS.textTertiary }}>{t("Ничего не найдено", "Hech narsa topilmadi")}</div>}
              </div>
            </div>
          )}
        </div>

        <div>
          <span className={modalSectionLabel} style={{ color: COLORS.textTertiary }}>{t("В кузове", "Kuzovda")}</span>
          {!effectiveVan ? null : stock.isLoading ? <div className="p-3 text-sm" style={{ color: COLORS.textTertiary }}>{t("Загрузка…", "Yuklanmoqda…")}</div>
            : (stock.data ?? []).length === 0 ? <div className="p-3 text-sm" style={{ color: COLORS.textTertiary }}>{t("Машина пуста — загрузите её на складе", "Mashina bo'sh — omborda yuklang")}</div>
            : (
              <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${COLORS.border}` }}>
                {(stock.data ?? []).map(r => {
                  const n = qty[r.productId] ?? 0;
                  return (
                    <div key={r.productId} className="flex items-center gap-3 px-3 py-2" style={{ borderTop: `1px solid ${COLORS.border}`, background: n > 0 ? "var(--color-primary-subtle)" : "transparent" }} data-testid={`van-sale-row-${r.productId}`}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="text-sm truncate" style={{ color: COLORS.textPrimary, fontWeight: n > 0 ? 600 : 500 }}>{r.name}</div>
                        <div className="font-data text-xs" style={{ color: COLORS.textTertiary }}>{fmt(r.unitPrice)} · {t("в кузове", "kuzovda")} {formatQty(r.sellable)}{r.sellable < r.onHand ? ` (${t("просрочено", "muddati o'tgan")} ${formatQty(r.onHand - r.sellable)})` : ""}</div>
                      </div>
                      <button type="button" className="neo-btn neo-btn-xs" aria-label={t("Меньше", "Kamroq")} onClick={() => set(r.productId, n - 1, r.sellable)} disabled={n <= 0}><Minus size={12} /></button>
                      <input className="neo-input font-data text-center" style={{ width: 64, height: 32, padding: 0 }} inputMode="numeric" value={n === 0 ? "" : String(n)} placeholder="0" aria-label={r.name} onChange={e => set(r.productId, Number(e.target.value.replace(/\D/g, "")) || 0, r.sellable)} data-testid={`van-sale-qty-${r.productId}`} />
                      <button type="button" className="neo-btn neo-btn-xs" aria-label={t("Больше", "Ko'proq")} onClick={() => set(r.productId, n + 1, r.sellable)} disabled={n >= r.sellable}><Plus size={12} /></button>
                      <div className="font-data text-sm text-right" style={{ width: 96, color: n > 0 ? COLORS.textPrimary : COLORS.textTertiary }}>{n > 0 ? fmt(r.unitPrice * n) : "—"}</div>
                    </div>
                  );
                })}
              </div>
            )}
        </div>

        <div className="neo-card neo-card-static" style={{ borderRadius: "16px", padding: "14px" }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="range-pills">{METHODS.map(([k, label]) => <button key={k} type="button" className={"range-pill tap" + (method === k ? " active" : "")} onClick={() => { setMethod(k); setPaid(null); }} data-testid={`van-sale-method-${k}`}>{label}</button>)}</div>
            <div style={{ fontFamily: F.display, fontSize: "18px", fontWeight: 700, color: COLORS.textPrimary }} className="font-data">{t("Итого", "Jami")} {fmt(total)}</div>
          </div>
          {method !== "debt" && (
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <label className="text-xs" style={{ color: COLORS.textSecondary }}>{t("Заплатил сейчас", "Hozir to'ladi")}<DecimalInput className="neo-input font-data mt-1" style={{ width: 160 }} value={paid ?? String(total || "")} onValueChange={setPaid} data-testid="van-sale-paid" /></label>
              {paidValue < total && <span className="text-xs" style={{ color: "var(--color-warning-text)" }}>{t("остаток", "qoldiq")} {fmt(total - paidValue)} — {t("в долг магазина", "do'kon qarziga")}</span>}
            </div>
          )}
          <input className="neo-input w-full mt-3" maxLength={500} value={notes} onChange={e => setNotes(e.target.value)} placeholder={t("Примечание (необязательно)", "Izoh (ixtiyoriy)")} />
        </div>

        <div className="flex gap-2 flex-wrap">
          <button className="neo-btn-primary flex items-center gap-2" onClick={submit} disabled={sale.isPending || !lines.length || !shopId} data-testid="van-sale-submit"><Check size={16} /> {t("Продать", "Sotish")}{lines.length ? ` · ${lines.length} · ${fmt(total)}` : ""}</button>
          <button className="neo-btn flex items-center gap-2" onClick={() => { reset(); onClose(); }}><X size={16} /> {t("Отмена", "Bekor")}</button>
          <span className="text-xs self-center" style={{ color: COLORS.textTertiary }}><Truck size={12} style={{ display: "inline" }} /> {t("Заказ родится доставленным; товар уйдёт с машины", "Buyurtma yetkazilgan holda tug'iladi; tovar mashinadan chiqadi")}</span>
        </div>
      </div>
    </AppModal>
  );
}
