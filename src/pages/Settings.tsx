import { useState, useRef } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useLang } from "@/i18n";
import { useTheme } from "@/hooks/useTheme";
import { notify } from "@/lib/toast";
import {
  User, Bell, Building2, Loader2,
  Send, CheckCircle2, XCircle, Moon,
  Upload,
} from "lucide-react";
import { PremiumSelect } from "@/components/PremiumSelect";

// ── Telegram ───────────────────────────────────────────────────────────────────
function TelegramSettings() {
  const [chatId, setChatId] = useState("");
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const { data: status } = trpc.telegram.myStatus.useQuery();
  const utils = trpc.useUtils();
  const save   = trpc.telegram.saveChatId.useMutation({
    onSuccess: () => { utils.telegram.myStatus.invalidate(); notify.success(t("Telegram подключён!", "Telegram ulandi!")); },
    onError:   (e) => notify.error(e.message),
  });
  const remove = trpc.telegram.removeChatId.useMutation({
    onSuccess: () => { utils.telegram.myStatus.invalidate(); notify.success(t("Telegram отключён", "Telegram uzildi")); },
    onError:   (e) => notify.error(e.message),
  });

  return (
    <div className="space-y-4">
      {status?.connected ? (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg"
          style={{ background: "var(--color-success-subtle)", border: "1px solid color-mix(in srgb, var(--color-success) 25%, transparent)" }}>
          <CheckCircle2 size={18} className="text-success flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-text-primary">{t("Telegram подключён", "Telegram ulangan")}</p>
            <p className="text-xs text-text-secondary mt-0.5">chat_id: {status.chatId}</p>
          </div>
          <button onClick={() => remove.mutate()} disabled={remove.isPending}
            className="btn-secondary py-1.5 px-3 text-xs text-danger flex items-center gap-1.5"
            style={{ borderColor: "color-mix(in srgb, var(--color-danger) 30%, transparent)" }}>
            {remove.isPending ? <Loader2 size={11} className="animate-spin" /> : <XCircle size={11} />}
            {t("Отключить", "Uzish")}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="px-4 py-3 rounded-lg space-y-2 text-sm" style={{ background: "var(--color-surface-light)" }}>
            <p className="font-medium text-text-primary">{t("Как подключить:", "Qanday ulash:")}</p>
            <ol className="list-decimal list-inside space-y-1.5 text-text-secondary">
              <li>{t("Откройте Telegram → найдите", "Telegramni oching →")} <code className="px-1 rounded text-primary" style={{ background: "var(--color-primary-subtle)" }}>@userinfobot</code></li>
              <li>{t("Нажмите /start — получите свой числовой ID", "/start → raqamli ID olasiz")}</li>
              <li>{t("Вставьте ID ниже и нажмите «Подключить»", "ID-ni quyida kiriting va «Ulash» tugmasini bosing")}</li>
            </ol>
          </div>
          <div>
            <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">
              {t("ВАШ TELEGRAM CHAT ID", "TELEGRAM CHAT ID")}
            </label>
            <div className="flex gap-2">
              <input className="input-field flex-1 font-data"
                placeholder={t("Например: 123456789", "Masalan: 123456789")}
                value={chatId} onChange={e => setChatId(e.target.value.replace(/\D/g, ""))} />
              <button onClick={() => chatId && save.mutate({ chatId })}
                disabled={save.isPending || !chatId}
                className="btn-primary flex items-center gap-2 disabled:opacity-40">
                {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {t("Подключить", "Ulash")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--color-border-subtle)", paddingTop: 16 }}>
        <p className="font-label text-[10px] text-text-secondary tracking-wider mb-2">
          {t("ВЫ БУДЕТЕ ПОЛУЧАТЬ", "QUYIDAGILARNI OLASIZ")}
        </p>
        <ul className="space-y-2 text-sm text-text-secondary">
          {[
            t("📅 Ваш план визитов утром", "📅 Tashrif rejasi ertalab"),
            t("🛒 Подтверждение новых заказов", "🛒 Yangi buyurtmalar tasdiqi"),
            t("📦 Изменение статуса заказа", "📦 Buyurtma holati o'zgarishi"),
            t("⚠️ Уведомления о низком остатке", "⚠️ Kam qoldiq haqida xabar"),
          ].map(item => <li key={item}>{item}</li>)}
        </ul>
      </div>
    </div>
  );
}

// ── Компания ──────────────────────────────────────────────────────────────────
function CompanySettings() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const logoRef = useRef<HTMLInputElement>(null);
  const { data: settings, isLoading } = trpc.settings.get.useQuery();
  const utils = trpc.useUtils();
  type CompanyForm = Record<string, unknown>;
  const [form, setForm] = useState<CompanyForm | null>(null);

  if (!isLoading && settings && !form) setForm(settings as any);

  const saveMutation = trpc.settings.update.useMutation({
    onSuccess: () => { utils.settings.get.invalidate(); notify.success(t("Настройки сохранены", "Sozlamalar saqlandi")); },
    onError:   (e) => notify.error(e.message),
  });

  const handleLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) { notify.error(t("Макс. 1 МБ", "Maks. 1 MB")); return; }
    const reader = new FileReader();
    reader.onload = () => setForm((f: CompanyForm | null) => ({ ...f, logoUrl: reader.result as string } as CompanyForm));
    reader.readAsDataURL(file);
  };

  if (isLoading || !form) return <div className="h-32 bg-surface-light animate-pulse rounded-xl" />;

  const FIELDS = [
    { key: "companyName",    ru: "Название компании", uz: "Kompaniya nomi"    },
    { key: "companyAddress", ru: "Адрес",             uz: "Manzil"           },
    { key: "companyInn",     ru: "ИНН",               uz: "STIR"             },
    { key: "companyDirector",ru: "Директор",          uz: "Direktor"         },
    { key: "companyPhone",   ru: "Телефон",           uz: "Telefon"          },
  ];

  return (
    <div className="space-y-4">
      {/* Логотип */}
      <div>
        <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-2">
          {t("ЛОГОТИП КОМПАНИИ", "KOMPANIYA LOGOTIPI")}
        </label>
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-xl flex items-center justify-center overflow-hidden cursor-pointer border-2 border-dashed transition-colors hover:border-primary"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface-light)" }}
            onClick={() => logoRef.current?.click()}
          >
            {form.logoUrl
              ? <img src={form.logoUrl as string} alt="logo" className="w-full h-full object-contain" />
              : <Upload size={20} className="text-text-secondary" />}
          </div>
          <div>
            <button onClick={() => logoRef.current?.click()} className="btn-secondary text-sm flex items-center gap-2">
              <Upload size={14} />{t("Загрузить", "Yuklash")}
            </button>
            <p className="text-xs mt-1" style={{ color: "var(--color-text-tertiary)" }}>
              {t("PNG, JPG — макс. 1 МБ", "PNG, JPG — maks. 1 MB")}
            </p>
          </div>
          <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={handleLogo} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {FIELDS.map(f => (
          <div key={f.key}>
            <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">
              {lang === "uz" ? f.uz : f.ru}
            </label>
            <input className="input-field w-full" value={(form[f.key] as string) ?? ""}
              onChange={e => setForm({ ...form, [f.key]: e.target.value } as CompanyForm)} />
          </div>
        ))}

        {/* Валюта */}
        <div>
          <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">
            {t("ВАЛЮТА", "VALYUTA")}
          </label>
          <PremiumSelect value={(form.currency as string) ?? "UZS"}
            onChange={v => setForm({ ...form, currency: v } as CompanyForm)}
            options={[{value:"UZS",label:"UZS — Узбекский сум"},{value:"USD",label:"USD — Доллар США"},{value:"RUB",label:"RUB — Российский рубль"}]}
            width="100%" />
        </div>
      </div>

      <button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending}
        className="btn-primary flex items-center gap-2 disabled:opacity-40">
        {saveMutation.isPending && <Loader2 size={14} className="animate-spin" />}
        {t("Сохранить", "Saqlash")}
      </button>
    </div>
  );
}

