import ArticleLayout from "./ArticleLayout";
import { AGENTS_ARTICLE } from "./texts/agents";

/** Статья сайта «торговые агенты» — /sales-agents и /uz/sales-agents. Свой кусок: текст едет только с ней. */
export default function AgentsArticle() {
  return <ArticleLayout article={AGENTS_ARTICLE} />;
}
