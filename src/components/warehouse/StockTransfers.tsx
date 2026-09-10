import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useConfirm } from "@/components/ConfirmDialog";
import { PremiumSelect } from "@/components/PremiumSelect";
import { SectionNotice } from "@/components/SectionNotice";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { notify } from "@/lib/toast";
import { formatQty } from "@/lib/format";
import { F, COLORS, thStyle, tdStyle } from "@/components/users/types";
import { format } from "date-fns";
import { ArrowRight, Check, Plus, Truck } from "lucide-react";

/**
 * Перемещения товара между складами.
 *
 * ── Зачем появилось ─────────────────────────────────────────────────────────
 *
 * Сервер это умел давно: три ручки — завести перемещение, посмотреть список,
 * провести — и всё с блокировками, проверкой чужих складов и защитой от
 * двойного проведения. Кнопки не было НИ ОДНОЙ: попасть в них было нельзя ни с
 * одного экрана, ни из мобилки.
 *
 * ── Два шага, а не один ─────────────────────────────────────────────────────
 *
 * Перемещение заводят и проводят раздельно, и это не бюрократия: между
 * складами товар ЕДЕТ. Пока он в пути, на складе-отправителе его уже нет, а на
 * получателе ещё нет — и списывать с одного, зачисляя на другой, одним
 * движением значило бы соврать в обе стороны.
 *
 * Поэтому «заведено» ничего не двигает: это намерение. Двигает «проведено» —
 * когда товар доехал и его приняли.
 *
 * ── Чего здесь намеренно нет ────────────────────────────────────────────────
 *
 * Отмены заведённого перемещения: такой ручки на сервере не существует.
 * Заведённое ничего не держит и не двигает, поэтому лишняя строка — это
 * мусор в списке, а не потерянный товар. Отмену стоит добавить, но это правка
 * сервера, а не экрана.
 */

type Warehouse = { id: number; name: string; isDefault?: boolean | null };

