import { Truck, PackageCheck, PackageX, RotateCcw, Wallet, Coins, Utensils } from "lucide-react";

/**
 * Показатели и зарплата курьера.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Курьер открывал тот же экран, что и агент, и видел ноль по всем строкам:
 * визиты, планы, выручка, оценка «F». Все они меряют оформление заказов, а
 * курьер заказов не оформляет — orders.agentId у него пуст. Он не работал
 * плохо, его мерили не тем.
 *
 * Зарплата ему вовсе не показывалась: запрос был отключён именно потому, что
 * агентский расчёт давал «оклад и три нуля».
 *
 * ── Как теперь ──────────────────────────────────────────────────────────────
 *
 * Меряется то, что курьер делает: довёз, не довёз, вернул, привёз ли деньги.
 * Платится фиксированная сумма за каждую довезённую заявку — решение владельца;
 * срывы её не уменьшают, они видны, но платят за факт.
 */
export interface CourierStatsView {
  delivered: number;
  failed: number;
  returned: number;
  deliveredAmount: number;
  cashCollected: number;
  successRate: number;
}

export interface CourierSalaryView {
  baseSalary: number;
  /*
    Чем платят: суммой за довезённую заявку или процентом от довезённого.
    Способ решает арендатор — платформа обоих не навязывает.
  */
  courierPayMode: "per_delivery" | "percent";
  deliveryRate: number;
  commissionRate: number;
  deliveredCount: number;
  deliveredAmount: number;
  deliveryPay: number;
  /*
    Обед и дорожные — за один рабочий день, и сколько таких дней вышло.

    Эти деньги курьер получал наличными в течение месяца, а в расчёте их не
    было вовсе: в конце месяца ему платили полный расчёт СВЕРХ уже выданного.
    Показывать их надо разложенными, иначе человек видит в итоге сумму больше
    ожидаемой и не понимает, откуда она.
  */
  mealAllowance: number;
  travelAllowance: number;
  workDays: number;
  allowancePay: number;
  totalSalary: number;
}

