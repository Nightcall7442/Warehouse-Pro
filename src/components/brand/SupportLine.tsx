import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";

/**
 * Куда звонить, когда сломалось.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Почта и телефон поддержки в «Брендинге» сохранялись исправно и не
 * показывались НИ НА ОДНОМ экране. Владелец заполнял два поля, чтобы его люди
 * знали, куда обращаться, — и его люди этого не видели. Настройка, которая
 * ничего не меняет, хуже отсутствующей.
 *
 * ── Почему внизу меню ───────────────────────────────────────────────────────
 *
 * Искать телефон идут тогда, когда экран уже не работает как надо. Значит он
 * должен лежать там, где человек бывает каждый день и куда попадает из любого
 * места, — в подвале меню, рядом с выходом. Ссылки настоящие: с телефона по
 * номеру звонят, а не переписывают его на бумажку.
 */
export function SupportLine() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { data } = trpc.branding.get.useQuery();

  const phone = data?.supportPhone?.trim();
  const email = data?.supportEmail?.trim();
  const footer = data?.footerText?.trim();

  if (!phone && !email && !footer) return null;

  const link = { color: "var(--color-primary-text)", textDecoration: "none" };

  return (
    <div style={{ paddingTop: "10px", fontSize: "11px", lineHeight: 1.5, color: "var(--color-text-tertiary)" }}>
      {(phone || email) && (
        <div>
          {t("Поддержка", "Qo'llab-quvvatlash")}:{" "}
          {phone && <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} style={link}>{phone}</a>}
          {phone && email && " · "}
          {email && <a href={`mailto:${email}`} style={link}>{email}</a>}
        </div>
      )}
      {footer && <div style={{ marginTop: "4px" }}>{footer}</div>}
    </div>
  );
}
