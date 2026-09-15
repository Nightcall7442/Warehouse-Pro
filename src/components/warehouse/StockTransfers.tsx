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
import { F, COLORS, thStyle, tdStyle } from "@/components/users/types";
import { format } from "date-fns";
import { ArrowRight, Check, Plus, Trash2, Truck, X } from "lucide-react";

/**
 * Перемещения между складами — документ в один шаг.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 * Одно перемещение — один товар; «создать», потом «принять» на другом складе;
 * между шагами товар нигде; только директор. Владелец: «цепочка раздражает».
 *
 * ── Как теперь ──────────────────────────────────────────────────────────────
 * Откуда → куда, список позиций с остатком склада-отправителя рядом, одна
 * кнопка «Провести». Товар сразу на складе-получателе. Делает директор или
 * оператор с правом «Править остатки» (warehouse.adjust).
 *
 * Строки, застрявшие «в пути» до этой правки, показываются отдельно с кнопкой
 * «Провести» — чтобы ничего не потерялось при переходе.
 */
type Warehouse = { id: number; name: string; isDefault?: boolean | null };
type Line = { productId: number; name: string; unit: string | null; available: number; quantity: string };

export function StockTransfers({ warehouses, canTransfer = true }: { warehouses: Warehouse[]; canTransfer?: boolean }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { confirm, dialog } = useConfirm();
  const utils = trpc.useUtils();

  const defaultId = warehouses.find(w => w.isDefault)?.id ?? warehouses[0]?.id;
  const otherId = warehouses.find(w => w.id !== defaultId)?.id;
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(String(defaultId ?? ""));
  const [to, setTo] = useState(String(otherId ?? ""));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");

  const listQ = trpc.warehouseMulti.listTransfers.useQuery({ status: "all", limit: 100 });

  // Товар ищется по названию на складе-отправителе — рядом сразу свободный
  // остаток именно там, откуда он поедет.
  const productsQ = trpc.warehouseMulti.getStock.useQuery(
    { warehouseId: Number(from) || undefined, search, pageSize: 20 },
    { enabled: open && search.trim().length >= 2 && !!Number(from) },
  );

  const nameOf = useMemo(() => new Map(warehouses.map(w => [w.id, w.name])), [warehouses]);

  const invalidateStock = () => {
    utils.warehouseMulti.listTransfers.invalidate();
    // Остаток изменился на обоих складах — список и сравнение обязаны это показать.
    utils.warehouseMulti.getStock.invalidate();
    utils.warehouse.valuation.invalidate();
  };

  const create = trpc.warehouseMulti.createTransfer.useMutation({
    onSuccess: (r) => {
      notify.success(t(`Перемещение проведено: позиций ${r.count}`, `Ko'chirish o'tkazildi: ${r.count} pozitsiya`));
      invalidateStock();
      setOpen(false); setLines([]); setNotes(""); setSearch("");
    },
    onError: e => notify.error(e.message),
  });

  const complete = trpc.warehouseMulti.completeTransfer.useMutation({
    onSuccess: () => { notify.success(t("Перемещение проведено", "Ko'chirish o'tkazildi")); invalidateStock(); },
    onError: e => notify.error(e.message),
  });

  const addLine = (p: { productId: number; productName: string; unit: string | null; available: number }) => {
    if (lines.some(l => l.productId === p.productId)) { notify.info(t("Товар уже в документе", "Mahsulot allaqachon hujjatda")); return; }
    setLines(ls => [...ls, { productId: p.productId, name: p.productName, unit: p.unit, available: p.available, quantity: "" }]);
    setSearch("");
  };

  const submit = async () => {
    const f = Number(from), tt = Number(to);
    if (!f || !tt) return notify.error(t("Выберите оба склада", "Ikkala omborni tanlang"));
    if (f === tt) return notify.error(t("Склад отправителя и получателя совпадают", "Jo'natuvchi va qabul qiluvchi bir xil"));
    if (lines.length === 0) return notify.error(t("Добавьте хотя бы одну позицию", "Kamida bitta pozitsiya qo'shing"));
    for (const l of lines) {
      const q = Number(l.quantity);
      if (!(q > 0)) return notify.error(t(`Укажите количество: ${l.name}`, `Miqdorni kiriting: ${l.name}`));
      if (q > l.available) return notify.error(t(`${l.name}: на складе свободно ${formatQty(l.available)}`, `${l.name}: omborda bo'sh ${formatQty(l.available)}`));
    }
    const ok = await confirm({
      title: t("Провести перемещение?", "Ko'chirish o'tkazilsinmi?"),
      message: t(
        `${nameOf.get(f)} → ${nameOf.get(tt)}, позиций: ${lines.length}. Товар сразу спишется с одного склада и зачислится на другой. Отменить нельзя.`,
        `${nameOf.get(f)} → ${nameOf.get(tt)}, ${lines.length} pozitsiya. Mahsulot darhol bir ombordan chiqib, boshqasiga kiradi. Bekor qilib bo'lmaydi.`,
      ),
      confirmText: t("Провести", "O'tkazish"),
    });
    if (!ok) return;
    create.mutate({ fromWarehouseId: f, toWarehouseId: tt, items: lines.map(l => ({ productId: l.productId, quantity: Number(l.quantity) })), notes: notes || undefined });
  };

  const rows = listQ.data ?? [];
  const pending = rows.filter(r => r.status === "pending");
  const done = rows.filter(r => r.status !== "pending");
  const options = warehouses.map(w => ({ value: String(w.id), label: `${w.name}${w.isDefault ? " ★" : ""}` }));
  const searchRows = (productsQ.data?.data ?? []) as Array<Record<string, unknown>>;

  return (
    <div className="space-y-4">
      {dialog}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm" style={{ color: COLORS.textSecondary }}>
          {t("Перемещение — один документ: откуда, куда, позиции. Товар сразу оказывается на складе-получателе.",
             "Ko'chirish — bitta hujjat: qayerdan, qayerga, pozitsiyalar. Mahsulot darhol qabul qiluvchi omborga tushadi.")}
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

          {/* Позиции */}
          <div>
            <p className="text-[10px] font-semibold tracking-wider uppercase mb-2" style={{ color: COLORS.textTertiary }}>{t("Позиции", "Pozitsiyalar")}</p>
            {lines.length > 0 && (
              <table className="w-full text-sm mb-3" data-testid="transfer-lines">
                <thead><tr>
                  <th style={thStyle}>{t("Товар", "Mahsulot")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Свободно", "Bo'sh")}</th>
                  <th style={{ ...thStyle, width: 140 }}>{t("Переместить", "Ko'chirish")}</th>
                  <th style={{ ...thStyle, width: 40 }} />
                </tr></thead>
                <tbody>
                  {lines.map(l => {
                    const over = Number(l.quantity) > l.available;
                    return (
                      <tr key={l.productId} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                        <td style={tdStyle}><span style={{ fontWeight: 600, color: COLORS.textPrimary }}>{l.name}</span></td>
                        <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", color: COLORS.textSecondary }}>{formatQty(l.available)} {unitShort(l.unit, lang)}</td>
                        <td style={tdStyle}>
                          <DecimalInput className="neo-input w-full font-data" value={l.quantity} placeholder="0"
                            style={over ? { borderColor: "var(--color-danger)" } : undefined}
                            onValueChange={v => setLines(ls => ls.map(x => x.productId === l.productId ? { ...x, quantity: v } : x))} />
                        </td>
                        <td style={tdStyle}>
                          <button type="button" className="btn-ghost tap" aria-label={t("Убрать", "Olib tashlash")} onClick={() => setLines(ls => ls.filter(x => x.productId !== l.productId))}>
                            <Trash2 size={14} style={{ color: COLORS.textTertiary }} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
              <Check size={16} /> {t("Провести", "O'tkazish")}{lines.length > 0 ? ` · ${lines.length}` : ""}
            </button>
            <button className="neo-btn tap flex items-center gap-2" onClick={() => { setOpen(false); setLines([]); setSearch(""); }}>
              <X size={16} /> {t("Отмена", "Bekor")}
            </button>
          </div>
        </div>
      )}

      {/* Застрявшие «в пути» — только если такие есть */}
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
                  <td style={tdStyle}>{nameOf.get(r.fromWarehouseId) ?? r.fromWarehouseId} → {nameOf.get(r.toWarehouseId) ?? r.toWarehouseId}</td>
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

      {/* История */}
      {listQ.isError ? (
        <SectionNotice kind="error" message={t("Не удалось загрузить перемещения", "Ko'chirishlarni yuklab bo'lmadi")} onRetry={() => listQ.refetch()} />
      ) : done.length === 0 ? (
        <SectionNotice kind="empty" message={t("Перемещений пока не было", "Hali ko'chirishlar bo'lmagan")} />
      ) : (
        <div className="neo-card p-0 overflow-hidden" data-testid="transfer-history">
          <div style={{ overflowX: "auto" }}>
            <table className="w-full text-sm">
              <thead><tr>
                <th style={thStyle}>{t("Дата", "Sana")}</th>
                <th style={thStyle}>{t("Откуда → куда", "Qayerdan → qayerga")}</th>
                <th style={thStyle}>{t("Товар", "Mahsulot")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("Кол-во", "Miqdor")}</th>
                <th style={thStyle}>{t("Примечание", "Izoh")}</th>
              </tr></thead>
              <tbody>
                {done.map(r => (
                  <tr key={r.id} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap", color: COLORS.textSecondary }}>{r.completedAt || r.createdAt ? format(new Date(r.completedAt ?? r.createdAt), "dd.MM.yyyy HH:mm") : ""}</td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                      {nameOf.get(r.fromWarehouseId) ?? r.fromWarehouseId} <ArrowRight size={12} style={{ display: "inline", verticalAlign: "middle", color: COLORS.textTertiary }} /> {nameOf.get(r.toWarehouseId) ?? r.toWarehouseId}
                    </td>
                    <td style={{ ...tdStyle, fontFamily: F.display, fontWeight: 600, color: COLORS.textPrimary }}>{r.productName}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatQty(r.quantity)}</td>
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
