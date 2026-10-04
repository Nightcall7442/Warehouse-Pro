import { useState } from "react";
import { Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useMoney } from "./use-money";
import { notify } from "@/lib/toast";
import { normalizeDecimalInput } from "@/lib/decimal-input";
import { formatQty } from "@/lib/format";
import { discountMoney, discountedPrice } from "@contracts/expiry";
import { AppModal, modalFieldLabel } from "@/components/ui/AppModal";
import type { ExpiryRowView } from "./expiry-view";
import { errorText } from "@/lib/error-text";

/*
  Уценка партии — одно окно: скидка или цена (одно считает другое), что
  будет с деньгами и для кого действует.

  Директор видит закупку: маржу после скидки или «ниже закупки на …» с
  честным сравнением — списать значит потерять закупку целиком, продать в
  минус — вернуть часть. Решает он; окно не запрещает, а показывает.
  Оператор закупки не видит; цену ниже неё сервер у него не примет
  (price-list-router setMarkdown) и скажет почему.
*/
export function MarkdownDialog({ row, seesCost, onClose }: { row: ExpiryRowView; seesCost: boolean; onClose: () => void }) {
  const { lang } = useLang();
  const fmt = useMoney();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const utils = trpc.useUtils();

  const startPct = row.advice?.pct ?? 10;
  const [pct, setPct] = useState(String(startPct));
  const [price, setPrice] = useState(String(row.advice?.price ?? discountedPrice(row.price, startPct)));

  const numPrice = Number(price) || 0;
  const valid = numPrice > 0 && numPrice < row.price;
  const money = seesCost && row.costPrice != null ? discountMoney(numPrice, row.costPrice, row.unsold) : null;

  const set = trpc.priceList.setMarkdown.useMutation({
    onSuccess: () => {
      utils.warehouseReports.expiring.invalidate();
      utils.warehouseReports.expiringSummary.invalidate();
      utils.product.listAll.invalidate();
      notify.success(t("Уценка поставлена — агенты видят «Продать первым»", "Arzonlashtirildi — agentlar «Birinchi sotish»ni ko'radi"));
      onClose();
    },
    onError: (e) => notify.error(errorText(e)),
  });

  const onPct = (raw: string) => {
    const v = normalizeDecimalInput(raw);
    setPct(v);
    const n = Number(v);
    if (n > 0 && n < 100) setPrice(String(discountedPrice(row.price, n)));
  };
  const onPrice = (raw: string) => {
    const v = normalizeDecimalInput(raw);
    setPrice(v);
    const n = Number(v);
    if (n > 0 && row.price > 0) setPct(String(Math.round((1 - n / row.price) * 1000) / 10));
  };

  const until = row.expiresAt.split("-").reverse().join(".");
  const unit = row.unitLabel;

  return (
    <AppModal open onClose={onClose} maxWidth={460}
      title={t("Уценить партию", "Partiyani arzonlashtirish")} subtitle={row.productName ?? ""}
      footer={<>
        <button type="button" onClick={onClose} className="neo-btn tap flex-1">{t("Отмена", "Bekor")}</button>
        <button type="button" data-testid="markdown-submit"
          onClick={() => valid && set.mutate({ batchId: row.batchId, price: numPrice })}
          disabled={!valid || set.isPending}
          className="neo-btn-primary tap flex-1 flex items-center justify-center gap-2 disabled:opacity-40">
          {set.isPending && <Loader2 size={16} className="animate-spin" />}
          {t("Уценить", "Arzonlashtirish")}
        </button>
      </>}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={modalFieldLabel} htmlFor="md-pct">{t("Скидка, %", "Chegirma, %")}</label>
          <input id="md-pct" className="neo-input w-full font-data tap" inputMode="decimal" value={pct} onChange={e => onPct(e.target.value)} data-testid="markdown-pct" />
        </div>
        <div>
          <label className={modalFieldLabel} htmlFor="md-price">{t("Цена за", "Narx:")} {unit}</label>
          <input id="md-price" className="neo-input w-full font-data tap" inputMode="decimal" value={price} onChange={e => onPrice(e.target.value)} data-testid="markdown-price" />
        </div>
      </div>

      <p className="font-data" style={{ fontSize: 14, marginTop: 14, color: "var(--color-text-secondary)" }}>
        <span style={{ textDecoration: "line-through", color: "var(--color-text-tertiary)" }}>{fmt(row.price)}</span>
        {" → "}
        <b style={{ color: "var(--color-text-primary)" }}>{fmt(numPrice)}</b>
      </p>
      {!valid && numPrice > 0 && (
        <p style={{ fontSize: 13, color: "var(--color-danger-text)", marginTop: 6 }}>{t("Уценка — это цена ниже цены карточки", "Arzonlashtirish — kartochka narxidan past narx")}</p>
      )}

      {money && money.costKnown && valid && (
        money.belowCost ? (
          <div className="rounded-xl" style={{ marginTop: 12, padding: 12, background: "var(--color-warning-subtle)", fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.5 }} data-testid="markdown-below-cost">
            <b style={{ color: "var(--color-warning-text)" }}>{t("Ниже закупки", "Xariddan past")}</b>{" "}
            {t(`на ${fmt(-money.unitMargin)} за ${unit}.`, `${unit} uchun ${fmt(-money.unitMargin)} ga.`)}{" "}
            {t(`Списать остаток ${formatQty(row.unsold)} ${unit} — потерять ${fmt(money.writeOff)}. Продать по этой цене — вернуть ${fmt(money.recovered)}. Решать вам.`,
               `Qolgan ${formatQty(row.unsold)} ${unit} ni hisobdan chiqarish — ${fmt(money.writeOff)} yo'qotish. Shu narxda sotish — ${fmt(money.recovered)} qaytarish. Qaror sizda.`)}
          </div>
        ) : (
          <p style={{ fontSize: 13, marginTop: 12, color: "var(--color-success-text)" }}>
            {t(`Маржа после скидки: ${fmt(money.unitMargin)} за ${unit}`, `Chegirmadan keyingi marja: ${unit} uchun ${fmt(money.unitMargin)}`)}
          </p>
        )
      )}

      <p style={{ fontSize: 12, marginTop: 14, color: "var(--color-text-tertiary)", lineHeight: 1.55 }}>
        {t(`Цена для всех магазинов до ${until} или пока партия не продана — потом вернётся сама. Кому по прайс-листу и так дешевле, останется дешевле. Агенты увидят товар с пометкой «Продать первым».`,
           `Narx barcha do'konlar uchun ${until} gacha yoki partiya sotilguncha — keyin o'zi qaytadi. Narxlar ro'yxati bo'yicha arzonroq bo'lganlarga arzonroq qoladi. Agentlar tovarni «Birinchi sotish» belgisi bilan ko'radi.`)}
      </p>
    </AppModal>
  );
}
