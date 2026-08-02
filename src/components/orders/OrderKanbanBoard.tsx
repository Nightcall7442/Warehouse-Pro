import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GripVertical, Store, User, DollarSign } from "lucide-react";
import { notify } from "@/lib/toast";
import { useTranslate } from "@/i18n";

interface OrderCard {
  id: number;
  orderNumber: string;
  status: string;
  total: string;
  shopName: string | null;
  agentName: string | null;
  paymentMethod: string;
  priority?: string;
}

interface Column {
  id: string;
  label: string;
  labelUz: string;
  statuses: string[];
  color: string;
  dotColor: string;
}

const COLUMNS: Column[] = [
  { id: "new", label: "Новые", labelUz: "Yangi", statuses: ["new"], color: "border-blue-500", dotColor: "bg-blue-500" },
  { id: "processing", label: "В обработке", labelUz: "Jarayonda", statuses: ["processing"], color: "border-amber-500", dotColor: "bg-amber-500" },
  { id: "shipped", label: "Отгружены", labelUz: "Yuklangan", statuses: ["shipped"], color: "border-purple-500", dotColor: "bg-purple-500" },
  { id: "pending", label: "В ожидании", labelUz: "Kutishda", statuses: ["pending"], color: "border-orange-500", dotColor: "bg-orange-500" },
  { id: "delivered", label: "Доставлены", labelUz: "Yetkazildi", statuses: ["delivered", "partially_returned", "partial_return_kept"], color: "border-green-500", dotColor: "bg-green-500" },
  { id: "cancelled", label: "Отменены", labelUz: "Bekor", statuses: ["cancelled", "returned"], color: "border-red-500", dotColor: "bg-red-500" },
];

const PAYMENT_COLORS: Record<string, string> = {
  cash: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  card: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  transfer: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  debt: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
};

interface Props {
  orders: OrderCard[];
  onOrderClick: (orderId: number) => void;
  onStatusChange: (orderId: number, newStatus: string) => void;
  currency?: string;
}

export function OrderKanbanBoard({ orders, onOrderClick, onStatusChange, currency = "сум" }: Props) {
  const t = useTranslate();
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

  const handleDrop = useCallback((e: React.DragEvent, col: Column) => {
    e.preventDefault();
    setDragOverCol(null);
    setDraggingId(null);
    const orderId = Number(e.dataTransfer.getData("text/plain"));
    if (!orderId) return;

    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    if (col.statuses.includes(order.status)) return; // Same column

    // Validate transition
    const validTransitions: Record<string, string[]> = {
      new:                  ["processing", "cancelled"],
      processing:           ["shipped", "cancelled"],
      shipped:              ["delivered", "pending", "returned", "partially_returned", "partial_return_kept", "cancelled"],
      pending:              ["delivered", "cancelled"],
      delivered:            ["returned", "partially_returned", "partial_return_kept"],
      partially_returned:   ["returned", "delivered"],
      partial_return_kept:  ["delivered"],
    };
    const targetStatus = col.statuses[0];
    if (!validTransitions[order.status]?.includes(targetStatus)) {
      notify.error(t("Невозможно изменить статус", "Holatni o'zgartirib bo'lmaydi"));
      return;
    }

    onStatusChange(orderId, targetStatus);
  }, [orders, onStatusChange, t]);

  return (
    <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: 500 }}>
      {COLUMNS.map(col => {
        const colOrders = getColumnOrders(col);
        const isDragOver = dragOverCol === col.id;

        return (
          <div
            key={col.id}
            className={`flex-shrink-0 w-72 flex flex-col rounded-xl border-2 transition-colors ${isDragOver ? col.color + " bg-muted/50" : "border-transparent"}`}
            onDragOver={(e) => handleDragOver(e, col.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, col)}
          >
            {/* Column header */}
            <div className="flex items-center gap-2 px-3 py-2.5">
              <div className={`w-2 h-2 rounded-full ${col.dotColor}`} />
              <span className="text-sm font-medium">{t(col.label, col.labelUz)}</span>
              <Badge variant="secondary" className="ml-auto text-xs font-data">{colOrders.length}</Badge>
            </div>

            {/* Cards */}
            <ScrollArea className="flex-1 px-2">
              <div className="space-y-2 pb-2">
                {colOrders.map(order => (
                  <Card
                    key={order.id}
                    className={`p-3 cursor-pointer hover:shadow-md transition-all ${draggingId === order.id ? "opacity-50 scale-95" : ""}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, order.id)}
                    onDragEnd={() => setDraggingId(null)}
                    onClick={() => onOrderClick(order.id)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-xs font-data font-medium">{order.orderNumber}</span>
                      <Badge variant="outline" className={`text-[10px] ${PAYMENT_COLORS[order.paymentMethod]}`}>
                        {order.paymentMethod}
                      </Badge>
                    </div>
                    {order.shopName && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                        <Store className="h-3 w-3" />
                        <span className="truncate">{order.shopName}</span>
                      </div>
                    )}
                    {order.agentName && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
                        <User className="h-3 w-3" />
                        <span className="truncate">{order.agentName}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-data font-bold">{Number(order.total).toLocaleString("ru")} {currency}</span>
                      <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50" />
                    </div>
                  </Card>
                ))}
                {colOrders.length === 0 && (
                  <div className="text-center text-xs text-muted-foreground py-8">
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
