import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, OctagonAlert, RotateCw } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import {
  lightColorLabel, lightReasonText, SHOP_LIGHT_RULES,
  type ShopLight, type ShopLightColor,
} from "@contracts/shop-light";
import { LIGHT_TONE, lightSummary } from "./shop-light-ui";
import { isNoOrderReason, noOrderReasonText } from "@contracts/no-order-reason";

/*
  Светофор магазина на экране: значок в списках и сводка в карточке.

  Правила цвета — contracts/shop-light.ts, расчёт — сервер (shop.light для
  карточки, shop.lights пакетом для списка). Здесь ничего не считается: экран
  только печатает цвет, причину словами и цифры, из которых она сложилась.
*/

const ICON: Record<ShopLightColor, typeof CheckCircle2> = { red: OctagonAlert, yellow: AlertTriangle, green: CheckCircle2 };

/** Маленький значок для строки списка. Без светофора (чужой магазин, нет ответа) — ничего. */
export function ShopLightDot({ light, size = 10 }: { light: ShopLight | undefined; size?: number }) {
  return light ? <Dot light={light} size={size} /> : null;
}

function Dot({ light, size }: { light: ShopLight; size: number }) {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const tone = LIGHT_TONE[light.color];
  const text = `${lightColorLabel(light.color, lang)}. ${lightSummary(light, lang, n => fmt(n))}`;
  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      data-testid="shop-light-dot"
      data-color={light.color}
      className="inline-block rounded-full flex-shrink-0"
      style={{ width: size, height: size, background: tone.fill, boxShadow: `0 0 0 3px color-mix(in srgb, ${tone.fill} 22%, transparent)` }}
    />
  );
}

function Figure({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    // Колодец на фоне холста: глубину даёт цвет, а не обводка.
    <div className="min-w-0" style={{ padding: "12px 14px", borderRadius: 16, background: "var(--color-canvas)" }}>
      <p className="font-label" style={{ fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-tertiary)", margin: 0 }}>{label}</p>
      <p className="font-data truncate" style={{ fontSize: 17, fontWeight: 700, color: tone ?? "var(--color-text-primary)", margin: "4px 0 0" }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: "2px 0 0" }}>{sub}</p>}
    </div>
  );
}