// ── Профиль ───────────────────────────────────────────────────────────────────
function ProfileSettings() {
  const { user } = useAuth();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const utils = trpc.useUtils();
  const [form, setForm] = useState({ name: user?.name ?? "", email: user?.email ?? "" });
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });

  const updateProfile = (trpc.user as any).updateProfile.useMutation({
    onSuccess: () => { utils.auth.me.invalidate(); notify.success(t("Профиль обновлён", "Profil yangilandi")); },
    onError:   (e: any) => notify.error(e.message),
  });
  const changePassword = trpc.user.changePassword.useMutation({
    onSuccess: () => { setPwForm({ current: "", next: "", confirm: "" }); notify.success(t("Пароль изменён", "Parol o'zgartirildi")); },
    onError:   (e) => notify.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="font-label text-[10px] text-text-secondary tracking-wider">{t("ОСНОВНОЕ", "ASOSIY")}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">{t("ИМЯ","ISM")}</label>
            <input className="input-field w-full" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">EMAIL</label>
            <input type="email" className="input-field w-full" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
        </div>
        <button onClick={() => updateProfile.mutate(form)} disabled={updateProfile.isPending}
          className="btn-primary flex items-center gap-2 disabled:opacity-40">
          {updateProfile.isPending && <Loader2 size={14} className="animate-spin" />}
          {t("Сохранить профиль", "Profilni saqlash")}
        </button>
      </div>

      <div className="space-y-3" style={{ borderTop: "1px solid var(--color-border-subtle)", paddingTop: 20 }}>
        <p className="font-label text-[10px] text-text-secondary tracking-wider">{t("СМЕНА ПАРОЛЯ","PAROLNI O'ZGARTIRISH")}</p>
        {[
          { key: "current", ru: "ТЕКУЩИЙ ПАРОЛЬ",  uz: "JORIY PAROL"    },
          { key: "next",    ru: "НОВЫЙ ПАРОЛЬ",     uz: "YANGI PAROL"    },
          { key: "confirm", ru: "ПОДТВЕРДИТЕ НОВЫЙ", uz: "YANGI PAROLNI TASDIQLANG" },
        ].map(f => (
          <div key={f.key}>
            <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">
              {lang === "uz" ? f.uz : f.ru}
            </label>
            <input type="password" className="input-field w-full sm:max-w-sm"
              value={(pwForm as unknown as Record<string, string>)[f.key]}
              onChange={e => setPwForm({ ...pwForm, [f.key]: e.target.value })} />
          </div>
        ))}
        <button
          onClick={() => {
            if (pwForm.next !== pwForm.confirm) { notify.error(t("Пароли не совпадают", "Parollar mos emas")); return; }
            changePassword.mutate({ currentPassword: pwForm.current, newPassword: pwForm.next });
          }}
          disabled={changePassword.isPending || !pwForm.current || !pwForm.next}
          className="btn-secondary flex items-center gap-2 disabled:opacity-40"
        >
          {changePassword.isPending && <Loader2 size={14} className="animate-spin" />}
          {t("Изменить пароль", "Parolni o'zgartirish")}
        </button>
      </div>
    </div>
  );
}

