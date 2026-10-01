import { useState } from "react";
import { Info, AlertTriangle, X } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useLang } from "@/i18n";
import { localized } from "@/components/announcement-text";

/* ═══════════════════════════════════════════════════════════════════════════
   Объявление платформы — полоса вверху приложения организации.

   Пишет владелец платформы в консоли (/super-admin/announcements); кому и
   на какой срок — решает он же, сервер отдаёт только адресованные этой
   организации и не закрытые этим человеком (api/services/announcements.ts).

   Язык — как у остального интерфейса пользователя (useLang): узбекский, если
   у объявления есть узбекский текст, иначе русский. Закрытие хранится на
   сервере: директор, закрывший полосу на телефоне, не увидит её и на
   компьютере, а его оператор — увидит, пока не закроет сам.

   Суперадмину полосы нет: у него своя оболочка (ConsoleShell), и это его же
   сообщения. Предпросмотр в консоли рисует тот же AnnouncementView.
   ═══════════════════════════════════════════════════════════════════════════ */

export type AnnouncementLevel = "info" | "warning";

const LOOK: Record<AnnouncementLevel, { bg: string; fg: string; icon: typeof Info }> = {
  info:    { bg: "var(--color-primary-subtle)", fg: "var(--color-primary-text)", icon: Info },
  warning: { bg: "var(--color-warning-subtle)", fg: "var(--color-warning-text)", icon: AlertTriangle },
};

/** Сама полоса — без запросов: её же показывает предпросмотр в консоли. */
export function AnnouncementView({ level, title, body, onClose, closeLabel, testId }: {
  level: AnnouncementLevel; title: string; body: string; onClose?: () => void; closeLabel: string; testId?: string;
}) {
  const look = LOOK[level];
  const Icon = look.icon;
  return (
    <div role="status" data-testid={testId} data-level={level} className="flex items-start gap-3"
      style={{ padding: "12px 8px 12px 14px", borderRadius: 18, background: look.bg, boxShadow: "var(--shadow-sm)" }}>
      <span className="flex items-center justify-center flex-shrink-0" style={{ width: 32, height: 32, borderRadius: 10, background: "var(--color-surface)", marginTop: 2 }}>
        <Icon size={17} color={look.fg} />
      </span>
      <div className="min-w-0 flex-1" style={{ paddingTop: 2 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-primary)", lineHeight: 1.35, overflowWrap: "anywhere" }} data-testid="announcement-title">{title}</div>
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.5, marginTop: 2, whiteSpace: "pre-line", overflowWrap: "anywhere" }} data-testid="announcement-body">{body}</div>
      </div>
      {onClose && (
        <button type="button" onClick={onClose} aria-label={closeLabel} title={closeLabel} data-testid="announcement-close"
          className="flex items-center justify-center flex-shrink-0" style={{ width: 44, height: 44, borderRadius: 12, color: "var(--color-text-tertiary)" }}>
          <X size={18} />
        </button>
      )}
    </div>
  );
}

export function AnnouncementBanner() {
  const { user } = useAuth();
  const { lang } = useLang();
  const enabled = Boolean(user) && user?.role !== "superadmin";
  const { data } = trpc.announcement.active.useQuery(undefined, { enabled, staleTime: 60_000, refetchInterval: 5 * 60_000 });
  // Закрытое прячется сразу, не дожидаясь ответа: человек нажал — полосы нет.
  const [hidden, setHidden] = useState<Set<number>>(() => new Set());
  const dismiss = trpc.announcement.dismiss.useMutation();

  const shown = (data ?? []).filter(a => !hidden.has(a.id));
  if (!enabled || shown.length === 0) return null;
  const closeLabel = lang === "uz" ? "Yopish" : "Закрыть";

  return (
    <div className="flex flex-col gap-2 px-5 md:px-6 pt-3 md:pt-5" data-testid="announcements">
      {shown.slice(0, 3).map(a => {
        const text = localized(a, lang);
        return (
          <AnnouncementView key={a.id} level={a.level} title={text.title} body={text.body} closeLabel={closeLabel} testId="announcement"
            onClose={() => { setHidden(h => new Set(h).add(a.id)); dismiss.mutate({ id: a.id }); }} />
        );
      })}
    </div>
  );
}
