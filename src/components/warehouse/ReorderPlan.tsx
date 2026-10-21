import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { AlertTriangle, Loader2, ShoppingCart, Truck } from "lucide-react";
import type { AppRouter } from "../../../api/router";
import { trpc } from "@/providers/trpc";
import { useCan } from "@/hooks/useCan";
import { useCurrency } from "@/hooks/useCurrency";
import { useIsMobile } from "@/hooks/use-mobile";
import { labelled, PURCHASE_ORDER_STATUS_LABEL } from "@/lib/entity-labels";
import { notify } from "@/lib/toast";
import { errorText } from "@/lib/error-text";
import { formatQty } from "@/lib/format";
import { colorMix } from "@/lib/color-mix";
import { groupBySupplier, orderQuantity } from "@/lib/reorder-groups";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { PremiumSelect } from "@/components/PremiumSelect";
import { unitLabel } from "@/components/warehouse";
import { F, COLORS, SHADOW } from "@/components/orders/theme-tokens";

export type ReorderRow = inferRouterOutputs<AppRouter>["warehouse"]["reorderSuggestions"][number];

const CARD: React.CSSProperties = { background: COLORS.surface, borderRadius: "24px", overflow: "hidden", boxShadow: SHADOW };

/**
 * Вкладка «Дозаказ»: что заканчивается, сколько заказать и у кого — и
 * черновики заказов поставщикам одной кнопкой.
 *
 * Строки — группами по поставщику: группа станет одним заказом. Отмечено
 * сразу то, что нужно заказать (заказать > 0); количество правится — сервер
 * посчитал до максимума запаса за вычетом того, что уже едет, а человек
 * знает, что завод возит только паллетами. Группе «без поставщика»
 * поставщика выбирают здесь же; не выбран — её строки в заказ не идут.
 *
 * Заказы создаются черновиками (purchaseOrder.createFromSuggestions): их
 * согласует директор, как любой заказ. «В пути» — только согласованное и
 * приходы без заказа; черновики и заказы на согласовании — своим столбцом
 * «Не согласовано», с номерами: товар не едет, но второй раз его здесь не
 * предлагают, а брошенный черновик видно и его можно открыть и отменить
 * (ADR 0014).
 *
 * На телефоне — карточки, как на остальных вкладках склада: десять столбцов
 * с полями ввода в узкой ленте прокручивались вбок, и «Заказать» уходило за
 * край. Без права вести поставщиков — ни отметок, ни полей, только цифры.
 */
