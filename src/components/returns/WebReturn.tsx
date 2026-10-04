/* ═══════════════════════════════════════════════════════════════════════════
   Возврат от магазина — из веба.

   ── Что было ────────────────────────────────────────────────────────────────
   Магазин на следующий день отдаёт просрочку или брак, а оформить это из веба
   было нечем: ни в карточке заказа, ни в карточке магазина кнопки не было.
   Офис обходил дыру корректировкой остатка и сторно платежа — и ломал этим
   долг магазина и выручку: корректировка не знает заказа, сторно не знает
   товара, и ни то ни другое не попадает в свод возвратов.

   ── Как теперь ──────────────────────────────────────────────────────────────
   Окно заводит тот же документ, что и телефон агента (returns.create), и он
   встаёт в ту же очередь «Возвраты» на рассмотрение. Проводит его тот же круг
   людей тем же путём — «Одобрить» → «На склад» / «Списать». Отдельного
   «провести сразу» нет намеренно: решение владельца, чтобы у возврата была
   одна дорога и один след.

   ── Кто решает, сколько можно вернуть ───────────────────────────────────────
   Сервер. Окно берёт остаток по строке из returns.returnable — ту же функцию,
   по которой create отвергает лишнее (api/services/returnable.ts), — и только
   не даёт вписать больше. Цену тоже называет сервер: по заказу, а не по
   тому, что пришлёт экран.
   ═══════════════════════════════════════════════════════════════════════════ */
