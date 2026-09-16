import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { SectionNotice } from "@/components/SectionNotice";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { PremiumSelect } from "@/components/PremiumSelect";
import { exportToExcel } from "@/lib/export";
import { ROLE_LABEL } from "@/lib/entity-labels";
import { RISK_LABEL, LEVEL_LABEL, riskDetail, type RiskFactor, type RiskLevel } from "@/lib/risk-labels";
import { F, COLORS, thStyle, tdStyle } from "@/components/users/types";
import { format, subDays, addDays } from "date-fns";
import { ShieldCheck, ShieldAlert, MessageSquareWarning, HandCoins, FileSpreadsheet, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";

/*
  Контроль — рабочее место директора.

  Сверху — четыре числа за срок: спорные доставки, доставки без слова
  магазина, подтверждённые, люди в зоне риска. Ниже — сотрудники по индексу
  риска: баллы, уровень, факторы словами и числами; строка раскрывается в
  объяснение. Внизу — спорные доставки: что сказал магазин, кто вёз,
  ссылка на заказ. Excel — по-русски.
*/
const LEVEL_COLOR: Record<RiskLevel, string> = { calm: "var(--color-success-text)", watch: "var(--color-warning-text)", act: "var(--color-danger-text)" };

export default function Control() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { fmt } = useCurrency();
  const navigate = useNavigate();
  const [days, setDays] = useState("30");
  const [now] = useState(() => new Date());
  const range = useMemo(() => ({ from: subDays(now, Number(days)).toISOString(), to: addDays(now, 1).toISOString() }), [now, days]);
  const status = trpc.control.status.useQuery();
  const on = status.data?.enabled === true;
  const overview = trpc.control.overview.useQuery(range, { enabled: on, refetchInterval: 120_000 });
  const disputes = trpc.control.disputes.useQuery(range, { enabled: on });
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const d = overview.data;
  const label = { fontFamily: F.display, fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: COLORS.textTertiary };
  const roleOf = (r: string) => (ROLE_LABEL as Record<string, { ru: string; uz: string }>)[r]?.[lang] ?? r;
  const factorText = (f: RiskFactor) => `${RISK_LABEL[f.code][lang]}${riskDetail(f, lang, fmt) ? ` — ${riskDetail(f, lang, fmt)}` : ""}`;

  const excel = () => exportToExcel([{
    name: "Индекс риска",
    data: (d?.employees ?? []).map(e => ({
      name: e.name, role: (ROLE_LABEL as Record<string, { ru: string }>)[e.role]?.ru ?? e.role, score: e.score, level: LEVEL_LABEL[e.level].ru,
      factors: e.factors.map(f => `${RISK_LABEL[f.code].ru}${riskDetail(f, "ru", fmt) ? ` — ${riskDetail(f, "ru", fmt)}` : ""}`).join("; "),
      delivered: e.delivered, confirmed: e.confirmed, disputed: e.disputed, onHand: e.onHand, debt: e.debt,
    })),
    columns: [
      { key: "name", header: "Сотрудник", width: 26 }, { key: "role", header: "Роль", width: 14 }, { key: "score", header: "Баллы", width: 8 }, { key: "level", header: "Уровень", width: 14 },
      { key: "factors", header: "Факторы", width: 70 }, { key: "delivered", header: "Доставлено", width: 11 }, { key: "confirmed", header: "Подтверждено", width: 13 }, { key: "disputed", header: "Спорных", width: 9 },
      { key: "onHand", header: "На руках", width: 14 }, { key: "debt", header: "Долг", width: 14 },
    ],
  }, {
    name: "Спорные доставки",
    data: (disputes.data ?? []).map(x => ({ number: x.number, shop: x.shopName, courier: x.courierName ?? "", at: x.disputedAt ? format(new Date(x.disputedAt), "dd.MM.yyyy HH:mm") : "", note: x.note ?? "", total: x.total })),
    columns: [{ key: "number", header: "Заказ", width: 10 }, { key: "shop", header: "Магазин", width: 26 }, { key: "courier", header: "Кто вёз", width: 20 }, { key: "at", header: "Когда", width: 16 }, { key: "note", header: "Что не сходится", width: 50 }, { key: "total", header: "Сумма", width: 14 }],
  }], `control-${days}d`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 style={{ fontFamily: F.display, fontSize: "22px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.02em" }}>{t("Контроль", "Nazorat")}</h1>
          <p style={{ fontFamily: F.body, fontSize: "13px", color: COLORS.textSecondary }}>{t("Слово магазина и индекс риска: куда смотреть сначала", "Do'kon so'zi va xavf indeksi: avval qayerga qarash")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PremiumSelect value={days} onChange={setDays} options={[{ value: "7", label: t("7 дней", "7 kun") }, { value: "30", label: t("30 дней", "30 kun") }, { value: "90", label: t("90 дней", "90 kun") }]} width="140px" />
          <button className="neo-btn" onClick={excel} disabled={!d} data-testid="control-excel"><FileSpreadsheet size={15} /> Excel</button>
        </div>
      </div>

      {status.data && !on ? (
        <SectionNotice kind="empty" message={status.data.planAllows ? t("Контроль выключен — включите его в Настройки → Контроль", "Nazorat o'chiq — Sozlamalar → Nazorat da yoqing") : t("Контроль доступен на тарифах Pro и Exclusive", "Nazorat Pro va Exclusive tariflarida")} />
      ) : overview.isError ? <QueryErrorFallback message={overview.error.message} onRetry={() => overview.refetch()} /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: t("Спорных доставок", "Nizoli yetkazishlar"), n: d?.totals.disputed ?? 0, icon: MessageSquareWarning, sub: t("магазин сказал «не сходится»", "do'kon «to'g'ri kelmaydi» dedi"), danger: (d?.totals.disputed ?? 0) > 0 },
              { label: t("Без слова магазина", "Do'kon so'zisiz"), n: d?.totals.unconfirmed ?? 0, icon: ShieldAlert, sub: t("доставлено больше 48 ч назад", "48 soatdan oldin yetkazilgan") },
              { label: t("Подтверждено", "Tasdiqlangan"), n: d?.totals.confirmed ?? 0, icon: ShieldCheck, sub: `${t("из", "jami")} ${d?.totals.delivered ?? 0} ${t("доставленных", "yetkazilgan")}` },
              { label: t("В зоне риска", "Xavf zonasida"), n: d?.totals.atRisk ?? 0, icon: HandCoins, sub: t("сотрудников — присмотреться или разобраться", "xodim — kuzatish yoki aniqlash kerak"), danger: (d?.totals.atRisk ?? 0) > 0 },
            ].map(tile => (
              <div key={tile.label} className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "16px" }}>
                <div className="flex items-center justify-between"><div style={{ ...label, color: tile.danger ? "var(--color-danger-text)" : COLORS.textTertiary }}>{tile.label}</div><tile.icon size={16} style={{ color: tile.danger ? "var(--color-danger-text)" : COLORS.textTertiary }} /></div>
                <div className="font-data" style={{ fontFamily: F.display, fontSize: "20px", fontWeight: 700, color: tile.danger ? "var(--color-danger-text)" : tile.n === 0 ? COLORS.textTertiary : COLORS.textPrimary, marginTop: "6px", lineHeight: 1 }}>{tile.n}</div>
                <div style={{ fontSize: "12px", color: COLORS.textSecondary, marginTop: "4px" }}>{tile.sub}</div>
              </div>
            ))}
          </div>

          <div className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "8px" }}>
            <div style={{ padding: "6px 10px", fontFamily: F.display, fontSize: "13px", fontWeight: 700, color: COLORS.textPrimary }}>{t("Сотрудники по индексу риска", "Xodimlar xavf indeksi bo'yicha")}</div>
            {overview.isLoading ? <div className="p-4 text-sm" style={{ color: COLORS.textTertiary }}>{t("Считаю…", "Hisoblayapman…")}</div>
            : (d?.employees.length ?? 0) === 0 ? <SectionNotice kind="empty" message={t("Полевых сотрудников нет", "Dala xodimlari yo'q")} /> : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "760px" }}>
                  <thead><tr><th style={thStyle}></th><th style={thStyle}>{t("Сотрудник", "Xodim")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("Баллы", "Ball")}</th><th style={thStyle}>{t("Уровень", "Daraja")}</th><th style={thStyle}>{t("Почему", "Nima uchun")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("Доставлено · подтверждено", "Yetkazildi · tasdiqlandi")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("На руках", "Qo'lda")}</th></tr></thead>
                  <tbody>{d!.employees.map(e => (
                    <EmployeeRows key={e.id} e={e} open={!!open[e.id]} toggle={() => setOpen({ ...open, [e.id]: !open[e.id] })} roleOf={roleOf} factorText={factorText} fmt={fmt} lang={lang} />
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>

          <div className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "8px" }}>
            <div style={{ padding: "6px 10px", fontFamily: F.display, fontSize: "13px", fontWeight: 700, color: COLORS.textPrimary }}>{t("Спорные доставки", "Nizoli yetkazishlar")} · {disputes.data?.length ?? 0}</div>
            {(disputes.data?.length ?? 0) === 0 ? <SectionNotice kind="empty" message={t("Магазины ничего не оспаривали", "Do'konlar hech narsani rad etmagan")} /> : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "720px" }}>
                  <thead><tr><th style={thStyle}>{t("Заказ", "Buyurtma")}</th><th style={thStyle}>{t("Магазин", "Do'kon")}</th><th style={thStyle}>{t("Кто вёз", "Kim olib bordi")}</th><th style={thStyle}>{t("Когда", "Qachon")}</th><th style={thStyle}>{t("Что не сходится", "Nima to'g'ri kelmaydi")}</th><th style={{ ...thStyle, textAlign: "right" }}>{t("Сумма", "Summa")}</th></tr></thead>
                  <tbody>{(disputes.data ?? []).map(x => (
                    <tr key={x.id} className="row-hover" data-testid={`dispute-${x.id}`} style={{ cursor: "pointer" }} onClick={() => navigate(`/orders/${x.id}`)}>
                      <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: "nowrap" }}>{x.number} <ExternalLink size={11} style={{ display: "inline", color: COLORS.textTertiary }} /></td>
                      <td style={tdStyle}>{x.shopName}</td>
                      <td style={tdStyle}>{x.courierName ?? "—"}</td>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{x.disputedAt ? format(new Date(x.disputedAt), "dd.MM HH:mm") : ""}</td>
                      <td style={{ ...tdStyle, color: "var(--color-danger-text)" }}>«{x.note}»</td>
                      <td className="font-data" style={{ ...tdStyle, textAlign: "right" }}>{fmt(x.total)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

type Employee = { id: number; name: string; role: string; score: number; level: RiskLevel; factors: RiskFactor[]; delivered: number; confirmed: number; disputed: number; onHand: number; debt: number };

function EmployeeRows({ e, open, toggle, roleOf, factorText, fmt, lang }: { e: Employee; open: boolean; toggle: () => void; roleOf: (r: string) => string; factorText: (f: RiskFactor) => string; fmt: (n: number) => string; lang: "ru" | "uz" }) {
  const color = LEVEL_COLOR[e.level];
  return (
    <>
      <tr className="row-hover" data-testid={`risk-${e.id}`} style={{ cursor: e.factors.length ? "pointer" : "default" }} onClick={() => e.factors.length && toggle()}>
        <td style={{ ...tdStyle, width: 28, color: COLORS.textTertiary }}>{e.factors.length ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}</td>
        <td style={tdStyle}><div style={{ fontWeight: 600 }}>{e.name}</div><div style={{ fontSize: 11, color: COLORS.textTertiary }}>{roleOf(e.role)}</div></td>
        <td className="font-data" style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color }} data-testid={`risk-score-${e.id}`}>{e.score}</td>
        <td style={tdStyle}><span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600, color, background: "var(--color-surface-light)" }}>{LEVEL_LABEL[e.level][lang]}</span></td>
        <td style={{ ...tdStyle, fontSize: 12, color: COLORS.textSecondary }}>{e.factors.length === 0 ? "—" : e.factors.slice(0, 3).map(f => RISK_LABEL[f.code][lang]).join(" · ") + (e.factors.length > 3 ? ` +${e.factors.length - 3}` : "")}</td>
        <td className="font-data" style={{ ...tdStyle, textAlign: "right" }}>{e.delivered} · {e.confirmed}{e.disputed > 0 && <span style={{ color: "var(--color-danger-text)" }}> · ⚠ {e.disputed}</span>}</td>
        <td className="font-data" style={{ ...tdStyle, textAlign: "right", color: e.debt > 0 ? "var(--color-danger-text)" : COLORS.textPrimary }}>{fmt(e.onHand)}{e.debt > 0 && <div style={{ fontSize: 11 }}>{lang === "uz" ? "qarz" : "долг"} {fmt(e.debt)}</div>}</td>
      </tr>
      {open && (
        <tr data-testid={`risk-why-${e.id}`}><td style={tdStyle}></td><td colSpan={6} style={{ ...tdStyle, paddingTop: 0 }}>
          <ul className="space-y-1" style={{ fontSize: 13, margin: 0, paddingLeft: 0, listStyle: "none" }}>
            {e.factors.map(f => <li key={f.code} className="flex items-center gap-2"><span className="font-data" style={{ minWidth: 34, textAlign: "right", fontWeight: 700, color }}>+{f.points}</span><span>{factorText(f)}</span></li>)}
          </ul>
        </td></tr>
      )}
    </>
  );
}