/** Сводка светофора — для готового ответа (карточка сама его не грузит). */
export function ShopLightView({ light, hideDebt = false }: { light: ShopLight; hideDebt?: boolean }) {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const money = (n: number) => fmt(n);
  const tone = LIGHT_TONE[light.color];
  const Icon = ICON[light.color];
  const usedPct = light.creditLimit && light.creditLimit > 0 ? Math.floor((light.debt / light.creditLimit) * 100) : null;
  const last = light.lastNoOrder;

  return (
    <section className="neo-card" style={{ padding: 20 }} data-testid="shop-light" data-color={light.color} aria-label={t("Светофор магазина", "Do'kon svetofori")}>
      <div className="flex items-start gap-3">
        <span className="flex items-center justify-center flex-shrink-0 rounded-full" style={{ width: 44, height: 44, background: tone.subtle }}>
          <Icon size={22} color={tone.text} aria-hidden />
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-label" style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-text-tertiary)", margin: 0 }}>
            {t("Можно ли грузить", "Yuklash mumkinmi")}
          </p>
          <p style={{ fontSize: 17, fontWeight: 700, color: tone.text, margin: "2px 0 0" }} data-testid="shop-light-label">
            {lightColorLabel(light.color, lang)}
          </p>
          <ul className="space-y-1" style={{ margin: "8px 0 0", padding: 0, listStyle: "none" }} data-testid="shop-light-reasons">
            {light.reasons.length === 0 ? (
              <li style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{lightSummary(light, lang, money)}</li>
            ) : light.reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-2" style={{ fontSize: 13, color: "var(--color-text-primary)" }}>
                <span className="rounded-full flex-shrink-0" style={{ width: 6, height: 6, marginTop: 7, background: r.code === "overdue" || r.code === "over_limit" ? LIGHT_TONE.red.fill : LIGHT_TONE.yellow.fill }} />
                <span>{lightReasonText(r, lang, money)}</span>
              </li>
            ))}
          </ul>
          {light.color === "red" && light.overdue > 0 && light.holdsOrders && (
            <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: "6px 0 0" }}>
              {t("Новый заказ встанет на проверку офиса — включена «стоп отгрузки».", "Yangi buyurtma ofis tekshiruviga tushadi — «jo'natishni to'xtatish» yoqilgan.")}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5" style={{ marginTop: 16 }} data-testid="shop-light-figures">
        {!hideDebt && <Figure label={t("Долг", "Qarz")} value={money(light.debt)} tone={light.debt > 0 ? "var(--color-danger-text)" : undefined} />}
        <Figure
          label={t("Из них просрочено", "Shundan muddati o'tgan")}
          value={money(light.overdue)}
          tone={light.overdue > 0 ? "var(--color-danger-text)" : undefined}
          sub={light.overdue > 0
            ? t(`самый старый — ${light.oldestOverdueDays} дн.`, `eng eskisi — ${light.oldestOverdueDays} kun`)
            : t(`отсрочка ${light.graceDays} дн.`, `muhlat ${light.graceDays} kun`)}
        />
        <Figure
          label={t("Кредитный лимит", "Kredit limiti")}
          value={light.creditLimit == null ? t("без лимита", "limitsiz") : money(light.creditLimit)}
          sub={usedPct != null ? t(`занято ${usedPct}%`, `${usedPct}% band`) : undefined}
        />
        <Figure
          label={t(`Средний чек · ${SHOP_LIGHT_RULES.AVG_CHECK_DAYS} дн.`, `O'rtacha chek · ${SHOP_LIGHT_RULES.AVG_CHECK_DAYS} kun`)}
          value={light.avgCheck == null ? "—" : money(light.avgCheck)}
          sub={t(`заказов: ${light.avgCheckOrders}`, `buyurtmalar: ${light.avgCheckOrders}`)}
        />
        <Figure
          label={t("С прошлого заказа", "Oxirgi buyurtmadan beri")}
          value={light.daysSinceOrder == null ? t("заказов нет", "buyurtma yo'q") : t(`${light.daysSinceOrder} дн.`, `${light.daysSinceOrder} kun`)}
          sub={light.usualIntervalDays != null
            ? t(`обычно раз в ${light.usualIntervalDays} дн.`, `odatda har ${light.usualIntervalDays} kunda`)
            : t("ритм не ясен: мало заказов", "maromi noma'lum: buyurtma kam")}
          tone={light.reasons.some(r => r.code === "long_pause") ? LIGHT_TONE.yellow.text : undefined}
        />
        <Figure
          label={t("Последний визит без заказа", "Oxirgi buyurtmasiz tashrif")}
          value={last && isNoOrderReason(last.reason) ? noOrderReasonText(last.reason, last.note, lang) : "—"}
          sub={last ? last.date.split("-").reverse().join(".") : t("не было", "bo'lmagan")}
        />
      </div>
    </section>
  );
}

/** Карточка светофора с загрузкой — веб ShopDetail и агентская AgentShopDetail. */
export function ShopLightPanel({ shopId, hideDebt = false }: { shopId: number; hideDebt?: boolean }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const q = trpc.shop.light.useQuery({ shopId }, { enabled: Number.isFinite(shopId) && shopId > 0, retry: false });
  if (q.isLoading) return <div className="rounded-3xl animate-pulse" style={{ height: 180, background: "var(--color-surface-light)" }} />;
  if (q.isError) {
    return (
      <div className="neo-card flex items-center justify-between gap-3" style={{ padding: 16 }}>
        <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{t("Светофор не загрузился", "Svetofor yuklanmadi")}</span>
        <button type="button" onClick={() => void q.refetch()} className="neo-btn tap" style={{ minHeight: 44, padding: "0 14px", gap: 6 }}>
          <RotateCw size={14} aria-hidden />{t("Повторить", "Qayta urinish")}
        </button>
      </div>
    );
  }
  if (!q.data) return null;
  return <ShopLightView light={q.data as ShopLight} hideDebt={hideDebt} />;
}
