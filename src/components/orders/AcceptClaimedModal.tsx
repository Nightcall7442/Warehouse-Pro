import { useRef, useState } from "react";
import { CheckCircle2, MinusCircle, HandCoins } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useTranslate } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { useInvalidateOrderCaches } from "@/hooks/useOrderCacheSync";
import { notify } from "@/lib/toast";
import { AppModal, modalSectionLabel } from "@/components/ui/AppModal";
import { errorText } from "@/lib/error-text";

/*
  «Принять по заявленному» — вечерняя сдача курьера пачкой
  (api/services/order-close-batch.ts).

  До нажатия — итог: сколько заказов закроется и на какую сумму наличных,
  какие пропущены и почему. Закрываются только те, где заявленное курьером
  равно остатку точно; расхождения оператор закрывает по одному в карточке.
  После — по каждому заказу: закрыт или пропущен с причиной. Итог и
  результат — списком карточек, а не таблицей: на телефоне так же читается.
*/

type Reason = "not_found" | "not_delivered" | "closed" | "no_claim" | "mismatch" | "changed" | "error";
type PlanRow = { id: number; number: string | null; shopName: string | null; courierName: string | null; total: number; claimed: number; due: number; reason: Reason | null };
type Result = { orderId: number; closed: boolean; amount: number; reason?: Reason; message?: string };

const REASON: Record<Reason, [string, string]> = {
  mismatch: ["заявлено ≠ остаток", "e'lon qilingan ≠ qoldiq"],
  closed: ["уже закрыт", "allaqachon yopilgan"],
  no_claim: ["нет заявленного", "e'lon qilingan yo'q"],
  not_delivered: ["не доставлен", "yetkazilmagan"],
  not_found: ["не найден", "topilmadi"],
  changed: ["сумма изменилась — откройте заказ", "summa o'zgardi — buyurtmani oching"],
  error: ["не закрылся — откройте заказ", "yopilmadi — buyurtmani oching"],
};

/** Строка итога или результата — карточкой, чтобы на телефоне читалась так же. */
function Line({ id, row, tone, icon, right }: { id: number; row?: PlanRow; tone: string; icon: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="neo-card-sm flex items-center gap-3" style={{ padding: "10px 12px", minHeight: "44px" }} data-testid={`claim-row-${id}`}>
      <span style={{ color: tone, flexShrink: 0 }}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="font-data" style={{ fontWeight: 700, color: "var(--color-text-primary)" }}>{row?.number ?? `#${id}`}</div>
        <div className="truncate text-[12px]" style={{ color: "var(--color-text-secondary)" }}>
          {[row?.shopName, row?.courierName].filter(Boolean).join(" · ")}
        </div>
      </div>
      <div className="text-right text-[13px]" style={{ color: tone }}>{right}</div>
    </div>
  );
}

