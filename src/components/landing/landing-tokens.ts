/**
 * Общие значения лендинга: палитра, шрифты, контакты, ссылка в Telegram и
 * наблюдатель за появлением блока в поле зрения.
 *
 * Вынесено из landing-shared.tsx, где лежало вперемешку с компонентами. Пока
 * в одном файле и то и другое, горячая перезагрузка при правке не может
 * обновить страницу частично — она перезагружает её целиком, теряя прокрутку
 * и уже проигранные появления блоков.
 */
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

export const cn = (...classes: (string | false | null | undefined)[]) =>
  classes.filter(Boolean).join(" ");

export const LX = {
  paper: "#f4f2ed",
  paperRaised: "#faf9f5",
  ink: "#26231e",
  inkHover: "#33302a",
  /* Текстовые тона проверены на контраст по WCAG AA к #f4f2ed. */
  inkSoft: "#57534a", // 7.0:1
  inkFaint: "#6e6a60", // 4.8:1 — минимум для мелких подписей
  rule: "rgba(72,66,55,0.16)",
  ruleStrong: "rgba(72,66,55,0.34)",
  /* Латунь в двух тонах: графическая (печать, линии, крупные цифры) и
     текстовая — затемнена до 5.0:1, потому что #a8763e на бумаге даёт лишь
     3.5:1 и мелкий текст им не набрать. */
  brass: "#a8763e",
  brassText: "#8a5f2e",
  brassSoft: "rgba(168,118,62,0.10)",
  paperOnInk: "#f0eee8", // 13.6:1 на чернилах
  softOnInk: "rgba(240,238,232,0.62)",
  faintOnInk: "rgba(240,238,232,0.38)", // только для декоративного, не текста
  ruleOnInk: "rgba(240,238,232,0.14)",
  /* Статусные тона. Проверены на 4.5:1 к обоим бумажным фонам — здесь ими
     набирается мелкий текст (10.5px в таблице заказов и подписях KPI), а не
     только рисуются точки. Прежние #5f7d4e и #b05a44 давали 4.14 и 4.27 на
     основной бумаге, то есть формально не читались; жёлтый #a8763e — 3.52 и
     для текста не годился совсем, поэтому статус «в пути» теперь берёт
     brassText. */
  good: "#4f6a40", // 5.75 / 5.41
  warn: "#8a5f2e", // = brassText, 5.31 / 5.00
  bad: "#9c4a35", // 5.79 / 5.45
  /* Графические тона: только заливки, точки и линии — контраст текста к ним
     не применяется. */
  goodDot: "#5f7d4e",
  badDot: "#b05a44",
} as const;

export const MONO: CSSProperties = {
  fontFamily: "'DM Mono', ui-monospace, 'Cascadia Mono', monospace",
  fontVariantNumeric: "tabular-nums",
};

/**
 * Контакты отдела продаж. null скрывает соответствующие кнопки.
 *
 * Намеренно не заполнены выдуманными значениями: телефон, по которому никто
 * не ответит, и мёртвая ссылка t.me для покупателя «по доверию» хуже их
 * отсутствия. Впишите реальный @username и номер — кнопки «Написать в
 * Telegram» (hero, тарифы, CTA, мобильная панель) появятся сами.
 */
export const CONTACT: { telegram: string | null; phone: string | null } = {
  telegram: null,
  phone: null,
};

export const tgLink = (text?: string) =>
  CONTACT.telegram
    ? `https://t.me/${CONTACT.telegram}${text ? `?text=${encodeURIComponent(text)}` : ""}`
    : null;

export function useInView<T extends HTMLElement>(threshold = 0.3) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return { ref, seen };
}
