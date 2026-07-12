import { useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { CheckCircle2, Warehouse, Package, Users, ChevronRight, Loader2, Sparkles } from "lucide-react";

const STEPS = [
  { key: "warehouse", num: 1, iconRu: "Склад",         iconUz: "Ombor",            Icon: Warehouse },
  { key: "product",   num: 2, iconRu: "Первый товар",  iconUz: "Birinchi mahsulot", Icon: Package   },
  { key: "invite",    num: 3, iconRu: "Пригласить",    iconUz: "Taklif",            Icon: Users     },
];

function ProgressBar({ current }: { current: number }) {
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
                         "border-border-subtle bg-surface-light text-text-secondary"
              }`}>
                {done ? <CheckCircle2 size={18} /> : <Icon size={18} />}
              </div>
              <span className={`text-[10px] font-label tracking-wider ${active ? "text-primary" : "text-text-secondary"}`}>
                ШАГ {s.num}
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
  const [form, setForm] = useState({ name: "", address: "", city: "" });
  const utils = trpc.useUtils();
  const create = trpc.warehouse.create.useMutation({
    onSuccess: () => { utils.warehouse.list.invalidate(); onNext(); },
    onError:   (e) => notify.error(e.message),
  });

  return (
    <div className="space-y-5 animate-fade-up">
      <div>
        <p className="text-[11px] font-semibold tracking-[.12em] uppercase mb-2" style={{ color: "#818cf8" }}>
          ШАГ 1 ИЗ 3
        </p>
        <h2 className="font-display text-2xl text-text-primary">Настройте склад</h2>
        <p className="text-sm text-text-secondary mt-1.5">Укажите основную информацию о вашем складе</p>
      </div>
      <div className="space-y-3">
        <div>
          <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">НАЗВАНИЕ СКЛАДА *</label>
          <input className="input-field w-full" placeholder="Главный склад" autoFocus
            value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">АДРЕС</label>
          <input className="input-field w-full" placeholder="ул. Амира Темура, 15"
            value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
        </div>
        <div>
          <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">ГОРОД</label>
          <input className="input-field w-full" placeholder="Ташкент"
            value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
        </div>
      </div>
      <button
        onClick={() => form.name.trim() && create.mutate(form)}
        disabled={create.isPending || !form.name.trim()}
        className="btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-40"
      >
        {create.isPending ? <Loader2 size={15} className="animate-spin" /> : null}
        Создать склад <ChevronRight size={15} />
      </button>
      <button onClick={onNext} className="w-full text-center text-sm text-text-secondary hover:text-text-primary transition-colors">
        Пропустить →
      </button>
    </div>
  );
}

// Шаг 2: Первый товар
function StepProduct({ onNext }: { onNext: () => void }) {
  const [form, setForm] = useState({ code: "", name: "", unitPrice: "", category: "" });
  const utils = trpc.useUtils();
  const create = trpc.product.create.useMutation({
    onSuccess: () => { utils.product.list.invalidate(); onNext(); },
    onError:   (e) => notify.error(e.message),
  });

  return (
    <div className="space-y-5 animate-fade-up">
      <div>
        <p className="text-[11px] font-semibold tracking-[.12em] uppercase mb-2" style={{ color: "#818cf8" }}>
          ШАГ 2 ИЗ 3
        </p>
        <h2 className="font-display text-2xl text-text-primary">Добавьте первый товар</h2>
        <p className="text-sm text-text-secondary mt-1.5">Позже можно импортировать из Excel</p>
      </div>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">КОД *</label>
            <input className="input-field w-full font-data" placeholder="MUK-001" autoFocus
              value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} />
          </div>
          <div>
            <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">КАТЕГОРИЯ</label>
            <input className="input-field w-full" placeholder="Мука"
              value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">НАЗВАНИЕ *</label>
          <input className="input-field w-full" placeholder="Мука пшеничная в/с"
            value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">ЦЕНА ЗА КГ *</label>
          <input type="number" step="0.01" className="input-field w-full font-data" placeholder="0.00"
            value={form.unitPrice} onChange={e => setForm({ ...form, unitPrice: e.target.value })} />
        </div>
      </div>
      <button
        onClick={() => form.code && form.name && form.unitPrice && create.mutate({ ...form, reorderPoint: "10.00" })}
        disabled={create.isPending || !form.code || !form.name || !form.unitPrice}
        className="btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-40"
      >
        {create.isPending ? <Loader2 size={15} className="animate-spin" /> : null}
        Добавить товар <ChevronRight size={15} />
      </button>
      <button onClick={onNext} className="w-full text-center text-sm text-text-secondary hover:text-text-primary transition-colors">
        Пропустить →
      </button>
    </div>
  );
}

// Шаг 3: Пригласить агента
function StepInvite({ onFinish }: { onFinish: () => void }) {
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
      <h2 className="font-display text-xl text-text-primary mb-2">Приглашение отправлено!</h2>
      <p className="text-text-secondary text-sm mb-6">На {email} отправлена ссылка для регистрации</p>
      <button onClick={onFinish} className="btn-primary px-8 py-3">
        Перейти в Dashboard →
      </button>
    </div>
  );

  return (
    <div className="space-y-5 animate-fade-up">
      <div>
        <p className="text-[11px] font-semibold tracking-[.12em] uppercase mb-2" style={{ color: "#818cf8" }}>
          ШАГ 3 ИЗ 3
        </p>
        <h2 className="font-display text-2xl text-text-primary">Пригласите первого агента</h2>
        <p className="text-sm text-text-secondary mt-1.5">Агент сразу получит доступ к мобильному приложению</p>
      </div>
      <div className="space-y-3">
        <div>
          <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">EMAIL СОТРУДНИКА</label>
          <input type="email" className="input-field w-full" placeholder="agent@company.com" autoFocus
            value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-3">РОЛЬ</label>
          <div className="grid grid-cols-2 gap-3">
            {[
              { val: "agent",    labelRu: "🧑 Торговый агент",  desc: "Заказы, визиты, GPS" },
              { val: "operator", labelRu: "🖥️ Оператор склада", desc: "Склад, приходы, заказы" },
            ].map(r => (
              <button key={r.val} onClick={() => setRole(r.val as "agent" | "operator")}
                className={`p-3 rounded-xl border text-left transition-all ${
                  role === r.val ? "border-primary bg-primary/10" : "border-border-subtle hover:border-border-strong"
                }`}>
                <p className={`text-sm font-medium ${role === r.val ? "text-primary" : "text-text-primary"}`}>{r.labelRu}</p>
                <p className="text-xs text-text-secondary mt-0.5">{r.desc}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
      <button
        onClick={() => email && invite.mutate({ email, role })}
        disabled={invite.isPending || !email}
        className="btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-40"
      >
        {invite.isPending ? <Loader2 size={15} className="animate-spin" /> : null}
        Отправить приглашение
      </button>
      <button onClick={onFinish} className="w-full text-center text-sm text-text-secondary hover:text-text-primary transition-colors">
        Пропустить, перейти в Dashboard →
      </button>
    </div>
  );
}

// Финальный экран
function StepDone({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="text-center py-8 animate-fade-up">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
        style={{ background: "rgba(129,140,248,.15)" }}>
        <Sparkles size={32} className="text-primary" />
      </div>
      <h2 className="font-display text-2xl text-text-primary mb-2">🎉 Всё готово!</h2>
      <p className="text-text-secondary text-sm mb-8 max-w-xs mx-auto">
        Ваш склад настроен. Теперь вы можете добавлять заказы, управлять агентами и следить за аналитикой.
      </p>
      <button onClick={onFinish} className="btn-primary px-10 py-3 text-base">
        Перейти в Dashboard →
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
      style={{ background: "#f0f2f5" }}>
      <div className="w-full max-w-lg">

        {/* Лого */}
        <div className="flex items-center gap-2.5 mb-10">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#818cf8" }}>
            <Warehouse size={16} color="#fff" />
          </div>
          <span className="font-display text-sm text-text-primary">Warehouse Pro</span>
        </div>

        {step <= 3 && <ProgressBar current={step} />}

        <div className="panel p-8">
          {step === 1 && <StepWarehouse onNext={() => setStep(2)} />}
          {step === 2 && <StepProduct   onNext={() => setStep(3)} />}
          {step === 3 && <StepInvite    onFinish={() => setStep(4)} />}
          {step === 4 && <StepDone      onFinish={finish} />}
        </div>
      </div>
    </div>
  );
}
