import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { PremiumSelect } from "@/components/PremiumSelect";
import { SectionNotice } from "@/components/SectionNotice";
import { formatQty } from "@/lib/format";
import { F, COLORS, thStyle, tdStyle } from "@/components/users/types";
import { CalendarX2, Flame, TrendingUp, X } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

/**
 * Прогноз спроса: когда кончится и что заказать.
 *
 * ── Зачем появилось ─────────────────────────────────────────────────────────
 *
 * Пять ручек прогноза — исчерпание запасов, рекомендации к дозаказу, спрос по
 * товару, тренд категории, что лучше продаётся — написаны и не вызывались
 * ниоткуда. За ними стоит настоящая служба (services/stock-predictor.ts,
 * forecast-engine.ts): скользящее среднее, экспоненциальное сглаживание,
 * линейный тренд, недельная сезонность и выбор лучшего метода по ошибке.
 *
 * ── Чем это отличается от вкладки «Дозаказ» ─────────────────────────────────
 *
 * Соседняя вкладка отвечает «что УЖЕ ниже порога» — это состояние на сегодня.
 * Здесь другой вопрос: КОГДА кончится и СКОЛЬКО заказать с учётом времени
 * доставки. Товар может быть выше порога и всё равно кончиться через три дня,
 * если его разбирают втрое быстрее обычного.
 *
 * Так в продукте оказалось ТРИ ответа на близкие вопросы: warehouse.
 * reorderSuggestions (вкладка «Дозаказ»), warehouseReports.reorderAlerts
 * (мобилка) и forecast.reorderRecommendation (эта вкладка). Свести их в один —
 * отдельная работа, и она про сервер: у мобильного приложения свой контракт, и
 * менять его надо вместе с его выпуском.
 */

const URGENCY_CHIP: Record<string, string> = {
  critical: "bg-danger/15 text-danger border-danger/30",
  warning:  "bg-warning/15 text-warning border-warning/30",
  ok:       "bg-success/15 text-success border-success/30",
};

