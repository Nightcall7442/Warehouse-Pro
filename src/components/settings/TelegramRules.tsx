import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { Bell } from "lucide-react";

/**
 * Кому какие уведомления уходят в Telegram — решает директор.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Ничего. Человек привязывал Telegram, видел «успешно подключено» и не получал
 * ни одного сообщения: notifyUserById и notifyTenantRole не вызывались ниоткуда.
 * Единственным, кто что-то получал, был владелец платформы.
 *
 * ── Почему галочки уже стоят ────────────────────────────────────────────────
 *
 * Экран показывает СЛОЖЕННОЕ состояние: встроенные умолчания плюс изменения
 * директора. Пустая таблица с подписью «ничего не настроено» была бы враньём —
 * у организации, которая ничего не трогала, уведомления работают. И хуже того,
 * директор выключил бы то, чего не включал.
 */

const EVENT_LABEL: Record<string, { ru: string; uz: string; hint: { ru: string; uz: string } }> = {
  "order.created": {
    ru: "Новый заказ", uz: "Yangi buyurtma",
    hint: { ru: "Агент выписал заказ", uz: "Agent buyurtma yozdi" },
  },
  "stock.low": {
    ru: "Заканчивается товар", uz: "Mahsulot tugayapti",
    hint: { ru: "Остаток упал ниже точки заказа", uz: "Qoldiq buyurtma nuqtasidan pastga tushdi" },
  },
  "debt.overdue": {
    ru: "Просроченный долг", uz: "Muddati o'tgan qarz",
    hint: { ru: "Магазин не расплатился в срок", uz: "Do'kon muddatida to'lamadi" },
  },
  "delivery.assigned": {
    ru: "Назначена доставка", uz: "Yetkazish tayinlandi",
    hint: { ru: "Только назначенному курьеру", uz: "Faqat tayinlangan kuryerga" },
  },
};

const ROLE_LABEL: Record<string, { ru: string; uz: string }> = {
  ceo:          { ru: "Директор",    uz: "Direktor" },
  operator:     { ru: "Оператор",    uz: "Operator" },
  supervisor:   { ru: "Супервайзер", uz: "Supervayzer" },
  agent:        { ru: "Агент",       uz: "Agent" },
  merchandiser: { ru: "Мерчандайзер", uz: "Merchandayzer" },
  courier:      { ru: "Курьер",      uz: "Kuryer" },
};

const ROLES = ["ceo", "operator", "supervisor", "agent", "merchandiser", "courier"] as const;

export function TelegramRules() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const utils = trpc.useUtils();

  const { data: rules, isLoading } = trpc.telegram.rules.useQuery();
  const setRule = trpc.telegram.setRule.useMutation({
    onSuccess: () => utils.telegram.rules.invalidate(),
    onError: (e) => notify.error(e.message),
  });

  if (isLoading || !rules) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Bell size={16} style={{ color: "var(--color-primary-text)" }} />
        <h3 className="text-sm font-semibold text-primary">
          {t("Кому что приходит", "Kimga nima keladi")}
        </h3>
      </div>
      <p className="text-xs text-secondary">
        {t(
          "Сообщения уходят только тем, кто привязал Telegram. Ночью с 22:00 до 08:00 они копятся и приходят утром.",
          "Xabarlar faqat Telegramni ulaganlarga boradi. Kechasi 22:00 dan 08:00 gacha ular to'planib, ertalab keladi.",
        )}
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "540px" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "8px 10px", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-tertiary)" }}>
                {t("Событие", "Hodisa")}
              </th>
              {ROLES.map(r => (
                <th key={r} style={{ padding: "8px 6px", fontSize: "11px", color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>
                  {ROLE_LABEL[r][lang === "uz" ? "uz" : "ru"]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rules.map(row => {
              const label = EVENT_LABEL[row.event];
              return (
                <tr key={row.event} style={{ borderTop: "1px solid var(--color-border)" }}>
                  <td style={{ padding: "10px" }}>
                    <p className="text-sm text-primary" style={{ fontWeight: 500 }}>{label[lang === "uz" ? "uz" : "ru"]}</p>
                    <p className="text-xs text-tertiary">{label.hint[lang === "uz" ? "uz" : "ru"]}</p>
                  </td>
                  {ROLES.map(role => {
                    const on = row.roles.includes(role);
                    return (
                      <td key={role} style={{ textAlign: "center", padding: "10px 6px" }}>
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={setRule.isPending}
                          aria-label={`${label.ru} — ${ROLE_LABEL[role].ru}`}
                          onChange={e => setRule.mutate({ event: row.event, role, enabled: e.target.checked })}
                          style={{ width: "18px", height: "18px", accentColor: "var(--color-primary)", cursor: "pointer" }}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
