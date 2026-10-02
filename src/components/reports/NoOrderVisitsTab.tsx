import { useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { CircleSlash, FileDown, MapPin, PackageCheck, Swords, HelpCircle, Lightbulb } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useIsMobile } from "@/hooks/use-mobile";
import { exportToExcel } from "@/lib/excel";
import { PremiumSelect } from "@/components/PremiumSelect";
import { CardTable } from "@/components/CardTable";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { F, COLORS, thStyle, tdStyle } from "@/components/users/types";
import { useUrlState, urlNumber, type UrlCodec } from "@/hooks/useUrlState";
import {
  isNoOrderReason, noOrderReasonLabel, noOrderReasonText, NO_ORDER_STREAK_HINT,
  type NoOrderReason,
} from "@contracts/no-order-reason";

/*
  «Визиты без заказа» — раздел «Отчётов» директора, офиса и супервайзера.

  Агент закрывает визит без заказа только с причиной (components/visits/
  NoOrderReason). Здесь — что из этого складывается за период: какая доля
  визитов уходит впустую, почему, у кого из агентов и в каких магазинах. Два
  вывода, ради которых раздел и заведён, стоят отдельно, а не в таблице:
  «три визита подряд — есть остаток» (заказ великоват) и «берёт у
  конкурента» (магазины, куда ехать с ценой).

  Фильтры живут в адресе (?tab=noorder&from=…&to=…&agent=…&territory=…):
  ссылку на «Юнусабад за сентябрь» можно переслать, и она откроется тем же.
*/

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

/** Дата из адреса: не дата — значение по умолчанию; умолчание в адрес не пишется. */
function dateCodec(fallback: string): UrlCodec<string> {
  return {
    parse: raw => (/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : fallback),
    format: v => (v === fallback ? null : v),
  };
}

