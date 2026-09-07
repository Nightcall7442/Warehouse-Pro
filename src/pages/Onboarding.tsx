import { useState } from "react";
import { AppBrand } from "@/components/brand/AppBrand";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { CheckCircle2, Warehouse, Package, Users, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { useTranslate } from "@/i18n";

const STEPS = [
  { key: "warehouse", num: 1, iconRu: "Склад",         iconUz: "Ombor",            Icon: Warehouse },
  { key: "product",   num: 2, iconRu: "Первый товар",  iconUz: "Birinchi mahsulot", Icon: Package   },
  { key: "invite",    num: 3, iconRu: "Пригласить",    iconUz: "Taklif",            Icon: Users     },
];

function ProgressBar({ current }: { current: number }) {
  const t = useTranslate();
  return (
    <div className="flex items-center gap-0 mb-10">
      {STEPS.map((s, i) => {
        const done   = s.num < current;
        const active = s.num === current;
        const Icon   = s.Icon;
        return (
          <div key={s.key} className="flex items-center flex-1">
            <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center border-2 transition-all ${
                done   ? "border-primary bg-primary text-white" :
                active ? "border-primary bg-primary/10 text-primary" :
                         "border-border-subtle bg-surface-light text-secondary"
              }`}>
                {done ? <CheckCircle2 size={18} /> : <Icon size={18} />}
              </div>
              <span className={`text-[10px] font-label tracking-wider ${active ? "text-primary" : "text-secondary"}`}>
                {t("ШАГ", "QADAM")} {s.num}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-[2px] mx-3 mb-5 rounded transition-all ${s.num < current ? "bg-primary" : "bg-border-subtle"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Шаг 1: Склад
function StepWarehouse({ onNext }: { onNext: () => void }) {
  const t = useTranslate();
  const [form, setForm] = useState({ name: "", address: "", city: "" });
  const utils = trpc.useUtils();
  const create = trpc.warehouse.create.useMutation({
    onSuccess: () => { utils.warehouse.list.invalidate(); onNext(); },
    onError:   (e) => notify.error(e.message),
  });

  return (
    <div className="space-y-5 animate-fade-up">
      <div>
        <p className="text-[11px] font-semibold tracking-[.12em] uppercase mb-2" style={{ color: "var(--color-primary-text)" }}>
          {t("ШАГ 1 ИЗ 3", "3 QADAMDAN 1-CHI")}
        </p>
        <h2 className="font-display text-2xl text-primary">{t("Настройте склад", "Omborni sozlang")}</h2>
        <p className="text-sm text-secondary mt-1.5">{t("Укажите основную информацию о вашем складе", "Omboringiz haqidagi asosiy ma'lumotlarni kiriting")}</p>
      </div>
      <div className="space-y-3">
        <div>
          <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">{t("НАЗВАНИЕ СКЛАДА *", "OMBOR NOMI *")}</label>
          <input className="neo-input w-full" placeholder={t("Главный склад", "Asosiy ombor")} autoFocus
            value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">{t("АДРЕС", "MANZIL")}</label>
          <input className="neo-input w-full" placeholder={t("ул. Амира Темура, 15", "Amir Temur ko'chasi, 15")}
            value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
        </div>
        <div>
          <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">{t("ГОРОД", "SHAHAR")}</label>
          <input className="neo-input w-full" placeholder={t("Ташкент", "Toshkent")}
            value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
        </div>
      </div>
      <button
        onClick={() => form.name.trim() && create.mutate(form)}
        disabled={create.isPending || !form.name.trim()}
        className="neo-btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-40"
      >
        {create.isPending ? <Loader2 size={15} className="animate-spin" /> : null}
        {t("Создать склад", "Ombor yaratish")} <ChevronRight size={15} />
      </button>
      <button onClick={onNext} className="w-full text-center text-sm text-secondary hover:text-primary transition-colors">
        {t("Пропустить →", "O'tkazib yuborish →")}
      </button>
    </div>
  );
}

// Шаг 2: Первый товар
function StepProduct({ onNext }: { onNext: () => void }) {
  const t = useTranslate();
  const [form, setForm] = useState({ code: "", name: "", unitPrice: "", category: "" });
  const utils = trpc.useUtils();
  const create = trpc.product.create.useMutation({
    onSuccess: () => { utils.product.list.invalidate(); onNext(); },
    onError:   (e) => notify.error(e.message),
  });

  return (
    <div className="space-y-5 animate-fade-up">
      <div>
        <p className="text-[11px] font-semibold tracking-[.12em] uppercase mb-2" style={{ color: "var(--color-primary-text)" }}>
          {t("ШАГ 2 ИЗ 3", "3 QADAMDAN 2-CHI")}
        </p>
        <h2 className="font-display text-2xl text-primary">{t("Добавьте первый товар", "Birinchi mahsulotni qo'shing")}</h2>
        <p className="text-sm text-secondary mt-1.5">{t("Позже можно импортировать из Excel", "Keyinroq Excel'dan yuklab olish mumkin")}</p>
      </div>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">{t("КОД *", "KOD *")}</label>
            <input className="neo-input w-full font-data" placeholder="MUK-001" autoFocus
              value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} />
          </div>
          <div>
            <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">{t("КАТЕГОРИЯ", "TOIFA")}</label>
            <input className="neo-input w-full" placeholder={t("Мука", "Un")}
              value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">{t("НАЗВАНИЕ *", "NOMI *")}</label>
          <input className="neo-input w-full" placeholder={t("Мука пшеничная в/с", "Oliy nav bug'doy uni")}
            value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">{t("ЦЕНА ЗА КГ *", "KG NARXI *")}</label>
          <input type="number" step="0.01" className="neo-input w-full font-data" placeholder="0.00"
            value={form.unitPrice} onChange={e => setForm({ ...form, unitPrice: e.target.value })} />
        </div>
      </div>
      <button
        onClick={() => form.code && form.name && form.unitPrice && create.mutate({ ...form, reorderPoint: "10.00" })}
        disabled={create.isPending || !form.code || !form.name || !form.unitPrice}
        className="neo-btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-40"
      >
        {create.isPending ? <Loader2 size={15} className="animate-spin" /> : null}
        {t("Добавить товар", "Mahsulot qo'shish")} <ChevronRight size={15} />
      </button>
      <button onClick={onNext} className="w-full text-center text-sm text-secondary hover:text-primary transition-colors">
        {t("Пропустить →", "O'tkazib yuborish →")}
      </button>
    </div>
  );
}

// Шаг 3: Пригласить агента
function StepInvite({ onFinish }: { onFinish: () => void }) {
  const t = useTranslate();
  const [email, setEmail] = useState("");
  const [role,  setRole]  = useState<"agent" | "operator">("agent");
  const [sent,  setSent]  = useState(false);
  const invite = trpc.invite.send.useMutation({
    onSuccess: () => setSent(true),
    onError:   (e) => notify.error(e.message),
  });

  if (sent) return (
    <div className="text-center py-6 animate-fade-up">
      <CheckCircle2 size={48} className="text-success mx-auto mb-4" />
      <h2 className="font-display text-xl text-primary mb-2">{t("Приглашение отправлено!", "Taklif yuborildi!")}</h2>
      <p className="text-secondary text-sm mb-6">{t(`На ${email} отправлена ссылка для регистрации`, `${email} manziliga ro'yxatdan o'tish havolasi yuborildi`)}</p>
      <button onClick={onFinish} className="neo-btn-primary px-8 py-3">
        {t("Перейти в Dashboard →", "Boshqaruv paneliga o'tish →")}
      </button>
    </div>
  );

  return (
    <div className="space-y-5 animate-fade-up">
      <div>
        <p className="text-[11px] font-semibold tracking-[.12em] uppercase mb-2" style={{ color: "var(--color-primary-text)" }}>
          {t("ШАГ 3 ИЗ 3", "3 QADAMDAN 3-CHI")}
        </p>
        <h2 className="font-display text-2xl text-primary">{t("Пригласите первого агента", "Birinchi agentni taklif qiling")}</h2>
        <p className="text-sm text-secondary mt-1.5">{t("Агент сразу получит доступ к мобильному приложению", "Agent mobil ilovaga darhol kirish huquqini oladi")}</p>
      </div>
      <div className="space-y-3">
        <div>
          <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">{t("EMAIL СОТРУДНИКА", "XODIM EMAILI")}</label>
          <input type="email" className="neo-input w-full" placeholder="agent@company.com" autoFocus
            value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="font-label text-[10px] text-secondary tracking-wider block mb-3">{t("РОЛЬ", "ROL")}</label>
          <div className="grid grid-cols-2 gap-3">
            {[
              { val: "agent",    label: t("🧑 Торговый агент", "🧑 Savdo agenti"),      desc: t("Заказы, визиты, GPS", "Buyurtmalar, tashriflar, GPS") },
              { val: "operator", label: t("🖥️ Оператор склада", "🖥️ Ombor operatori"), desc: t("Склад, приходы, заказы", "Ombor, kirimlar, buyurtmalar") },
            ].map(r => (
              <button key={r.val} onClick={() => setRole(r.val as "agent" | "operator")}
                className={`p-3 rounded-xl border text-left transition-all ${
                  role === r.val ? "border-primary bg-primary/10" : "border-border-subtle hover:border-border-strong"
                }`}>
                <p className={`text-sm font-medium ${role === r.val ? "text-primary" : "text-primary"}`}>{r.label}</p>
                <p className="text-xs text-secondary mt-0.5">{r.desc}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
      <button
        onClick={() => email && invite.mutate({ email, role })}
        disabled={invite.isPending || !email}
        className="neo-btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-40"
      >
        {invite.isPending ? <Loader2 size={15} className="animate-spin" /> : null}
        {t("Отправить приглашение", "Taklif yuborish")}
      </button>
      <button onClick={onFinish} className="w-full text-center text-sm text-secondary hover:text-primary transition-colors">
        {t("Пропустить, перейти в Dashboard →", "O'tkazib yuborib, boshqaruv paneliga →")}
      </button>
    </div>
  );
}

// Финальный экран
function StepDone({ onFinish }: { onFinish: () => void }) {
  const t = useTranslate();
  return (
    <div className="text-center py-8 animate-fade-up">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
        style={{ background: "color-mix(in srgb, var(--color-primary) 15%, transparent)" }}>
        <Sparkles size={32} className="text-primary" />
      </div>
      <h2 className="font-display text-2xl text-primary mb-2">{t("🎉 Всё готово!", "🎉 Hammasi tayyor!")}</h2>
      <p className="text-secondary text-sm mb-8 max-w-xs mx-auto">
        {t("Ваш склад настроен. Теперь вы можете добавлять заказы, управлять агентами и следить за аналитикой.",
           "Omboringiz sozlandi. Endi buyurtma qo'shishingiz, agentlarni boshqarishingiz va tahlilni kuzatishingiz mumkin.")}
      </p>
      <button onClick={onFinish} className="neo-btn-primary px-10 py-3 text-base">
        {t("Перейти в Dashboard →", "Boshqaruv paneliga o'tish →")}
      </button>
    </div>
  );
}

// Главный компонент
export default function Onboarding() {
  const [step, setStep] = useState(1);
  const navigate = useNavigate();
  const finish   = () => navigate("/");

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12"
      style={{ background: "var(--color-canvas, #e8e6e1)" }}>
      <div className="w-full max-w-lg">

        {/* Лого */}
        <div className="flex items-center gap-2.5 mb-10">
          <AppBrand size={32} />
        </div>

        {step <= 3 && <ProgressBar current={step} />}

        <div className="neo-card p-8">
          {step === 1 && <StepWarehouse onNext={() => setStep(2)} />}
          {step === 2 && <StepProduct   onNext={() => setStep(3)} />}
          {step === 3 && <StepInvite    onFinish={() => setStep(4)} />}
          {step === 4 && <StepDone      onFinish={finish} />}
        </div>
      </div>
    </div>
  );
}
