/**
 * Открытые страницы отдаются и роботам превью ссылок.
 *
 * Сервер отдавал оболочку приложения только на «Accept: text/html». Робот
 * Telegram, Facebook и бот конкурса Pitch Day шлют «*\/*» или ничего — и
 * получали 404 в JSON: карточка ссылки на /pitch не строилась, проверка
 * ссылки видела «страницы нет» (05.10.2026, бой: curl -A TelegramBot → 404).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { wantsAppShell } from "../lib/public-pages";

const BOT_ACCEPTS = ["*/*", "", "text/plain, */*"];

describe("wantsAppShell — кому отдавать страницу", () => {
  it.each(["/pitch", "/demo", "/pitch/", "/landing", "/privacy"])("%s — оболочка и роботу, на любой Accept", p => {
    for (const a of BOT_ACCEPTS) {
      expect(wantsAppShell(p, "GET", a)).toBe(true);
      expect(wantsAppShell(p, "HEAD", a)).toBe(true);
    }
  });

  it("браузеру — оболочка на любом адресе, как и раньше", () => {
    expect(wantsAppShell("/orders", "GET", "text/html,application/xhtml+xml")).toBe(true);
    expect(wantsAppShell("/pitch", "GET", "text/html")).toBe(true);
  });

  it("прочие адреса без text/html — по-прежнему 404 (опечатка в адресе API не отвечает страницей)", () => {
    for (const a of BOT_ACCEPTS) {
      expect(wantsAppShell("/api/v1/nope", "GET", a)).toBe(false);
      expect(wantsAppShell("/orders", "GET", a)).toBe(false);
      expect(wantsAppShell("/pitchx", "GET", a)).toBe(false);
    }
  });

  it("не GET/HEAD — не оболочка даже открытой странице", () => {
    expect(wantsAppShell("/pitch", "POST", "*/*")).toBe(false);
  });

  it("сервер решает через wantsAppShell, а не голой проверкой Accept", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../lib/vite.ts"), "utf8");
    const nf = src.slice(src.indexOf("app.notFound("));
    expect(nf).toMatch(/wantsAppShell\(c\.req\.path, c\.req\.method/);
    expect(nf).not.toMatch(/accept\.includes\("text\/html"\)/);
  });
});
