import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useConfirm } from "@/components/ConfirmDialog";
import { PremiumSelect } from "@/components/PremiumSelect";
import { SectionNotice } from "@/components/SectionNotice";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { notify } from "@/lib/toast";
import { formatQty } from "@/lib/format";
import { unitShort } from "@/lib/units";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useCurrency } from "@/hooks/useCurrency";
import { F, COLORS, thStyle, tdStyle } from "@/components/users/types";
import { format } from "@/lib/business-time";
import { AlertTriangle, ArrowRight, Check, ListChecks, Plus, Trash2, Truck, Undo2, X } from "lucide-react";
import { errorText } from "@/lib/error-text";
import { TransferBatchPicker } from "./TransferBatchPicker";
import { UNBATCHED, dayText } from "./transfer-text";
import { TransferReceiveDialog, type TransferDocLine } from "./TransferReceiveDialog";

/**
 * Перемещения между складами — документ «ПМ-N».
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 * Одно перемещение — один товар; «создать», потом «принять» на другом складе;
 * между шагами товар нигде; только директор. Владелец: «цепочка раздражает» —
 * стал документ в один шаг. Но партии на получателе терялись: товар ложился
 * без срока, и что уедет — кладовщик не видел до отказа сервера.
 *
 * ── Как теперь ──────────────────────────────────────────────────────────────
 * Откуда → куда, позиции, «Провести». Под каждой позицией — что уйдёт по FEFO
 * (партии со сроком), сколько просрочено и не уедет, и чья уценка пропадёт,
 * если партия уйдёт целиком. Партии можно выбрать вручную. Товар едет теми же
 * партиями. Делает директор или оператор с правом «Править остатки».
 *
 * Галочка «в пути» стоит по настройке организации: тогда товар ждёт приёмки
 * на складе-получателе (по строкам, недостача — на документе), а пока ждёт —
 * его можно отменить. Без галочки — сразу на получателе, как решил владелец.
 *
 * Строки, застрявшие «в пути» до перехода на документы, — отдельно, с
 * «Провести»: чтобы ничего не потерялось.
 */
type Warehouse = { id: number; name: string; isDefault?: boolean | null };
type Line = {
  productId: number; name: string; unit: string | null; available: number; quantity: string;
  /** Партии выбраны вручную; ключ — номер строки партии или UNBATCHED. */
  manual: boolean; picks: Record<string, string>;
};
type DocLine = TransferDocLine & { receivedQuantity: number | null; unitCost: number };
type Doc = {
  id: number; number: string; fromWarehouseId: number; toWarehouseId: number; status: string; notes: string | null;
  createdAt: Date | string; receivedAt: Date | string | null; cancelledAt: Date | string | null;
  quantity: number; receivedQuantity: number | null; shortageQty: number; shortageCost: string | null; lines: DocLine[];
};
type Planned = { batchId: number; batchNumber: string | null; expiresAt: string | null; quantity: number; batchQuantity: number; usesUp: boolean };
type PreviewItem = { productId: number; available: number; expired: number; movable: number; untracked: number; planned: Planned[] };
type Markdown = { batchId: number; productId: number; price: number; endsOn: string; batchQuantity: number };

const round2 = (n: number) => Math.round(n * 100) / 100;
const pickedOf = (l: Line) => round2(Object.values(l.picks).reduce((sum, v) => sum + (Number(v) || 0), 0));
const qtyOf = (l: Line) => (l.manual ? pickedOf(l) : Number(l.quantity) || 0);
const when = (v: Date | string | null | undefined) => (v ? format(new Date(v), "dd.MM.yyyy HH:mm") : "");

