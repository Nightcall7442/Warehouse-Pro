import { useState, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GripVertical, Store, User, MapPin } from "lucide-react";
import { useTranslate } from "@/i18n";
import { F, COLORS, PAYMENT, STATUS } from "./theme-tokens";
import { colorMix } from "@/lib/color-mix";

interface OrderCard {
  id: number;
  orderNumber: string;
  status: string;
  total: string;
  shopName: string | null;
  agentName: string | null;
  territoryName?: string | null;
  paymentMethod: string;
  priority?: string;
}

interface Column {
  id: string;
  label: string;
  labelUz: string;
  statuses: string[];
  dot: string;
}

/*
  Цвет столбца берётся из общего словаря статусов.

  Здесь лежала третья копия таблицы цветов — своя у доски, своя у плашек и своя
  у фильтров. Копии разошлись: сиреневый #9b59b6 у «Отгружены» и оранжевый
  #f09050 у «В ожидании» жили только тут и в фильтрах, мимо палитры и мимо
  тёмной темы. Один заказ на трёх экранах был трёх разных цветов.
*/
const COLUMNS: Column[] = [
  { id: "new",        label: "Новые",       labelUz: "Yangi",      statuses: ["new"] },
  { id: "processing", label: "В обработке", labelUz: "Jarayonda",  statuses: ["processing"] },
  { id: "shipped",    label: "Отгружены",   labelUz: "Yuklangan",  statuses: ["shipped"] },
  { id: "pending",    label: "В ожидании",  labelUz: "Kutishda",   statuses: ["pending"] },
  { id: "delivered",  label: "Доставлены",  labelUz: "Yetkazildi", statuses: ["delivered"] },
  // Отменённые и возвраты стоят в одном столбце, ведёт его цвет отменённых.
  { id: "cancelled",  label: "Отменены",    labelUz: "Bekor",      statuses: ["cancelled", "returned"] },
].map(c => ({ ...c, dot: STATUS[c.statuses[0]]?.dot ?? "var(--color-text-tertiary)" }));

interface Props {
  orders: OrderCard[];
  onOrderClick: (orderId: number) => void;
  /**
   * Перетаскивание меняет статус, а order.updateStatus — operatorQuery.
   * Без обработчика доска остаётся доской: смотреть можно, двигать нечем.
   */
  onStatusChange?: (orderId: number, newStatus: string) => void;
  currency?: string;
}

