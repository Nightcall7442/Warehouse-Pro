import { useState } from "react";
import { subDays } from "date-fns";
import { Link } from "react-router";
import { bizNow, bizToday, format } from "@/lib/business-time";
import { CalendarClock, CheckCircle2, FileDown, HelpCircle, X, XCircle } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { DateRangePicker } from "@/components/DateRangePicker";
import { exportToExcel } from "@/lib/excel";
import { notify } from "@/lib/toast";
import { errorText } from "@/lib/error-text";
import { CardTable } from "@/components/CardTable";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { F, COLORS, thStyle, tdStyle } from "@/components/users/types";
import { useUrlState, urlNumber, type UrlCodec } from "@/hooks/useUrlState";
import { deliveryFailLabel, deliveryFailText, type DeliveryFailReason } from "@contracts/delivery-fail-reason";

/*
  «Недоставленные» — раздел «Отчётов» директора, офиса и супервайзера.

  Курьер отмечает срыв только с причиной, перенос — с днём (components/
  delivery/DeliveryDialogs). Здесь — что из этого складывается за период:
  какая доля попыток срывается, почему, у кого из курьеров и в каких
  магазинах. Перенос — не срыв: он считается рядом, но в долю срывов не
  входит, как и в KPI курьера.

  Курьер выбирается нажатием на его строку: супервайзеру список сотрудников
  закрыт (user.list — только офису), а курьеры с попытками за период и так
  перечислены в таблице.

  Фильтры живут в адресе (?tab=failed&from=…&to=…&courier=…).
*/

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

function dateCodec(fallback: string): UrlCodec<string> {
  return {
    parse: raw => (/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : fallback),
    format: v => (v === fallback ? null : v),
  };
}

const pct = (share: number) => `${Math.round(share * 100)}%`;
const dmy = (day: string) => day.split("-").reverse().join(".");

