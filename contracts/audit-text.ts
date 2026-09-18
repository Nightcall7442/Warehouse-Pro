import {
  labelled, ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL, ROLE_LABEL, ACTIVE_STATUS_LABEL,
  type Label, type Lang,
} from "./entity-labels";
import { movementKind } from "./stock-movement-text";

/* ── Подробности словами ──────────────────────────────────────────────────────
   Директор видел «amount: 150000», «from: shipped», «method: cash» — ключи из
   кода. Потом — «agent id: 112 · discount pct: 0 · payment method: cash»,
   «failed: · updated: 1 · new status: delivered», «total weight:
   510.2000000000001»: словарь знал двадцать ключей, а сервер пишет восемьдесят.
   Здесь все ключи из всех записей журнала (api/**: recordAudit, traceOrderChange,
   traceDebtChange): каждый назван по-русски и по-узбекски, значения переведены —
   сумма деньгами, статус словом, вес в килограммах с одним знаком, дата днём.

   Шум не показывается: служебные номера (agentId, shopId, paymentId…), нулевая
   скидка, пустые списки, и то, что уже стоит в заголовке записи (номер заказа,
   листа, прихода). Неизвестный ключ по-прежнему печатается как есть — лучше
   некрасиво, чем потерять. */
const KEY_LABEL: Record<string, Label> = {
  // деньги
  amount: { ru: "Сумма", uz: "Summa" }, total: { ru: "Итого", uz: "Jami" }, sum: { ru: "Сумма", uz: "Summa" },
  expected: { ru: "Ожидалось", uz: "Kutilgan" }, discrepancy: { ru: "Расхождение", uz: "Farq" },
  bankRef: { ru: "Операция банка", uz: "Bank operatsiyasi" }, recordedBy: { ru: "Записал", uz: "Yozgan" },
  shortage: { ru: "Недостача", uz: "Kamomad" }, paid: { ru: "Оплачено", uz: "To'langan" },
  system: { ru: "По системе", uz: "Tizim bo'yicha" }, counted: { ru: "Пересчёт", uz: "Sanash" }, stornoOf: { ru: "Сторно документа", uz: "Hujjat stornosi" },
  remaining: { ru: "Остаток долга", uz: "Qarz qoldig'i" }, credited: { ru: "Зачтено", uz: "Hisobga olindi" },
  creditLimit: { ru: "Кредитный лимит", uz: "Kredit limiti" }, price: { ru: "Цена", uz: "Narx" }, was: { ru: "Было", uz: "Bo'lgan" },
  unitPrice: { ru: "Цена", uz: "Narx" }, costPrice: { ru: "Себестоимость", uz: "Tannarx" }, baseSalary: { ru: "Оклад", uz: "Oklad" },
  totalBefore: { ru: "Сумма была", uz: "Summa bo'lgan" }, totalAfter: { ru: "Сумма стала", uz: "Summa bo'ldi" },
  currency: { ru: "Валюта", uz: "Valyuta" },
  // оплата и статусы
  method: { ru: "Оплата", uz: "To'lov" }, paymentMethod: { ru: "Оплата", uz: "To'lov" },
  from: { ru: "Было", uz: "Bo'lgan" }, to: { ru: "Стало", uz: "Bo'ldi" }, status: { ru: "Статус", uz: "Holat" },
  newStatus: { ru: "Новый статус", uz: "Yangi holat" }, statusBefore: { ru: "Статус был", uz: "Holat bo'lgan" },
  disposition: { ru: "Решение по товару", uz: "Tovar bo'yicha qaror" },
  discount: { ru: "Скидка", uz: "Chegirma" }, discountPct: { ru: "Скидка", uz: "Chegirma" }, commissionRate: { ru: "Комиссия", uz: "Komissiya" },
  // документы и объекты
  orderNumber: { ru: "Заказ", uz: "Buyurtma" }, listNumber: { ru: "Лист", uz: "Varaqa" }, arrivalNumber: { ru: "Приход", uz: "Kirim" },
  number: { ru: "Номер", uz: "Raqam" }, code: { ru: "Код", uz: "Kod" }, name: { ru: "Название", uz: "Nomi" },
  shopName: { ru: "Магазин", uz: "Do'kon" }, shop: { ru: "Магазин", uz: "Do'kon" }, productName: { ru: "Товар", uz: "Tovar" },
  warehouseName: { ru: "Склад", uz: "Ombor" }, partner: { ru: "Партнёр", uz: "Hamkor" },
  fromWarehouse: { ru: "Откуда", uz: "Qayerdan" }, toWarehouse: { ru: "Куда", uz: "Qayerga" },
  orderIds: { ru: "Заказы", uz: "Buyurtmalar" }, orders: { ru: "Заказов", uz: "Buyurtmalar" }, ids: { ru: "Записи", uz: "Yozuvlar" },
  items: { ru: "Позиций", uz: "Pozitsiyalar" }, lines: { ru: "Позиций", uz: "Pozitsiyalar" }, shortages: { ru: "Недостач", uz: "Kamomad" },
  count: { ru: "Количество", uz: "Soni" }, quantity: { ru: "Количество", uz: "Miqdor" }, qty: { ru: "Количество", uz: "Miqdor" },
  minQuantity: { ru: "Мин. количество", uz: "Min. miqdor" }, updatedAvailable: { ru: "Свободный остаток", uz: "Bo'sh qoldiq" },
  totalWeight: { ru: "Вес", uz: "Vazn" }, format: { ru: "Формат", uz: "Format" }, type: { ru: "Тип", uz: "Turi" },
  // люди
  actorRole: { ru: "Роль", uz: "Rol" }, role: { ru: "Роль", uz: "Rol" }, ROLE: { ru: "Роль", uz: "Rol" },
  userName: { ru: "Сотрудник", uz: "Xodim" }, email: { ru: "Почта", uz: "Pochta" },
  oldEmail: { ru: "Прежняя почта", uz: "Avvalgi pochta" }, newEmail: { ru: "Новая почта", uz: "Yangi pochta" }, by: { ru: "Кем", uz: "Kim" },
  deactivate: { ru: "Деактивирован", uz: "Faolsizlantirildi" }, deactivated: { ru: "Деактивирован", uz: "Faolsizlantirildi" },
  denied: { ru: "Отказано", uz: "Rad etildi" },
  // текст
  reason: { ru: "Причина", uz: "Sabab" }, comment: { ru: "Комментарий", uz: "Izoh" }, note: { ru: "Примечание", uz: "Eslatma" }, notes: { ru: "Примечание", uz: "Eslatma" },
  changes: { ru: "Изменения", uz: "O'zgarishlar" }, changed: { ru: "Изменено", uz: "O'zgartirildi" }, fields: { ru: "Поля", uz: "Maydonlar" },
  updated: { ru: "Обновлено", uz: "Yangilandi" }, failed: { ru: "Не удалось", uz: "Bajarilmadi" }, applied: { ru: "Применено", uz: "Qo'llanildi" },
  // ключи, интеграции, платформа
  url: { ru: "Адрес", uz: "Manzil" }, username: { ru: "Логин", uz: "Login" }, preset: { ru: "Конфигурация", uz: "Konfiguratsiya" },
  enabled: { ru: "Включено", uz: "Yoqilgan" }, intervalMinutes: { ru: "Интервал, мин", uz: "Interval, daq" },
  prefix: { ru: "Ключ", uz: "Kalit" }, scopes: { ru: "Права", uz: "Huquqlar" }, expiresAt: { ru: "Действует до", uz: "Amal qiladi" },
  slug: { ru: "Код организации", uz: "Tashkilot kodi" }, extraUsers: { ru: "Доп. сотрудников", uz: "Qo'shimcha xodimlar" }, extraProducts: { ru: "Доп. товаров", uz: "Qo'shimcha tovarlar" },
  plan: { ru: "Тариф", uz: "Tarif" }, days: { ru: "Дней", uz: "Kun" }, filename: { ru: "Файл", uz: "Fayl" }, size: { ru: "Размер", uz: "Hajm" },
  deleted: { ru: "Удалено записей", uz: "O'chirilgan yozuvlar" }, retentionDays: { ru: "Хранить дней", uz: "Saqlash kunlari" },
  month: { ru: "Месяц", uz: "Oy" }, monthStart: { ru: "Месяц", uz: "Oy" },
};

