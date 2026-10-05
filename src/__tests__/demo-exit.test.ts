/**
 * Выход из демо жюри ведёт обратно к выбору роли, а не на /login.
 *
 * У жюри нет логина и пароля: «Выйти» на /login выглядел тупиком («как
 * назад?», 05.10.2026). Обычные пользователи по-прежнему уходят на /login.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { logoutTarget, DEMO_RETURN_PATH } from "@/lib/demo-exit";
import { LOGIN_PATH } from "@/const";

describe("logoutTarget — куда после выхода", () => {
  it("демо-сессия — на /demo к выбору роли", () => {
    expect(logoutTarget({ demo: true })).toBe(DEMO_RETURN_PATH);
    expect(DEMO_RETURN_PATH.startsWith("/demo")).toBe(true);
  });

  it("обычный пользователь и пустой — на /login, как раньше", () => {
    expect(logoutTarget({ demo: false })).toBe(LOGIN_PATH);
    expect(logoutTarget({})).toBe(LOGIN_PATH);
    expect(logoutTarget(null)).toBe(LOGIN_PATH);
    expect(logoutTarget(undefined)).toBe(LOGIN_PATH);
  });

  it("useAuth.logout уводит через logoutTarget, а не жёстко на LOGIN_PATH", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../hooks/useAuth.ts"), "utf8");
    const body = src.slice(src.indexOf("const logout = useCallback"), src.indexOf("}, []);", src.indexOf("const logout = useCallback")));
    expect(body).toMatch(/window\.location\.replace\(logoutTarget\(/);
    expect(body).not.toMatch(/window\.location\.replace\(LOGIN_PATH\)/);
  });

  it("полоса демо — одна кнопка «к выбору роли», и она выходит (logout), а не просто переходит", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../components/DemoBanner.tsx"), "utf8");
    expect(src).toMatch(/data-testid="demo-back"[\s\S]{0,80}onClick=\{\(\) => \{ void logout\(\); \}\}/);
    expect(src).toMatch(/Boshqa rolni tanlash/);
    expect(src).not.toMatch(/<Link to="\/demo"/);
  });
});