export function AcceptClaimedModal({ open, orderIds, onClose, onDone }: {
  open: boolean;
  orderIds: number[];
  onClose: () => void;
  /** Пачка прошла — выделение больше не нужно. Зовётся при закрытии окна с результатом. */
  onDone?: () => void;
}) {
  const t = useTranslate();
  const { fmt } = useCurrency();
  const money = (n: number) => fmt(n, { decimals: Number.isInteger(n) ? 0 : 2 });
  const invalidateOrderCaches = useInvalidateOrderCaches();
  const plan = trpc.order.claimPlan.useQuery({ orderIds }, { enabled: open && orderIds.length > 0 && orderIds.length <= 50 });
  // Итог на момент нажатия: после записи план перечитается и покажет «уже закрыт» у всех.
  const [done, setDone] = useState<{ rows: PlanRow[]; results: Result[]; closed: number; amount: number } | null>(null);
  const snapshot = useRef<PlanRow[]>([]);
  const accept = trpc.order.acceptClaimed.useMutation({
    onSuccess: r => { setDone({ rows: snapshot.current, ...r }); invalidateOrderCaches(); },
    onError: e => notify.error(errorText(e)),
  });

  const close = () => {
    if (done) onDone?.();
    setDone(null);
    onClose();
  };

  const rows = (plan.data?.rows ?? []) as PlanRow[];
  const ready = rows.filter(r => r.reason == null);
  const skipped = rows.filter(r => r.reason != null);
  const why = (reason: Reason | undefined, message?: string) => (reason === "error" && message) ? message : reason ? t(...REASON[reason]) : "";
  const footer = done ? (
    <button type="button" className="neo-btn neo-btn-primary tap w-full" onClick={close} data-testid="claim-done">{t("Готово", "Tayyor")}</button>
  ) : (
    <div className="flex gap-2">
      <button type="button" className="neo-btn tap flex-1" onClick={close} disabled={accept.isPending}>{t("Отмена", "Bekor qilish")}</button>
      <button type="button" className="neo-btn neo-btn-primary tap flex-1" data-testid="claim-accept"
        disabled={ready.length === 0 || accept.isPending || plan.isFetching}
        onClick={() => { snapshot.current = rows; accept.mutate({ items: ready.map(r => ({ orderId: r.id, claimed: r.claimed })) }); }}>
        {accept.isPending ? t("Закрываю…", "Yopilmoqda…") : t(`Принять ${ready.length}`, `${ready.length} tasini qabul qilish`)}
      </button>
    </div>
  );

  return (
    <AppModal
      open={open}
      onClose={close}
      dirty={accept.isPending}
      title={t("Принять по заявленному", "E'lon qilingani bo'yicha qabul qilish")}
      subtitle={t("Закроется только то, где заявленное курьером равно остатку", "Faqat kuryer e'lon qilgani qoldiqqa teng bo'lganlari yopiladi")}
      maxWidth={560}
      footer={footer}
    >
      {done ? (
        <div className="flex flex-col gap-3" data-testid="claim-result">
          <div className="neo-card-sm" style={{ padding: "12px 14px" }} data-testid="claim-result-total">
            <b>{t(`Закрыто: ${done.closed}`, `Yopildi: ${done.closed}`)}</b>
            {" · "}{t("принято наличными", "naqd qabul qilindi")} <b className="font-data">{money(done.amount)}</b>
            {done.results.length > done.closed && <>{" · "}{t(`пропущено: ${done.results.length - done.closed}`, `o'tkazib yuborildi: ${done.results.length - done.closed}`)}</>}
          </div>
          {done.results.map(r => {
            const row = done.rows.find(x => x.id === r.orderId);
            return r.closed
              ? <Line key={r.orderId} id={r.orderId} row={row} tone="var(--color-success-text)" icon={<CheckCircle2 size={18} />} right={<><div>{t("закрыт", "yopildi")}</div><div className="font-data">{money(r.amount)}</div></>} />
              : <Line key={r.orderId} id={r.orderId} row={row} tone="var(--color-warning-text)" icon={<MinusCircle size={18} />} right={<>{t("пропущен", "o'tkazildi")} — {why(r.reason, r.message)}</>} />;
          })}
        </div>
      ) : plan.isLoading ? (
        <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>{t("Считаю…", "Hisoblanmoqda…")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="neo-card-sm flex items-center gap-3" style={{ padding: "12px 14px" }} data-testid="claim-plan-total">
            <HandCoins size={20} style={{ color: "var(--color-primary)", flexShrink: 0 }} />
            <div>
              <div><b>{t(`Закроется: ${ready.length}`, `Yopiladi: ${ready.length}`)}</b> {t("на", "summasi")} <b className="font-data">{money(plan.data?.ready.amount ?? 0)}</b></div>
              {skipped.length > 0 && <div className="text-[12px]" style={{ color: "var(--color-text-secondary)" }}>{t(`Пропущено: ${skipped.length} — их закройте по одному в карточке`, `O'tkazib yuboriladi: ${skipped.length} — ularni kartada bittadan yoping`)}</div>}
            </div>
          </div>
          {ready.length > 0 && <p className={modalSectionLabel} style={{ marginBottom: 0 }}>{t("Закроются", "Yopiladi")}</p>}
          {ready.map(r => <Line key={r.id} id={r.id} row={r} tone="var(--color-success-text)" icon={<CheckCircle2 size={18} />} right={<span className="font-data">{money(r.claimed)}</span>} />)}
          {skipped.length > 0 && <p className={modalSectionLabel} style={{ marginBottom: 0 }}>{t("Пропущены", "O'tkazib yuboriladi")}</p>}
          {skipped.map(r => <Line key={r.id} id={r.id} row={r} tone="var(--color-warning-text)" icon={<MinusCircle size={18} />} right={<>{why(r.reason ?? undefined)}{r.reason === "mismatch" && <div className="font-data text-[12px]" style={{ color: "var(--color-text-secondary)" }}>{money(r.claimed)} ≠ {money(r.due)}</div>}</>} />)}
        </div>
      )}
    </AppModal>
  );
}
