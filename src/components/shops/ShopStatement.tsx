import { useState } from "react";
import { format } from "date-fns";
import { Printer, Loader2, ScrollText, FileDown } from "lucide-react";
import { exportToExcel } from "@/lib/excel";
import { trpc } from "@/providers/trpc";
import { useTranslate, useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { useSellerCompany } from "@/hooks/useSellerCompany";
import { SectionNotice } from "@/components/SectionNotice";

/**
 * Акт сверки с магазином: откуда взялось число долга.
 *
 * ── Что было на этом месте ──────────────────────────────────────────────────
 *
 * Блок «История платежей»: последние двадцать записей таблицы payments, из
 * которых на экран выводились пять. Ни отгрузок, ни возвратов, ни остатка
 * после каждой строки, ни способа посмотреть дальше пятой записи. То есть на
 * вопрос владельца магазина «за что двенадцать миллионов?» ответить было
 * нечем, кроме как назвать сумму ещё раз.
 *
 * Спор о долге решается бумагой, которую подписывают обе стороны. У
 * поставщиков такая бумага в системе есть — та же самая, зеркальная: там мы
 * должны, здесь должны нам.
 *
 * ── Строка расхождения ──────────────────────────────────────────────────────
 *
 * Акт считает долг вторым, независимым путём — по движениям, а не формулой
 * recalcShopDebt. Совпадать они обязаны, и обычно совпадают; разница возможна
 * при переплате, потому что долг снизу ограничен нулём, а движения нет.
 *
 * Такую разницу видно строкой, а не прячут: ноль в ней означает «бумага сходится
 * с системой», не ноль — либо переплата, либо повод разбираться. Узнать об этом
 * из акта лучше, чем из спора с магазином.
 */
export function ShopStatement({ shopId }: { shopId: number }) {
  const t = useTranslate();
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const { company, isReady } = useSellerCompany();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data, isLoading, isLoadingError, refetch } = trpc.shop.statement.useQuery({
    shopId,
    from: from || undefined,
    to: to || undefined,
  });

  if (isLoadingError) {
    return (
      <SectionNotice
        kind="error"
        message={t("Не удалось собрать акт сверки.", "Solishtirma dalolatnomani yig'ib bo'lmadi.")}
        onRetry={refetch}
      />
    );
  }
  if (isLoading || !data) {
    return <div className="h-32 bg-surface-light animate-pulse rounded-xl" />;
  }

  const KIND: Record<string, { ru: string; uz: string }> = {
    order:   { ru: "Отгрузка",   uz: "Yuklash" },
    payment: { ru: "Оплата",     uz: "To'lov" },
    debt:    { ru: "Начисление", uz: "Hisoblash" },
    return:  { ru: "Возврат",    uz: "Qaytarish" },
  };
  const kindLabel = (k: string) => KIND[k]?.[lang] ?? k;

  /*
    Печатная форма по-русски — как все документы в этой системе: их подшивают
    в папку и показывают проверяющим, а не читают с экрана.
  */
  const print = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
    const num = (v: number) => Math.round(v).toLocaleString("ru-RU");
    const period = data.from || data.to
      ? `за период ${data.from ? format(new Date(data.from), "dd.MM.yyyy") : "начала"} — ${data.to ? format(new Date(data.to), "dd.MM.yyyy") : "сегодня"}`
      : "за всё время";

    const lines = data.rows.map(r => `<tr>
      <td>${format(new Date(r.date), "dd.MM.yyyy")}</td>
      <td>${esc(KIND[r.kind]?.ru ?? r.kind)}</td>
      <td>${esc(r.doc ?? r.note ?? "")}</td>
      <td class="num">${r.debit ? num(r.debit) : ""}</td>
      <td class="num">${r.credit ? num(r.credit) : ""}</td>
      <td class="num b">${num(r.balance)}</td>
    </tr>`).join("");

    w.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8">
      <title>Акт сверки — ${esc(data.shop.name)}</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;padding:16mm}
        h1{font-size:18px;margin:0 0 4mm}
        .meta{margin:1mm 0;color:#333}
        table{width:100%;border-collapse:collapse;margin-top:5mm}
        th,td{border:1px solid #999;padding:2mm 2.5mm;text-align:left}
        th{background:#eee}
        .num{text-align:right;white-space:nowrap}
        .b{font-weight:bold}
        .total td{font-weight:bold;background:#f4f4f4}
        .sign{display:flex;justify-content:space-between;margin-top:14mm}
        .sign div{width:45%;border-top:1px solid #333;padding-top:2mm;text-align:center}
        @page{margin:12mm}
        thead{display:table-header-group}
        tr{break-inside:avoid;page-break-inside:avoid}
        @media print{body{padding:0}th,.total td{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
      </style></head><body>
      <h1>Акт сверки взаимных расчётов</h1>
      ${isReady ? `<div class="meta">Организация: <b>${esc(company.name)}</b>${company.inn ? ` · ИНН ${esc(company.inn)}` : ""}</div>` : ""}
      <div class="meta">Магазин: <b>${esc(data.shop.name)}</b>${data.shop.ownerName ? ` · ${esc(data.shop.ownerName)}` : ""}${data.shop.phone ? ` · ${esc(data.shop.phone)}` : ""}</div>
      ${data.shop.address ? `<div class="meta">Адрес: ${esc(data.shop.address)}</div>` : ""}
      <div class="meta">Период: ${period}</div>
      <div class="meta">Составлен: ${format(new Date(), "dd.MM.yyyy")}</div>
      <table>
        <thead><tr>
          <th>Дата</th><th>Операция</th><th>Документ</th>
          <th class="num">Долг +</th><th class="num">Оплата −</th><th class="num">Остаток</th>
        </tr></thead>
        <tbody>
          <tr class="total"><td colspan="5">Остаток на начало периода</td><td class="num">${num(data.opening)}</td></tr>
          ${lines || `<tr><td colspan="6">Движений за период не было.</td></tr>`}
          <tr class="total"><td colspan="3">Итого</td><td class="num">${num(data.totals.debit)}</td><td class="num">${num(data.totals.credit)}</td><td class="num">${num(data.closing)}</td></tr>
        </tbody>
      </table>
      <div class="meta" style="margin-top:4mm">Остаток на конец периода: <b>${num(data.closing)}</b></div>
      ${data.discrepancy !== 0 ? `<div class="meta">Расхождение с текущим долгом в системе: <b>${num(data.discrepancy)}</b></div>` : ""}
      <div class="sign"><div>${isReady ? esc(company.name) : "От нашей организации"}</div><div>${esc(data.shop.name)}</div></div>
      <script>window.onload=()=>{window.focus();window.onafterprint=()=>window.close();window.print()}</script>
      </body></html>`);
    w.document.close();
  };

  /*
    Выгрузка в Excel — по-русски, как все документы в этой системе.

    Печать даёт бумагу и PDF, но не даёт сложить столбец: акт часто уходит
    бухгалтеру, а тот сверяет его со своей таблицей. Суммы поэтому уходят
    ЧИСЛАМИ, а не строками: число как текст Excel не складывает, не сортирует и
    подсвечивает уголком — на такой лист нельзя даже посмотреть итог внизу окна.

    Пустая строка вместо нуля в столбцах «Долг +» и «Оплата −» намеренно: ноль
    там означал бы «движение на ноль», а его не было.
  */
  const toExcel = async () => {
    const period = data.from || data.to
      ? `${data.from ? format(new Date(data.from), "dd.MM.yyyy") : "начала"} — ${data.to ? format(new Date(data.to), "dd.MM.yyyy") : "сегодня"}`
      : "за всё время";

    const rows: Array<Record<string, string | number>> = [
      { "Дата": "", "Операция": "Остаток на начало периода", "Документ": "", "Долг +": "", "Оплата −": "", "Остаток": data.opening },
      ...data.rows.map(r => ({
        "Дата":     format(new Date(r.date), "dd.MM.yyyy"),
        "Операция": KIND[r.kind]?.ru ?? r.kind,
        "Документ": r.doc ?? r.note ?? "",
        "Долг +":   r.debit || "",
        "Оплата −": r.credit || "",
        "Остаток":  r.balance,
      })),
      { "Дата": "", "Операция": "ИТОГО", "Документ": "", "Долг +": data.totals.debit, "Оплата −": data.totals.credit, "Остаток": data.closing },
    ];

    if (data.discrepancy !== 0) {
      rows.push({
        "Дата": "", "Операция": "Расхождение с текущим долгом в системе",
        "Документ": "", "Долг +": "", "Оплата −": "", "Остаток": data.discrepancy,
      });
    }

    await exportToExcel(
      rows,
      `akt-sverki-${data.shop.id}`,
      "Акт сверки",
      `Акт сверки с магазином «${data.shop.name}» · ${period}`,
    );
  };

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
    <div className="neo-card p-5">
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "14px" }}>
        <ScrollText size={16} style={{ color: "var(--color-primary-text)" }} />
        <h2 className="font-display text-base font-semibold text-primary" style={{ margin: 0, flex: 1 }}>
          {t("Акт сверки", "Solishtirma dalolatnoma")}
        </h2>
        <input type="date" className="neo-input" style={{ width: "150px" }} value={from}
          onChange={e => setFrom(e.target.value)} aria-label={t("С даты", "Sanadan")} />
        <input type="date" className="neo-input" style={{ width: "150px" }} value={to}
          onChange={e => setTo(e.target.value)} aria-label={t("По дату", "Sanagacha")} />
        <button onClick={toExcel} className="neo-btn flex items-center gap-1.5 text-sm py-2"
          title={t("Выгрузить акт в Excel", "Dalolatnomani Excelga yuklab olish")}>
          <FileDown size={13} />
          Excel
        </button>
        <button onClick={print} className="neo-btn flex items-center gap-1.5 text-sm py-2"
          title={t("Откроется окно печати. Чтобы получить файл, выберите принтер «Сохранить как PDF».",
                   "Chop etish oynasi ochiladi. Fayl olish uchun «PDF sifatida saqlash» printerini tanlang.")}>
          {isLoading ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
          {t("Печать", "Chop etish")}
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "640px" }}>
          <thead>
            <tr>
              <th style={th}>{t("Дата", "Sana")}</th>
              <th style={th}>{t("Операция", "Amal")}</th>
              <th style={th}>{t("Документ", "Hujjat")}</th>
              <th style={{ ...th, textAlign: "right" }}>{t("Долг +", "Qarz +")}</th>
              <th style={{ ...th, textAlign: "right" }}>{t("Оплата −", "To'lov −")}</th>
              <th style={{ ...th, textAlign: "right" }}>{t("Остаток", "Qoldiq")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ ...td, fontWeight: 600 }} colSpan={5}>
                {t("Остаток на начало", "Boshiga qoldiq")}
              </td>
              <td style={{ ...numCell, fontWeight: 700 }}>{fmt(data.opening)}</td>
            </tr>

            {data.rows.length === 0 ? (
              <tr>
                <td style={{ ...td, color: "var(--color-text-tertiary)" }} colSpan={6}>
                  {t("Движений за период не было", "Davr uchun harakat bo'lmagan")}
                </td>
              </tr>
            ) : data.rows.map((r, i) => (
              <tr key={i}>
                <td style={{ ...td, whiteSpace: "nowrap", color: "var(--color-text-secondary)" }}>
                  {format(new Date(r.date), "dd.MM.yyyy")}
                </td>
                <td style={td}>{kindLabel(r.kind)}</td>
                <td style={{ ...td, color: "var(--color-text-secondary)" }}>{r.doc ?? r.note ?? "—"}</td>
                <td style={{ ...numCell, color: r.debit ? "var(--color-danger-text)" : "var(--color-text-tertiary)" }}>
                  {r.debit ? fmt(r.debit) : ""}
                </td>
                <td style={{ ...numCell, color: r.credit ? "var(--color-success-text)" : "var(--color-text-tertiary)" }}>
                  {r.credit ? fmt(r.credit) : ""}
                </td>
                <td style={{ ...numCell, fontWeight: 700 }}>{fmt(r.balance)}</td>
              </tr>
            ))}

            <tr>
              <td style={{ ...td, fontWeight: 700 }} colSpan={3}>{t("Итого", "Jami")}</td>
              <td style={{ ...numCell, fontWeight: 700 }}>{fmt(data.totals.debit)}</td>
              <td style={{ ...numCell, fontWeight: 700 }}>{fmt(data.totals.credit)}</td>
              <td style={{ ...numCell, fontWeight: 700 }}>{fmt(data.closing)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Ноль здесь — «бумага сходится с системой». Молчать о ненулевом нельзя:
          именно этим числом закончится спор с магазином, если он случится. */}
      {data.discrepancy !== 0 && (
        <p style={{ marginTop: "12px", fontSize: "12px", color: "var(--color-warning-text)" }}>
          {t(`Расхождение с текущим долгом в системе: ${fmt(data.discrepancy)}. Обычно это переплата: долг снизу ограничен нулём, а движения нет.`,
             `Tizimdagi joriy qarz bilan farq: ${fmt(data.discrepancy)}. Odatda bu ortiqcha to'lov: qarz noldan pastga tushmaydi, harakatlar esa tushadi.`)}
        </p>
      )}
    </div>
  );
}
