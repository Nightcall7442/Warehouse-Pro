import ArticleLayout from "./ArticleLayout";
import { RECONCILIATION_ARTICLE } from "./texts/reconciliation";

/** Статья сайта «акт сверки» — /reconciliation-act и /uz/reconciliation-act. Свой кусок: текст едет только с ней. */
export default function ReconciliationArticle() {
  return <ArticleLayout article={RECONCILIATION_ARTICLE} />;
}
