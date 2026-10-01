import { FlaskConical } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { SandboxSection } from "@/components/superadmin/SandboxSection";
import { Line, PageHead, Panel, Row } from "@/components/superadmin/console/ui";
import { ago, day } from "@/components/superadmin/console/format";

/*
  «Интеграторы» — песочницы для партнёров, подключающих выгрузку заказов
  (/super-admin/sandboxes). Раньше здесь была только форма создания внизу
  общей страницы, а уже выданные песочницы терялись среди организаций: в
  общем списке их не отличить. Теперь они перечислены рядом с формой.
*/
export default function Sandboxes() {
  const { data } = trpc.tenant.list.useQuery();
  const sandboxes = (data ?? []).filter(o => o.isSandbox)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return (
    <div>
      <PageHead title="Интеграторы" subtitle="Песочницы с выдуманными данными: партнёр проверяет выгрузку заказов, не касаясь боевых." />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start">
        <SandboxSection />
        <Panel title="Выданные песочницы" count={data ? sandboxes.length : undefined} flush testId="sandbox-list">
          {sandboxes.length === 0
            ? <p style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: 0, padding: "4px 20px 14px" }}>{data ? "Песочниц пока нет." : "Загрузка…"}</p>
            : (
              <>
                {sandboxes.map((o, i) => (
                  <div key={o.id}>
                    {i > 0 && <Line />}
                    <Row icon={FlaskConical} tone="info" title={o.name} to={`/super-admin/orgs/${o.id}`}
                      subtitle={`с ${day(o.createdAt)} · ${o.contactEmail ?? o.slug} · активность ${ago(o.lastActivityAt)}`} />
                  </div>
                ))}
              </>
            )}
        </Panel>
      </div>
    </div>
  );
}