/** Подписи действий журнала — по-русски и по-узбекски; на экране и в CSV одни слова. */
export const AUDIT_ACTION_LABEL: Record<string, Label> = {
  "cash.handover": { ru: "Сдача наличных в кассу", uz: "Naqd pul kassaga topshirildi" },
  "cash.expense": { ru: "Расход из кассы", uz: "Kassadan xarajat" },
  "cash.deposit": { ru: "Внесение в кассу", uz: "Kassaga kiritish" },
  "cash.withdrawal": { ru: "Выемка из кассы", uz: "Kassadan olish" },
  "cash.write_off": { ru: "Списан долг сотрудника", uz: "Xodim qarzi hisobdan chiqarildi" },
  "cash.storno": { ru: "Сторно кассового документа", uz: "Kassa hujjati stornosi" },
  "cash.day_closed": { ru: "Касса: день закрыт", uz: "Kassa: kun yopildi" },
  "cash.day_reopened": { ru: "Касса: день открыт снова", uz: "Kassa: kun qayta ochildi" },
  "user.updated": { ru: "Обновлён пользователь", uz: "Foydalanuvchi yangilandi" },
  "user.deactivated": { ru: "Пользователь деактивирован", uz: "Foydalanuvchi o'chirildi" },
  "user.password_reset_by_admin": { ru: "Сброс пароля", uz: "Parol tiklandi" },
  "user.credentials_transferred": { ru: "Доступ передан другому", uz: "Kirish boshqa odamga o'tkazildi" },
  "user.login_changed": { ru: "Сменён логин входа", uz: "Kirish logini o'zgartirildi" },
  "user.totp_enable": { ru: "Включён код-подтверждение", uz: "Tasdiqlash kodi yoqildi" },
  "user.totp_disable": { ru: "Отключён код-подтверждение", uz: "Tasdiqlash kodi o'chirildi" },
  "access.operator": { ru: "Права оператора изменены", uz: "Operator huquqlari o'zgartirildi" },
  "api_key.created": { ru: "Создан ключ API", uz: "API kaliti yaratildi" },
  "api_key.revoked": { ru: "Отозван ключ API", uz: "API kaliti bekor qilindi" },
  "api_key.status": { ru: "Ключ API включён/выключен", uz: "API kaliti yoqildi/o'chirildi" },
  "order.create": { ru: "Создан заказ", uz: "Buyurtma yaratildi" },
  "order.cancelled": { ru: "Заказ отменён", uz: "Buyurtma bekor qilindi" },
  "order.bulk_status_change": { ru: "Массовая смена статуса заказов", uz: "Buyurtmalar holati ommaviy o'zgartirildi" },
  "order.invoices_printed": { ru: "Напечатаны накладные", uz: "Yuk xatlari chop etildi" },
  "order.payment_recorded": { ru: "Принята оплата", uz: "To'lov qabul qilindi" },
  "order.reopened": { ru: "Заказ возвращён в работу", uz: "Buyurtma ishga qaytarildi" },
  "order.update": { ru: "Изменены условия заказа", uz: "Buyurtma shartlari o'zgartirildi" },
  "order.update_items": { ru: "Изменён состав заказа", uz: "Buyurtma tarkibi o'zgartirildi" },
  "order.delete": { ru: "Заказ удалён", uz: "Buyurtma o'chirildi" },
  "order.restore": { ru: "Заказ восстановлен", uz: "Buyurtma tiklandi" },
  "order.revenue_reversed": { ru: "Доставка отменена задним числом", uz: "Yetkazish orqaga qaytarildi" },
  "payment.reverse": { ru: "Оплата отменена", uz: "To'lov bekor qilindi" },
  "payment.bank_confirm": { ru: "Безнал подтверждён выпиской", uz: "Naqdsiz to'lov ko'chirma bilan tasdiqlandi" },
  "return.status": { ru: "Возврат: смена статуса", uz: "Qaytarish: holat o'zgardi" },
  "shop.credit_limit_changed": { ru: "Изменён кредитный лимит магазина", uz: "Do'kon kredit limiti o'zgartirildi" },
  "product.updated": { ru: "Обновлён товар", uz: "Tovar yangilandi" },
  "product.deleted": { ru: "Удалён товар", uz: "Tovar o'chirildi" },
  "price_list.item_set": { ru: "Цена в прайс-листе", uz: "Narxlar ro'yxatida narx" },
  "price_list.deleted": { ru: "Удалён прайс-лист", uz: "Narxlar ro'yxati o'chirildi" },
  "stock.adjusted": { ru: "Корректировка склада", uz: "Ombor tahrirlandi" },
  "stock.transfer_completed": { ru: "Перемещение между складами", uz: "Omborlar orasida ko'chirish" },
  "control.enabled": { ru: "Контроль включён", uz: "Nazorat yoqildi" },
  "control.disabled": { ru: "Контроль выключен", uz: "Nazorat o'chirildi" },
  "control.shop_confirmed": { ru: "Магазин подтвердил получение", uz: "Do'kon qabul qilganini tasdiqladi" },
  "control.shop_disputed": { ru: "Магазин оспорил доставку", uz: "Do'kon yetkazishni rad etdi" },
  "stock_count.create": { ru: "Начата инвентаризация", uz: "Inventarizatsiya boshlandi" },
  "stock_count.apply": { ru: "Инвентаризация проведена", uz: "Inventarizatsiya o'tkazildi" },
  "stock_count.cancel": { ru: "Инвентаризация отменена", uz: "Inventarizatsiya bekor qilindi" },
  "arrival.completed": { ru: "Приход оприходован", uz: "Kirim qabul qilindi" },
  "product.cost_averaged": { ru: "Себестоимость усреднена по приходу", uz: "Tannarx kirim bo'yicha o'rtacha hisoblandi" },
  "supplier.return_goods": { ru: "Возврат поставщику", uz: "Yetkazib beruvchiga qaytarish" },
  "loading_list.created": { ru: "Создан лист загрузки", uz: "Yuklash varag'i yaratildi" },
  "loading_list.picked": { ru: "Лист загрузки собран", uz: "Yuklash varag'i yig'ildi" },
  "salary.rate_set": { ru: "Установлена ставка зарплаты", uz: "Ish haqi stavkasi belgilandi" },
  "salary.fraud_deduction": { ru: "Удержание из зарплаты", uz: "Ish haqidan ushlab qolish" },
  "settings.updated": { ru: "Изменены настройки", uz: "Sozlamalar o'zgartirildi" },
  "onec.config_saved": { ru: "Сохранены настройки 1C", uz: "1C sozlamalari saqlandi" },
  "integration.onec_secret_rotated": { ru: "Ротация ключа 1C", uz: "1C kalit almashtirildi" },
  "tenant.updated": { ru: "Обновлена организация", uz: "Tashkilot yangilandi" },
  "tenant.extra_limits": { ru: "Изменены лимиты организации", uz: "Tashkilot limitlari o'zgartirildi" },
  "tenant.sandbox.create": { ru: "Создана песочница", uz: "Sinov muhiti yaratildi" },
  "tenant.manual_granted": { ru: "Выдано руководство", uz: "Qo'llanma berildi" },
  "tenant.manual_revoked": { ru: "Руководство отключено", uz: "Qo'llanma o'chirildi" },
  "system.backup_downloaded": { ru: "Скачана копия базы", uz: "Baza nusxasi yuklab olindi" },
  "audit.purged": { ru: "Очищен журнал аудита", uz: "Audit jurnali tozalandi" },
};

