import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { PremiumSelect } from "@/components/PremiumSelect";
import { SectionNotice } from "@/components/SectionNotice";
import { exportToExcel } from "@/lib/export";
import { notify } from "@/lib/toast";
import { unitShort } from "@/lib/units";
import { F, COLORS, thStyle, tdStyle } from "@/components/users/types";
import { CalendarClock, FileSpreadsheet, Flame, Trash2, Clock } from "lucide-react";

/**
 * Что сгорает.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * Срок годности записывался на приёмке и там же и оставался: на остатке лежало
 * одно число на товар, без памяти о том, какими партиями оно набралось.
 * Ответить, что сгорит через неделю, было нечем. Кладовщик узнавал об этом,
 * когда шёл списывать.
 *
 * ── Почему три состояния, а не число дней ───────────────────────────────────
 *
 * По ним принимают РАЗНЫЕ решения, и человек не должен выводить их из «−3».
 *
 *   просрочено  — списать, это уже убыток;
 *   горит       — двигать сегодня: акция, ближний магазин, скидка;
 *   скоро       — держать в виду при планировании закупки.
 *
 * Поэтому наверху три плитки, а не одна общая сумма: общая сумма отвечает на
 * вопрос «сколько денег в риске», но не говорит, что делать сейчас.
 *
 * ── Про деньги ──────────────────────────────────────────────────────────────
 *
 * Показывается цена ЗАКУПКИ: столько денег сгорает вместе с товаром. Цена
 * продажи здесь ни при чём — непроданный товар выручки не приносил, и считать
 * упущенной её значило бы завысить убыток.
 */

type Row = {
  batchId: number;
  productId: number;
  productName: string | null;
  productCode: string | null;
  unit: string | null;
  warehouseName: string | null;
  batchNumber: string | null;
  expiresAt: string | Date | null;
  quantity: number;
  daysLeft: number;
  value: number;
  state: "expired" | "urgent" | "soon";
};

const STATE_STYLE: Record<Row["state"], { chip: string; icon: typeof Flame }> = {
  expired: { chip: "bg-danger/15 text-danger border-danger/30", icon: Trash2 },
  urgent:  { chip: "bg-warning/15 text-warning border-warning/30", icon: Flame },
  soon:    { chip: "bg-info/15 text-info border-info/30", icon: Clock },
};