export function CourierKpiView({ stats, salary, fmt, t }: {
  stats: CourierStatsView;
  salary?: CourierSalaryView | null;
  fmt: (v: number) => string;
  t: (ru: string, uz: string) => string;
}) {
  const assigned = stats.delivered + stats.failed;

  /*
    Строка расчёта зависит от способа, и обе должны читаться как школьное
    умножение: «12 × 15 000» или «3 200 000 × 5%». Человек, получающий деньги,
    должен пересчитать их в уме — иначе спор «мне недоплатили» разрешать нечем.
  */
  const percent = salary?.courierPayMode === "percent";
  const rateSet = percent ? (salary?.commissionRate ?? 0) > 0 : (salary?.deliveryRate ?? 0) > 0;
  const formula = !salary ? ""
    : percent
      ? `${fmt(salary.deliveredAmount)} × ${salary.commissionRate}%`
      : `${salary.deliveredCount} × ${fmt(salary.deliveryRate)}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

      {/* ── Как ездил ──────────────────────────────────────────────────── */}
      <div className="neo-card neo-card-static" style={{ padding: "20px" }}>
        <p style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-text-tertiary)", marginBottom: "16px" }}>
          {t("Доставки за период", "Davr uchun yetkazishlar")}
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px" }}>
          <Tile
            icon={<PackageCheck size={16} />}
            tone="success"
            label={t("Довезено", "Yetkazildi")}
            value={String(stats.delivered)}
            sub={assigned > 0 ? `${stats.successRate}% ${t("из назначенных", "tayinlanganlardan")}` : undefined}
          />
          <Tile
            icon={<PackageX size={16} />}
            tone={stats.failed > 0 ? "danger" : "muted"}
            label={t("Сорвано", "Bajarilmadi")}
            value={String(stats.failed)}
            sub={t("закрыто, отказ, не дозвонились", "yopiq, rad etildi, telefon ko'tarilmadi")}
          />
          <Tile
            icon={<RotateCcw size={16} />}
            tone={stats.returned > 0 ? "warning" : "muted"}
            label={t("Возвраты", "Qaytarishlar")}
            value={String(stats.returned)}
            sub={t("товар вернулся с рейса", "mahsulot reysdan qaytdi")}
          />
          <Tile
            icon={<Wallet size={16} />}
            tone="primary"
            label={t("Привезено денег", "Pul olib kelindi")}
            value={fmt(stats.cashCollected)}
            sub={t("наличными в кассу", "kassaga naqd")}
          />
        </div>

        {assigned === 0 && (
          <p style={{ fontSize: "12.5px", color: "var(--color-text-tertiary)", marginTop: "14px" }}>
            {t("За этот период заявок не назначали — считать нечего.", "Bu davrda arizalar tayinlanmagan — hisoblash uchun narsa yo'q.")}
          </p>
        )}
      </div>

      {/* ── Сколько за это ─────────────────────────────────────────────── */}
      {salary && (
        <div className="neo-card neo-card-static" style={{ padding: "20px" }}>
          <p style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-text-tertiary)", marginBottom: "16px" }}>
            {t("Зарплата за период", "Davr uchun oylik")}
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px", marginBottom: "16px" }}>
            <Tile icon={<Coins size={16} />} tone="muted" label={t("Оклад", "Oylik")} value={fmt(salary.baseSalary)} />
            <Tile
              icon={<Truck size={16} />}
              tone="primary"
              label={t("За доставки", "Yetkazishlar uchun")}
              value={fmt(salary.deliveryPay)}
              sub={rateSet ? formula : t("ставка не назначена", "stavka tayinlanmagan")}
            />
            {salary.allowancePay > 0 && (
              <Tile
                icon={<Utensils size={16} />}
                tone="muted"
                label={t("Обед и дорожные", "Tushlik va yo'l")}
                value={fmt(salary.allowancePay)}
                sub={t(`${salary.workDays} раб. дн.`, `${salary.workDays} ish kuni`)}
              />
            )}
            <Tile icon={<Wallet size={16} />} tone="success" label={t("ИТОГО", "JAMI")} value={fmt(salary.totalSalary)} strong />
          </div>

          {/*
            Строка расчёта целиком. Человек, получающий деньги, должен видеть,
            из чего они сложились, — иначе спор «мне недоплатили» разрешать
            нечем.
          */}
          <div style={{
            padding: "12px 14px", borderRadius: "14px",
            background: "var(--color-surface-light)", boxShadow: "var(--shadow-pressed)",
            fontSize: "12.5px", color: "var(--color-text-secondary)",
            display: "flex", flexDirection: "column", gap: "7px",
          }}>
            <Row label={t("Оклад", "Oylik")} value={fmt(salary.baseSalary)} />
            {rateSet ? (
              <Row
                label={percent
                  ? t("Сумма довезённого × процент", "Yetkazilgan summa × foiz")
                  : t("Довезено × ставка", "Yetkazildi × stavka")}
                value={`${formula} = ${fmt(salary.deliveryPay)}`}
              />
            ) : (
              <Row
                label={percent
                  ? t("Процент за доставку", "Yetkazish foizi")
                  : t("Ставка за доставку", "Yetkazish stavkasi")}
                value={t("не назначена", "tayinlanmagan")}
                muted
              />
            )}
            {/* При проценте сумма довезённого — это и есть база расчёта.
                Без неё строка «× 5%» повисает: непонятно, от чего процент. */}
            {percent && rateSet && (
              <Row label={t("Сумма довезённого", "Yetkazilgan summa")} value={fmt(salary.deliveredAmount)} muted />
            )}
            {/*
              Обед и дорожные — школьным умножением, как и всё остальное:
              «22 × 30 000». Одной суммой человек не может её проверить, а речь
              о деньгах, которые он уже держал в руках по частям.
            */}
            {salary.allowancePay > 0 && (
              <Row
                label={t("Рабочих дней × (обед + дорожные)", "Ish kunlari × (tushlik + yo'l)")}
                value={`${salary.workDays} × ${fmt(salary.mealAllowance + salary.travelAllowance)} = ${fmt(salary.allowancePay)}`}
              />
            )}
            {stats.failed > 0 && (
              <Row
                label={t("Сорванные доставки", "Bajarilmagan yetkazishlar")}
                value={t(`${stats.failed} — на выплату не влияют`, `${stats.failed} — to'lovga ta'sir qilmaydi`)}
                muted
              />
            )}
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: "8px", marginTop: "1px", borderTop: "1px solid var(--color-border-subtle)" }}>
              <span style={{ fontWeight: 700, color: "var(--color-text-primary)" }}>{t("К ВЫПЛАТЕ", "TO'LOVGA")}</span>
              <span style={{ fontWeight: 700, fontSize: "14px", color: "var(--color-success-text, var(--color-success))" }}>{fmt(salary.totalSalary)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const TONES: Record<string, { fill: string; ink: string }> = {
  success: { fill: "var(--color-success-subtle)", ink: "var(--color-success-text, var(--color-success))" },
  danger:  { fill: "var(--color-danger-subtle)",  ink: "var(--color-danger-text, var(--color-danger))" },
  warning: { fill: "var(--color-warning-subtle)", ink: "var(--color-warning-text, var(--color-warning))" },
  primary: { fill: "var(--color-primary-subtle)", ink: "var(--color-primary-text)" },
  muted:   { fill: "var(--color-surface-light)",  ink: "var(--color-text-tertiary)" },
};

function Tile({ icon, tone, label, value, sub, strong }: {
  icon: React.ReactNode; tone: keyof typeof TONES | string;
  label: string; value: string; sub?: string; strong?: boolean;
}) {
  const c = TONES[tone] ?? TONES.muted;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "11px", minWidth: 0 }}>
      <span style={{
        width: "34px", height: "34px", borderRadius: "12px", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: c.fill, color: c.ink,
      }}>
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: "10.5px", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--color-text-tertiary)" }}>
          {label}
        </p>
        <p style={{
          fontSize: strong ? "19px" : "17px", fontWeight: 700, lineHeight: 1.2, marginTop: "3px",
          color: strong ? "var(--color-success-text, var(--color-success))" : "var(--color-text-primary)",
          fontVariantNumeric: "tabular-nums",
        }}>
          {value}
        </p>
        {sub && (
          <p style={{ fontSize: "11px", lineHeight: 1.4, color: "var(--color-text-tertiary)", marginTop: "2px" }}>{sub}</p>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
      <span>{label}</span>
      <span style={{
        fontWeight: 600, textAlign: "right",
        color: muted ? "var(--color-text-tertiary)" : "var(--color-text-primary)",
        fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </span>
    </div>
  );
}
