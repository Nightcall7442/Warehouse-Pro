import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { AppModal } from "@/components/ui/AppModal";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { notify } from "@/lib/toast";
import { formatQty } from "@/lib/format";
import { unitShort } from "@/lib/units";
import { errorText } from "@/lib/error-text";
import { useCurrency } from "@/hooks/useCurrency";
import { COLORS, thStyle, tdStyle } from "@/components/users/types";
import { dayText } from "./transfer-text";

export type TransferDocLine = {
  id: number; productName: string; unit: string | null; quantity: number;
  batchNumber: string | null; expiresAt: string | null;
  /** Себестоимость единицы: партии, иначе карточки, — во что обойдётся недостача. */
  unitCost?: number | null;
};

/**
 * Приёмка перемещения «в пути» на складе-получателе — по строкам.
 *
 * В каждой строке стоит отправленное: приехало всё — нажать «Принять».
 * Меньше — вписать, сколько приехало: недоехавшее останется недостачей на
 * документе, и директор получит уведомление. Больше отправленного принять
 * нельзя — лишнее на полке разбирается инвентаризацией.
 */
export function TransferReceiveDialog({ doc, route, onClose, onDone }: {
  doc: { id: number; number: string; lines: TransferDocLine[] };
  route: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { fmt } = useCurrency();
  const [got, setGot] = useState<Record<number, string>>(() => Object.fromEntries(doc.lines.map(l => [l.id, String(l.quantity)])));

  const receive = trpc.warehouseMulti.receiveTransfer.useMutation({
    onSuccess: (r) => {
      if (r.shortageQty > 0) {
        notify.info(t(`${r.number} принято. Не доехало ${formatQty(r.shortageQty)} — недостача записана, директор уведомлён`,
                      `${r.number} qabul qilindi. ${formatQty(r.shortageQty)} yetib kelmadi — kamomad yozildi, direktorga xabar berildi`));
      } else {
        notify.success(t(`${r.number} принято`, `${r.number} qabul qilindi`));
      }
      onDone();
      onClose();
    },
    onError: e => notify.error(errorText(e)),
  });

  const lostOf = (l: TransferDocLine) => Math.max(0, l.quantity - (Number(got[l.id]) || 0));
  const shortage = doc.lines.reduce((sum, l) => sum + lostOf(l), 0);
  const shortageCost = doc.lines.reduce((sum, l) => sum + lostOf(l) * Number(l.unitCost ?? 0), 0);
  const dirty = doc.lines.some(l => got[l.id] !== String(l.quantity));

  const submit = () => {
    for (const l of doc.lines) {
      const raw = (got[l.id] ?? "").trim();
      const n = Number(raw);
      if (raw === "" || !Number.isFinite(n) || n < 0) {
        return notify.error(t(`${l.productName}: укажите, сколько приехало`, `${l.productName}: qancha kelganini kiriting`));
      }
      if (n > l.quantity) {
        return notify.error(t(`${l.productName}: отправлено ${formatQty(l.quantity)} — больше принять нельзя`,
                              `${l.productName}: ${formatQty(l.quantity)} jo'natilgan — ko'pini qabul qilib bo'lmaydi`));
      }
    }
    receive.mutate({ docId: doc.id, lines: doc.lines.map(l => ({ lineId: l.id, receivedQuantity: Number(got[l.id]) })) });
  };

  return (
    <AppModal open onClose={onClose} dirty={dirty} maxWidth={640}
      title={t(`Принять ${doc.number}`, `${doc.number} ni qabul qilish`)} subtitle={route}
      footer={(
        <div className="flex gap-2 justify-end flex-wrap">
          <button className="neo-btn tap" onClick={onClose}>{t("Отмена", "Bekor")}</button>
          <button className="neo-btn-primary tap" onClick={submit} disabled={receive.isPending} data-testid="transfer-receive-confirm">
            {t("Принять", "Qabul qilish")}
          </button>
        </div>
      )}>
      <div style={{ overflowX: "auto" }}>
        <table className="w-full text-sm">
          <thead><tr>
            <th style={thStyle}>{t("Товар", "Mahsulot")}</th>
            <th style={{ ...thStyle, textAlign: "right" }}>{t("Отправлено", "Jo'natilgan")}</th>
            <th style={{ ...thStyle, width: 130 }}>{t("Приехало", "Keldi")}</th>
          </tr></thead>
          <tbody>
            {doc.lines.map(l => {
              const over = Number(got[l.id]) > l.quantity;
              return (
                <tr key={l.id} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600, color: COLORS.textPrimary }}>{l.productName}</div>
                    <div style={{ fontSize: 11.5, color: COLORS.textTertiary }}>
                      {l.batchNumber || l.expiresAt
                        ? `${l.batchNumber ?? t("без номера", "raqamsiz")}${l.expiresAt ? ` · ${t("до", "gacha")} ${dayText(l.expiresAt)}` : ""}`
                        : t("без партии", "partiyasiz")}
                    </div>
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatQty(l.quantity)} {unitShort(l.unit, lang)}</td>
                  <td style={tdStyle}>
                    <DecimalInput className="neo-input w-full font-data" value={got[l.id] ?? ""} data-testid={`receive-${l.id}`}
                      style={over ? { borderColor: "var(--color-danger)" } : undefined}
                      onValueChange={v => setGot(g => ({ ...g, [l.id]: v }))} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {shortage > 0 && (
        <p className="text-sm mt-3 rounded-xl px-3 py-2" data-testid="receive-shortage"
          style={{ color: "var(--color-warning-text)", background: "var(--color-warning-subtle)" }}>
          {t(`Не доехало ${formatQty(shortage)}${shortageCost > 0 ? ` на ${fmt(shortageCost)} по себестоимости` : ""} — останется недостачей на документе, директор получит уведомление.`,
             `${formatQty(shortage)} yetib kelmadi${shortageCost > 0 ? `, tannarx bo'yicha ${fmt(shortageCost)}` : ""} — hujjatda kamomad bo'lib qoladi, direktor xabar oladi.`)}
        </p>
      )}
    </AppModal>
  );
}
