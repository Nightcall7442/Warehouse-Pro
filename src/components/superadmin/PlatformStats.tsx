import { Building2, Users, ShoppingCart, TrendingUp, BarChart3 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { F, COLORS, fmt, money } from "./types";
import { KpiCard, Section, PlanBadge, StatusBadge } from "./ui";

/**
 * Показатели платформы.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Блок «По тарифам» лежал ВНУТРИ сетки карточек-показателей. Сетка нарезана по
 * 200 точек на ячейку, а он — не карточка, а панель со своим заголовком и
 * строкой значков. Ему доставалась одна узкая ячейка: строка разворачивалась в
 * столбик, числа переставали стоять в колонку, `marginLeft: auto` у
 * «приостановленных» терял смысл. Соседняя карточка «Выручка» тянулась на ту же
 * высоту — и превращалась в высокий прямоугольник с числом наверху и пустотой
 * во всю остальную площадь.
 *
 * Отсюда и «страница выглядит криво»: не цвета и не шрифт, а два разных по
 * природе блока, уложенных одной сеткой.
 */
export function PlatformStats() {
  const { data: stats, isLoading } = trpc.tenant.platformStats.useQuery();

  const cards = [
    { label: "Организаций",   value: stats?.tenants ?? 0,          icon: Building2,   gradient: "var(--color-primary)" },
    { label: "Пользователей", value: stats?.users ?? 0,            icon: Users,       gradient: "linear-gradient(135deg, #60a5fa, #3b82f6)" },
    { label: "Заказов",       value: fmt(stats?.orders ?? 0),      icon: ShoppingCart, gradient: "linear-gradient(135deg, var(--color-success), #16a34a)" },
    { label: "Выручка",       value: money(stats?.revenue ?? 0),   suffix: "сум", icon: TrendingUp, gradient: "linear-gradient(135deg, var(--color-warning), #d97706)" },
  ];

  /*
    Пять долей одной величины — четыре тарифа и приостановленные. Раньше это
    была строка с переносом, теперь равные ячейки: значок над числом, числа
    моноширинными цифрами. По колонке видно соотношение, а не только сами
    числа.
  */
  const plans = [
    { key: "trial",     badge: <PlanBadge plan="trial" />,     count: stats?.byPlan.trial ?? 0 },
    { key: "basic",     badge: <PlanBadge plan="basic" />,     count: stats?.byPlan.basic ?? 0 },
    { key: "pro",       badge: <PlanBadge plan="pro" />,       count: stats?.byPlan.pro ?? 0 },
    { key: "exclusive", badge: <PlanBadge plan="exclusive" />, count: stats?.byPlan.exclusive ?? 0 },
    { key: "suspended", badge: <StatusBadge status="suspended" />, count: stats?.byStatus.suspended ?? 0 },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "16px" }}>
        {cards.map(c => (
          <KpiCard key={c.label} label={c.label} value={c.value} suffix={c.suffix} icon={c.icon} gradient={c.gradient} loading={isLoading} />
        ))}
      </div>

      {stats && (
        <Section title="По тарифам" icon={BarChart3}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "12px" }}>
            {plans.map(p => (
              <div key={p.key} style={{
                display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "8px",
                padding: "12px 14px", borderRadius: "14px", background: COLORS.surfaceLight,
              }}>
                {p.badge}
                <span style={{
                  fontFamily: F.display, fontSize: "22px", fontWeight: 700,
                  color: COLORS.textPrimary, lineHeight: 1,
                  // Цифры одной ширины: соседние числа стоят в колонку, и
                  // «7» против «12» читается как разница, а не как разный сдвиг.
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {p.count}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