/** Служебные номера: человеку они ничего не говорят, а имя рядом уже есть. */
const HIDDEN = new Set(["shopId", "productId", "warehouseId", "agentId", "orderId", "paymentId", "reversalId", "fromWarehouseId", "toWarehouseId"]);
const MONEY_KEYS = new Set(["amount", "total", "sum", "remaining", "creditLimit", "price", "was", "unitPrice", "costPrice", "credited", "baseSalary", "totalBefore", "totalAfter"]);
const PERCENT_KEYS = new Set(["discountPct", "commissionRate"]);
const WEIGHT_KEYS = new Set(["totalWeight"]);
const DATE_KEYS = new Set(["expiresAt", "monthStart"]);
const STATUS_KEYS = new Set(["from", "to", "status", "newStatus", "statusBefore"]);
const BOOL: Label = { ru: "да", uz: "ha" }; const BOOL_NO: Label = { ru: "нет", uz: "yo'q" };

const FIELD_LABEL: Record<string, Label> = {
  name: { ru: "название", uz: "nomi" }, phone: { ru: "телефон", uz: "telefon" }, email: { ru: "почта", uz: "pochta" }, role: { ru: "роль", uz: "rol" },
  status: { ru: "статус", uz: "holat" }, address: { ru: "адрес", uz: "manzil" }, unitPrice: { ru: "цена", uz: "narx" }, costPrice: { ru: "себестоимость", uz: "tannarx" },
  creditLimit: { ru: "кредитный лимит", uz: "kredit limiti" }, code: { ru: "код", uz: "kod" }, category: { ru: "категория", uz: "toifa" },
  unit: { ru: "единица", uz: "birlik" }, minStock: { ru: "мин. остаток", uz: "min. qoldiq" }, territoryId: { ru: "территория", uz: "hudud" },
  reorderPoint: { ru: "точка дозаказа", uz: "qayta buyurtma nuqtasi" }, unitWeight: { ru: "вес единицы", uz: "birlik vazni" },
  packSize: { ru: "упаковка", uz: "qadoq" }, packLabel: { ru: "название упаковки", uz: "qadoq nomi" }, description: { ru: "описание", uz: "tavsif" },
  barcode: { ru: "штрих-код", uz: "shtrix-kod" }, companyName: { ru: "название компании", uz: "kompaniya nomi" }, logoUrl: { ru: "логотип", uz: "logotip" },
  currency: { ru: "валюта", uz: "valyuta" }, timezone: { ru: "часовой пояс", uz: "vaqt mintaqasi" },
};

