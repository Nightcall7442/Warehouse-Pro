// @vitest-environment jsdom
/**
 * Балл KPI на телефоне агента — целым.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * В «Показателях» на телефоне стояло «27.900000000000002/100»: сервер
 * вычитал дробный штраф за подозрительные визиты из целого состава и отдавал
 * двоичную дробь, а экран печатал её как есть. Сервер теперь округляет сам
 * (api/__tests__/kpi-score-is-whole.test.ts), но телефон держит ответ в
 * офлайн-кэше — старый ответ с дробью доживает до следующей загрузки. Поэтому
 * округляет и экран.
 *
 * ── Нарочная поломка ────────────────────────────────────────────────────────
 *
 * Вернуть `{kpi.kpiScore}/100` в PhonePlan — тест падает на «28/100».
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/providers/trpc", () => {
  const nothing = () => {};
  return {
    trpc: {
      useUtils: () => ({ agent: { getPlans: { invalidate: nothing } }, salesTarget: { myQuota: { invalidate: nothing } } }),
      agent: {
        getPlans: { useQuery: () => ({ data: [], isLoading: false, isError: false, refetch: nothing }) },
        updatePlanStatus: { useMutation: () => ({ mutate: nothing, isPending: false, variables: undefined }) },
        saveVisitPhoto: { useMutation: () => ({ mutate: nothing, isPending: false }) },
      },
      salesTarget: { myQuota: { useQuery: () => ({ data: undefined, isLoading: false }) } },
      kpi: {
        agentKpi: {
          useQuery: () => ({
            isLoading: false,
            data: {
              // Ровно то, что приходило: 30 − 7% × 0,3.
              kpiScore: 27.900000000000002, kpiGrade: "F",
              visitCompletionRate: 100, revenue: 0, orderCount: 0, totalPlans: 4, returnRate: 0, debtCollectionRate: 0,
            },
          }),
        },
        salary: { useQuery: () => ({ data: undefined }) },
      },
    },
  };
});
vi.mock("@/i18n", () => ({ useLang: () => ({ lang: "ru" }) }));
vi.mock("react-router", () => ({ useNavigate: () => () => {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 10, role: "agent" } }) }));
vi.mock("@/hooks/useCurrency", () => ({ useCurrency: () => ({ fmt: (v: unknown) => `${v} сум` }) }));
vi.mock("@/lib/toast", () => ({ notify: { error: vi.fn(), success: vi.fn() } }));

const { PhonePlan } = await import("@/components/phone/PhonePlan");

afterEach(cleanup);

describe("KPI агента на телефоне", () => {
  it("балл — целым: «28/100», а не «27.900000000000002/100»", () => {
    render(<PhonePlan />);
    expect(screen.getByText("28/100")).toBeDefined();
    expect(document.body.textContent).not.toMatch(/27\.9/);
  });
});
