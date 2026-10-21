import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { ArrowLeft, Plus, Trash2, Loader2, Send, CheckCircle2, Undo2, Truck, XCircle, Save } from "lucide-react";
import type { AppRouter } from "../../api/router";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useCan } from "@/hooks/useCan";
import { notify } from "@/lib/toast";
import { errorText } from "@/lib/error-text";
import { formatQty } from "@/lib/format";
import { labelled, ARRIVAL_STATUS_LABEL } from "@/lib/entity-labels";
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
 * Здесь самое нужное, чтобы пройти путь целиком: завести заказ, отправить
 * директору, согласовать или вернуть с замечанием, принять товар приходом
 * (экран сразу открывает приход), закрыть остаток или отменить. Долг по
 * заказу рождается только при проведении прихода (ADR 0013) — на этом
 * экране денег поставщику нет, только сумма заказа.
 */
export default function PurchaseOrderEditor() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const orderId = isNew ? 0 : Number(id);
  const detailQ = trpc.purchaseOrder.getById.useQuery({ id: orderId }, { enabled: !isNew && orderId > 0 });

  if (!isNew && detailQ.isLoadingError) return <QueryErrorFallback onRetry={detailQ.refetch} />;
  if (!isNew && !detailQ.data) {
    return <div style={{ padding: "40px", display: "flex", justifyContent: "center" }}><Loader2 className="animate-spin" size={24} /></div>;
  }
  // Новая версия документа — новое состояние формы: правки поверх старой не живут.
  const order = isNew ? null : detailQ.data!;
  return <OrderScreen key={order ? `${order.id}:${String(order.updatedAt)}` : "new"} order={order} />;
}

