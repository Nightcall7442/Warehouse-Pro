import ArticleLayout from "./ArticleLayout";
import { DELIVERY_ARTICLE } from "./texts/delivery";

/** Статья сайта «доставка и деньги курьера» — /delivery-cash и /uz/delivery-cash. Свой кусок: текст едет только с ней. */
export default function DeliveryArticle() {
  return <ArticleLayout article={DELIVERY_ARTICLE} />;
}
