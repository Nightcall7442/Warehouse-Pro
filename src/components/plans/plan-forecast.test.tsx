// @vitest-environment jsdom
/**
 * Прогноз плана на экране: цвета, «рано судить», «Кто не дотягивает».
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Прогноза не было. Здесь — то, что видит директор: красный и жёлтый в
 * «Кто не дотягивает» (а зелёные и без плана туда не попадают), цвет
 * прогноза строго по тону, и в первые рабочие дни — серая подпись
 * «рано судить» вместо красного приговора.
 *
 * ── Нарочные поломки ────────────────────────────────────────────────────────
 *
 *  • красить «early» как красный — падает «рано судить без цвета»;
 *  • показывать «Кто не дотягивает» и в первые дни — падает «рано судить»;
 *  • брать в список зелёных — падает «только красные и жёлтые».
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { forecastLine, workDaysOf, FORECAST_TONE_COLOR } from "@contracts/plan-forecast";

const state = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock("@/providers/trpc", () => ({
  trpc: { salesTarget: { forecast: { useQuery: () => ({ data: state.data, isError: false, refetch: () => {} }) } } },
}));
vi.mock("@/i18n", () => ({ useLang: () => ({ lang: "ru" }) }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: number) => `${v} сум` }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("react-router", () => ({ useNavigate: () => () => {} }));

const { ForecastCell, PlanForecastCompact, PlanForecastCard } = await import("./PlanForecast");

const MID = workDaysOf("2031-03-14");
const EARLY = workDaysOf("2031-03-04");
const agent = (userId: number, name: string, fact: number, plan: number | null, days = MID) =>
  ({ ...forecastLine(fact, plan, days), userId, name, planStart: plan ? "2031-03-01" : null });

function forecast(days = MID) {
  const agents = [
    agent(1, "Сабина", 0, 500_000, days),          // красный
    agent(2, "Агент", 1_000_000, 2_600_000, days), // красный, 83%
    agent(3, "Жасур", 1_100_000, 2_600_000, days), // жёлтый, 91%
    agent(4, "Бобур", 480_000, 1_000_000, days),   // зелёный, 104%
    agent(5, "Дилшод", 0, null, days),             // без плана
  ];
  return {
    month: "2031-03", today: "2031-03-14", days, early: days.passed <= 3,
    company: forecastLine(2_580_000, 6_700_000, days), agents,
  };
}

beforeEach(() => { state.data = forecast(); });
afterEach(cleanup);

describe("прогноз плана на экране", () => {
  it("ячейка красится по тону; без плана — серая подпись «Нет плана»", () => {
    const red = forecastLine(1_000_000, 2_600_000, MID);
    render(<ForecastCell line={red} lang="ru" fmt={v => `${v} сум`} />);
    const cell = screen.getByTestId("forecast-cell");
    expect(cell.dataset.tone).toBe("red");
    expect(cell.textContent).toBe("2166667 сум · 83%");
    expect((cell.firstChild as HTMLElement).style.color).toBe(FORECAST_TONE_COLOR.red);
    cleanup();
    render(<ForecastCell line={forecastLine(0, null, MID)} lang="ru" fmt={v => `${v} сум`} />);
    expect(screen.getByTestId("forecast-cell").textContent).toContain("Нет плана");
  });

  it("рано судить: без цвета, с подписью", () => {
    render(<ForecastCell line={forecastLine(10_000, 2_600_000, EARLY)} lang="ru" fmt={v => `${v} сум`} />);
    const cell = screen.getByTestId("forecast-cell");
    expect(cell.dataset.tone).toBe("early");
    expect(cell.textContent).toContain("Рано судить");
    expect((cell.firstChild as HTMLElement).style.color).not.toBe(FORECAST_TONE_COLOR.red);
  });

  it("главная: «Кто не дотягивает» — только красные и жёлтые, худшие сверху", () => {
    render(<PlanForecastCompact />);
    const rows = screen.getAllByTestId("forecast-lagging-row").map(r => r.textContent ?? "");
    expect(rows.map(r => r.split(/\d/)[0].trim())).toEqual(["Сабина", "Агент", "Жасур"]);
    expect(rows[1]).toContain("83%");
    // «в» и «день» — неразрывными пробелами, чтобы не рвались на телефоне.
    expect(rows[1]).toContain("нужно 114286 сум\u00A0в\u00A0день");
    expect(screen.getByTestId("forecast-company").dataset.tone).toBe("red");
  });

  it("главная в первые рабочие дни: «рано судить», списка отстающих нет", () => {
    state.data = forecast(EARLY);
    render(<PlanForecastCompact />);
    expect(screen.getByTestId("forecast-company").dataset.tone).toBe("early");
    expect(screen.getByTestId("forecast-company").textContent).toContain("Рано судить");
    expect(screen.queryByTestId("forecast-lagging")).toBeNull();
    expect(screen.getByTestId("forecast-early-note").textContent).toContain("с 4-го рабочего дня");
  });

  it("без единого плана карточки на главной нет", () => {
    state.data = { ...forecast(), company: forecastLine(100, null, MID), agents: [agent(5, "Дилшод", 100, null)] };
    const { container } = render(<PlanForecastCompact />);
    expect(container.innerHTML).toBe("");
  });

  it("полная карточка: каждый агент с цветом строки и «нужно в день»", () => {
    render(<PlanForecastCard />);
    const rows = screen.getAllByTestId("forecast-row");
    expect(rows.map(r => r.dataset.tone)).toEqual(["red", "red", "yellow", "green", "none"]);
    expect(within(rows[3]).getByText("37143 сум в день")).toBeDefined();
    expect(within(rows[4]).getByText("нет плана")).toBeDefined();
  });
});
