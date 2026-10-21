import ArticleLayout from "./ArticleLayout";
import { WAREHOUSE_ARTICLE } from "./texts/warehouse";

/** Статья сайта «склад дистрибьютора» — /distributor-warehouse и /uz/distributor-warehouse. Свой кусок: текст едет только с ней. */
export default function WarehouseArticle() {
  return <ArticleLayout article={WAREHOUSE_ARTICLE} />;
}
