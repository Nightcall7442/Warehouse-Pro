import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCan } from "@/hooks/useCan";
import { notify } from "@/lib/toast";
import { useCurrency } from "@/hooks/useCurrency";
import { SectionNotice } from "@/components/SectionNotice";
import { F, COLORS } from "@/components/users/types";
import { format } from "date-fns";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

/**
 * Деньги магазина: откуда долг и как идут продажи.
 *
 * ── Зачем появилось ─────────────────────────────────────────────────────────
 *
 * Карточка магазина показывала долг ОДНИМ числом. Откуда оно взялось и что с
 * ним делать — из карточки было не видно, а разговор с магазином начинается
 * ровно с этого: «вы должны столько-то», «за что?».
 *
 * Две ручки, которые на это отвечают — разбор долга с историей платежей и
 * помесячная выручка магазина, — были написаны и не вызывались ниоткуда.
 *
 * ── Чего здесь намеренно нет ────────────────────────────────────────────────
 *
 * Сервер отдаёт вместе с долгом «степень тяжести» (низкая / средняя /
 * критическая), посчитанную по АБСОЛЮТНЫМ суммам: миллион, полмиллиона. Это
 * пороги в сумах, и у организации, ведущей учёт в другой валюте, они означают
 * что угодно. Показывать по ним цвет значило бы красить экран числом,
 * которое ничего не значит.
 *
 * Чтобы это заработало, пороги должны стать настройкой организации — правка
 * сервера, а не экрана.
 */
export function ShopMoney({ shopId }: { shopId: number }) {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);

  const debtQ = trpc.shop.getDebtDetails.useQuery({ shopId });
  const trendQ = trpc.analytics.shopRevenueTrend.useQuery({ shopId, days: 30 });

  const payments = debtQ.data?.paymentHistory ?? [];
  const can = useCan();
  const utils = trpc.useUtils();
  const [reversing, setReversing] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const reverse = trpc.shop.reversePayment.useMutation({
    onSuccess: () => {
      notify.success(t("Платёж сторнирован", "To'lov bekor qilindi"));
      setReversing(null); setReason("");
      utils.shop.getDebtDetails.invalidate({ shopId });
      utils.shop.getById.invalidate({ id: shopId });
    },
    onError: e => notify.error(e.message),
  });
  const trend = (trendQ.data ?? []).map(r => ({
    date: String(r.date).slice(5),
    revenue: Number(r.revenue ?? 0),
  }));

  return (
    <div className="neo-card p-5 space-y-5">
      <div>
        <h3 style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 700, color: COLORS.textPrimary }}>
          {t("Деньги магазина", "Do'kon pullari")}
        </h3>
        <p style={{ fontSize: "12px", color: COLORS.textSecondary }}>
          {t("Долг, платежи и продажи за 30 дней", "Qarz, to'lovlar va 30 kunlik sotuv")}
        </p>
      </div>

      {/* ── Долг и платежи ─────────────────────────────────────────────── */}
      {debtQ.isLoadingError ? (
        <SectionNotice kind="error" message={t("Не удалось загрузить долг", "Qarzni yuklab bo'lmadi")} onRetry={() => debtQ.refetch()} />
      ) : debtQ.isLoading ? (
        <div className="h-16 bg-surface-light animate-pulse rounded-xl" />
      ) : (
        <div>
          <div className="flex items-baseline gap-2">
            <span style={{ fontFamily: F.display, fontSize: "26px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.02em" }}>
              {fmt(debtQ.data?.debtAmount ?? 0)}
            </span>
            <span style={{ fontSize: "12px", color: COLORS.textTertiary }}>
              {t("текущий долг", "joriy qarz")}
            </span>
          </div>

          {payments.length === 0 ? (
            <p style={{ fontSize: "13px", color: COLORS.textTertiary, marginTop: "8px" }}>
              {t("Платежей за 30 дней не было", "30 kun ichida to'lov bo'lmagan")}
            </p>
          ) : (
            <div className="mt-3 space-y-1">
              <p style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>
                {t("Платежи за 30 дней", "30 kunlik to'lovlar")}
              </p>
              {payments.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-3" style={{ fontSize: "13px" }}>
                  <span className="truncate" style={{ color: COLORS.textSecondary, minWidth: 0 }}>
                    {p.createdAt ? format(new Date(p.createdAt), "dd.MM.yyyy") : "—"}
                    {/*
                      «Новый долг» и «оплата» лежат в одной таблице и
                      различаются только типом. Показать их одинаково значило
                      бы выдать начисление за платёж.
                    */}
                    {p.type === "debt" ? (
                      <span style={{ color: COLORS.textTertiary }}> · {t("начисление", "hisoblash")}</span>
                    ) : null}
                    {p.notes ? <span style={{ color: COLORS.textTertiary }}> · {p.notes}</span> : null}
                  </span>
                  <span className="shrink-0" style={{
                    fontVariantNumeric: "tabular-nums", fontWeight: 600,
                    color: p.type === "debt" ? "var(--color-danger-text)" : "var(--color-success-text)",
                  }}>
                    {p.type === "debt" ? "+" : "−"}{fmt(Number(p.amount ?? 0))}
                  </span>
                  {/* Сторно: платёж не удаляется, а гасится встречной строкой.
                      Кнопка только у того, кто вправе принимать деньги, и только
                      для платежей, ещё не сторнированных и не являющихся сторно. */}
                  {can("payments.accept") && p.type === "payment" && p.reversalOf == null && p.status !== "reversed" && (
                    <button type="button" className="neo-btn-xs shrink-0" onClick={() => { setReversing(p.id); setReason(""); }}>
                      {t("Сторно", "Bekor")}
                    </button>
                  )}
                </div>
              ))}
              {reversing != null && (
                <div className="flex items-center gap-2" style={{ fontSize: "13px" }}>
                  <input className="neo-input" style={{ flex: 1 }} autoFocus placeholder={t("Причина сторно", "Bekor qilish sababi")}
                    value={reason} onChange={e => setReason(e.target.value)} />
                  <button type="button" className="neo-btn-primary neo-btn-xs" disabled={reason.trim().length < 3 || reverse.isPending}
                    onClick={() => reverse.mutate({ paymentId: reversing, reason: reason.trim() })}>
                    {t("Подтвердить", "Tasdiqlash")}
                  </button>
                  <button type="button" className="neo-btn-xs" onClick={() => setReversing(null)}>{t("Отмена", "Bekor")}</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Продажи ────────────────────────────────────────────────────── */}
      {trendQ.isLoadingError ? (
        <SectionNotice kind="error" message={t("Не удалось загрузить продажи", "Sotuvni yuklab bo'lmadi")} onRetry={() => trendQ.refetch()} />
      ) : trendQ.isLoading ? (
        <div className="h-32 bg-surface-light animate-pulse rounded-xl" />
      ) : trend.length === 0 ? (
        <SectionNotice kind="empty" message={t("Продаж за 30 дней не было", "30 kun ichida sotuv bo'lmagan")} />
      ) : (
        <div style={{ height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ left: 4, right: 12, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #d8d5cd)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--color-text-tertiary, #6b6760)" }} />
              <YAxis tick={{ fontSize: 10, fill: "var(--color-text-tertiary, #6b6760)" }} />
              <Tooltip
                formatter={(v: number) => fmt(v)}
                contentStyle={{
                  background: "var(--color-surface)", borderRadius: "12px",
                  border: "none", boxShadow: "var(--shadow-sm)", fontSize: "12px",
                }}
              />
              <Line type="monotone" dataKey="revenue" stroke="var(--color-primary)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
