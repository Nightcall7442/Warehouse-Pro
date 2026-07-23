import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { Eye, EyeOff, Loader2, CheckCircle2 } from "lucide-react";
import { useLang } from "@/i18n";

function PasswordStrength({ password }: { password: string }) {
  const { t } = useLang();
  const checks = [
    { label: t("auth.register.char8"),     pass: password.length >= 8     },
    { label: t("auth.register.uppercase"), pass: /[A-Z]/.test(password)   },
    { label: t("auth.register.digit"),     pass: /[0-9]/.test(password)   },
  ];
  const score = checks.filter(c => c.pass).length;
  const bar   = score === 0 ? 0 : score === 1 ? 33 : score === 2 ? 66 : 100;
  const color = score < 2 ? "#d45050" : score < 3 ? "#d4973a" : "#34c473";
  const label = score < 2 ? t("auth.register.passwordWeak") : score < 3 ? t("auth.register.passwordMedium") : t("auth.register.passwordStrong");

  if (!password) return null;

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="h-1.5 flex-1 rounded-full overflow-hidden mr-3" style={{ background: "var(--color-surface-light, #f0f3f8)" }}>
          <div className="h-full rounded-full transition-all duration-400" style={{ width: `${bar}%`, background: color }} />
        </div>
        <span className="text-xs font-medium flex-shrink-0" style={{ color }}>{label}</span>
      </div>
      <div className="flex gap-3">
        {checks.map(c => (
          <div key={c.label} className="flex items-center gap-1">
            <div className={`w-1.5 h-1.5 rounded-full ${c.pass ? "bg-success" : "bg-border-subtle"}`} />
            <span className="text-[10px]" style={{ color: c.pass ? "#34c473" : "var(--color-text-tertiary, #98a0b8)" }}>{c.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Register() {
  const { t } = useLang();
  const [form, setForm] = useState({ name: "", companyName: "", email: "", password: "" });
  const [showPw, setShowPw] = useState(false);
  const [error,  setError]  = useState("");
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const registerMutation = trpc.tenant.register.useMutation({
    onSuccess: async () => { await refresh(); navigate("/"); },
    onError:   (e)       => setError(e.message || t("auth.register.error")),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.name || !form.email || !form.password || !form.companyName) {
      setError(t("auth.register.fillAll")); return;
    }
    if (form.password.length < 8) { setError(t("auth.register.tooShort")); return; }
    registerMutation.mutate({
      orgName: form.companyName,
      name: form.name,
      email: form.email,
      password: form.password,
    });
  };

  const STEPS = [
    { num: "01", title: t("Создайте аккаунт", "Hisob yarating"), desc: t("Заполните информацию о компании", "Kompaniya ma'lumotlarini to'ldiring") },
    { num: "02", title: t("Настройте систему", "Tizimni sozlang"), desc: t("Добавьте товары и склады", "Mahsulotlar va omborlarni qo'shing") },
    { num: "03", title: t("Начните работу", "Ishni boshlang"), desc: t("Создавайте заказы и отслеживайте", "Buyurtmalar yarating va kuzatib boring") },
  ];

  return (
    <div className="min-h-screen flex" style={{ background: "var(--color-canvas, #f0f2f5)" }}>

      {/* ── Left panel ── */}
      <div className="hidden lg:flex flex-col justify-between w-[52%] p-12 relative overflow-hidden"
        style={{ background: "var(--color-surface, #ffffff)" }}>
        <div className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{
            backgroundImage: "linear-gradient(#2b3450 1px, transparent 1px), linear-gradient(90deg, #2b3450 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }} />
        <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, color-mix(in srgb, #34c473 12%, transparent), transparent 70%)" }} />

        <div className="relative flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "#5b6d8a" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
          <span className="font-display text-base text-primary">Warehouse Pro</span>
        </div>

        <div className="relative space-y-10">
          <div>
            <p className="text-[11px] font-semibold tracking-[.14em] uppercase mb-3" style={{ color: "#34c473" }}>
              {t("Начните бесплатно", "Bepul boshlang")}
            </p>
            <h1 className="text-[38px] font-bold leading-[1.15] tracking-tight text-primary">
              {t("Создайте аккаунт за 2 минуты", "2 daqiqada hisob yarating")}
            </h1>
          </div>

          <div className="space-y-5">
            {STEPS.map((s, i) => (
              <div key={i} className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 font-data font-bold text-sm"
                  style={{ background: "rgba(75,108,246,.12)", color: "#5b6d8a" }}>
                  {s.num}
                </div>
                <div>
                  <p className="font-medium text-primary">{s.title}</p>
                  <p className="text-sm mt-0.5" style={{ color: "var(--color-text-secondary, #6a7290)" }}>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
            style={{ background: "color-mix(in srgb, #34c473 8%, transparent)", border: "1px solid color-mix(in srgb, #34c473 20%, transparent)" }}>
            <CheckCircle2 size={16} className="text-success flex-shrink-0" />
            <p className="text-sm text-primary">{t("Бесплатный пробный период на 14 дней", "14 kunlik bepul sinov muddati")}</p>
          </div>
        </div>

        <p className="relative text-xs" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>© 2025 Warehouse Pro</p>
      </div>

      {/* ── Form ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 animate-fade-up">
        <div className="lg:hidden flex items-center gap-2.5 mb-8">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#5b6d8a" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
          <span className="font-display text-sm text-primary">Warehouse Pro</span>
        </div>

        <div className="w-full max-w-[380px]">
          <div className="mb-8">
            <h2 className="font-display text-2xl text-primary mb-1.5">{t("Создайте аккаунт", "Hisob yarating")}</h2>
            <p className="text-sm" style={{ color: "var(--color-text-secondary, #6a7290)" }}>
              {t("Уже есть аккаунт?", "Hisobingiz bormi?")}{" "}
              <Link to="/login" className="font-medium hover:underline" style={{ color: "#5b6d8a" }}>{t("Войти", "Kirish")}</Link>
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {[
              { key: "name",        type: "text",     placeholder: t("Ваше имя", "Ismingiz"),             label: t("Ваше имя", "Ismingiz") },
              { key: "companyName", type: "text",     placeholder: t("Название компании", "Kompaniya nomi"), label: t("Название компании", "Kompaniya nomi") },
              { key: "email",       type: "email",    placeholder: "you@company.com",                     label: "Email" },
            ].map(f => (
              <div key={f.key} className="space-y-1.5">
                <label className="block text-xs font-medium" style={{ color: "var(--color-text-secondary, #6a7290)" }}>{f.label}</label>
                <input type={f.type} className="neo-input" placeholder={f.placeholder}
                  value={(form as unknown as Record<string, string>)[f.key]}
                  onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                  disabled={registerMutation.isPending} />
              </div>
            ))}

            <div className="space-y-1.5">
              <label className="block text-xs font-medium" style={{ color: "var(--color-text-secondary, #6a7290)" }}>{t("auth.login.password")}</label>
              <div className="relative">
                <input type={showPw ? "text" : "password"} className="neo-input pr-10"
                  placeholder={t("Пароль (мин. 8 символов)", "Parol (kamida 8 ta belgi)")}
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  disabled={registerMutation.isPending} />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors" tabIndex={-1}
                  style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <PasswordStrength password={form.password} />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm px-3 py-2.5 rounded-lg"
                style={{ background: "var(--color-danger-subtle, rgba(232,80,80,.10))", color: "#d45050" }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm-.75 4a.75.75 0 0 1 1.5 0v3a.75.75 0 0 1-1.5 0V5zm.75 6.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" />
                </svg>
                {error}
              </div>
            )}

            <button type="submit" className="neo-btn-primary w-full py-2.5 text-sm mt-2"
              disabled={registerMutation.isPending}>
              {registerMutation.isPending
                ? <><Loader2 size={15} className="animate-spin inline mr-2" />{t("auth.register.submit")}</>
                : t("auth.register.submit")}
            </button>

            <p className="text-xs text-center" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
              {t("Нажимая «Зарегистрироваться», вы соглашаетесь с условиями", "«Ro'yxatdan o'tish» tugmasini bosish orqali siz shartlarga rozilik bildirasiz")}
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
