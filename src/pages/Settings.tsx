import { useState, useRef } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useLang } from "@/i18n";
import { useTheme } from "@/hooks/useTheme";
import { notify } from "@/lib/toast";
import {
  User, Bell, Building2, Loader2,
  Send, CheckCircle2, XCircle, Moon,
  Upload, Database, RefreshCw, AlertTriangle, Gift,
} from "lucide-react";
import { PremiumSelect } from "@/components/PremiumSelect";
import { ReferralCard } from "@/components/ReferralCard";

// ── Telegram ───────────────────────────────────────────────────────────────────
function TelegramSettings() {
  const [chatId, setChatId] = useState("");
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const { data: status } = trpc.telegram.myStatus.useQuery();
  const { data: deepLink } = trpc.telegram.deepLink.useQuery();
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
          style={{ background: "rgba(74,222,128,.10)", border: "1px solid rgba(74,222,128,.25)" }}>
          <CheckCircle2 size={18} className="text-success flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-primary">{t("Telegram подключён", "Telegram ulangan")}</p>
            <p className="text-xs text-secondary mt-0.5">chat_id: {status.chatId}</p>
          </div>
          <button onClick={() => remove.mutate()} disabled={remove.isPending}
            className="neo-btn py-1.5 px-3 text-xs text-danger flex items-center gap-1.5"
            style={{ borderColor: "rgba(232,80,80,.30)" }}>
            {remove.isPending ? <Loader2 size={11} className="animate-spin" /> : <XCircle size={11} />}
            {t("Отключить", "Uzish")}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* One-tap deep link */}
          {deepLink?.url && (
            <a href={deepLink.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-3 rounded-lg transition-all hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #0088cc, #0066aa)", color: "#fff" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
              </svg>
              <div>
                <p className="text-sm font-semibold">{t("Подключить в 1 клик", "1 bosishda ulash")}</p>
                <p className="text-xs opacity-80">{t("Откроется Telegram бот", "Telegram bot ochiladi")}</p>
              </div>
            </a>
          )}

          <div className="px-4 py-3 rounded-lg space-y-2 text-sm" style={{ background: "var(--color-surface-light, #f0f3f8)" }}>
            <p className="font-medium text-primary">{t("Или вручную:", "Yoki qo'lda:")}</p>
            <ol className="list-decimal list-inside space-y-1.5 text-secondary">
              <li>{t("Откройте Telegram → найдите", "Telegramni oching →")} <code className="px-1 rounded text-primary" style={{ background: "var(--color-primary-subtle, rgba(75,108,246,.10))" }}>@userinfobot</code></li>
              <li>{t("Нажмите /start — получите свой числовой ID", "/start → raqamli ID olasiz")}</li>
              <li>{t("Вставьте ID ниже и нажмите «Подключить»", "ID-ni quyida kiriting va «Ulash» tugmasini bosing")}</li>
            </ol>
          </div>
          <div>
            <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">
              {t("ВАШ TELEGRAM CHAT ID", "TELEGRAM CHAT ID")}
            </label>
            <div className="flex gap-2">
              <input className="neo-input flex-1 font-data"
                placeholder={t("Например: 123456789", "Masalan: 123456789")}
                value={chatId} onChange={e => setChatId(e.target.value.replace(/\D/g, ""))} />
              <button onClick={() => chatId && save.mutate({ chatId })}
                disabled={save.isPending || !chatId}
                className="neo-btn-primary flex items-center gap-2 disabled:opacity-40">
                {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {t("Подключить", "Ulash")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--color-border, #f0f3f8)", paddingTop: 16 }}>
        <p className="font-label text-[10px] text-secondary tracking-wider mb-2">
          {t("ВЫ БУДЕТЕ ПОЛУЧАТЬ", "QUYIDAGILARNI OLASIZ")}
        </p>
        <ul className="space-y-2 text-sm text-secondary">
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

  if (!isLoading && settings && !form) setForm(settings as unknown as CompanyForm);

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
        <label className="font-label text-[10px] text-secondary tracking-wider block mb-2">
          {t("ЛОГОТИП КОМПАНИИ", "KOMPANIYA LOGOTIPI")}
        </label>
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-xl flex items-center justify-center overflow-hidden cursor-pointer border-2 border-dashed transition-colors hover:border-primary"
            style={{ borderColor: "var(--color-border, #dde2ec)", background: "var(--color-surface-light, #f0f3f8)" }}
            onClick={() => logoRef.current?.click()}
          >
            {form.logoUrl
              ? <img src={form.logoUrl as string} alt="logo" className="w-full h-full object-contain" />
              : <Upload size={20} className="text-secondary" />}
          </div>
          <div>
            <button onClick={() => logoRef.current?.click()} className="neo-btn text-sm flex items-center gap-2">
              <Upload size={14} />{t("Загрузить", "Yuklash")}
            </button>
            <p className="text-xs mt-1" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
              {t("PNG, JPG — макс. 1 МБ", "PNG, JPG — maks. 1 MB")}
            </p>
          </div>
          <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={handleLogo} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {FIELDS.map(f => (
          <div key={f.key}>
            <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">
              {lang === "uz" ? f.uz : f.ru}
            </label>
            <input className="neo-input w-full" value={(form[f.key] as string) ?? ""}
              onChange={e => setForm({ ...form, [f.key]: e.target.value } as CompanyForm)} />
          </div>
        ))}

        {/* Валюта */}
        <div>
          <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">
            {t("ВАЛЮТА", "VALYUTA")}
          </label>
          <PremiumSelect value={(form.currency as string) ?? "UZS"}
            onChange={v => setForm({ ...form, currency: v } as CompanyForm)}
            options={[{value:"UZS",label:"UZS — Узбекский сум"},{value:"USD",label:"USD — Доллар США"},{value:"RUB",label:"RUB — Российский рубль"}]}
            width="100%" />
        </div>
      </div>

      <button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending}
        className="neo-btn-primary flex items-center gap-2 disabled:opacity-40">
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

  const updateProfile = trpc.user.updateMe.useMutation({
    onSuccess: () => { utils.auth.me.invalidate(); notify.success(t("Профиль обновлён", "Profil yangilandi")); },
    onError:   (e) => notify.error(e.message),
  });
  const changePassword = trpc.user.changePassword.useMutation({
    onSuccess: () => { setPwForm({ current: "", next: "", confirm: "" }); notify.success(t("Пароль изменён", "Parol o'zgartirildi")); },
    onError:   (e) => notify.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="font-label text-[10px] text-secondary tracking-wider">{t("ОСНОВНОЕ", "ASOSIY")}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">{t("ИМЯ","ISM")}</label>
            <input className="neo-input w-full" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">EMAIL</label>
            <input type="email" className="neo-input w-full" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
        </div>
        <button onClick={() => updateProfile.mutate({ name: form.name })} disabled={updateProfile.isPending}
          className="neo-btn-primary flex items-center gap-2 disabled:opacity-40">
          {updateProfile.isPending && <Loader2 size={14} className="animate-spin" />}
          {t("Сохранить профиль", "Profilni saqlash")}
        </button>
      </div>

      <div className="space-y-3" style={{ borderTop: "1px solid var(--color-border, #f0f3f8)", paddingTop: 20 }}>
        <p className="font-label text-[10px] text-secondary tracking-wider">{t("СМЕНА ПАРОЛЯ","PAROLNI O'ZGARTIRISH")}</p>
        {[
          { key: "current", ru: "ТЕКУЩИЙ ПАРОЛЬ",  uz: "JORIY PAROL"    },
          { key: "next",    ru: "НОВЫЙ ПАРОЛЬ",     uz: "YANGI PAROL"    },
          { key: "confirm", ru: "ПОДТВЕРДИТЕ НОВЫЙ", uz: "YANGI PAROLNI TASDIQLANG" },
        ].map(f => (
          <div key={f.key}>
            <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">
              {lang === "uz" ? f.uz : f.ru}
            </label>
            <input type="password" className="neo-input w-full sm:max-w-sm"
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
          className="neo-btn flex items-center gap-2 disabled:opacity-40"
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
        <p className="font-label text-[10px] text-secondary tracking-wider mb-3">{t("ТЕМА","MAVZU")}</p>
        <div className="grid grid-cols-2 gap-3 max-w-xs">
          {[
            { val: "light", labelRu: "☀️ Светлая", labelUz: "☀️ Yorug'" },
            { val: "dark",  labelRu: "🌙 Тёмная",  labelUz: "🌙 To'q"  },
          ].map(opt => (
            <button key={opt.val} onClick={toggle}
              className={`py-3 rounded-xl border text-sm font-medium transition-all ${
                theme === opt.val ? "border-primary bg-primary/10 text-primary" : "border-border-subtle text-secondary hover:border-border-strong"
              }`}>
              {lang === "uz" ? opt.labelUz : opt.labelRu}
            </button>
          ))}
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--color-border, #f0f3f8)", paddingTop: 20 }}>
        <p className="font-label text-[10px] text-secondary tracking-wider mb-3">{t("ЯЗЫК ИНТЕРФЕЙСА","INTERFEYS TILI")}</p>
        <div className="grid grid-cols-2 gap-3 max-w-xs">
          {[
            { val: "ru", label: "🇷🇺 Русский"  },
            { val: "uz", label: "🇺🇿 O'zbek"   },
          ].map(l => (
            <button key={l.val} onClick={() => setLang(l.val as "ru" | "uz")}
              className={`py-3 rounded-xl border text-sm font-medium transition-all ${
                lang === l.val ? "border-primary bg-primary/10 text-primary" : "border-border-subtle text-secondary hover:border-border-strong"
              }`}>
              {l.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 1С Интеграция ─────────────────────────────────────────────────────────────
function OneCSettings() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const utils = trpc.useUtils();

  const { data: health, isLoading: healthLoading } = trpc.onec.health.useQuery();
  const { data: status } = trpc.onec.status.useQuery();

  const syncProducts = trpc.onec.syncProducts.useMutation({
    onSuccess: (r) => { notify.success(t(`Синхронизировано: ${r.synced} товаров`, `Sinxronizatsiya: ${r.synced} mahsulot`)); },
    onError: (e) => notify.error(e.message),
  });

  return (
    <div className="space-y-6">
      {/* Статус соединения */}
      <div>
        <p className="font-label text-[10px] text-secondary tracking-wider mb-3">
          {t("СТАТУС СОЕДИНЕНИЯ", "ULANISH HOLATI")}
        </p>
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg"
          style={{
            background: health?.healthy ? "rgba(74,222,128,.10)" : "var(--color-danger-subtle, rgba(232,80,80,.10))",
            border: `1px solid ${health?.healthy ? "rgba(74,222,128,.25)" : "color-mix(in srgb, #d45050 25%, transparent)"}`,
          }}>
          {healthLoading ? (
            <Loader2 size={18} className="text-secondary animate-spin" />
          ) : health?.healthy ? (
            <CheckCircle2 size={18} className="text-success flex-shrink-0" />
          ) : (
            <XCircle size={18} className="text-danger flex-shrink-0" />
          )}
          <div className="flex-1">
            <p className="text-sm font-medium text-primary">
              {health?.healthy
                ? t("1С Bridge подключён", "1C Bridge ulangan")
                : t("1С Bridge не подключён", "1C Bridge ulanmagan")}
            </p>
            <p className="text-xs text-secondary mt-0.5">
              {health?.healthy
                ? t("Соединение активно", "Ulanish faol")
                : health?.error ?? t("Проверьте настройки подключения", "Ulanish sozlamalarini tekshiring")}
            </p>
          </div>
        </div>
      </div>

      {/* Настройки подключения */}
      <div>
        <p className="font-label text-[10px] text-secondary tracking-wider mb-3">
          {t("НАСТРОЙКИ ПОДКЛЮЧЕНИЯ", "ULANISH SOZLAMALARI")}
        </p>
        <div className="space-y-3">
          <div className="p-4 rounded-lg" style={{ background: "var(--color-surface-light, #f0f3f8)" }}>
            <p className="text-xs text-secondary mb-2">
              {t("Для подключения 1С:Предприятие необходим Bridge-сервер.", "1C:Predpriyatiye bilan ulanish uchun Bridge server kerak.")}
            </p>
            <p className="text-xs text-secondary">
              {t("Установите переменные окружения на сервере:", "Serverda muhit o'zgaruvchilarini o'rnating:")}
            </p>
            <pre className="mt-2 p-3 rounded-lg text-xs font-mono overflow-x-auto"
              style={{ background: "var(--color-surface, #ffffff)", border: "1px solid var(--color-border, #f0f3f8)" }}>
{`ONEC_BRIDGE_URL=http://bridge-server:8080
ONEC_USERNAME=your_user
ONEC_PASSWORD=your_password
ONEC_WEBHOOK_SECRET=your_secret`}
            </pre>
          </div>

          <div className="p-4 rounded-lg" style={{ background: "var(--color-surface-light, #f0f3f8)" }}>
            <p className="text-xs text-secondary mb-2">
              {t("Webhook URL для 1С (настройте в 1С:Предприятие):", "1C uchun webhook URL (1C:Predpriyatoyedagi sozlamalarda):")}
            </p>
            <pre className="mt-2 p-3 rounded-lg text-xs font-mono overflow-x-auto"
              style={{ background: "var(--color-surface, #ffffff)", border: "1px solid var(--color-border, #f0f3f8)" }}>
{`Оплата: https://www.warehouse-pro.uz/api/webhooks/1c/payment
Остатки: https://www.warehouse-pro.uz/api/webhooks/1c/stock`}
            </pre>
          </div>
        </div>
      </div>

      {/* Синхронизация */}
      <div>
        <p className="font-label text-[10px] text-secondary tracking-wider mb-3">
          {t("СИНХРОНИЗАЦИЯ", "SINXRONIZATSIYA")}
        </p>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-4 rounded-lg" style={{ background: "var(--color-surface-light, #f0f3f8)" }}>
            <div>
              <p className="text-sm font-medium text-primary">{t("Товары из 1С", "1C dan mahsulotlar")}</p>
              <p className="text-xs text-secondary mt-0.5">
                {t("Загрузить товары, цены и остатки из 1С", "1C dan mahsulotlar, narxlar va qoldiqlarni yuklash")}
              </p>
            </div>
            <button
              onClick={() => syncProducts.mutate()}
              disabled={syncProducts.isPending || !health?.healthy}
              className="neo-btn-primary flex items-center gap-2 text-sm disabled:opacity-40"
            >
              {syncProducts.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {t("Синхронизировать", "Sinxronlashtirish")}
            </button>
          </div>

          {status && (
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg" style={{ background: "var(--color-surface-light, #f0f3f8)" }}>
                <p className="text-[10px] text-secondary tracking-wider mb-1">
                  {t("ПОСЛЕДНЯЯ СИНХРОНИЗАЦИЯ", "OXIRGI SINXRONIZATSIYA")}
                </p>
                <p className="text-sm font-medium text-primary">
                  {status.lastProductSync
                    ? new Date(status.lastProductSync).toLocaleString("ru")
                    : t("Не выполнялась", "Bajarilmagan")}
                </p>
              </div>
              <div className="p-3 rounded-lg" style={{ background: "var(--color-surface-light, #f0f3f8)" }}>
                <p className="text-[10px] text-secondary tracking-wider mb-1">
                  {t("ОШИБКИ", "XATOLIKLAR")}
                </p>
                <p className={`text-sm font-medium ${status.errors > 0 ? "text-danger" : "text-success"}`}>
                  {status.errors ?? 0}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Документация */}
      <div className="p-4 rounded-lg" style={{ background: "var(--color-surface-light, #f0f3f8)" }}>
        <div className="flex items-start gap-3">
          <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-primary mb-1">
              {t("Важно", "Muhim")}
            </p>
            <p className="text-xs text-secondary leading-relaxed">
              {t(
                "Для работы интеграции необходим Bridge-сервер, который связывает 1С:Предприятие с Warehouse Pro. Обратитесь к поставщику 1С для настройки Bridge.",
                "Integratsiya uchun 1C:Predpriyatiye ni Warehouse Pro bilan bog'laydigan Bridge server kerak. Bridge ni sozlash uchun 1C yetkazib beruvchisiga murojaat qiling."
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Referral ──────────────────────────────────────────────────────────────────
function ReferralSettings() {
  return <ReferralCard />;
}

// ── Секции ────────────────────────────────────────────────────────────────────
const SECTIONS = [
  { key: "profile",    iconRu: "Профиль",    iconUz: "Profil",        Icon: User,      Comp: ProfileSettings    },
  { key: "company",   iconRu: "Компания",   iconUz: "Kompaniya",     Icon: Building2, Comp: CompanySettings    },
  { key: "telegram",  iconRu: "Telegram",   iconUz: "Telegram",      Icon: Bell,      Comp: TelegramSettings   },
  { key: "onec",      iconRu: "1С",         iconUz: "1C",            Icon: Database,  Comp: OneCSettings       },
  { key: "referral",  iconRu: "Реферал",    iconUz: "Taklif",        Icon: Gift,      Comp: ReferralSettings   },
  { key: "appearance",iconRu: "Внешний вид",iconUz: "Ko'rinish",     Icon: Moon,      Comp: AppearanceSettings },
];

export default function Settings() {
  const [active, setActive] = useState("profile");
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const Current = SECTIONS.find(s => s.key === active)?.Comp ?? ProfileSettings;

  return (
    <div className="max-w-3xl mx-auto animate-fade-up">
      <h1 className="font-display text-2xl font-bold text-primary tracking-tight mb-5">{t("Настройки", "Sozlamalar")}</h1>

      <div className="flex flex-col sm:flex-row gap-5">
        {/* Боковое меню */}
        <nav className="sm:w-44 flex-shrink-0">
          <div className="neo-card p-2 flex sm:flex-col gap-1">
            {SECTIONS.map(s => {
              const Icon = s.Icon;
              return (
                <button key={s.key} onClick={() => setActive(s.key)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-sm font-medium transition-all w-full ${
                    active === s.key
                      ? "bg-primary/10 text-primary"
                      : "text-secondary hover:text-primary hover:bg-surface-light"
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
          <h2 className="font-display text-base text-primary mb-5">
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
