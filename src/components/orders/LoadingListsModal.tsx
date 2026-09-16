import { useState } from "react";
import { ClipboardList, Loader2, Trash2, ChevronRight, PackageCheck, Truck, ListChecks, AlertTriangle, Printer } from "lucide-react";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { unitShort } from "@/lib/units";
import { PremiumSelect } from "@/components/PremiumSelect";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useLang } from "@/i18n";
import { useConfirm } from "@/components/ConfirmDialog";
import { AppModal } from "@/components/ui/AppModal";
import { labelled, LOADING_LIST_STATUS_LABEL } from "@/lib/entity-labels";
import { printLoadingList, type LoadingListData } from "@/lib/documents";
import { useSellerCompany } from "@/hooks/useSellerCompany";

/** «12.00» → «12», «1.50» → «1.5»: кладовщику незачем видеть хвост decimal. */
const qty = (v: string | number | null | undefined) => String(Number(v ?? 0));

/**
 * Сборка по строкам.
 *
 * Лист был бумагой: SUM по товару и печать. Сколько собрали на самом деле,
 * никто не записывал — недостача всплывала у магазина как «частичная
 * доставка». Здесь кладовщик подтверждает каждую строку: по умолчанию —
 * сколько нужно, меньше — недостача, которая уходит офису сразу. Партии —
 * подсказка по тому же порядку, что и списание при отгрузке.
 */
