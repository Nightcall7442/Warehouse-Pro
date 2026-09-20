/**
 * Текст уведомления — на языке экрана (lib/notification-text).
 *
 * Сервер хранит русский в title/message и узбекский рядом (с 20.09.2026).
 * Узбекский экран берёт узбекский, где он есть; у старых записей и служебных
 * его нет — показывается русский, а не пусто.
 *
 * Нарочная поломка: верни `title: n.title` без выбора — упадёт «узбекский»;
 * убери `|| n.title` — упадёт «старая запись».
 */
import { describe, it, expect } from "vitest";
import { notificationText } from "@/lib/notification-text";

describe("текст уведомления по языку", () => {
  const n = { title: "Заказ доставлен", message: "ORD-1 — 100% оплачен", titleUz: "Buyurtma yetkazildi", messageUz: "ORD-1 — 100% to'langan" };
  it("узбекский экран — узбекский текст", () => {
    expect(notificationText(n, "uz")).toEqual({ title: "Buyurtma yetkazildi", message: "ORD-1 — 100% to'langan" });
  });
  it("русский экран — русский", () => {
    expect(notificationText(n, "ru")).toEqual({ title: "Заказ доставлен", message: "ORD-1 — 100% оплачен" });
  });
  it("старая запись без узбекского — русский, а не пусто", () => {
    expect(notificationText({ title: "Подключите Telegram", message: "Настройки → Telegram", titleUz: null, messageUz: null }, "uz"))
      .toEqual({ title: "Подключите Telegram", message: "Настройки → Telegram" });
    expect(notificationText({ title: "Без текста" }, "uz")).toEqual({ title: "Без текста", message: null });
  });
});
