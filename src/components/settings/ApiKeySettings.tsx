import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useConfirm } from "@/components/ConfirmDialog";
import { SectionNotice } from "@/components/SectionNotice";
import { notify } from "@/lib/toast";
import { FieldGroup, Field, FieldRow } from "./ui";
import { format } from "date-fns";
import { Trash2 } from "lucide-react";

/**
 * Ключи API: доступ к данным организации для чужой программы.
 *
 * ── Зачем появилось ─────────────────────────────────────────────────────────
 *
 * Четыре ручки — выпустить, посмотреть, приостановить, отозвать — написаны и
 * не вызывались ниоткуда. Ключ выпускается один раз и показывается один раз;
 * без экрана его нельзя было ни получить, ни отозвать. То есть публичное API
 * существовало, а войти в него было нечем.
 *
 * ── Что здесь важно человеку ────────────────────────────────────────────────
 *
 * Ключ виден ОДИН раз — на сервере лежит только его отпечаток. Об этом сказано
 * прямо и рядом с самим ключом, а не в подсказке снизу: иначе человек закроет
 * окно и вернётся с вопросом, который решается только выпуском нового.
 *
 * Отзыв необратим и мгновенен: программа, которая ходила с этим ключом,
 * перестанет работать сразу. Поэтому рядом есть «приостановить» — то же
 * действие, но обратимое.
 */

const SCOPES = ["read", "write", "orders", "products", "stock", "shops", "webhooks"] as const;
type Scope = (typeof SCOPES)[number];

