import { useState } from "react";
import { format } from "date-fns";
import { ScrollText, FileDown } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useTranslate, useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { exportToExcel } from "@/lib/excel";
import { SectionNotice } from "@/components/SectionNotice";

/**
 * Журнал задолженности на экране: кто когда взял в долг и кто когда заплатил.
 *
 * ── Зачем на экране ─────────────────────────────────────────────────────────
 *
 * Журнал появился карточкой выгрузки — то есть отдавал файл и не показывал
 * ничего. А половина вопросов к нему беглые: когда эта точка платила в
 * последний раз, что было на прошлой неделе, у кого из агентов долг растёт.
 * Ради каждого скачивать файл и открывать Excel — не работа, а обход.
 *
 * Рядом с «Должниками» он стоит намеренно: те отвечают на вопрос СКОЛЬКО
 * должны прямо сейчас, этот — КОГДА это случилось. Один без другого отвечает
 * половину.
 *
 * ── Почему без остатка ──────────────────────────────────────────────────────
 *
 * Столбца «остаток» здесь нет: журнал ограничен периодом и пределом строк, а
 * нарастающий итог по обрезанному набору — число, верное только иногда.
 * Остаток отвечает за карточку магазина, где виден весь ряд движений целиком.
 */

/** Виды движения долга. Слово из базы человеку не показывается. */
const KIND: Record<string, { ru: string; uz: string }> = {
  order:   { ru: "Взял в долг",       uz: "Qarzga oldi" },
  payment: { ru: "Погасил",           uz: "To'ladi" },
  debt:    { ru: "Начислено вручную", uz: "Qo'lda hisoblandi" },
  return:  { ru: "Возврат товара",    uz: "Mahsulot qaytdi" },
};

/** Первый день текущего месяца — период, с которого журнал открывают чаще. */
function monthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function DebtJournalPanel() {
  const t = useTranslate();
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);

  const { data, isLoading, isLoadingError, refetch } = trpc.shop.debtJournal.useQuery({
    dateFrom: from || undefined,
    // Конец дня, а не его начало: иначе движения сегодняшнего числа выпадали
    // бы из периода, который человек задал «по сегодня».
    dateTo: to ? `${to}T23:59:59` : undefined,
    limit: 2000,
  });

  const toExcel = async () => {
    const rows = (data?.rows ?? []).map(r => ({
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
    await exportToExcel(rows, `debt-journal-${from}_${to}`, "Журнал задолженности",
      `Журнал задолженности за ${from} — ${to}`);
  };

  if (isLoadingError) {
    return <SectionNotice kind="error" message={t("Не удалось собрать журнал.", "Jurnalni yig'ib bo'lmadi.")} onRetry={refetch} />;
  }

  const th: React.CSSProperties = {
    textAlign: "left", padding: "8px 10px", fontSize: "10px", fontWeight: 700,
    textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-tertiary)",
    borderBottom: "1px solid var(--color-border)", whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    padding: "8px 10px", fontSize: "13px", color: "var(--color-text-primary)",
    borderBottom: "1px solid var(--color-border)",
  };
  const numCell: React.CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "14px" }}>
        <ScrollText size={16} style={{ color: "var(--color-primary-text)" }} />
        <h3 style={{ margin: 0, flex: 1, fontSize: "15px", fontWeight: 600, color: "var(--color-text-primary)" }}>
          {t("Журнал задолженности", "Qarzdorlik jurnali")}
        </h3>
        <input type="date" className="neo-input" style={{ width: "150px" }} value={from}
          onChange={e => setFrom(e.target.value)} aria-label={t("С даты", "Sanadan")} />
        <input type="date" className="neo-input" style={{ width: "150px" }} value={to}
          onChange={e => setTo(e.target.value)} aria-label={t("По дату", "Sanagacha")} />
        <button onClick={toExcel} className="neo-btn flex items-center gap-1.5 text-sm py-2">
          <FileDown size={13} /> Excel
        </button>
      </div>

      {/* Итог периода одной строкой: «взяли столько, вернули столько» — это и
          есть ответ на вопрос, почему долг за месяц вырос или упал. */}
      {data && (
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", margin: "0 0 12px" }}>
          {t("Взяли в долг", "Qarzga olindi")}: <b style={{ color: "var(--color-danger-text)" }}>{fmt(data.totals.taken)}</b>
          {" · "}
          {t("Погасили", "To'landi")}: <b style={{ color: "var(--color-success-text)" }}>{fmt(data.totals.paid)}</b>
          {" · "}
          {t("Изменение долга", "Qarz o'zgarishi")}: <b>{fmt(data.totals.taken - data.totals.paid)}</b>
        </p>
      )}

      {/* Обрезанный список говорит об этом вслух: молча укоротить значит
          соврать про период. */}
      {data?.truncated && (
        <p style={{ fontSize: "12px", color: "var(--color-warning-text)", margin: "0 0 12px" }}>
          {t("Показаны не все движения за период — сузьте даты или возьмите выгрузку.",
             "Davrdagi barcha harakatlar ko'rsatilmagan — sanalarni toraytiring yoki faylni yuklang.")}
        </p>
      )}

      {isLoading ? (
        <div className="h-32 bg-surface-light animate-pulse rounded-xl" />
      ) : (data?.rows.length ?? 0) === 0 ? (
        <SectionNotice kind="empty" message={t("За период движений по долгам не было", "Davr uchun qarz harakatlari bo'lmagan")} />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "720px" }}>
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
                <tr key={i}>
                  <td style={{ ...td, whiteSpace: "nowrap", color: "var(--color-text-secondary)" }}>
                    {format(new Date(r.date), "dd.MM.yyyy")}
                  </td>
                  <td style={td}>{r.shopName}</td>
                  <td style={{ ...td, color: "var(--color-text-secondary)" }}>{r.agentName ?? "—"}</td>
                  <td style={td}>{KIND[r.kind]?.[lang] ?? "—"}</td>
                  <td style={{ ...td, color: "var(--color-text-secondary)" }}>{r.doc ?? r.note ?? "—"}</td>
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
      )}
    </div>
  );
}
