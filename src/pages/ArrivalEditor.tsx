import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { format } from "date-fns";
import { ArrowLeft, Plus, Printer, ScanLine, Trash2, Loader2, CheckCircle2, Truck, ListChecks } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useCan } from "@/hooks/useCan";
import { useCurrency } from "@/hooks/useCurrency";
import { useSellerCompany } from "@/hooks/useSellerCompany";
import { notify } from "@/lib/toast";
import { formatQty } from "@/lib/format";
import { labelled, ARRIVAL_STATUS_LABEL } from "@/lib/entity-labels";
import { printArrivalReceipt, printLabels } from "@/lib/documents";
import { focusCell } from "@/lib/grid-nav";
import {
  type SheetRow, addProducts, applyScan, fillFromExpected, problems, rowsFromDetail, toPayload, totals,
} from "@/lib/arrival-sheet";
import { saveArrivalDraft, loadArrivalDraft, clearArrivalDraft, arrivalDraftHasWork, type ArrivalDraft } from "./Arrivals.draft";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { PremiumSelect } from "@/components/PremiumSelect";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { useConfirm } from "@/components/ConfirmDialog";
import { ArrivalSheet } from "@/components/arrivals/ArrivalSheet";
import { ProductMultiPicker, type PickerProduct } from "@/components/arrivals/ProductMultiPicker";
import { SupplierDebtSection } from "@/components/arrivals/SupplierDebtSection";

type Head = ArrivalDraft["form"];

