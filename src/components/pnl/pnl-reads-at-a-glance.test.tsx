// @vitest-environment jsdom
/**
 * Страница «Доходы и расходы» должна отвечать, а не показывать.
 *
 * Здесь закреплено четыре вещи, каждая из которых на этой странице однажды
 * врала директору:
 *
 *   1. Рост расхода — не удача. Стрелка красилась по знаку числа, и
 *      «Себестоимость +38%» выходила зелёной.
 *   2. «Сравнивать не с чем» — не «не изменилось». Когда прошлый период пуст,
 *      сервер отдаёт null, и место под изменением оставалось просто пустым.
 *   3. Отказ запроса — не «нулевая прибыль». Разделы получали только data и
 *      показывали «нет данных за период» и когда данных нет, и когда запрос
 *      упал.
 *   4. Расходы на транспорт — за выбранный период. Таблица отбирала приходы
 *      только по статусу и показывала их за всё время, при том что карточка
 *      наверху считалась строго по датам.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { KpiCard } from "./KpiCard";
import { PnLHeadline } from "./PnLHeadline";
import { PnLExpenseBreakdown } from "./PnLExpenseBreakdown";
import { PnLTransportExpenses } from "./PnLTransportExpenses";
import { PAYMENT_COLORS } from "./styles";

afterEach(cleanup);

const fmt = (v: string | number) => `${Number(v).toLocaleString("ru-RU")} сум`;
const t = (ru: string) => ru;

const kpi = (higherIsBetter: boolean, delta: number | null) =>
  render(
    <KpiCard
      label="ТЕСТ"
      value={fmt(100)}
      delta={delta}
      icon={null}
      accent="var(--kpi-blue)"
      higherIsBetter={higherIsBetter}
      noBaseLabel="нет прошлого периода"
      prevLabel="было"
    />
  ).container;

describe("направление изменения", () => {
  it("рост расхода красный, а не зелёный", () => {
    const html = kpi(false, 38).innerHTML;
    expect(html, "рост расхода снова покрашен как удача").toContain("var(--color-danger-text)");
    expect(html, "рост расхода снова покрашен как удача").not.toContain("var(--color-success-text)");
  });

  it("рост выручки зелёный", () => {
    const html = kpi(true, 38).innerHTML;
    expect(html).toContain("var(--color-success-text)");
    expect(html).not.toContain("var(--color-danger-text)");
  });

  it("падение расхода зелёное — деньги перестали утекать", () => {
    expect(kpi(false, -12).innerHTML).toContain("var(--color-success-text)");
  });

  it("«не с чем сравнивать» сказано словами, а не пустым местом", () => {
    const container = kpi(true, null);
    expect(screen.getByText("нет прошлого периода"), "подпись пропала").toBeTruthy();
    expect(container.textContent, "пустая база выдана за нулевое изменение").not.toContain("0.0%");
  });
});

const TOTALS = {
  revenue: 10_000_000,
  cogs: 7_000_000,
  operatingExpenses: 1_000_000,
  grossProfit: 3_000_000,
  netProfit: 2_000_000,
  grossMarginPct: 30,
  netMarginPct: 20,
  orderCount: 42,
};

describe("итог периода", () => {
  it("убыток набран смысловым цветом, а не фирменным", () => {
    const { container } = render(
      <PnLHeadline
        current={{ ...TOTALS, netProfit: -500_000, netMarginPct: -5 }}
        previous={null}
        deltas={{}}
        prevPeriod={null}
        fmt={fmt}
        t={t}
        lang="ru"
      />
    );
    expect(container.innerHTML, "убыток покрашен не как убыток").toContain(
      "var(--color-danger-text)"
    );
    expect(screen.getByText("ПОТЕРЯЛИ ЗА ПЕРИОД"), "заголовок не различает прибыль и убыток").toBeTruthy();
  });

  it("говорит, с каким именно периодом сравнивает", () => {
    render(
      <PnLHeadline
        current={TOTALS}
        previous={{ ...TOTALS, netProfit: 1_000_000 }}
        deltas={{ netProfit: 100 }}
        prevPeriod={{ from: "2026-07-01", to: "2026-07-31" }}
        fmt={fmt}
        t={t}
        lang="ru"
      />
    );
    // «+100%» к чему — раньше на странице не было сказано нигде.
    expect(
      screen.getByText(/01\.07\.2026 — 31\.07\.2026/),
      "границы прошлого периода не показаны"
    ).toBeTruthy();
  });

  it("период без продаж объясняет себя, а не рисует состав из нулей", () => {
    render(
      <PnLHeadline
        current={{ revenue: 0, cogs: 0, operatingExpenses: 0, netProfit: 0, orderCount: 0 }}
        previous={null}
        deltas={{}}
        prevPeriod={null}
        fmt={fmt}
        t={t}
        lang="ru"
      />
    );
    expect(screen.getByText(/продаж и расходов не было/)).toBeTruthy();
  });
});

describe("отказ не выглядит пустотой", () => {
  it("упавший запрос предлагает повторить, а не сообщает об отсутствии продаж", () => {
    render(<PnLExpenseBreakdown cogsByProduct={undefined} error onRetry={() => {}} fmt={fmt} lang="ru" />);
    expect(screen.getByText(/Не удалось загрузить/), "отказ выдан за пустой период").toBeTruthy();
    expect(screen.queryByText(/товары не продавались/), "отказ выдан за пустой период").toBeNull();
  });

  it("пустой период не предлагает повторить: чинить нечего", () => {
    render(<PnLExpenseBreakdown cogsByProduct={[]} fmt={fmt} lang="ru" />);
    expect(screen.getByText(/товары не продавались/)).toBeTruthy();
    expect(screen.queryByRole("button"), "у пустого периода появилась кнопка повтора").toBeNull();
  });
});

describe("расходы на транспорт", () => {
  const arrival = (id: number, date: string, expense: number) => ({
    id,
    arrivalNumber: `A-${id}`,
    arrivalDate: date,
    truckId: null,
    fuelCost: expense,
    tollCost: 0,
    totalExpense: expense,
    status: "completed",
  });

  it("берёт только приходы выбранного периода", () => {
    render(
      <PnLTransportExpenses
        arrivals={[
          arrival(1, "2026-08-15", 500_000),
          arrival(2, "2026-06-01", 900_000), // раньше периода
          arrival(3, "2026-09-30", 900_000), // позже периода
        ]}
        from="2026-08-01"
        to="2026-08-31"
        fmt={(v: number) => fmt(v)}
        lang="ru"
      />
    );
    expect(screen.getByText("A-1"), "приход периода пропал").toBeTruthy();
    expect(screen.queryByText("A-2"), "в таблицу попал приход до периода").toBeNull();
    expect(screen.queryByText("A-3"), "в таблицу попал приход после периода").toBeNull();
  });

  it("пустой период объясняет себя", () => {
    render(
      <PnLTransportExpenses
        arrivals={[arrival(2, "2026-06-01", 900_000)]}
        from="2026-08-01"
        to="2026-08-31"
        fmt={(v: number) => fmt(v)}
        lang="ru"
      />
    );
    expect(screen.getByText(/завершённых приходов не было/)).toBeTruthy();
  });
});

/*
  Цвет на этой странице приходит только из темы.

  Здесь жили #c7c9f8 (линия чистой прибыли), #9b59b6 (карта) и три
  rgba(...)-подложки у значков маржи. Тема бывает светлой и тёмной, а основной
  цвет задаёт арендатор: вписанный литерал не меняется ни от того, ни от
  другого — линия прибыли оставалась бледно-сиреневой на почти чёрной карточке.
*/
describe("цвет берётся из темы", () => {
  const dir = path.resolve(process.cwd(), "src/components/pnl");

  it("в разметке разделов нет вписанных цветов", () => {
    const guilty: string[] = [];
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".tsx") && !name.endsWith(".ts")) continue;
      if (name.includes(".test.")) continue;
      const text = fs
        .readFileSync(path.join(dir, name), "utf8")
        // Разбор прошлых бед цитирует старые литералы — комментарии не в счёт.
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")
        .split("\n")
        // Запасное значение внутри var(--token, #efedea) — не вписанный цвет:
        // работает оно, только если переменной нет вовсе. Строка со ссылкой на
        // переменную пропускается целиком: разбирать вложенные скобки ради
        // одного правила дороже, чем оно стоит.
        .filter((line) => !line.includes("var(--"))
        .join("\n");
      const found = [
        ...text.matchAll(/#[0-9a-fA-F]{3,8}\b/g),
        ...text.matchAll(/\brgba?\(\s*\d/g),
      ].map((m) => m[0]);
      if (found.length) guilty.push(`${name}: ${found.join(", ")}`);
    }
    expect(guilty, `цвет вписан мимо темы — ${guilty.join(" · ")}`).toEqual([]);
  });

  it("способы оплаты не носят смысловые цвета", () => {
    // Зелёный и жёлтый на этой странице означают прибыль и риск. Отданные
    // способу оплаты, они говорят о наличных то, чего никто не утверждал.
    const reserved = ["--color-success", "--color-warning", "--color-danger", "--color-primary"];
    for (const [method, color] of Object.entries(PAYMENT_COLORS)) {
      for (const token of reserved) {
        expect(color, `«${method}» снова носит ${token}`).not.toContain(token);
      }
    }
  });
});
