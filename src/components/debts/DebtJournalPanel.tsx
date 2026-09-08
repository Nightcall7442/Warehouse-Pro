import { useState } from "react";
import { Link } from "react-router";
import { format } from "date-fns";
import { ScrollText, FileDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useTranslate, useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { exportToExcel } from "@/lib/excel";
import { SectionNotice } from "@/components/SectionNotice";

/**
 * Полный архив задолженности: кто когда взял в долг и кто когда погасил.
 *
 * ── Что это отвечает ────────────────────────────────────────────────────────
 *
 * Должники рядом показывают, СКОЛЬКО висит прямо сейчас. Здесь — КОГДА это
 * случилось, и за всё время, а не за выбранный месяц: «даже годы спустя, кто
 * когда взял долг и когда оплатил».
 *
 * Отсюда две вещи, без которых экран отвечал бы наполовину:
 *
 *   · период по умолчанию ПУСТ — это весь архив, а не текущий месяц. Даты
 *     сужают его, если нужно;
 *   · страницы, а не предел строк. Прежняя оболочка обрезала список и честно
 *     писала «показано не всё» — но на вопрос «а что было в позапрошлом году»
 *     такой ответ не годится, он звучит «а дальше не знаю».
 *
 * Итоги над таблицей считаются по ВСЕМУ набору под фильтрами, а не по видимой
 * странице: «взяли столько, погасили столько» — ответ про архив, а не про
 * пятьдесят строк на экране.
 *
 * ── Документ в строке ───────────────────────────────────────────────────────
 *
 * Номер заказа — ссылка на сам заказ. Спор о долге почти всегда упирается в
 * «а что это за отгрузка», и переход к документу здесь избавляет от поиска
 * заказа по номеру в другом разделе.
 */

/** Виды движения долга. Слово из базы человеку не показывается. */
const KIND: Record<string, { ru: string; uz: string }> = {
  order:   { ru: "Взял в долг",       uz: "Qarzga oldi" },
  payment: { ru: "Погасил",           uz: "To'ladi" },
  debt:    { ru: "Начислено вручную", uz: "Qo'lda hisoblandi" },
  return:  { ru: "Возврат товара",    uz: "Mahsulot qaytdi" },
};

const PAGE_SIZE = 50;

type Kind = "order" | "payment" | "debt" | "return";

export function DebtJournalPanel() {
  const t = useTranslate();
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const utils = trpc.useUtils();

  // Пустые даты — весь архив. Это и есть ответ на «за всё время».
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<Kind | "">("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search, 350);

  const { data, isLoading, isLoadingError, error, refetch } = trpc.shop.debtJournal.useQuery({
    dateFrom: from || undefined,
    // Конец дня, а не его начало: иначе движения самого последнего числа
    // выпадали бы из периода, который человек задал «по такое-то число».
    dateTo: to ? `${to}T23:59:59` : undefined,
    search: debouncedSearch.trim() || undefined,
    kind: kind || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  /** Сброс на первую страницу: иначе новый фильтр открывается на сороковой. */
  const refilter = (apply: () => void) => { apply(); setPage(1); };

  const toExcel = async () => {
    /*
      В файл уходит ВЕСЬ набор под фильтрами, а не видимая страница: файл со
      «страницы 1 из 40» ответом на вопрос «за всё время» не является.
    */
    const all = await utils.shop.debtJournal.fetch({
      dateFrom: from || undefined,
      dateTo: to ? `${to}T23:59:59` : undefined,
      search: debouncedSearch.trim() || undefined,
      kind: kind || undefined,
      page: 1,
      pageSize: 500,
    });
    const rows = all.rows.map(r => ({
      "Дата": format(new Date(r.date), "dd.MM.yyyy HH:mm"),
      "Магазин": r.shopName,
      "Город": r.city ?? "—",
      "Агент": r.agentName ?? "—",
      "Операция": KIND[r.kind]?.ru ?? "—",
      "Документ": r.doc ?? r.note ?? "—",
      // Взятое и погашенное — разные столбцы, а не одна колонка со знаком: так
      // сумму по каждому виду видно в Excel без формул.
      "Взял в долг": r.amount > 0 ? r.amount : "",
      "Погасил": r.amount < 0 ? -r.amount : "",
    }));
    await exportToExcel(rows, `debt-journal-${from || "all"}_${to || "now"}`, "Архив задолженности",
      from || to ? `Архив задолженности за ${from || "начало"} — ${to || "сегодня"}` : "Архив задолженности за всё время");
  };

  if (isLoadingError) {
    return (
      <SectionNotice
        kind="error"
        message={[
          t("Не удалось собрать архив.", "Arxivni yig'ib bo'lmadi."),
          error?.message,
        ].filter(Boolean).join(" ")}
        onRetry={refetch}
      />
    );
  }

  const th: React.CSSProperties = {
    textAlign: "left", padding: "10px 12px", fontSize: "10px", fontWeight: 700,
    textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-tertiary)",
    borderBottom: "1px solid var(--color-border)", whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    padding: "10px 12px", fontSize: "13px", color: "var(--color-text-primary)",
    borderBottom: "1px solid var(--color-border)",
  };
  const numCell: React.CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "14px" }}>
        <ScrollText size={16} style={{ color: "var(--color-primary-text)" }} />
        <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: "var(--color-text-primary)" }}>
          {t("Архив задолженности", "Qarzdorlik arxivi")}
        </h3>
        <span style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>
          {!from && !to
            ? t("за всё время", "butun davr uchun")
            : `${from || t("начало", "boshidan")} — ${to || t("сегодня", "bugun")}`}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={toExcel} className="neo-btn flex items-center gap-1.5 text-sm py-2">
          <FileDown size={13} /> Excel
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "14px" }}>
        <div style={{ position: "relative", flex: 1, minWidth: "200px" }}>
          <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary)" }} />
          <input className="neo-input" style={{ paddingLeft: "38px", width: "100%" }}
            placeholder={t("Магазин…", "Do'kon…")}
            value={search} onChange={e => refilter(() => setSearch(e.target.value))} />
        </div>
        <select className="neo-input" style={{ width: "190px" }} value={kind}
          onChange={e => refilter(() => setKind(e.target.value as Kind | ""))}
          aria-label={t("Вид операции", "Amal turi")}>
          <option value="">{t("Все операции", "Barcha amallar")}</option>
          {(Object.keys(KIND) as Kind[]).map(k => (
            <option key={k} value={k}>{KIND[k][lang]}</option>
          ))}
        </select>
        <input type="date" className="neo-input" style={{ width: "150px" }} value={from}
          onChange={e => refilter(() => setFrom(e.target.value))} aria-label={t("С даты", "Sanadan")} />
        <input type="date" className="neo-input" style={{ width: "150px" }} value={to}
          onChange={e => refilter(() => setTo(e.target.value))} aria-label={t("По дату", "Sanagacha")} />
      </div>

      {/* Уперлись в предел выборки — сказать вслух. Молча укоротить архив
          значит соврать про период. */}
      {data?.truncated && (
        <p style={{ fontSize: "12px", color: "var(--color-warning-text)", margin: "0 0 12px" }}>
          {t("Движений слишком много — показаны не все. Сузьте период или отберите магазин.",
             "Harakatlar juda ko'p — hammasi ko'rsatilmagan. Davrni toraytiring yoki do'konni tanlang.")}
        </p>
      )}

      {/* Итог по всему набору, а не по странице: это ответ про архив. */}
      {data && (
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", margin: "0 0 12px" }}>
          {t("Взяли в долг", "Qarzga olindi")}: <b style={{ color: "var(--color-danger-text)" }}>{fmt(data.totals.taken)}</b>
          {" · "}
          {t("Погасили", "To'landi")}: <b style={{ color: "var(--color-success-text)" }}>{fmt(data.totals.paid)}</b>
          {" · "}
          {t("Изменение долга", "Qarz o'zgarishi")}: <b>{fmt(data.totals.taken - data.totals.paid)}</b>
          {" · "}
          {t("движений", "harakat")}: <b>{data.total}</b>
        </p>
      )}

      {isLoading ? (
        <div className="h-32 bg-surface-light animate-pulse rounded-xl" />
      ) : (data?.rows.length ?? 0) === 0 ? (
        <SectionNotice kind="empty" message={t("Движений по долгам не найдено", "Qarz harakatlari topilmadi")} />
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "760px" }}>
              <thead>
                <tr>
                  <th style={th}>{t("Дата", "Sana")}</th>
                  <th style={th}>{t("Магазин", "Do'kon")}</th>
                  <th style={th}>{t("Агент", "Agent")}</th>
                  <th style={th}>{t("Операция", "Amal")}</th>
                  <th style={th}>{t("Документ", "Hujjat")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{t("Взял в долг", "Qarzga oldi")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{t("Погасил", "To'ladi")}</th>
                </tr>
              </thead>
              <tbody>
                {data!.rows.map((r, i) => (
                  <tr key={`${r.kind}-${r.shopId}-${i}`}>
                    <td style={{ ...td, whiteSpace: "nowrap", color: "var(--color-text-secondary)" }}>
                      {format(new Date(r.date), "dd.MM.yyyy")}
                    </td>
                    <td style={td}>
                      <Link to={`/shops/${r.shopId}`} style={{ color: "var(--color-text-primary)", textDecoration: "none", fontWeight: 500 }}>
                        {r.shopName}
                      </Link>
                    </td>
                    <td style={{ ...td, color: "var(--color-text-secondary)" }}>{r.agentName ?? "—"}</td>
                    <td style={td}>{KIND[r.kind]?.[lang] ?? "—"}</td>
                    <td style={{ ...td, color: "var(--color-text-secondary)" }}>
                      {/* Номер заказа — ссылка: спор о долге почти всегда
                          упирается в «а что это за отгрузка». */}
                      {r.orderId && r.doc
                        ? <Link to={`/orders/${r.orderId}`} style={{ color: "var(--color-primary-text)", textDecoration: "none" }}>{r.doc}</Link>
                        : (r.doc ?? r.note ?? "—")}
                    </td>
                    <td style={{ ...numCell, color: r.amount > 0 ? "var(--color-danger-text)" : "var(--color-text-tertiary)" }}>
                      {r.amount > 0 ? fmt(r.amount) : ""}
                    </td>
                    <td style={{ ...numCell, color: r.amount < 0 ? "var(--color-success-text)" : "var(--color-text-tertiary)" }}>
                      {r.amount < 0 ? fmt(-r.amount) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", marginTop: "16px" }}>
              <button className="neo-btn neo-btn-sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                <ChevronLeft size={14} />
              </button>
              <span style={{ fontSize: "13px", color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                {page} / {pageCount}
              </span>
              <button className="neo-btn neo-btn-sm" disabled={page >= pageCount} onClick={() => setPage(p => p + 1)}>
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
