import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import type { inferRouterOutputs } from "@trpc/server";
import {
  ArrowLeft, Plus, Trash2, Loader2, Send, CheckCircle2, Undo2, Truck, XCircle, Save, Printer, FileDown, Clock, RefreshCw,
} from "lucide-react";
import type { AppRouter } from "../../api/router";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useCan } from "@/hooks/useCan";
import { useLeaveGuard } from "@/hooks/useLeaveGuard";
import { useSellerCompany } from "@/hooks/useSellerCompany";
import { notify } from "@/lib/toast";
import { errorText } from "@/lib/error-text";
import { formatQty } from "@/lib/format";
import { bizDateText } from "@/lib/business-time";
import { labelled, ARRIVAL_STATUS_LABEL } from "@/lib/entity-labels";
import { printPurchaseOrder } from "@/lib/documents";
import { exportToExcel, formatPurchaseOrderLinesForExport } from "@/lib/excel";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { AppModal, modalFieldLabel } from "@/components/ui/AppModal";
import { PremiumSelect } from "@/components/PremiumSelect";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { useConfirm } from "@/components/ConfirmDialog";
import { ProductMultiPicker, type PickerProduct } from "@/components/arrivals/ProductMultiPicker";
import { F, COLORS, SHADOW, money } from "@/components/counterparties/constants";
import { PurchaseOrderStatusBadge } from "@/components/purchase-orders/PurchaseOrderStatusBadge";
import { dayText } from "@/components/purchase-orders/day-text";

type Order = inferRouterOutputs<AppRouter>["purchaseOrder"]["getById"];

interface Head {
  supplierId: string;
  warehouseId: string;
  currency: "UZS" | "USD";
  rateToUzs: string;
  /** Пусто — как у поставщика. */
  paymentTermsDays: string;
  expectedDate: string;
  notes: string;
}

interface Line { productId: number; name: string; code: string; quantity: string; unitPrice: string }

/** Заказ правят, пока по нему ничего не принято; правка согласованного — снова черновик. */
const EDITABLE = new Set(["draft", "pending_approval", "approved"]);

/**
 * Заказ поставщику: новый (/purchase-orders/new) или заведённый.
 *
 * Путь целиком: завести заказ, отправить директору, согласовать или вернуть
 * с замечанием, принять товар приходом (экран сразу открывает приход),
 * закрыть остаток или отменить; напечатать и выгрузить в Excel. Долг по
 * заказу рождается только при проведении прихода (ADR 0013) — на этом
 * экране денег поставщику нет, только сумма заказа.
 *
 * Версия на экране. Заказ меняется и без этого экрана: проведённый приход
 * двигает «принято» (живое событие arrival.completed перечитывает заказы),
 * директор согласует из соседней вкладки. Без правок экран показывает новую
 * версию сразу — у формы новый ключ. С правками набранное не пропадает:
 * экран держит версию, с которой начали, и говорит, что заказ изменился;
 * сохранить поверх всё равно не даст сервер (версия документа).
 */
export default function PurchaseOrderEditor() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const orderId = isNew ? 0 : Number(id);
  const detailQ = trpc.purchaseOrder.getById.useQuery({ id: orderId }, { enabled: !isNew && orderId > 0 });
  const [pinned, setPinned] = useState<Order | null>(null);
  // «Отменить правки» на той же версии — форма собирается заново.
  const [reset, setReset] = useState(0);

  if (!isNew && detailQ.isLoadingError) return <QueryErrorFallback onRetry={detailQ.refetch} />;
  if (!isNew && !detailQ.data) {
    return <div style={{ padding: "40px", display: "flex", justifyContent: "center" }}><Loader2 className="animate-spin" size={24} /></div>;
  }
  const latest = isNew ? null : detailQ.data!;
  const order = isNew ? null : (pinned ?? latest);
  const stale = pinned != null && latest != null && String(latest.updatedAt) !== String(pinned.updatedAt);
  return (
    <OrderScreen
      key={order ? `${order.id}:${String(order.updatedAt)}:${reset}` : `new:${reset}`}
      order={order}
      stale={stale}
      onDirty={d => setPinned(d && latest ? (p => p ?? latest) : null)}
      onDiscard={() => { setPinned(null); setReset(n => n + 1); }}
    />
  );
}

