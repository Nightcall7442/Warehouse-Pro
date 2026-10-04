import { useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { CATEGORY_ORDER, CATEGORY_TITLES, visibleReports, type ReportCategory } from "./report-registry";
import { ReportCard } from "./ReportCard";

const dayOf = (back: number) => format(subDays(new Date(), back), "yyyy-MM-dd");
const PRESETS = [7, 30, 90];

/**
 * Каталог выгрузок: каждый файл, который человеку можно скачать, в одном месте.
 *
 * Отвечает на вопрос «мне нужен отчёт — какой?», не заставляя помнить, что
 * товары живут на странице товаров, а агенты — здесь. Группы — по тому, за чем
 * приходят: продажи, деньги и долги, магазины, команда, склад.
 *
 * ── Почему период один на весь каталог ──────────────────────────────────────
 *
 * Здесь была стена из шестнадцати одинаковых карточек, и в десяти стояла
 * своя пара дат — десять раз «04.09.2026 — 04.10.2026» на экране и
 * шестнадцать залитых кнопок «Excel» под ними. Владелец назвал это «выглядит
 * очень плохо». За файлами приходят пачкой и за один и тот же промежуток:
 * продажи, долги и визиты за месяц. Поэтому период задаётся один раз, сверху,
 * а у каждой выгрузки написано, берёт ли она его («04.09 – 04.10») или
 * выгружается на сегодня. Отборы (агент, территория, категория, магазин) —
 * свои у каждой строки: они у отчётов разные.
 *
 * ── Почему строки, а не карточки ────────────────────────────────────────────
 *
 * Сетка карточек по 260 точек давала рваные ряды — по одной карточке в ряду
 * под полными, разную высоту соседей и поля дат, вылезавшие за край. Список
 * файлов читается сверху вниз, кнопка у всех в одном столбце справа, а на
 * телефоне строка не превращается в экран высотой.
 */
export function ReportsHub({ role, t, lang }: {
  role: string | undefined;
  t: (ru: string, uz: string) => string;
  lang: string;
}) {
  const today = dayOf(0);
  const [from, setFrom] = useState(() => dayOf(30));
  const [to, setTo] = useState(today);
  const presetOn = (d: number) => to === today && from === dayOf(d);

  const grouped = useMemo(() => {
    const byCategory = new Map<ReportCategory, ReturnType<typeof visibleReports>>();
    for (const def of visibleReports(role)) {
      const list = byCategory.get(def.category) ?? [];
      list.push(def);
      byCategory.set(def.category, list);
    }
    // Только группы, в которых что-то есть: пустой заголовок «Деньги» рассказал
    // бы оператору, чего ему не дали, а прятали ровно для обратного.
    return CATEGORY_ORDER
      .map(c => ({ category: c, reports: byCategory.get(c) ?? [] }))
      .filter(g => g.reports.length > 0);
  }, [role]);

  if (grouped.length === 0) {
    return (
      <div className="neo-card neo-card-static exports-empty">
        {t("Отчёты недоступны для вашей роли", "Sizning rolingiz uchun hisobotlar mavjud emas")}
      </div>
    );
  }

  return (
    <div className="exports-hub" data-testid="reports-hub">
      {/* ── Период: один на все файлы «за период» ── */}
      <div className="neo-card neo-card-static report-filters exports-head">
        <div className="exports-head-text">
          <h2 className="exports-head-title">{t("Выгрузки в Excel", "Excel yuklamalari")}</h2>
          <p className="exports-head-hint">
            {t("Период — для файлов «за период». Остатки, долги и справочники — на сегодня.",
               "Davr — «davr uchun» fayllarga. Qoldiqlar, qarzlar va ma'lumotnomalar — bugungi holat.")}
          </p>
        </div>
        <div className="exports-period">
          <div role="group" aria-label={t("Период", "Davr")} className="range-pills exports-presets">
            {PRESETS.map(d => (
              <button key={d} type="button" onClick={() => { setFrom(dayOf(d)); setTo(today); }}
                aria-pressed={presetOn(d)}
                className={"range-pill tap" + (presetOn(d) ? " active" : "")}>
                {t(`${d} дн.`, `${d} kun`)}
              </button>
            ))}
          </div>
          <div className="exports-range">
            <input type="date" className="neo-input" value={from} max={to} aria-label={t("С даты", "Sanadan")}
              onChange={e => e.target.value && setFrom(e.target.value)} data-testid="exports-from" />
            <span className="exports-range-dash" aria-hidden>—</span>
            <input type="date" className="neo-input" value={to} min={from} max={today} aria-label={t("По дату", "Sanagacha")}
              onChange={e => e.target.value && setTo(e.target.value)} data-testid="exports-to" />
          </div>
        </div>
      </div>

      {grouped.map(({ category, reports }) => (
        <section key={category} className="neo-card neo-card-static exports-group" aria-labelledby={`exports-${category}`}>
          <header className="exports-group-head">
            <h3 id={`exports-${category}`}>{t(CATEGORY_TITLES[category].ru, CATEGORY_TITLES[category].uz)}</h3>
            <p>{t(CATEGORY_TITLES[category].hint.ru, CATEGORY_TITLES[category].hint.uz)}</p>
          </header>
          {reports.map(def => (
            <ReportCard key={def.id} def={def} from={from} to={to} t={t} lang={lang} />
          ))}
        </section>
      ))}
    </div>
  );
}