/** Статусы, которых нет среди статусов заказа: доступ, ключи, возвраты. */
const EXTRA_STATUS: Record<string, Label> = {
  ...ACTIVE_STATUS_LABEL,
  revoked: { ru: "Отозван", uz: "Bekor qilingan" },
  approved: { ru: "Одобрен", uz: "Tasdiqlangan" }, rejected: { ru: "Отклонён", uz: "Rad etilgan" }, completed: { ru: "Завершён", uz: "Yakunlangan" },
};
const DISPOSITION: Record<string, Label> = {
  restock: { ru: "на склад", uz: "omborga" }, write_off: { ru: "списание", uz: "hisobdan chiqarish" },
};
const FORMAT: Record<string, Label> = {
  aggregated: { ru: "сводный", uz: "jamlangan" }, byRoute: { ru: "по маршрутам", uz: "marshrut bo'yicha" },
};

function money(v: unknown): string {
  const n = Number(v);
  // Разряды через обычный пробел, а не через toLocaleString: у него пробел
  // неразрывный и зависит от ICU — в тестах и в CSV это разные строки.
  return Number.isFinite(n) ? `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} сум` : String(v);
}

/** Число без хвоста двоичной дроби: 510.2000000000001 → «510,2». */
function num(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const r = Math.round(n * 100) / 100;
  return String(r).replace(".", ",");
}

