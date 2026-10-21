import { FIELD_PRICE_UZS, MIN_FIELD_USERS, formatSum } from "@contracts/pricing";
import type { L } from "@/components/pitch/pitch-content";

const PRICE = formatSum(FIELD_PRICE_UZS);

/**
 * Цена одной строкой — под призывом в конце статьи (src/site/articles).
 *
 * Цена платформы, а не документ арендатора: в сумах и только в сумах, как
 * на лендинге (printing-is-usable, «валюта нигде не вписана словом»). Числа —
 * из contracts/pricing: сменится цена там — сменится и здесь.
 *
 * Отдельным файлом, а не в site-content: статье не нужно тянуть все тексты
 * лендинга ради одной строки.
 */
export const PRICE_LINE: L = {
  ru: `14 дней бесплатно, без карты. Дальше — ${PRICE} сум в месяц за каждого агента, курьера или мерчендайзера, от ${MIN_FIELD_USERS} человек; директор, офис и склад — бесплатно.`,
  uz: `14 kun bepul, kartasiz. Keyin — har bir agent, kuryer yoki merchendayzer uchun oyiga ${PRICE} so'm, kamida ${MIN_FIELD_USERS} nafar; direktor, ofis va ombor — bepul.`,
};
