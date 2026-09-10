import { trpc } from "@/providers/trpc";
import { useCurrency } from "@/hooks/useCurrency";
import { notify } from "@/lib/toast";
import { F, COLORS } from "@/components/users/types";
import { format } from "date-fns";
import { BadgeCheck, HandCoins, Loader2 } from "lucide-react";

/**
 * Мои выплаты — и подтверждение получения.
 *
 * ── Зачем появилось ─────────────────────────────────────────────────────────
 *
 * Просьба арендатора: «сотрудник получает уведомление и подтверждение о
 * получении зарплаты». Выплата была событием в одну сторону — руководитель
 * записал, что выдал, а другой стороны у этой записи не было: спор «мне не
 * платили» упирался в слово против слова, а подпись в тетради к системе
 * отношения не имела.
 *
 * ── Что подтверждение НЕ делает ─────────────────────────────────────────────
 *
 * Оно ничего не меняет в деньгах: ни суммы, ни остатка к выплате, ни расходов
 * организации. Деньги ушли из кассы в момент выдачи, и ставить это в
 * зависимость от того, открыл ли человек телефон, нельзя.
 *
 * Поэтому «не подтверждено» — это не «не получил», а «ещё не подтвердил»: у
 * строки нет тревожного вида, и висеть неподтверждённой она может сколько
 * угодно.
 *
 * ── Почему блока нет, пока не платили ───────────────────────────────────────
 *
 * У человека, которому в этом месяце ещё не выдавали, пустая таблица занимала
 * бы экран и сообщала бы ровно ничего. Начисление он и так видит выше.
 */
export function MyPayouts({ t }: { t: (ru: string, uz: string) => string }) {
  const { fmt } = useCurrency();
  const utils = trpc.useUtils();

  const q = trpc.kpi.myPayouts.useQuery({ period: "month", offset: 0 });

  const confirmMutation = trpc.kpi.confirmPayout.useMutation({
    onSuccess: () => {
      utils.kpi.myPayouts.invalidate();
      notify.success(t("Получение подтверждено", "Olinganligi tasdiqlandi"));
    },
    onError: (e) => notify.error(e.message),
  });

  const rows = q.data ?? [];
  if (q.isLoading || rows.length === 0) return null;

  const total = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);

  return (
    <div className="neo-card p-5">
      <div className="flex items-center gap-2 mb-1">
        <HandCoins size={16} style={{ color: COLORS.textTertiary }} />
        <h3 style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary }}>
          {t("Выдано на руки", "Qo'lga berilgan")}
        </h3>
      </div>
      <p className="text-xs" style={{ color: COLORS.textTertiary, marginBottom: "14px" }}>
        {t(`За месяц ${fmt(total)}`, `Oy uchun ${fmt(total)}`)}
      </p>

      <div className="space-y-2">
        {rows.map(p => {
          const confirmed = Boolean(p.confirmedAt);
          return (
            <div key={p.id} className="flex items-center justify-between gap-3 flex-wrap">
              <div style={{ minWidth: 0 }}>
                <span className="font-semibold" style={{ color: COLORS.textPrimary, fontVariantNumeric: "tabular-nums" }}>
                  {fmt(Number(p.amount ?? 0))}
                </span>
                <span style={{ color: COLORS.textTertiary, fontSize: "12.5px" }}>
                  {" · "}
                  {p.paidAt ? format(new Date(p.paidAt), "dd.MM.yyyy") : "—"}
                  {/*
                    Аванс и выплата различаются только тем, что первый выдан до
                    конца месяца. Показать их одинаково значило бы выдать аванс
                    за полный расчёт.
                  */}
                  {p.kind === "advance" ? ` · ${t("аванс", "avans")}` : ""}
                  {p.note ? ` · ${p.note}` : ""}
                </span>
              </div>

              {confirmed ? (
                <span className="shrink-0 inline-flex items-center gap-1.5" style={{ fontSize: "12.5px", color: "var(--color-success-text)" }}>
                  <BadgeCheck size={14} />
                  {t("получение подтверждено", "olinganligi tasdiqlandi")}
                  {" "}{format(new Date(p.confirmedAt!), "dd.MM.yyyy")}
                </span>
              ) : (
                <button
                  onClick={() => confirmMutation.mutate({ id: p.id })}
                  disabled={confirmMutation.isPending}
                  className="neo-btn-primary tap shrink-0 flex items-center gap-1.5"
                  style={{ padding: "6px 12px", fontSize: "12px" }}
                >
                  {confirmMutation.isPending && confirmMutation.variables?.id === p.id
                    ? <Loader2 size={13} className="animate-spin" />
                    : <BadgeCheck size={13} />}
                  {t("Деньги получил", "Pulni oldim")}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