const pct = (share: number) => `${Math.round(share * 100)}%`;
/** «3 визита», «5 визитов» — по-русски число меняет слово. */
const visitsRu = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "визит" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "визита" : "визитов"}`;
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

const REASON_TONE: Record<NoOrderReason | "none", string> = {
  closed: "var(--color-text-tertiary)",
  no_money: "var(--color-danger)",
  has_stock: "var(--color-warning)",
  competitor: "var(--color-primary)",
  no_owner: "var(--color-info)",
  other: "var(--color-text-secondary)",
  none: "var(--color-border-strong)",
};

export function NoOrderVisitsTab() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const today = ymd(new Date());
  const monthAgo = ymd(subDays(new Date(), 30));

  const [from, setFrom] = useUrlState("from", monthAgo, dateCodec(monthAgo));
  const [to, setTo] = useUrlState("to", today, dateCodec(today));
  const [agentId, setAgentId] = useUrlState("agent", undefined, urlNumber);
  const [territoryId, setTerritoryId] = useUrlState("territory", undefined, urlNumber);

  const q = trpc.reports.noOrderVisits.useQuery({ dateFrom: from, dateTo: to, agentId, territoryId });
  const { data: agents } = trpc.agent.listAgents.useQuery();
  const { data: territories } = trpc.territory.list.useQuery();

  const reasonText = (r: string | null, note?: string | null) => noOrderReasonText(isNoOrderReason(r) ? r : null, note, lang);
  const preset = (days: number) => { setFrom(ymd(subDays(new Date(), days))); setTo(ymd(new Date())); };
  const presetOn = (days: number) => to === today && from === ymd(subDays(new Date(), days));

  const agentOptions = useMemo(() => [
    { value: "", label: t("Все агенты", "Barcha agentlar") },
    ...(agents ?? []).map(a => ({ value: String(a.id), label: a.name ?? `#${a.id}` })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [agents, lang]);
  const territoryOptions = useMemo(() => [
    { value: "", label: t("Все территории", "Barcha hududlar") },
    ...(territories ?? []).map(x => ({ value: String(x.id), label: x.name })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [territories, lang]);

  const r = q.data;
  // Магазинов за месяц — десятки: на телефоне это лента карточек на десять экранов.
  // Сначала самые долгие серии, остальное — по кнопке.
  const phone = useIsMobile();
  const [shopRows, setShopRows] = useState(phone ? 8 : 15);

  const exportXlsx = () => {
    if (!r) return;
    void exportToExcel(r.byShop.map(s => ({
      [t("Магазин", "Do'kon")]: s.shopName,
      [t("Город", "Shahar")]: s.city ?? "",
      [t("Визитов", "Tashriflar")]: s.visits,
      [t("Без заказа", "Buyurtmasiz")]: s.withoutOrder,
      [t("Доля", "Ulush")]: pct(s.share),
      [t("Подряд", "Ketma-ket")]: s.streak ? `${s.streak.count} × ${reasonText(s.streak.reason)}` : "",
      [t("Последняя причина", "Oxirgi sabab")]: s.last ? reasonText(s.last.reason, s.last.note) : "",
      [t("Дата", "Sana")]: s.last ? dmy(s.last.day) : "",
    })), `no-order-${from}_${to}`, t("Без заказа", "Buyurtmasiz"), t(`Визиты без заказа ${dmy(from)} — ${dmy(to)}`, `Buyurtmasiz tashriflar ${dmy(from)} — ${dmy(to)}`));
  };

  return (
    <div className="space-y-4" data-testid="no-order-report">
      {/* ── Фильтры ── */}
      <div className="neo-card report-filters" style={{ padding: 16 }}>
        <div className="flex flex-wrap items-end gap-3">
          <div role="group" aria-label={t("Период", "Davr")} className="range-pills">
            {[7, 30, 90].map(d => (
              <button key={d} type="button" onClick={() => preset(d)} className={"range-pill tap" + (presetOn(d) ? " active" : "")}>
                {t(`${d} дн.`, `${d} kun`)}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1" style={{ flex: "1 1 140px", maxWidth: phone ? undefined : 180 }}>
            <span className="font-label text-[10px] text-secondary">{t("С", "Dan")}</span>
            <input type="date" className="neo-input w-full" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} data-testid="no-order-from" style={{ minHeight: 44 }} />
          </label>
          <label className="flex flex-col gap-1" style={{ flex: "1 1 140px", maxWidth: phone ? undefined : 180 }}>
            <span className="font-label text-[10px] text-secondary">{t("По", "Gacha")}</span>
            <input type="date" className="neo-input w-full" value={to} min={from} max={today} onChange={e => e.target.value && setTo(e.target.value)} data-testid="no-order-to" style={{ minHeight: 44 }} />
          </label>
          <div style={{ flex: "1 1 180px", maxWidth: phone ? undefined : 240 }}>
            <PremiumSelect aria-label={t("Агент", "Agent")} value={agentId ? String(agentId) : ""} onChange={v => setAgentId(v ? Number(v) : undefined)} options={agentOptions} width="100%" />
          </div>
          <div style={{ flex: "1 1 180px", maxWidth: phone ? undefined : 240 }}>
            <PremiumSelect aria-label={t("Территория", "Hudud")} value={territoryId ? String(territoryId) : ""} onChange={v => setTerritoryId(v ? Number(v) : undefined)} options={territoryOptions} width="100%" />
          </div>
          <button type="button" onClick={exportXlsx} disabled={!r || r.byShop.length === 0} className="neo-btn tap disabled:opacity-40" style={{ minHeight: 44, padding: "0 16px", gap: 7, marginLeft: "auto" }}>
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
          {/* ── Итоги ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="no-order-totals">
            <Kpi label={t("Визитов", "Tashriflar")} value={String(r.totals.visits)} sub={t(`с заказом: ${r.totals.withOrder}`, `buyurtma bilan: ${r.totals.withOrder}`)} icon={<MapPin size={18} />} tone="var(--color-primary)" />
            <Kpi label={t("Без заказа", "Buyurtmasiz")} value={pct(r.totals.share)} sub={t(`${r.totals.withoutOrder} из ${r.totals.visits}`, `${r.totals.visits} tadan ${r.totals.withoutOrder}`)} icon={<CircleSlash size={18} />} tone="var(--color-danger)" />
            <Kpi label={t("Причина не указана", "Sabab ko'rsatilmagan")} value={String(r.totals.unspecified)} sub={t("отмечены старой мобилкой", "eski ilovadan belgilangan")} icon={<HelpCircle size={18} />} tone="var(--color-warning)" />
            <Kpi label={t("Берут у конкурента", "Raqobatchidan oladi")} value={String(r.competitorShops.length)} sub={t("магазинов за период", "davr ichida do'konlar")} icon={<Swords size={18} />} tone="var(--color-info)" />
          </div>

          {r.totals.visits === 0 ? (
            <div className="neo-card text-center" style={{ padding: 40, color: COLORS.textSecondary, fontSize: 14 }}>
              {t("За этот период визитов нет", "Bu davrda tashrif yo'q")}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:items-start">
                {/* ── Причины ── */}
                <section className="neo-card" style={{ padding: 20 }} data-testid="no-order-reasons">
                  <h3 style={{ fontFamily: F.display, fontSize: 15, fontWeight: 700, color: COLORS.textPrimary, margin: "0 0 14px" }}>
                    {t("Почему без заказа", "Nega buyurtmasiz")}
                  </h3>
                  {r.byReason.length === 0 ? (
                    <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: 0 }}>{t("Все визиты — с заказом", "Barcha tashriflar buyurtma bilan")}</p>
                  ) : r.byReason.map(x => (
                    <div key={x.reason ?? "none"} style={{ marginTop: 10 }} data-testid="no-order-reason-row">
                      <div className="flex items-baseline justify-between gap-3" style={{ fontSize: 13 }}>
                        <span style={{ color: COLORS.textPrimary, fontWeight: 600 }}>{noOrderReasonLabel(x.reason, lang)}</span>
                        <span className="font-data" style={{ color: COLORS.textSecondary }}>{x.count} · {pct(x.share)}</span>
                      </div>
                      <div style={{ height: 8, borderRadius: 999, background: "var(--color-surface-light)", boxShadow: "var(--shadow-pressed)", marginTop: 6, overflow: "hidden" }}>
                        <div style={{ width: `${Math.max(2, Math.round(x.share * 100))}%`, height: "100%", borderRadius: 999, background: REASON_TONE[x.reason ?? "none"] }} />
                      </div>
                    </div>
                  ))}
                </section>

                {/* ── Что из этого следует ── */}
                <section className="neo-card" style={{ padding: 20 }} data-testid="no-order-hints">
                  <h3 className="flex items-center gap-2" style={{ fontFamily: F.display, fontSize: 15, fontWeight: 700, color: COLORS.textPrimary, margin: "0 0 14px" }}>
                    <Lightbulb size={16} color="var(--color-warning-text)" aria-hidden />{t("Что из этого следует", "Bundan nima kelib chiqadi")}
                  </h3>
                  {r.stockStreaks.length === 0 && r.competitorShops.length === 0 && (
                    <p style={{ fontSize: 13, color: COLORS.textSecondary, margin: 0 }}>{t("Повторяющихся причин нет", "Takrorlanadigan sabablar yo'q")}</p>
                  )}
                  {r.stockStreaks.map(s => (
                    <div key={`s${s.shopId}`} className="flex items-start gap-3" style={{ padding: "12px 14px", borderRadius: 16, marginTop: 8, background: "var(--color-warning-subtle)" }} data-testid="no-order-stock-streak">
                      <PackageCheck size={18} color="var(--color-warning-text)" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />
                      <span style={{ fontSize: 13, color: COLORS.textPrimary }}>
                        {t(`«${s.shopName}» — ${visitsRu(s.count)} подряд «есть остаток»: заказ, похоже, великоват для его оборота`,
                           `«${s.shopName}» — ketma-ket ${s.count} marta «qoldiq bor»: buyurtma uning aylanmasi uchun kattaroq ko'rinadi`)}
                      </span>
                    </div>
                  ))}
                  {r.competitorShops.length > 0 && (
                    <div style={{ marginTop: r.stockStreaks.length ? 14 : 0 }} data-testid="no-order-competitors">
                      <p className="font-label" style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: COLORS.textTertiary, margin: "0 0 6px" }}>
                        {t("Берут у конкурента — ехать с ценой", "Raqobatchidan oladi — narx bilan borish kerak")}
                      </p>
                      {r.competitorShops.slice(0, phone ? 6 : 12).map(c => (
                        <div key={`c${c.shopId}`} className="flex items-center justify-between gap-3" style={{ padding: "8px 0", fontSize: 13 }}>
                          <span className="min-w-0 truncate" style={{ color: COLORS.textPrimary, fontWeight: 600 }}>{c.shopName}{c.city ? <span style={{ color: COLORS.textTertiary, fontWeight: 400 }}> · {c.city}</span> : null}</span>
                          <span className="font-data flex-shrink-0" style={{ color: COLORS.textSecondary }}>{c.count}× · {dmy(c.lastDay)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              {/* ── По агентам ── */}
              <section style={{ background: COLORS.surface, borderRadius: 24, boxShadow: "var(--shadow-raised)", overflow: "hidden" }}>
                <h3 style={{ fontFamily: F.display, fontSize: 15, fontWeight: 700, color: COLORS.textPrimary, margin: 0, padding: "18px 20px 6px" }}>{t("По агентам", "Agentlar bo'yicha")}</h3>
                <CardTable style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }} data-testid="no-order-agents">
                    <thead><tr>{[t("АГЕНТ", "AGENT"), t("ВИЗИТОВ", "TASHRIFLAR"), t("БЕЗ ЗАКАЗА", "BUYURTMASIZ"), t("ДОЛЯ", "ULUSH"), t("ЧАЩЕ ВСЕГО", "KO'PINCHA")].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                    <tbody>
                      {r.byAgent.map(a => (
                        <tr key={a.agentId}>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>{a.agentName}</td>
                          <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>{a.visits}</td>
                          <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>{a.withoutOrder}</td>
                          <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums", fontWeight: 700, color: a.share >= 0.5 ? "var(--color-danger-text)" : a.share >= 0.3 ? "var(--color-warning-text)" : COLORS.textPrimary }}>{pct(a.share)}</td>
                          <td style={{ ...tdStyle, color: COLORS.textSecondary }}>{a.withoutOrder > 0 ? noOrderReasonLabel(a.topReason, lang) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardTable>
              </section>

              {/* ── По магазинам ── */}
              <section style={{ background: COLORS.surface, borderRadius: 24, boxShadow: "var(--shadow-raised)", overflow: "hidden" }}>
                <h3 style={{ fontFamily: F.display, fontSize: 15, fontWeight: 700, color: COLORS.textPrimary, margin: 0, padding: "18px 20px 0" }}>
                  {t("По магазинам", "Do'konlar bo'yicha")}
                </h3>
                <p style={{ fontSize: 12, color: COLORS.textTertiary, margin: 0, padding: "2px 20px 6px" }}>
                  {t("Сверху — кто дольше подряд без заказа", "Tepada — ketma-ket uzoqroq buyurtmasizlar")}
                </p>
                <CardTable style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }} data-testid="no-order-shops">
                    <thead><tr>{[t("МАГАЗИН", "DO'KON"), t("ВИЗИТОВ", "TASHRIFLAR"), t("БЕЗ ЗАКАЗА", "BUYURTMASIZ"), t("ПОДРЯД", "KETMA-KET"), t("ПОСЛЕДНЯЯ ПРИЧИНА", "OXIRGI SABAB")].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                    <tbody>
                      {r.byShop.slice(0, shopRows).map(s => {
                        const hot = s.streak && s.streak.count >= NO_ORDER_STREAK_HINT;
                        return (
                          <tr key={s.shopId}>
                            <td style={tdStyle}>
                              {/* Одним узлом: на телефоне ячейка — строка «подпись · значение». */}
                              <span><span style={{ fontWeight: 600 }}>{s.shopName}</span>{s.city && <span style={{ color: COLORS.textTertiary, fontSize: 12 }}> · {s.city}</span>}</span>
                            </td>
                            <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>{s.visits}</td>
                            <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>{s.withoutOrder} · {pct(s.share)}</td>
                            <td style={{ ...tdStyle, color: hot ? "var(--color-warning-text)" : COLORS.textSecondary, fontWeight: hot ? 700 : 400 }}>
                              {s.streak ? `${s.streak.count} × ${reasonText(s.streak.reason)}` : "—"}
                            </td>
                            <td style={{ ...tdStyle, color: COLORS.textSecondary }}>
                              {s.last ? <span>{reasonText(s.last.reason, s.last.note)} <span style={{ color: COLORS.textTertiary, fontSize: 12, whiteSpace: "nowrap" }}>· {dmy(s.last.day)}</span></span> : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardTable>
                {r.byShop.length > shopRows && (
                  <div style={{ padding: 16 }}>
                    <button type="button" onClick={() => setShopRows(n => n + 30)} className="neo-btn tap w-full" style={{ minHeight: 44 }} data-testid="no-order-shops-more">
                      {t(`Показать ещё ${Math.min(30, r.byShop.length - shopRows)} (осталось ${r.byShop.length - shopRows})`,
                         `Yana ${Math.min(30, r.byShop.length - shopRows)} ko'rsatish (qoldi ${r.byShop.length - shopRows})`)}
                    </button>
                  </div>
                )}
              </section>
              {r.truncated && (
                <p style={{ fontSize: 12, color: "var(--color-warning-text)" }}>
                  {t("Визитов за период слишком много — сузьте период или выберите агента.", "Davr ichida tashriflar juda ko'p — davrni qisqartiring yoki agentni tanlang.")}
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