/** Дата как её показывают человеку: без времени и без часового пояса. */
function showDay(value: string | Date | null): string {
  if (value == null) return "—";
  const day = typeof value === "string" ? value.slice(0, 10) : [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
  const [y, m, d] = day.split("-");
  return `${d}.${m}.${y}`;
}

export function ExpiringBatches() {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);

  const [withinDays, setWithinDays] = useState(30);
  const [state, setState] = useState<"all" | Row["state"]>("all");

  const listQ = trpc.warehouseReports.expiring.useQuery({ withinDays });
  const sumQ = trpc.warehouseReports.expiringSummary.useQuery({ withinDays });

  // Пустой список берётся из useMemo, а не из `?? []` по месту: новый массив
  // на каждом отрисовывании сбрасывал бы память фильтра ниже.
  const rows = useMemo(() => (listQ.data ?? []) as Row[], [listQ.data]);
  const shown = useMemo(
    () => (state === "all" ? rows : rows.filter(r => r.state === state)),
    [rows, state],
  );

  const tiles = [
    {
      key: "expired" as const,
      label: t("Просрочено", "Muddati o'tgan"),
      count: sumQ.data?.expiredCount ?? 0,
      money: sumQ.data?.expiredValue ?? 0,
      gradient: "linear-gradient(135deg, var(--color-danger), var(--color-danger-text))",
      icon: <Trash2 size={20} color="#fff" />,
    },
    {
      key: "urgent" as const,
      label: t("Горит: до 7 дней", "Yonmoqda: 7 kungacha"),
      count: sumQ.data?.urgentCount ?? 0,
      money: null,
      gradient: "linear-gradient(135deg, var(--color-warning), var(--color-danger))",
      icon: <Flame size={20} color="#fff" />,
    },
    {
      key: "soon" as const,
      label: t("Скоро", "Tez orada"),
      count: sumQ.data?.soonCount ?? 0,
      money: sumQ.data?.liveValue ?? 0,
      gradient: "linear-gradient(135deg, var(--color-info), var(--color-primary))",
      icon: <CalendarClock size={20} color="#fff" />,
    },
  ];

  /* Выгрузка — по-русски всегда: это бумага, а не экран. */
  const handleExport = async () => {
    if (shown.length === 0) {
      notify.info(t("Нечего выгружать", "Yuklab olish uchun hech narsa yo'q"));
      return;
    }
    const STATE_RU: Record<Row["state"], string> = {
      expired: "Просрочено", urgent: "Горит", soon: "Скоро",
    };
    await exportToExcel([{
      name: "Сроки годности",
      data: shown.map(r => ({
        product: r.productName ?? "",
        code: r.productCode ?? "",
        warehouse: r.warehouseName ?? "",
        batch: r.batchNumber ?? "",
        expires: showDay(r.expiresAt),
        daysLeft: r.daysLeft,
        quantity: r.quantity,
        unit: r.unit ?? "",
        value: r.value,
        state: STATE_RU[r.state],
      })),
      columns: [
        { key: "product", header: "Товар", width: 30 },
        { key: "code", header: "Код", width: 14 },
        { key: "warehouse", header: "Склад", width: 18 },
        { key: "batch", header: "Партия", width: 16 },
        { key: "expires", header: "Годен до", width: 12 },
        { key: "daysLeft", header: "Осталось дней", width: 14 },
        { key: "quantity", header: "Количество", width: 12 },
        { key: "unit", header: "Ед.", width: 8 },
        { key: "value", header: "Сумма закупки", width: 16 },
        { key: "state", header: "Состояние", width: 14 },
      ],
    }], "sroki-godnosti");
  };

  return (
    <div className="neo-card neo-card-static" style={{ borderRadius: "24px", padding: "24px" }}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h3 style={{ fontFamily: F.display, fontSize: "18px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.02em" }}>
            {t("Сроки годности", "Yaroqlilik muddati")}
          </h3>
          <p style={{ fontFamily: F.body, fontSize: "13px", color: COLORS.textSecondary, marginTop: "2px" }}>
            {t("Что сгорает и на какую сумму", "Nima yonadi va qancha summaga")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PremiumSelect
            value={String(withinDays)}
            onChange={v => setWithinDays(Number(v))}
            options={[
              { value: "7", label: t("7 дней", "7 kun") },
              { value: "30", label: t("30 дней", "30 kun") },
              { value: "90", label: t("90 дней", "90 kun") },
              { value: "180", label: t("180 дней", "180 kun") },
            ]}
          />
          <button className="neo-btn" onClick={handleExport} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <FileSpreadsheet size={15} />
            <span className="hidden sm:inline">Excel</span>
          </button>
        </div>
      </div>

      {/* Три состояния — три плитки: по ним принимают разные решения. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        {tiles.map(tile => {
          const active = state === tile.key;
          return (
            <button
              key={tile.key}
              onClick={() => setState(active ? "all" : tile.key)}
              className={active ? "kpi-hero neo-card-pressed" : "kpi-hero"}
              style={{ borderRadius: "20px", padding: "18px", textAlign: "left", cursor: "pointer" }}
              aria-pressed={active}
            >
              <div className="flex items-start justify-between mb-3">
                <span style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>
                  {tile.label}
                </span>
                <div style={{ width: "38px", height: "38px", borderRadius: "11px", background: tile.gradient, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {tile.icon}
                </div>
              </div>
              <div style={{ fontFamily: F.display, fontSize: "28px", fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1, letterSpacing: "-0.03em" }}>
                {tile.count}
              </div>
              {tile.money !== null && (
                <div style={{ marginTop: "8px", fontFamily: F.body, fontSize: "12px", fontWeight: 600, color: COLORS.textSecondary }}>
                  {fmt(tile.money)}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {listQ.isLoadingError ? (
        <SectionNotice
          kind="error"
          message={t("Не удалось загрузить сроки", "Muddatlarni yuklab bo'lmadi")}
          onRetry={() => listQ.refetch()}
        />
      ) : listQ.isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-12 bg-surface-light animate-pulse rounded-xl" />)}
        </div>
      ) : shown.length === 0 ? (
        <SectionNotice
          kind="empty"
          message={
            rows.length === 0
              ? t("Ничего не сгорает в этот срок", "Bu muddatda hech narsa yonmaydi")
              : t("В этом состоянии ничего нет", "Bu holatda hech narsa yo'q")
          }
        />
      ) : (
        <>
          {/* На широком экране — таблица: её сортируют глазами и выгружают. */}
          <div className="hidden lg:block overflow-x-auto">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("Товар", "Mahsulot")}</th>
                  <th style={thStyle}>{t("Партия", "Partiya")}</th>
                  <th style={thStyle}>{t("Годен до", "Yaroqli")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Осталось", "Qoldi")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Количество", "Miqdori")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Сумма", "Summa")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(r => {
                  const s = STATE_STYLE[r.state];
                  const Icon = s.icon;
                  return (
                    <tr key={r.batchId}>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600 }}>{r.productName ?? "—"}</div>
                        <div style={{ fontSize: "12px", color: COLORS.textTertiary }}>
                          {[r.productCode, r.warehouseName].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td style={{ ...tdStyle, color: COLORS.textSecondary }}>{r.batchNumber ?? "—"}</td>
                      <td style={tdStyle}>{showDay(r.expiresAt)}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-semibold ${s.chip}`}>
                          <Icon size={12} />
                          {r.daysLeft < 0
                            ? t(`просрочено на ${-r.daysLeft} дн.`, `${-r.daysLeft} kun o'tgan`)
                            : t(`${r.daysLeft} дн.`, `${r.daysLeft} kun`)}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {r.quantity} {unitShort(r.unit ?? undefined, lang)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                        {fmt(r.value)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* На телефоне те же данные карточками. */}
          <div className="lg:hidden space-y-2">
            {shown.map(r => {
              const s = STATE_STYLE[r.state];
              const Icon = s.icon;
              return (
                <div key={r.batchId} className="neo-card-sm" style={{ borderRadius: "16px", padding: "14px" }}>
                  <div className="flex items-start justify-between gap-2">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: F.display, fontWeight: 600, color: COLORS.textPrimary }}>
                        {r.productName ?? "—"}
                      </div>
                      <div style={{ fontSize: "12px", color: COLORS.textTertiary }}>
                        {[r.batchNumber, r.warehouseName].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                    <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-semibold ${s.chip}`}>
                      <Icon size={12} />
                      {r.daysLeft < 0 ? `−${-r.daysLeft}` : r.daysLeft} {t("дн.", "kun")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-3" style={{ fontSize: "13px", color: COLORS.textSecondary }}>
                    <span>{t("до", "gacha")} {showDay(r.expiresAt)}</span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>
                      {r.quantity} {unitShort(r.unit ?? undefined, lang)} · <b style={{ color: COLORS.textPrimary }}>{fmt(r.value)}</b>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
