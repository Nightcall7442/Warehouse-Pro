// @vitest-environment jsdom
/**
 * «Кто платит и кто уходит» на странице суперадмина — на экране.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Наверху суперадминки — счётчики по всей платформе и ни одного ответа о
 * деньгах и уходе клиентов; телефон владельца организации — только в её
 * карточке, в двух щелчках от списка.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Настоящий компонент OwnerPanel с ответом ручки tenant.ownerPanel (числа
 * посчитаны на настоящей базе в real-db/owner-panel.test.ts; здесь —
 * показ):
 *   · четыре числа и честная подпись к MRR («по прайсу, без скидок»);
 *   · у каждой строки «кому звонить» — телефон ссылкой tel:, цель касания не
 *     меньше 44 точек; без телефона — так и сказано;
 *   · пробные по этапам: счётчик у каждого этапа, этап у каждой строки;
 *   · на двух языках; пустые списки — честным «пусто».
 *
 * Нарочная поломка: заменить href на пустой — падает «телефон ссылкой»;
 * снять minHeight у кнопки звонка — «цель касания»; оставить заголовки только
 * по-русски — «по-узбекски»; убрать подпись к MRR — «подпись».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

const state = vi.hoisted(() => ({ lang: "ru" as "ru" | "uz", data: null as unknown }));
vi.mock("@/providers/trpc", () => ({
  trpc: { tenant: { ownerPanel: { useQuery: () => ({ data: state.data, isLoading: false, isError: false }) } } },
}));
vi.mock("@/i18n", () => ({
  useLang: () => ({ lang: state.lang, t: (k: string) => k }),
  useTranslate: () => (ru: string, uz: string) => (state.lang === "uz" ? uz : ru),
}));

import { OwnerPanel } from "@/components/superadmin/OwnerPanel";

const DAY = 86_400_000;
const now = Date.now();
const panel = () => ({
  generatedAt: new Date(now),
  clients: 12,
  activeLast7: 9,
  paying: {
    count: 2, mrr: 898_000,
    list: [
      { tenantId: 1, name: "Бессрочный Про", plan: "pro", price: 599_000, periodEnds: null, phone: "+998 91 000 00 01", email: "ceo@forever.uz" },
      { tenantId: 2, name: "Платит Базовый", plan: "basic", price: 299_000, periodEnds: new Date(now + 40 * DAY), phone: "+998901110001", email: null },
    ],
  },
  silent: [
    { tenantId: 3, name: "Молчит Про", kind: "paying", plan: "pro", lastActivityAt: new Date(now - 7 * DAY), silentDays: 7, phone: "+998901110005", email: "q@x.uz" },
    { tenantId: 4, name: "Без номера", kind: "trial", plan: "trial", lastActivityAt: new Date(now - 8 * DAY), silentDays: 8, phone: null, email: "n@x.uz" },
  ],
  renewals: [],
  funnel: {
    stages: [
      { key: "registered", reached: 6 }, { key: "emailVerified", reached: 5 }, { key: "products", reached: 4 },
      { key: "agent", reached: 2 }, { key: "agentOrder", reached: 1 }, { key: "delivered", reached: 1 }, { key: "paid", reached: 1 },
    ],
    trials: [
      {
        tenantId: 5, name: "Пробный Оператор", createdAt: new Date(now - 12 * DAY), trialEndsAt: new Date(now + 2 * DAY),
        trialExpired: false, stage: "agent", done: ["registered", "emailVerified", "products", "agent"],
        source: "answer=referral; ref=bekzod", lastActivityAt: new Date(now - 4 * DAY), phone: "+998901110011", email: null,
      },
    ],
  },
});

beforeEach(() => { state.lang = "ru"; state.data = panel(); });
afterEach(cleanup);

describe("числа", () => {
  it("платят, MRR с суммой, активные из всех, молчат", () => {
    render(<OwnerPanel />);
    const root = screen.getByTestId("owner-panel");
    // Первое «Платят сейчас» — карточка числа, второе — заголовок списка.
    const kpi = within(root).getAllByText("Платят сейчас")[0].closest(".kpi-hero");
    expect(kpi?.textContent).toBe("Платят сейчас2");
    expect(root.textContent).toMatch(/898\s000/);
    expect(root.textContent).toContain("из 12");
  });

  it("подпись к MRR честная: прайс, без скидок и докупленных мест", () => {
    render(<OwnerPanel />);
    expect(screen.getByTestId("owner-mrr-note").textContent).toMatch(/по прайсу: без скидок и без докупленных мест/);
  });
});

describe("кому звонить", () => {
  it("телефон ссылкой tel:, номер группами; без номера — так и сказано", () => {
    render(<OwnerPanel />);
    const silent = screen.getByTestId("owner-silent");
    const call = within(silent).getAllByTestId("owner-call")[0] as HTMLAnchorElement;
    expect(call.getAttribute("href")).toBe("tel:+998901110005");
    expect(call.textContent).toContain("+998 90 111 00 05");
    expect(silent.textContent).toContain("тишина 7 дн.");
    expect(silent.textContent).toContain("телефона нет");

    // Номер из карточки директора, записанный с пробелами, — в ссылке без них.
    const paying = screen.getByTestId("owner-paying");
    expect(within(paying).getAllByTestId("owner-call")[0].getAttribute("href")).toBe("tel:+998910000001");
    expect(paying.textContent).toContain("бессрочно");
  });

  it("цель касания у звонка — не меньше 44 точек", () => {
    render(<OwnerPanel />);
    for (const a of screen.getAllByTestId("owner-call")) {
      expect(parseInt((a as HTMLElement).style.minHeight, 10)).toBeGreaterThanOrEqual(44);
    }
  });

  it("пустой список — честным «пусто», а не пропавшим разделом", () => {
    render(<OwnerPanel />);
    expect(screen.getByTestId("owner-renewals").textContent).toContain("оплаченный срок не кончается ни у кого");
  });
});

describe("пробные по этапам", () => {
  it("счётчик у каждого этапа, этап и источник у строки", () => {
    render(<OwnerPanel />);
    expect(screen.getByTestId("owner-stage-registered").textContent).toContain("6");
    expect(screen.getByTestId("owner-stage-agent").textContent).toContain("Заведён агент");
    expect(screen.getByTestId("owner-stage-paid").textContent).toContain("1");
    const trials = screen.getByTestId("owner-trials");
    expect(trials.textContent).toContain("Пробный Оператор");
    expect(trials.textContent).toContain("Знакомые, рекомендация · ref: bekzod");
  });
});

describe("по-узбекски", () => {
  it("заголовки, этапы и сведения строк — на языке экрана", () => {
    state.lang = "uz";
    render(<OwnerPanel />);
    const root = screen.getByTestId("owner-panel");
    expect(root.textContent).toContain("Kim to'layapti va kim ketyapti");
    expect(root.textContent).toContain("5+ kun jim — qo'ng'iroq qiling");
    expect(screen.getByTestId("owner-stage-agent").textContent).toContain("Agent qo'shildi");
    expect(root.textContent).toContain("7 kun jim");
    expect(root.textContent).toContain("Tanishlar, tavsiya");
    expect(root.textContent).toContain("so'm");
    expect(root.textContent).not.toContain("Платят сейчас");
  });
});