const today = () => format(new Date(), "yyyy-MM-dd");
const emptyDraft = (): ArrivalDraft => ({
  form: { truckId: "", driverName: "", driverPhone: "", arrivalDate: today(), fuelCost: "0", tollCost: "0", otherCost: "0", notes: "" },
  supplierMode: "none", supplierId: 0, newSupplierName: "", supplyAmount: "", supplyCurrency: "UZS", supplyRate: "", supplyDueDate: "",
  rows: [],
});

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: wide ? "1 / -1" : undefined, minWidth: 0 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--color-text-tertiary)" }}>{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value, sub, tone, testId }: { label: string; value: string; sub?: string; tone?: "danger" | "warning"; testId?: string }) {
  return (
    <div className="neo-card neo-card-static" style={{ borderRadius: 16, padding: "12px 16px", minWidth: 0 }} data-testid={testId}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--color-text-tertiary)" }}>{label}</div>
      <div style={{
        fontSize: 20, fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        color: tone === "danger" ? "var(--color-danger-text)" : tone === "warning" ? "var(--color-warning-text)" : "var(--color-text-primary)",
      }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/**
 * Приход — рабочее место, а не окно поверх списка.
 *
 * Новый: шапка документа, товары пачкой, количества столбцом. Сохранённый:
 * тот же лист — пока приход не завершён, в него вписывают «сколько
 * пришло» при разгрузке, добавляют забытое, правят цены; завершённый
 * читается как документ, с печатью накладной и этикеток.
 */
export default function ArrivalEditor() {
  const { id } = useParams();
  const arrivalId = id && id !== "new" ? Number(id) : null;
  const isNew = arrivalId == null;
  const navigate = useNavigate();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { fmt, symbol, currency } = useCurrency();
  const { user } = useAuth();
  const can = useCan();
  const { company: seller } = useSellerCompany();
  const { confirm, dialog } = useConfirm();
  const utils = trpc.useUtils();

  const productsQ = trpc.product.list.useQuery({ page: 1, pageSize: 10000, includeAll: true });
  const suppliersQ = trpc.supplier.list.useQuery(undefined, { enabled: isNew });
  const detailQ = trpc.arrival.getById.useQuery({ id: arrivalId ?? 0 }, { enabled: !isNew });
  const supplyQ = trpc.supplier.getSupplyByArrival.useQuery({ arrivalId: arrivalId ?? 0 }, { enabled: !isNew });
  const detail = detailQ.data ?? null;

  /* Новый — черновик у браузера; сохранённый — правки поверх документа, пока их не сохранили. */
  const [draft, setDraft] = useState<ArrivalDraft>(() => (isNew && user ? loadArrivalDraft(user.id) : null) ?? emptyDraft());
  const [edit, setEdit] = useState<{ head: Head; rows: SheetRow[] } | null>(null);
  const base = useMemo(() => detail ? {
    head: {
      truckId: detail.truckId ?? "", driverName: detail.driverName ?? "", driverPhone: detail.driverPhone ?? "",
      arrivalDate: detail.arrivalDate ? format(new Date(detail.arrivalDate), "yyyy-MM-dd") : today(),
      fuelCost: String(Number(detail.fuelCost ?? 0)), tollCost: String(Number(detail.tollCost ?? 0)), otherCost: String(Number(detail.otherCost ?? 0)),
      notes: detail.notes ?? "",
    },
    rows: rowsFromDetail(detail.items),
  } : null, [detail]);

  useEffect(() => {
    if (!isNew || !user) return;
    if (arrivalDraftHasWork(draft)) saveArrivalDraft(user.id, draft); else clearArrivalDraft(user.id);
  }, [isNew, user, draft]);

  const catalog = useMemo(() => (productsQ.data?.data ?? []) as PickerProduct[], [productsQ.data]);
  const byId = useMemo(() => new Map(catalog.map(p => [p.id, p])), [catalog]);

  const head: Head = isNew ? draft.form : (edit?.head ?? base?.head ?? emptyDraft().form);
  const rawRows = useMemo(() => isNew ? draft.rows : (edit?.rows ?? base?.rows ?? []), [isNew, draft.rows, edit, base]);
  // Строки из черновика прежней формы приходят без названий — подставляются из каталога.
  const rows = useMemo(() => rawRows.map(r => {
    if (r.name) return r;
    const p = byId.get(r.productId);
    return p ? { ...r, name: p.name, code: p.code ?? "", packSize: Number(p.packSize ?? 0) || 0, packLabel: p.packLabel ?? "" } : r;
  }), [rawRows, byId]);

  const status = isNew ? "new" : detail?.status ?? "pending";
  const completed = status === "completed";
  const readOnly = completed || !can("suppliers.manage");
  const dirty = isNew ? arrivalDraftHasWork(draft) : edit != null;

  const setRows = (next: SheetRow[]) => isNew ? setDraft(d => ({ ...d, rows: next })) : setEdit(e => ({ head: e?.head ?? base!.head, rows: next }));
  const setHead = (patch: Partial<Head>) => isNew ? setDraft(d => ({ ...d, form: { ...d.form, ...patch } })) : setEdit(e => ({ rows: e?.rows ?? base!.rows, head: { ...(e?.head ?? base!.head), ...patch } }));

  const sum = totals(rows);
  const expense = Number(head.fuelCost || 0) + Number(head.tollCost || 0) + Number(head.otherCost || 0);
  const issues = problems(rows, head.arrivalDate);

  /* ── Товары: пачкой, сканером, «как по накладной» ─────────────────────── */
  const [picking, setPicking] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [wedge, setWedge] = useState("");

  const onPick = (picked: PickerProduct[]) => {
    const r = addProducts(rows, picked);
    setRows(r.rows);
    setPicking(false);
    notify.success(t(`Добавлено: ${r.added}`, `Qo'shildi: ${r.added}`));
    // Сразу на «Пришло» первой новой строки: дальше — число, Enter, число.
    const first = rows.length;
    setTimeout(() => focusCell("arrival", { row: first, col: "quantity" }), 50);
  };
  const onScanned = (code: string) => {
    const norm = code.trim().toLowerCase();
    const p = catalog.find(x => (x.barcode ?? "").toLowerCase() === norm || (x.code ?? "").toLowerCase() === norm);
    if (!p) {
      setLastScanned(t(`Не найден: ${code}`, `Topilmadi: ${code}`));
      notify.error(t(`Товар со штрих-кодом ${code} не найден`, `${code} shtrix-kodli mahsulot topilmadi`));
      return;
    }
    setRows(applyScan(rows, p));
    setLastScanned(p.name);
  };
  const fillAll = () => {
    const r = fillFromExpected(rows);
    setRows(r.rows);
    notify.info(r.filled > 0 ? t(`Заполнено строк: ${r.filled}`, `To'ldirilgan qatorlar: ${r.filled}`) : t("Нечего заполнять: «пришло» уже вписано или нет накладной", "To'ldiradigan narsa yo'q"));
  };

  /* ── Поставщик (только у нового: у сохранённого — блок долга ниже) ────── */
  const d = draft;
  const supplierValid = !isNew || d.supplierMode === "none" ||
    ((d.supplierMode === "existing" ? d.supplierId > 0 : d.newSupplierName.trim().length > 0)
      && Number(d.supplyAmount) > 0 && (d.supplyCurrency === "UZS" || Number(d.supplyRate) > 0));

  /* ── Сохранение ─────────────────────────────────────────────────────── */
  const createMutation = trpc.arrival.create.useMutation();
  const updateStatus = trpc.arrival.update.useMutation();
  const setItems = trpc.arrival.setItems.useMutation();
  const deleteMutation = trpc.arrival.delete.useMutation();
  const busy = createMutation.isPending || updateStatus.isPending || setItems.isPending || deleteMutation.isPending;

  const refresh = async () => {
    await Promise.all([utils.arrival.list.invalidate(), arrivalId ? utils.arrival.getById.invalidate({ id: arrivalId }) : Promise.resolve()]);
  };
  const guard = (): boolean => {
    if (issues.length > 0) {
      const p = issues[0];
      notify.error(`${t("Строка", "Qator")} ${p.row + 1}: ${p.message[lang === "uz" ? "uz" : "ru"]}`);
      return false;
    }
    if (!head.arrivalDate) { notify.error(t("Укажите дату прихода", "Kelish sanasini kiriting")); return false; }
    if (!supplierValid) { notify.error(t("Поставщик: укажите сумму долга (и курс для долларов)", "Yetkazib beruvchi: qarz summasini kiriting")); return false; }
    return true;
  };

  /** Новый: create, при «и завершить» — тот же update({status: completed}), что и «Завершить» в документе. */
  const saveNew = async (complete: boolean) => {
    if (!guard()) return;
    try {
      const r = await createMutation.mutateAsync({
        ...head,
        items: toPayload(rows),
        supplier: d.supplierMode === "none" ? undefined : {
          supplierId: d.supplierMode === "existing" ? d.supplierId : undefined,
          newSupplierName: d.supplierMode === "new" ? d.newSupplierName.trim() : undefined,
          amount: d.supplyAmount, currency: d.supplyCurrency,
          rateToUzs: d.supplyCurrency === "USD" ? d.supplyRate : undefined,
          dueDate: d.supplyDueDate || undefined,
        },
      });
      if (user) clearArrivalDraft(user.id);
      setDraft(emptyDraft());
      if (complete) await updateStatus.mutateAsync({ id: r.id, status: "completed" });
      await refresh();
      notify.success(complete ? t("Приход сохранён и завершён", "Kelish saqlandi va yakunlandi") : t("Приход сохранён", "Kelish saqlandi"));
      navigate(`/arrivals/${r.id}`, { replace: true });
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e));
    }
  };

  /** Сохранённый: строки целиком через setItems, шапка — update. Только изменённое. */
  const saveDoc = async (): Promise<boolean> => {
    if (!arrivalId || !base) return false;
    if (!guard()) return false;
    try {
      if (edit) {
        if (JSON.stringify(edit.rows) !== JSON.stringify(base.rows)) await setItems.mutateAsync({ id: arrivalId, items: toPayload(edit.rows) });
        const h = edit.head, b = base.head;
        if (h.truckId !== b.truckId || h.driverName !== b.driverName || h.driverPhone !== b.driverPhone || h.notes !== b.notes
          || h.fuelCost !== b.fuelCost || h.tollCost !== b.tollCost || h.otherCost !== b.otherCost) {
          await updateStatus.mutateAsync({ id: arrivalId, truckId: h.truckId, driverName: h.driverName, driverPhone: h.driverPhone, notes: h.notes, fuelCost: h.fuelCost || "0", tollCost: h.tollCost || "0", otherCost: h.otherCost || "0" });
        }
      }
      await refresh();
      setEdit(null);
      return true;
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  const complete = async () => {
    if (!arrivalId) return;
    // Ничего не посчитано — сервер откажет. Говорим сразу, а не после
    // подтверждения «на склад поступит 0 ед.».
    if (sum.units === 0) { notify.error(t("Ничего не посчитано: впишите «Пришло» хотя бы в одну строку", "Hech narsa sanalmagan: kamida bitta qatorga «Keldi» ni yozing")); return; }
    const warn: string[] = [];
    if (sum.notCounted > 0) warn.push(t(`${sum.notCounted} строк не посчитано — на склад не попадут.`, `${sum.notCounted} qator sanalmagan — omborga tushmaydi.`));
    if (sum.mismatches > 0) warn.push(t(`${sum.mismatches} расхождений с накладной.`, `Hujjat bilan ${sum.mismatches} ta farq.`));
    const ok = await confirm({
      title: t("Завершить приход?", "Kelish yakunlansinmi?"),
      message: [t(`На склад поступит ${formatQty(sum.units)} ед. по ${sum.positions - sum.notCounted} позициям. После завершения документ не правится.`, `Omborga ${formatQty(sum.units)} birlik tushadi. Yakunlangach hujjat o'zgartirilmaydi.`), ...warn].join(" "),
      confirmText: t("Завершить", "Yakunlash"),
    });
    if (!ok) return;
    if (dirty && !(await saveDoc())) return;
    try {
      await updateStatus.mutateAsync({ id: arrivalId, status: "completed" });
      await refresh();
      notify.success(t("Приход завершён — остаток обновлён", "Kelish yakunlandi — qoldiq yangilandi"));
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e));
    }
  };

  const startUnloading = async () => {
    if (!arrivalId) return;
    try { await updateStatus.mutateAsync({ id: arrivalId, status: "unloading" }); await refresh(); } catch (e) { notify.error(e instanceof Error ? e.message : String(e)); }
  };

  const remove = async () => {
    if (!arrivalId) return;
    const ok = await confirm({ title: t("Удалить приход?", "Kelish o'chirilsinmi?"), message: t("Данные будут удалены безвозвратно.", "Ma'lumotlar qaytarib bo'lmaydigan tarzda o'chiriladi."), confirmText: t("Удалить", "O'chirish"), danger: true });
    if (!ok) return;
    try { await deleteMutation.mutateAsync({ id: arrivalId }); await utils.arrival.list.invalidate(); navigate("/arrivals"); } catch (e) { notify.error(e instanceof Error ? e.message : String(e)); }
  };

  const discard = async () => {
    const ok = await confirm({ title: t("Отменить набранное?", "Kiritilganlar bekor qilinsinmi?"), message: t("Черновик будет стёрт.", "Qoralama o'chiriladi."), confirmText: t("Стереть", "O'chirish"), danger: true });
    if (!ok) return;
    if (isNew) { if (user) clearArrivalDraft(user.id); setDraft(emptyDraft()); } else setEdit(null);
  };

  /* ── Печать ─────────────────────────────────────────────────────────── */
  const printInvoice = () => printArrivalReceipt({
    number: detail?.arrivalNumber ?? t("черновик", "qoralama"),
    date: head.arrivalDate.split("-").reverse().join("."),
    supplier: { name: supplyQ.data?.supplierName ?? (isNew && d.supplierMode === "existing" ? suppliersQ.data?.find(s => s.id === d.supplierId)?.name : d.newSupplierName) ?? "—" },
    receiver: seller,
    items: rows.map(r => {
      const qty = Number(r.quantity || 0), price = Number(r.costPrice || 0);
      return { name: r.name, code: r.code, unit: r.unit, qty, price, total: Math.round(qty * price * 100) / 100, expectedQty: r.expected === "" ? null : Number(r.expected) };
    }),
    totalQty: sum.units,
    expenses: { fuel: Number(head.fuelCost || 0), toll: Number(head.tollCost || 0), other: Number(head.otherCost || 0), total: expense },
    notes: head.notes || undefined,
    currency: symbol,
  });
  const printTags = () => printLabels(rows.filter(r => Number(r.quantity) > 0).map(r => ({
    name: r.name, code: r.code, barcode: byId.get(r.productId)?.barcode ?? null,
    price: r.sellingPrice || "0", currency, count: Number(r.quantity),
  })));

  if (!isNew && detailQ.isError) return <QueryErrorFallback onRetry={() => detailQ.refetch()} />;
  if (!isNew && (detailQ.isLoading || !base)) {
    return <div style={{ display: "flex", justifyContent: "center", padding: 64 }}><Loader2 className="animate-spin" style={{ color: "var(--color-primary-text)" }} /></div>;
  }
  if (!isNew && !detail) return <p style={{ padding: 32, color: "var(--color-text-secondary)" }}>{t("Приход не найден", "Kelish topilmadi")}</p>;

  const statusColor = completed ? "var(--color-success-text)" : status === "unloading" ? "var(--color-info)" : "var(--color-warning-text)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1480 }}>
      {/* ── Заголовок и действия ───────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button className="neo-btn" onClick={() => navigate("/arrivals")} style={{ display: "flex", alignItems: "center", gap: 6 }} data-testid="arrival-back">
          <ArrowLeft size={15} />{t("Приходы", "Kelishlar")}
        </button>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--color-text-primary)", margin: 0, letterSpacing: "-0.02em" }}>
            {isNew ? t("Новый приход", "Yangi kelish") : detail!.arrivalNumber}
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2, flexWrap: "wrap" }}>
            {!isNew && <span style={{ fontWeight: 700, color: statusColor }} data-testid="arrival-status">● {labelled(ARRIVAL_STATUS_LABEL, status, lang)}</span>}
            {supplyQ.data?.supplierName && <span>{supplyQ.data.supplierName}</span>}
            {dirty && !isNew && <span style={{ color: "var(--color-warning-text)", fontWeight: 600 }}>{t("есть несохранённые правки", "saqlanmagan o'zgarishlar bor")}</span>}
          </div>
        </div>
        <span style={{ flex: 1 }} />
        {!isNew && (
          <>
            <button className="neo-btn" onClick={printInvoice} style={{ display: "flex", alignItems: "center", gap: 6 }} data-testid="arrival-print-invoice">
              <Printer size={14} />{t("Накладная", "Hujjat")}
            </button>
            {/* Сколько пришло — столько и наклеек: этикетки по приходу, а не по одной со страницы «Штрих-коды». */}
            <button className="neo-btn" onClick={printTags} style={{ display: "flex", alignItems: "center", gap: 6 }} data-testid="arrival-print-labels">
              <Printer size={14} />{t("Этикетки", "Yorliqlar")}
            </button>
          </>
        )}
        {!readOnly && !isNew && status === "pending" && (
          <button className="neo-btn" onClick={startUnloading} disabled={busy} style={{ display: "flex", alignItems: "center", gap: 6 }} data-testid="arrival-start-unloading">
            <Truck size={14} />{t("Начать разгрузку", "Tushirishni boshlash")}
          </button>
        )}
        {!readOnly && !isNew && (
          <>
            <button className="neo-btn text-danger" onClick={remove} disabled={busy} aria-label={t("Удалить", "O'chirish")} data-testid="arrival-delete"><Trash2 size={14} /></button>
            {dirty && <button className="neo-btn" onClick={discard} disabled={busy}>{t("Отменить правки", "Bekor qilish")}</button>}
            {dirty && <button className="neo-btn" onClick={() => void saveDoc().then(ok => ok && notify.success(t("Сохранено", "Saqlandi")))} disabled={busy} data-testid="arrival-save">{t("Сохранить", "Saqlash")}</button>}
            <button className="neo-btn-primary" onClick={complete} disabled={busy} style={{ display: "flex", alignItems: "center", gap: 6 }} data-testid="arrival-complete">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}{t("Завершить приход", "Kelishni yakunlash")}
            </button>
          </>
        )}
      </div>

      {/* ── Сводка: то, ради чего открывают документ ───────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <Stat label={t("Позиций", "Pozitsiyalar")} value={String(sum.positions)} sub={sum.notCounted > 0 ? t(`не посчитано: ${sum.notCounted}`, `sanalmagan: ${sum.notCounted}`) : undefined} tone={sum.notCounted > 0 ? "warning" : undefined} testId="arrival-stat-positions" />
        <Stat label={t("Пришло, ед.", "Keldi, birlik")} value={formatQty(sum.units)} sub={sum.expectedUnits > 0 ? t(`по накладной ${formatQty(sum.expectedUnits)}`, `hujjatda ${formatQty(sum.expectedUnits)}`) : undefined} />
        <Stat label={t("Расхождений", "Farqlar")} value={String(sum.mismatches)} tone={sum.mismatches > 0 ? "danger" : undefined} testId="arrival-stat-mismatches" />
        <Stat label={t("Закупка", "Xarid")} value={fmt(sum.costSum)} sub={expense > 0 ? t(`+ доставка ${fmt(expense)}`, `+ yetkazish ${fmt(expense)}`) : undefined} testId="arrival-stat-cost" />
        <Stat label={t("В ценах продажи", "Sotuv narxida")} value={fmt(sum.saleSum)} sub={sum.costSum > 0 && sum.saleSum > 0 ? t(`наценка ${Math.round((sum.saleSum / sum.costSum - 1) * 1000) / 10}%`, `ustama ${Math.round((sum.saleSum / sum.costSum - 1) * 1000) / 10}%`) : undefined} />
        {sum.weightKg > 0 && <Stat label={t("Вес", "Og'irlik")} value={`${formatQty(sum.weightKg)} ${t("кг", "kg")}`} />}
      </div>

      {/* ── Шапка документа ────────────────────────────────────────────── */}
      <div className="neo-card neo-card-static" style={{ borderRadius: 20, padding: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
          <Field label={t("Дата прихода", "Kelish sanasi")}>
            <input type="date" className="neo-input" value={head.arrivalDate} disabled={!isNew} onChange={e => setHead({ arrivalDate: e.target.value })} data-testid="arrival-date" />
          </Field>
          {isNew && (
            <Field label={t("Поставщик", "Yetkazib beruvchi")}>
              <PremiumSelect
                value={d.supplierMode === "none" ? "0" : d.supplierMode === "new" ? "new" : String(d.supplierId)}
                onChange={v => setDraft(x => v === "0" ? { ...x, supplierMode: "none", supplierId: 0 } : v === "new" ? { ...x, supplierMode: "new", supplierId: 0 } : { ...x, supplierMode: "existing", supplierId: Number(v) })}
                options={[
                  { value: "0", label: t("Без поставщика", "Yetkazib beruvchisiz") },
                  ...(suppliersQ.data ?? []).map(sp => ({ value: String(sp.id), label: sp.name })),
                  { value: "new", label: t("+ Новый поставщик…", "+ Yangi yetkazib beruvchi…") },
                ]}
                width="100%"
              />
            </Field>
          )}
          <Field label={t("Машина", "Mashina")}><input className="neo-input" disabled={readOnly} value={head.truckId} onChange={e => setHead({ truckId: e.target.value })} placeholder="01 A 123 BC" /></Field>
          <Field label={t("Водитель", "Haydovchi")}><input className="neo-input" disabled={readOnly} value={head.driverName} onChange={e => setHead({ driverName: e.target.value })} /></Field>
          <Field label={t("Телефон водителя", "Haydovchi telefoni")}><input className="neo-input" disabled={readOnly} value={head.driverPhone} onChange={e => setHead({ driverPhone: e.target.value })} /></Field>
          <Field label={t("Топливо", "Yoqilg'i")}><DecimalInput className="neo-input" disabled={readOnly} style={{ textAlign: "right" }} value={head.fuelCost} onValueChange={v => setHead({ fuelCost: v })} /></Field>
          <Field label={t("Дорога", "Yo'l")}><DecimalInput className="neo-input" disabled={readOnly} style={{ textAlign: "right" }} value={head.tollCost} onValueChange={v => setHead({ tollCost: v })} /></Field>
          <Field label={t("Прочие расходы", "Boshqa xarajatlar")}><DecimalInput className="neo-input" disabled={readOnly} style={{ textAlign: "right" }} value={head.otherCost} onValueChange={v => setHead({ otherCost: v })} /></Field>
        </div>

        {/* Поставщик и долг — там, где рождается обязательство перед заводом. */}
        {isNew && d.supplierMode !== "none" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--color-border)" }}>
            {d.supplierMode === "new" && (
              <Field label={t("Название поставщика", "Yetkazib beruvchi nomi")}>
                <input className="neo-input" value={d.newSupplierName} onChange={e => setDraft(x => ({ ...x, newSupplierName: e.target.value }))} />
              </Field>
            )}
            <Field label={t("Долг поставщику", "Yetkazib beruvchiga qarz")}>
              <div style={{ display: "flex", gap: 6 }}>
                <DecimalInput className="neo-input" style={{ textAlign: "right" }} value={d.supplyAmount} placeholder={sum.costSum > 0 ? String(sum.costSum) : "0"}
                  onValueChange={v => setDraft(x => ({ ...x, supplyAmount: v }))} data-testid="arrival-supply-amount" />
                {sum.costSum > 0 && d.supplyCurrency === "UZS" && (
                  <button className="neo-btn" type="button" title={t("Взять сумму закупки из листа", "Xarid summasini olish")}
                    onClick={() => setDraft(x => ({ ...x, supplyAmount: String(sum.costSum) }))} data-testid="arrival-supply-from-sheet">=</button>
                )}
              </div>
            </Field>
            <Field label={t("Валюта", "Valyuta")}>
              <PremiumSelect value={d.supplyCurrency} onChange={v => setDraft(x => ({ ...x, supplyCurrency: v as "UZS" | "USD" }))} options={[{ value: "UZS", label: "UZS" }, { value: "USD", label: "USD" }]} width="100%" />
            </Field>
            {d.supplyCurrency === "USD" && (
              <Field label={t("Курс, сум за $1", "Kurs, 1$ uchun so'm")}>
                <DecimalInput className="neo-input" style={{ textAlign: "right" }} value={d.supplyRate} onValueChange={v => setDraft(x => ({ ...x, supplyRate: v }))} />
              </Field>
            )}
            <Field label={t("Срок оплаты", "To'lov muddati")}>
              <input type="date" className="neo-input" value={d.supplyDueDate} onChange={e => setDraft(x => ({ ...x, supplyDueDate: e.target.value }))} />
            </Field>
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <Field label={t("Примечание", "Izoh")} wide>
            <input className="neo-input" disabled={readOnly} value={head.notes} onChange={e => setHead({ notes: e.target.value })} placeholder={t("Номер накладной поставщика, замечания", "Yetkazib beruvchi hujjati raqami, izohlar")} />
          </Field>
        </div>
      </div>

      {/* ── Товары ─────────────────────────────────────────────────────── */}
      {!readOnly && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="neo-btn-primary" onClick={() => setPicking(true)} style={{ display: "flex", alignItems: "center", gap: 6 }} data-testid="arrival-add-products">
            <Plus size={15} />{t("Добавить товары", "Mahsulot qo'shish")}
          </button>
          <input className="neo-input" style={{ width: 200, padding: "8px 14px" }} placeholder={t("Штрих-код + Enter", "Shtrix-kod + Enter")}
            value={wedge} onChange={e => setWedge(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && wedge.trim()) { e.preventDefault(); onScanned(wedge); setWedge(""); } }}
            data-testid="arrival-wedge" />
          <button className="neo-btn" onClick={() => { setLastScanned(null); setScanning(true); }} style={{ display: "flex", alignItems: "center", gap: 6 }} data-testid="arrival-scan">
            <ScanLine size={14} />{t("Сканер", "Skaner")}
          </button>
          {rows.some(r => r.expected !== "" && r.quantity === "") && (
            <button className="neo-btn" onClick={fillAll} style={{ display: "flex", alignItems: "center", gap: 6 }} data-testid="arrival-fill-expected">
              <ListChecks size={14} />{t("Пришло = по накладной", "Keldi = hujjat bo'yicha")}
            </button>
          )}
          <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
            {t("Enter — вниз по столбцу; столбец из Excel вставляется целиком", "Enter — ustun bo'yicha pastga; Excel ustuni to'liq qo'yiladi")}
          </span>
        </div>
      )}

      <ArrivalSheet rows={rows} onChange={setRows} readOnly={readOnly} arrivalDate={head.arrivalDate} onAddClick={() => setPicking(true)} />

      {!isNew && arrivalId && <SupplierDebtSection arrivalId={arrivalId} />}

      {/* ── Сохранение нового ──────────────────────────────────────────── */}
      {isNew && (
        <div className="neo-card neo-card-static" style={{ borderRadius: 20, padding: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", position: "sticky", bottom: 12, zIndex: 5 }}>
          {/* «Сохранить» заводит приход ожидающим: остаток не трогается, пока его не завершат.
              Строки без «пришло» можно сохранить по накладной и досчитать при разгрузке. */}
          <p className="text-xs" style={{ color: "var(--color-text-tertiary)", margin: 0, flex: "1 1 260px" }}>
            {t("Остаток на складе изменится после завершения прихода.", "Ombordagi qoldiq kelish yakunlangandan keyin o'zgaradi.")}
          </p>
          <button className="neo-btn" onClick={discard} disabled={busy || !dirty}>{t("Отмена", "Bekor qilish")}</button>
          <button className="neo-btn" onClick={() => void saveNew(false)} disabled={busy || !supplierValid} data-testid="arrival-save-new">
            {t("Сохранить", "Saqlash")}
          </button>
          <button className="neo-btn-primary" onClick={() => void saveNew(true)} disabled={busy || !supplierValid || sum.units === 0} style={{ display: "flex", alignItems: "center", gap: 6 }} data-testid="arrival-save-complete">
            {busy && <Loader2 size={14} className="animate-spin" />}{t("Сохранить и завершить", "Saqlash va yakunlash")}
          </button>
        </div>
      )}

      {picking && (
        <ProductMultiPicker open onClose={() => setPicking(false)} products={catalog} already={new Set(rows.map(r => r.productId))} onPick={onPick} />
      )}
      {scanning && (
        <BarcodeScanner
          continuous
          lastResult={lastScanned}
          onScan={onScanned}
          onClose={() => setScanning(false)}
          label={t("Сканируйте товары — каждый код добавляет единицу", "Mahsulotlarni skanerlang — har bir kod bittadan qo'shadi")}
        />
      )}
      {dialog}
    </div>
  );
}
