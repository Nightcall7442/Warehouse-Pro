import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { useConfirm } from "@/components/ConfirmDialog";
import { AppModal, modalSectionLabel } from "@/components/ui/AppModal";
import { SectionNotice } from "@/components/SectionNotice";
import { notify } from "@/lib/toast";
import { formatQty } from "@/lib/format";
import { F, COLORS, thStyle, tdStyle } from "@/components/users/types";
import { format } from "date-fns";
import { Truck, ArrowDownToLine, ArrowUpFromLine, ClipboardCheck, Check, X, Trash2 } from "lucide-react";

/*
  Машины на складе: что в кузове, загрузить, вернуть, пересчитать.

  Загрузка — перемещение со склада в машину под PIN водителя: это его
  подпись под количеством, и спор «мне столько не давали» закрывается.
  Возврат — перемещение обратно, принимает кладовщик. Пересчёт — что по
  системе есть, а в кузове нет, — недостача по цене продажи, долгом водителя
  в кассе.
*/
type T = (ru: string, uz: string) => string;
type Line = { productId: number; name: string; unit: string | null; available: number; quantity: string };
type Mode = "load" | "unload" | "count";

export function VansTab() {
  const { lang } = useLang();
  const t: T = (ru, uz) => (lang === "uz" ? uz : ru);
  const { fmt } = useCurrency();
  const utils = trpc.useUtils();
  const vans = trpc.van.list.useQuery();
  const [modal, setModal] = useState<{ mode: Mode; van: { id: number; name: string; driverName: string | null } } | null>(null);
  const refresh = () => { utils.van.list.invalidate(); utils.van.stock.invalidate(); utils.warehouseMulti.getStock.invalidate(); utils.warehouseMulti.listTransfers.invalidate(); utils.cash.overview.invalidate(); };
  const rows = vans.data ?? [];

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <SectionNotice kind="empty" message={t("Машин нет — заведите их в Настройки → Ван-селлинг", "Mashina yo'q — Sozlamalar → Van-selling bo'limida qo'shing")} />
      ) : (
        <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(300px,1fr))]">
          {rows.map(v => (
            <div key={v.id} className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "16px", opacity: v.status === "active" ? 1 : 0.6 }} data-testid={`van-card-${v.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 700, color: COLORS.textPrimary }}><Truck size={15} style={{ display: "inline", marginRight: 6, color: "var(--color-primary-text)" }} />{v.name}{v.plate ? <span className="font-data" style={{ color: COLORS.textTertiary, fontWeight: 500 }}> · {v.plate}</span> : null}</div>
                  <div style={{ fontSize: "12px", color: COLORS.textSecondary, marginTop: 2 }}>{v.driverName ?? t("без водителя", "haydovchisiz")}{v.lastLoadAt ? ` · ${t("загружена", "yuklangan")} ${format(new Date(v.lastLoadAt), "dd.MM HH:mm")}` : ""}</div>
                </div>
                <div className="text-right">
                  <div className="font-data" style={{ fontFamily: F.display, fontSize: "18px", fontWeight: 700, color: v.units > 0 ? COLORS.textPrimary : COLORS.textTertiary }}>{fmt(v.value)}</div>
                  <div style={{ fontSize: "11px", color: COLORS.textTertiary }}>{v.units > 0 ? `${v.items} ${t("поз.", "poz.")} · ${formatQty(v.units)} ${t("ед.", "dona")}` : t("пусто", "bo'sh")}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <button className="neo-btn neo-btn-sm" disabled={v.status !== "active"} onClick={() => setModal({ mode: "load", van: v })} data-testid={`van-load-${v.id}`}><ArrowDownToLine size={14} /> {t("Загрузить", "Yuklash")}</button>
                <button className="neo-btn neo-btn-sm" disabled={v.units <= 0} onClick={() => setModal({ mode: "unload", van: v })} data-testid={`van-unload-${v.id}`}><ArrowUpFromLine size={14} /> {t("Вернуть на склад", "Omborga qaytarish")}</button>
                <button className="neo-btn neo-btn-sm" disabled={v.units <= 0} onClick={() => setModal({ mode: "count", van: v })} data-testid={`van-count-${v.id}`}><ClipboardCheck size={14} /> {t("Пересчёт", "Sanash")}</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {rows.length > 0 && <VanSales t={t} fmt={fmt} />}
      {modal && <VanMoveModal mode={modal.mode} van={modal.van} t={t} fmt={fmt} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
    </div>
  );
}

/** Продажи с машин за неделю: что ушло с колёс и чем заплатили. */
function VanSales({ t, fmt }: { t: T; fmt: (v: number) => string }) {
  const [now] = useState(() => new Date());
  const range = useMemo(() => ({ from: new Date(now.getTime() - 7 * 86_400_000).toISOString(), to: new Date(now.getTime() + 86_400_000).toISOString() }), [now]);
  const q = trpc.van.sales.useQuery(range);
  const rows = q.data ?? [];
  const PAY: Record<string, string> = { cash: t("наличные", "naqd"), card: t("карта", "karta"), transfer: t("перевод", "o'tkazma"), debt: t("в долг", "qarzga") };
  return (
    <div className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "8px" }}>
      <div style={{ padding: "6px 10px", fontFamily: F.display, fontSize: "13px", fontWeight: 700, color: COLORS.textPrimary }}>{t("Продажи с машин за 7 дней", "7 kunlik mashinadan sotuvlar")} · {rows.length}</div>
      {rows.length === 0 ? <SectionNotice kind="empty" message={t("С машин ещё не продавали", "Mashinadan hali sotilmagan")} /> : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "640px" }}>
            <thead><tr><th style={thStyle}>№</th><th style={thStyle}>{t("Когда", "Qachon")}</th><th style={thStyle}>{t("Машина", "Mashina")}</th><th style={thStyle}>{t("Магазин", "Do'kon")}</th><th style={thStyle}>{t("Оплата", "To'lov")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("Сумма", "Summa")}</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.id} className="row-hover">
                <td className="font-data" style={{ ...tdStyle, fontWeight: 600 }}>{r.orderNumber}</td>
                <td style={tdStyle}>{r.deliveredAt ? format(new Date(r.deliveredAt), "dd.MM HH:mm") : "—"}</td>
                <td style={tdStyle}>{r.vanName}</td>
                <td style={tdStyle}>{r.shopName}</td>
                <td style={tdStyle}>{PAY[r.paymentMethod] ?? r.paymentMethod}</td>
                <td className="font-data" style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>{fmt(Number(r.total))}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function VanMoveModal({ mode, van, t, fmt, onClose, onDone }: { mode: Mode; van: { id: number; name: string; driverName: string | null }; t: T; fmt: (v: number) => string; onClose: () => void; onDone: () => void }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");
  const [pin, setPin] = useState("");
  const [paper, setPaper] = useState(false);
  const [note, setNote] = useState("");
  const [seeded, setSeeded] = useState(false);
  const { confirm, dialog } = useConfirm();
  // Загрузка ищет по основному складу; возврат и пересчёт — по тому, что в кузове.
  const main = trpc.warehouseMulti.getStock.useQuery({ search, pageSize: 20 }, { enabled: mode === "load" && search.trim().length >= 2 });
  const vanStock = trpc.van.stock.useQuery({ vanId: van.id }, { enabled: mode !== "load" });
  // Тара на машине — считается вместе с товаром; только при включённом учёте.
  const tareOn = trpc.tare.status.useQuery();
  const tareOverview = trpc.tare.overview.useQuery(undefined, { enabled: mode === "count" && tareOn.data?.enabled === true });
  const vanTare = (tareOverview.data?.warehouses ?? []).find(w => w.id === van.id)?.lines ?? [];
  const [tareQty, setTareQty] = useState<Record<number, string>>({});
  if (mode !== "load" && vanStock.data && !seeded) {
    setSeeded(true);
    setLines(vanStock.data.map(r => ({ productId: r.productId, name: r.name, unit: r.unit, available: r.onHand, quantity: mode === "count" ? String(r.onHand) : "" })));
  }
  const load = trpc.van.load.useMutation({ onSuccess: () => { notify.success(t("Машина загружена", "Mashina yuklandi")); onDone(); }, onError: e => notify.error(e.message) });
  const unload = trpc.van.unload.useMutation({ onSuccess: () => { notify.success(t("Товар вернулся на склад", "Tovar omborga qaytdi")); onDone(); }, onError: e => notify.error(e.message) });
  const count = trpc.van.count.useMutation({
    onSuccess: r => {
      if (r.shortage > 0) notify.error(t(`Пересчёт: недостача ${fmt(r.shortage)} записана долгом водителя`, `Sanash: ${fmt(r.shortage)} kamomad haydovchi qarziga yozildi`));
      else notify.success(t("Пересчёт: всё сошлось", "Sanash: hammasi to'g'ri"));
      onDone();
    },
    onError: e => notify.error(e.message),
  });
  const pending = load.isPending || unload.isPending || count.isPending;
  const searchRows = (main.data?.data ?? []) as Array<Record<string, unknown>>;
  const setQty = (productId: number, quantity: string) => setLines(ls => ls.map(l => l.productId === productId ? { ...l, quantity: quantity.replace(/[^\d.]/g, "") } : l));
  const filled = lines.filter(l => l.quantity !== "" && Number(l.quantity) > 0);
  const countDiff = useMemo(() => mode === "count" ? lines.filter(l => l.quantity !== "" && Number(l.quantity) !== l.available) : [], [lines, mode]);

  const submit = async () => {
    if (mode === "load") {
      if (!filled.length) return notify.error(t("Добавьте хотя бы один товар", "Kamida bitta tovar qo'shing"));
      if (!paper && !/^\d{4,6}$/.test(pin)) return notify.error(t("Нужен PIN водителя или галочка «расписался на бумаге»", "Haydovchi PIN-i yoki «qog'ozda imzoladi» belgisi kerak"));
      load.mutate({ vanId: van.id, items: filled.map(l => ({ productId: l.productId, quantity: Number(l.quantity) })), pin: paper ? undefined : pin, paperSigned: paper, note: note || undefined });
    } else if (mode === "unload") {
      if (!filled.length) return notify.error(t("Укажите, что вернулось", "Nima qaytganini kiriting"));
      unload.mutate({ vanId: van.id, items: filled.map(l => ({ productId: l.productId, quantity: Number(l.quantity) })), note: note || undefined });
    } else {
      const counted = lines.filter(l => l.quantity !== "").map(l => ({ productId: l.productId, quantity: Number(l.quantity) }));
      if (!counted.length) return notify.error(t("Введите, сколько насчитали", "Qancha sanaganingizni kiriting"));
      const short = countDiff.filter(l => Number(l.quantity) < l.available);
      if (short.length && !(await confirm({ title: t("Недостача на машине", "Mashinada kamomad"), message: t(`${short.length} позиций меньше, чем по системе. Разница ляжет долгом водителя ${van.driverName ?? ""} по цене продажи. Провести?`, `${short.length} pozitsiya tizimdagidan kam. Farq haydovchi ${van.driverName ?? ""} qarziga sotuv narxida yoziladi. O'tkazilsinmi?`), confirmText: t("Провести", "O'tkazish"), danger: true }))) return;
      const tare = vanTare.map(l => ({ tareTypeId: l.tareTypeId, quantity: Number(tareQty[l.tareTypeId] ?? l.qty) }));
      count.mutate({ vanId: van.id, counted, tare: tare.length ? tare : undefined, note: note || undefined });
    }
  };

  const TITLE = { load: t(`Загрузить «${van.name}»`, `«${van.name}» ni yuklash`), unload: t(`Вернуть на склад с «${van.name}»`, `«${van.name}» dan omborga qaytarish`), count: t(`Пересчёт «${van.name}»`, `«${van.name}» ni sanash`) }[mode];
  return (
    <AppModal open onClose={onClose} title={TITLE} maxWidth={760} dirty={lines.length > 0}>
      {dialog}
      <div className="space-y-4">
        {mode === "load" && (
          <div>
            <input className="neo-input w-full" value={search} onChange={e => setSearch(e.target.value)} data-testid="van-search"
              placeholder={t("Добавить товар со склада — начните вводить название…", "Ombordan tovar qo'shish — nomini yozishni boshlang…")} />
            {search.trim().length >= 2 && (
              <div className="mt-2 rounded-xl overflow-hidden" style={{ border: `1px solid ${COLORS.border}` }}>
                {searchRows.length === 0 ? <div className="px-4 py-3 text-sm" style={{ color: COLORS.textTertiary }}>{main.isLoading ? t("Ищем…", "Qidirilmoqda…") : t("Ничего не найдено", "Hech narsa topilmadi")}</div>
                  : searchRows.slice(0, 10).map(p => {
                    const available = Number(p.available ?? 0);
                    return (
                      <button key={String(p.productId)} type="button" className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface-light flex items-center justify-between gap-3" style={{ borderTop: `1px solid ${COLORS.border}` }}
                        onClick={() => { const id = Number(p.productId); if (!lines.some(l => l.productId === id)) setLines([...lines, { productId: id, name: String(p.productName), unit: (p.unit as string | null) ?? null, available, quantity: "" }]); setSearch(""); }}>
                        <span style={{ color: COLORS.textPrimary }}>{String(p.productName)}</span>
                        <span className="font-data" style={{ color: available > 0 ? COLORS.textSecondary : "var(--color-danger-text)", whiteSpace: "nowrap" }}>{t("на складе", "omborda")} {formatQty(available)}</span>
                      </button>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {lines.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={thStyle}>{t("Товар", "Tovar")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{mode === "load" ? t("На складе", "Omborda") : t("По системе", "Tizim bo'yicha")}</th>
                <th style={{ ...thStyle, textAlign: "right", width: 120 }}>{mode === "count" ? t("В кузове", "Kuzovda") : t("Кол-во", "Miqdor")}</th>
                {mode === "count" && <th style={{ ...thStyle, textAlign: "right" }}>{t("Разница", "Farq")}</th>}
                {mode === "load" && <th style={thStyle}></th>}
              </tr></thead>
              <tbody>{lines.map(l => {
                const diff = l.quantity === "" ? 0 : Number(l.quantity) - l.available;
                return (
                  <tr key={l.productId} className="row-hover">
                    <td style={tdStyle}>{l.name}</td>
                    <td className="font-data" style={{ ...tdStyle, textAlign: "right", color: COLORS.textSecondary }}>{formatQty(l.available)}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}><input className="neo-input font-data" inputMode="decimal" style={{ width: 100, textAlign: "right" }} value={l.quantity} onChange={e => setQty(l.productId, e.target.value)} aria-label={l.name} data-testid={`van-qty-${l.productId}`} /></td>
                    {mode === "count" && <td className="font-data" style={{ ...tdStyle, textAlign: "right", fontWeight: 600, color: diff < 0 ? "var(--color-danger-text)" : diff > 0 ? "var(--color-warning-text)" : "var(--color-success-text)" }}>{l.quantity === "" ? "—" : diff === 0 ? "✓" : (diff > 0 ? "+" : "") + formatQty(diff)}</td>}
                    {mode === "load" && <td style={{ ...tdStyle, textAlign: "right" }}><button type="button" className="neo-btn neo-btn-xs" aria-label={t("Убрать", "Olib tashlash")} onClick={() => setLines(lines.filter(x => x.productId !== l.productId))}><Trash2 size={12} /></button></td>}
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : mode !== "load" && vanStock.isLoading ? <div className="p-4 text-sm" style={{ color: COLORS.textTertiary }}>{t("Загрузка…", "Yuklanmoqda…")}</div> : null}

        {mode === "count" && vanTare.length > 0 && (
          <div>
            <span className={modalSectionLabel} style={{ color: COLORS.textTertiary }}>{t("Тара в кузове", "Kuzovdagi idish")}</span>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={thStyle}>{t("Тара", "Idish")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("По системе", "Tizim bo'yicha")}</th><th style={{ ...thStyle, textAlign: "right", width: 120 }}>{t("В кузове", "Kuzovda")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("Разница", "Farq")}</th></tr></thead>
              <tbody>{vanTare.map(l => {
                const v = tareQty[l.tareTypeId] ?? String(l.qty);
                const diff = v === "" ? 0 : Number(v) - l.qty;
                return (
                  <tr key={l.tareTypeId} className="row-hover">
                    <td style={tdStyle}>{l.name}</td>
                    <td className="font-data" style={{ ...tdStyle, textAlign: "right", color: COLORS.textSecondary }}>{formatQty(l.qty)}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}><input className="neo-input font-data" inputMode="decimal" style={{ width: 100, textAlign: "right" }} value={v} onChange={e => setTareQty({ ...tareQty, [l.tareTypeId]: e.target.value.replace(/[^\d.]/g, "") })} aria-label={l.name} data-testid={`van-tare-${l.tareTypeId}`} /></td>
                    <td className="font-data" style={{ ...tdStyle, textAlign: "right", fontWeight: 600, color: diff < 0 ? "var(--color-danger-text)" : diff > 0 ? "var(--color-warning-text)" : "var(--color-success-text)" }}>{diff === 0 ? "✓" : (diff > 0 ? "+" : "") + formatQty(diff)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}

        {mode === "load" && (
          <div className="neo-card neo-card-static" style={{ borderRadius: "16px", padding: "14px" }}>
            <span className={modalSectionLabel} style={{ color: COLORS.textTertiary }}>{t("Подпись водителя", "Haydovchi imzosi")} · {van.driverName ?? t("нет водителя", "haydovchi yo'q")}</span>
            <div className="flex flex-wrap items-center gap-3 mt-2">
              <input className="neo-input font-data" type="password" inputMode="numeric" autoComplete="off" style={{ width: 140 }} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="PIN" disabled={paper} data-testid="van-pin" />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={paper} onChange={e => setPaper(e.target.checked)} /> {t("расписался на бумаге", "qog'ozda imzoladi")}</label>
            </div>
            <p style={{ fontSize: "12px", color: COLORS.textTertiary, marginTop: 6 }}>{t("Водитель вводит PIN сам — это его подпись под количеством. Кладовщик PIN не знает.", "Haydovchi PIN-ni o'zi kiritadi — bu uning miqdor ostidagi imzosi. Omborchi PIN-ni bilmaydi.")}</p>
          </div>
        )}

        <input className="neo-input w-full" maxLength={300} value={note} onChange={e => setNote(e.target.value)} placeholder={t("Примечание (необязательно)", "Izoh (ixtiyoriy)")} />

        <div className="flex gap-2 flex-wrap">
          <button className="neo-btn-primary flex items-center gap-2" onClick={submit} disabled={pending} data-testid="van-submit">
            <Check size={16} /> {mode === "load" ? t("Загрузить", "Yuklash") : mode === "unload" ? t("Принять на склад", "Omborga qabul qilish") : t("Провести пересчёт", "Sanashni o'tkazish")}{mode !== "count" && filled.length > 0 ? ` · ${filled.length}` : ""}
          </button>
          <button className="neo-btn flex items-center gap-2" onClick={onClose}><X size={16} /> {t("Отмена", "Bekor")}</button>
        </div>
      </div>
    </AppModal>
  );
}
