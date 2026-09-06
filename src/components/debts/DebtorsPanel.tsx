import { useMemo } from "react";
import { FileDown, Printer } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useCurrency } from "@/hooks/useCurrency";
import { SectionNotice } from "@/components/SectionNotice";
import { exportToExcel } from "@/lib/excel";
import { printSimpleReport } from "@/lib/print";
import { DEBT_BUCKETS, formatDebtorsForExport, oldestBucket } from "@/lib/debtors-export";

/**
 * Кто нам должен и как давно.
 *
 * ── Почему это отдельная часть, а не строка в отчётах ───────────────────────
 *
 * «Где деньги зависли» — один из четырёх вопросов, с которыми открывают
 * отчёты, и единственный, ответа на который на странице не было: долг жил
 * одной карточкой выгрузки в каталоге. Увидеть его можно было, только скачав
 * файл.
 *
 * ── Почему тот же кусок стоит и на странице магазинов ───────────────────────
 *
 * Владелец сказал прямо: забрать должников файлом можно только в отчётах, а
 * нужно там, где этот долг и видишь. Часть одна на оба места — иначе к
 * очередной правке два экрана начнут считать долг по-разному, чем эта система
 * уже болела.
 */
export function DebtorsPanel({ t, lang, limit }: {
  t: (ru: string, uz: string) => string;
  lang: string;
  /** Сколько строк показывать на экране. В файл уходят все. */
  limit?: number;
}) {
  const { fmt } = useCurrency();
  const q = trpc.shop.receivablesAging.useQuery();

  const debtors = useMemo(
    () => (q.data?.shops ?? []).filter(s => s.debt > 0).sort((a, b) => b.debt - a.debt),
    [q.data],
  );

  if (q.isLoadingError) {
    return (
      <SectionNotice
        kind="error"
        message={t("Не удалось загрузить долги магазинов", "Do'konlar qarzini yuklab bo'lmadi")}
        onRetry={() => q.refetch()}
        retryLabel={t("Повторить", "Qayta urinish")}
      />
    );
  }
  if (q.isLoading) {
    return <div className="h-48 rounded-2xl animate-pulse" style={{ background: "var(--color-surface-light)" }} />;
  }
  if (debtors.length === 0) {
    return (
      <SectionNotice
        kind="empty"
        message={t("Долгов нет — магазины рассчитались", "Qarz yo'q — do'konlar hisob-kitob qilishgan")}
      />
    );
  }

  const data = q.data!;
  const rows = limit ? debtors.slice(0, limit) : debtors;

  const fileRows = formatDebtorsForExport(debtors, lang);
  const title = t("Должники и задолженность", "Qarzdorlar va qarzdorlik");

  const handleExcel = () => exportToExcel(fileRows, "debtors", t("Должники", "Qarzdorlar"), title);

  /*
    Печать идёт тем же набором строк, что и файл: два способа забрать один
    ответ не должны показывать разное. Заголовки берутся из первой строки —
    их порядок задан в formatDebtorsForExport.
  */
  const handlePrint = () => {
    if (fileRows.length === 0) return;
    printSimpleReport({
      title,
      subtitle: t(
        `Всего долг: ${fmt(data.totalDebt)} · должников: ${data.debtorCount}`,
        `Jami qarz: ${fmt(data.totalDebt)} · qarzdorlar: ${data.debtorCount}`,
      ),
      headers: Object.keys(fileRows[0]),
      rows: fileRows.map(r => Object.values(r).map(v => (typeof v === "number" ? fmt(v) : String(v)))),
      numericFrom: 1,
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Итог и действия */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <div>
          <div className="font-label text-[10px] tracking-wider uppercase" style={{ color: "var(--color-text-tertiary)" }}>
            {t("Должны нам", "Bizga qarzdor")}
          </div>
          <div style={{ fontSize: "28px", fontWeight: 700, lineHeight: 1, color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>
            {fmt(data.totalDebt)}
          </div>
          <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginTop: "6px" }}>
            {t(`Должников: ${data.debtorCount}`, `Qarzdorlar: ${data.debtorCount}`)}
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button type="button" onClick={handleExcel} className="neo-btn tap" style={{ padding: "0 14px" }}>
            <FileDown size={14} aria-hidden /> Excel
          </button>
          <button type="button" onClick={handlePrint} className="neo-btn tap" style={{ padding: "0 14px" }}>
            <Printer size={14} aria-hidden /> {t("Печать", "Chop etish")}
          </button>
        </div>
      </div>

      {/* Возраст долга: доля старого видна раньше, чем прочитаны числа. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px" }}>
        {DEBT_BUCKETS.map((b, i) => (
          <div key={b.key} style={{ background: "var(--color-surface-light)", borderRadius: "12px", padding: "12px 14px" }}>
            <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>{t(b.ru, b.uz)}</div>
            <div style={{
              fontSize: "16px", fontWeight: 600, fontVariantNumeric: "tabular-nums",
              // Старый долг — это не «много», это «плохо»: смысловой цвет, а не
              // фирменный.
              color: i >= 3 ? "var(--color-danger-text)" : i === 2 ? "var(--color-warning-text)" : "var(--color-text-primary)",
            }}>
              {fmt(data.buckets[b.key] ?? 0)}
            </div>
          </div>
        ))}
      </div>

      {data.unattributed !== 0 && (
        <p style={{ fontSize: "12px", color: "var(--color-text-tertiary)", margin: 0 }}>
          {t("Не привязано к заказу", "Buyurtmaga bog'lanmagan")}: <b style={{ color: "var(--color-text-primary)" }}>{fmt(data.unattributed)}</b>
          {" — "}
          {t("ручные начисления, оплаты без заказа и возвраты: возраст у них не считается.",
             "qo'lda kiritilgan hisoblar, buyurtmasiz to'lovlar va qaytarishlar: ularning yoshi hisoblanmaydi.")}
        </p>
      )}

      {/* Кто именно должен */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <thead>
            <tr>
              {[t("Магазин", "Do'kon"), t("Долг", "Qarz"), t("Возраст", "Yosh")].map((h, i) => (
                <th key={h} style={{
                  textAlign: i === 0 ? "left" : "right", padding: "10px 12px",
                  fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em",
                  color: "var(--color-text-tertiary)", borderBottom: "1px solid var(--color-border)",
                  whiteSpace: "nowrap",
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(s => (
              <tr key={s.shopId}>
                <td style={{ padding: "11px 12px", borderBottom: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}>
                  {s.shopName}
                </td>
                <td style={{ padding: "11px 12px", borderBottom: "1px solid var(--color-border)", textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                  {fmt(s.debt)}
                </td>
                <td style={{
                  padding: "11px 12px", borderBottom: "1px solid var(--color-border)", textAlign: "right",
                  whiteSpace: "nowrap",
                  color: (s.oldestDays ?? 0) > 60 ? "var(--color-danger-text)"
                    : (s.oldestDays ?? 0) > 30 ? "var(--color-warning-text)"
                    : "var(--color-text-secondary)",
                }}>
                  {s.oldestDays === null ? "—" : `${s.oldestDays} ${t("дн.", "kun")} · ${oldestBucket(s.oldestDays, lang)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {limit && debtors.length > limit && (
        <p style={{ fontSize: "12px", color: "var(--color-text-tertiary)", margin: 0 }}>
          {t(
            `Показаны ${limit} из ${debtors.length}. В файл уходят все.`,
            `${debtors.length} tadan ${limit} ta ko'rsatildi. Faylga hammasi tushadi.`,
          )}
        </p>
      )}
    </div>
  );
}
