import { useState } from "react";
import { format } from "date-fns";
import { Printer, Loader2, ScrollText, FileDown } from "lucide-react";
import { exportToExcel } from "@/lib/excel";
import { trpc } from "@/providers/trpc";
import { useTranslate, useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { useSellerCompany } from "@/hooks/useSellerCompany";
import { SectionNotice } from "@/components/SectionNotice";
import { PremiumSelect } from "@/components/PremiumSelect";
import {
  STATEMENT_PRESETS, ALL_TIME, presetRange, dayToRu, localDay, type StatementPreset, type StatementPeriod,
} from "@contracts/statement-period";
import { reconciliationHtml, reconciliationConclusion, reconciliationDocLabel } from "@/lib/reconciliation-print";

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
 *
 * ── Два места ───────────────────────────────────────────────────────────────
 *
 * Акт живёт в карточке магазина и на своей странице «Акт сверки», где магазин
 * выбирают поиском (09.10.2026: арендатор просил «отдельно выбрать»). Блок
 * один и тот же; на странице период держит она сама — в адресе, чтобы акт
 * можно было открыть ссылкой и не терять период при смене магазина.
 */
/** Готовый отрезок или свой период: выбор отрезка сразу ставит его даты. */
export function StatementPeriodPicker({ value, onChange }: {
  value: StatementPeriod;
  onChange: (next: StatementPeriod) => void;
}) {
  const t = useTranslate();
  const { lang } = useLang();
  const pick = (preset: StatementPreset) => {
    const range = presetRange(preset);
    // «Свой период» начинается с того, что уже видно на экране: человек
    // поправляет одну дату, а не набирает обе с нуля.
    onChange(range ? { preset, ...range } : { preset, from: value.from, to: value.to || localDay(new Date()) });
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
      <PremiumSelect
        value={value.preset}
        onChange={v => pick(v as StatementPreset)}
        options={STATEMENT_PRESETS.map(p => ({ value: p.id, label: lang === "uz" ? p.uz : p.ru }))}
        width="180px"
        aria-label={t("Период", "Davr")}
      />
      {value.preset === "custom" && (
        <>
          <input type="date" className="neo-input" style={{ width: "150px" }} value={value.from}
            onChange={e => onChange({ ...value, from: e.target.value })} aria-label={t("С даты", "Sanadan")} />
          <input type="date" className="neo-input" style={{ width: "150px" }} value={value.to}
            onChange={e => onChange({ ...value, to: e.target.value })} aria-label={t("По дату", "Sanagacha")} />
        </>
      )}
    </div>
  );
}

export function ShopStatement({ shopId, period: controlled, onPeriodChange }: {
  shopId: number;
  /** Задан — период держит страница; нет — блок сам, начиная со «всего времени». */
  period?: StatementPeriod;
  onPeriodChange?: (next: StatementPeriod) => void;
}) {
  const t = useTranslate();
  const { lang } = useLang();
  const { fmt, symbolRu, currency } = useCurrency();
  const { company, isReady } = useSellerCompany();
  const [own, setOwn] = useState<StatementPeriod>(ALL_TIME);
  const period = controlled ?? own;
  const setPeriod = (next: StatementPeriod) => {
    if (!controlled) setOwn(next);
    onPeriodChange?.(next);
  };

  const { data, isLoading, isLoadingError, refetch } = trpc.shop.statement.useQuery({
    shopId,
    from: period.from || undefined,
    to: period.to || undefined,
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

  // Дата «на которую» акт: конец выбранного периода, у открытого — сегодня.
  const asOf = period.to || localDay(new Date());
  // Склонять прописью этот код умеет только сумы.
  const inWords = currency === "UZS" && symbolRu === "сум";

  const printInput = {
    shop: { name: data.shop.name, ownerName: data.shop.ownerName, taxId: data.shop.taxId, address: data.shop.address },
    company: { name: isReady ? company.name : "", inn: company.inn, director: company.director },
    period: { from: period.from, to: period.to },
    opening: data.opening,
    rows: data.rows,
    totals: data.totals,
    closing: data.closing,
    currency: symbolRu,
    inWords,
  };

  /*
    Печатная форма по-русски и по образцу 1С — см. lib/reconciliation-print.ts:
    её подшивают в папку и сверяют со своей 1С, а не читают с экрана.
  */
  const print = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(reconciliationHtml(printInput));
    w.document.close();
  };

  /*
    Выгрузка в Excel — по-русски и в той же раскладке, что бумага: сальдо
    начальное, движения с Дебетом и Кредитом, обороты, сальдо конечное.

    Суммы уходят ЧИСЛАМИ, а не строками: число как текст Excel не складывает
    и подсвечивает уголком. Пустая строка вместо нуля в Дебете и Кредите
    намеренно: ноль означал бы «движение на ноль», а его не было. Столбец
    «Остаток» оставлен: бухгалтеру проще найти, после какой строки разошлось.
  */
  const toExcel = async () => {
    const periodText = period.from
      ? `${dayToRu(period.from)} — ${dayToRu(asOf)}`
      : `весь период по ${dayToRu(asOf)}`;
    const saldo = (v: number) => ({ "Дебет": v > 0 ? v : "", "Кредит": v < 0 ? -v : "" });

    const rows: Array<Record<string, string | number>> = [
      { "Дата": "", "Документ": "Сальдо начальное", ...saldo(data.opening), "Остаток": data.opening },
      ...data.rows.map(r => ({
        "Дата":     format(new Date(r.date), "dd.MM.yyyy"),
        "Документ": reconciliationDocLabel(r),
        "Дебет":    r.debit || "",
        "Кредит":   r.credit || "",
        "Остаток":  r.balance,
      })),
      { "Дата": "", "Документ": "Обороты за период", "Дебет": data.totals.debit, "Кредит": data.totals.credit, "Остаток": "" },
      { "Дата": "", "Документ": "Сальдо конечное", ...saldo(data.closing), "Остаток": data.closing },
      { "Дата": "", "Документ": reconciliationConclusion(printInput, dayToRu(asOf)), "Дебет": "", "Кредит": "", "Остаток": "" },
    ];

    if (data.discrepancy !== 0) {
      rows.push({
        "Дата": "", "Документ": "Расхождение с текущим долгом в системе",
        "Дебет": "", "Кредит": "", "Остаток": data.discrepancy,
      });
    }

    await exportToExcel(
      rows,
      `akt-sverki-${data.shop.id}-${period.from || "nachalo"}_${asOf}`,
      "Акт сверки",
      `Акт сверки взаимных расчётов за ${periodText} между ${isReady ? company.name : "нашей организацией"} и ${data.shop.name}`,
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

  // Итог словами — тот же смысл, что фраза в конце бумаги, на языке экрана.
  const closingText = Math.round(data.closing) === 0
    ? t(`На ${dayToRu(asOf)} долга нет.`, `${dayToRu(asOf)} holatiga qarz yo'q.`)
    : data.closing > 0
      ? t(`На ${dayToRu(asOf)} магазин должен вам ${fmt(data.closing)}.`, `${dayToRu(asOf)} holatiga do'kon sizga ${fmt(data.closing)} qarzdor.`)
      : t(`На ${dayToRu(asOf)} вы должны магазину ${fmt(-data.closing)} (переплата).`, `${dayToRu(asOf)} holatiga siz do'konga ${fmt(-data.closing)} qarzdorsiz (ortiqcha to'lov).`);

  return (
    <div className="neo-card p-5" data-testid="shop-statement">
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "14px" }}>
        <ScrollText size={16} style={{ color: "var(--color-primary-text)" }} />
        <h2 className="font-display text-base font-semibold text-primary" style={{ margin: 0, flex: 1 }}>
          {t("Акт сверки", "Solishtirma dalolatnoma")}
        </h2>
        <StatementPeriodPicker value={period} onChange={setPeriod} />
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
              <th style={{ ...th, textAlign: "right" }}>{t("Дебет (долг +)", "Debet (qarz +)")}</th>
              <th style={{ ...th, textAlign: "right" }}>{t("Кредит (оплата −)", "Kredit (to'lov −)")}</th>
              <th style={{ ...th, textAlign: "right" }}>{t("Остаток", "Qoldiq")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ ...td, fontWeight: 600 }} colSpan={5}>
                {period.from
                  ? t(`Сальдо на ${dayToRu(period.from)}`, `${dayToRu(period.from)} holatiga saldo`)
                  : t("Сальдо начальное", "Boshlang'ich saldo")}
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
              <td style={{ ...td, fontWeight: 700 }} colSpan={3}>{t("Обороты за период", "Davr aylanmasi")}</td>
              <td style={{ ...numCell, fontWeight: 700 }}>{fmt(data.totals.debit)}</td>
              <td style={{ ...numCell, fontWeight: 700 }}>{fmt(data.totals.credit)}</td>
              <td style={numCell} />
            </tr>
            <tr>
              <td style={{ ...td, fontWeight: 700 }} colSpan={5}>
                {t(`Сальдо на ${dayToRu(asOf)}`, `${dayToRu(asOf)} holatiga saldo`)}
              </td>
              <td style={{ ...numCell, fontWeight: 700 }}>{fmt(data.closing)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p data-testid="statement-conclusion" style={{ marginTop: "12px", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)" }}>
        {closingText}
      </p>

      {/* Ноль здесь — «бумага сходится с системой». Молчать о ненулевом нельзя:
          именно этим числом закончится спор с магазином, если он случится. */}
      {data.discrepancy !== 0 && (
        <p style={{ marginTop: "8px", fontSize: "12px", color: "var(--color-warning-text)" }}>
          {t(`Расхождение с текущим долгом в системе: ${fmt(data.discrepancy)}. Обычно это переплата: долг снизу ограничен нулём, а движения нет.`,
             `Tizimdagi joriy qarz bilan farq: ${fmt(data.discrepancy)}. Odatda bu ortiqcha to'lov: qarz noldan pastga tushmaydi, harakatlar esa tushadi.`)}
        </p>
      )}
    </div>
  );
}
