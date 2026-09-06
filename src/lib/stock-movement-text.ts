/**
 * История движений товара, сказанная словами.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * И на экране товара, и в выгрузке в Excel история печаталась значениями из
 * базы как есть:
 *
 *     OUT   manual_adjustment #null   Заказ: new → delivered
 *     IN    order_delivery #1342
 *
 * Владелец прислал оба снимка и назвал файл нечитаемым. Он прав: «null» — это
 * отсутствие номера документа, вылезшее на экран; «manual_adjustment» —
 * внутреннее слово, которого нет ни на одной бумаге; «new → delivered» — коды
 * состояний заказа, хотя рядом в приложении они же показываются
 * по-человечески.
 *
 * ── Почему одно место на экран и на файл ────────────────────────────────────
 *
 * Разбор был выписан дважды — в ProductDetail и в formatMovementsForExport, —
 * и обе копии печатали одно и то же неверно. Поправить одну и забыть вторую
 * было бы ровно тем же, чем это уже кончилось однажды.
 *
 * ── Два словаря вместо одного ───────────────────────────────────────────────
 *
 * Причина движения писалась в разное время по-разному: старые строки несут
 * «arrival» и «order», новые — список из services/stock-ledger.ts
 * («order_delivery», «manual_adjustment», …). В базе лежит и то и другое, и
 * читать надо оба: переписывать историю задним числом нельзя, это учётный
 * документ.
 */

type Lang = string;
const pick = (lang: Lang, ru: string, uz: string) => (lang === "uz" ? uz : ru);

/** Направление движения: приход, расход или правка счёта. */
export function movementKind(type: string | null | undefined, lang: Lang = "ru"): string {
  switch (type) {
    case "in":  return pick(lang, "Приход", "Kirim");
    case "out": return pick(lang, "Расход", "Chiqim");
    default:    return pick(lang, "Правка", "Tuzatish");
  }
}

/** Документы, у которых есть номер: на них можно сослаться. */
const NUMBERED: Record<string, { ru: string; uz: string }> = {
  arrival:          { ru: "Приход",             uz: "Kirim" },
  order:            { ru: "Заказ",              uz: "Buyurtma" },
  order_delivery:   { ru: "Доставка заказа",    uz: "Buyurtma yetkazish" },
  order_return:     { ru: "Возврат по заказу",  uz: "Buyurtma qaytarish" },
  order_edit:       { ru: "Правка заказа",      uz: "Buyurtma tahriri" },
  return_completed: { ru: "Оформленный возврат", uz: "Rasmiylashtirilgan qaytarish" },
  transfer_out:     { ru: "Перемещение со склада", uz: "Ombordan ko'chirish" },
  transfer_in:      { ru: "Перемещение на склад",  uz: "Omborga ko'chirish" },
};

/** События без своего документа: номера у них нет и быть не может. */
const UNNUMBERED: Record<string, { ru: string; uz: string }> = {
  manual_adjustment: { ru: "Ручная правка",     uz: "Qo'lda tuzatish" },
  import:            { ru: "Загрузка из файла", uz: "Fayldan yuklash" },
  onec_sync:         { ru: "Обмен с 1С",        uz: "1C bilan almashinuv" },
};

/**
 * Чем вызвано движение.
 *
 * Здесь стояло `${referenceType} #${referenceId}` без единой проверки. У
 * ручной правки номера документа нет — и на экран выходило «#null», слово,
 * которого человек не должен видеть никогда.
 */
export function movementDocument(
  referenceType: string | null | undefined,
  referenceId: number | string | null | undefined,
  lang: Lang = "ru",
): string {
  if (!referenceType) return "—";

  const plain = UNNUMBERED[referenceType];
  if (plain) return pick(lang, plain.ru, plain.uz);

  const numbered = NUMBERED[referenceType];
  const name = numbered ? pick(lang, numbered.ru, numbered.uz) : referenceType;

  // Номера может не быть и у документа: тогда называем документ без него,
  // а не приписываем «null».
  const hasNumber = referenceId !== null && referenceId !== undefined && String(referenceId) !== "";
  return hasNumber ? `${name} №${referenceId}` : name;
}

/** Состояния заказа так, как они называются на остальных экранах. */
const ORDER_STATUS: Record<string, { ru: string; uz: string }> = {
  new:        { ru: "Новый",       uz: "Yangi" },
  processing: { ru: "В обработке", uz: "Jarayonda" },
  shipped:    { ru: "Отгружён",    uz: "Yuklandi" },
  pending:    { ru: "В ожидании",  uz: "Kutishda" },
  delivered:  { ru: "Доставлен",   uz: "Yetkazildi" },
  cancelled:  { ru: "Отменён",     uz: "Bekor qilindi" },
  returned:   { ru: "Возврат",     uz: "Qaytarildi" },
};

/**
 * Заметка к движению.
 *
 * Сервер пишет её строкой «Заказ: new → delivered» — коды состояний, хотя на
 * соседнем экране те же состояния названы словами. Переписывать уже
 * записанные заметки нельзя (это учётный документ), поэтому коды заменяются
 * при показе, и старые строки читаются наравне с новыми.
 */
export function movementNote(notes: string | null | undefined, lang: Lang = "ru"): string {
  const text = (notes ?? "").trim();
  if (!text) return "—";

  return text.replace(/\b[a-z_]+\b/g, word => {
    const status = ORDER_STATUS[word];
    return status ? pick(lang, status.ru, status.uz) : word;
  });
}
