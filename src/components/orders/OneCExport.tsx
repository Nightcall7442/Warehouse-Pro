import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useConfirm } from "@/components/ConfirmDialog";
import { notify } from "@/lib/toast";
import { Loader2, Upload } from "lucide-react";

/**
 * Выгрузить заказ в 1С.
 *
 * ── Зачем появилось ─────────────────────────────────────────────────────────
 *
 * Заказы в 1С не уезжают сами: расписания для них нет, и `syncOrderTo1C`
 * вызывается ровно из одного места — ручки `onec.syncOrder`, которую не звал
 * никто. То есть у организации, настроившей обмен, ВЫГРУЗКА ЗАКАЗОВ была
 * недостижима через продукт: товары приезжали, заказы не уезжали, и понять
 * это можно было только по пустой 1С.
 *
 * Тот же случай, что и с проведением возврата: путь написан целиком, а войти
 * в него нечем.
 *
 * ── Почему кнопка, а не расписание ──────────────────────────────────────────
 *
 * Выгрузка создаёт в 1С проведённый документ реализации — он списывает
 * остатки и добавляет выручку на той стороне. Отменить проведение отсюда
 * нечем: мост умеет только создать и провести. Решение «этот заказ уходит в
 * учёт» принимает человек.
 *
 * Повторное нажатие безопасно: идентификатор документа хранится, и второй раз
 * создаётся не новый документ, а доводится до конца сохранённый (см.
 * services/onec-sync.ts).
 *
 * ── Про заказ второй жизни ──────────────────────────────────────────────────
 *
 * Заказ можно вернуть из архива в работу — тогда он идёт вторым кругом под тем
 * же номером, но с другим составом и суммой. Сервер такую выгрузку отклоняет и
 * объясняет почему; согласиться на новый документ должен человек, потому что в
 * 1С останутся оба, и удалять первый придётся там же руками.
 */
export function OneCExport({ orderId, orderNumber }: { orderId: number; orderNumber: string }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { confirm, dialog } = useConfirm();
  const [needsNewDocument, setNeedsNewDocument] = useState(false);

  const statusQ = trpc.onec.status.useQuery(undefined, {
    // Отказ прав — обычное дело: ручка директорская, а заказ смотрят и
    // оператор с супервайзером. Молчим и блока не показываем.
    retry: false,
  });

  const sync = trpc.onec.syncOrder.useMutation({
    onSuccess: () => {
      setNeedsNewDocument(false);
      notify.success(t("Заказ выгружен в 1С", "Buyurtma 1C ga yuklandi"));
    },
    onError: (e) => {
      /*
        Отказ по второй жизни — не поломка, а вопрос человеку. Сервер отвечает
        BAD_REQUEST и объясняет, что документ первого круга уже проведён;
        показываем его текст и открываем второй ход отдельной кнопкой, чтобы
        «новый документ» нельзя было нажать по инерции.
      */
      if (e.data?.code === "BAD_REQUEST") setNeedsNewDocument(true);
      notify.error(e.message);
    },
  });

  const status = statusQ.data;
  // Обмен не настроен или выгрузка заказов выключена — кнопки нет: она
  // обещала бы то, чего система сделать не может.
  if (!status?.configured || !status.schedule?.syncOrders) return null;

  const askNewDocument = async () => {
    const ok = await confirm({
      title: t("Создать в 1С новый документ?", "1C da yangi hujjat yaratilsinmi?"),
      message: t(
        `Заказ ${orderNumber} уже выгружался, а потом возвращался в работу. Прежний документ в 1С проведён и останется там: удалить его можно только в самой 1С. Новый добавит вторую реализацию.`,
        `${orderNumber} avval yuklangan va keyin ishga qaytarilgan. Oldingi hujjat 1C da qoladi — uni faqat 1C da o'chirish mumkin.`,
      ),
      confirmText: t("Создать новый", "Yangi yaratish"),
      danger: true,
    });
    if (ok) sync.mutate({ orderId, asNewDocument: true });
  };

  return (
    <>
      {dialog}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => sync.mutate({ orderId })}
          disabled={sync.isPending}
          className="neo-btn tap flex items-center gap-1.5"
          style={{ padding: "8px 14px", fontSize: "13px" }}
        >
          {sync.isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {t("Выгрузить в 1С", "1C ga yuklash")}
        </button>
        {needsNewDocument && (
          <button
            onClick={askNewDocument}
            disabled={sync.isPending}
            className="neo-btn tap flex items-center gap-1.5"
            style={{ padding: "8px 14px", fontSize: "13px", color: "var(--color-danger-text)" }}
          >
            {t("Всё равно новым документом", "Baribir yangi hujjat bilan")}
          </button>
        )}
      </div>
    </>
  );
}