export function ReorderPlan({ rows, warehouseId, lang }: { rows: ReorderRow[]; warehouseId?: number; lang: "ru" | "uz" }) {
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const can = useCan();
  const canOrder = can("suppliers.manage");
  const { fmt } = useCurrency();
  const utils = trpc.useUtils();

  // Правки человека — поверх посчитанного: обновление списка их не стирает.
  const [qtyEdits, setQtyEdits] = useState<Record<number, string>>({});
  const [pickEdits, setPickEdits] = useState<Record<number, boolean>>({});
  const [orphanSupplier, setOrphanSupplier] = useState("");

  const groups = useMemo(() => groupBySupplier(rows), [rows]);
  const hasOrphans = groups.some(g => g.supplierId == null);
  const suppliersQ = trpc.supplier.list.useQuery(undefined, { enabled: canOrder && hasOrphans });

  const qtyOf = (r: ReorderRow) => qtyEdits[r.productId] ?? (r.suggestedQty > 0 ? String(r.suggestedQty) : "");
  const pickedOf = (r: ReorderRow) => pickEdits[r.productId] ?? r.suggestedQty > 0;
  const costOf = (r: ReorderRow) => Math.round(Number(orderQuantity(qtyOf(r)) ?? 0) * Number(r.costPrice ?? 0));

  /** Что уйдёт в заказы: отмеченное, с количеством и поставщиком. */
  const payload = groups.flatMap(g => {
    const supplierId = g.supplierId ?? (orphanSupplier ? Number(orphanSupplier) : null);
    if (supplierId == null) return [];
    const items = g.rows.flatMap(r => {
      const quantity = orderQuantity(qtyOf(r));
      return pickedOf(r) && quantity ? [{ productId: r.productId, quantity }] : [];
    });
    return items.length > 0 ? [{ supplierId, items }] : [];
  });
  const lines = payload.reduce((n, g) => n + g.items.length, 0);

  const create = trpc.purchaseOrder.createFromSuggestions.useMutation({
    onSuccess: res => {
      notify.success(t(
        `Заказов поставщикам: ${res.orders.length} — черновики, их согласует директор`,
        `Yetkazib beruvchilarga buyurtmalar: ${res.orders.length} — qoralamalar, ularni direktor kelishadi`,
      ));
      setQtyEdits({}); setPickEdits({}); setOrphanSupplier("");
      void utils.purchaseOrder.list.invalidate();
      void utils.warehouse.reorderSuggestions.invalidate();
      navigate(res.orders.length === 1 ? `/purchase-orders/${res.orders[0].id}` : "/arrivals?tab=orders");
    },
    onError: e => notify.error(errorText(e)),
  });

  const num: React.CSSProperties = { textAlign: "right", fontFamily: F.display, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
  const unapprovedHint = t(
    "Черновики и заказы на согласовании: товар ещё не едет, но вычтен из «Заказать», чтобы не заказать дважды. Брошенный черновик отмените — товар снова предложится.",
    "Qoralamalar va kelishuvdagi buyurtmalar: mahsulot hali yo'lda emas, lekin ikki marta buyurtma qilmaslik uchun «Buyurtma»dan ayirilgan. Tashlab qo'yilgan qoralamani bekor qiling — mahsulot yana taklif qilinadi.",
  );
  const head = [
    ...(canOrder ? [""] : []), t("ТОВАР", "MAHSULOT"), t("СВОБОДНО", "BO'SH"), t("ПОРОГ", "CHEGARA"), t("МАКС.", "MAKS."),
    t("В ПУТИ", "YO'LDA"), t("НЕ СОГЛАСОВАНО", "KELISHILMAGAN"), t("ПРОДАЖИ/ДЕНЬ", "SOTISH/KUN"), t("ДНЕЙ", "KUN"), t("ЗАКАЗАТЬ", "BUYURTMA"), t("СТОИМОСТЬ", "NARX"),
  ];
  const firstNumeric = canOrder ? 2 : 1;

  /* Ячейки, общие для таблицы и карточки. */
  const pick = (r: ReorderRow) => (
    <input type="checkbox" checked={pickedOf(r)} aria-label={t(`Заказать: ${r.productName}`, `Buyurtma: ${r.productName}`)}
      data-testid={`reorder-pick-${r.productId}`}
      onChange={e => setPickEdits(p => ({ ...p, [r.productId]: e.target.checked }))} />
  );
  const qty = (r: ReorderRow, u: string) => (
    <>
      {canOrder ? (
        <DecimalInput aria-label={t(`Количество: ${r.productName}`, `Miqdor: ${r.productName}`)} data-testid={`reorder-qty-${r.productId}`}
          className="neo-input font-data" style={{ width: "96px", textAlign: "right" }}
          value={qtyOf(r)} onValueChange={v => setQtyEdits(q => ({ ...q, [r.productId]: v }))} />
      ) : (
        <span style={{ fontWeight: 700, color: COLORS.primaryText }}>{r.suggestedQty > 0 ? `+${formatQty(r.suggestedQty)}` : "—"}</span>
      )}
      <span style={{ marginLeft: "4px", color: COLORS.textTertiary }}>{u}</span>
    </>
  );
  const inboundCell = (r: ReorderRow) => (
    <span data-testid={`reorder-inbound-${r.productId}`} style={{ color: r.inbound > 0 ? COLORS.primaryText : COLORS.textTertiary }}>
      {r.inbound > 0 ? formatQty(r.inbound) : "—"}
    </span>
  );
  /** «Не согласовано»: сколько и в каких заказах — номером-ссылкой на заказ. */
  const unapprovedCell = (r: ReorderRow) => {
    const held = r.unapprovedOrders ?? [];
    return (
      <span data-testid={`reorder-unapproved-${r.productId}`} title={unapprovedHint}>
        <span style={{ color: (r.unapproved ?? 0) > 0 ? COLORS.warningText : COLORS.textTertiary }}>{(r.unapproved ?? 0) > 0 ? formatQty(r.unapproved) : "—"}</span>
        {held.map(o => (
          <button key={o.id} type="button" data-testid={`reorder-po-${r.productId}-${o.id}`} onClick={() => navigate(`/purchase-orders/${o.id}`)}
            title={labelled(PURCHASE_ORDER_STATUS_LABEL, o.status, lang)}
            style={{ display: "block", marginLeft: "auto", border: "none", background: "none", padding: 0, cursor: "pointer", font: "inherit", fontSize: "11px", color: COLORS.primaryText, textDecoration: "underline" }}>
            {o.number}
          </button>
        ))}
      </span>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {groups.map(g => {
        const groupCost = g.rows.reduce((s, r) => s + (pickedOf(r) ? costOf(r) : 0), 0);
        return (
          <div key={g.key} style={CARD} data-testid={`reorder-group-${g.key}`}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", padding: "14px 16px", borderBottom: `1px solid ${COLORS.border}` }}>
              <Truck size={15} color={COLORS.textTertiary} />
              {g.supplierId != null ? (
                <span style={{ fontFamily: F.display, fontWeight: 700, color: COLORS.textPrimary }}>{g.supplierName}</span>
              ) : (
                <>
                  <span style={{ fontFamily: F.display, fontWeight: 700, color: COLORS.textPrimary }}>{t("Без поставщика", "Yetkazib beruvchisiz")}</span>
                  {canOrder && (
                    <PremiumSelect
                      aria-label={t("Поставщик для этих товаров", "Bu mahsulotlar uchun yetkazib beruvchi")}
                      value={orphanSupplier}
                      onChange={setOrphanSupplier}
                      options={[
                        { value: "", label: t("Выберите поставщика", "Yetkazib beruvchini tanlang") },
                        ...(suppliersQ.data ?? []).map(sp => ({ value: String(sp.id), label: sp.name })),
                      ]}
                      width="240px"
                    />
                  )}
                </>
              )}
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: "12px", color: COLORS.textTertiary }}>
                {g.rows.length} {t("товаров", "mahsulot")} · {fmt(groupCost.toFixed(0))}
              </span>
            </div>
            {isMobile ? (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {g.rows.map(r => {
                  const daysLeft = Number(r.daysUntilStockout ?? 999);
                  const tone = daysLeft <= 3 ? COLORS.dangerText : daysLeft <= 7 ? COLORS.warningText : COLORS.textSecondary;
                  const u = unitLabel(r.unit ?? undefined, lang);
                  return (
                    <div key={r.productId} data-testid={`reorder-row-${r.productId}`}
                      style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "12px 16px", borderBottom: `1px solid ${COLORS.border}`, background: daysLeft <= 3 ? colorMix(COLORS.danger, 4) : undefined }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        {canOrder && pick(r)}
                        <span style={{ flex: 1, minWidth: 0, fontWeight: 600, color: COLORS.textPrimary, overflowWrap: "anywhere" }}>{r.productName}</span>
                        <span style={{ fontSize: "12px", fontWeight: 600, color: tone, whiteSpace: "nowrap" }}>
                          {daysLeft >= 999 ? "—" : t(`${daysLeft} дн.`, `${daysLeft} kun`)}
                        </span>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: "12px", color: COLORS.textTertiary }}>
                        <span>{t("Свободно", "Bo'sh")} <b style={{ color: tone }}>{formatQty(r.available)}</b> / {formatQty(r.target)} {u}</span>
                        <span>{t("В пути", "Yo'lda")} {inboundCell(r)}</span>
                        {(r.unapproved ?? 0) > 0 && <span style={{ display: "inline-flex", gap: "4px" }}>{t("Не согласовано", "Kelishilmagan")} {unapprovedCell(r)}</span>}
                        {r.supplierSource === "last" && <span>{t("поставщик — по последнему приходу", "yetkazib beruvchi — oxirgi kirim bo'yicha")}</span>}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", ...num }}>
                        <span style={{ display: "inline-flex", alignItems: "center" }}>{qty(r, u)}</span>
                        <span style={{ fontWeight: 700 }}>{fmt(costOf(r).toFixed(0))}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>{head.map((h, i) => <th key={i} style={i >= firstNumeric ? { textAlign: "right" } : undefined}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {g.rows.map(r => {
                    const daysLeft = Number(r.daysUntilStockout ?? 999);
                    const urgent = daysLeft <= 3;
                    const tone = urgent ? COLORS.dangerText : daysLeft <= 7 ? COLORS.warningText : COLORS.textSecondary;
                    const u = unitLabel(r.unit ?? undefined, lang);
                    return (
                      <tr key={r.productId} data-testid={`reorder-row-${r.productId}`} style={urgent ? { background: colorMix(COLORS.danger, 4) } : undefined}>
                        {canOrder && <td style={{ width: "36px" }}>{pick(r)}</td>}
                        <td>
                          <div className="flex items-center gap-2">
                            {urgent && <AlertTriangle size={13} color={COLORS.dangerText} />}
                            <span style={{ fontWeight: 500 }}>{r.productName}</span>
                          </div>
                          {r.supplierSource === "last" && (
                            <div style={{ fontSize: "11px", color: COLORS.textTertiary }}>{t("поставщик — по последнему приходу", "yetkazib beruvchi — oxirgi kirim bo'yicha")}</div>
                          )}
                        </td>
                        <td style={{ ...num, fontWeight: 700, color: tone }}>{formatQty(r.available)} {u}</td>
                        <td style={{ ...num, color: COLORS.textTertiary }}>{formatQty(r.reorderPoint, 0)}</td>
                        <td style={{ ...num, color: COLORS.textTertiary }} title={r.reorderMax == null ? t("Максимум не задан — 2 × порог", "Maksimum berilmagan — 2 × chegara") : undefined}>
                          {formatQty(r.target)}{r.reorderMax == null && <span style={{ fontSize: "10px" }}> (2×)</span>}
                        </td>
                        <td style={num}>{inboundCell(r)}</td>
                        <td style={num}>{unapprovedCell(r)}</td>
                        <td style={{ ...num, color: COLORS.textSecondary }}>{r.avgDailySales}</td>
                        <td style={{ ...num, color: tone }}>{daysLeft >= 999 ? "—" : daysLeft}</td>
                        <td style={num}>{qty(r, u)}</td>
                        <td style={{ ...num, fontWeight: 700 }}>{fmt(costOf(r).toFixed(0))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
          </div>
        );
      })}

      <div style={{ ...CARD, display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", padding: "12px 16px", fontSize: "12px", color: COLORS.textTertiary }}>
        <span>{rows.length} {t("товаров", "mahsulot")}</span>
        <span>
          {t("К заказу:", "Buyurtmaga:")} <b style={{ color: COLORS.textPrimary }}>{lines}</b>
          {" · "}{t("стоимость", "qiymati")} <b style={{ color: COLORS.textPrimary }}>{fmt(groups.reduce((s, g) => s + g.rows.reduce((a, r) => a + (pickedOf(r) ? costOf(r) : 0), 0), 0).toFixed(0))}</b>
        </span>
        <span style={{ flex: 1 }} />
        {canOrder && (
          <button type="button" className="neo-btn-primary" data-testid="reorder-create-orders"
            disabled={lines === 0 || create.isPending}
            onClick={() => create.mutate({ warehouseId, groups: payload })}
            style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 16px", opacity: lines === 0 ? 0.5 : 1 }}>
            {create.isPending ? <Loader2 size={14} className="animate-spin" /> : <ShoppingCart size={14} />}
            {t("Создать заказы поставщикам", "Yetkazib beruvchilarga buyurtma yaratish")}
          </button>
        )}
      </div>
      {canOrder && hasOrphans && !orphanSupplier && (
        <p style={{ margin: 0, fontSize: "12px", color: COLORS.textTertiary }} data-testid="reorder-orphans-hint">
          {t("Товары без поставщика в заказ не попадут, пока для них не выбран поставщик. Поставщика по умолчанию можно задать в карточке товара.",
             "Yetkazib beruvchisiz mahsulotlar uchun yetkazib beruvchi tanlanmaguncha ular buyurtmaga kirmaydi. Standart yetkazib beruvchini mahsulot kartochkasida belgilash mumkin.")}
        </p>
      )}
    </div>
  );
}