function day(v: unknown): string {
  const s = String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}

function word(key: string, v: unknown, lang: Lang): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? BOOL[lang] : BOOL_NO[lang];
  if (MONEY_KEYS.has(key)) return money(v);
  if (PERCENT_KEYS.has(key)) return `${num(v)} %`;
  if (WEIGHT_KEYS.has(key)) return `${num(v)} ${lang === "uz" ? "kg" : "кг"}`;
  if (DATE_KEYS.has(key)) return day(v);
  if (key === "method" || key === "paymentMethod") return labelled(PAYMENT_METHOD_LABEL, v, lang);
  if (STATUS_KEYS.has(key)) return labelled({ ...EXTRA_STATUS, ...ORDER_STATUS_LABEL }, v, lang);
  if (key === "actorRole" || key === "role" || key === "ROLE") return labelled(ROLE_LABEL, v, lang);
  if (key === "disposition") return labelled(DISPOSITION, v, lang);
  if (key === "format") return labelled(FORMAT, v, lang);
  if (key === "type") return movementKind(String(v), lang);
  if (key === "items" || key === "lines" || key === "shortages" || key === "orders") return Array.isArray(v) ? String(v.length) : String(v);
  if (key === "failed" || key === "updated") return Array.isArray(v) ? String(v.length) : String(v);
  if (key === "changed" && Array.isArray(v)) return v.map(f => FIELD_LABEL[String(f)]?.[lang] ?? String(f)).join(", ");
  if (key === "scopes" && Array.isArray(v)) return v.join(", ");
  if (Array.isArray(v)) return v.length > 6 ? `${v.length}` : v.map(x => String(x)).join(", ");
  if (typeof v === "number") return num(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Пусто ли значение так, что печатать нечего: нуль скидки, пустой список. */
function silent(key: string, v: unknown): boolean {
  if (v === null || v === undefined || v === "") return true;
  if (Array.isArray(v) && v.length === 0) return true;
  if (PERCENT_KEYS.has(key) && Number(v) === 0) return true;
  if ((key === "failed" || key === "shortages") && Number(v) === 0) return true;
  return false;
}

/**
 * Одна строка подробностей: «Сумма: 150 000 сум · Оплата: Наличные ·
 * Отгружен → Доставлен».
 *
 * targetLabel — то, что уже стоит в заголовке записи (номер заказа, листа,
 * прихода): повторять его в подробностях незачем.
 */
export function describeMeta(meta: Record<string, unknown> | null | undefined, lang: Lang, targetLabel?: string | null): string {
  if (!meta) return "";
  const parts: string[] = [];
  const m = { ...meta };
  if (m.from !== undefined && m.to !== undefined) {
    parts.push(`${word("from", m.from, lang)} → ${word("to", m.to, lang)}`);
    delete m.from; delete m.to;
  }
  if (m.totalBefore !== undefined && m.totalAfter !== undefined) {
    parts.push(`${KEY_LABEL.total[lang]}: ${money(m.totalBefore)} → ${money(m.totalAfter)}`);
    delete m.totalBefore; delete m.totalAfter;
  }
  // Пары «было / стало» полей: changes из правки магазина, before/after из правки сотрудника.
  const pairs = (m.changes && typeof m.changes === "object" ? m.changes : m.changed && typeof m.changed === "object" && !Array.isArray(m.changed) ? m.changed : null) as Record<string, { from: unknown; to: unknown }> | null;
  if (pairs) {
    for (const [f, ch] of Object.entries(pairs)) {
      const label = FIELD_LABEL[f]?.[lang] ?? f;
      parts.push(`${label}: ${word(f, ch?.from, lang)} → ${word(f, ch?.to, lang)}`);
    }
    delete m.changes; if (!Array.isArray(m.changed)) delete m.changed;
  }
  const before = m.before as Record<string, unknown> | undefined, after = m.after as Record<string, unknown> | undefined;
  if (before && after && typeof before === "object" && typeof after === "object") {
    for (const f of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (before[f] === after[f]) continue;
      const label = FIELD_LABEL[f]?.[lang] ?? f;
      parts.push(`${label}: ${word(f, before[f], lang)} → ${word(f, after[f], lang)}`);
    }
    delete m.before; delete m.after;
  }
  for (const [k, v] of Object.entries(m)) {
    if (HIDDEN.has(k) || silent(k, v)) continue;
    if (targetLabel && typeof v === "string" && targetLabel.includes(v)) continue;
    const label = KEY_LABEL[k]?.[lang] ?? k.replace(/([A-Z])/g, " $1").replace(/_/g, " ").toLowerCase();
    parts.push(`${label}: ${word(k, v, lang)}`);
  }
  return parts.join(" · ");
}