// ── Внешний вид ───────────────────────────────────────────────────────────────
function AppearanceSettings() {
  const { theme, toggle } = useTheme();
  const { lang, setLang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  return (
    <div className="space-y-6">
      <div>
        <p className="font-label text-[10px] text-text-secondary tracking-wider mb-3">{t("ТЕМА","MAVZU")}</p>
        <div className="grid grid-cols-2 gap-3 max-w-xs">
          {[
            { val: "light", labelRu: "☀️ Светлая", labelUz: "☀️ Yorug'" },
            { val: "dark",  labelRu: "🌙 Тёмная",  labelUz: "🌙 To'q"  },
          ].map(opt => (
            <button key={opt.val} onClick={toggle}
              className={`py-3 rounded-xl border text-sm font-medium transition-all ${
                theme === opt.val ? "border-primary bg-primary/10 text-primary" : "border-border-subtle text-text-secondary hover:border-border-strong"
              }`}>
              {lang === "uz" ? opt.labelUz : opt.labelRu}
            </button>
          ))}
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--color-border-subtle)", paddingTop: 20 }}>
        <p className="font-label text-[10px] text-text-secondary tracking-wider mb-3">{t("ЯЗЫК ИНТЕРФЕЙСА","INTERFEYS TILI")}</p>
        <div className="grid grid-cols-2 gap-3 max-w-xs">
          {[
            { val: "ru", label: "🇷🇺 Русский"  },
            { val: "uz", label: "🇺🇿 O'zbek"   },
          ].map(l => (
            <button key={l.val} onClick={() => setLang(l.val as "ru" | "uz")}
              className={`py-3 rounded-xl border text-sm font-medium transition-all ${
                lang === l.val ? "border-primary bg-primary/10 text-primary" : "border-border-subtle text-text-secondary hover:border-border-strong"
              }`}>
              {l.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Секции ────────────────────────────────────────────────────────────────────
const SECTIONS = [
  { key: "profile",    iconRu: "Профиль",    iconUz: "Profil",        Icon: User,      Comp: ProfileSettings    },
  { key: "company",   iconRu: "Компания",   iconUz: "Kompaniya",     Icon: Building2, Comp: CompanySettings    },
  { key: "telegram",  iconRu: "Telegram",   iconUz: "Telegram",      Icon: Bell,      Comp: TelegramSettings   },
  { key: "appearance",iconRu: "Внешний вид",iconUz: "Ko'rinish",     Icon: Moon,      Comp: AppearanceSettings },
];

export default function Settings() {
  const [active, setActive] = useState("profile");
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const Current = SECTIONS.find(s => s.key === active)?.Comp ?? ProfileSettings;

  return (
    <div className="max-w-3xl mx-auto animate-fade-up">
      <h1 className="font-display text-2xl font-bold text-text-primary tracking-tight mb-5">{t("Настройки", "Sozlamalar")}</h1>

      <div className="flex flex-col sm:flex-row gap-5">
        {/* Боковое меню */}
        <nav className="sm:w-44 flex-shrink-0">
          <div className="panel p-2 flex sm:flex-col gap-1">
            {SECTIONS.map(s => {
              const Icon = s.Icon;
              return (
                <button key={s.key} onClick={() => setActive(s.key)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-sm font-medium transition-all w-full ${
                    active === s.key
                      ? "bg-primary/10 text-primary"
                      : "text-text-secondary hover:text-text-primary hover:bg-surface-light"
                  }`}>
                  <Icon size={15} />
                  <span className="hidden sm:inline">{lang === "uz" ? s.iconUz : s.iconRu}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Контент */}
        <div className="flex-1 panel p-5 min-h-[300px]">
          <h2 className="font-display text-base text-text-primary mb-5">
            {lang === "uz"
              ? SECTIONS.find(s => s.key === active)?.iconUz
              : SECTIONS.find(s => s.key === active)?.iconRu}
          </h2>
          <Current />
        </div>
      </div>
    </div>
  );
}
