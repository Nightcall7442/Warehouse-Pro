import { useMemo, useState } from "react";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { OPERATOR_CAPABILITIES, type OperatorCapability } from "@contracts/constants";

/*
  ── Права оператора ─────────────────────────────────────────────────────────

  Роли зашиты в коде и одинаковы для всех организаций: оператор везде может
  удалить заказ, править товары и принимать деньги. Организации же устроены
  по-разному — где-то оператор правая рука директора, где-то наёмный человек
  на телефоне.

  Экран отбирает, а не выдаёт: включённый переключатель значит «как обычно»,
  выключенный — «этого оператор не делает». Ничего сверх роли отсюда получить
  нельзя, поэтому лишний клик не может открыть чужие деньги.

  Один и тот же список стоит в двух местах: у директора в настройках своей
  организации и у суперадмина в карточке арендатора — когда о том же просят в
  поддержке. Отличие ровно одно: суперадмин называет организацию (tenantId),
  директор не называет ничего, его организация берётся из ключа.
*/

const LABELS: Record<OperatorCapability, { ru: string; uz: string; hintRu: string; hintUz: string }> = {
  "orders.edit": {
    ru: "Править заказы", uz: "Buyurtmalarni tahrirlash",
    hintRu: "Менять состав и суммы уже оформленного заказа.",
    hintUz: "Rasmiylashtirilgan buyurtma tarkibi va summasini o'zgartirish.",
  },
  "orders.delete": {
    ru: "Удалять заказы", uz: "Buyurtmalarni o'chirish",
    hintRu: "Удалять заказы и возвращать удалённые.",
    hintUz: "Buyurtmalarni o'chirish va tiklash.",
  },
  "payments.accept": {
    ru: "Принимать оплату", uz: "To'lov qabul qilish",
    hintRu: "Проводить платежи магазинов и закрывать заказы деньгами.",
    hintUz: "Do'kon to'lovlarini o'tkazish va buyurtmalarni pul bilan yopish.",
  },
  "products.manage": {
    ru: "Вести номенклатуру", uz: "Nomenklaturani yuritish",
    hintRu: "Заводить, править и удалять товары и категории.",
    hintUz: "Tovar va turkumlarni yaratish, tahrirlash, o'chirish.",
  },
  "prices.manage": {
    ru: "Вести прайс-листы", uz: "Narx ro'yxatlari",
    hintRu: "Создавать прайс-листы и назначать их магазинам.",
    hintUz: "Narx ro'yxatlarini yaratish va do'konlarga biriktirish.",
  },
  "warehouse.adjust": {
    ru: "Править остатки", uz: "Qoldiqlarni tuzatish",
    hintRu: "Ручная корректировка количества на складе.",
    hintUz: "Ombordagi miqdorni qo'lda tuzatish.",
  },
  "suppliers.manage": {
    ru: "Вести поставщиков", uz: "Yetkazib beruvchilar",
    hintRu: "Заводить поставщиков и проводить оплаты им.",
    hintUz: "Yetkazib beruvchilarni yaratish va ularga to'lash.",
  },
  "shops.delete": {
    ru: "Убирать магазины", uz: "Do'konlarni olib tashlash",
    hintRu: "Архивировать, восстанавливать и удалять магазины.",
    hintUz: "Do'konlarni arxivlash, tiklash va o'chirish.",
  },
  "commission.manage": {
    ru: "Вести вознаграждение", uz: "Mukofotni boshqarish",
    hintRu: "Ставки процента агентам и статусы начислений.",
    hintUz: "Agentlar foizi va hisoblanmalar holati.",
  },
  "import.run": {
    ru: "Загружать из файла", uz: "Fayldan yuklash",
    hintRu: "Массовый импорт товаров и магазинов из Excel.",
    hintUz: "Excel'dan tovar va do'konlarni ommaviy import qilish.",
  },
};

function Toggle({ on, onChange, disabled, label }: {
  on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="tap"
      style={{
        width: "44px", height: "26px", borderRadius: "13px", flexShrink: 0,
        border: "none", cursor: disabled ? "default" : "pointer",
        background: on ? "var(--color-primary)" : "var(--color-surface-hover)",
        boxShadow: on ? "var(--shadow-sm)" : "var(--shadow-pressed)",
        transition: "background 0.2s",
        position: "relative", opacity: disabled ? 0.6 : 1,
      }}
    >
      <span style={{
        position: "absolute", top: "3px", left: on ? "21px" : "3px",
        width: "20px", height: "20px", borderRadius: "50%",
        background: on ? "var(--color-on-primary)" : "var(--color-surface-light)",
        boxShadow: "var(--shadow-xs)", transition: "left 0.2s",
      }} />
    </button>
  );
}

