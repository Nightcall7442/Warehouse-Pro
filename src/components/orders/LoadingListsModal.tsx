import { useState } from "react";
import { ClipboardList, Loader2, Trash2, ChevronRight, PackageCheck } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useLang } from "@/i18n";
import { useConfirm } from "@/components/ConfirmDialog";
import { AppModal } from "@/components/ui/AppModal";
import { labelled, LOADING_LIST_STATUS_LABEL } from "@/lib/entity-labels";

/**
 * Погрузочные листы: посмотреть, продвинуть, удалить ошибочный.
 *
 * ── Чего не было ────────────────────────────────────────────────────────────
 *
 * Экрана погрузочных листов не существовало вовсе. Ручки `listLoadingLists` и
 * `updateLoadingListStatus` были написаны и выставлены наружу — и НЕ
 * ВЫЗЫВАЛИСЬ НИОТКУДА: интерфейс умел листы только создавать.
 *
 * При этом незакрытый лист держит свои заказы: собрать их во второй лист
 * нельзя, иначе склад соберёт их дважды. Система честно писала «закройте
 * прежний лист» — а закрыть его через неё было НЕЧЕМ.
 *
 * У арендатора это кончилось тем, что одиннадцать заказов оказались заперты в
 * листе ZL-20260908-JPXE навсегда, и сборка встала.
 *
 * ── Почему удаление, а не «доставлен» ───────────────────────────────────────
 *
 * Перевод в «доставлен» разблокировал бы заказы, но записал бы доставку,
 * которой не было. Лист, собранный по ошибке, надо удалять, а не выдавать за
 * отгруженный.
 */
export function LoadingListsModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const utils = trpc.useUtils();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState<number | null>(null);

  const { data, isLoading } = trpc.order.listLoadingLists.useQuery({ page: 1, pageSize: 50 }, { enabled: open });

  const refresh = () => {
    utils.order.listLoadingLists.invalidate();
    utils.order.list.invalidate();
  };

  const advance = trpc.order.updateLoadingListStatus.useMutation({
    onSuccess: () => { refresh(); notify.success(t("Статус изменён", "Holat o'zgartirildi")); },
    onError: (e) => notify.error(e.message),
    onSettled: () => setBusy(null),
  });

  const remove = trpc.order.deleteLoadingList.useMutation({
    onSuccess: (r) => { refresh(); notify.success(t(`Лист ${r.listNumber} удалён — заказы освобождены`, `${r.listNumber} o'chirildi — buyurtmalar bo'shatildi`)); },
    onError: (e) => notify.error(e.message),
    onSettled: () => setBusy(null),
  });

  /** Следующий шаг по цепочке. У отгруженного его нет. */
  const nextStatus: Record<string, string | undefined> = {
    preparing: "ready", ready: "loading", loading: "loaded", loaded: "delivered",
  };

  const askAndDelete = async (id: number, listNumber: string, orders: number) => {
    const ok = await confirm({
      title: t("Удалить погрузочный лист?", "Yuklash varaqasi o'chirilsinmi?"),
      message: t(
        `Лист ${listNumber} будет удалён, а ${orders} заказ(ов) из него освободятся — их снова можно будет собрать. Сами заказы не тронутся.`,
        `${listNumber} o'chiriladi va undagi ${orders} ta buyurtma bo'shatiladi — ularni qaytadan yig'ish mumkin bo'ladi. Buyurtmalarning o'ziga tegilmaydi.`,
      ),
      confirmText: t("Удалить", "O'chirish"),
      danger: true,
    });
    if (!ok) return;
    setBusy(id);
    remove.mutate({ listId: id });
  };

  const lists = data?.data ?? [];

  return (
    <>
      <AppModal
        open={open}
        onClose={() => onOpenChange(false)}
        title={t("Погрузочные листы", "Yuklash varaqalari")}
        subtitle={t("Незакрытый лист держит свои заказы — их нельзя собрать второй раз", "Yopilmagan varaqa buyurtmalarni ushlab turadi")}
        maxWidth={720}
      >
        {isLoading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "9px", padding: "40px", color: "var(--color-text-tertiary)" }}>
            <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
            {t("Загрузка…", "Yuklanmoqda…")}
          </div>
        ) : lists.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <div style={{
              width: "54px", height: "54px", borderRadius: "18px", margin: "0 auto 14px",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "var(--color-surface-light)", color: "var(--color-text-tertiary)",
              boxShadow: "var(--shadow-sm)",
            }}>
              <ClipboardList size={24} />
            </div>
            <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "4px" }}>
              {t("Листов пока нет", "Hozircha varaqalar yo'q")}
            </p>
            <p style={{ fontSize: "12.5px", color: "var(--color-text-tertiary)" }}>
              {t("Выберите заказы в списке и соберите лист", "Ro'yxatdan buyurtmalarni tanlab varaqa yarating")}
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {lists.map(l => {
              const next = nextStatus[l.status];
              const done = l.status === "delivered";
              const working = busy === l.id;
              return (
                <div
                  key={l.id}
                  className="neo-card neo-card-static"
                  style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}
                >
                  <div style={{
                    width: "40px", height: "40px", borderRadius: "14px", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: done ? "var(--color-success-subtle)" : "var(--color-primary-subtle)",
                    color: done ? "var(--color-success-text, var(--color-success))" : "var(--color-primary-text)",
                  }}>
                    {done ? <PackageCheck size={18} /> : <ClipboardList size={18} />}
                  </div>

                  <div style={{ flex: 1, minWidth: "150px" }}>
                    <p style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)" }}>{l.listNumber}</p>
                    <p style={{ fontSize: "11.5px", color: "var(--color-text-tertiary)", marginTop: "2px" }}>
                      {t(`${l.totalOrders} заказ(ов)`, `${l.totalOrders} ta buyurtma`)}
                      {" · "}
                      {labelled(LOADING_LIST_STATUS_LABEL, l.status, lang)}
                      {l.agentName ? ` · ${l.agentName}` : ""}
                    </p>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                    {next && (
                      <button
                        className="neo-btn"
                        disabled={working || advance.isPending}
                        onClick={() => { setBusy(l.id); advance.mutate({ listId: l.id, status: next }); }}
                        style={{ fontSize: "12px", padding: "8px 12px" }}
                      >
                        {working && advance.isPending
                          ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
                          : <ChevronRight size={13} />}
                        {labelled(LOADING_LIST_STATUS_LABEL, next, lang)}
                      </button>
                    )}

                    {/* Удалить можно только неотгруженный: отгруженный ничего
                        не держит и остаётся записью о факте. */}
                    {!done && (
                      <button
                        className="neo-btn"
                        disabled={working || remove.isPending}
                        onClick={() => void askAndDelete(l.id, l.listNumber, l.totalOrders)}
                        aria-label={t("Удалить лист", "Varaqani o'chirish")}
                        title={t("Удалить лист и освободить заказы", "Varaqani o'chirib buyurtmalarni bo'shatish")}
                        style={{ fontSize: "12px", padding: "8px 10px", color: "var(--color-danger-text)" }}
                      >
                        {working && remove.isPending
                          ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
                          : <Trash2 size={13} />}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </AppModal>
      {dialog}
    </>
  );
}