function OrderScreen({ order }: { order: Order | null }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const can = useCan();
  const { confirm, dialog } = useConfirm();

  const isCeo = user?.role === "ceo";
  const canManage = can("suppliers.manage");
  const status = order?.status ?? "draft";
  const editable = canManage && (!order || EDITABLE.has(status));

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
  } : { supplierId: "", warehouseId: "", currency: "UZS", rateToUzs: "", paymentTermsDays: "", expectedDate: "", notes: "" });
  const [lines, setLines] = useState<Line[]>(() => (order?.items ?? []).map(i => ({
    productId: i.productId, name: i.productName, code: i.productCode ?? "",
    quantity: String(i.quantity), unitPrice: String(i.unitPrice),
  })));
  const [dirty, setDirty] = useState(false);
  const [picking, setPicking] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState("");

  const setH = <K extends keyof Head>(k: K, v: Head[K]) => { setHead(h => ({ ...h, [k]: v })); setDirty(true); };
  const setLine = (productId: number, patch: Partial<Line>) => {
    setLines(ls => ls.map(l => (l.productId === productId ? { ...l, ...patch } : l)));
    setDirty(true);
  };

  const onError = (e: unknown) => notify.error(errorText(e));
  const refresh = () => { void utils.purchaseOrder.getById.invalidate(); void utils.purchaseOrder.list.invalidate(); };
  const create = trpc.purchaseOrder.create.useMutation({
    onSuccess: r => { notify.success(t(`Заказ ${r.number} сохранён`, `${r.number} buyurtma saqlandi`)); void utils.purchaseOrder.list.invalidate(); navigate(`/purchase-orders/${r.id}`, { replace: true }); },
    onError,
  });
  const update = trpc.purchaseOrder.update.useMutation({ onSuccess: () => { notify.success(t("Заказ сохранён", "Buyurtma saqlandi")); refresh(); }, onError });
  const submit = trpc.purchaseOrder.submit.useMutation({ onSuccess: () => { notify.success(t("Заказ отправлен директору", "Buyurtma direktorga yuborildi")); refresh(); }, onError });
  const approve = trpc.purchaseOrder.approve.useMutation({ onSuccess: () => { notify.success(t("Заказ согласован", "Buyurtma kelishildi")); refresh(); }, onError });
  const reject = trpc.purchaseOrder.reject.useMutation({ onSuccess: () => { notify.success(t("Заказ возвращён на доработку", "Buyurtma qayta ishlashga qaytarildi")); setRejecting(false); refresh(); }, onError });
  const cancel = trpc.purchaseOrder.cancel.useMutation({ onSuccess: () => { notify.success(t("Готово", "Tayyor")); refresh(); }, onError });
  const receive = trpc.purchaseOrder.receive.useMutation({
    onSuccess: r => { notify.success(t(`Заведён приход ${r.arrivalNumber}`, `${r.arrivalNumber} kirimi yaratildi`)); refresh(); navigate(`/arrivals/${r.arrivalId}`); },
    onError,
  });
  const busy = create.isPending || update.isPending || submit.isPending || approve.isPending || reject.isPending || cancel.isPending || receive.isPending;

  const total = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unitPrice || 0), 0);
  const linesOk = lines.length > 0 && lines.every(l => Number(l.quantity) > 0);
  const canSave = editable && !busy && head.supplierId !== "" && linesOk && (!order || dirty);

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
    setDirty(true);
    setPicking(false);
  };

  const byProduct = new Map((order?.items ?? []).map(i => [i.productId, i]));
  const warehouses = (warehousesQ.data ?? []).filter(w => w.status === "active" || String(w.id) === head.warehouseId);
  const defaultWarehouse = warehouses.find(w => w.isDefault);

  const th: React.CSSProperties = {
    fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase",
    letterSpacing: "0.08em", color: COLORS.textTertiary, padding: "10px 12px",
    borderBottom: `1px solid ${COLORS.border}`, textAlign: "left", whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = { padding: "10px 12px", borderBottom: `1px solid ${COLORS.border}`, fontSize: "13px", fontFamily: F.body, color: COLORS.textPrimary };
  const num: React.CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };
  const card: React.CSSProperties = { background: COLORS.surface, borderRadius: "20px", boxShadow: SHADOW, padding: "18px" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {dialog}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <button className="neo-btn" onClick={() => navigate("/arrivals?tab=orders")} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <ArrowLeft size={14} /> {t("Заказы поставщикам", "Yetkazib beruvchiga buyurtmalar")}
        </button>
        <h1 style={{ fontFamily: F.display, fontSize: "22px", fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>
          {order ? order.number : t("Новый заказ поставщику", "Yetkazib beruvchiga yangi buyurtma")}
        </h1>
        {order && <PurchaseOrderStatusBadge status={order.status} />}
      </div>

      {order?.rejectNote && status === "draft" && (
        <div data-testid="po-reject-note" style={{ ...card, borderLeft: "4px solid var(--color-warning)" }}>
          <b>{t("Вернули на доработку", "Qayta ishlashga qaytarildi")}:</b> {order.rejectNote}
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
              placeholder={t("Как у поставщика", "Yetkazib beruvchidagidek")}
              value={head.paymentTermsDays}
              onChange={e => setH("paymentTermsDays", e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
            />
          ) : <div>{order?.paymentTermsDays ?? "—"}</div>}
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
                      <button className="neo-btn" aria-label={t("Убрать строку", "Qatorni olib tashlash")} onClick={() => { setLines(ls => ls.filter(x => x.productId !== l.productId)); setDirty(true); }}>
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

      {/* Действия */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {editable && (
          <button className="neo-btn-primary" data-testid="po-save" disabled={!canSave} onClick={save} style={{ display: "flex", alignItems: "center", gap: "6px", opacity: canSave ? 1 : 0.5 }}>
            {(create.isPending || update.isPending) ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {order ? t("Сохранить", "Saqlash") : t("Сохранить черновик", "Qoralamani saqlash")}
          </button>
        )}
        {order && canManage && status === "draft" && !dirty && (
          <button className="neo-btn" data-testid="po-submit" disabled={busy} onClick={() => submit.mutate({ id: order.id })} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Send size={14} /> {t("Отправить на согласование", "Kelishuvga yuborish")}
          </button>
        )}
        {order && isCeo && (status === "draft" || status === "pending_approval") && !dirty && (
          <button className="neo-btn-primary" data-testid="po-approve" disabled={busy} onClick={() => approve.mutate({ id: order.id })} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <CheckCircle2 size={14} /> {t("Согласовать", "Kelishish")}
          </button>
        )}
        {order && isCeo && (status === "pending_approval" || status === "approved") && !dirty && (
          <button className="neo-btn" data-testid="po-reject" disabled={busy} onClick={() => { setRejectNote(""); setRejecting(true); }} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Undo2 size={14} /> {t("Вернуть на доработку", "Qayta ishlashga qaytarish")}
          </button>
        )}
        {order && canManage && (status === "approved" || status === "partially_received") && !dirty && (
          <button className="neo-btn-primary" data-testid="po-receive" disabled={busy} onClick={() => receive.mutate({ id: order.id })} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {receive.isPending ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />} {t("Принять товар", "Mahsulotni qabul qilish")}
          </button>
        )}
        {order && canManage && (EDITABLE.has(status) || status === "partially_received") && !dirty && (
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
                onClick={() => reject.mutate({ id: order.id, note: rejectNote.trim() })}>
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