export function OrderKanbanBoard({ orders, onOrderClick, onStatusChange, currency }: Props) {
  const t = useTranslate();
  const cur = currency ?? t("сум", "so'm");
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);

  const getColumnOrders = (col: Column) => orders.filter(o => col.statuses.includes(o.status));

  const handleDragStart = useCallback((e: React.DragEvent, orderId: number) => {
    e.dataTransfer.setData("text/plain", String(orderId));
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(orderId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, colId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCol(colId);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverCol(null);
  }, []);

  // Status rules live on the backend (OrderService.updateStatus) — any status
  // may follow any other there, so this just forwards the drop and lets the
  // mutation's own error toast handle the rare rejection (e.g. insufficient
  // stock). A local copy of the transition table would drift out of sync with
  // the backend the next time the rules change, silently blocking valid moves.
  const handleDrop = useCallback((e: React.DragEvent, col: Column) => {
    e.preventDefault();
    setDragOverCol(null);
    setDraggingId(null);
    const orderId = Number(e.dataTransfer.getData("text/plain"));
    if (!orderId) return;

    const order = orders.find(o => o.id === orderId);
    if (!order || col.statuses.includes(order.status)) return;

    onStatusChange?.(orderId, col.statuses[0]);
  }, [orders, onStatusChange]);

  return (
    <div style={{ display: "flex", gap: "12px", overflowX: "auto", paddingBottom: "16px", minHeight: "500px" }}>
      {COLUMNS.map(col => {
        const colOrders = getColumnOrders(col);
        const isDragOver = dragOverCol === col.id;

        return (
          <div
            key={col.id}
            style={{
              flexShrink: 0, width: "288px", display: "flex", flexDirection: "column",
              borderRadius: "14px", border: `2px solid ${isDragOver ? col.dot : "transparent"}`,
              background: isDragOver ? COLORS.surfaceLight : "transparent",
              transition: "background 0.15s, border-color 0.15s",
            }}
            onDragOver={(e) => handleDragOver(e, col.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, col)}
          >
            {/* Column header */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px" }}>
              <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: col.dot }} />
              <span style={{ fontFamily: F.body, fontSize: "13px", fontWeight: 600, color: COLORS.textPrimary }}>{t(col.label, col.labelUz)}</span>
              <span style={{
                marginLeft: "auto", fontFamily: F.display, fontSize: "11px", fontWeight: 600, color: COLORS.textTertiary,
                background: COLORS.surfaceLight, borderRadius: "9999px", padding: "2px 8px",
              }}>
                {colOrders.length}
              </span>
            </div>

            {/* Cards */}
            <ScrollArea className="flex-1 px-2">
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", paddingBottom: "8px" }}>
                {colOrders.map(order => {
                  const pm = PAYMENT[order.paymentMethod];
                  return (
                    <div
                      key={order.id}
                      draggable={!!onStatusChange}
                      onDragStart={(e) => handleDragStart(e, order.id)}
                      onDragEnd={() => setDraggingId(null)}
                      onClick={() => onOrderClick(order.id)}
                      style={{
                        padding: "12px", borderRadius: "12px", cursor: "pointer",
                        background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                        boxShadow: "var(--shadow-sm)",
                        opacity: draggingId === order.id ? 0.5 : 1,
                        transform: draggingId === order.id ? "scale(0.97)" : "scale(1)",
                        transition: "opacity 0.15s, transform 0.15s",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "8px" }}>
                        <span style={{ fontFamily: F.display, fontSize: "11px", fontWeight: 600, color: COLORS.textPrimary }}>{order.orderNumber}</span>
                        {pm && (
                          <span style={{
                            fontFamily: F.body, fontSize: "10px", fontWeight: 600, padding: "2px 6px", borderRadius: "6px",
                            color: pm.color, background: colorMix(pm.color, 8),
                          }}>
                            {t(pm.ru, pm.uz)}
                          </span>
                        )}
                      </div>
                      {order.shopName && (
                        <div style={{ display: "flex", alignItems: "center", gap: "4px", fontFamily: F.body, fontSize: "11px", color: COLORS.textTertiary, marginBottom: "4px" }}>
                          <Store size={11} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{order.shopName}</span>
                        </div>
                      )}
                      {order.agentName && (
                        <div style={{ display: "flex", alignItems: "center", gap: "4px", fontFamily: F.body, fontSize: "11px", color: COLORS.textTertiary, marginBottom: "4px" }}>
                          <User size={11} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{order.agentName}</span>
                        </div>
                      )}
                      {order.territoryName && (
                        <div style={{ display: "flex", alignItems: "center", gap: "4px", fontFamily: F.body, fontSize: "11px", color: COLORS.textTertiary, marginBottom: "8px" }}>
                          <MapPin size={11} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{order.territoryName}</span>
                        </div>
                      )}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontFamily: F.display, fontSize: "13px", fontWeight: 700, color: COLORS.textPrimary }}>{Number(order.total).toLocaleString("ru")} {cur}</span>
                        <GripVertical size={14} color={COLORS.textTertiary} />
                      </div>
                    </div>
                  );
                })}
                {colOrders.length === 0 && (
                  <div style={{ textAlign: "center", fontFamily: F.body, fontSize: "12px", color: COLORS.textTertiary, padding: "32px 0" }}>
                    {t("Нет заказов", "Buyurtmalar yo'q")}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        );
      })}
    </div>
  );
}