export function OperatorAccess({ tenantId }: { tenantId?: number }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const utils = trpc.useUtils();

  /*
    Свой арендатор или чужой — разные ручки, а не одна с необязательным id.
    Директор не может назвать чужую организацию просто потому, что ему нечего
    туда подставить.
  */
  const own = trpc.access.operatorAccess.useQuery(undefined, { enabled: !tenantId });
  const foreign = trpc.access.operatorAccessFor.useQuery(
    { tenantId: tenantId ?? 0 },
    { enabled: !!tenantId },
  );
  const query = tenantId ? foreign : own;

  const [draft, setDraft] = useState<Partial<Record<OperatorCapability, boolean>>>({});

  const saved = query.data?.capabilities;
  const value = useMemo(
    () => (cap: OperatorCapability) => draft[cap] ?? saved?.[cap] ?? true,
    [draft, saved],
  );
  const dirty = Object.keys(draft).length > 0;

  const done = (label: string) => {
    utils.access.operatorAccess.invalidate();
    utils.access.operatorAccessFor.invalidate();
    // Кнопки у самого оператора берутся из auth.me — иначе он увидел бы
    // изменение только после перезахода.
    utils.auth.me.invalidate();
    setDraft({});
    notify.success(label);
  };
  const failed = (e: { message: string }) => notify.error(e.message);

  const saveOwn = trpc.access.setOperatorAccess.useMutation({
    onSuccess: () => done(t("Права оператора сохранены", "Operator huquqlari saqlandi")),
    onError: failed,
  });
  const saveForeign = trpc.access.setOperatorAccessFor.useMutation({
    onSuccess: () => done(t("Права оператора сохранены", "Operator huquqlari saqlandi")),
    onError: failed,
  });
  const pending = saveOwn.isPending || saveForeign.isPending;

  const save = () => {
    const capabilities = Object.fromEntries(
      OPERATOR_CAPABILITIES.map(cap => [cap, value(cap)]),
    ) as Record<OperatorCapability, boolean>;
    if (tenantId) saveForeign.mutate({ tenantId, capabilities });
    else saveOwn.mutate({ capabilities });
  };

  const deniedCount = OPERATOR_CAPABILITIES.filter(cap => !value(cap)).length;

  if (query.isLoading) {
    return (
      <div style={{ padding: "32px", textAlign: "center" }}>
        <Loader2 size={20} style={{ animation: "spin 1s linear infinite", color: "var(--color-primary-text)" }} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{
        display: "flex", alignItems: "flex-start", gap: "10px",
        padding: "12px 14px", borderRadius: "12px",
        background: "var(--color-surface-light)",
      }}>
        {deniedCount > 0
          ? <ShieldOff size={16} style={{ color: "var(--color-warning)", flexShrink: 0, marginTop: "1px" }} />
          : <ShieldCheck size={16} style={{ color: "var(--color-primary-text)", flexShrink: 0, marginTop: "1px" }} />}
        <p style={{ fontSize: "12px", color: "var(--color-text-secondary)", margin: 0, lineHeight: 1.5 }}>
          {deniedCount > 0
            ? t(`Оператору закрыто действий: ${deniedCount}. Остальное — как обычно.`,
                 `Operatorga ${deniedCount} ta amal yopilgan. Qolgani odatdagidek.`)
            : t("Оператор может всё, что положено роли. Выключите то, чего он делать не должен.",
                 "Operator rolga tegishli hamma narsani qila oladi. Kerak bo'lmaganini o'chiring.")}
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {OPERATOR_CAPABILITIES.map((cap, i) => {
          const on = value(cap);
          const label = LABELS[cap];
          return (
            <div
              key={cap}
              style={{
                display: "flex", alignItems: "center", gap: "14px",
                padding: "12px 2px",
                borderTop: i === 0 ? "none" : "1px solid var(--color-border)",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{
                  fontSize: "13px", fontWeight: 600, margin: 0,
                  color: on ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                }}>
                  {lang === "uz" ? label.uz : label.ru}
                </p>
                <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: "2px 0 0", lineHeight: 1.45 }}>
                  {lang === "uz" ? label.hintUz : label.hintRu}
                </p>
              </div>
              <Toggle
                on={on}
                disabled={pending}
                onChange={v => setDraft(prev => ({ ...prev, [cap]: v }))}
                label={lang === "uz" ? label.uz : label.ru}
              />
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: 0, flex: 1, minWidth: "200px" }}>
          {t("Запрет действует и на сервере: скрытая кнопка — не единственная защита.",
             "Taqiq serverda ham amal qiladi: yashirilgan tugma yagona himoya emas.")}
        </p>
        <button
          onClick={save}
          disabled={!dirty || pending}
          className="neo-btn-primary flex items-center gap-2"
          style={{ opacity: dirty && !pending ? 1 : 0.5, padding: "10px 18px", fontSize: "13px" }}
        >
          {pending && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
          {t("Сохранить", "Saqlash")}
        </button>
      </div>
    </div>
  );
}
