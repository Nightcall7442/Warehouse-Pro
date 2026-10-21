import type { ArticleKey } from "@contracts/site-pages";
import type { ArticleText } from "../types";
import { AGENTS_ARTICLE } from "./agents";
import { DEBTS_ARTICLE } from "./debts";
import { RECONCILIATION_ARTICLE } from "./reconciliation";
import { DELIVERY_ARTICLE } from "./delivery";
import { WAREHOUSE_ARTICLE } from "./warehouse";

/**
 * Все тексты статей — для сборки (<head>: заголовок статьи и FAQPage) и
 * проверок. Браузеру этот список не нужен: страница статьи берёт только
 * свой текст, и в её кусок не едут остальные четыре.
 */
export const ARTICLE_TEXTS: Record<ArticleKey, ArticleText> = {
  agents: AGENTS_ARTICLE,
  debts: DEBTS_ARTICLE,
  reconciliation: RECONCILIATION_ARTICLE,
  delivery: DELIVERY_ARTICLE,
  warehouse: WAREHOUSE_ARTICLE,
};