function OrderScreen({ order, stale, onDirty, onDiscard }: {
  order: Order | null;
  /** Заказ изменили, пока здесь правили: сохранить поверх нельзя. */
  stale: boolean;
  /** Правки появились (true) или их больше нет (false): держать ли версию. */
  onDirty: (dirty: boolean) => void;
  onDiscard: () => void;
}) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const can = useCan();
  const { confirm, dialog } = useConfirm();
  const { company: seller } = useSellerCompany();

  const isCeo = user?.role === "ceo";
  const canManage = can("suppliers.manage");
  const status = order?.status ?? "draft";
  // Непроведённый приход по заказу: пока он есть, заказ не правят, не
  // возвращают и не отменяют — сервер откажет, так что и кнопок нет.
  const openArrival = order?.arrivals.find(a => a.status !== "completed") ?? null;
  const editable = canManage && (!order || (EDITABLE.has(status) && !openArrival));

  const suppliersQ = trpc.supplier.list.useQuery(undefined, { enabled: editable });
  const warehousesQ = trpc.warehouseMulti.list.useQuery(undefined, { enabled: editable });
  const productsQ = trpc.product.list.useQuery({ page: 1, pageSize: 10000, includeAll: true }, { enabled: editable });
  const catalog = useMemo(() => (productsQ.data?.data ?? []) as PickerProduct[], [productsQ.data]);

  const [head, setHead] = useState<Head>(() => order ? {
    supplierId: String(order.supplierId),
    warehouseId: String(order.warehouseId),
    currency: order.currency,
    rateToUzs: order.rateToUzs ? String(Number(order.rateToUzs)) : "",
    paymentTermsDays: order.paymentTermsDays == null ? "" : String(order.paymentTermsDays),
    expectedDate: order.expectedDate ?? "",
    notes: order.notes ?? "",
  } : {
    // «Новый заказ» из карточки контрагента приходит с поставщиком в адресе.
    supplierId: /^\d+$/.test(params.get("supplierId") ?? "") ? String(params.get("supplierId")) : "",
    warehouseId: "", currency: "UZS", rateToUzs: "", paymentTermsDays: "", expectedDate: "", notes: "",
  });
  const [lines, setLines] = useState<Line[]>(() => (order?.items ?? []).map(i => ({
    productId: i.productId, name: i.productName, code: i.productCode ?? "",
    quantity: String(i.quantity), unitPrice: String(i.unitPrice),
  })));
  const [dirty, setDirtyState] = useState(false);
  const [picking, setPicking] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState("");

  const markDirty = () => { if (!dirty) { setDirtyState(true); onDirty(true); } };
  const setH = <K extends keyof Head>(k: K, v: Head[K]) => { setHead(h => ({ ...h, [k]: v })); markDirty(); };
  const setLine = (productId: number, patch: Partial<Line>) => {
    setLines(ls => ls.map(l => (l.productId === productId ? { ...l, ...patch } : l)));
    markDirty();
  };

  /*
    Уход с несохранёнными правками — спросить (hooks/useLeaveGuard): заказ на
    тридцать позиций набирают руками, и «← Заказы поставщикам» или пункт меню
    стирали его молча.
  */
  useLeaveGuard(dirty ? () => confirm({
    title: t("Уйти без сохранения?", "Saqlamasdan chiqilsinmi?"),
    message: t("Несохранённые правки заказа пропадут.", "Buyurtmadagi saqlanmagan o'zgarishlar yo'qoladi."),
    confirmText: t("Уйти", "Chiqish"), danger: true,
  }) : null);

  const onError = (e: unknown) => notify.error(errorText(e));
  const refresh = () => { void utils.purchaseOrder.getById.invalidate(); void utils.purchaseOrder.list.invalidate(); };
  // Директор согласовывал версию, которую уже поменяли: сервер отказал —
  // экран перечитывает заказ, чтобы было видно, что именно поменяли.
  const onDecisionError = (e: unknown) => {
    notify.error(errorText(e));
    if ((e as { data?: { code?: string } }).data?.code === "CONFLICT") refresh();
  };
  const saved = () => { setDirtyState(false); onDirty(false); };
  const create = trpc.purchaseOrder.create.useMutation({
    onSuccess: r => {
      notify.success(t(`Заказ ${r.number} сохранён`, `${r.number} buyurtma saqlandi`));
      saved();
      void utils.purchaseOrder.list.invalidate();
      navigate(`/purchase-orders/${r.id}`, { replace: true });
    },
    onError,
  });
  const update = trpc.purchaseOrder.update.useMutation({ onSuccess: () => { notify.success(t("Заказ сохранён", "Buyurtma saqlandi")); saved(); refresh(); }, onError });
  const submit = trpc.purchaseOrder.submit.useMutation({ onSuccess: () => { notify.success(t("Заказ отправлен директору", "Buyurtma direktorga yuborildi")); refresh(); }, onError });
  const approve = trpc.purchaseOrder.approve.useMutation({ onSuccess: () => { notify.success(t("Заказ согласован", "Buyurtma kelishildi")); refresh(); }, onError: onDecisionError });
  const reject = trpc.purchaseOrder.reject.useMutation({ onSuccess: () => { notify.success(t("Заказ возвращён на доработку", "Buyurtma qayta ishlashga qaytarildi")); setRejecting(false); refresh(); }, onError: onDecisionError });
  const cancel = trpc.purchaseOrder.cancel.useMutation({ onSuccess: () => { notify.success(t("Готово", "Tayyor")); refresh(); }, onError });
  const receive = trpc.purchaseOrder.receive.useMutation({
    onSuccess: r => { notify.success(t(`Заведён приход ${r.arrivalNumber}`, `${r.arrivalNumber} kirimi yaratildi`)); refresh(); navigate(`/arrivals/${r.arrivalId}`); },
    onError,
  });
  const busy = create.isPending || update.isPending || submit.isPending || approve.isPending || reject.isPending || cancel.isPending || receive.isPending;

  const total = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unitPrice || 0), 0);
  /*
    Строки без цены. Черновик с ними сохраняется («цену ещё не знают» — так
    его заводит «Дозаказ»), а отправить и согласовать нельзя: по цене заказа
    приёмка считает долг поставщику, и сервер такой заказ не пропустит.
  */
  const unpriced = lines.filter(l => !(Number(l.unitPrice) > 0)).map(l => l.name);
  const savedUnpriced = (order?.items ?? []).some(i => !(Number(i.unitPrice) > 0));
  const linesOk = lines.length > 0 && lines.every(l => Number(l.quantity) > 0);
  const canSave = editable && !busy && !stale && head.supplierId !== "" && linesOk && (!order || dirty);

  const payload = () => ({
    supplierId: Number(head.supplierId),
    warehouseId: head.warehouseId ? Number(head.warehouseId) : undefined,
    currency: head.currency,
    rateToUzs: head.currency === "USD" && head.rateToUzs ? head.rateToUzs : null,
    paymentTermsDays: head.paymentTermsDays === "" ? undefined : Number(head.paymentTermsDays),
    expectedDate: head.expectedDate || null,
    notes: head.notes.trim() || null,
    items: lines.map(l => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice || "0" })),
  });

  const save = async () => {
    if (!canSave) return;
    if (!order) { create.mutate(payload()); return; }
    if (status !== "draft") {
      const ok = await confirm({
        title: t("Сохранить правку?", "Tahrir saqlansinmi?"),
        message: t("Заказ вернётся в черновик — его нужно будет согласовать заново.", "Buyurtma qoralamaga qaytadi — uni qayta kelishish kerak bo'ladi."),
        confirmText: t("Сохранить", "Saqlash"),
      });
      if (!ok) return;
    }
    update.mutate({ id: order.id, updatedAt: order.updatedAt, ...payload() });
  };

  const discard = async () => {
    const ok = await confirm({
      title: t("Отменить правки?", "O'zgarishlar bekor qilinsinmi?"),
      message: t("Заказ вернётся к сохранённому виду.", "Buyurtma saqlangan holatiga qaytadi."),
      confirmText: t("Отменить правки", "Bekor qilish"), danger: true,
    });
    if (ok) onDiscard();
  };

  const closeOrCancel = async () => {
    if (!order) return;
    const closing = status === "partially_received";
    const ok = await confirm({
      title: closing ? t("Закрыть с недовозом?", "Kam kelgan holda yopilsinmi?") : t("Отменить заказ?", "Buyurtma bekor qilinsinmi?"),
      message: closing
        ? t("Остаток больше не ждём. Принятое и долг по нему остаются.", "Qoldiq endi kutilmaydi. Qabul qilingan va uning qarzi qoladi.")
        : t("Заказ больше не ждём. Долга по нему не было и не будет.", "Buyurtma endi kutilmaydi. U bo'yicha qarz bo'lmagan va bo'lmaydi."),
      confirmText: closing ? t("Закрыть", "Yopish") : t("Отменить заказ", "Buyurtmani bekor qilish"),
      danger: true,
    });
    if (ok) cancel.mutate({ id: order.id });
  };

  const onPick = (picked: PickerProduct[]) => {
    setLines(ls => [...ls, ...picked.filter(p => !ls.some(l => l.productId === p.id)).map(p => ({
      productId: p.id, name: p.name, code: p.code ?? "", quantity: "",
      // Цена прошлой закупки подходит только заказу в сумах; в долларах её вписывают по счёту.
      unitPrice: head.currency === "UZS" && Number(p.costPrice ?? 0) > 0 ? String(Number(p.costPrice)) : "",
    }))]);
    markDirty();
    setPicking(false);
  };

  /* ── Печать и Excel: то, что сохранено (бумага и файл — по-русски) ─── */
  const print = (order: Order) => printPurchaseOrder({
    number: order.number,
    date: bizDateText(order.createdAt, "ru-RU"),
    supplier: { name: order.supplierName, inn: order.supplierInn ?? undefined, address: order.supplierAddress ?? undefined, phone: order.supplierPhone ?? undefined },
    buyer: seller,
    warehouse: order.warehouseName,
    currency: order.currency,
    rate: order.rateToUzs ? Number(order.rateToUzs) : null,
    expectedDate: order.expectedDate ? dayText(order.expectedDate) : null,
    paymentTermsDays: order.paymentTermsDays,
    items: order.items.map(i => ({ name: i.productName, code: i.productCode ?? undefined, unit: i.unit ?? undefined, qty: i.quantity, price: i.unitPrice })),
    notes: order.notes,
    status: order.status,
    approvedBy: order.approvedByName,
  });
  const excel = (order: Order) => exportToExcel(
    formatPurchaseOrderLinesForExport(order.items),
    `purchase-order-${order.number}`, "Заказ поставщику",
    `Заказ поставщику ${order.number} — ${order.supplierName}, ${order.currency}`,
  );

  const byProduct = new Map((order?.items ?? []).map(i => [i.productId, i]));
  /*
    Отсрочка, которую возьмёт заказ, если поле пустое: сервер копирует её из
    карточки поставщика при сохранении, и срок оплаты при приёмке считается
    от неё — от записанной в заказ, а не от той, что в карточке тогда.
  */
  const supplierTerms = (suppliersQ.data ?? []).find(sp => String(sp.id) === head.supplierId)?.paymentTermsDays ?? null;
  const warehouses = (warehousesQ.data ?? []).filter(w => w.status === "active" || String(w.id) === head.warehouseId);
  const defaultWarehouse = warehouses.find(w => w.isDefault);
  const ready = order != null && !dirty;

  const th: React.CSSProperties = {
    fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase",
    letterSpacing: "0.08em", color: COLORS.textTertiary, padding: "10px 12px",
    borderBottom: `1px solid ${COLORS.border}`, textAlign: "left", whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = { padding: "10px 12px", borderBottom: `1px solid ${COLORS.border}`, fontSize: "13px", fontFamily: F.body, color: COLORS.textPrimary };
  const num: React.CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };
  const card: React.CSSProperties = { background: COLORS.surface, borderRadius: "20px", boxShadow: SHADOW, padding: "18px" };
  const note: React.CSSProperties = { ...card, display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", fontSize: "13px", fontFamily: F.body, color: COLORS.textSecondary };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {dialog}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <button className="neo-btn" data-testid="po-back" onClick={() => navigate("/arrivals?tab=orders")} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <ArrowLeft size={14} /> {t("Заказы поставщикам", "Yetkazib beruvchiga buyurtmalar")}
        </button>
        <h1 style={{ fontFamily: F.display, fontSize: "22px", fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>
          {order ? order.number : t("Новый заказ поставщику", "Yetkazib beruvchiga yangi buyurtma")}
        </h1>
        {order && <PurchaseOrderStatusBadge status={order.status} />}
        {dirty && order && <span style={{ fontSize: "12px", fontWeight: 600, color: COLORS.warningText }}>{t("есть несохранённые правки", "saqlanmagan o'zgarishlar bor")}</span>}
        <span style={{ flex: 1 }} />
        {order && (
          <>
            {/* Пока реквизиты не приехали, заказчика на листе нет — печать ждёт их, а не уходит с пустой шапкой. */}
            <button className="neo-btn" data-testid="po-print" disabled={dirty || !seller.name} onClick={() => print(order)} title={dirty ? t("Сохраните правки — печатается сохранённый заказ", "O'zgarishlarni saqlang — saqlangan buyurtma chop etiladi") : undefined}
              style={{ display: "flex", alignItems: "center", gap: "6px", opacity: dirty || !seller.name ? 0.5 : 1 }}>
              <Printer size={14} /> {t("Печать", "Chop etish")}
            </button>
            <button className="neo-btn" data-testid="po-excel" disabled={dirty} onClick={() => void excel(order)} style={{ display: "flex", alignItems: "center", gap: "6px", opacity: dirty ? 0.5 : 1 }}>
              <FileDown size={14} /> Excel
            </button>
          </>
        )}
      </div>

      {stale && (
        <div data-testid="po-stale" style={{ ...note, borderLeft: "4px solid var(--color-warning)" }}>
          <span style={{ flex: 1 }}>{t("Заказ изменили, пока вы правили. Поверх новой версии сохранить нельзя — отмените правки, чтобы её увидеть.", "Siz tahrirlayotganda buyurtma o'zgardi. Yangi versiya ustidan saqlab bo'lmaydi — uni ko'rish uchun o'zgarishlarni bekor qiling.")}</span>
          <button className="neo-btn" data-testid="po-stale-reload" onClick={onDiscard} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <RefreshCw size={14} /> {t("Показать новую версию", "Yangi versiyani ko'rsatish")}
          </button>
        </div>
      )}

      {unpriced.length > 0 && (editable || status === "draft" || status === "pending_approval") && (
        <div data-testid="po-unpriced" style={{ ...note, borderLeft: "4px solid var(--color-warning)" }}>
          <span style={{ flex: 1 }}>
            {t(`Без цены: ${unpriced.map(n => `«${n}»`).join(", ")}. Черновик сохранится, но отправить директору и согласовать заказ можно только с ценами — по ним при приёмке считается долг поставщику.`,
               `Narxsiz: ${unpriced.map(n => `«${n}»`).join(", ")}. Qoralama saqlanadi, lekin buyurtmani direktorga yuborish va kelishish faqat narxlar bilan mumkin — qabul qilishda yetkazib beruvchi qarzi shu narxlar bo'yicha hisoblanadi.`)}
          </span>
        </div>
      )}

      {order?.rejectNote && status === "draft" && (
        <div data-testid="po-reject-note" style={{ ...card, borderLeft: "4px solid var(--color-warning)" }}>
          <b>{t("Вернули на доработку", "Qayta ishlashga qaytarildi")}:</b> {order.rejectNote}
        </div>
      )}

      {/* Что заказ ждёт и от кого — словами, чтобы не гадать по кнопкам. */}
      {order && status === "pending_approval" && !isCeo && (
        <div data-testid="po-waiting-director" style={note}>
          <Clock size={15} />
          {t("Ждёт согласования директора", "Direktor kelishuvini kutmoqda")}
          {order.submittedAt && <span>· {t("отправлен", "yuborilgan")} {bizDateText(order.submittedAt, "ru-RU")}</span>}
        </div>
      )}
      {order && order.approvedByName && order.approvedAt && status !== "draft" && status !== "pending_approval" && (
        <div data-testid="po-approved-by" style={note}>
          <CheckCircle2 size={15} />
          {t(`Согласовал: ${order.approvedByName}`, `Kelishdi: ${order.approvedByName}`)} · {bizDateText(order.approvedAt, "ru-RU")}
        </div>
      )}
      {openArrival && (
        <div data-testid="po-open-arrival" style={note}>
          <Truck size={15} />
          <span style={{ flex: 1 }}>{t(`По заказу заведён приход ${openArrival.arrivalNumber}: принимают там. Пока он не проведён или не удалён, заказ не правят и не отменяют.`, `Buyurtma bo'yicha ${openArrival.arrivalNumber} kirimi yaratilgan: qabul shu yerda. U yakunlanmaguncha yoki o'chirilmaguncha buyurtma o'zgartirilmaydi va bekor qilinmaydi.`)}</span>
          <button className="neo-btn" onClick={() => navigate(`/arrivals/${openArrival.id}`)}>{t("Открыть приход", "Kirimni ochish")}</button>
        </div>
      )}

      {/* Шапка */}
      <div style={{ ...card, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
        <div>
          <label className={modalFieldLabel}>{t("Поставщик *", "Yetkazib beruvchi *")}</label>
          {editable ? (
            <PremiumSelect
              aria-label={t("Поставщик", "Yetkazib beruvchi")}
              value={head.supplierId}
              onChange={v => {
                setH("supplierId", v);
                // Отсрочка — как у нового поставщика, пока её не вписали руками.
                setHead(h => ({ ...h, paymentTermsDays: "" }));
              }}
              options={[
                { value: "", label: t("Выберите поставщика", "Yetkazib beruvchini tanlang") },
                ...(suppliersQ.data ?? []).map(s => ({ value: String(s.id), label: s.name })),
                // Выключенного поставщика в списке нет, а у заказа он может быть.
                ...(order && !(suppliersQ.data ?? []).some(s => s.id === order.supplierId) ? [{ value: String(order.supplierId), label: order.supplierName }] : []),
              ]}
              width="100%"
            />
          ) : <div style={{ fontWeight: 600 }}>{order?.supplierName}</div>}
        </div>
        <div>
          <label className={modalFieldLabel}>{t("Склад", "Ombor")}</label>
          {editable ? (
            <PremiumSelect
              aria-label={t("Склад", "Ombor")}
              value={head.warehouseId || (defaultWarehouse ? String(defaultWarehouse.id) : "")}
              onChange={v => setH("warehouseId", v)}
              options={warehouses.map(w => ({ value: String(w.id), label: w.name }))}
              width="100%"
            />
          ) : <div>{order?.warehouseName}</div>}
        </div>
        <div>
          <label className={modalFieldLabel}>{t("Валюта", "Valyuta")}</label>
          {editable ? (
            <PremiumSelect
              aria-label={t("Валюта", "Valyuta")}
              value={head.currency}
              onChange={v => setH("currency", v as Head["currency"])}
              options={[{ value: "UZS", label: "UZS" }, { value: "USD", label: "USD" }]}
              width="100%"
            />
          ) : <div>{order?.currency}</div>}
        </div>
        {head.currency === "USD" && (
          <div>
            <label className={modalFieldLabel}>{t("Курс, сумов за доллар", "Kurs, dollar uchun so'm")}</label>
            {editable
              ? <DecimalInput data-testid="po-rate" className="neo-input font-data" style={{ width: "100%" }} value={head.rateToUzs} onValueChange={v => setH("rateToUzs", v)} />
              : <div>{head.rateToUzs || "—"}</div>}
          </div>
        )}
        <div>
          <label className={modalFieldLabel}>{t("Отсрочка, дней", "Kechiktirish, kun")}</label>
          {editable ? (
            <input
              data-testid="po-terms"
              className="neo-input font-data"
              style={{ width: "100%" }}
              inputMode="numeric"
              placeholder={supplierTerms != null
                ? t(`Как у поставщика: ${supplierTerms} дн.`, `Yetkazib beruvchidagidek: ${supplierTerms} kun`)
                : t("Как у поставщика: по факту", "Yetkazib beruvchidagidek: yetkazilganda")}
              title={t("Пусто — отсрочка из карточки поставщика; 0 — оплата в день поставки", "Bo'sh — yetkazib beruvchi kartochkasidagi muddat; 0 — yetkazilgan kuni to'lanadi")}
              value={head.paymentTermsDays}
              onChange={e => setH("paymentTermsDays", e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
            />
          ) : <div>{order?.paymentTermsDays == null ? t("по факту поставки", "yetkazilganda") : t(`${order.paymentTermsDays} дн.`, `${order.paymentTermsDays} kun`)}</div>}
        </div>
        <div>
          <label className={modalFieldLabel}>{t("Ждём к", "Kutilayotgan sana")}</label>
          {editable
            ? <input type="date" className="neo-input" style={{ width: "100%" }} value={head.expectedDate} onChange={e => setH("expectedDate", e.target.value)} />
            : <div>{dayText(order?.expectedDate)}</div>}
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label className={modalFieldLabel}>{t("Примечание", "Izoh")}</label>
          {editable
            ? <input className="neo-input" style={{ width: "100%" }} maxLength={2000} value={head.notes} onChange={e => setH("notes", e.target.value)} />
            : <div>{order?.notes || "—"}</div>}
        </div>
      </div>

      {/* Строки */}
      <div style={{ ...card, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "720px" }}>
          <thead>
            <tr>
              <th style={th}>{t("Товар", "Mahsulot")}</th>
              <th style={{ ...th, textAlign: "right" }}>{t("Заказано", "Buyurtma qilingan")}</th>
              <th style={{ ...th, textAlign: "right" }}>{t("Цена", "Narx")}, {head.currency}</th>
              <th style={{ ...th, textAlign: "right" }}>{t("Сумма", "Summa")}</th>
              {order && <th style={{ ...th, textAlign: "right" }}>{t("Принято", "Qabul qilingan")}</th>}
              {order && <th style={{ ...th, textAlign: "right" }}>{t("Осталось", "Qoldi")}</th>}
              {order && <th style={{ ...th, textAlign: "right" }}>{t("В пути", "Yo'lda")}</th>}
              {editable && <th style={th} />}
            </tr>
          </thead>
          <tbody>
            {lines.map(l => {
              const got = byProduct.get(l.productId);
              return (
                <tr key={l.productId} data-testid={`po-line-${l.productId}`}>
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{l.name}</div>
                    {l.code && <div style={{ fontSize: "11px", color: COLORS.textTertiary }}>{l.code}</div>}
                  </td>
                  <td style={num}>
                    {editable
                      ? <DecimalInput aria-label={t("Количество", "Miqdor")} className="neo-input font-data" style={{ width: "100px", textAlign: "right" }} value={l.quantity} onValueChange={v => setLine(l.productId, { quantity: v })} />
                      : formatQty(l.quantity)}
                  </td>
                  <td style={num}>
                    {editable
                      ? <DecimalInput aria-label={t("Цена", "Narx")} className="neo-input font-data" style={{ width: "120px", textAlign: "right" }} value={l.unitPrice} onValueChange={v => setLine(l.productId, { unitPrice: v })} />
                      : Number(l.unitPrice).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}
                  </td>
                  <td style={num}>{money(Number(l.quantity || 0) * Number(l.unitPrice || 0), head.currency)}</td>
                  {order && <td style={num}>{got ? formatQty(got.receivedQty) : "—"}{got && got.over > 0 && <span style={{ color: COLORS.warningText }}> (+{formatQty(got.over)})</span>}</td>}
                  {order && <td style={num}>{got ? formatQty(got.remaining) : "—"}</td>}
                  {order && <td style={num}>{got && got.inTransit > 0 ? formatQty(got.inTransit) : "—"}</td>}
                  {editable && (
                    <td style={{ ...td, width: "40px" }}>
                      <button className="neo-btn" aria-label={t("Убрать строку", "Qatorni olib tashlash")} onClick={() => { setLines(ls => ls.filter(x => x.productId !== l.productId)); markDirty(); }}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            {lines.length === 0 && (
              <tr><td style={{ ...td, textAlign: "center", color: COLORS.textSecondary }} colSpan={8}>{t("Добавьте товары в заказ", "Buyurtmaga mahsulot qo'shing")}</td></tr>
            )}
          </tbody>
        </table>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", gap: "12px", flexWrap: "wrap" }}>
          {editable
            ? <button className="neo-btn" data-testid="po-add-lines" onClick={() => setPicking(true)} style={{ display: "flex", alignItems: "center", gap: "6px" }}><Plus size={14} /> {t("Товары", "Mahsulotlar")}</button>
            : <span />}
          <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: "16px" }} data-testid="po-total">
            {t("Итого", "Jami")}: {money(total, head.currency)}
          </div>
        </div>
      </div>

      {/* Приходы по заказу */}
      {order && order.arrivals.length > 0 && (
        <div style={card}>
          <div style={{ fontFamily: F.display, fontWeight: 700, marginBottom: "8px" }}>{t("Приходы по заказу", "Buyurtma bo'yicha kirimlar")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {order.arrivals.map(a => (
              <button key={a.id} className="neo-btn" data-testid={`po-arrival-${a.id}`} onClick={() => navigate(`/arrivals/${a.id}`)}
                style={{ display: "flex", justifyContent: "space-between", gap: "12px", textAlign: "left" }}>
                <span style={{ fontWeight: 600 }}>{a.arrivalNumber}</span>
                <span>{dayText(a.arrivalDate)}</span>
                <span>{labelled(ARRIVAL_STATUS_LABEL, a.status, lang === "uz" ? "uz" : "ru")}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Действия — по роли: директор согласует сам, оператор отправляет ему. */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
        {editable && (
          <button className="neo-btn-primary" data-testid="po-save" disabled={!canSave} onClick={save} style={{ display: "flex", alignItems: "center", gap: "6px", opacity: canSave ? 1 : 0.5 }}>
            {(create.isPending || update.isPending) ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {order ? t("Сохранить", "Saqlash") : t("Сохранить черновик", "Qoralamani saqlash")}
          </button>
        )}
        {order && dirty && (
          <button className="neo-btn" data-testid="po-discard" disabled={busy} onClick={() => void discard()}>{t("Отменить правки", "Bekor qilish")}</button>
        )}
        {order && dirty && (
          <span data-testid="po-save-first" style={{ fontSize: "12px", color: COLORS.textTertiary }}>
            {t("Сохраните правки — потом отправка, согласование и приёмка", "O'zgarishlarni saqlang — keyin yuborish, kelishish va qabul")}
          </span>
        )}
        {ready && canManage && !isCeo && status === "draft" && (
          <button className="neo-btn" data-testid="po-submit" disabled={busy || savedUnpriced} onClick={() => submit.mutate({ id: order.id })} style={{ display: "flex", alignItems: "center", gap: "6px", opacity: savedUnpriced ? 0.5 : 1 }}>
            <Send size={14} /> {t("Отправить на согласование", "Kelishuvga yuborish")}
          </button>
        )}
        {ready && isCeo && (status === "draft" || status === "pending_approval") && (
          <button className="neo-btn-primary" data-testid="po-approve" disabled={busy || savedUnpriced} onClick={() => approve.mutate({ id: order.id, updatedAt: order.updatedAt })} style={{ display: "flex", alignItems: "center", gap: "6px", opacity: savedUnpriced ? 0.5 : 1 }}>
            <CheckCircle2 size={14} /> {t("Согласовать", "Kelishish")}
          </button>
        )}
        {ready && isCeo && !openArrival && (status === "pending_approval" || status === "approved") && (
          <button className="neo-btn" data-testid="po-reject" disabled={busy} onClick={() => { setRejectNote(""); setRejecting(true); }} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Undo2 size={14} /> {t("Вернуть на доработку", "Qayta ishlashga qaytarish")}
          </button>
        )}
        {ready && canManage && (status === "approved" || status === "partially_received") && (
          <button className="neo-btn-primary" data-testid="po-receive" disabled={busy} onClick={() => receive.mutate({ id: order.id })} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {receive.isPending ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />} {t("Принять товар", "Mahsulotni qabul qilish")}
          </button>
        )}
        {ready && canManage && !openArrival && (EDITABLE.has(status) || status === "partially_received") && (
          <button className="neo-btn" data-testid="po-cancel" disabled={busy} onClick={closeOrCancel} style={{ display: "flex", alignItems: "center", gap: "6px", color: COLORS.dangerText }}>
            <XCircle size={14} /> {status === "partially_received" ? t("Закрыть с недовозом", "Kam kelgan holda yopish") : t("Отменить заказ", "Buyurtmani bekor qilish")}
          </button>
        )}
      </div>

      {picking && (
        <ProductMultiPicker
          onClose={() => setPicking(false)}
          products={catalog}
          already={new Set(lines.map(l => l.productId))}
          onPick={onPick}
          title={t("Товары в заказ", "Buyurtmaga mahsulotlar")}
          subtitle={t("Отметьте всё, что заказываете у поставщика", "Yetkazib beruvchidan buyurtma qilayotgan hamma narsani belgilang")}
        />
      )}

      {rejecting && order && (
        <AppModal
          open
          onClose={() => setRejecting(false)}
          dirty={rejectNote.trim() !== ""}
          title={t("Вернуть на доработку", "Qayta ishlashga qaytarish")}
          subtitle={order.number}
          maxWidth={480}
          footer={
            <>
              <button className="neo-btn-primary flex-1 h-11 text-sm" data-testid="po-reject-send" disabled={!rejectNote.trim() || reject.isPending}
                onClick={() => reject.mutate({ id: order.id, note: rejectNote.trim(), updatedAt: order.updatedAt })}>
                {t("Вернуть", "Qaytarish")}
              </button>
              <button className="neo-btn flex-1 h-11 text-sm" onClick={() => setRejecting(false)}>{t("Отмена", "Bekor qilish")}</button>
            </>
          }
        >
          <label className={modalFieldLabel}>{t("Что поправить", "Nimani tuzatish kerak")}</label>
          <textarea data-testid="po-reject-text" className="neo-input" style={{ width: "100%", minHeight: 80, resize: "none" }} maxLength={500}
            value={rejectNote} onChange={e => setRejectNote(e.target.value)} />
        </AppModal>
      )}
    </div>
  );
}
