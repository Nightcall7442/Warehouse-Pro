import { useMemo, useState } from "react";
import { CalendarRange, Clock, FileDown, Loader2 } from "lucide-react";
import { exportToExcel } from "@/lib/excel";
import { notify } from "@/lib/toast";
import { F, COLORS } from "./report-constants";
import { reportColumns, type ReportDef, type ReportParams } from "./report-registry";
import { ReportFilter } from "./ReportFilters";
import { errorText } from "@/lib/error-text";

/** «04.09 – 04.10»: какой промежуток попадёт в файл, коротко — год виден в поле периода сверху. */
const short = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/**
 * Одна выгрузка — одна строка, один файл.
 *
 * Запрос объявлен, но выключен и идёт только по нажатию. Только поэтому
 * каталог и может показать все выгрузки сразу: это самые тяжёлые сводные
 * запросы продукта, и запусти их все при открытии вкладки — каталог сам стал
 * бы самой медленной страницей.
 *
 * Период приходит сверху, из каталога: он один на все файлы «за период».
 * Отборы — свои у каждой строки.
 */
export function ReportCard({ def, from, to, t, lang }: {
  def: ReportDef;
  from: string;
  to: string;
  t: (ru: string, uz: string) => string;
  lang: string;
}) {
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
      notify.error(errorText(e, t("Не удалось сформировать отчёт", "Hisobotni tuzib bo'lmadi")));
    } finally {
      setBusy(false);
    }
  };

  /*
    Поле поиска магазина — того же вида, что выбор рядом (.premium-select-
    trigger): та же подложка, скругление и высота. Раньше у поля была своя
    рамка и свой радиус, и пара «поиск + список» читалась как два разных
    прибора. Ширину задаёт сетка строки.
  */
  const field: React.CSSProperties = {
    width: "100%", minHeight: "44px", padding: "10px 14px", borderRadius: "10px",
    border: "1.5px solid transparent", background: COLORS.surfaceLight, color: COLORS.textPrimary,
    fontFamily: F.body, fontSize: "13px", fontWeight: 500, outline: "none",
  };
  const working = busy || query.isFetching;

  return (
    <div className="export-row" data-testid={`export-${def.id}`}>
      <div className="export-row-icon" aria-hidden><Icon size={18} /></div>

      <div className="export-row-text">
        <div className="export-row-title">
          <span>{t(def.title.ru, def.title.uz)}</span>
          {/* За какой промежуток файл — словами, у каждой строки. Отсутствие
              дат выглядело недоделкой; оно осмысленно: остаток, долг и
              справочник — это «на сегодня», периода у них нет. */}
          {def.needsPeriod ? (
            <span className="export-chip" title={t("Берёт период сверху", "Yuqoridagi davrni oladi")}>
              <CalendarRange size={12} aria-hidden /> {short(from)} – {short(to)}
            </span>
          ) : (
            <span className="export-chip export-chip-now">
              <Clock size={12} aria-hidden /> {t("на сегодня", "bugungi holat")}
            </span>
          )}
        </div>
        <div className="export-row-desc">{t(def.description.ru, def.description.uz)}</div>
        {/* Что окажется в файле. Названия и одной строки описания не хватало,
            чтобы отличить «Продажи по товарам» от «Себестоимости по товарам»:
            выяснялось это скачиванием обеих. Шапка берётся из того же toRows,
            что строит файл, поэтому обещание и содержимое разойтись не могут. */}
        {columns.length > 0 && (
          <div className="export-row-cols">
            <b>{t("В файле", "Faylda")}:</b> {columns.join(" · ")}
          </div>
        )}
      </div>

      {def.filters && def.filters.length > 0 && (
        <div className="export-row-filters report-filters">
          {def.filters.map(kind => (
            <ReportFilter
              key={kind}
              kind={kind}
              value={filters}
              onChange={patch => setFilters(f => ({ ...f, ...patch }))}
              t={t}
              style={field}
            />
          ))}
        </div>
      )}

      {/*
        Одна кнопка на строку, спокойная, а не залитая: шестнадцать залитых
        «Excel» подряд и были той стеной, на которую жаловались. Столбец у
        всех строк один — глаз находит кнопку там же, где у соседней. На
        узком экране подпись прячется, остаётся значок файла в 44 точки.
      */}
      <button
        type="button"
        onClick={handleExport}
        disabled={working}
        aria-label={`${t("Скачать Excel", "Excel yuklab olish")}: ${t(def.title.ru, def.title.uz)}`}
        aria-busy={working}
        className="neo-btn tap export-row-action"
        style={{ cursor: working ? "wait" : "pointer" }}
      >
        {working
          ? <Loader2 size={16} className="animate-spin" aria-hidden />
          : <FileDown size={16} aria-hidden />}
        <span className="export-row-action-label">
          {working ? t("Готовим…", "Tayyorlanmoqda…") : t("Скачать", "Yuklab olish")}
        </span>
      </button>
    </div>
  );
}
