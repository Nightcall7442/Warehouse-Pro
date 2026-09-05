/**
 * Offline Orders — agent can create orders without internet.
 * Orders are saved to IndexedDB and synced when connection is restored.
 */
import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { WifiOff, Wifi, Clock, CheckCircle2, Loader2, Trash2, RefreshCw } from "lucide-react";
import { deletePendingOrder, clearPendingFailure } from "./OfflineOrders.helpers";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { useConfirm } from "@/components/ConfirmDialog";
import { useInvalidateOrderCaches } from "@/hooks/useOrderCacheSync";
import type { PaymentMethod } from "@/components/orders";

// Pending orders come back from IndexedDB as untyped records — narrow the
// stored method back to the union order.create accepts before syncing.
function toPaymentMethod(value: unknown): PaymentMethod {
  return value === "card" || value === "transfer" || value === "debt" ? value : "cash";
}

// ── Component ────────────────────────────────────────────────────────────────
export default function OfflineOrders() {
  const { user }  = useAuth();
  const { fmt }   = useCurrency();
  const { lang }  = useLang();
  const { confirm, dialog } = useConfirm();
  const invalidateOrderCaches = useInvalidateOrderCaches();

  /*
    Отправка живёт в общем хуке, а не здесь.

    Раньше она работала, только пока этот экран открыт: агент оформлял заказы
    в подсобке, выходил на улицу со связью, шёл по приложению дальше — а
    очередь стояла нетронутой, пока он сам не догадается сюда заглянуть.
    Теперь тот же хук включён в оболочке приложения, и связь появилась —
    заказы ушли, на каком бы экране человек ни был.
  */
  const { online, pending, syncing, syncAll, reload } = useOfflineSync();
  // onSuccess обязателен: заказ ушёл — списки и сводки должны это увидеть.
  const createOrder = trpc.order.create.useMutation({
    onSuccess: () => invalidateOrderCaches(),
  });

  /*
    Удаление спрашивает.

    Это единственная копия заказа: на сервер он не ушёл, больше его нигде
    нет. Кнопка была 24 точки в поперечнике и стояла в трёх с половиной
    точках от «Отправить» — промах пальцем стирал работу агента без единого
    вопроса и без возможности вернуть.
  */
  const deleteLocal = async (localId: number, shopName: string) => {
    const ok = await confirm({
      title: lang === "uz" ? "Buyurtmani o'chirish?" : "Удалить заказ?",
      message: lang === "uz"
        ? shopName + " uchun buyurtma serverga yuborilmagan. O'chirilsa, uni tiklab bo'lmaydi."
        : "Заказ для «" + shopName + "» не отправлен на сервер. После удаления его не восстановить.",
      confirmText: lang === "uz" ? "O'chirish" : "Удалить",
      danger: true,
    });
    if (!ok) return;
    await deletePendingOrder(localId);
    await reload();
  };

  const [sendingId, setSendingId] = useState<number | null>(null);

  /** Отправить один заказ по кнопке. */
  const sendOne = async (order: Record<string, unknown>) => {
    setSendingId(order.localId as number);
    try {
      await createOrder.mutateAsync({
        shopId:   order.shopId as number,
        agentId:  (order.agentId as number) ?? user?.id ?? 0,
        items:    order.items as Array<{ productId: number; quantity: string | number }>,
        notes:    order.notes as string | undefined,
        discount: order.discount as string | number | undefined,
        paymentMethod: toPaymentMethod(order.paymentMethod),
        idempotencyKey: (order.idempotencyKey as string) || crypto.randomUUID(),
      });
      await deletePendingOrder(order.localId as number);
      notify.success(lang === "uz" ? "Buyurtma yuborildi" : "Заказ отправлен");
    } catch (e: unknown) {
      notify.error(e instanceof Error ? e.message : "Не удалось отправить");
    } finally {
      setSendingId(null);
      await reload();
    }
  };

  /** Снять отметку об отказе и попробовать снова. */
  const retryFailed = async (localId: number) => {
    await clearPendingFailure(localId);
    await reload();
    await syncAll();
  };
  return (
    <div className="space-y-5 max-w-lg mx-auto">
      {/* Status bar */}
      <div className={`panel p-4 flex items-center gap-3 border-l-4 ${
        online ? "border-success bg-success/5" : "border-warning bg-warning/5"
      }`}>
        {online
          ? <Wifi size={20} className="text-success flex-shrink-0"/>
          : <WifiOff size={20} className="text-warning flex-shrink-0"/>
        }
        <div className="flex-1">
          <p className="font-medium text-primary text-sm">
            {online
              ? (lang === "uz" ? "Internet bor" : "Онлайн")
              : (lang === "uz" ? "Internet yo'q" : "Офлайн режим")}
          </p>
          <p className="text-xs text-secondary">
            {online
              ? pending.length > 0
                ? (lang === "uz" ? `${pending.length} ta buyurtma sinxronlanishni kutmoqda` : `${pending.length} заказов ожидают синхронизации`)
                : (lang === "uz" ? "Hamma narsa sinxronlangan" : "Всё синхронизировано")
              : (lang === "uz" ? "Buyurtmalar qurilmada saqlanadi" : "Заказы сохраняются на устройстве")
            }
          </p>
        </div>
        {online && pending.length > 0 && (
          <button
            onClick={syncAll}
            disabled={syncing}
            className="neo-btn-primary py-1.5 px-3 text-xs flex items-center gap-1.5"
          >
            {syncing ? <Loader2 size={13} className="animate-spin"/> : <RefreshCw size={13}/>}
            {lang === "uz" ? "Sinxronlash" : "Синхронизировать"}
          </button>
        )}
      </div>

      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-primary tracking-tight">
          {lang === "uz" ? "Offline buyurtmalar" : "Офлайн заказы"}
        </h1>
        <span className="font-data text-secondary text-sm">
          {pending.length} {lang === "uz" ? "ta" : "шт."}
        </span>
      </div>

      {pending.length === 0 ? (
        <div className="neo-card p-10 text-center space-y-2">
          <CheckCircle2 size={32} className="mx-auto text-success"/>
          <p className="text-secondary text-sm">
            {lang === "uz" ? "Kutayotgan buyurtmalar yo'q" : "Нет ожидающих заказов"}
          </p>
          {!online && (
            <p className="text-xs text-secondary mt-2">
              {lang === "uz"
                ? "Internet bo'lmasa ham yangi buyurtmalar bu yerda saqlanadi"
                : "При отсутствии интернета новые заказы сохранятся здесь"}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map(order => {
            // Сумма берётся из самой записи: в позициях лежат только productId и
            // quantity, цены там нет, и счёт по ним давал «не число сум».
            const total = Number(order.total ?? 0);
            return (
              <div key={order.localId as number} className="neo-card p-4 border-l-2 border-warning">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <Clock size={14} className="text-warning flex-shrink-0"/>
                      <span className="text-sm font-medium text-primary">
                        {String(order.shopName ?? `Shop #${String(order.shopId)}`)}
                      </span>
                    </div>
                    <p className="text-xs text-secondary mt-1">
                      {lang === "uz" ? "Saqlangan:" : "Сохранён:"} {new Date(order.savedAt as string).toLocaleString("ru-RU")}
                    </p>
                    <p className="text-xs text-secondary">
                      {(order.items as Array<unknown>)?.length ?? 0} {lang === "uz" ? "ta mahsulot" : "товаров"} · {fmt(total)}
                    </p>
                    {/* Причина отказа — человеку на глаза.
                        Заказ, отвергнутый сервером по существу (товар удалили,
                        магазин закрыли), раньше молча оставался в очереди и
                        пересылался снова при каждом заходе, всегда с тем же
                        концом. Агент видел «N заказов не удалось» и не мог
                        ничего сделать. */}
                    {typeof order.lastError === "string" && (
                      <div className="mt-2 rounded-lg p-2 text-xs" style={{ background: "var(--color-danger-subtle, rgba(220,80,80,.12))" }}>
                        <p className="text-danger" style={{ margin: 0 }}>{String(order.lastError)}</p>
                        <button
                          onClick={() => retryFailed(order.localId as number)}
                          className="tap mt-1 underline"
                          style={{ color: "var(--color-primary-text)" }}
                        >
                          {lang === "uz" ? "Yana yuborish" : "Отправить ещё раз"}
                        </button>
                      </div>
                    )}
                  </div>
                  {/* Кнопки в 44 точки и с зазором в 8.
                      Было: «Отправить» высотой в строку текста и рядом,
                      в трёх с половиной точках, значок корзины 24 точки.
                      Промах по корзине стирал единственную копию заказа. */}
                  <div className="flex gap-2 flex-shrink-0">
                    {online && !order.lastError && (
                      <button
                        onClick={() => sendOne(order)}
                        disabled={sendingId === order.localId}
                        className="neo-btn-primary tap px-4 text-xs disabled:opacity-40"
                      >
                        {sendingId === order.localId
                          ? <Loader2 size={14} className="animate-spin" />
                          : (lang === "uz" ? "Yuborish" : "Отправить")}
                      </button>
                    )}
                    <button
                      onClick={() => deleteLocal(order.localId as number, String(order.shopName ?? "—"))}
                      aria-label={lang === "uz" ? "O'chirish" : "Удалить"}
                      className="neo-btn tap text-danger border-danger/30 flex items-center justify-center"
                    >
                      <Trash2 size={16}/>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="neo-card p-4 text-sm text-secondary">
        <p className="font-medium text-primary mb-1">
          {lang === "uz" ? "Qanday ishlaydi" : "Как работает"}
        </p>
        <p>
          {lang === "uz"
            ? "Internet bo'lmasa yangi buyurtma yaratganingizda u avtomatik qurilmaga saqlanadi. Internet paydo bo'lganda avtomatik yuboriladi."
            : "При создании заказа без интернета он автоматически сохраняется на устройстве. При восстановлении связи — автоматически отправляется на сервер."}
        </p>
      </div>
      {dialog}
    </div>
  );
}
