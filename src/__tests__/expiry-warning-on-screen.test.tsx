// @vitest-environment jsdom
/**
 * Срок подписки истёк — что видит человек на сайте (решение владельца
 * 10.10.2026: предупреждение → 24 часа → доступ закрыт).
 *
 *  · полоса «Срок вашей подписки истёк» с временем закрытия по Ташкенту — на
 *    каждой странице и без крестика;
 *  · руководителю — «Продлить» на /billing, остальным — «сообщите
 *    руководителю» и без кнопки;
 *  · узбекский текст — узбекский;
 *  · на экран блокировки уводит только «закрыто» от сервера, а не статус
 *    «не оплачена» сам по себе.
 *
 * Нарочные поломки: вернуть крестик/скрытие — падает «без крестика»; кнопку
 * всем — падает «не руководитель»; blockedByServer по статусу — падает
 * «блокировка».
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { blockedByServer } from "@/lib/subscription-block";
import { expiryWarning, formatCloseTime, subscriptionAccess, subscriptionEndsAt } from "@contracts/subscription-access";

const state = vi.hoisted(() => ({ navigated: [] as string[], sub: {} as Record<string, unknown>, lang: "ru" as "ru" | "uz" }));
vi.mock("@/providers/trpc", () => ({
  trpc: { stripe: { getSubscription: { useQuery: () => ({ data: state.sub }) } } },
}));
vi.mock("react-router", () => ({ useNavigate: () => (to: string) => state.navigated.push(to) }));
vi.mock("@/i18n", () => ({
  useTranslate: () => (ru: string, uz: string) => (state.lang === "uz" ? uz : ru),
  useLang: () => ({ lang: state.lang }),
}));

const { TrialBanner } = await import("@/components/TrialBanner");

const CLOSES = "2026-10-11T10:00:00.000Z"; // 15:00 по Ташкенту
const graceSub = (canRenew: boolean) => ({
  plan: "trial", status: "trialing", isTrialing: true, isActive: true, isPastDue: false, isCanceled: false,
  daysLeft: 0, trialEndsAt: new Date("2026-10-09T10:00:00Z"), currentPeriodEnds: null, stripeSubscriptionId: null,
  access: { state: "grace", closesAt: CLOSES, canRenew },
});

beforeEach(() => { state.navigated = []; state.lang = "ru"; });
afterEach(cleanup);

describe("полоса «срок подписки истёк»", () => {
  it("руководителю: заголовок, время закрытия по Ташкенту, «Продлить» на /billing", () => {
    state.sub = graceSub(true);
    render(<TrialBanner />);
    const bar = screen.getByTestId("expiry-warning");
    expect(bar.textContent).toContain("Срок вашей подписки истёк");
    expect(bar.textContent).toContain("11.10, 15:00");
    fireEvent.click(screen.getByTestId("expiry-renew"));
    expect(state.navigated).toEqual(["/billing"]);
  });

  it("без крестика: полосу убирает только продление", () => {
    state.sub = graceSub(true);
    render(<TrialBanner />);
    const bar = screen.getByTestId("expiry-warning");
    // Единственная кнопка — «Продлить».
    expect([...bar.querySelectorAll("button")].map(b => b.textContent)).toEqual(["Продлить"]);
  });

  it("не руководитель: «сообщите руководителю», без кнопки", () => {
    state.sub = graceSub(false);
    render(<TrialBanner />);
    const bar = screen.getByTestId("expiry-warning");
    expect(bar.textContent).toContain("Сообщите руководителю");
    expect(screen.queryByTestId("expiry-renew")).toBeNull();
  });

  it("на узбекском — узбекский текст", () => {
    state.lang = "uz";
    state.sub = graceSub(true);
    render(<TrialBanner />);
    const text = screen.getByTestId("expiry-warning").textContent ?? "";
    expect(text).toContain("Obunangiz muddati tugadi");
    expect(text).not.toContain("Срок вашей подписки");
  });
});

describe("блокировка на сайте — по слову сервера", () => {
  it("«не оплачена», но идут 24 часа — не уводит; «закрыто» — уводит", () => {
    expect(blockedByServer({ access: { state: "grace" } }), "экран запирал раньше сервера").toBe(false);
    expect(blockedByServer({ access: { state: "ok" } })).toBe(false);
    expect(blockedByServer({ access: { state: "closed" } })).toBe(true);
    expect(blockedByServer(undefined)).toBe(false);
  });
});

describe("правило (contracts/subscription-access)", () => {
  const T0 = new Date("2026-10-10T10:00:00Z");
  const H = 3_600_000;

  it("время закрытия — по Ташкенту", () => {
    expect(formatCloseTime(new Date(CLOSES))).toBe("11.10, 15:00");
    expect(expiryWarning(new Date(CLOSES), false).bodyUz).toContain("Rahbaringizga");
  });

  it("24 часа — от предупреждения, а не от конца срока", () => {
    const sub = { status: "trialing", trialEndsAt: new Date(T0.getTime() - 72 * H), expiryNoticeAt: null };
    const a = subscriptionAccess(sub, null, T0);
    expect(a).toMatchObject({ state: "grace", writeNotice: true });
    expect(a.state === "grace" && a.closesAt).toEqual(new Date(T0.getTime() + 24 * H));
  });

  it("предупреждение от прошлого срока не считается", () => {
    const sub = { status: "active", currentPeriodEnds: new Date(T0.getTime() - H), expiryNoticeAt: new Date(T0.getTime() - 40 * 24 * H) };
    expect(subscriptionAccess(sub, null, T0)).toMatchObject({ state: "grace", writeNotice: true });
  });

  it("действует — стирает старое предупреждение; без даты — бессрочно", () => {
    expect(subscriptionAccess({ status: "active", currentPeriodEnds: new Date(T0.getTime() + H), expiryNoticeAt: T0 }, null, T0))
      .toMatchObject({ state: "ok", clearNotice: true });
    expect(subscriptionAccess({ status: "active", currentPeriodEnds: null }, null, T0)).toMatchObject({ state: "ok", clearNotice: false });
  });

  it("запасные даты: пробная — из карточки; оплаченная — из карточки", () => {
    const past = new Date(T0.getTime() - H);
    expect(subscriptionEndsAt({ status: "trialing", trialEndsAt: null, currentPeriodEnds: null }, { trialEndsAt: past })).toEqual(past);
    expect(subscriptionEndsAt({ status: "active", currentPeriodEnds: null }, { planExpiresAt: past })).toEqual(past);
  });

  it("нет подписки — закрыто", () => {
    expect(subscriptionAccess(null, null, T0).state).toBe("closed");
  });
});

describe("консоль платформы — та же правда, что у калитки", () => {
  it("«Оплата истекла · закроется …», потом «· доступ закрыт»", async () => {
    const { statusOf } = await import("@/components/superadmin/console/orgs");
    const T0 = new Date("2026-10-10T10:00:00Z");
    const org = {
      status: "active", isSandbox: false, plan: "standard", trialEndsAt: null, planExpiresAt: null,
      subscription: { status: "active", plan: "standard", trialEndsAt: null, currentPeriodEnds: new Date("2026-10-09T10:00:00Z"), expiryNoticeAt: T0 },
    } as unknown as Parameters<typeof statusOf>[0];
    expect(statusOf(org, new Date(T0.getTime() + 3_600_000)).label).toBe("Оплата истекла · закроется 11.10, 15:00");
    expect(statusOf(org, new Date(T0.getTime() + 25 * 3_600_000)).label).toBe("Оплата истекла · доступ закрыт");
  });
});
