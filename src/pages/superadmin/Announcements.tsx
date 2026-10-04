import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Megaphone, Plus, X } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../api/router";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { PremiumSelect } from "@/components/PremiumSelect";
import { AnnouncementView, type AnnouncementLevel } from "@/components/AnnouncementBanner";
import { localized } from "@/components/announcement-text";
import { TENANT_PLAN_LABEL } from "@contracts/entity-labels";
import { Chip, Empty, FieldLabel, PageHead, Panel, Pill, type Tone } from "@/components/superadmin/console/ui";
import { dayTime } from "@/components/superadmin/console/format";
import { errorText } from "@/lib/error-text";

/* ═══════════════════════════════════════════════════════════════════════════
   «Объявления» — сообщения платформы организациям (/super-admin/announcements).

   ── Что было ────────────────────────────────────────────────────────────────

   Сказать клиентам «в субботу ночью обновление» можно было только письмом
   каждому директору в Telegram; агенты и операторы об этом не узнавали.

   ── Что теперь ──────────────────────────────────────────────────────────────

   Заголовок и текст по-русски (по желанию и по-узбекски), уровень
   «информация / внимание», кому — всем, по тарифу или выбранным, срок показа.
   Предпросмотр — та же полоса, что увидит директор (AnnouncementView), на
   обоих языках. Список: идут, запланированы, прошедшие; «Завершить сейчас».
   ═══════════════════════════════════════════════════════════════════════════ */

type Row = inferRouterOutputs<AppRouter>["platform"]["announcements"][number];
type Audience = "all" | "plans" | "tenants";
const PLANS = ["trial", "basic", "pro", "exclusive"] as const;
const input = { minHeight: 44, fontSize: 14 } as const;
const HOUR = 3_600_000;

/** Для <input type="datetime-local">: местное время без секунд. */
function toLocalInput(d: Date): string {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return z.toISOString().slice(0, 16);
}

function stateOf(a: Row, now: Date): { key: "live" | "scheduled" | "past"; label: string; tone: Tone } {
  if (a.endedAt) return { key: "past", label: "Завершено", tone: "neutral" };
  if (a.endsAt && new Date(a.endsAt) <= now) return { key: "past", label: "Срок вышел", tone: "neutral" };
  if (new Date(a.startsAt) > now) return { key: "scheduled", label: "Запланировано", tone: "info" };
  return { key: "live", label: "Идёт", tone: "success" };
}

