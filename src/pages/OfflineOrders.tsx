/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Offline Orders — agent can create orders without internet.
 * Orders are saved to IndexedDB and synced when connection is restored.
 */
import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { WifiOff, Wifi, Clock, CheckCircle2, Loader2, Trash2, RefreshCw } from "lucide-react";
import { getPendingOrders, deletePendingOrder } from "./OfflineOrders.helpers";

// ── Component ────────────────────────────────────────────────────────────────
export default function OfflineOrders() {
  const { user }        = useAuth();
  const { fmt }         = useCurrency();
  const { lang }        = useLang();
  const [online, setOnline]   = useState(navigator.onLine);
  const [pending, setPending] = useState<Record<string, unknown>[]>([]);
  const [syncing, setSyncing] = useState(false);
  const utils = trpc.useUtils();

  const createOrder = trpc.order.create.useMutation();

  // Listen for online/offline
  useEffect(() => {
    const goOnline  = () => { setOnline(true);  };
    const goOffline = () => { setOnline(false); notify.info("Офлайн режим — заказы сохраняются локально"); };
    window.addEventListener("online",  goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online",  goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const loadPending = useCallback(async () => {
    try {
      const orders = await getPendingOrders();
      setPending(orders);
    } catch {
      notify.error("Не удалось загрузить локальные заказы");
    }
  }, []);

  const syncAll = useCallback(async () => {
    if (!online || pending.length === 0 || syncing) return;
    setSyncing(true);

    let synced = 0;
    let failed = 0;

    for (const order of pending) {
      try {
        await createOrder.mutateAsync({
          shopId:   order.shopId as number,
          agentId:  (order.agentId as number) ?? user?.id ?? 0,
          items:    order.items as any,
          notes:    order.notes as string | undefined,
          discount: order.discount as string | number | undefined,
        });
                            await deletePendingOrder(order.localId as number);
        synced++;
      } catch {
        failed++;
      }
    }

    setSyncing(false);
    await loadPending();
    utils.order.list.invalidate();

    if (synced > 0) notify.success(`${synced} заказов синхронизировано`);
    if (failed > 0) notify.error(`${failed} заказов не удалось синхронизировать`);
  }, [online, pending, syncing, createOrder, user, loadPending, utils]);

  // Load pending orders on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPending();
  }, [loadPending]);

  // Auto-sync when coming online
  useEffect(() => {
    if (online && pending.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      syncAll();
    }
  }, [online, pending.length, syncAll]);

  const deleteLocal = async (localId: number) => {
    await deletePendingOrder(localId);
    await loadPending();
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
            const total = (order.items as any)?.reduce(
              (s: number, i: any) => s + Number(i.unitPrice) * Number(i.quantity), 0
            ) ?? 0;
            return (
              <div key={order.localId as any} className="neo-card p-4 border-l-2 border-warning">
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
                      {(order.items as any)?.length ?? 0} {lang === "uz" ? "ta mahsulot" : "товаров"} · {fmt(total)}
                    </p>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    {online && (
                      <button
                        onClick={async () => {
                          try {
                            await createOrder.mutateAsync({
                              shopId:   order.shopId as number,
                              agentId:  (order.agentId as number) ?? user?.id ?? 0,
                              items:    order.items as any,
                              notes:    order.notes as string | undefined,
                              discount: order.discount as string | number | undefined,
                            });
        await deletePendingOrder(order.localId as number);
                            await loadPending();
                            utils.order.list.invalidate();
                            notify.success(lang === "uz" ? "Buyurtma yuborildi" : "Заказ отправлен");
                          } catch (e: unknown) {
                            notify.error(e instanceof Error ? e.message : "Unknown error");
                          }
                        }}
                        className="neo-btn-primary py-1 px-2 text-xs"
                      >
                        {lang === "uz" ? "Yuborish" : "Отправить"}
                      </button>
                    )}
                    <button
                      onClick={() => deleteLocal(order.localId as number)}
                      className="neo-btn p-1.5 text-danger border-danger/30"
                    >
                      <Trash2 size={14}/>
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
    </div>
  );
}
