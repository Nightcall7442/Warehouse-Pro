import { memo, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

/**
 * Поле поиска, которое печатается плавно на тяжёлой странице.
 *
 * Раньше строка поиска хранилась в состоянии самой страницы. Страница заказов —
 * это больше тысячи строк разметки с таблицей на полторы сотни заказов и ни
 * одной мемоизации, поэтому КАЖДАЯ набранная буква перерисовывала её целиком.
 * Между нажатиями появлялась пауза в доли секунды: набрать слово целиком было
 * невозможно, буквы терялись.
 *
 * Придерживание запроса (useDebouncedValue) эту беду не лечит — оно откладывает
 * поход на сервер, а перерисовка происходит от самого setState и остаётся на
 * каждую букву.
 *
 * Поэтому строка живёт здесь, внутри маленького компонента. Набор текста
 * перерисовывает только это поле; наверх значение уходит один раз, когда человек
 * перестал печатать. Страница узнаёт о поиске раз в 300 мс, а не тридцать раз за
 * слово.
 *
 * Компонент memo и не принимает ничего, что менялось бы каждый рендер, — иначе
 * родитель перерисовывал бы его обратно и всё вернулось бы к прежнему.
 */
export const SearchInput = memo(function SearchInput({
  placeholder,
  onSearch,
  initialValue = "",
  delayMs = 300,
  style,
  iconSize = 15,
  inputClassName,
  inputStyle,
  focusRing = false,
}: {
  placeholder: string;
  /** Вызывается придержанно — когда набор остановился. */
  onSearch: (value: string) => void;
  initialValue?: string;
  delayMs?: number;
  style?: React.CSSProperties;
  iconSize?: number;
  /** Оформление поля на конкретной странице — вид не должен меняться из-за переезда. */
  inputClassName?: string;
  inputStyle?: React.CSSProperties;
  /** Подсветка рамки при фокусе, как на странице склада. */
  focusRing?: boolean;
}) {
  const [value, setValue] = useState(initialValue);

  // Ссылка, а не зависимость эффекта: иначе новый onSearch на каждом рендере
  // родителя перезапускал бы таймер и придерживание не срабатывало бы никогда.
  const onSearchRef = useRef(onSearch);
  useEffect(() => { onSearchRef.current = onSearch; }, [onSearch]);

  const firstRender = useRef(true);
  useEffect(() => {
    // Не дёргаем родителя начальным значением: это вызвало бы лишний запрос
    // при каждом открытии страницы.
    if (firstRender.current) { firstRender.current = false; return; }

    // Пустое поле применяем сразу: человек, стеревший строку, хочет увидеть
    // полный список немедленно, а не через треть секунды.
    if (value === "") { onSearchRef.current(""); return; }

    const id = setTimeout(() => onSearchRef.current(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return (
    <div style={{ position: "relative", ...style }}>
      <Search
        size={iconSize}
        style={{
          position: "absolute", left: iconSize > 15 ? "14px" : "12px", top: "50%",
          transform: "translateY(-50%)", color: "var(--color-text-tertiary, #6b6760)",
          pointerEvents: "none",
        }}
      />
      <input
        className={inputClassName}
        style={inputStyle ?? {
          width: "100%", padding: "10px 12px 10px 36px", fontSize: "13px",
          fontFamily: "'DM Sans', sans-serif",
          borderRadius: "10px", border: "1px solid var(--color-border)",
          background: "var(--color-surface-light)", color: "var(--color-text-primary)",
          outline: "none",
        }}
        placeholder={placeholder}
        value={value}
        onChange={e => setValue(e.target.value)}
        onFocus={focusRing ? e => {
          e.currentTarget.style.borderColor = "var(--color-primary)";
          e.currentTarget.style.boxShadow = "0 0 0 4px color-mix(in srgb, var(--color-primary) 10%, transparent)";
          e.currentTarget.style.background = "var(--color-surface, #efedea)";
        } : undefined}
        onBlur={focusRing ? e => {
          e.currentTarget.style.borderColor = "transparent";
          e.currentTarget.style.boxShadow = "none";
          e.currentTarget.style.background = "var(--color-surface-light, #f6f4f0)";
        } : undefined}
      />
    </div>
  );
});