function PickingPanel({ listId, onClose }: { listId: number; onClose: () => void }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.order.loadingListLines.useQuery({ listId });
  const [picks, setPicks] = useState<Record<number, string>>({});

  const confirmPicking = trpc.order.confirmPicking.useMutation({
    onSuccess: (r) => {
      utils.order.listLoadingLists.invalidate();
      if (r.shortages.length === 0) notify.success(t(`${r.listNumber} собран полностью`, `${r.listNumber} to'liq yig'ildi`));
      else notify.info(t(`${r.listNumber}: недостача по ${r.shortages.length} поз. — офис уведомлён`, `${r.listNumber}: ${r.shortages.length} ta qatorda kamomad — ofis xabardor`));
      onClose();
    },
    onError: (e) => notify.error(e.message),
  });

  const lines = data?.lines ?? [];
  const valueOf = (l: { productId: number; requiredQty: string }) => picks[l.productId] ?? qty(l.requiredQty);
  const short = lines.filter(l => Number(valueOf(l)) < Number(l.requiredQty)).length;
  const dd = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
  const batchesText = (b: Array<{ batch: string | null; expires: string | null; qty: number }> | null) =>
    b && b.length > 0
      ? b.map(x => `${x.batch ?? t("б/н", "raqamsiz")}${x.expires ? ` ${t("до", "gacha")} ${dd(x.expires)}` : ""} ×${qty(x.qty)}`).join("; ")
      : "—";

  const submit = () => confirmPicking.mutate({
    listId,
    lines: lines.map(l => ({ productId: l.productId, pickedQty: Number(valueOf(l)).toFixed(2) })),
  });

  return (
    <div style={{ width: "100%", borderTop: "1px solid var(--color-border)", paddingTop: "10px", marginTop: "4px" }}>
      {isLoading ? (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--color-text-tertiary)", fontSize: "12.5px" }}>
          <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> {t("Загрузка…", "Yuklanmoqda…")}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: "12.5px", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--color-text-tertiary)", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                <th style={{ textAlign: "left", padding: "4px 6px" }}>{t("Товар", "Tovar")}</th>
                <th style={{ textAlign: "right", padding: "4px 6px" }}>{t("Нужно", "Kerak")}</th>
                <th style={{ textAlign: "left", padding: "4px 6px" }}>{t("Партии", "Partiyalar")}</th>
                <th style={{ textAlign: "right", padding: "4px 6px" }}>{t("Собрано", "Yig'ildi")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(l => {
                const isShort = Number(valueOf(l)) < Number(l.requiredQty);
                return (
                  <tr key={l.productId} style={{ borderTop: "1px solid var(--color-border)" }}>
                    <td style={{ padding: "6px", color: "var(--color-text-primary)" }}>
                      {l.productName}
                      {l.productCode ? <span style={{ color: "var(--color-text-tertiary)", marginLeft: "6px" }}>{l.productCode}</span> : null}
                    </td>
                    <td style={{ padding: "6px", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {qty(l.requiredQty)} {unitShort(l.unit, lang)}
                    </td>
                    <td style={{ padding: "6px", color: "var(--color-text-tertiary)", fontSize: "11.5px" }}>{batchesText(l.batches)}</td>
                    <td style={{ padding: "6px", textAlign: "right" }}>
                      <DecimalInput
                        value={valueOf(l)}
                        onValueChange={v => setPicks(p => ({ ...p, [l.productId]: v }))}
                        aria-label={t(`Собрано: ${l.productName}`, `Yig'ildi: ${l.productName}`)}
                        className="neo-input text-right"
                        style={{ width: "84px", fontVariantNumeric: "tabular-nums", ...(isShort ? { borderColor: "var(--color-warning)" } : {}) }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "10px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "12px", color: short > 0 ? "var(--color-warning-text)" : "var(--color-text-tertiary)", display: "flex", alignItems: "center", gap: "5px" }}>
          {short > 0 ? <><AlertTriangle size={13} /> {t(`Недостача: ${short} поз.`, `Kamomad: ${short} ta qator`)}</> : t("Всё по списку", "Hammasi ro'yxat bo'yicha")}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
          <button className="neo-btn" onClick={onClose} style={{ fontSize: "12px", padding: "8px 12px" }}>{t("Отмена", "Bekor")}</button>
          <button className="neo-btn-primary" disabled={isLoading || lines.length === 0 || confirmPicking.isPending} onClick={submit} style={{ fontSize: "12px", padding: "8px 14px" }}>
            {confirmPicking.isPending ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <ListChecks size={13} />}
            {t("Подтвердить сборку", "Yig'ishni tasdiqlash")}
          </button>
        </div>
      </div>
    </div>
  );
}

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
  /** Лист, у которого раскрыта сборка по строкам. */
  const [picking, setPicking] = useState<number | null>(null);

  const { data, isLoading } = trpc.order.listLoadingLists.useQuery({ page: 1, pageSize: 50 }, { enabled: open });

  /*
    Печать из списка.

    Лист печатался один раз — из окна создания. «Готово, без печати»,
    заблокированное окно, кончившаяся бумага — и лист оставался без бумаги
    навсегда: заказы держит, а напечатать нечем. Сводный формат — тот, за
    которым приходят почти всегда; «по маршруту» остаётся в окне создания.
  */
  const { company: seller, currency } = useSellerCompany();
  const [printing, setPrinting] = useState<number | null>(null);
  const reprint = async (listId: number) => {
    setPrinting(listId);
    try {
      const d = await utils.order.loadingListPrintData.fetch({ listId });
      printLoadingList({ ...(d as LoadingListData), companyName: seller.name || undefined }, "aggregated", currency);
    } catch (e) {
      notify.error(e instanceof Error ? e.message : t("Не удалось подготовить лист", "Varaqani tayyorlab bo'lmadi"));
    } finally {
      setPrinting(null);
    }
  };

  const refresh = () => {
    utils.order.listLoadingLists.invalidate();
    utils.order.list.invalidate();
  };

  const advance = trpc.order.updateLoadingListStatus.useMutation({
    onSuccess: () => { refresh(); notify.success(t("Статус изменён", "Holat o'zgartirildi")); },
    onError: (e) => notify.error(e.message),
    onSettled: () => setBusy(null),
  });

  /*
    Кому отдать рейс.

    Список курьеров нужен здесь же: выбирать человека, уходя на другой экран и
    возвращаясь, — то же самое, что не выбирать.
  */
  const { data: couriers } = trpc.user.list.useQuery({ page: 1, pageSize: 100 }, { enabled: open });
  const courierOptions = ((couriers?.data ?? []) as { id: number; name: string; role: string; status: string }[])
    .filter(u => u.role === "courier" && u.status === "active");

  const assignCourier = trpc.order.assignCourierToList.useMutation({
    onSuccess: (r) => {
      refresh();
      notify.success(t(
        `${r.listNumber} → ${r.courierName}: назначено заказов ${r.assigned} из ${r.total}`,
        `${r.listNumber} → ${r.courierName}: ${r.total} dan ${r.assigned} ta`,
      ));
    },
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
                      {/* Недостача видна в списке, а не только внутри строк. */}
                      {Number(l.shortLines) > 0 && (
                        <span style={{ color: "var(--color-warning-text)", marginLeft: "6px" }}>
                          · {t(`недостача: ${l.shortLines} поз.`, `kamomad: ${l.shortLines} ta`)}
                        </span>
                      )}
                    </p>
                    {/*
                      Кто везёт — на виду, а не в карточке каждого заказа.

                      Пока курьера назначали поштучно, ответить «кто повезёт
                      этот лист» можно было, только открыв все его заказы по
                      очереди.
                    */}
                    {!done && (
                      <div style={{ display: "flex", alignItems: "center", gap: "7px", marginTop: "7px", flexWrap: "wrap" }}>
                        <Truck size={13} style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }} />
                        <PremiumSelect
                          value={l.courierId ? String(l.courierId) : ""}
                          onChange={v => {
                            if (!v) return;
                            setBusy(l.id);
                            assignCourier.mutate({ listId: l.id, courierId: Number(v) });
                          }}
                          width="190px"
                          aria-label={t("Кому отдать рейс", "Reysni kimga berish")}
                          options={[
                            { value: "", label: t("Курьер не назначен", "Kuryer tayinlanmagan") },
                            ...courierOptions.map(c => ({ value: String(c.id), label: c.name })),
                          ]}
                        />
                        {busy === l.id && assignCourier.isPending && (
                          <Loader2 size={13} style={{ animation: "spin 1s linear infinite", color: "var(--color-text-tertiary)" }} />
                        )}
                      </div>
                    )}
                    {done && l.courierName && (
                      <p style={{ fontSize: "11.5px", color: "var(--color-text-tertiary)", marginTop: "5px" }}>
                        <Truck size={11} style={{ display: "inline", marginRight: "4px", verticalAlign: "-1px" }} />
                        {l.courierName}
                      </p>
                    )}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                    <button
                      className="neo-btn"
                      disabled={printing === l.id}
                      onClick={() => void reprint(l.id)}
                      aria-label={t("Печать листа", "Varaqani chop etish")}
                      title={t("Напечатать лист ещё раз", "Varaqani qayta chop etish")}
                      data-testid={`list-print-${l.id}`}
                      style={{ fontSize: "12px", padding: "8px 10px" }}
                    >
                      {printing === l.id
                        ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
                        : <Printer size={13} />}
                    </button>
                    {/* «Готов» — только через сборку по строкам: кнопка статуса здесь уступает место сборке. */}
                    {l.status === "preparing" ? (
                      <button
                        className="neo-btn"
                        disabled={working}
                        onClick={() => setPicking(picking === l.id ? null : l.id)}
                        style={{ fontSize: "12px", padding: "8px 12px" }}
                      >
                        <ListChecks size={13} />
                        {t("Собрать", "Yig'ish")}
                      </button>
                    ) : next && (
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
                  {picking === l.id && l.status === "preparing" && (
                    <PickingPanel listId={l.id} onClose={() => setPicking(null)} />
                  )}
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