function Kpi({ label, value, sub, icon, tone }: { label: string; value: string; sub?: string; icon: React.ReactNode; tone: string }) {
  return (
    <div className="kpi-hero" style={{ borderRadius: 24, padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
        <span style={{ fontFamily: F.display, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>{label}</span>
        <span style={{ width: 40, height: 40, borderRadius: 12, background: `color-mix(in srgb, ${tone} 16%, transparent)`, color: tone, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</span>
      </div>
      <div className="font-data" style={{ fontFamily: F.display, fontSize: 30, fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1, letterSpacing: "-0.03em" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: COLORS.textTertiary, marginTop: 8 }}>{sub}</div>}
    </div>
  );
}

export function FailedDeliveriesTab() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const today = bizToday();
  const monthAgo = ymd(subDays(bizNow(), 30));

  const [from, setFrom] = useUrlState("from", monthAgo, dateCodec(monthAgo));
  const [to, setTo] = useUrlState("to", today, dateCodec(today));
  const [courierId, setCourierId] = useUrlState("courier", undefined, urlNumber);

  const q = trpc.reports.failedDeliveries.useQuery({ dateFrom: from, dateTo: to, courierId });
  const utils = trpc.useUtils();
  const [exporting, setExporting] = useState(false);
  const preset = (days: number) => { setFrom(ymd(subDays(bizNow(), days))); setTo(bizToday()); };
  const presetOn = (days: number) => to === today && from === ymd(subDays(bizNow(), days));
  const reason = (r: DeliveryFailReason | null, note?: string | null) => deliveryFailText(r, note, lang);

  const r = q.data;
  const courierName = courierId ? r?.byCourier.find(c => c.courierId === courierId)?.courierName ?? `#${courierId}` : null;

  /*
    Выгрузка — по-русски, как вся печать и Excel, и за ВЕСЬ период.

    На экране — последние 200 попыток; выгрузка брала их же, и файл с
    заголовком «за период» у занятой организации молча обрывался на двухсотой
    строке, расходясь с итогами по причинам и курьерам наверху отчёта. Теперь
    файл — отдельным запросом со всеми попытками периода.
  */
  const exportXlsx = async () => {
    if (!r) return;
    setExporting(true);
    let all: typeof r;
    try {
      all = await utils.reports.failedDeliveries.fetch({ dateFrom: from, dateTo: to, courierId, allRows: true });
    } catch (e) {
      notify.error(errorText(e));
      return;
    } finally {
      setExporting(false);
    }
    const title = `Недоставленные ${dmy(from)} — ${dmy(to)}${all.truncated ? ` (первые ${all.recent.length})` : ""}`;
    void exportToExcel(all.recent.map(e => ({
      "Дата": e.at,
      "Заказ": e.orderNumber,
      "Магазин": e.shopName,
      "Курьер": e.courierName ?? "",
      "Что": e.kind === "failed" ? "Не доставлен" : `Перенесён${e.rescheduledTo ? ` на ${dmy(e.rescheduledTo)}` : ""}`,
      "Причина": deliveryFailText(e.reason, e.note, "ru"),
    })), `failed-deliveries-${from}_${to}`, "Недоставленные", title);
  };

  return (
    <div className="space-y-4" data-testid="failed-deliveries-report">
      <div className="neo-card report-filters" style={{ padding: 16 }}>
        <div className="flex flex-wrap items-end gap-3">
          <div role="group" aria-label={t("Период", "Davr")} className="range-pills">
            {[7, 30, 90].map(d => (
              <button key={d} type="button" onClick={() => preset(d)} className={"range-pill tap" + (presetOn(d) ? " active" : "")}>
                {t(`${d} дн.`, `${d} kun`)}
              </button>
            ))}
          </div>
          <DateRangePicker
            from={from}
            to={to}
            max={today}
            onChange={(f, tt) => { setFrom(f); setTo(tt); }}
            active={![7, 30, 90].some(presetOn)}
            align="start"
            aria-label={t("Период", "Davr")}
            testId="failed-deliveries-range"
          />
          {courierName && (
            <button type="button" onClick={() => setCourierId(undefined)} className="neo-btn tap flex items-center gap-1.5" style={{ minHeight: 44, padding: "0 14px" }}
              data-testid="failed-deliveries-courier-reset">
              {t(`Курьер: ${courierName}`, `Kuryer: ${courierName}`)} <X size={14} aria-label={t("Все курьеры", "Barcha kuryerlar")} />
            </button>
          )}
          <button type="button" onClick={() => void exportXlsx()} disabled={!r || r.recent.length === 0 || exporting} className="neo-btn tap disabled:opacity-40" style={{ minHeight: 44, padding: "0 16px", gap: 7, marginLeft: "auto" }}>
            <FileDown size={15} aria-hidden />Excel
          </button>
        </div>
      </div>

      {q.isError ? <QueryErrorFallback onRetry={() => void q.refetch()} /> : !r ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map(i => <div key={i} className="rounded-3xl animate-pulse" style={{ height: 120, background: "var(--color-surface-light)" }} />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="failed-deliveries-totals">
            <Kpi label={t("Не доставлено", "Yetkazilmadi")} value={String(r.totals.failed)} sub={t(`${pct(r.totals.failShare)} попыток`, `urinishlarning ${pct(r.totals.failShare)}`)} icon={<XCircle size={18} />} tone="var(--color-danger)" />
            <Kpi label={t("Перенесено", "Ko'chirildi")} value={String(r.totals.rescheduled)} sub={t("по просьбе магазина и офиса", "do'kon va ofis so'rovi bilan")} icon={<CalendarClock size={18} />} tone="var(--color-info)" />
            <Kpi label={t("Доставлено", "Yetkazildi")} value={String(r.totals.delivered)} sub={t(`заказов с попытками: ${r.totals.orders}`, `urinishli buyurtmalar: ${r.totals.orders}`)} icon={<CheckCircle2 size={18} />} tone="var(--color-success)" />
            <Kpi label={t("Причина не указана", "Sabab ko'rsatilmagan")} value={String(r.totals.unspecified)} sub={t("отмечены старой мобилкой", "eski ilovadan belgilangan")} icon={<HelpCircle size={18} />} tone="var(--color-warning)" />
          </div>

          {r.totals.failed + r.totals.rescheduled === 0 ? (
            <div className="neo-card text-center" style={{ padding: 40, color: COLORS.textSecondary, fontSize: 14 }} data-testid="failed-deliveries-empty">
              {t("За этот период все доставки дошли с первого раза", "Bu davrda barcha yetkazishlar birinchi urinishda bajarildi")}
            </div>
          ) : (
            <>
              <section className="neo-card" style={{ padding: 20 }} data-testid="failed-deliveries-reasons">
                <h3 style={{ fontFamily: F.display, fontSize: 15, fontWeight: 700, color: COLORS.textPrimary, margin: "0 0 14px" }}>
                  {t("Почему не довезли", "Nega yetkazilmadi")}
                </h3>
                {r.byReason.length === 0 ? (
                  <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: 0 }}>{t("Срывов нет — только переносы", "Bajarilmaganlar yo'q — faqat ko'chirishlar")}</p>
                ) : r.byReason.map(x => (
                  <div key={x.reason ?? "none"} style={{ marginTop: 10 }} data-testid="failed-deliveries-reason-row">
                    <div className="flex items-baseline justify-between gap-3" style={{ fontSize: 13 }}>
                      <span style={{ color: COLORS.textPrimary, fontWeight: 600 }}>{deliveryFailLabel(x.reason, lang)}</span>
                      <span className="font-data" style={{ color: COLORS.textSecondary }}>{x.count} · {pct(x.share)}</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 999, background: "var(--color-surface-light)", boxShadow: "var(--shadow-pressed)", marginTop: 6, overflow: "hidden" }}>
                      <div style={{ width: `${Math.max(2, Math.round(x.share * 100))}%`, height: "100%", borderRadius: 999, background: x.reason ? "var(--color-danger)" : "var(--color-border-strong)" }} />
                    </div>
                  </div>
                ))}
              </section>

              <section style={{ background: COLORS.surface, borderRadius: 24, boxShadow: "var(--shadow-raised)", overflow: "hidden" }}>
                <h3 style={{ fontFamily: F.display, fontSize: 15, fontWeight: 700, color: COLORS.textPrimary, margin: 0, padding: "18px 20px 0" }}>{t("По курьерам", "Kuryerlar bo'yicha")}</h3>
                <p style={{ fontSize: 12, color: COLORS.textTertiary, margin: 0, padding: "2px 20px 6px" }}>
                  {t("Нажмите на курьера — отчёт только по нему", "Kuryerni bosing — hisobot faqat u bo'yicha")}
                </p>
                <CardTable style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }} data-testid="failed-deliveries-couriers">
                    <thead><tr>{[t("КУРЬЕР", "KURYER"), t("ДОСТАВЛЕНО", "YETKAZILDI"), t("НЕ ДОСТАВЛЕНО", "YETKAZILMADI"), t("ДОЛЯ", "ULUSH"), t("ПЕРЕНЕСЕНО", "KO'CHIRILDI"), t("ЧАЩЕ ВСЕГО", "KO'PINCHA")].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                    <tbody>
                      {r.byCourier.map(c => (
                        <tr key={c.courierId} onClick={() => setCourierId(c.courierId)} style={{ cursor: "pointer" }} data-testid="failed-deliveries-courier-row">
                          <td style={{ ...tdStyle, fontWeight: 600 }}>
                            <button type="button" onClick={(e) => { e.stopPropagation(); setCourierId(c.courierId); }} className="text-left" style={{ background: "transparent", border: "none", padding: 0, font: "inherit", color: "inherit", cursor: "pointer" }}>
                              {c.courierName}
                            </button>
                          </td>
                          <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>{c.delivered}</td>
                          <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>{c.failed}</td>
                          <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: c.failShare >= 0.2 ? "var(--color-danger-text)" : c.failShare >= 0.1 ? "var(--color-warning-text)" : COLORS.textPrimary }}>{pct(c.failShare)}</td>
                          <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>{c.rescheduled}</td>
                          <td style={{ ...tdStyle, color: COLORS.textSecondary }}>{c.failed > 0 ? deliveryFailLabel(c.topReason, lang) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardTable>
              </section>

              <section style={{ background: COLORS.surface, borderRadius: 24, boxShadow: "var(--shadow-raised)", overflow: "hidden" }}>
                <h3 style={{ fontFamily: F.display, fontSize: 15, fontWeight: 700, color: COLORS.textPrimary, margin: 0, padding: "18px 20px 0" }}>{t("По магазинам", "Do'konlar bo'yicha")}</h3>
                <p style={{ fontSize: 12, color: COLORS.textTertiary, margin: 0, padding: "2px 20px 6px" }}>
                  {t("Сверху — куда чаще всего возят впустую", "Tepada — eng ko'p behuda borilgan joylar")}
                </p>
                <CardTable style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }} data-testid="failed-deliveries-shops">
                    <thead><tr>{[t("МАГАЗИН", "DO'KON"), t("НЕ ДОСТАВЛЕНО", "YETKAZILMADI"), t("ПЕРЕНЕСЕНО", "KO'CHIRILDI"), t("ПОСЛЕДНЯЯ ПРИЧИНА", "OXIRGI SABAB")].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                    <tbody>
                      {r.byShop.slice(0, 50).map(s => (
                        <tr key={s.shopId}>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>{s.shopName}</td>
                          <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums", color: s.failed >= 3 ? "var(--color-danger-text)" : COLORS.textPrimary, fontWeight: s.failed >= 3 ? 700 : 400 }}>{s.failed}</td>
                          <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>{s.rescheduled}</td>
                          <td style={{ ...tdStyle, color: COLORS.textSecondary }}>
                            <span>{reason(s.last.reason, s.last.note)} <span style={{ color: COLORS.textTertiary, fontSize: 12, whiteSpace: "nowrap" }}>· {dmy(s.last.day)}</span></span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardTable>
              </section>

              <section style={{ background: COLORS.surface, borderRadius: 24, boxShadow: "var(--shadow-raised)", overflow: "hidden" }}>
                <h3 style={{ fontFamily: F.display, fontSize: 15, fontWeight: 700, color: COLORS.textPrimary, margin: 0, padding: "18px 20px 6px" }}>{t("Последние попытки", "Oxirgi urinishlar")}</h3>
                <CardTable style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }} data-testid="failed-deliveries-recent">
                    <thead><tr>{[t("КОГДА", "QACHON"), t("ЗАКАЗ", "BUYURTMA"), t("МАГАЗИН", "DO'KON"), t("КУРЬЕР", "KURYER"), t("ЧТО", "NIMA"), t("ПРИЧИНА", "SABAB")].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                    <tbody>
                      {r.recent.slice(0, 50).map(e => (
                        <tr key={e.id}>
                          <td style={{ ...tdStyle, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{dmy(e.at.slice(0, 10))} {e.at.slice(11)}</td>
                          <td style={tdStyle}><Link to={`/orders/${e.orderId}`} style={{ color: "var(--color-primary-text)" }}>{e.orderNumber}</Link></td>
                          <td style={tdStyle}>{e.shopName}</td>
                          <td style={tdStyle}>{e.courierName ?? "—"}</td>
                          <td style={{ ...tdStyle, color: e.kind === "failed" ? "var(--color-danger-text)" : "var(--color-info-text)" }}>
                            {e.kind === "failed" ? t("Не доставлен", "Yetkazilmadi") : e.rescheduledTo ? t(`Перенесён на ${dmy(e.rescheduledTo)}`, `${dmy(e.rescheduledTo)} ga ko'chirildi`) : t("Перенесён", "Ko'chirildi")}
                          </td>
                          <td style={{ ...tdStyle, color: COLORS.textSecondary }}>{reason(e.reason, e.note)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardTable>
              </section>
              {r.truncated && (
                <p style={{ fontSize: 12, color: "var(--color-warning-text)" }}>
                  {t("Попыток за период слишком много — сузьте период или выберите курьера.", "Davr ichida urinishlar juda ko'p — davrni qisqartiring yoki kuryerni tanlang.")}
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
