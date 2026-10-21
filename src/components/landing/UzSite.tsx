import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { UrlLang, type Lang } from "@/i18n";
import { sitePath } from "@/lib/site-paths";

/**
 * Узбекская страница сайта: /uz, /uz/compare.
 *
 * Язык берётся из адреса и не сохраняется (UrlLang): ссылка /uz, присланная
 * в Telegram, открывается по-узбекски у любого, но не переключает ему всё
 * приложение. Нажатие «Ру» — явный выбор: он сохраняется, и человек уходит на
 * русскую страницу того же раздела, с теми же метками в адресе (utm_*).
 */
export default function UzSite({ path, children }: { path: string; children: ReactNode }) {
  const navigate = useNavigate();
  const { search, hash } = useLocation();
  const onSwitch = (l: Lang) => navigate(sitePath(l, path) + search + hash);
  return <UrlLang lang="uz" onSwitch={onSwitch}>{children}</UrlLang>;
}
