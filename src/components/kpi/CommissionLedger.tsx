import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useCurrency } from "@/hooks/useCurrency";
import { useConfirm } from "@/components/ConfirmDialog";
import { PremiumSelect } from "@/components/PremiumSelect";
import { SectionNotice } from "@/components/SectionNotice";
import { notify } from "@/lib/toast";
import { F, COLORS, thStyle, tdStyle } from "@/components/users/types";
import { Check, Wallet, Undo2 } from "lucide-react";

/**
 * Ведомость комиссий: утвердить и выплатить.
 *
 * ── Зачем появилось ─────────────────────────────────────────────────────────
 *
 * Комиссию считает кнопка «Рассчитать» рядом. Ручка, которая переводит строку
 * из «посчитана» в «утверждена» и «выплачена» (commission.updateStatus),
 * написана и не вызывалась ниоткуда.
 *
 * Это не косметика. Пересчёт нарочно трогает ТОЛЬКО строки в состоянии
 * «посчитана»: утверждённая и выплаченная комиссия — принятое финансовое
 * решение, и поздний возврат не должен менять её задним числом (см.
 * commission-router.calculate).
 *
 * А раз утвердить было нечем, все строки навсегда оставались «посчитанными» —
 * и каждый следующий пересчёт молча переписывал сумму, которую директор уже
 * выплатил. Защита была написана и не работала, потому что состояния, ради
 * которого она существует, никто не мог поставить.
 *
 * ── Почему выплата спрашивает, а утверждение нет ────────────────────────────
 *
 * «Утверждена» ещё можно вернуть назад — это решение человека. «Выплачена»
 * значит, что деньги отданы; вернуть строку из неё можно, но это уже разбор
 * ошибки, а не обычный ход.
 */

type Status = "pending" | "approved" | "paid";

const CHIP: Record<Status, string> = {
  pending:  "bg-warning/15 text-warning border-warning/30",
  approved: "bg-info/15 text-info border-info/30",
  paid:     "bg-success/15 text-success border-success/30",
};

