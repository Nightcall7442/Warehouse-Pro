import { useMemo } from "react";
import { trpc } from "@/providers/trpc";
import type { CompanyInfo } from "@/lib/documents";

/**
 * Кто продавец на бумаге.
 *
 * ── Зачем одно место ────────────────────────────────────────────────────────
 *
 * Реквизиты продавца собирались тремя экранами по отдельности — карточкой
 * заказа, боковой панелью и окном пакетной печати, — и все три писали одно и
 * то же с одной и той же подстановкой:
 *
 *     name: settings?.companyName ?? "Warehouse Pro"
 *
 * Пока настройки не приехали (а печать доступна сразу), накладная уходила
 * покупателю арендатора подписанной именем поставщика системы. Теперь имени
 * нет вовсе, пока его не прочитали: `buildDocData` на пустом имени возвращает
 * null, и печать просто не открывается — это лучше, чем документ с чужой
 * шапкой.
 *
 * ── Откуда что берётся ──────────────────────────────────────────────────────
 *
 * Реквизиты — из settings, раздел «Компания»: имя, адрес, ИНН, директор, банк.
 * Там же валюта и логотип для бумаг («Печатается на счёте» — так и написано
 * под кнопкой загрузки).
 *
 * Из «Брендинга» берётся только подпись в подвале: это оформление, а не
 * реквизит. Знак оттуда идёт запасным — арендатор, загрузивший логотип один
 * раз, вправе не грузить его второй.
 */
export function useSellerCompany() {
  const settings = trpc.settings.get.useQuery();
  const branding = trpc.branding.get.useQuery();

  const company: CompanyInfo = useMemo(() => ({
    name:     settings.data?.companyName ?? "",
    address:  settings.data?.companyAddress ?? undefined,
    inn:      settings.data?.companyInn ?? undefined,
    director: settings.data?.companyDirector ?? undefined,
    bank:     settings.data?.companyBank ?? undefined,
    account:  settings.data?.companyBankAccount ?? undefined,
    mfo:      settings.data?.companyMfo ?? undefined,
    phone:    settings.data?.companyPhone ?? undefined,
    logoUrl:  settings.data?.logoUrl ?? branding.data?.logoUrl ?? undefined,
  }), [settings.data, branding.data]);

  return {
    company,
    currency:   settings.data?.currencySymbol ?? "сум",
    footerNote: branding.data?.footerText ?? undefined,
    /** Реквизиты ещё не прочитаны — печатать нечего. */
    isReady:    company.name.trim().length > 0,
  };
}
