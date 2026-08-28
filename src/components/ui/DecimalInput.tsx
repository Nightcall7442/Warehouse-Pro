import * as React from "react";
import { normalizeDecimalInput } from "@/lib/decimal-input";

/**
 * Поле для цены, суммы, веса и количества.
 *
 * Отличие от type="number" в том, что введённое не пропадает. Браузер с
 * русской локалью на «12,5» отдаёт пустую строку и не считает это ошибкой —
 * см. lib/decimal-input.ts. Здесь запятая просто становится точкой.
 *
 * inputMode="decimal" оставляет на телефоне цифровую клавиатуру, а type="text"
 * не даёт браузеру вмешиваться в содержимое поля.
 */
type Props = Omit<React.ComponentProps<"input">, "type" | "onChange" | "value"> & {
  value: string;
  /** Получает уже приведённое значение: с точкой, без пробелов. */
  onValueChange: (value: string) => void;
};

export function DecimalInput({ value, onValueChange, ...props }: Props) {
  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={value}
      onChange={e => onValueChange(normalizeDecimalInput(e.target.value))}
    />
  );
}