export function CommissionLedger({ t }: { t: (ru: string, uz: string) => string }) {
  const { fmt } = useCurrency();
  const { confirm, dialog } = useConfirm();
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<Status | "all">("pending");

  const LABEL: Record<Status, string> = {
    pending:  t("посчитана", "hisoblangan"),
    approved: t("утверждена", "tasdiqlangan"),
    paid:     t("выплачена", "to'langan"),
  };

  const listQ = trpc.commission.list.useQuery(status === "all" ? undefined : { status });

  const move = trpc.commission.updateStatus.useMutation({
    onSuccess: (_r, vars) => {
      notify.success(
        vars.status === "paid" ? t("Отмечено как выплаченное", "To'langan deb belgilandi")
          : vars.status === "approved" ? t("Комиссия утверждена", "Komissiya tasdiqlandi")
          : t("Возвращено в расчёт", "Hisobga qaytarildi"),
      );
      utils.commission.list.invalidate();
    },
    onError: e => notify.error(e.message),
  });

  const pay = async (id: number, name: string, amount: string) => {
    const ok = await confirm({
      title: t("Отметить выплату?", "To'lov belgilansinmi?"),
      message: t(
        `${name}, ${fmt(Number(amount))}. После этого пересчёт больше не будет менять эту сумму.`,
        `${name}, ${fmt(Number(amount))}. Bundan keyin qayta hisoblash bu summani o'zgartirmaydi.`,
      ),
      confirmText: t("Отметить", "Belgilash"),
    });
    if (ok) move.mutate({ id, status: "paid" });
  };

  /*
    Возврат в расчёт — тоже с вопросом.

    Он снимает защиту: строка снова начнёт пересчитываться, и сумма, которую
    видел человек, может измениться. Это разбор ошибки, а не обычный ход.
  */
  const reopen = async (id: number, name: string) => {
    const ok = await confirm({
      title: t("Вернуть в расчёт?", "Hisobga qaytarilsinmi?"),
      message: t(
        `${name}: сумма снова начнёт пересчитываться и может измениться.`,
        `${name}: summa qayta hisoblanadi va o'zgarishi mumkin.`,
      ),
      confirmText: t("Вернуть", "Qaytarish"),
      danger: true,
    });
    if (ok) move.mutate({ id, status: "pending" });
  };

  const rows = listQ.data ?? [];

  return (
    <div className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "20px" }}>
      {dialog}

      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <Wallet size={16} style={{ color: COLORS.textTertiary }} />
          <h3 style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 700, color: COLORS.textPrimary }}>
            {t("Ведомость комиссий", "Komissiya qaydnomasi")}
          </h3>
        </div>
        <PremiumSelect
          value={status}
          onChange={v => setStatus(v as Status | "all")}
          options={[
            { value: "pending", label: LABEL.pending },
            { value: "approved", label: LABEL.approved },
            { value: "paid", label: LABEL.paid },
            { value: "all", label: t("все", "hammasi") },
          ]}
        />
      </div>
      <p style={{ fontSize: "13px", color: COLORS.textSecondary, marginBottom: "14px" }}>
        {t(
          "Пересчёт трогает только посчитанные. Утверждённая сумма больше не меняется задним числом.",
          "Qayta hisoblash faqat hisoblanganlarga tegadi. Tasdiqlangan summa o'zgarmaydi.",
        )}
      </p>

      {listQ.isLoadingError ? (
        <SectionNotice kind="error" message={t("Не удалось загрузить ведомость", "Qaydnomani yuklab bo'lmadi")} onRetry={() => listQ.refetch()} />
      ) : listQ.isLoading ? (
        <div className="space-y-2">{[1, 2].map(i => <div key={i} className="h-10 bg-surface-light animate-pulse rounded-xl" />)}</div>
      ) : rows.length === 0 ? (
        <SectionNotice kind="empty" message={
          status === "pending"
            ? t("Посчитанных комиссий нет — нажмите «Рассчитать»", "Hisoblangan komissiya yo'q — «Hisoblash» ni bosing")
            : t("В этом состоянии ничего нет", "Bu holatda hech narsa yo'q")
        } />
      ) : (
        <div className="overflow-x-auto">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("Сотрудник", "Xodim")}</th>
                <th style={thStyle}>{t("Период", "Davr")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("Продажи", "Sotuv")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("Комиссия", "Komissiya")}</th>
                <th style={thStyle}>{t("Состояние", "Holat")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("Действие", "Amal")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => {
                const st = (c.status ?? "pending") as Status;
                const name = c.userName ?? `№${c.userId}`;
                return (
                  <tr key={c.id}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{name}</td>
                    <td style={{ ...tdStyle, color: COLORS.textSecondary, fontSize: "12px" }}>
                      {String(c.periodStart).slice(0, 10)} — {String(c.periodEnd).slice(0, 10)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", color: COLORS.textSecondary }}>
                      {fmt(Number(c.salesAmount ?? 0))}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                      {fmt(Number(c.commissionAmount ?? 0))}
                      <span style={{ fontSize: "11px", color: COLORS.textTertiary, fontWeight: 400 }}>
                        {" "}({Number(c.commissionRate ?? 0)}%)
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span className={`inline-flex px-2 py-1 rounded-lg border text-xs font-semibold ${CHIP[st]}`}>
                        {LABEL[st]}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <div className="flex items-center justify-end gap-2">
                        {st === "pending" && (
                          <button className="neo-btn" disabled={move.isPending}
                            onClick={() => move.mutate({ id: c.id, status: "approved" })}
                            style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "13px" }}>
                            <Check size={14} />{t("Утвердить", "Tasdiqlash")}
                          </button>
                        )}
                        {st === "approved" && (
                          <>
                            <button className="neo-btn" disabled={move.isPending}
                              aria-label={t("Вернуть в расчёт", "Hisobga qaytarish")}
                              onClick={() => reopen(c.id, name)} style={{ padding: "6px 8px" }}>
                              <Undo2 size={14} />
                            </button>
                            <button className="neo-btn-primary" disabled={move.isPending}
                              onClick={() => pay(c.id, name, String(c.commissionAmount ?? "0"))}
                              style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "13px" }}>
                              <Wallet size={14} />{t("Выплачено", "To'landi")}
                            </button>
                          </>
                        )}
                        {st === "paid" && (
                          <button className="neo-btn" disabled={move.isPending}
                            aria-label={t("Вернуть в расчёт", "Hisobga qaytarish")}
                            onClick={() => reopen(c.id, name)} style={{ padding: "6px 8px" }}>
                            <Undo2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
