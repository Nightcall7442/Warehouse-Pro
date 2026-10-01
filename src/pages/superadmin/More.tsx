import { Inbox, Activity, FlaskConical, Bell, User, Moon, Sun, LogOut, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { useConfirm } from "@/components/ConfirmDialog";
import { useConsoleBadges } from "@/components/superadmin/console/badges";
import { Count, Group, GroupLabel, Line, Row } from "@/components/superadmin/console/ui";

/*
  «Ещё» — четвёртая вкладка консоли на телефоне (/super-admin/more): разделы,
  которым не хватило места внизу, и аккаунт — кто вошёл, тема, выход. На
  компьютере всё это в боковой колонке, но адрес работает и там.
*/
export default function More() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const badges = useConsoleBadges();
  const { confirm, dialog } = useConfirm();
  const totpOn = Boolean((user as { totpEnabledAt?: unknown } | null)?.totpEnabledAt);

  return (
    <div className="flex flex-col gap-5" style={{ maxWidth: 640 }} data-testid="console-more">
      {dialog}
      <div>
        <GroupLabel>Разделы</GroupLabel>
        <Group>
          <Row icon={Inbox} tone="primary" title="Заявки" subtitle="С сайта: ждут звонка" to="/super-admin/leads" testId="more-leads"
            right={badges.leads > 0 ? <Count n={badges.leads} tone="danger" /> : undefined} />
          <Line />
          <Row icon={Activity} tone="primary" title="Система" subtitle="Сервер, фоновые задачи, резервная копия" to="/super-admin/system" testId="more-system" />
          <Line />
          <Row icon={FlaskConical} tone="primary" title="Интеграторы" subtitle="Песочницы для партнёров" to="/super-admin/sandboxes" testId="more-sandboxes" />
          <Line />
          <Row icon={Bell} tone="primary" title="Уведомления" subtitle="Тревоги сервера" to="/notifications" testId="more-notifications" />
        </Group>
      </div>

      <div>
        <GroupLabel>Аккаунт</GroupLabel>
        <Group>
          <Row icon={User} tone="primary" title={user?.name ?? "Владелец платформы"} subtitle={user?.email} to="/settings?section=profile" testId="more-profile" />
          <Line />
          <Row icon={ShieldCheck} tone={totpOn ? "success" : "warning"} title="Вход с кодом из приложения" subtitle={totpOn ? "Включён" : "Выключен — без него закрыты удаление организаций и выгрузка базы"}
            to="/settings?section=profile&block=totp" testId="more-totp" />
          <Line />
          <Row icon={theme === "dark" ? Sun : Moon} title={theme === "dark" ? "Светлая тема" : "Тёмная тема"} onClick={toggle} testId="more-theme" />
          <Line />
          <Row icon={LogOut} danger title="Выйти" testId="more-logout"
            onClick={async () => { if (await confirm({ title: "Выйти из консоли?", message: "Чтобы вернуться, понадобится войти заново.", confirmText: "Выйти" })) void logout(); }} />
        </Group>
      </div>
    </div>
  );
}
