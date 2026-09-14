import { labelled, ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL, ROLE_LABEL, type Label, type Lang } from "./entity-labels";

/* ── Подробности словами ──────────────────────────────────────────────────────
   Директор видел «amount: 150000», «from: shipped», «method: cash» — ключи из
   кода. Здесь каждый известный ключ назван, значения переведены: сумма —
   деньгами, статус — словом, способ оплаты — словом, «было → стало» — стрелкой.
   Неизвестный ключ не прячется: показывается как есть, чтобы ничего не терять. */
const KEY_LABEL: Record<string, Label> = {
  amount: { ru: "Сумма", uz: "Summa" }, total: { ru: "Итого", uz: "Jami" }, sum: { ru: "Сумма", uz: "Summa" },
  remaining: { ru: "Остаток долга", uz: "Qarz qoldig'i" }, method: { ru: "Оплата", uz: "To'lov" },
  orderNumber: { ru: "Заказ", uz: "Buyurtma" }, shopName: { ru: "Магазин", uz: "Do'kon" }, shopId: { ru: "Магазин №", uz: "Do'kon №" },
  from: { ru: "Было", uz: "Bo'lgan" }, to: { ru: "Стало", uz: "Bo'ldi" }, status: { ru: "Статус", uz: "Holat" },
  reason: { ru: "Причина", uz: "Sabab" }, comment: { ru: "Комментарий", uz: "Izoh" }, note: { ru: "Примечание", uz: "Eslatma" },
  quantity: { ru: "Количество", uz: "Miqdor" }, qty: { ru: "Количество", uz: "Miqdor" }, count: { ru: "Количество", uz: "Soni" },
  productId: { ru: "Товар №", uz: "Tovar №" }, productName: { ru: "Товар", uz: "Tovar" }, name: { ru: "Название", uz: "Nomi" },
  warehouseId: { ru: "Склад №", uz: "Ombor №" }, warehouseName: { ru: "Склад", uz: "Ombor" },
  actorRole: { ru: "Роль", uz: "Rol" }, role: { ru: "Роль", uz: "Rol" }, email: { ru: "Почта", uz: "Pochta" },
  changes: { ru: "Изменения", uz: "O'zgarishlar" }, fields: { ru: "Поля", uz: "Maydonlar" },
  deleted: { ru: "Удалено записей", uz: "O'chirilgan yozuvlar" }, retentionDays: { ru: "Хранить дней", uz: "Saqlash kunlari" },
  orderIds: { ru: "Заказы", uz: "Buyurtmalar" }, orders: { ru: "Заказов", uz: "Buyurtmalar" }, ids: { ru: "Записи", uz: "Yozuvlar" },
  creditLimit: { ru: "Кредитный лимит", uz: "Kredit limiti" }, price: { ru: "Цена", uz: "Narx" }, unitPrice: { ru: "Цена", uz: "Narx" },
  costPrice: { ru: "Себестоимость", uz: "Tannarx" }, discount: { ru: "Скидка", uz: "Chegirma" },
  url: { ru: "Адрес", uz: "Manzil" }, username: { ru: "Логин", uz: "Login" }, preset: { ru: "Конфигурация", uz: "Konfiguratsiya" },
  enabled: { ru: "Включено", uz: "Yoqilgan" }, intervalMinutes: { ru: "Интервал, мин", uz: "Interval, daq" },
  slug: { ru: "Код организации", uz: "Tashkilot kodi" }, extraUsers: { ru: "Доп. сотрудников", uz: "Qo'shimcha xodimlar" }, extraProducts: { ru: "Доп. товаров", uz: "Qo'shimcha tovarlar" },
  plan: { ru: "Тариф", uz: "Tarif" }, days: { ru: "Дней", uz: "Kun" }, filename: { ru: "Файл", uz: "Fayl" }, size: { ru: "Размер", uz: "Hajm" },
};
const MONEY_KEYS = new Set(["amount", "total", "sum", "remaining", "creditLimit", "price", "unitPrice", "costPrice"]);
const BOOL: Label = { ru: "да", uz: "ha" }; const BOOL_NO: Label = { ru: "нет", uz: "yo'q" };
const FIELD_LABEL: Record<string, Label> = {
  name: { ru: "название", uz: "nomi" }, phone: { ru: "телефон", uz: "telefon" }, email: { ru: "почта", uz: "pochta" }, role: { ru: "роль", uz: "rol" },
  status: { ru: "статус", uz: "holat" }, address: { ru: "адрес", uz: "manzil" }, unitPrice: { ru: "цена", uz: "narx" }, costPrice: { ru: "себестоимость", uz: "tannarx" },
  creditLimit: { ru: "кредитный лимит", uz: "kredit limiti" }, code: { ru: "код", uz: "kod" }, category: { ru: "категория", uz: "toifa" },
  unit: { ru: "единица", uz: "birlik" }, minStock: { ru: "мин. остаток", uz: "min. qoldiq" }, territoryId: { ru: "территория", uz: "hudud" },
};

function money(v: unknown): string {
  const n = Number(v);
  // Разряды через обычный пробел, а не через toLocaleString: у него пробел
  // неразрывный и зависит от ICU — в тестах и в CSV это разные строки.
  return Number.isFinite(n) ? `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} сум` : String(v);
}

function word(key: string, v: unknown, lang: Lang): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? BOOL[lang] : BOOL_NO[lang];
  if (MONEY_KEYS.has(key)) return money(v);
  if (key === "method") return labelled(PAYMENT_METHOD_LABEL, v, lang);
  if (key === "from" || key === "to" || key === "status") return labelled(ORDER_STATUS_LABEL, v, lang);
  if (key === "actorRole" || key === "role") return labelled(ROLE_LABEL, v, lang);
  if (Array.isArray(v)) return v.length > 6 ? `${v.length}` : v.map(x => String(x)).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Одна строка подробностей: «Сумма 150 000 сум · Оплата: наличные · Было: отгружен → Стало: доставлен». */
export function describeMeta(meta: Record<string, unknown> | null | undefined, lang: Lang): string {
  if (!meta) return "";
  const parts: string[] = [];
  const m = { ...meta };
  if (m.from !== undefined && m.to !== undefined) {
    parts.push(`${word("from", m.from, lang)} → ${word("to", m.to, lang)}`);
    delete m.from; delete m.to;
  }
  const changes = m.changes as Record<string, { from: unknown; to: unknown }> | undefined;
  if (changes && typeof changes === "object") {
    for (const [f, ch] of Object.entries(changes)) {
      const label = FIELD_LABEL[f]?.[lang] ?? f;
      parts.push(`${label}: ${word(f, ch?.from, lang)} → ${word(f, ch?.to, lang)}`);
    }
    delete m.changes;
  }
  for (const [k, v] of Object.entries(m)) {
    if (v === null || v === undefined || v === "" || k === "shopId" || k === "productId" || k === "warehouseId") continue;
    const label = KEY_LABEL[k]?.[lang] ?? k.replace(/([A-Z])/g, " $1").replace(/_/g, " ").toLowerCase();
    parts.push(`${label}: ${word(k, v, lang)}`);
  }
  return parts.join(" · ");
}

