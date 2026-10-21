import ArticleLayout from "./ArticleLayout";
import { DEBTS_ARTICLE } from "./texts/debts";

/** Статья сайта «долги магазинов» — /shop-debts и /uz/shop-debts. Свой кусок: текст едет только с ней. */
export default function DebtsArticle() {
  return <ArticleLayout article={DEBTS_ARTICLE} />;
}
