import { Plus, X } from "lucide-react";
import { MAX_EXTRA_BARCODES } from "@contracts/product-barcodes";

/**
 * Дополнительные штрих-коды товара — в форме нового товара и в правке карточки.
 *
 * Тот же товар приходит с разными этикетками: другой поставщик, блок и
 * пачка, новая партия. Основной штрих-код — отдельным полем рядом (его
 * печатают этикетки); здесь — остальные, по которым сканер тоже находит
 * товар. Пустые поля и повторы сервер отбрасывает сам, а код, уже стоящий у
 * другого товара, отклоняет с названием этого товара.
 */
export function ExtraBarcodesEditor({ lang, value, onChange }: {
  lang: string; value: string[]; onChange: (next: string[]) => void;
}) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const set = (i: number, code: string) => onChange(value.map((v, k) => (k === i ? code : v)));
  return (
    <div style={{ gridColumn: "1 / -1" }} data-testid="product-extra-barcodes">
      <div className="text-xs text-secondary mb-1.5">{t("Дополнительные штрих-коды", "Qo'shimcha shtrix-kodlar")}</div>
      <div className="flex flex-wrap items-center gap-2">
        {value.map((code, i) => (
          <div key={i} className="flex items-center gap-1">
            <input className="neo-input font-data" style={{ width: "180px" }} maxLength={100} autoComplete="off"
              aria-label={t(`Дополнительный штрих-код ${i + 1}`, `Qo'shimcha shtrix-kod ${i + 1}`)}
              data-testid={`product-extra-barcode-${i}`}
              value={code} onChange={e => set(i, e.target.value)} />
            <button type="button" className="neo-btn" style={{ padding: "6px" }}
              aria-label={t("Убрать штрих-код", "Shtrix-kodni olib tashlash")}
              onClick={() => onChange(value.filter((_, k) => k !== i))}>
              <X size={14} />
            </button>
          </div>
        ))}
        {value.length < MAX_EXTRA_BARCODES && (
          <button type="button" className="neo-btn flex items-center gap-1.5 text-sm" data-testid="product-extra-barcode-add"
            onClick={() => onChange([...value, ""])}>
            <Plus size={14} />{t("Ещё штрих-код", "Yana shtrix-kod")}
          </button>
        )}
      </div>
      <p className="text-xs text-secondary mt-1.5">
        {t("Другая этикетка того же товара — другой поставщик, блок или пачка. Сканер найдёт товар по любому из кодов.",
          "Shu mahsulotning boshqa yorlig'i — boshqa yetkazib beruvchi, blok yoki pachka. Skaner mahsulotni istalgan kod bo'yicha topadi.")}
      </p>
    </div>
  );
}
