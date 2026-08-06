import { useMemo } from "react";
import { F, COLORS } from "./report-constants";
import { CATEGORY_ORDER, CATEGORY_TITLES, visibleReports, type ReportCategory } from "./report-registry";
import { ReportCard } from "./ReportCard";

/**
 * The catalogue: every report the user may run, in one place.
 *
 * Its job is to answer "I need a report — which one?" without the user having
 * to remember that products live on the products page and agents on this one.
 * Grouping is by what the report is about, not by which router serves it.
 */
export function ReportsHub({ role, t, lang }: {
  role: string | undefined;
  t: (ru: string, uz: string) => string;
  lang: string;
}) {
  const grouped = useMemo(() => {
    const byCategory = new Map<ReportCategory, ReturnType<typeof visibleReports>>();
    for (const def of visibleReports(role)) {
      const list = byCategory.get(def.category) ?? [];
      list.push(def);
      byCategory.set(def.category, list);
    }
    // Only categories with something in them — an empty "Финансы" heading tells
    // an operator what they are missing, which is not the point of hiding it.
    return CATEGORY_ORDER
      .map(c => ({ category: c, reports: byCategory.get(c) ?? [] }))
      .filter(g => g.reports.length > 0);
  }, [role]);

  if (grouped.length === 0) {
    return (
      <div style={{
        background: COLORS.surface, borderRadius: "16px", padding: "48px",
        textAlign: "center", fontFamily: F.body, fontSize: "13px", color: COLORS.textTertiary,
      }}>
        {t("Отчёты недоступны для вашей роли", "Sizning rolingiz uchun hisobotlar mavjud emas")}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
      {grouped.map(({ category, reports }) => (
        <section key={category}>
          <h2 style={{
            fontFamily: F.display, fontSize: "11px", fontWeight: 600,
            textTransform: "uppercase", letterSpacing: "0.08em",
            color: COLORS.textTertiary, margin: "0 0 12px",
          }}>
            {t(CATEGORY_TITLES[category].ru, CATEGORY_TITLES[category].uz)}
          </h2>
          <div style={{
            display: "grid",
            // Cards keep a sane minimum and reflow rather than squashing, so
            // the same markup works on a laptop and a wide desk monitor.
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: "14px",
            alignItems: "stretch",
          }}>
            {reports.map(def => (
              <ReportCard key={def.id} def={def} t={t} lang={lang} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
