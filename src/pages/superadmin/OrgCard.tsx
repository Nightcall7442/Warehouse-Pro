import { Link, Navigate, useNavigate, useParams } from "react-router";
import { ArrowLeft, Mail, Phone, Building2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { formatUzPhone } from "@contracts/signup";
import { endsAt, daysLeft, statusOf } from "@/components/superadmin/console/orgs";
import { AccessTab, DangerTab, JournalTab, OverviewTab, SubscriptionTab, UsersTab } from "@/components/superadmin/console/OrgTabs";
import { rowFromDetail } from "@/components/superadmin/console/detail";
import { day } from "@/components/superadmin/console/format";
import { Empty, Loading, Pill, PlanPill, TabBar } from "@/components/superadmin/console/ui";

/* ═══════════════════════════════════════════════════════════════════════════
   Карточка организации — /super-admin/orgs/:id/:tab.

   Была: TenantDetail подменял страницу суперадмина через состояние — своей
   ссылки нет, «назад» в браузере уводил с сайта, обновление страницы
   выбрасывало в общий список. Подписка, приостановка, удаление и уборка
   журнала стояли одним рядом кнопок, люди и права — ниже, стопкой.

   Стала: свой адрес у карточки и у каждой вкладки (ссылкой можно поделиться,
   «назад» возвращает в отфильтрованный список), шапка с контактами владельца
   ссылками, вкладки «Обзор», «Подписка», «Пользователи», «Права», «Журнал»,
   «Опасная зона».
   ═══════════════════════════════════════════════════════════════════════════ */

export const ORG_TABS = [
  { key: "overview",     label: "Обзор" },
  { key: "subscription", label: "Подписка" },
  { key: "users",        label: "Пользователи" },
  { key: "access",       label: "Права" },
  { key: "journal",      label: "Журнал" },
  { key: "danger",       label: "Опасная зона", tone: "danger" as const },
] as const;
type TabKey = (typeof ORG_TABS)[number]["key"];
const isTab = (v: string | undefined): v is TabKey => ORG_TABS.some(t => t.key === v);

export default function OrgCard() {
  const { id: idParam, tab: tabParam } = useParams();
  const navigate = useNavigate();
  const id = Number(idParam);
  const valid = Number.isInteger(id) && id > 0;
  const utils = trpc.useUtils();

  const detail = trpc.tenant.getDetail.useQuery({ tenantId: id }, { enabled: valid, retry: false });
  const list = trpc.tenant.list.useQuery(undefined, { enabled: valid });
  const usage = trpc.tenant.featureUsage.useQuery(undefined, { enabled: valid && (tabParam === undefined || tabParam === "overview") });

  if (!valid) return <Navigate to="/super-admin/orgs" replace />;
  if (tabParam !== undefined && !isTab(tabParam)) return <Navigate to={`/super-admin/orgs/${id}`} replace />;
  const tab: TabKey = tabParam ?? "overview";

  const changed = () => {
    void detail.refetch();
    void utils.tenant.list.invalidate();
    void utils.tenant.platformStats.invalidate();
    void utils.tenant.ownerPanel.invalidate();
  };

  if (detail.isLoading) return <Loading />;
  if (!detail.data) {
    return (
      <div className="neo-card neo-card-static" style={{ padding: 0, borderRadius: 20 }}>
        <Empty icon={Building2} title="Организация не найдена" hint="Её могли удалить. Вернитесь к списку организаций." />
      </div>
    );
  }

  const d = detail.data;
  const t = d.tenant;
  const row = list.data?.find(o => o.id === id);
  const base = row ?? rowFromDetail(d);
  const st = statusOf(base);
  const ends = endsAt(base);
  const left = daysLeft(base);
  const phone = row?.contactPhone ?? t.ownerPhone;
  const email = row?.contactEmail ?? t.ownerEmail;

  return (
    <div data-testid="org-card-page">
      <Link to="/super-admin/orgs" className="hidden md:inline-flex items-center gap-1.5"
        style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)", textDecoration: "none", minHeight: 44 }}>
        <ArrowLeft size={15} /> Организации
      </Link>

      {/* ── Шапка ─────────────────────────────────────────────────────────── */}
      <header className="neo-card neo-card-static" style={{ padding: 18, borderRadius: 22, marginBottom: 14 }} data-testid="org-header">
        <div className="flex items-start gap-3.5">
          <span className="flex items-center justify-center flex-shrink-0" style={{ width: 52, height: 52, borderRadius: 16, background: "var(--color-primary-subtle)", color: "var(--color-primary-text)", fontWeight: 800, fontSize: 22 }}>
            {t.name.trim()[0]?.toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", margin: 0, color: "var(--color-text-primary)", overflowWrap: "anywhere", lineHeight: 1.2 }} data-testid="org-name">{t.name}</h1>
            <div style={{ fontSize: 13, color: "var(--color-text-tertiary)", marginTop: 3 }}>
              {t.slug}{row?.inn ? ` · ИНН ${row.inn}` : ""} · с {day(t.createdAt)}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap" style={{ marginTop: 10 }}>
              <PlanPill plan={base.subscription?.plan ?? t.plan} />
              {/* «Пробный» уже сказан тарифом — второй такой же метки не нужно. */}
              {st.label !== "Пробный" && <Pill tone={st.tone}>{st.label}</Pill>}
              <Pill tone={left !== null && left <= (base.segment.trial ? 3 : 14) ? (left <= 0 ? "danger" : "warning") : "neutral"}>
                {ends ? `до ${day(ends)} · ${left !== null && left <= 0 ? "истёк" : `${left} дн.`}` : "бессрочно"}
              </Pill>
            </div>
          </div>
        </div>
        {/* Контакты владельца — ссылками: нажал и звонишь или пишешь. */}
        <div className="flex gap-2 flex-wrap" style={{ marginTop: 14 }}>
          {phone ? (
            <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="neo-btn" data-testid="org-phone"
              style={{ minHeight: 44, padding: "0 14px", fontSize: 13.5, color: "var(--color-primary-text)", textDecoration: "none", fontVariantNumeric: "tabular-nums" }}>
              <Phone size={15} /> {formatUzPhone(phone)}
            </a>
          ) : <span className="inline-flex items-center" style={{ minHeight: 44, fontSize: 13, color: "var(--color-text-tertiary)" }}>телефона нет</span>}
          {email && (
            <a href={`mailto:${email}`} className="neo-btn" data-testid="org-email"
              style={{ minHeight: 44, padding: "0 14px", fontSize: 13.5, color: "var(--color-text-primary)", textDecoration: "none", maxWidth: "100%" }}>
              <Mail size={15} className="flex-shrink-0" /> <span className="truncate">{email}</span>
            </a>
          )}
        </div>
      </header>

      <div style={{ marginBottom: 16 }}>
        <TabBar testId="org-tabs" active={tab}
          tabs={ORG_TABS.map(x => ({ key: x.key, label: x.label, to: x.key === "overview" ? `/super-admin/orgs/${id}` : `/super-admin/orgs/${id}/${x.key}`, tone: "tone" in x ? x.tone : undefined }))} />
      </div>

      {tab === "overview" && <OverviewTab d={d} row={row} usage={usage.data?.find(u => u.tenantId === id)} />}
      {tab === "subscription" && <SubscriptionTab key={`${t.id}:${t.updatedAt?.toString()}`} d={d} onChanged={changed} />}
      {tab === "users" && <UsersTab d={d} onChanged={changed} />}
      {tab === "access" && <AccessTab d={d} />}
      {tab === "journal" && <JournalTab d={d} />}
      {tab === "danger" && <DangerTab d={d} onChanged={changed} onGone={() => { changed(); navigate("/super-admin/orgs", { replace: true }); }} />}
    </div>
  );
}