export function StockTransfers({ warehouses, canTransfer = true }: { warehouses: Warehouse[]; canTransfer?: boolean }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { confirm, dialog } = useConfirm();
  const { fmt } = useCurrency();
  const utils = trpc.useUtils();

  const defaultId = warehouses.find(w => w.isDefault)?.id ?? warehouses[0]?.id;
  const otherId = warehouses.find(w => w.id !== defaultId)?.id;
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(String(defaultId ?? ""));
  const [to, setTo] = useState(String(otherId ?? ""));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");
  // null — по настройке организации; галочкой можно сменить для этого документа.
  const [transit, setTransit] = useState<boolean | null>(null);
  const [receiving, setReceiving] = useState<Doc | null>(null);

  const settingsQ = trpc.settings.get.useQuery();
  const twoStep = Boolean((settingsQ.data as { transferTwoStep?: boolean } | null | undefined)?.transferTwoStep);
  const isTransit = transit ?? twoStep;

  // Прежние строки без документа: застрявшие «в пути» и их история.
  const legacyQ = trpc.warehouseMulti.listTransfers.useQuery({ status: "all", limit: 100, legacy: true });
  const transitQ = trpc.warehouseMulti.transferDocs.useQuery({ status: "in_transit", limit: 100 });
  const historyQ = trpc.warehouseMulti.transferDocs.useQuery({ status: "all", limit: 50 });

  // Товар ищется по названию на складе-отправителе — рядом сразу свободный
  // остаток именно там, откуда он поедет.
  const productsQ = trpc.warehouseMulti.getStock.useQuery(
    { warehouseId: Number(from) || undefined, search, pageSize: 20 },
    { enabled: open && search.trim().length >= 2 && !!Number(from) },
  );

  // Предпросмотр — после паузы в наборе: не запрос на каждую цифру.
  const previewItems = useDebouncedValue(
    useMemo(() => lines.map(l => ({ productId: l.productId, quantity: qtyOf(l) })).filter(i => i.quantity > 0), [lines]),
  );
  const previewQ = trpc.warehouseMulti.previewTransfer.useQuery(
    { fromWarehouseId: Number(from), items: previewItems },
    { enabled: open && !!Number(from) && previewItems.length > 0 },
  );
  const previewOf = useMemo(() => new Map(((previewQ.data?.items ?? []) as PreviewItem[]).map(p => [p.productId, p])), [previewQ.data]);
  const markdownOf = useMemo(() => new Map(((previewQ.data?.markdowns ?? []) as Markdown[]).map(m => [m.batchId, m])), [previewQ.data]);

  const nameOf = useMemo(() => new Map(warehouses.map(w => [w.id, w.name])), [warehouses]);
  const route = (f: number, tt: number) => `${nameOf.get(f) ?? f} → ${nameOf.get(tt) ?? tt}`;

  const invalidateStock = () => {
    utils.warehouseMulti.listTransfers.invalidate();
    utils.warehouseMulti.transferDocs.invalidate();
    utils.warehouseMulti.previewTransfer.invalidate();
    // Остаток изменился на обоих складах — список и сравнение обязаны это показать.
    utils.warehouseMulti.getStock.invalidate();
    utils.warehouse.valuation.invalidate();
  };

  const create = trpc.warehouseMulti.createTransfer.useMutation({
    onSuccess: (r) => {
      notify.success(r.status === "in_transit"
        ? t(`${r.number} отправлено — товар в пути, ждёт приёмки`, `${r.number} jo'natildi — tovar yo'lda, qabulni kutmoqda`)
        : t(`${r.number} проведено: позиций ${r.count}`, `${r.number} o'tkazildi: ${r.count} pozitsiya`));
      invalidateStock();
      setOpen(false); setLines([]); setNotes(""); setSearch(""); setTransit(null);
    },
    onError: e => notify.error(errorText(e)),
  });

  const complete = trpc.warehouseMulti.completeTransfer.useMutation({
    onSuccess: () => { notify.success(t("Перемещение проведено", "Ko'chirish o'tkazildi")); invalidateStock(); },
    onError: e => notify.error(errorText(e)),
  });

  const cancel = trpc.warehouseMulti.cancelTransfer.useMutation({
    onSuccess: (r) => { notify.success(t(`${r.number} отменено — товар вернулся на склад`, `${r.number} bekor qilindi — tovar omborga qaytdi`)); invalidateStock(); },
    onError: e => notify.error(errorText(e)),
  });

  const addLine = (p: { productId: number; productName: string; unit: string | null; available: number }) => {
    if (lines.some(l => l.productId === p.productId)) { notify.info(t("Товар уже в документе", "Mahsulot allaqachon hujjatda")); return; }
    setLines(ls => [...ls, { productId: p.productId, name: p.productName, unit: p.unit, available: p.available, quantity: "", manual: false, picks: {} }]);
    setSearch("");
  };
  const patch = (productId: number, next: Partial<Line>) => setLines(ls => ls.map(x => (x.productId === productId ? { ...x, ...next } : x)));

  const submit = async () => {
    const f = Number(from), tt = Number(to);
    if (!f || !tt) return notify.error(t("Выберите оба склада", "Ikkala omborni tanlang"));
    if (f === tt) return notify.error(t("Склад отправителя и получателя совпадают", "Jo'natuvchi va qabul qiluvchi bir xil"));
    if (lines.length === 0) return notify.error(t("Добавьте хотя бы одну позицию", "Kamida bitta pozitsiya qo'shing"));
    for (const l of lines) {
      const q = qtyOf(l);
      if (!(q > 0)) return notify.error(t(`Укажите количество: ${l.name}`, `Miqdorni kiriting: ${l.name}`));
      if (l.manual) continue; // выбранное проверяет дверь: партию знает только она
      if (q > l.available) return notify.error(t(`${l.name}: на складе свободно ${formatQty(l.available)}`, `${l.name}: omborda bo'sh ${formatQty(l.available)}`));
      const p = previewOf.get(l.productId);
      if (p && q > p.movable + 1e-9) {
        return notify.error(t(`${l.name}: годного к перемещению ${formatQty(p.movable)} — просроченное по FEFO не уедет; выберите партии вручную`,
                              `${l.name}: ko'chirishga yaroqlisi ${formatQty(p.movable)} — muddati o'tgani FEFO bo'yicha ketmaydi; partiyalarni qo'lda tanlang`));
      }
    }
    const ok = await confirm({
      title: isTransit ? t("Отправить перемещение?", "Ko'chirish jo'natilsinmi?") : t("Провести перемещение?", "Ko'chirish o'tkazilsinmi?"),
      message: isTransit
        ? t(`${route(f, tt)}, позиций: ${lines.length}. Товар спишется со склада-отправителя и будет в пути, пока его не примут.`,
            `${route(f, tt)}, ${lines.length} pozitsiya. Mahsulot jo'natuvchi ombordan chiqadi va qabul qilinmaguncha yo'lda bo'ladi.`)
        : t(`${route(f, tt)}, позиций: ${lines.length}. Товар сразу спишется с одного склада и зачислится на другой теми же партиями. Отменить нельзя.`,
            `${route(f, tt)}, ${lines.length} pozitsiya. Mahsulot darhol bir ombordan chiqib, boshqasiga o'sha partiyalar bilan kiradi. Bekor qilib bo'lmaydi.`),
      confirmText: isTransit ? t("Отправить", "Jo'natish") : t("Провести", "O'tkazish"),
    });
    if (!ok) return;
    create.mutate({
      fromWarehouseId: f, toWarehouseId: tt, notes: notes || undefined, mode: isTransit ? "transit" : "instant",
      items: lines.map(l => {
        if (!l.manual) return { productId: l.productId, quantity: Number(l.quantity) };
        const picks = Object.entries(l.picks)
          .filter(([, v]) => Number(v) > 0)
          .map(([k, v]) => ({ batchId: k === UNBATCHED ? null : Number(k), quantity: Number(v) }));
        return { productId: l.productId, quantity: pickedOf(l), picks };
      }),
    });
  };

  const doCancel = async (d: Doc) => {
    const ok = await confirm({
      title: t(`Отменить ${d.number}?`, `${d.number} bekor qilinsinmi?`),
      message: t(`Товар вернётся на «${nameOf.get(d.fromWarehouseId) ?? ""}» теми же партиями.`,
                 `Mahsulot «${nameOf.get(d.fromWarehouseId) ?? ""}» omboriga o'sha partiyalar bilan qaytadi.`),
      confirmText: t("Отменить перемещение", "Ko'chirishni bekor qilish"),
    });
    if (ok) cancel.mutate({ docId: d.id });
  };

  /** Предупреждения строки: просрочка, нехватка годного, уценка, которая уйдёт с партией. */
  const lineNotes = (l: Line) => {
    const p = previewOf.get(l.productId);
    const q = qtyOf(l);
    const gone: Array<{ batch: string; price: number }> = [];
    if (l.manual) {
      for (const [k, v] of Object.entries(l.picks)) {
        const m = k === UNBATCHED ? undefined : markdownOf.get(Number(k));
        if (m && Number(v) + 1e-9 >= m.batchQuantity) gone.push({ batch: k, price: m.price });
      }
    } else {
      for (const b of p?.planned ?? []) {
        const m = markdownOf.get(b.batchId);
        if (b.usesUp && m) gone.push({ batch: b.batchNumber ?? t("без номера", "raqamsiz"), price: m.price });
      }
    }
    return { p, q, gone };
  };

  const legacy = (legacyQ.data ?? []) as Array<{ id: number; fromWarehouseId: number; toWarehouseId: number; productName: string; quantity: string; status: string; notes: string | null; createdAt: Date | string; completedAt: Date | string | null }>;
  const pending = legacy.filter(r => r.status === "pending");
  const legacyDone = legacy.filter(r => r.status !== "pending");
  const inTransit = (transitQ.data ?? []) as unknown as Doc[];
  const history = ((historyQ.data ?? []) as unknown as Doc[]).filter(d => d.status !== "in_transit");
  const options = warehouses.map(w => ({ value: String(w.id), label: `${w.name}${w.isDefault ? " ★" : ""}` }));
  const searchRows = (productsQ.data?.data ?? []) as Array<Record<string, unknown>>;

  const statusText = (d: Doc) => d.status === "cancelled"
    ? t("Отменено", "Bekor qilingan")
    : d.status === "received_short"
      ? `${t("Недостача", "Kamomad")} ${formatQty(d.shortageQty)}${d.shortageCost ? ` · ${fmt(d.shortageCost)}` : ""}`
      : t("Принято", "Qabul qilingan");

  return (
    <div className="space-y-4">
      {dialog}
      {receiving && (
        <TransferReceiveDialog doc={receiving} route={route(receiving.fromWarehouseId, receiving.toWarehouseId)}
          onClose={() => setReceiving(null)} onDone={invalidateStock} />
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm" style={{ color: COLORS.textSecondary }}>
          {t("Перемещение — документ: откуда, куда, позиции. Товар едет теми же партиями — с номером, сроком и себестоимостью.",
             "Ko'chirish — hujjat: qayerdan, qayerga, pozitsiyalar. Mahsulot o'sha partiyalar bilan — raqami, muddati va tannarxi bilan ko'chadi.")}
        </p>
        {canTransfer && !open && (
          <button className="neo-btn-primary tap flex items-center gap-2" onClick={() => setOpen(true)} data-testid="transfer-new">
            <Plus size={16} /> {t("Новое перемещение", "Yangi ko'chirish")}
          </button>
        )}
      </div>

      {open && (
        <div className="neo-card p-5 space-y-4" data-testid="transfer-form">
          <div className="grid gap-3" style={{ gridTemplateColumns: "1fr auto 1fr", alignItems: "end" }}>
            <div>
              <p className="text-[10px] font-semibold tracking-wider uppercase mb-2" style={{ color: COLORS.textTertiary }}>{t("Откуда", "Qayerdan")}</p>
              <PremiumSelect value={from} onChange={v => { setFrom(v); setLines([]); }} options={options} width="100%" />
            </div>
            <ArrowRight size={18} style={{ color: COLORS.textTertiary, marginBottom: 10 }} />
            <div>
              <p className="text-[10px] font-semibold tracking-wider uppercase mb-2" style={{ color: COLORS.textTertiary }}>{t("Куда", "Qayerga")}</p>
              <PremiumSelect value={to} onChange={setTo} options={options} width="100%" />
            </div>
          </div>

          <label className="flex items-center gap-3 text-sm cursor-pointer" style={{ minHeight: 44, color: COLORS.textPrimary }}>
            <input type="checkbox" className="neo-toggle" data-testid="transfer-transit" checked={isTransit} onChange={e => setTransit(e.target.checked)} />
            {t("В пути — на складе-получателе примут по факту", "Yo'lda — qabul qiluvchi omborda haqiqatda qabul qilinadi")}
          </label>

          {/* Позиции */}
          <div>
            <p className="text-[10px] font-semibold tracking-wider uppercase mb-2" style={{ color: COLORS.textTertiary }}>{t("Позиции", "Pozitsiyalar")}</p>
            {lines.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table className="w-full text-sm mb-3" data-testid="transfer-lines">
                  <thead><tr>
                    <th style={thStyle}>{t("Товар", "Mahsulot")}</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>{t("Свободно", "Bo'sh")}</th>
                    <th style={{ ...thStyle, width: 140 }}>{t("Переместить", "Ko'chirish")}</th>
                    <th style={{ ...thStyle, width: 80 }} />
                  </tr></thead>
                  {lines.map(l => {
                    const { p, q, gone } = lineNotes(l);
                    const over = !l.manual && Number(l.quantity) > l.available;
                    // Вторая строка — только когда есть что сказать: выбор партий, план FEFO, уценка.
                    const showPlan = !l.manual && !!p && q > 0;
                    const hasNotes = (l.manual && Number(from) > 0) || showPlan || gone.length > 0;
                    return (
                      <tbody key={l.productId}>
                        <tr style={{ borderTop: `1px solid ${COLORS.border}` }}>
                          <td style={tdStyle}><span style={{ fontWeight: 600, color: COLORS.textPrimary }}>{l.name}</span></td>
                          <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", color: COLORS.textSecondary }}>{formatQty(l.available)} {unitShort(l.unit, lang)}</td>
                          <td style={tdStyle}>
                            {l.manual ? (
                              <span className="font-data" style={{ fontWeight: 600 }}>{formatQty(pickedOf(l))}</span>
                            ) : (
                              <DecimalInput className="neo-input w-full font-data" value={l.quantity} placeholder="0"
                                style={over ? { borderColor: "var(--color-danger)" } : undefined}
                                onValueChange={v => patch(l.productId, { quantity: v })} />
                            )}
                          </td>
                          <td style={tdStyle}>
                            <div className="flex items-center gap-1 justify-end">
                              <button type="button" className="btn-ghost tap" data-testid={`transfer-manual-${l.productId}`}
                                title={l.manual ? t("Партии по FEFO", "Partiyalar FEFO bo'yicha") : t("Выбрать партии вручную", "Partiyalarni qo'lda tanlash")}
                                aria-pressed={l.manual}
                                onClick={() => patch(l.productId, { manual: !l.manual, picks: {} })}>
                                <ListChecks size={14} style={{ color: l.manual ? COLORS.textPrimary : COLORS.textTertiary }} />
                              </button>
                              <button type="button" className="btn-ghost tap" aria-label={t("Убрать", "Olib tashlash")} onClick={() => setLines(ls => ls.filter(x => x.productId !== l.productId))}>
                                <Trash2 size={14} style={{ color: COLORS.textTertiary }} />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {hasNotes && <tr>
                          <td colSpan={4} style={{ ...tdStyle, paddingTop: 0 }}>
                            {l.manual && Number(from) > 0 && (
                              <TransferBatchPicker productId={l.productId} warehouseId={Number(from)} picks={l.picks}
                                onChange={picks => patch(l.productId, { picks })} />
                            )}
                            {showPlan && p && (
                              <div className="text-xs space-y-0.5" data-testid={`transfer-plan-${l.productId}`} style={{ color: COLORS.textSecondary }}>
                                {p.planned.length > 0 && (
                                  <div>
                                    {t("Уйдёт по сроку:", "Muddat bo'yicha ketadi:")}{" "}
                                    {p.planned.map(b => `${b.batchNumber ?? t("без номера", "raqamsiz")}${b.expiresAt ? ` (${t("до", "gacha")} ${dayText(b.expiresAt)})` : ""} — ${formatQty(b.quantity)}`).join("; ")}
                                    {p.untracked > 0 ? `; ${t("без партии", "partiyasiz")} — ${formatQty(p.untracked)}` : ""}
                                  </div>
                                )}
                                {p.expired > 0 && (
                                  <div style={{ color: q > p.movable ? "var(--color-danger-text)" : "var(--color-warning-text)" }}>
                                    {t(`Из свободного ${formatQty(p.available)} просрочено ${formatQty(p.expired)} — по FEFO не уедет; годного ${formatQty(p.movable)}`,
                                       `Bo'sh ${formatQty(p.available)} dan ${formatQty(p.expired)} muddati o'tgan — FEFO bo'yicha ketmaydi; yaroqlisi ${formatQty(p.movable)}`)}
                                  </div>
                                )}
                              </div>
                            )}
                            {gone.length > 0 && (
                              <div className="text-xs mt-1 flex items-start gap-1.5" data-testid="transfer-markdown-warning" style={{ color: "var(--color-warning-text)" }}>
                                <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                                <span>
                                  {gone.map(g => t(
                                    `Партия ${g.batch} уйдёт целиком — уценка (${fmt(g.price)}) на складе-отправителе пропадёт, а на получателе её нет: поставьте заново, если нужна.`,
                                    `${g.batch} partiyasi to'liq ketadi — jo'natuvchi ombordagi arzonlashtirish (${fmt(g.price)}) yo'qoladi, qabul qiluvchida esa yo'q: kerak bo'lsa, qayta qo'ying.`,
                                  )).join(" ")}
                                </span>
                              </div>
                            )}
                          </td>
                        </tr>}
                      </tbody>
                    );
                  })}
                </table>
              </div>
            )}
            <input className="neo-input w-full" value={search} onChange={e => setSearch(e.target.value)} data-testid="transfer-search"
              placeholder={t("Добавить товар — начните вводить название…", "Mahsulot qo'shish — nomini yozishni boshlang…")} />
            {search.trim().length >= 2 && (
              <div className="mt-2 rounded-xl overflow-hidden" style={{ border: `1px solid ${COLORS.border}` }}>
                {productsQ.isLoading ? (
                  <div className="px-4 py-3 text-sm" style={{ color: COLORS.textTertiary }}>{t("Ищем…", "Qidirilmoqda…")}</div>
                ) : searchRows.length === 0 ? (
                  <div className="px-4 py-3 text-sm" style={{ color: COLORS.textTertiary }}>{t("Ничего не найдено", "Hech narsa topilmadi")}</div>
                ) : searchRows.slice(0, 10).map(p => {
                  const available = Number(p.available ?? 0);
                  return (
                    <button key={String(p.productId)} type="button" className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface-light flex items-center justify-between gap-3"
                      style={{ borderTop: `1px solid ${COLORS.border}` }}
                      onClick={() => addLine({ productId: Number(p.productId), productName: String(p.productName), unit: (p.unit as string | null) ?? null, available })}>
                      <span style={{ color: COLORS.textPrimary }}>{String(p.productName)} <span style={{ color: COLORS.textTertiary, fontSize: 12 }}>{String(p.productCode ?? "")}</span></span>
                      <span style={{ color: available > 0 ? COLORS.textSecondary : "var(--color-danger-text)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                        {t("свободно", "bo'sh")} {formatQty(available)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <input className="neo-input w-full" maxLength={500} value={notes} onChange={e => setNotes(e.target.value)}
            placeholder={t("Примечание (необязательно)", "Izoh (ixtiyoriy)")} />

          <div className="flex gap-2 flex-wrap">
            <button className="neo-btn-primary tap flex items-center gap-2" onClick={submit} disabled={create.isPending} data-testid="transfer-submit">
              <Check size={16} /> {isTransit ? t("Отправить", "Jo'natish") : t("Провести", "O'tkazish")}{lines.length > 0 ? ` · ${lines.length}` : ""}
            </button>
            <button className="neo-btn tap flex items-center gap-2" onClick={() => { setOpen(false); setLines([]); setSearch(""); setTransit(null); }}>
              <X size={16} /> {t("Отмена", "Bekor")}
            </button>
          </div>
        </div>
      )}

      {/* В пути — документы, ждущие приёмки на складе-получателе */}
      {inTransit.length > 0 && (
        <div className="neo-card p-0 overflow-hidden" data-testid="transfer-in-transit">
          <div className="px-5 py-3 text-xs font-semibold tracking-wider uppercase" style={{ color: "var(--color-info-text)", background: "var(--color-info-subtle)" }}>
            {t("В пути — ждут приёмки", "Yo'lda — qabulni kutmoqda")}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="w-full text-sm">
              <tbody>
                {inTransit.map(d => (
                  <tr key={d.id} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                    <td style={{ ...tdStyle, fontWeight: 700, whiteSpace: "nowrap" }}>{d.number}</td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap", color: COLORS.textSecondary }}>{when(d.createdAt)}</td>
                    <td style={tdStyle}>{route(d.fromWarehouseId, d.toWarehouseId)}</td>
                    <td style={{ ...tdStyle, color: COLORS.textSecondary }}>
                      {[...new Set(d.lines.map(l => l.productName))].join(", ")}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatQty(d.quantity)}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      {canTransfer && (
                        <div className="flex gap-2 justify-end">
                          <button className="neo-btn-primary tap flex items-center gap-1.5" data-testid={`transfer-receive-${d.id}`} onClick={() => setReceiving(d)}>
                            <Check size={14} />{t("Принять", "Qabul qilish")}
                          </button>
                          <button className="neo-btn tap flex items-center gap-1.5" data-testid={`transfer-cancel-${d.id}`} onClick={() => doCancel(d)} disabled={cancel.isPending}>
                            <Undo2 size={14} />{t("Отменить", "Bekor qilish")}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Застрявшие «в пути» до перехода на документы — только если такие есть */}
      {pending.length > 0 && (
        <div className="neo-card p-0 overflow-hidden" data-testid="transfer-pending">
          <div className="px-5 py-3 text-xs font-semibold tracking-wider uppercase" style={{ color: "var(--color-warning-text)", background: "var(--color-warning-subtle)" }}>
            {t("В пути — заведены до перехода на документы, ждут проведения", "Yo'lda — hujjatlarga o'tishdan oldin yaratilgan, o'tkazishni kutmoqda")}
          </div>
          <table className="w-full text-sm">
            <tbody>
              {pending.map(r => (
                <tr key={r.id} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                  <td style={tdStyle}>{r.productName}</td>
                  <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>{formatQty(r.quantity)}</td>
                  <td style={tdStyle}>{route(r.fromWarehouseId, r.toWarehouseId)}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    {canTransfer && (
                      <button className="neo-btn tap flex items-center gap-1.5 ml-auto" onClick={() => complete.mutate({ transferId: r.id })} disabled={complete.isPending}>
                        <Check size={14} />{t("Провести", "O'tkazish")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* История документов */}
      {historyQ.isError || legacyQ.isError ? (
        <SectionNotice kind="error" message={t("Не удалось загрузить перемещения", "Ko'chirishlarni yuklab bo'lmadi")} onRetry={() => { historyQ.refetch(); legacyQ.refetch(); }} />
      ) : history.length === 0 && legacyDone.length === 0 ? (
        inTransit.length === 0 && <SectionNotice kind="empty" message={t("Перемещений пока не было", "Hali ko'chirishlar bo'lmagan")} />
      ) : (
        <div className="neo-card p-0 overflow-hidden" data-testid="transfer-history">
          <div style={{ overflowX: "auto" }}>
            <table className="w-full text-sm">
              <thead><tr>
                <th style={thStyle}>{t("Дата", "Sana")}</th>
                <th style={thStyle}>{t("Документ", "Hujjat")}</th>
                <th style={thStyle}>{t("Откуда → куда", "Qayerdan → qayerga")}</th>
                <th style={thStyle}>{t("Товар", "Mahsulot")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("Кол-во", "Miqdor")}</th>
                <th style={thStyle}>{t("Итог", "Natija")}</th>
                <th style={thStyle}>{t("Примечание", "Izoh")}</th>
              </tr></thead>
              <tbody>
                {history.map(d => (
                  <tr key={`d${d.id}`} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap", color: COLORS.textSecondary }}>{when(d.receivedAt ?? d.cancelledAt ?? d.createdAt)}</td>
                    <td style={{ ...tdStyle, fontWeight: 700, whiteSpace: "nowrap" }}>{d.number}</td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{route(d.fromWarehouseId, d.toWarehouseId)}</td>
                    <td style={{ ...tdStyle, fontFamily: F.display, fontWeight: 600, color: COLORS.textPrimary }}>{[...new Set(d.lines.map(l => l.productName))].join(", ")}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatQty(d.quantity)}</td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap", color: d.status === "received_short" ? "var(--color-warning-text)" : d.status === "cancelled" ? COLORS.textTertiary : COLORS.textSecondary }}>
                      {statusText(d)}
                    </td>
                    <td style={{ ...tdStyle, color: COLORS.textSecondary }}>{d.notes ?? "—"}</td>
                  </tr>
                ))}
                {legacyDone.map(r => (
                  <tr key={`l${r.id}`} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap", color: COLORS.textSecondary }}>{when(r.completedAt ?? r.createdAt)}</td>
                    <td style={{ ...tdStyle, color: COLORS.textTertiary }}>—</td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{route(r.fromWarehouseId, r.toWarehouseId)}</td>
                    <td style={{ ...tdStyle, fontFamily: F.display, fontWeight: 600, color: COLORS.textPrimary }}>{r.productName}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatQty(r.quantity)}</td>
                    <td style={{ ...tdStyle, color: COLORS.textSecondary }}>{t("Принято", "Qabul qilingan")}</td>
                    <td style={{ ...tdStyle, color: COLORS.textSecondary }}>{r.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export const TransfersIcon = Truck;
