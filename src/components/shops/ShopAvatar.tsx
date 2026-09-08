import { Store } from "lucide-react";
import { shopTile, shopInitials } from "@/lib/shop-avatar";

/**
 * Плашка магазина без фотографии.
 *
 * Цвет выводится из номера точки и потому не меняется никогда: человек
 * запоминает плашку и находит нужную строку взглядом, а не вчитыванием.
 * Инициалы различают точки между собой, значок лавки остаётся водяным знаком —
 * чтобы плашка читалась как «фото магазина», а не как аватар человека.
 */
export function ShopAvatar({ id, name, size }: { id: number; name: string; size: number }) {
  const [from, to] = shopTile(id);
  const initials = shopInitials(name);

  return (
    <div
      aria-hidden
      style={{
        width: "100%", height: "100%", position: "relative", overflow: "hidden",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: `linear-gradient(140deg, ${from} 0%, ${to} 100%)`,
      }}
    >
      {/* Водяной знак: лавка крупно и почти прозрачно, сдвинута в угол —
          читается как фактура, а не как второй значок поверх первого. */}
      <Store
        size={Math.round(size * 0.92)}
        color="#fff"
        strokeWidth={1.25}
        style={{ position: "absolute", right: `-${Math.round(size * 0.22)}px`, bottom: `-${Math.round(size * 0.24)}px`, opacity: 0.16 }}
      />

      {initials
        ? (
          <span style={{
            position: "relative",
            color: "#fff",
            fontWeight: 700,
            fontSize: `${Math.round(size * 0.36)}px`,
            letterSpacing: "0.01em",
            // Тень под буквами: заливка светлая у верхнего края, и без неё
            // белое на янтарном теряет контраст.
            textShadow: "0 1px 3px rgba(0,0,0,0.28)",
          }}>
            {initials}
          </span>
        )
        : <Store size={Math.round(size * 0.42)} color="#fff" style={{ position: "relative", opacity: 0.9 }} />}
    </div>
  );
}
