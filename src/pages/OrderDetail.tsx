/* eslint-disable @typescript-eslint/no-explicit-any */
import { useParams, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/i18n";
import { format } from "date-fns";
import { ru as dateRu } from "date-fns/locale";
import { ArrowLeft, Printer, FileDown, CheckCircle2, XCircle, RefreshCw, ChevronDown, Truck } from "lucide-react";
import { useState } from "react";
import { exportToExcel } from "@/lib/excel";
import { printUzWaybill, printTorg12, printInvoice } from "@/lib/documents";
import type { OrderDocData, CompanyInfo } from "@/lib/documents";
import { notify } from "@/lib/toast";

const STATUS_STYLES: Record<string, string> = {
  new:        "bg-info/15 text-info border-info/30",
  processing: "bg-warning/15 text-warning border-warning/30",
  completed:  "bg-success/15 text-success border-success/30",
  cancelled:  "bg-danger/15 text-danger border-danger/30",
};

const PAYMENT_METHODS: Record<string, { ru: string; uz: string; color: string }> = {
  cash:     { ru: "Наличные",     uz: "Naqd",       color: "#34c473" },
  transfer: { ru: "Перечисление", uz: "O'tkazma",   color: "#4b6cf6" },
  debt:     { ru: "Долг",         uz: "Qarz",       color: "#e8a830" },
  card:     { ru: "Карта",        uz: "Plastik",    color: "#9b59b6" },
};

export default function OrderDetail() {
  const { id }      = useParams<{ id: string }>();
  const navigate    = useNavigate();
  const { fmt, currency } = useCurrency();
  const { t, lang } = useLang();
  const { user }    = useAuth();
  const utils       = trpc.useUtils();
  const [printMenu, setPrintMenu] = useState(false);

  const isOperatorOrCeo = user?.role === "ceo" || user?.role === "operator";

  const { data: order, isLoading } = trpc.order.getById.useQuery(
    { id: Number(id) }, { enabled: !!id }
  );

  const { data: settings } = trpc.settings.get.useQuery() as { data: any };

  const { data: couriers } = trpc.user.list.useQuery(
    { role: "courier" },
    { enabled: isOperatorOrCeo && !!order && (order.status === "new" || order.status === "processing") }
  );

  const updateStatus = trpc.order.updateStatus.useMutation({
    onSuccess: () => {
      utils.order.getById.invalidate({ id: Number(id) });
      notify.success(t("common.success"));
    },
    onError: (e) => notify.error(e.message),
  });

  const assignCourier = trpc.courier.assignCourier.useMutation({
    onSuccess: () => {
      utils.order.getById.invalidate({ id: Number(id) });
      notify.success(t("common.success"));
    },
    onError: (e) => notify.error(e.message),
  });

  // Build document data
  const buildDocData = (): OrderDocData | null => {
    if (!order) return null;
    const seller: CompanyInfo = {
      name:    settings?.companyName ?? "Warehouse Pro",
      address: settings?.companyAddress ?? "",
      inn:     settings?.companyInn ?? "",
      director:settings?.companyDirector ?? "",
      bank:    settings?.companyBank ?? "",
      account: settings?.companyBankAccount ?? "",
      mfo:     settings?.companyMfo ?? "",
    };
    const shopExtra = order.shop as Record<string, unknown> | undefined;
    const buyer: CompanyInfo = {
      name:    order.shop?.name ?? "",
      address: (shopExtra?.address as string) ?? "",
      inn:     (shopExtra?.inn as string) ?? "",
    };
    return {
      number:   order.orderNumber,
      date:     order.createdAt
        ? format(new Date(order.createdAt), "dd.MM.yyyy", { locale: dateRu })
        : "",
      seller,
      buyer,
      items:    (order.items ?? []).map((i: any) => ({
        name:  i.productName ?? "",
        code:  i.productCode ?? "",
        unit:  "кг",
        qty:   Number(i.quantity),
        price: Number(i.unitPrice),
        total: Number(i.subtotal),
      })),
      subtotal: Number(order.subtotal),
      discount: Number(order.discount ?? 0),
      total:    Number(order.total),
      notes:    order.notes ?? "",
      currency,
    };
  };

  const handleExport = () => {
    if (!order) return;
    const rows = (order.items ?? []).map((i: any) => ({
      [t("orders.number")]:   order.orderNumber,
      [t("orders.shop")]:     order.shop?.name ?? "",
      [t("orders.agent")]:    (order as any).agent?.name ?? "",
      [t("common.status")]:   order.status,
      [t("products.name")]:   i.productName ?? "",
      [t("products.code")]:   i.productCode ?? "",
      "Кол-во (кг)":         Number(i.quantity).toFixed(2),
      "Цена":                 Number(i.unitPrice).toFixed(2),
      [t("common.total")]:    Number(i.subtotal).toFixed(2),
    }));
    exportToExcel(rows, `order-${order.orderNumber}`);
  };

  if (isLoading) return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="h-8 w-48 bg-surface-light animate-pulse rounded"/>
      <div className="h-64 bg-surface-light animate-pulse rounded"/>
    </div>
  );

  if (!order) return <div className="text-center py-20 text-secondary">Заказ не найден</div>;

  const subtotal = Number(order.subtotal ?? 0);
  const discount = Number(order.discount ?? 0);
  const total    = Number(order.total ?? 0);

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <button onClick={() => navigate("/orders")}
          className="neo-btn flex items-center gap-2 py-1.5 px-3 text-sm">
          <ArrowLeft size={18}/><span className="text-sm">{t("common.back")}</span>
        </button>
        <div className="flex gap-2 relative">
          <button onClick={handleExport} className="neo-btn flex items-center gap-2 text-sm py-2">
            <FileDown size={15}/>Excel
          </button>
          {/* Print dropdown */}
          <div className="relative">
            <button onClick={() => setPrintMenu(v => !v)}
              className="neo-btn flex items-center gap-2 text-sm py-2">
              <Printer size={15}/>{t("common.print")}<ChevronDown size={13}/>
            </button>
            {printMenu && (
              <div className="absolute right-0 top-full mt-1 w-56 panel py-1 z-20 shadow-lg">
                {[
                  { label: "Расходная накладная (УЗ)", fn: () => { const d = buildDocData(); if(d) printUzWaybill(d); } },
                  { label: "Счёт на оплату",           fn: () => { const d = buildDocData(); if(d) printInvoice(d);  } },
                  { label: "ТОРГ-12 (РФ)",             fn: () => { const d = buildDocData(); if(d) printTorg12(d);   } },
                ].map(item => (
                  <button key={item.label} onClick={() => { item.fn(); setPrintMenu(false); }}
                    className="w-full text-left px-4 py-2 text-sm text-primary hover:bg-surface-light">
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Order card */}
      <div className="neo-card p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-primary tracking-tight">
              {lang === "uz" ? "HISOB-FAKTURA" : "НАКЛАДНАЯ"}
            </h1>
            <p className="font-data text-secondary mt-1">{order.orderNumber}</p>
          </div>
          <div className="text-right">
            <p className="font-label text-primary tracking-widest text-sm">
              {settings?.companyName ?? "WAREHOUSE PRO"}
            </p>
            <p className="text-xs text-secondary mt-1">
              {order.createdAt
                ? format(new Date(order.createdAt), "d MMMM yyyy", { locale: dateRu })
                : ""}
            </p>
            <span className={`badge ${STATUS_STYLES[order.status]} mt-2 inline-block`}>
              {t(`orders.status.${order.status}` as string) || order.status.toUpperCase()}
            </span>
            {(() => {
              const pm = PAYMENT_METHODS[(order as any).paymentMethod ?? "cash"];
              if (!pm) return null;
              return (
                <span className="badge mt-2 ml-2 inline-block" style={{
                  background: `${pm.color}15`, color: pm.color, border: `1px solid ${pm.color}30`,
                  padding: "2px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: 600,
                }}>
                  {lang === "uz" ? pm.uz : pm.ru}
                </span>
              );
            })()}
          </div>
        </div>

        {/* Meta */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-4 border-t border-border-subtle">
          <div>
            <p className="font-label text-secondary text-[10px] tracking-wider mb-1">
              {lang === "uz" ? "XARIDOR" : "ПОКУПАТЕЛЬ"}
            </p>
            <p className="text-sm font-medium text-primary">{order.shop?.name ?? "—"}</p>
            <p className="text-xs text-secondary">{(order.shop as any)?.ownerName ?? ""}</p>
            <p className="text-xs text-secondary">{((order.shop as Record<string, unknown>)?.phone as string) ?? ""}</p>
          </div>
          <div>
            <p className="font-label text-secondary text-[10px] tracking-wider mb-1">
              {lang === "uz" ? "AGENT" : "АГЕНТ"}
            </p>
            <p className="text-sm text-primary">{(order as any).agent?.name ?? "—"}</p>
          </div>
          <div>
            <p className="font-label text-secondary text-[10px] tracking-wider mb-1">
              {lang === "uz" ? "SANA" : "ДАТА"}
            </p>
            <p className="text-sm text-primary">
              {order.createdAt ? format(new Date(order.createdAt), "dd.MM.yyyy") : "—"}
            </p>
          </div>
        </div>

        {/* Items table */}
        <table className="w-full">
          <thead>
            <tr className="bg-surface-light">
              <th className="text-left px-3 py-2 font-h3 text-secondary text-xs">
                {lang === "uz" ? "MAHSULOT" : "ТОВАР"}
              </th>
              <th className="text-left px-3 py-2 font-h3 text-secondary text-xs">КОД</th>
              <th className="text-right px-3 py-2 font-h3 text-secondary text-xs">КГ</th>
              <th className="text-right px-3 py-2 font-h3 text-secondary text-xs">ЦЕНА</th>
              <th className="text-right px-3 py-2 font-h3 text-secondary text-xs">СУММА</th>
            </tr>
          </thead>
          <tbody>
            {order.items?.map((item: any, i) => (
              <tr key={item.id ?? i} className="border-b border-border-subtle">
                <td className="px-3 py-2.5 text-sm text-primary">{item.productName ?? "—"}</td>
                <td className="px-3 py-2.5 font-data text-xs text-secondary">{item.productCode ?? "—"}</td>
                <td className="px-3 py-2.5 font-data text-sm text-right">{Number(item.quantity).toFixed(2)}</td>
                <td className="px-3 py-2.5 font-data text-sm text-right text-secondary">{fmt(item.unitPrice)}</td>
                <td className="px-3 py-2.5 font-data text-sm text-right">{fmt(item.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="flex justify-end">
          <div className="w-64 space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-secondary">{lang === "uz" ? "Summa" : "Итого"}</span>
              <span className="font-data">{fmt(subtotal)}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-secondary">{lang === "uz" ? "Chegirma" : "Скидка"}</span>
                <span className="font-data text-success">−{fmt(discount)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base border-t border-border-subtle pt-2">
              <span>{lang === "uz" ? "JAMI" : "К ОПЛАТЕ"}</span>
              <span className="font-data text-primary">{fmt(total)}</span>
            </div>
          </div>
        </div>

        {order.notes && (
          <div className="pt-4 border-t border-border-subtle">
            <p className="font-label text-secondary text-[10px] tracking-wider mb-1">
              {lang === "uz" ? "IZOH" : "ПРИМЕЧАНИЕ"}
            </p>
            <p className="text-sm text-secondary">{order.notes}</p>
          </div>
        )}
      </div>

      {/* Status actions */}
      {(order.status === "new" || order.status === "processing") && (
        <div className="neo-card p-4">
          <p className="font-label text-secondary text-xs tracking-wider mb-3">
            {lang === "uz" ? "HOLATNI O'ZGARTIRISH" : "ИЗМЕНИТЬ СТАТУС"}
          </p>
          <div className="flex flex-wrap gap-2">
            {order.status === "new" && (
              <button onClick={() => updateStatus.mutate({ id: order.id, status: "processing" })}
                className="neo-btn flex items-center gap-2 text-sm">
                <RefreshCw size={14}/>
                {lang === "uz" ? "Jarayonda" : "В обработку"}
              </button>
            )}
            <button onClick={() => updateStatus.mutate({ id: order.id, status: "completed" })}
              className="neo-btn-primary flex items-center gap-2 text-sm">
              <CheckCircle2 size={14}/>
              {lang === "uz" ? "Bajarildi" : "Выполнен"}
            </button>
            <button onClick={() => updateStatus.mutate({ id: order.id, status: "cancelled" })}
              className="neo-btn flex items-center gap-2 text-sm text-danger border-danger/30">
              <XCircle size={14}/>
              {lang === "uz" ? "Bekor" : "Отменить"}
            </button>
          </div>
        </div>
      )}

      {/* Courier assignment (operator/ceo only) */}
      {isOperatorOrCeo && (order.status === "new" || order.status === "processing") && (
        <div className="neo-card p-4">
          <p className="font-label text-secondary text-xs tracking-wider mb-3 flex items-center gap-2">
            <Truck size={14}/>
            {lang === "uz" ? "KURYERNI TAYINLASH" : "НАЗНАЧИТЬ КУРЬЕРА"}
          </p>
          <div className="flex items-center gap-3">
            <select
              className="neo-input flex-1"
              value={order.courierId ?? ""}
              onChange={(e) => {
                const courierId = Number(e.target.value);
                if (courierId) {
                  assignCourier.mutate({ orderId: order.id, courierId });
                }
              }}
            >
              <option value="">{lang === "uz" ? "Kuryer tanlang" : "Выберите курьера"}</option>
              {couriers?.data?.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {order.deliveryStatus && order.deliveryStatus !== "not_assigned" && (
              <span className={`badge ${
                order.deliveryStatus === "delivered" ? "bg-success/15 text-success" :
                order.deliveryStatus === "out_for_delivery" ? "bg-warning/15 text-warning" :
                "bg-info/15 text-info"
              }`}>
                {t(`orders.delivery.${order.deliveryStatus}` as string) || order.deliveryStatus}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