import { useState } from "react";
import { Link } from "react-router";
import { Loader2, RotateCcw, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/hooks/useCurrency";
import { notify } from "@/lib/toast";
import { returnDraft, clampQty, returnLink, type DraftLine } from "@/lib/return-draft";
import { RETURN_REASON_LABEL } from "@/lib/entity-labels";
import { canFileReturn, canOperate } from "@/lib/permissions";
import { unitShort } from "@/lib/units";
import { AppModal, modalFieldLabel } from "@/components/ui/AppModal";
import type { Return } from "@contracts/types";
import { errorText } from "@/lib/error-text";

type Reason = Return["reason"];
type ReturnStatus = Return["status"];

/** Порядок — от частого к редкому: магазины чаще всего сдают просрочку и брак. */
const REASONS = Object.keys(RETURN_REASON_LABEL) as Reason[];

/* ─── Окно ─────────────────────────────────────────────────────────────────── */

export function ReturnDialog({ orderId, onClose }: { orderId: number; onClose: () => void }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { fmt } = useCurrency();
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const orderQ = trpc.order.getById.useQuery({ id: orderId });
  const leftQ = trpc.returns.returnable.useQuery({ orderId });

  const [qty, setQty] = useState<Record<number, string>>({});
  const [reason, setReason] = useState<Reason | null>(null);
  const [notes, setNotes] = useState("");
  const [created, setCreated] = useState<{ id: number; returnNumber: string } | null>(null);

  const create = trpc.returns.create.useMutation({
    onSuccess: (res) => {
      setCreated(res);
      notify.success(t(`Возврат ${res.returnNumber} заведён — ждёт проведения`, `Qaytarish ${res.returnNumber} kiritildi — o'tkazilishini kutmoqda`));
      utils.returns.list.invalidate();
      utils.returns.returnable.invalidate();
    },
    onError: (e) => notify.error(errorText(e)),
  });

  const order = orderQ.data;
  const names = new Map((order?.items ?? []).map(i => [Number(i.productId), i]));
  const lines: DraftLine[] = (leftQ.data ?? []).map(l => ({
    productId: l.productId,
    name: names.get(l.productId)?.productName ?? `#${l.productId}`,
    unit: names.get(l.productId)?.unit ?? null,
    unitPrice: l.unitPrice,
    left: l.left,
  }));
  const draft = returnDraft(lines, qty);
  const canSend = !!order && reason !== null && draft.items.length > 0 && !create.isPending;
  const pick = (active: boolean) => `tap py-2 px-3 rounded-lg border text-xs font-medium text-left transition-all ${active ? "border-primary bg-primary/10 text-primary" : "border-border-subtle text-secondary hover:border-border-strong"}`;

  const send = () => {
    if (!canSend || !order) return;
    create.mutate({
      orderId, shopId: Number(order.shopId), reason: reason!,
      notes: notes.trim() || undefined,
      items: draft.items,
    });
  };

  if (created) {
    return (
      <AppModal open onClose={onClose} maxWidth={480} title={t("Возврат заведён", "Qaytarish kiritildi")} subtitle={order?.orderNumber}
        footer={<button onClick={onClose} className="neo-btn-primary tap flex-1">{t("Готово", "Tayyor")}</button>}>
        <div data-testid="return-created">
          <p className="text-sm text-primary">
            {t("Возврат", "Qaytarish")} <b>{created.returnNumber}</b> — {t("ждёт проведения в «Возвратах». Остаток и долг магазина изменятся после проведения.", "«Qaytarishlar»da o'tkazilishini kutmoqda. Qoldiq va do'kon qarzi o'tkazilgandan keyin o'zgaradi.")}
          </p>
          {canOperate(user?.role) && (
            <Link to={returnLink(created.id)} className="neo-btn tap text-sm mt-4 inline-flex items-center gap-1.5" data-testid="return-created-link">
              {t("Открыть в «Возвратах»", "«Qaytarishlar»da ochish")} <ChevronRight size={14} />
            </Link>
          )}
        </div>
      </AppModal>
    );
  }

  return (
    <AppModal open onClose={onClose} dirty={draft.items.length > 0 || notes !== ""} maxWidth={560}
      title={t("Оформить возврат", "Qaytarishni rasmiylashtirish")}
      subtitle={order ? `${order.orderNumber} · ${order.shop?.name ?? ""}` : undefined}
      footer={<>
        <button data-testid="return-submit" onClick={send} disabled={!canSend}
          className="neo-btn-primary tap flex-1 flex items-center justify-center gap-2 disabled:opacity-40">
          {create.isPending && <Loader2 size={14} className="animate-spin" />}
          {t("Оформить", "Rasmiylashtirish")}{draft.total > 0 ? ` · ${fmt(draft.total)}` : ""}
        </button>
        <button onClick={onClose} className="neo-btn tap px-5">{t("Отмена", "Bekor")}</button>
      </>}
    >
      {(orderQ.isLoading || leftQ.isLoading) && <p className="text-sm text-secondary">{t("Загрузка…", "Yuklanmoqda…")}</p>}
      {leftQ.isError && <p className="text-sm text-danger">{errorText(leftQ.error)}</p>}

      {lines.length > 0 && (
        <div>
          <label className={modalFieldLabel}>{t("Что возвращают", "Nima qaytariladi")}</label>
          <div className="space-y-2">
            {lines.map(l => (
              <div key={l.productId} className="neo-card-sm flex items-center gap-3" style={{ borderRadius: "14px", padding: "10px 12px" }} data-testid={`return-line-${l.productId}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-primary truncate">{l.name}</p>
                  <p className="text-xs text-secondary">
                    {fmt(l.unitPrice)} · {l.left > 0
                      ? t(`можно вернуть до ${l.left} ${unitShort(l.unit, "ru")}`, `${l.left} ${unitShort(l.unit, "uz")} gacha qaytarish mumkin`)
                      : t("уже возвращено всё", "hammasi qaytarilgan")}
                  </p>
                </div>
                <input
                  data-testid={`return-qty-${l.productId}`}
                  aria-label={t(`Вернуть: ${l.name}`, `Qaytarish: ${l.name}`)}
                  type="text" inputMode="decimal" placeholder="0"
                  disabled={l.left <= 0}
                  className="neo-input font-data text-right tap disabled:opacity-40" style={{ width: "88px" }}
                  value={qty[l.productId] ?? ""}
                  onChange={e => setQty(q => ({ ...q, [l.productId]: clampQty(e.target.value, l.left) }))}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className={modalFieldLabel}>{t("Причина", "Sabab")}</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {REASONS.map(r => (
            <button key={r} type="button" onClick={() => setReason(r)} className={pick(reason === r)} data-testid={`return-reason-${r}`}>
              {RETURN_REASON_LABEL[r][lang === "uz" ? "uz" : "ru"]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={modalFieldLabel}>{t("Комментарий", "Izoh")}</label>
        <textarea data-testid="return-notes" className="neo-input w-full" rows={2} value={notes} onChange={e => setNotes(e.target.value)}
          placeholder={t("Например: партия от 12.09, вздутые банки", "Masalan: 12.09 partiyasi, shishgan bankalar")} />
      </div>
    </AppModal>
  );
}

/* ─── Карточка заказа ─────────────────────────────────────────────────────── */

/** Кнопка — у доставленного заказа и тем, кому сервер разрешает returns.create. */
export function OrderReturnButton({ orderId, status, deleted }: { orderId: number; status: string; deleted: boolean }) {
  const { lang } = useLang();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  if (!canFileReturn(user?.role) || status !== "delivered" || deleted) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} className="neo-btn tap text-sm" data-testid="order-return">
        <RotateCcw size={15} /> {lang === "uz" ? "Qaytarishni rasmiylashtirish" : "Оформить возврат"}
      </button>
      {open && <ReturnDialog orderId={orderId} onClose={() => setOpen(false)} />}
    </>
  );
}

const MARK: Record<ReturnStatus, { ru: string; uz: string; color: string }> = {
  pending:   { ru: "ждёт проведения",          uz: "o'tkazilishini kutmoqda",          color: "var(--color-warning-text)" },
  approved:  { ru: "одобрен, ждёт проведения", uz: "tasdiqlangan, o'tkazilishini kutmoqda", color: "var(--color-warning-text)" },
  completed: { ru: "проведён",                 uz: "o'tkazilgan",                      color: "var(--color-text-secondary)" },
  rejected:  { ru: "отклонён",                 uz: "rad etilgan",                      color: "var(--color-text-tertiary)" },
};

/**
 * Пометка в карточке заказа: по нему заведён возврат. Без неё оператор,
 * вернувшись к заказу, не видел бы, что возврат уже оформлен, и заводил бы
 * второй — сервер его отверг бы, но уже после того, как человек всё вписал.
 */
export function OrderReturnMarks({ orderId }: { orderId: number }) {
  const { lang } = useLang();
  const { user } = useAuth();
  const office = canOperate(user?.role);
  const { data } = trpc.returns.list.useQuery({ orderId, pageSize: 20 }, { enabled: canFileReturn(user?.role) });
  const rows = data?.data ?? [];
  if (rows.length === 0) return null;
  return (
    <div className="neo-card neo-card-static space-y-1" style={{ borderRadius: "16px", padding: "10px 14px", fontSize: "13px" }} data-testid="order-return-marks">
      {rows.map(r => {
        const m = MARK[r.status as ReturnStatus];
        const label = <>{lang === "uz" ? "Qaytarish" : "Возврат"} №{r.returnNumber}</>;
        return (
          <p key={r.id} data-testid={`order-return-mark-${r.id}`}>
            {office ? <Link to={returnLink(r.id)} className="font-semibold text-primary underline">{label}</Link> : <b>{label}</b>}
            <span style={{ color: m?.color }}> — {m ? m[lang === "uz" ? "uz" : "ru"] : r.status}</span>
          </p>
        );
      })}
    </div>
  );
}

/* ─── Карточка магазина ───────────────────────────────────────────────────── */

/**
 * «Оформить возврат» из карточки магазина: сначала выбрать доставленный заказ
 * (последние сверху — магазин обычно сдаёт вчерашнее), потом то же окно.
 */
export function ShopReturnButton({ shopId, shopName }: { shopId: number; shopName: string }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { fmt } = useCurrency();
  const { user } = useAuth();
  const [picking, setPicking] = useState(false);
  const [orderId, setOrderId] = useState<number | null>(null);
  const ordersQ = trpc.order.list.useQuery(
    { shopId, status: "delivered", pageSize: 30, sortBy: "createdAt", sortDir: "desc" },
    { enabled: picking },
  );
  if (!canFileReturn(user?.role)) return null;
  const rows = ordersQ.data?.data ?? [];
  return (
    <>
      <button onClick={() => setPicking(true)} className="neo-btn flex items-center gap-1.5 text-sm py-2 tap" data-testid="shop-return">
        <RotateCcw size={13} />{t("Оформить возврат", "Qaytarishni rasmiylashtirish")}
      </button>
      {picking && (
        <AppModal open onClose={() => setPicking(false)} maxWidth={480}
          title={t("Возврат: какой заказ?", "Qaytarish: qaysi buyurtma?")} subtitle={shopName}
          footer={<button onClick={() => setPicking(false)} className="neo-btn tap px-5">{t("Отмена", "Bekor")}</button>}>
          {ordersQ.isLoading && <p className="text-sm text-secondary">{t("Загрузка…", "Yuklanmoqda…")}</p>}
          {!ordersQ.isLoading && rows.length === 0 && (
            <p className="text-sm text-secondary" data-testid="shop-return-empty">{t("Доставленных заказов у магазина нет — возвращать нечего.", "Do'konda yetkazilgan buyurtmalar yo'q — qaytaradigan narsa yo'q.")}</p>
          )}
          <div className="space-y-2">
            {rows.map(o => (
              <button key={o.id} type="button" data-testid={`shop-return-order-${o.id}`}
                onClick={() => { setPicking(false); setOrderId(o.id); }}
                className="neo-card-sm tap w-full flex items-center gap-3 text-left" style={{ borderRadius: "14px", padding: "10px 12px" }}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-data font-semibold text-primary">{o.orderNumber}</p>
                  <p className="text-xs text-secondary">
                    {t("доставлен", "yetkazilgan")} {format(new Date(o.deliveredAt ?? o.createdAt), "dd.MM.yyyy")}
                  </p>
                </div>
                <span className="font-data text-sm font-bold text-primary">{fmt(o.total)}</span>
                <ChevronRight size={14} className="text-secondary" />
              </button>
            ))}
          </div>
        </AppModal>
      )}
      {orderId !== null && <ReturnDialog orderId={orderId} onClose={() => setOrderId(null)} />}
    </>
  );
}
