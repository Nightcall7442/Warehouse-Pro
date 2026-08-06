/**
 * The columns of the desktop orders table, declared once.
 *
 * Header and cell used to be two separate lists — an array of nine label
 * strings above, nine hand-written `<td>`s below — with nothing tying them
 * together. Insert a cell without a header and every column to its right
 * silently shifts by one, which reads as a data bug rather than a markup one.
 * Here a column is a single entry, and the table maps over it twice.
 */

export type ColumnId =
  | "orderNumber" | "createdAt" | "shopName" | "agentName" | "territoryName"
  | "paymentMethod" | "total" | "status" | "actions"
  | "notes" | "subtotal" | "discount" | "itemCount"
  | "updatedAt" | "priority" | "deliveryStatus" | "deliveredAt" | "courierName";

export interface OrderColumnDef {
  id: ColumnId;
  label: { ru: string; uz: string };
  /** In the table before anyone has customised it. */
  defaultVisible: boolean;
  /**
   * Cannot be hidden or moved. The order number is how a row is identified at
   * all, and the actions are how work gets done from this screen — a table
   * without either is a table nobody can use, so the UI must not merely advise
   * against it.
   */
  locked?: boolean;
  align?: "left" | "right";
}

export const ORDER_COLUMNS: OrderColumnDef[] = [
  { id: "orderNumber",    label: { ru: "ЗАКАЗ",        uz: "BUYURTMA" },  defaultVisible: true,  locked: true },
  { id: "createdAt",      label: { ru: "ДАТА",         uz: "SANA" },      defaultVisible: true  },
  { id: "shopName",       label: { ru: "МАГАЗИН",      uz: "DO'KON" },    defaultVisible: true  },
  { id: "agentName",      label: { ru: "АГЕНТ",        uz: "AGENT" },     defaultVisible: true  },
  { id: "territoryName",  label: { ru: "ТЕРРИТОРИЯ",   uz: "HUDUD" },     defaultVisible: true  },
  { id: "paymentMethod",  label: { ru: "ОПЛАТА",       uz: "TO'LOV" },    defaultVisible: true  },
  { id: "total",          label: { ru: "ИТОГО",        uz: "JAMI" },      defaultVisible: true  },
  { id: "status",         label: { ru: "СТАТУС",       uz: "HOLAT" },     defaultVisible: true  },

  // Everything below is off until someone asks for it. All of it comes from
  // the row orders.list already returns — nothing here is invented.
  { id: "itemCount",      label: { ru: "ПОЗИЦИЙ",      uz: "POZITSIYA" }, defaultVisible: false, align: "right" },
  { id: "subtotal",       label: { ru: "ПОДЫТОГ",      uz: "ORALIQ" },    defaultVisible: false, align: "right" },
  { id: "discount",       label: { ru: "СКИДКА",       uz: "CHEGIRMA" },  defaultVisible: false, align: "right" },
  { id: "priority",       label: { ru: "ПРИОРИТЕТ",    uz: "USTUVORLIK" },defaultVisible: false },
  { id: "deliveryStatus", label: { ru: "ДОСТАВКА",     uz: "YETKAZISH" }, defaultVisible: false },
  { id: "courierName",    label: { ru: "КУРЬЕР",       uz: "KURYER" },    defaultVisible: false },
  { id: "deliveredAt",    label: { ru: "ДОСТАВЛЕН",    uz: "YETKAZILDI" },defaultVisible: false },
  // Deliberately "изменён" and not "статус изменён": the column is
  // orders.updated_at, which moves whenever anything on the row is edited.
  // Naming it after the status would promise something it doesn't record.
  { id: "updatedAt",      label: { ru: "ИЗМЕНЁН",      uz: "O'ZGARTIRILDI" }, defaultVisible: false },
  { id: "notes",          label: { ru: "КОММЕНТАРИЙ",  uz: "IZOH" },      defaultVisible: false },

  { id: "actions",        label: { ru: "ДЕЙСТВИЯ",     uz: "AMALLAR" },   defaultVisible: true,  locked: true },
];

const BY_ID = new Map(ORDER_COLUMNS.map(c => [c.id, c]));
export const findColumn = (id: string) => BY_ID.get(id as ColumnId);

/** What the table shows before anyone touches the settings. */
export function defaultLayout(): { order: ColumnId[]; hidden: ColumnId[] } {
  return {
    order: ORDER_COLUMNS.map(c => c.id),
    hidden: ORDER_COLUMNS.filter(c => !c.defaultVisible).map(c => c.id),
  };
}

export interface ColumnLayout {
  /** Every known column, in display order. */
  order: ColumnId[];
  hidden: ColumnId[];
}

/**
 * Turn whatever was in storage into a layout the table can render.
 *
 * Storage is user-editable and survives releases, so it will eventually hold
 * ids that no longer exist and miss ids that have since been added. Neither may
 * take the page down or quietly drop a column: unknown ids are discarded,
 * columns the stored layout never heard of are appended in their declared
 * position, and a locked column can never end up hidden however the JSON reads.
 */
export function normaliseLayout(stored: unknown): ColumnLayout {
  const fallback = defaultLayout();
  if (!stored || typeof stored !== "object") return fallback;

  const raw = stored as { order?: unknown; hidden?: unknown };
  const storedOrder = Array.isArray(raw.order) ? raw.order.filter(id => BY_ID.has(id as ColumnId)) as ColumnId[] : [];
  const storedHidden = Array.isArray(raw.hidden) ? raw.hidden.filter(id => BY_ID.has(id as ColumnId)) as ColumnId[] : [];

  if (storedOrder.length === 0) return fallback;

  const seen = new Set<ColumnId>();
  const order: ColumnId[] = [];
  for (const id of storedOrder) {
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  // A column added in a later release is unknown to the stored layout. Slot it
  // where it was declared rather than at the end, so a new column appears where
  // it was designed to sit instead of after "Действия".
  ORDER_COLUMNS.forEach((c, i) => {
    if (seen.has(c.id)) return;
    order.splice(Math.min(i, order.length), 0, c.id);
    seen.add(c.id);
  });

  const hidden = storedHidden.filter(id => !findColumn(id)?.locked);

  return { order, hidden };
}

export function visibleColumns(layout: ColumnLayout): OrderColumnDef[] {
  const hidden = new Set(layout.hidden);
  return layout.order
    .filter(id => !hidden.has(id))
    .map(id => BY_ID.get(id)!)
    .filter(Boolean);
}

/**
 * Where the layout lives.
 *
 * Keyed by tenant and user because office machines are shared — one browser,
 * several people, sometimes several companies. A single global key would let
 * one person's hidden columns follow the next person who signs in.
 */
export const layoutStorageKey = (tenantId: number | undefined, userId: number | undefined) =>
  `orders-columns:${tenantId ?? "?"}:${userId ?? "?"}`;
