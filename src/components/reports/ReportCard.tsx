import { useMemo, useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { format, subDays } from "date-fns";
import { exportToExcel } from "@/lib/excel";
import { notify } from "@/lib/toast";
import { F, COLORS, SHADOW } from "./report-constants";
import { reportColumns, type ReportDef, type ReportParams } from "./report-registry";
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
  // Разбор шапки — чистая работа над записью реестра, а не над данными:
  // считается один раз на карточку и не зависит ни от дат, ни от фильтров.
  const columns = useMemo(() => reportColumns(def), [def]);

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

  // 44px — не украшение: базовый шрифт приложения 14px, и поле с отступом
  // 8px выходило 33px высотой. Пальцем по такому выбирают дату с третьего раза.
  const field: React.CSSProperties = {
    padding: "8px 10px", minHeight: "44px", borderRadius: "8px", border: `1px solid ${COLORS.border}`,
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

      {/* Что окажется в файле.
          Названия и одной строки описания не хватало, чтобы отличить
          «Продажи по товарам» от «Себестоимости по товарам»: выяснялось это
          скачиванием обеих. Шапка берётся из того же toRows, что строит файл,
          поэтому обещание здесь и содержимое файла разойтись не могут. */}
      {columns.length > 0 && (
        <div style={{ fontFamily: F.body, fontSize: "11px", color: COLORS.textTertiary, lineHeight: 1.5 }}>
          <span style={{ fontWeight: 600 }}>{t("В файле", "Faylda")}: </span>
          {columns.join(" · ")}
          {!def.needsPeriod && (
            // Отсутствие полей даты выглядело как недоделка. Оно осмысленно:
            // остаток и справочник — это «на сейчас», периода у них нет.
            <span> · {t("на сейчас, без периода", "hozirgi holat, davrsiz")}</span>
          )}
        </div>
      )}

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
        // Заливка фирменным цветом с надписью «#fff» поверх — ровно тот приём,
        // из-за которого у арендатора со светлым цветом кнопка выходила белым
        // по белому. Цвет надписи задан темой (--color-on-primary), и в
        // .neo-btn-primary он уже учтён.
        //
        // Высота: 13px в кнопке с отступом 10px давала 37 точек. Поля дат
        // рядом уже дотянуты до 44, а кнопка под ними оставалась мельче — и
        // это единственное, по чему в карточке вообще нажимают.
        className="neo-btn-primary tap"
        style={{
          width: "100%", marginTop: "auto", padding: "0 14px",
          cursor: busy || query.isFetching ? "wait" : "pointer",
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
