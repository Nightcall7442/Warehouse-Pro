import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { format, subDays } from "date-fns";
import { exportToExcel } from "@/lib/excel";
import { notify } from "@/lib/toast";
import { F, COLORS, SHADOW } from "./report-constants";
import type { ReportDef, ReportParams } from "./report-registry";
import { ReportFilter } from "./ReportFilters";

const today = () => format(new Date(), "yyyy-MM-dd");
const monthAgo = () => format(subDays(new Date(), 30), "yyyy-MM-dd");

/**
 * One report, one card, one file.
 *
 * The query is declared but left disabled, and only runs when the button is
 * pressed. That is the whole reason the hub can show every report at once:
 * these are the heaviest aggregate queries in the product, and firing all of
 * them the moment the tab opens would make the catalogue itself the slowest
 * page on the site.
 */
export function ReportCard({ def, t, lang }: {
  def: ReportDef;
  t: (ru: string, uz: string) => string;
  lang: string;
}) {
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [filters, setFilters] = useState<Partial<ReportParams>>({});
  const [busy, setBusy] = useState(false);

  const params: ReportParams = { from, to, ...filters };
  const query = def.useQuery(params, { enabled: false });
  const Icon = def.icon;

  const handleExport = async () => {
    setBusy(true);
    try {
      const { data } = await query.refetch();
      const rows = data ? def.toRows(data) : [];
      if (rows.length === 0) {
        // exportToExcel returns silently on an empty set, which would look
        // exactly like a broken button. Say which it is.
        notify.info(t("За выбранный период данных нет", "Tanlangan davr uchun ma'lumot yo'q"));
        return;
      }
      await exportToExcel(
        rows,
        def.filename(params),
        lang === "uz" ? def.sheet.uz : def.sheet.ru,
        lang === "uz" ? def.title.uz : def.title.ru,
      );
    } catch (e) {
      notify.error(e instanceof Error ? e.message : t("Не удалось сформировать отчёт", "Hisobotni tuzib bo'lmadi"));
    } finally {
      setBusy(false);
    }
  };

  const field: React.CSSProperties = {
    padding: "8px 10px", borderRadius: "8px", border: `1px solid ${COLORS.border}`,
    background: COLORS.surfaceLight, color: COLORS.textPrimary,
    fontFamily: F.body, fontSize: "13px", outline: "none", width: "100%",
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: "12px",
      background: COLORS.surface, borderRadius: "16px", padding: "18px",
      border: `1px solid ${COLORS.border}`, boxShadow: SHADOW,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: "36px", height: "36px", borderRadius: "10px", flexShrink: 0,
          background: COLORS.surfaceLight, color: COLORS.primaryText,
        }}>
          <Icon size={17} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary }}>
            {t(def.title.ru, def.title.uz)}
          </div>
          <div style={{ fontFamily: F.body, fontSize: "12px", color: COLORS.textTertiary, marginTop: "2px" }}>
            {t(def.description.ru, def.description.uz)}
          </div>
        </div>
      </div>

      {def.needsPeriod && (
        <div style={{ display: "flex", gap: "8px" }}>
          <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
            aria-label={t("С даты", "Sanadan")} style={field} />
          <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)}
            aria-label={t("По дату", "Sanagacha")} style={field} />
        </div>
      )}

      {def.filters?.map(kind => (
        <ReportFilter
          key={kind}
          kind={kind}
          value={filters}
          onChange={patch => setFilters(f => ({ ...f, ...patch }))}
          t={t}
          style={field}
        />
      ))}

      <button
        type="button"
        onClick={handleExport}
        disabled={busy || query.isFetching}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
          marginTop: "auto", padding: "10px 14px", borderRadius: "10px", border: "none",
          background: COLORS.primary, color: "#fff", cursor: busy ? "wait" : "pointer",
          fontFamily: F.body, fontSize: "13px", fontWeight: 600,
          opacity: busy || query.isFetching ? 0.7 : 1,
        }}
      >
        {busy || query.isFetching
          ? <Loader2 size={15} className="animate-spin" />
          : <FileDown size={15} />}
        {busy || query.isFetching ? t("Формируем…", "Tayyorlanmoqda…") : "Excel"}
      </button>
    </div>
  );
}