export function DemandForecast() {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);

  const [leadTime, setLeadTime] = useState(3);
  const [period, setPeriod] = useState<"7d" | "30d">("7d");
  const [picked, setPicked] = useState<{ id: number; name: string } | null>(null);

  const stockoutQ = trpc.forecast.stockoutPrediction.useQuery({ lookbackDays: 30 });
  const reorderQ = trpc.forecast.reorderRecommendation.useQuery({ lookbackDays: 30, leadTimeDays: leadTime });
  const trendingQ = trpc.forecast.trendingProducts.useQuery({ period });

  const URGENCY_LABEL: Record<string, string> = {
    critical: t("критично", "kritik"),
    warning:  t("скоро", "tez orada"),
    ok:       t("в порядке", "yaxshi"),
  };

  /*
    Показываются только те, кому что-то грозит.

    Полный список «всё в порядке» — это шум: вкладка отвечает на вопрос «что
    делать», а не «как дела». Товар без риска в ней не нужен.
  */
  const atRisk = (stockoutQ.data ?? []).filter(p => p.urgency !== "ok");
  const toOrder = reorderQ.data ?? [];

  return (
    <div className="space-y-5">
      {picked && (
        <ProductForecast
          product={picked}
          onClose={() => setPicked(null)}
          t={t}
        />
      )}

      {/* ── Когда кончится ─────────────────────────────────────────────── */}
      <div className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "20px" }}>
        <div className="flex items-center gap-2 mb-1">
          <CalendarX2 size={16} style={{ color: COLORS.textTertiary }} />
          <h3 style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 700, color: COLORS.textPrimary }}>
            {t("Когда кончится", "Qachon tugaydi")}
          </h3>
        </div>
        <p style={{ fontSize: "13px", color: COLORS.textSecondary, marginBottom: "14px" }}>
          {t(
            "По скорости продаж за 30 дней. Товар бывает выше порога и всё равно кончается через три дня.",
            "30 kunlik sotuv tezligi bo'yicha. Mahsulot chegaradan yuqori bo'lsa ham uch kunda tugashi mumkin.",
          )}
        </p>

        {stockoutQ.isLoadingError ? (
          <SectionNotice kind="error" message={t("Не удалось построить прогноз", "Prognozni tuzib bo'lmadi")} onRetry={() => stockoutQ.refetch()} />
        ) : stockoutQ.isLoading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-10 bg-surface-light animate-pulse rounded-xl" />)}</div>
        ) : atRisk.length === 0 ? (
          <SectionNotice kind="empty" message={t("Ничему не грозит закончиться", "Hech narsa tugash arafasida emas")} />
        ) : (
          <div className="overflow-x-auto">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("Товар", "Mahsulot")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Остаток", "Qoldiq")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("В день", "Kuniga")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Хватит на", "Yetadi")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("В пути", "Yo'lda")}</th>
                </tr>
              </thead>
              <tbody>
                {atRisk.map(p => (
                  <tr key={p.productId}>
                    <td style={tdStyle}>
                      <button className="text-left" onClick={() => setPicked({ id: p.productId, name: p.productName })}>
                        <span style={{ fontWeight: 600 }}>{p.productName}</span>
                        <span style={{ fontSize: "12px", color: COLORS.textTertiary }}> · {p.productCode}</span>
                      </button>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {formatQty(p.currentStock)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", color: COLORS.textSecondary }}>
                      {p.avgDailyConsumption.toFixed(1)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <span className={`inline-flex px-2 py-1 rounded-lg border text-xs font-semibold ${URGENCY_CHIP[p.urgency]}`}>
                        {p.daysUntilStockout >= 999
                          ? t("не расходуется", "sarflanmaydi")
                          : `${p.daysUntilStockout} ${t("дн.", "kun")} · ${URGENCY_LABEL[p.urgency]}`}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", color: COLORS.textSecondary }}>
                      {/* Уже заказанное у поставщика: без него дозаказ был бы вторым. */}
                      {p.pendingArrivals > 0 ? formatQty(p.pendingArrivals) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Что заказать ───────────────────────────────────────────────── */}
      <div className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "20px" }}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-2">
            <Flame size={16} style={{ color: COLORS.textTertiary }} />
            <h3 style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 700, color: COLORS.textPrimary }}>
              {t("Что заказать", "Nima buyurtma qilish")}
            </h3>
          </div>
          <label className="flex items-center gap-2" style={{ fontSize: "13px", color: COLORS.textSecondary }}>
            {t("Доставка идёт", "Yetkazish davomiyligi")}
            <PremiumSelect
              value={String(leadTime)}
              onChange={v => setLeadTime(Number(v))}
              options={[1, 3, 7, 14, 30].map(d => ({ value: String(d), label: `${d} ${t("дн.", "kun")}` }))}
            />
          </label>
        </div>
        <p style={{ fontSize: "13px", color: COLORS.textSecondary, marginBottom: "14px" }}>
          {t(
            "Сколько взять, чтобы хватило на время доставки и запас сверху",
            "Yetkazish muddatiga va zaxiraga yetadigan miqdor",
          )}
        </p>

        {reorderQ.isLoadingError ? (
          <SectionNotice kind="error" message={t("Не удалось посчитать дозаказ", "Qayta buyurtmani hisoblab bo'lmadi")} onRetry={() => reorderQ.refetch()} />
        ) : reorderQ.isLoading ? (
          <div className="space-y-2">{[1, 2].map(i => <div key={i} className="h-10 bg-surface-light animate-pulse rounded-xl" />)}</div>
        ) : toOrder.length === 0 ? (
          <SectionNotice kind="empty" message={t("Дозаказывать нечего", "Qayta buyurtma qilish shart emas")} />
        ) : (
          <div className="overflow-x-auto">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t("Товар", "Mahsulot")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Остаток", "Qoldiq")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Хватит на", "Yetadi")}</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>{t("Заказать", "Buyurtma")}</th>
                </tr>
              </thead>
              <tbody>
                {toOrder.map(r => (
                  <tr key={r.productId}>
                    <td style={tdStyle}>
                      <button className="text-left" onClick={() => setPicked({ id: r.productId, name: r.productName })}>
                        <span style={{ fontWeight: 600 }}>{r.productName}</span>
                        <span style={{ fontSize: "12px", color: COLORS.textTertiary }}> · {r.productCode}</span>
                      </button>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {formatQty(r.currentStock)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <span className={`inline-flex px-2 py-1 rounded-lg border text-xs font-semibold ${URGENCY_CHIP[r.urgency]}`}>
                        {r.daysUntilStockout >= 999 ? "—" : `${r.daysUntilStockout} ${t("дн.", "kun")}`}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                      {formatQty(r.suggestedQuantity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Что разбирают ──────────────────────────────────────────────── */}
      <div className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "20px" }}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <TrendingUp size={16} style={{ color: COLORS.textTertiary }} />
            <h3 style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 700, color: COLORS.textPrimary }}>
              {t("Что разбирают", "Nima ko'p ketmoqda")}
            </h3>
          </div>
          <PremiumSelect
            value={period}
            onChange={v => setPeriod(v as "7d" | "30d")}
            options={[
              { value: "7d", label: t("7 дней", "7 kun") },
              { value: "30d", label: t("30 дней", "30 kun") },
            ]}
          />
        </div>

        {trendingQ.isLoadingError ? (
          <SectionNotice kind="error" message={t("Не удалось загрузить", "Yuklab bo'lmadi")} onRetry={() => trendingQ.refetch()} />
        ) : trendingQ.isLoading ? (
          <div className="h-10 bg-surface-light animate-pulse rounded-xl" />
        ) : (trendingQ.data?.length ?? 0) === 0 ? (
          <SectionNotice kind="empty" message={t("Продаж за период не было", "Davr ichida sotuv bo'lmagan")} />
        ) : (
          <div className="space-y-1.5">
            {trendingQ.data!.map((p, i) => (
              <div key={p.productId} className="flex items-center justify-between" style={{ fontSize: "13px" }}>
                <button className="text-left truncate" style={{ minWidth: 0 }}
                  onClick={() => setPicked({ id: p.productId, name: p.productName })}>
                  <span style={{ color: COLORS.textTertiary }}>{i + 1}. </span>
                  <span style={{ color: COLORS.textPrimary }}>{p.productName}</span>
                </button>
                <span className="shrink-0" style={{ fontVariantNumeric: "tabular-nums", color: COLORS.textSecondary }}>
                  {formatQty(p.totalQuantity)} · <b style={{ color: COLORS.textPrimary }}>{fmt(p.totalRevenue)}</b>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Прогноз по одному товару.
 *
 * Метод выбирается сам: служба сравнивает скользящее среднее, экспоненциальное
 * сглаживание и линейный тренд по ошибке на истории и берёт лучший. Его имя
 * показывается — иначе число на графике выглядит как истина, а не как оценка.
 */
function ProductForecast({ product, onClose, t }: {
  product: { id: number; name: string };
  onClose: () => void;
  t: (ru: string, uz: string) => string;
}) {
  const [horizon, setHorizon] = useState(14);
  const q = trpc.forecast.demandForecast.useQuery({ productId: product.id, horizon, method: "auto" });

  /*
    Прогноз приходит с границами (lower/upper) — и они рисуются.

    Одна линия читается как факт: «столько и продадим». Две пунктирные вокруг
    неё говорят правду — это оценка, и разброс у неё вот такой. Решение о
    закупке принимают по верхней границе, а не по середине.
  */
  const points = (q.data?.forecast ?? []).map(f => ({
    date: String(f.date).slice(5),
    predicted: Number(f.predicted ?? 0),
    lower: Number(f.lower ?? 0),
    upper: Number(f.upper ?? 0),
  }));

  // Ответ службы — объединение: «прогноза нет» и «прогноз есть». Число дней
  // истории живёт только во второй ветке, и читать его надо, разобрав союз.
  const historyDays = q.data && "historicalPoints" in q.data ? q.data.historicalPoints : undefined;

  return (
    <div className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "20px" }}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h3 style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 700, color: COLORS.textPrimary }}>
            {product.name}
          </h3>
          <p style={{ fontSize: "12px", color: COLORS.textSecondary }}>
            {q.data?.method && q.data.method !== "none"
              ? `${t("метод", "usul")}: ${q.data.method}${historyDays ? ` · ${historyDays} ${t("дней истории", "kunlik tarix")}` : ""}`
              : t("прогноз спроса", "talab prognozi")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PremiumSelect
            value={String(horizon)}
            onChange={v => setHorizon(Number(v))}
            options={[7, 14, 30, 60].map(d => ({ value: String(d), label: `${d} ${t("дн.", "kun")}` }))}
          />
          <button className="neo-btn" aria-label={t("Закрыть", "Yopish")} onClick={onClose} style={{ padding: "8px" }}>
            <X size={15} />
          </button>
        </div>
      </div>

      {q.isLoadingError ? (
        <SectionNotice kind="error" message={t("Не удалось построить прогноз", "Prognozni tuzib bo'lmadi")} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <div className="h-48 bg-surface-light animate-pulse rounded-xl" />
      ) : points.length === 0 ? (
        /*
          Служба отвечает словами, почему прогноза нет: меньше семи дней истории
          — это не поломка, а честный отказ. Показать пустой график вместо этого
          значило бы соврать формой.
        */
        <SectionNotice kind="empty" message={q.data?.message ?? t("Недостаточно данных", "Ma'lumot yetarli emas")} />
      ) : (
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ left: 4, right: 12, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #d8d5cd)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--color-text-tertiary, #6b6760)" }} />
              <YAxis tick={{ fontSize: 10, fill: "var(--color-text-tertiary, #6b6760)" }} />
              <Tooltip
                contentStyle={{
                  background: "var(--color-surface)",
                  borderRadius: "12px",
                  border: "none",
                  boxShadow: "var(--shadow-sm)",
                  fontSize: "12px",
                }}
              />
              <Line type="monotone" dataKey="upper" stroke="var(--color-text-tertiary, #6b6760)" strokeWidth={1} strokeDasharray="4 4" dot={false} name={t("верх", "yuqori")} />
              <Line type="monotone" dataKey="predicted" stroke="var(--color-primary)" strokeWidth={2} dot={false} name={t("прогноз", "prognoz")} />
              <Line type="monotone" dataKey="lower" stroke="var(--color-text-tertiary, #6b6760)" strokeWidth={1} strokeDasharray="4 4" dot={false} name={t("низ", "past")} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