export default function Announcements() {
  const [params, setParams] = useSearchParams();
  const creating = params.get("new") === "1";
  const setCreating = (on: boolean) => setParams(prev => { const n = new URLSearchParams(prev); if (on) n.set("new", "1"); else n.delete("new"); return n; }, { replace: true });
  const list = trpc.platform.announcements.useQuery();
  const orgs = trpc.tenant.list.useQuery();
  const names = useMemo(() => new Map((orgs.data ?? []).map(o => [o.id, o.name])), [orgs.data]);
  const now = new Date();
  const groups = useMemo(() => {
    const g = { live: [] as Row[], scheduled: [] as Row[], past: [] as Row[] };
    for (const a of list.data ?? []) g[stateOf(a, new Date()).key].push(a);
    return g;
  }, [list.data]);

  return (
    <div data-testid="console-announcements">
      <PageHead title="Объявления" subtitle="Полоса вверху приложения у организаций — на их языке, пока не выйдет срок или человек её не закроет."
        actions={!creating && (
          <button type="button" className="neo-btn-primary" style={{ minHeight: 44 }} onClick={() => setCreating(true)} data-testid="announcement-new">
            <Plus size={17} /> Новое объявление
          </button>
        )} />

      {creating && <CreateForm onDone={() => setCreating(false)} />}

      {list.isLoading ? (
        <div className="neo-card neo-card-static" style={{ padding: 20, borderRadius: 20 }}>
          {[0, 1, 2].map(i => <div key={i} style={{ height: 18, borderRadius: 8, background: "var(--color-surface-light)", margin: "12px 0" }} />)}
        </div>
      ) : (list.data ?? []).length === 0 ? (
        <div className="neo-card neo-card-static" style={{ padding: 0, borderRadius: 20 }}>
          <Empty icon={Megaphone} title="Объявлений ещё не было" hint="Например: «В субботу с 23:00 до 23:30 обновление, работа не прервётся» — всем организациям на сутки." />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {(["live", "scheduled", "past"] as const).filter(k => groups[k].length > 0).map(k => (
            <Panel key={k} title={k === "live" ? "Идут сейчас" : k === "scheduled" ? "Запланированы" : "Прошедшие"} count={groups[k].length} flush testId={`announcements-${k}`}>
              {groups[k].map((a, i) => <Item key={a.id} a={a} first={i === 0} names={names} now={now} />)}
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}

function audienceText(a: Pick<Row, "audience" | "plans" | "tenantIds">, names: Map<number, string>): string {
  if (a.audience === "all") return "Всем организациям";
  if (a.audience === "plans") return `Тарифы: ${((a.plans as string[] | null) ?? []).map(p => TENANT_PLAN_LABEL[p as keyof typeof TENANT_PLAN_LABEL]?.ru ?? p).join(", ")}`;
  const ids = ((a.tenantIds as number[] | null) ?? []).map(Number);
  if (ids.length <= 3) return ids.map(id => names.get(id) ?? `№ ${id}`).join(", ");
  return `${ids.length} организаций`;
}

function Item({ a, first, names, now }: { a: Row; first: boolean; names: Map<number, string>; now: Date }) {
  const utils = trpc.useUtils();
  const { confirm, dialog } = useConfirm();
  const st = stateOf(a, now);
  const end = trpc.platform.endAnnouncement.useMutation({
    onSuccess: () => { notify.success("Объявление завершено"); void utils.platform.announcements.invalidate(); void utils.platform.journal.invalidate(); },
    onError: e => notify.error(errorText(e)),
  });
  return (
    <div className="flex items-start gap-3 flex-wrap" style={{ padding: "14px 20px", borderTop: first ? undefined : "1px solid var(--color-border-subtle)" }} data-testid="announcement-row">
      {dialog}
      <div className="min-w-0" style={{ flex: "1 1 300px" }}>
        <div className="flex items-center gap-1.5 flex-wrap" style={{ marginBottom: 6 }}>
          <Pill tone={st.tone}>{st.label}</Pill>
          <Pill tone={a.level === "warning" ? "warning" : "primary"}>{a.level === "warning" ? "Внимание" : "Информация"}</Pill>
          {a.titleUz && <Pill>есть по-узбекски</Pill>}
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)", overflowWrap: "anywhere" }}>{a.title}</div>
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 3, lineHeight: 1.5, overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{a.body}</div>
        <div style={{ fontSize: 12.5, color: "var(--color-text-tertiary)", marginTop: 6, lineHeight: 1.5 }}>
          {audienceText(a, names)} · с {dayTime(a.startsAt)}{a.endsAt ? ` до ${dayTime(a.endsAt)}` : " · без срока"}
          {a.endedAt ? ` · завершено ${dayTime(a.endedAt)}` : ""} · закрыли: {a.dismissed}
        </div>
      </div>
      {st.key !== "past" && (
        <button type="button" className="neo-btn" style={{ minHeight: 44, padding: "0 14px", fontSize: 13, color: "var(--color-danger-text)" }} disabled={end.isPending} data-testid="announcement-end"
          onClick={async () => {
            if (await confirm({ title: "Завершить объявление?", message: `«${a.title}» исчезнет у всех организаций сейчас же.`, confirmText: "Завершить", danger: true })) end.mutate({ id: a.id });
          }}>
          <X size={15} /> Завершить сейчас
        </button>
      )}
    </div>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const utils = trpc.useUtils();
  const orgs = trpc.tenant.list.useQuery();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [uz, setUz] = useState(false);
  const [titleUz, setTitleUz] = useState("");
  const [bodyUz, setBodyUz] = useState("");
  const [level, setLevel] = useState<AnnouncementLevel>("info");
  const [audience, setAudience] = useState<Audience>("all");
  const [plans, setPlans] = useState<string[]>([]);
  const [tenantIds, setTenantIds] = useState<string[]>([]);
  const [startsAt, setStartsAt] = useState(() => toLocalInput(new Date()));
  const [endsAt, setEndsAt] = useState(() => toLocalInput(new Date(Date.now() + 24 * HOUR)));
  const [previewLang, setPreviewLang] = useState<"ru" | "uz">("ru");
  const [openedAt] = useState(() => Date.now());

  const create = trpc.platform.createAnnouncement.useMutation({
    onSuccess: () => { notify.success("Объявление опубликовано"); void utils.platform.announcements.invalidate(); void utils.platform.journal.invalidate(); onDone(); },
    onError: e => notify.error(errorText(e)),
  });

  const orgOptions = useMemo(() => [...(orgs.data ?? [])].filter(o => !o.isSandbox)
    .sort((a, b) => a.name.localeCompare(b.name, "ru")).map(o => ({ value: String(o.id), label: o.name })), [orgs.data]);
  const start = new Date(startsAt || openedAt);
  const finish = endsAt ? new Date(endsAt) : null;
  const uzPair = !uz || (titleUz.trim() !== "" && bodyUz.trim() !== "");
  const valid = title.trim().length >= 3 && body.trim() !== "" && uzPair
    && (audience !== "plans" || plans.length > 0) && (audience !== "tenants" || tenantIds.length > 0)
    && (!finish || finish > start);
  // «Запланировать», если начало заметно позже открытия формы.
  const later = start.getTime() > openedAt + 60_000;
  const quick = (h: number | null) => setEndsAt(h === null ? "" : toLocalInput(new Date(start.getTime() + h * HOUR)));
  const shown = localized({ title: title || "Заголовок объявления", body: body || "Текст объявления", titleUz: uz ? titleUz : null, bodyUz: uz ? bodyUz : null }, previewLang);

  return (
    <Panel title="Новое объявление" testId="announcement-form" style={{ marginBottom: 16 }}
      action={<button type="button" className="neo-btn" aria-label="Закрыть форму" onClick={onDone} style={{ minHeight: 44, minWidth: 44, padding: "0 12px" }}><X size={16} /></button>}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] console-form">
        <div className="flex flex-col gap-3 min-w-0">
          <div>
            <FieldLabel htmlFor="ann-title">Заголовок</FieldLabel>
            <input id="ann-title" className="neo-input w-full" style={input} maxLength={160} value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Обновление в субботу ночью" data-testid="ann-title" />
          </div>
          <div>
            <FieldLabel htmlFor="ann-body">Текст</FieldLabel>
            <textarea id="ann-body" className="neo-input w-full" rows={3} maxLength={2000} value={body} onChange={e => setBody(e.target.value)}
              placeholder="С 23:00 до 23:30 приложение может отвечать медленнее. Заказы не потеряются." data-testid="ann-body"
              style={{ fontSize: 14, padding: "10px 14px", resize: "vertical", minHeight: 88, height: "auto" }} />
          </div>
          {!uz ? (
            <button type="button" className="neo-btn" style={{ minHeight: 44, alignSelf: "flex-start", fontSize: 13 }} onClick={() => { setUz(true); setPreviewLang("uz"); }} data-testid="ann-add-uz">
              <Plus size={15} /> Добавить по-узбекски
            </button>
          ) : (
            <>
              <div>
                <FieldLabel htmlFor="ann-title-uz">Заголовок по-узбекски</FieldLabel>
                <input id="ann-title-uz" className="neo-input w-full" style={input} maxLength={160} value={titleUz} onChange={e => setTitleUz(e.target.value)} data-testid="ann-title-uz" />
              </div>
              <div>
                <FieldLabel htmlFor="ann-body-uz">Текст по-узбекски</FieldLabel>
                <textarea id="ann-body-uz" className="neo-input w-full" rows={3} maxLength={2000} value={bodyUz} onChange={e => setBodyUz(e.target.value)} data-testid="ann-body-uz"
                  style={{ fontSize: 14, padding: "10px 14px", resize: "vertical", minHeight: 88, height: "auto" }} />
                {!uzPair && <p style={{ fontSize: 12, color: "var(--color-warning-text)", margin: "6px 0 0" }}>Нужны и заголовок, и текст — иначе узбекским покажется русский.</p>}
              </div>
            </>
          )}

          <div>
            <FieldLabel>Уровень</FieldLabel>
            <div className="flex flex-wrap gap-2">
              <Chip active={level === "info"} onClick={() => setLevel("info")} testId="ann-level-info">Информация</Chip>
              <Chip active={level === "warning"} onClick={() => setLevel("warning")} testId="ann-level-warning">Внимание</Chip>
            </div>
          </div>

          <div>
            <FieldLabel>Кому</FieldLabel>
            <div className="flex flex-wrap gap-2">
              <Chip active={audience === "all"} onClick={() => setAudience("all")} testId="ann-aud-all">Всем</Chip>
              <Chip active={audience === "plans"} onClick={() => setAudience("plans")} testId="ann-aud-plans">По тарифу</Chip>
              <Chip active={audience === "tenants"} onClick={() => setAudience("tenants")} testId="ann-aud-tenants">Выбранным</Chip>
            </div>
            {audience === "plans" && (
              <div className="flex flex-wrap gap-2" style={{ marginTop: 10 }}>
                {PLANS.map(p => (
                  <Chip key={p} active={plans.includes(p)} testId={`ann-plan-${p}`}
                    onClick={() => setPlans(x => (x.includes(p) ? x.filter(y => y !== p) : [...x, p]))}>{TENANT_PLAN_LABEL[p].ru}</Chip>
                ))}
              </div>
            )}
            {audience === "tenants" && (
              <div style={{ marginTop: 10 }} data-testid="ann-tenants">
                <PremiumSelect multiple value={tenantIds} onChange={setTenantIds} options={orgOptions} width="100%" aria-label="Организации"
                  placeholder="Выберите организации" summarize={n => `Выбрано: ${n}`} />
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="ann-from">Показывать с</FieldLabel>
              <input id="ann-from" type="datetime-local" className="neo-input w-full" style={input} value={startsAt} onChange={e => setStartsAt(e.target.value)} data-testid="ann-from" />
            </div>
            <div>
              <FieldLabel htmlFor="ann-to">до</FieldLabel>
              <input id="ann-to" type="datetime-local" className="neo-input w-full" style={input} value={endsAt} onChange={e => setEndsAt(e.target.value)} data-testid="ann-to" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip active={false} onClick={() => quick(24)}>Сутки</Chip>
            <Chip active={false} onClick={() => quick(72)}>3 дня</Chip>
            <Chip active={false} onClick={() => quick(24 * 7)}>Неделя</Chip>
            <Chip active={endsAt === ""} onClick={() => quick(null)}>Без срока</Chip>
          </div>
          {finish && finish <= start && <p style={{ fontSize: 12.5, color: "var(--color-danger-text)", margin: 0 }}>Конец показа раньше начала.</p>}
        </div>

        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap" style={{ marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-tertiary)", letterSpacing: "0.07em", textTransform: "uppercase" }}>Так увидит директор</span>
            {uz && (
              <div className="flex gap-2">
                <Chip active={previewLang === "ru"} onClick={() => setPreviewLang("ru")} testId="ann-preview-ru">Русский</Chip>
                <Chip active={previewLang === "uz"} onClick={() => setPreviewLang("uz")} testId="ann-preview-uz">O‘zbekcha</Chip>
              </div>
            )}
          </div>
          <div style={{ padding: 14, borderRadius: 18, background: "var(--color-bg, var(--color-surface-light))", boxShadow: "var(--shadow-pressed)" }} data-testid="ann-preview">
            <AnnouncementView level={level} title={shown.title} body={shown.body} closeLabel={previewLang === "uz" ? "Yopish" : "Закрыть"} onClose={() => {}} />
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }} aria-hidden>
              {[70, 92, 56].map(w => <div key={w} style={{ height: 10, width: `${w}%`, borderRadius: 6, background: "var(--color-surface-light)" }} />)}
            </div>
          </div>
          <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)", lineHeight: 1.5, margin: "10px 0 0" }}>
            Полоса стоит над любой страницей приложения у всех ролей организации — в браузере и в установленном приложении на телефоне. Закрыл человек — у него она больше не появится, у коллег останется.
          </p>
          <button type="button" className="neo-btn-primary w-full" style={{ minHeight: 48, marginTop: 14 }} disabled={!valid || create.isPending} data-testid="ann-submit"
            onClick={() => create.mutate({
              title: title.trim(), body: body.trim(),
              titleUz: uz && titleUz.trim() ? titleUz.trim() : undefined, bodyUz: uz && bodyUz.trim() ? bodyUz.trim() : undefined,
              level, audience,
              plans: audience === "plans" ? (plans as Array<(typeof PLANS)[number]>) : undefined,
              tenantIds: audience === "tenants" ? tenantIds.map(Number) : undefined,
              startsAt: start, endsAt: finish,
            })}>
            {create.isPending ? "Публикую…" : later ? "Запланировать" : "Опубликовать"}
          </button>
        </div>
      </div>
    </Panel>
  );
}