export function StockTransfers({ warehouses }: { warehouses: Warehouse[] }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { confirm, dialog } = useConfirm();
  const utils = trpc.useUtils();

  const [status, setStatus] = useState<"pending" | "completed" | "all">("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ from: "", to: "", productId: "", quantity: "", notes: "" });

  const listQ = trpc.warehouseMulti.listTransfers.useQuery({ status, limit: 50 });

  /*
    Товары ищутся по названию, а не выбираются из полного списка: справочник у
    арендатора — тысячи строк, и выпадающий список из них бесполезен.
  */
  const [search, setSearch] = useState("");
  const productsQ = trpc.product.list.useQuery(
    { page: 1, pageSize: 20, search: search || undefined },
    { enabled: open && search.length >= 2 },
  );

  const nameOf = useMemo(
    () => new Map(warehouses.map(w => [w.id, w.name])),
    [warehouses],
  );

  const create = trpc.warehouseMulti.createTransfer.useMutation({
    onSuccess: () => {
      notify.success(t("Перемещение заведено", "Ko'chirish yaratildi"));
      utils.warehouseMulti.listTransfers.invalidate();
      setOpen(false);
      setForm({ from: "", to: "", productId: "", quantity: "", notes: "" });
      setSearch("");
    },
    onError: e => notify.error(e.message),
  });

  const complete = trpc.warehouseMulti.completeTransfer.useMutation({
    onSuccess: () => {
      notify.success(t("Перемещение проведено", "Ko'chirish o'tkazildi"));
      utils.warehouseMulti.listTransfers.invalidate();
      // Остаток изменился на обоих складах — таблица товаров обязана это
      // показать, иначе человек видит старые числа и заводит второе
      // перемещение того же товара.
      utils.warehouseMulti.getStock.invalidate();
    },
    onError: e => notify.error(e.message),
  });

  const submit = () => {
    const from = Number(form.from);
    const to = Number(form.to);
    const productId = Number(form.productId);
    const quantity = Number(form.quantity);
    /*
      Отказы здесь дублируют серверные нарочно: сервер ответит тем же, но
      человек узнает об этом после запроса и общей фразой. Пустое поле лучше
      назвать сразу и по имени.
    */
    if (!from || !to) return notify.error(t("Выберите оба склада", "Ikkala omborni tanlang"));
    if (from === to) return notify.error(t("Склад отправителя и получателя совпадают", "Jo'natuvchi va qabul qiluvchi bir xil"));
    if (!productId) return notify.error(t("Выберите товар", "Mahsulotni tanlang"));
    if (!(quantity > 0)) return notify.error(t("Укажите количество", "Miqdorni kiriting"));
    create.mutate({ fromWarehouseId: from, toWarehouseId: to, productId, quantity, notes: form.notes || undefined });
  };

  const onComplete = async (id: number, productName: string, qty: string) => {
    const ok = await confirm({
      title: t("Провести перемещение?", "Ko'chirish o'tkazilsinmi?"),
      message: t(
        `${productName}, ${formatQty(qty)}: товар спишется с одного склада и зачислится на другой. Отменить нельзя.`,
        `${productName}, ${formatQty(qty)}: mahsulot bir ombordan chiqib, boshqasiga kiradi. Bekor qilib bo'lmaydi.`,
      ),
      confirmText: t("Провести", "O'tkazish"),
    });
    if (ok) complete.mutate({ transferId: id });
  };

  const rows = listQ.data ?? [];
  const options = warehouses.map(w => ({ value: String(w.id), label: w.name }));

  if (warehouses.length < 2) {
    /*
      Один склад — перемещать некуда, и форма из двух одинаковых списков это
      только запутывает. Говорим прямо, что нужно сделать.
    */
    return (
      <SectionNotice
        kind="empty"
        message={t(
          "Перемещения возможны, когда складов больше одного. Второй склад заводят в настройках.",
          "Ko'chirish uchun kamida ikkita ombor kerak. Ikkinchisini sozlamalarda qo'shing.",
        )}
      />
    );
  }

  return (
    <div className="space-y-4">
      {dialog}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 700, color: COLORS.textPrimary }}>
            {t("Перемещения между складами", "Omborlar orasida ko'chirish")}
          </h3>
          <p style={{ fontSize: "13px", color: COLORS.textSecondary }}>
            {t("Заводят — товар едет; проводят — когда доехал", "Yaratiladi — mahsulot yo'lda; o'tkaziladi — yetib kelganda")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PremiumSelect
            value={status}
            onChange={v => setStatus(v as "pending" | "completed" | "all")}
            options={[
              { value: "all", label: t("все", "hammasi") },
              { value: "pending", label: t("в пути", "yo'lda") },
              { value: "completed", label: t("проведённые", "o'tkazilgan") },
            ]}
          />
          <button className="neo-btn-primary" onClick={() => setOpen(o => !o)}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Plus size={15} />{t("Переместить", "Ko'chirish")}
          </button>
        </div>
      </div>

      {open && (
        <div className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "18px" }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>{t("Откуда", "Qayerdan")}</span>
              <PremiumSelect value={form.from} onChange={v => setForm(f => ({ ...f, from: v }))} options={options} />
            </label>
            <label className="space-y-1">
              <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>{t("Куда", "Qayerga")}</span>
              <PremiumSelect value={form.to} onChange={v => setForm(f => ({ ...f, to: v }))} options={options} />
            </label>
          </div>

          <div className="mt-3 space-y-1">
            <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>{t("Товар", "Mahsulot")}</span>
            <input
              className="neo-input w-full"
              placeholder={t("Название или код — не меньше двух букв", "Nomi yoki kodi — kamida ikki harf")}
              value={search}
              onChange={e => { setSearch(e.target.value); setForm(f => ({ ...f, productId: "" })); }}
            />
            {form.productId ? (
              <div style={{ fontSize: "13px", color: COLORS.textPrimary }}>
                {t("Выбран", "Tanlandi")}: <b>{productsQ.data?.data?.find(p => p.id === Number(form.productId))?.name ?? form.productId}</b>
              </div>
            ) : search.length >= 2 && (productsQ.data?.data?.length ?? 0) > 0 ? (
              <div className="max-h-40 overflow-y-auto space-y-1">
                {productsQ.data!.data.map(p => (
                  <button key={p.id} className="neo-btn w-full text-left"
                    style={{ fontSize: "13px", padding: "6px 10px" }}
                    onClick={() => setForm(f => ({ ...f, productId: String(p.id) }))}>
                    {p.name} <span style={{ color: COLORS.textTertiary }}>· {p.code}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 mt-3">
            <label className="space-y-1">
              <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>{t("Количество", "Miqdori")}</span>
              <DecimalInput
                className="neo-input w-full"
                value={form.quantity}
                onValueChange={v => setForm(f => ({ ...f, quantity: v }))}
              />
            </label>
            <label className="space-y-1">
              <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>{t("Примечание", "Izoh")}</span>
              <input className="neo-input w-full" maxLength={500}
                value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </label>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <button className="neo-btn" onClick={() => setOpen(false)}>{t("Отмена", "Bekor")}</button>
            <button className="neo-btn-primary" disabled={create.isPending} onClick={submit}>
              {t("Завести", "Yaratish")}
            </button>
          </div>
        </div>
      )}

      {listQ.isLoadingError ? (
        <SectionNotice kind="error" message={t("Не удалось загрузить перемещения", "Ko'chirishlarni yuklab bo'lmadi")} onRetry={() => listQ.refetch()} />
      ) : listQ.isLoading ? (
        <div className="space-y-2">{[1, 2].map(i => <div key={i} className="h-12 bg-surface-light animate-pulse rounded-xl" />)}</div>
      ) : rows.length === 0 ? (
        <SectionNotice kind="empty" message={t("Перемещений нет", "Ko'chirishlar yo'q")} />
      ) : (
        <>
          <div className="hidden lg:block overflow-x-auto">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("Товар", "Mahsulot")}</th>
                  <th style={thStyle}>{t("Маршрут", "Yo'nalish")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Количество", "Miqdori")}</th>
                  <th style={thStyle}>{t("Состояние", "Holat")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Действие", "Amal")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{r.productName}</div>
                      <div style={{ fontSize: "12px", color: COLORS.textTertiary }}>
                        {r.createdAt ? format(new Date(r.createdAt), "dd.MM.yyyy") : ""}
                        {r.notes ? ` · ${r.notes}` : ""}
                      </div>
                    </td>
                    <td style={{ ...tdStyle, color: COLORS.textSecondary }}>
                      <span className="inline-flex items-center gap-1.5">
                        {nameOf.get(r.fromWarehouseId) ?? `№${r.fromWarehouseId}`}
                        <ArrowRight size={13} />
                        {nameOf.get(r.toWarehouseId) ?? `№${r.toWarehouseId}`}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {formatQty(r.quantity)}
                    </td>
                    <td style={tdStyle}>
                      <span className={`inline-flex px-2 py-1 rounded-lg border text-xs font-semibold ${
                        r.status === "completed"
                          ? "bg-success/15 text-success border-success/30"
                          : "bg-warning/15 text-warning border-warning/30"
                      }`}>
                        {r.status === "completed" ? t("проведено", "o'tkazildi") : t("в пути", "yo'lda")}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      {r.status === "pending" ? (
                        <button className="neo-btn-primary" disabled={complete.isPending}
                          onClick={() => onComplete(r.id, r.productName, r.quantity)}
                          style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "13px" }}>
                          <Check size={14} />{t("Провести", "O'tkazish")}
                        </button>
                      ) : (
                        <span style={{ fontSize: "12px", color: COLORS.textTertiary }}>
                          {r.completedAt ? format(new Date(r.completedAt), "dd.MM.yyyy") : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="lg:hidden space-y-2">
            {rows.map(r => (
              <div key={r.id} className="neo-card-sm" style={{ borderRadius: "16px", padding: "14px" }}>
                <div className="flex items-start justify-between gap-2">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: F.display, fontWeight: 600, color: COLORS.textPrimary }}>{r.productName}</div>
                    <div style={{ fontSize: "12px", color: COLORS.textTertiary }}>
                      {nameOf.get(r.fromWarehouseId) ?? `№${r.fromWarehouseId}`} → {nameOf.get(r.toWarehouseId) ?? `№${r.toWarehouseId}`}
                    </div>
                  </div>
                  <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, color: COLORS.textPrimary }}>
                    {formatQty(r.quantity)}
                  </span>
                </div>
                {r.status === "pending" && (
                  <button className="neo-btn-primary w-full mt-3" disabled={complete.isPending}
                    onClick={() => onComplete(r.id, r.productName, r.quantity)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                    <Check size={15} />{t("Провести", "O'tkazish")}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export const TransfersIcon = Truck;