export function ApiKeySettings() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { confirm, dialog } = useConfirm();
  const utils = trpc.useUtils();

  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Scope[]>(["read"]);
  const [expiresInDays, setExpiresInDays] = useState("");
  const [issued, setIssued] = useState<{ key: string; name: string } | null>(null);

  const SCOPE_LABEL: Record<Scope, string> = {
    read:     t("чтение", "o'qish"),
    write:    t("запись", "yozish"),
    orders:   t("заказы", "buyurtmalar"),
    products: t("товары", "mahsulotlar"),
    stock:    t("остатки", "qoldiqlar"),
    shops:    t("магазины", "do'konlar"),
    webhooks: t("вебхуки", "vebhuklar"),
  };

  const listQ = trpc.apiKey.list.useQuery();

  const create = trpc.apiKey.create.useMutation({
    onSuccess: (r) => {
      setIssued({ key: r.key, name: r.name });
      utils.apiKey.list.invalidate();
      setName(""); setScopes(["read"]); setExpiresInDays("");
    },
    onError: (e) => notify.error(e.message),
  });

  const revoke = trpc.apiKey.revoke.useMutation({
    onSuccess: () => { notify.success(t("Ключ отозван", "Kalit bekor qilindi")); utils.apiKey.list.invalidate(); },
    onError: (e) => notify.error(e.message),
  });

  const setStatus = trpc.apiKey.setStatus.useMutation({
    onSuccess: () => { utils.apiKey.list.invalidate(); },
    onError: (e) => notify.error(e.message),
  });

  const onRevoke = async (id: number, keyName: string) => {
    const ok = await confirm({
      title: t("Отозвать ключ?", "Kalit bekor qilinsinmi?"),
      message: t(
        `«${keyName}»: программа, которая им пользуется, перестанет работать сразу. Вернуть ключ нельзя — только выпустить новый.`,
        `«${keyName}»: undan foydalanadigan dastur darhol ishlamay qoladi. Kalitni qaytarib bo'lmaydi.`,
      ),
      confirmText: t("Отозвать", "Bekor qilish"),
      danger: true,
    });
    if (ok) revoke.mutate({ id });
  };

  const toggleScope = (s: Scope) =>
    setScopes(cur => (cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s]));

  const keys = listQ.data ?? [];

  return (
    <div>
      {dialog}

      {issued && (
        /*
          Выданный ключ — сразу под формой и до списка: это единственный момент,
          когда его можно скопировать.
        */
        <FieldGroup first title={t("Ключ выпущен", "Kalit chiqarildi")}>
          <pre className="p-3 rounded-xl text-xs font-mono overflow-x-auto"
            style={{ background: "var(--color-surface-light)" }}>
{issued.key}
          </pre>
          <p className="text-xs mt-2" style={{ color: "var(--color-danger-text)" }}>
            {t(
              "Скопируйте сейчас — второй раз он не покажется: на сервере хранится только отпечаток.",
              "Hozir nusxalang — ikkinchi marta ko'rsatilmaydi: serverda faqat izi saqlanadi.",
            )}
          </p>
          <button className="neo-btn mt-3" onClick={() => setIssued(null)}>
            {t("Я скопировал", "Nusxaladim")}
          </button>
        </FieldGroup>
      )}

      <FieldGroup first={!issued} title={t("Новый ключ", "Yangi kalit")}>
        <FieldRow>
          <Field label={t("Название", "Nomi")}
            hint={t("Кому выдан — чтобы потом знать, что отзывать", "Kimga berilgan — keyin nimani bekor qilishni bilish uchun")}>
            <input className="neo-input" value={name} onChange={e => setName(e.target.value)} maxLength={100} />
          </Field>
          <Field label={t("Срок, дней", "Muddat, kun")}
            hint={t("Пусто — бессрочно", "Bo'sh — muddatsiz")}>
            <input className="neo-input" inputMode="numeric" value={expiresInDays}
              onChange={e => setExpiresInDays(e.target.value.replace(/[^0-9]/g, ""))} />
          </Field>
        </FieldRow>

        <div className="mt-4">
          <p className="block text-[13px] font-medium text-secondary mb-1.5">
            {t("Что разрешено", "Nimaga ruxsat")}
          </p>
          <div className="flex flex-wrap gap-2">
            {SCOPES.map(s => {
              const on = scopes.includes(s);
              return (
                <button key={s} onClick={() => toggleScope(s)} aria-pressed={on}
                  className={on ? "neo-btn-primary" : "neo-btn"}
                  style={{ fontSize: "12px", padding: "6px 12px" }}>
                  {SCOPE_LABEL[s]}
                </button>
              );
            })}
          </div>
        </div>

        <button className="neo-btn-primary mt-4" disabled={create.isPending}
          onClick={() => {
            if (!name.trim()) return notify.error(t("Укажите название", "Nomini kiriting"));
            if (scopes.length === 0) return notify.error(t("Выберите хотя бы одно разрешение", "Kamida bitta ruxsat tanlang"));
            create.mutate({
              name: name.trim(),
              scopes,
              // Ключ без ограничения частоты положил бы базу первым же циклом
              // чужой программы. Умолчание сервера — сто запросов в минуту.
              rateLimit: 100,
              expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
            });
          }}>
          {t("Выпустить ключ", "Kalit chiqarish")}
        </button>
      </FieldGroup>

      <FieldGroup title={t("Выданные ключи", "Berilgan kalitlar")}>
        {listQ.isLoadingError ? (
          <SectionNotice kind="error" message={t("Не удалось загрузить ключи", "Kalitlarni yuklab bo'lmadi")} onRetry={() => listQ.refetch()} />
        ) : listQ.isLoading ? (
          <div className="h-12 bg-surface-light animate-pulse rounded-xl" />
        ) : keys.length === 0 ? (
          <SectionNotice kind="empty" message={t("Ключей нет", "Kalitlar yo'q")} />
        ) : (
          <div className="space-y-2">
            {keys.map(k => (
              <div key={k.id} className="rounded-2xl p-3.5" style={{ background: "var(--color-surface-light)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div style={{ minWidth: 0 }}>
                    <div className="font-medium text-primary truncate">{k.name}</div>
                    <div className="text-xs text-tertiary">
                      <span className="font-mono">{k.keyPrefix}</span>
                      {" · "}{String(k.scopes ?? "").split(",").filter(Boolean).map(s => SCOPE_LABEL[s as Scope] ?? s).join(", ")}
                      {k.expiresAt && ` · ${t("до", "gacha")} ${format(new Date(k.expiresAt), "dd.MM.yyyy")}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button className="neo-btn" style={{ fontSize: "12px", padding: "6px 10px" }}
                      disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ id: k.id, status: k.status === "active" ? "inactive" : "active" })}>
                      {k.status === "active" ? t("Приостановить", "To'xtatish") : t("Включить", "Yoqish")}
                    </button>
                    <button className="neo-btn text-danger" style={{ padding: "6px 8px" }}
                      aria-label={t("Отозвать", "Bekor qilish")}
                      onClick={() => onRevoke(k.id, k.name)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </FieldGroup>
    </div>
  );
}
