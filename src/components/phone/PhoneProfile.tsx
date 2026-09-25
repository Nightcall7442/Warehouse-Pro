import { useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import {
  AlertCircle, Bell, Building2, Camera, ChevronDown, ChevronRight, DollarSign, Globe, Key, Loader2,
  LogOut, Mail, Moon, ShieldCheck, Sun, User,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { compressImage } from "@/lib/compress-image";
import { useConfirm } from "@/components/ConfirmDialog";
import { useAppBrand } from "@/hooks/useAppBrand";
import { ROLE_LABEL } from "@contracts/entity-labels";
import { APP_VERSION } from "@contracts/constants";
import { QuotaCard } from "./PhonePlan";

/*
  Профиль на телефоне — вкладка «Профиль» мобилки v8 (Warehouse-Pro-Mobile,
  app/(tabs)/profile.tsx): человек сверху, норма месяца для полевых, «Деньги»,
  «Аккаунт» (имя, почта, пароль), «Оформление» (тема и язык) и выход.
  Строки 56 точек на белых плоскостях, действие открывается нажатием на
  строку. Владелец, 25.09.2026: «все сделай абсолютно».

  Всё остальное из настроек (организация, накладные, Telegram, вторая защита
  входа) никуда не делось — строки ведут в соответствующий раздел полной
  страницы настроек (/settings?section=…).
*/

function Group({ children }: { children: ReactNode }) {
  return <div style={{ background: "var(--color-surface)", boxShadow: "var(--shadow-sm)", borderRadius: 20, overflow: "hidden" }}>{children}</div>;
}
function Label({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", letterSpacing: "0.06em", textTransform: "uppercase", margin: "0 0 8px 4px" }}>{children}</p>;
}
function Line() {
  return <div style={{ height: 1, background: "var(--color-border-subtle)", marginLeft: 64 }} />;
}
function Row({ icon: Icon, tone, title, subtitle, value, right, onClick, danger, testId }: {
  icon: LucideIcon; tone?: string; title: string; subtitle?: string; value?: string; right?: ReactNode;
  onClick?: () => void; danger?: boolean; testId?: string;
}) {
  const inner = (
    <>
      <span className="flex items-center justify-center flex-shrink-0 rounded-full" style={{ width: 36, height: 36, background: danger ? "var(--color-danger-subtle)" : "var(--color-surface-light)" }}>
        <Icon size={18} color={tone ?? (danger ? "var(--color-danger-text)" : "var(--color-text-secondary)")} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block truncate" style={{ fontSize: 15, fontWeight: 500, color: danger ? "var(--color-danger-text)" : "var(--color-text-primary)" }}>{title}</span>
        {subtitle && <span className="block" style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>{subtitle}</span>}
      </span>
      {value && <span className="truncate" style={{ fontSize: 13, color: "var(--color-text-secondary)", maxWidth: "45%" }}>{value}</span>}
      {right ?? (onClick ? <ChevronRight size={18} color="var(--color-text-tertiary)" /> : null)}
    </>
  );
  const style = { display: "flex", alignItems: "center", gap: 12, minHeight: 56, padding: "10px 16px", width: "100%", textAlign: "left" as const };
  return onClick
    ? <button type="button" onClick={onClick} style={style} className="active:bg-[var(--color-surface-light)]" data-testid={testId}>{inner}</button>
    : <div style={style} data-testid={testId}>{inner}</div>;
}
function Segment<T extends string>({ value, options, onChange }: { value: T; options: Array<{ key: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-xl p-[3px] flex-shrink-0" style={{ background: "var(--color-field)", boxShadow: "var(--shadow-pressed)" }}>
      {options.map(o => {
        const on = o.key === value;
        return (
          <button key={o.key} type="button" aria-pressed={on} onClick={() => onChange(o.key)} className="rounded-[9px]"
            style={{ padding: "7px 12px", fontSize: 13, fontWeight: on ? 600 : 500, background: on ? "var(--color-surface)" : "transparent", color: on ? "var(--color-text-primary)" : "var(--color-text-secondary)", boxShadow: on ? "var(--shadow-xs)" : "none" }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
const input = "neo-input";

export function PhoneProfile() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { lang, setLang } = useLang();
  const { name: appName } = useAppBrand();
  const navigate = useNavigate();
  const { confirm, dialog } = useConfirm();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const utils = trpc.useUtils();
  const file = useRef<HTMLInputElement>(null);

  const role = user?.role ?? "";
  const isField = role === "agent" || role === "merchandiser";
  const hasPay = role === "agent" || role === "courier" || role === "merchandiser";
  const isOffice = role === "ceo" || role === "operator";
  const avatar = (user as { avatar?: string | null } | null)?.avatar ?? null;

  const [editName, setEditName] = useState(false);
  const [form, setForm] = useState({ name: user?.name ?? "", phone: user?.phone ?? "" });
  const [editPwd, setEditPwd] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });

  const updateMe = trpc.user.updateMe.useMutation({
    onSuccess: () => { utils.auth.me.invalidate(); setEditName(false); notify.success(t("Сохранено", "Saqlandi")); },
    onError: e => notify.error(e.message),
  });
  const changePassword = trpc.user.changePassword.useMutation({
    onSuccess: () => {
      setPw({ current: "", next: "", confirm: "" });
      notify.success(t("Пароль изменён. Войдите заново.", "Parol o'zgartirildi. Qaytadan kiring."));
      // Смена пароля гасит все сессии, включая эту, — уводим на вход сами.
      setTimeout(() => window.location.replace("/login"), 1500);
    },
    onError: e => notify.error(e.message),
  });

  const pickAvatar = async (f: File | undefined) => {
    if (!f) return;
    try { updateMe.mutate({ avatar: await compressImage(f, { maxDimension: 400 }) }); }
    catch { notify.error(t("Не удалось обработать снимок", "Rasmni qayta ishlab bo'lmadi")); }
  };
  const submitPwd = () => {
    if (!pw.current || !pw.next) return notify.error(t("Заполните все поля", "Barcha maydonlarni to'ldiring"));
    if (pw.next !== pw.confirm) return notify.error(t("Пароли не совпадают", "Parollar mos emas"));
    if (pw.next.length < 8) return notify.error(t("Минимум 8 символов", "Kamida 8 ta belgi"));
    changePassword.mutate({ currentPassword: pw.current, newPassword: pw.next });
  };
  const askLogout = async () => {
    if (await confirm({ title: t("Выйти из аккаунта?", "Hisobdan chiqasizmi?"), message: t("Вы уверены?", "Ishonchingiz komilmi?"), confirmText: t("Выйти", "Chiqish"), danger: true })) logout();
  };

  const initials = (user?.name ?? "?").split(" ").filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join("");
  const roleLabel = ROLE_LABEL[role as keyof typeof ROLE_LABEL]?.[lang] ?? role;

  return (
    <div className="space-y-6 animate-fade-up" data-testid="phone-profile">
      {dialog}
      {/* ── Человек ── */}
      <div className="flex flex-col items-center pt-2">
        <button type="button" onClick={() => file.current?.click()} aria-label={t("Сменить фото", "Rasmni almashtirish")} className="relative">
          <span className="flex items-center justify-center overflow-hidden rounded-full" style={{ width: 88, height: 88, background: "var(--color-primary-subtle)" }}>
            {avatar
              ? <img src={avatar} alt="" className="w-full h-full object-cover" />
              : <span style={{ fontSize: 30, fontWeight: 700, color: "var(--color-primary-text)" }}>{initials}</span>}
            {updateMe.isPending && <span className="absolute inset-0 flex items-center justify-center rounded-full" style={{ background: "color-mix(in srgb, var(--color-text-primary) 45%, transparent)" }}><Loader2 size={20} className="animate-spin" color="var(--color-surface)" /></span>}
          </span>
          <span className="absolute flex items-center justify-center rounded-full" style={{ right: -2, bottom: -2, width: 30, height: 30, background: "var(--color-surface)", border: "2px solid var(--color-canvas)" }}>
            <Camera size={14} color="var(--color-text-secondary)" />
          </span>
        </button>
        <input ref={file} type="file" accept="image/*" className="hidden" onChange={e => { void pickAvatar(e.target.files?.[0]); e.target.value = ""; }} />
        <p className="truncate max-w-full" style={{ fontSize: 22, fontWeight: 700, color: "var(--color-text-primary)", margin: "12px 0 0" }}>{user?.name ?? "—"}</p>
        <p className="truncate max-w-full" style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "2px 0 0" }}>{user?.email ?? ""}</p>
        <span className="rounded-full px-3 py-1 mt-2.5" style={{ fontSize: 12, fontWeight: 600, background: "var(--color-info-subtle)", color: "var(--color-info-text)" }}>{roleLabel}</span>
      </div>

      {/* ── Норма месяца — то, ради чего полевой открывает вкладку ── */}
      {isField && <QuotaCard />}

      {/* ── Деньги ── */}
      {hasPay && (
        <div>
          <Label>{t("Деньги", "Pul")}</Label>
          <Group>
            <Row icon={DollarSign} tone="var(--color-primary-text)" title={t("Моя зарплата", "Mening oyligim")} subtitle={t("Начислено, выдано и подтверждение получения", "Hisoblangan, berilgan va olganini tasdiqlash")} onClick={() => navigate("/agent/kpi")} />
            {role !== "courier" && (
              <>
                <Line />
                <Row icon={AlertCircle} tone="var(--color-danger-text)" title={t("Мои долги", "Mening qarzlarim")} subtitle={t("Кому идти собирать деньги", "Kimdan pul yig'ish kerak")} onClick={() => navigate("/agent/debts")} />
              </>
            )}
          </Group>
        </div>
      )}

      {/* ── Аккаунт ── */}
      <div>
        <Label>{t("Аккаунт", "Hisob")}</Label>
        <Group>
          <Row icon={User} title={t("Имя и телефон", "Ism va telefon")} value={editName ? undefined : user?.name ?? "—"} onClick={() => setEditName(v => !v)}
            right={editName ? <ChevronDown size={18} color="var(--color-text-tertiary)" /> : <ChevronRight size={18} color="var(--color-text-tertiary)" />} testId="profile-name-row" />
          {editName && (
            <div className="px-4 pb-4 space-y-2">
              <input className={input} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={t("Как вас зовут", "Ismingiz")} autoComplete="name" />
              <input className={input} type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+998 XX XXX XX XX" autoComplete="tel" />
              <button type="button" className="neo-btn-primary w-full" disabled={form.name.trim().length < 2 || updateMe.isPending}
                onClick={() => updateMe.mutate({ name: form.name.trim(), phone: form.phone.trim() })}>
                {t("Сохранить", "Saqlash")}
              </button>
            </div>
          )}
          <Line />
          <Row icon={Mail} title="Email" value={user?.email ?? "—"} />
          <Line />
          <Row icon={Key} title={t("Пароль", "Parol")} subtitle={editPwd ? undefined : t("Сменить пароль входа", "Kirish parolini almashtirish")} onClick={() => setEditPwd(v => !v)}
            right={editPwd ? <ChevronDown size={18} color="var(--color-text-tertiary)" /> : <ChevronRight size={18} color="var(--color-text-tertiary)" />} />
          {editPwd && (
            <div className="px-4 pb-4 space-y-2">
              <input className={input} type="password" autoComplete="current-password" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} placeholder={t("Текущий пароль", "Joriy parol")} />
              <input className={input} type="password" autoComplete="new-password" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} placeholder={t("Новый пароль (не короче 8)", "Yangi parol (kamida 8)")} />
              <input className={input} type="password" autoComplete="new-password" value={pw.confirm} onChange={e => setPw({ ...pw, confirm: e.target.value })} placeholder={t("Повторите новый пароль", "Yangi parolni takrorlang")} />
              <button type="button" className="neo-btn-primary w-full" disabled={!pw.current || !pw.next || changePassword.isPending} onClick={submitPwd}>
                {t("Изменить пароль", "Parolni o'zgartirish")}
              </button>
            </div>
          )}
          <Line />
          <Row icon={ShieldCheck} title={t("Защита входа", "Kirish himoyasi")} subtitle={t("Код из приложения, выход на всех устройствах", "Ilovadagi kod, barcha qurilmalardan chiqish")} onClick={() => navigate("/settings?section=profile")} />
        </Group>
      </div>

      {/* ── Оформление ── */}
      <div>
        <Label>{t("Оформление", "Ko'rinish")}</Label>
        <Group>
          <Row icon={theme === "dark" ? Moon : Sun} title={t("Тема", "Mavzu")}
            right={<Segment value={theme === "dark" ? "dark" : "light"} onChange={v => { if ((v === "dark") !== (theme === "dark")) toggle(); }}
              options={[{ key: "light", label: t("Светлая", "Yorug'") }, { key: "dark", label: t("Тёмная", "Qorong'i") }]} />} />
          <Line />
          <Row icon={Globe} title={t("Язык", "Til")}
            right={<Segment value={lang} onChange={v => setLang(v)} options={[{ key: "ru", label: "Русский" }, { key: "uz", label: "O'zbekcha" }]} />} />
        </Group>
      </div>

      {/* ── Уведомления и организация — разделы полной страницы настроек ── */}
      <Group>
        <Row icon={Bell} title="Telegram" subtitle={t("Уведомления в Telegram", "Telegram xabarnomalari")} onClick={() => navigate("/settings?section=telegram")} />
        {isOffice && (
          <>
            <Line />
            <Row icon={Building2} title={t("Организация", "Tashkilot")} subtitle={t("Реквизиты, склады, цены, накладные", "Rekvizitlar, omborlar, narxlar, nakladnoylar")} onClick={() => navigate(`/settings?section=${role === "ceo" ? "company" : "prices"}`)} />
          </>
        )}
      </Group>

      {/* ── Выход ── */}
      <Group>
        <Row icon={LogOut} danger title={t("Выйти из аккаунта", "Hisobdan chiqish")} onClick={() => void askLogout()} testId="profile-logout" />
      </Group>

      <p className="text-center" style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: 0 }}>{appName} v{APP_VERSION}</p>
    </div>
  );
}
