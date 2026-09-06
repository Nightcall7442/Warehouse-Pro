import { LogoMark } from "./Logo";
import { useAppBrand } from "@/hooks/useAppBrand";

/**
 * Вывеска приложения: чья она — арендатора или поставщика.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Знак и название стояли литералами в шапке, в выдвижном меню, на входе, при
 * регистрации и в предложении установить приложение. Арендатор мог загрузить
 * свой логотип — его не показывали нигде, кроме предпросмотра в самих
 * настройках, — и задать название приложения, которое доходило только до
 * заголовка вкладки.
 *
 * ── Правило ─────────────────────────────────────────────────────────────────
 *
 * Есть знак арендатора — показываем его. Нет — знак системы. То же с
 * названием. Одно место на всё приложение, поэтому забыть подставить бренд
 * на новом экране нельзя: экран берёт вывеску отсюда, а не рисует свою.
 *
 * Витрина самого продукта (лендинг, регистрация нового арендатора) вывеску
 * отсюда НЕ берёт и не должна: там продаёт себя поставщик.
 */

type Props = {
  size?: number;
  onDark?: boolean;
  className?: string;
  /** Экран до входа берёт вывеску из памяти устройства, а не с сервера. */
  signedIn?: boolean;
  /** Только знак, без надписи. */
  markOnly?: boolean;
  /** Цвет надписи; по умолчанию — из темы. */
  color?: string;
};

export function AppBrand({ size = 36, onDark = false, className, signedIn = true, markOnly = false, color }: Props) {
  const { logoUrl, name } = useAppBrand(signedIn);

  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.3) }}>
      {logoUrl
        ? <img src={logoUrl} alt="" width={size} height={size} style={{ objectFit: "contain", borderRadius: Math.round(size * 0.22), flexShrink: 0 }} />
        : <LogoMark size={size} onDark={onDark} decorative />}
      {!markOnly && (
        <span style={{
          fontSize: `${Math.round(size * 0.44)}px`,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          color: color ?? "var(--color-text-primary, #2b2a28)",
          whiteSpace: "nowrap",
        }}>
          {name}
        </span>
      )}
    </span>
  );
}
