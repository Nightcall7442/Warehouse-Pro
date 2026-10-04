import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, KeyRound, LogOut, User } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useLang } from "@/i18n";
import { Field, FieldRow } from "./ui";
import { useConfirm } from "@/components/ConfirmDialog";
import { TotpBlock } from "./TotpBlock";
import { Block, Note, ActionButton, type Msg, type T } from "./profile-ui";
import { errorText } from "@/lib/error-text";

/**
 * Профиль: четыре отдельных блока — «Имя и телефон», «Логин и пароль»,
 * «Вход с кодом из приложения», «Сеансы». Тот же порядок у строк профиля
 * на телефоне (components/phone/PhoneProfile), и строки ведут сюда же, к
 * своему блоку (?block=…).
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Всё одной лентой: имя, логин, смена логина, смена пароля, второй фактор,
 * выход — с полосками-разделителями и общим «сохранить» внизу каждого
 * куска, а успех и ошибка — всплывашкой, которая на телефоне исчезает раньше,
 * чем её прочтут. Владелец, 01.10.2026, с телефона: «смешал всё. Сделай
 * аккуратно, чётко и раздельно». И подсказка «имя видят коллеги» — у
 * суперадмина, у которого коллег нет.
 *
 * Теперь у каждого блока своя карточка, своя кнопка и своё сообщение об
 * успехе или ошибке прямо под кнопкой. Смена логина и смена пароля живут в
 * одном блоке, но раскрываются по отдельности: два поля «текущий пароль»
 * на одном экране путали и людей, и подстановку паролей в iPhone.
 *
 * Адрес почты — это логин: вход ищет человека по нему. Сотруднику
 * организации его меняет администратор, поэтому у него это надпись, а не
 * поле (поле молча не сохранялось — сервер почту в updateMe не принимает).
 * Суперадмину идти не к кому — он меняет логин сам (user.changeMyLogin).
 */

export function ProfileSettings() {
  const { user } = useAuth();
  const { lang } = useLang();
  const t: T = (ru, uz) => lang === "uz" ? uz : ru;
  const isSuper = user?.role === "superadmin";
  const totpOn = Boolean((user as { totpEnabledAt?: unknown } | null)?.totpEnabledAt);

  /*
    Строка профиля на телефоне ведёт сюда с ?block=…: раздел длинный, и
    человек, нажавший «Сеансы», не должен листать до них сам. Читается из
    адреса окна, а не из роутера: раздел рисуется и вне него (тесты разделов).
  */
  useEffect(() => {
    const block = new URLSearchParams(window.location.search).get("block");
    if (!block) return;
    const el = document.getElementById(`profile-${block}`);
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start" });
  }, []);

  return (
    <div className="space-y-5" data-testid="profile-blocks">
      <NameBlock t={t} isSuper={isSuper} name={user?.name ?? ""} phone={user?.phone ?? ""} />
      <LoginBlock t={t} isSuper={isSuper} email={user?.email ?? ""} totpOn={totpOn} />
      <TotpBlock t={t} role={user?.role ?? ""} userId={user?.id ?? 0} totpOn={totpOn} />
      <SessionsBlock t={t} />
    </div>
  );
}

/** Раскрывающееся действие внутри блока («Сменить логин», «Сменить пароль»). */
function Disclosure({ title, subtitle, open, onToggle, children, testId }: {
  title: string; subtitle?: string; open: boolean; onToggle: () => void; children: ReactNode; testId: string;
}) {
  return (
    <div className="rounded-2xl" style={{ background: "var(--color-surface-light)" }}>
      <button type="button" onClick={onToggle} aria-expanded={open} data-testid={`${testId}-toggle`}
        className="w-full flex items-center gap-3 text-left px-4 rounded-2xl" style={{ minHeight: 52 }}>
        <span className="flex-1 min-w-0 py-2">
          <span className="block font-semibold text-primary" style={{ fontSize: 14 }}>{title}</span>
          {subtitle && <span className="block text-secondary" style={{ fontSize: 12, marginTop: 2 }}>{subtitle}</span>}
        </span>
        <ChevronDown size={18} color="var(--color-text-tertiary)" style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .2s" }} />
      </button>
      {open && <div className="px-4 pb-4 pt-1" data-testid={testId}>{children}</div>}
    </div>
  );
}

/* ── Имя и телефон ─────────────────────────────────────────────────────── */

function NameBlock({ t, isSuper, name, phone }: { t: T; isSuper: boolean; name: string; phone: string }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({ name, phone });
  const [msg, setMsg] = useState<Msg>(null);
  const save = trpc.user.updateMe.useMutation({
    onSuccess: () => { utils.auth.me.invalidate(); setMsg({ kind: "ok", text: t("Сохранено", "Saqlandi") }); },
    onError: (e) => setMsg({ kind: "error", text: errorText(e) }),
  });

  return (
    <Block id="name" icon={User} title={t("Имя и телефон", "Ism va telefon")}>
      <FieldRow>
        <Field label={t("Имя", "Ism")}
          hint={isSuper
            ? t("Как вас подписывать в журнале действий и уведомлениях", "Harakatlar jurnali va bildirishnomalarda sizni qanday imzolash")
            : t("Имя видят коллеги в заказах и отчётах", "Ismni hamkasblar buyurtma va hisobotlarda ko'radi")}>
          <input className="neo-input" autoComplete="name"
            value={form.name} onChange={e => { setForm({ ...form, name: e.target.value }); setMsg(null); }} />
        </Field>
        <Field label={t("Телефон", "Telefon")}
          hint={isSuper ? t("Необязательно", "Ixtiyoriy") : t("Для звонков из заказов", "Buyurtmalardan qo'ng'iroq uchun")}>
          <input className="neo-input" type="tel" autoComplete="tel" placeholder="+998 XX XXX XX XX"
            value={form.phone} onChange={e => { setForm({ ...form, phone: e.target.value }); setMsg(null); }} />
        </Field>
      </FieldRow>
      <div className="mt-4">
        <ActionButton testId="name-save" full pending={save.isPending} disabled={form.name.trim().length < 2}
          onClick={() => save.mutate({ name: form.name.trim(), phone: form.phone.trim() })}>
          {t("Сохранить", "Saqlash")}
        </ActionButton>
      </div>
      <Note msg={msg} testId="name-note" />
    </Block>
  );
}

/* ── Логин и пароль ────────────────────────────────────────────────────── */

function LoginBlock({ t, isSuper, email, totpOn }: { t: T; isSuper: boolean; email: string; totpOn: boolean }) {
  const [open, setOpen] = useState<"login" | "password" | null>(null);
  const toggle = (k: "login" | "password") => setOpen(v => v === k ? null : k);

  return (
    <Block id="login" icon={KeyRound} title={t("Логин и пароль", "Login va parol")}>
      <p className="text-secondary" style={{ fontSize: 13 }}>{t("Ваш логин для входа", "Kirish uchun loginingiz")}</p>
      <p className="font-semibold text-primary" style={{ fontSize: 18, overflowWrap: "anywhere", marginTop: 2 }} data-testid="my-login-current">{email}</p>
      {!isSuper && (
        <p className="text-tertiary mt-1" style={{ fontSize: 12 }} data-testid="login-readonly">
          {t("Сменить логин может администратор организации.", "Loginni tashkilot administratori o'zgartira oladi.")}
        </p>
      )}

      <div className="mt-4 space-y-3">
        {isSuper && (
          <Disclosure testId="my-login" open={open === "login"} onToggle={() => toggle("login")}
            title={t("Сменить логин", "Loginni o'zgartirish")}
            subtitle={t("Новый адрес почты для входа", "Kirish uchun yangi pochta manzili")}>
            <ChangeLogin t={t} email={email} totpOn={totpOn} />
          </Disclosure>
        )}
        <Disclosure testId="change-password" open={open === "password"} onToggle={() => toggle("password")}
          title={t("Сменить пароль", "Parolni o'zgartirish")}
          subtitle={t("Текущий, новый и ещё раз новый", "Joriy, yangi va yana bir bor yangi")}>
          <ChangePassword t={t} />
        </Disclosure>
      </div>
    </Block>
  );
}

/*
  Логин суперадмина. У сотрудника организации логин меняет директор или
  суперадмин, а над суперадмином никого нет: superadmin@system.local из
  засева оставался навсегда (владелец, 01.10.2026). Смена — по текущему
  паролю и, если второй фактор включён, по коду из приложения. Прочие входы
  после смены гаснут, эта вкладка получает новую куку и остаётся.
*/
function ChangeLogin({ t, email, totpOn }: { t: T; email: string; totpOn: boolean }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({ email: "", password: "", code: "" });
  const [msg, setMsg] = useState<Msg>(null);
  const change = trpc.user.changeMyLogin.useMutation({
    onSuccess: (r) => {
      setForm({ email: "", password: "", code: "" });
      utils.auth.me.invalidate();
      setMsg({ kind: "ok", text: t(`Логин изменён: ${r.email}. На других устройствах войдите заново с новым логином.`,
                                   `Login o'zgartirildi: ${r.email}. Boshqa qurilmalarda yangi login bilan qayta kiring.`) });
    },
    onError: (e) => setMsg({ kind: "error", text: errorText(e) }),
  });
  const next = form.email.trim().toLowerCase();
  const ready = next.includes("@") && next !== email.toLowerCase() && form.password.length > 0 && (!totpOn || form.code.trim().length >= 6);
  const edit = (patch: Partial<typeof form>) => { setForm({ ...form, ...patch }); setMsg(null); };

  return (
    <div className="space-y-4">
      <Field label={t("Новый логин (почта)", "Yangi login (pochta)")}>
        <input className="neo-input" type="email" autoComplete="username" placeholder="owner@example.com"
          value={form.email} onChange={e => edit({ email: e.target.value })} data-testid="my-login-email" />
      </Field>
      <Field label={t("Текущий пароль", "Joriy parol")}>
        <input className="neo-input" type="password" autoComplete="current-password"
          value={form.password} onChange={e => edit({ password: e.target.value })} data-testid="my-login-password" />
      </Field>
      {totpOn ? (
        <Field label={t("Код из приложения", "Ilovadagi kod")}>
          <input className="neo-input" inputMode="numeric" autoComplete="one-time-code" maxLength={8}
            value={form.code} onChange={e => edit({ code: e.target.value })} data-testid="my-login-code" />
        </Field>
      ) : (
        <p className="rounded-xl px-3 py-2.5" style={{ fontSize: 13, lineHeight: 1.45, background: "var(--color-warning-subtle)", color: "var(--color-warning-text)" }} data-testid="my-login-no-totp">
          {t("Вход с кодом из приложения не включён — логин сейчас меняется по одному паролю. Включите его в блоке ниже: тогда смену логина подтвердит и код.",
             "Ilova kodi bilan kirish yoqilmagan — login hozir faqat parol bilan o'zgaradi. Uni quyidagi blokda yoqing: shunda login o'zgarishini kod ham tasdiqlaydi.")}
        </p>
      )}
      <div>
        <ActionButton testId="my-login-save" full pending={change.isPending} disabled={!ready}
          onClick={() => change.mutate({ email: next, currentPassword: form.password, code: totpOn ? form.code.trim() : undefined })}>
          {t("Сменить логин", "Loginni o'zgartirish")}
        </ActionButton>
        <p className="text-tertiary mt-2" style={{ fontSize: 12 }}>
          {t("Другие устройства выйдут, это останется в системе.", "Boshqa qurilmalar chiqadi, bu qurilma tizimda qoladi.")}
        </p>
      </div>
      <Note msg={msg} testId="my-login-note" />
    </div>
  );
}

/*
  Смена пароля поднимает версию ключа (api/user-router.ts) и гасит ВСЕ
  сессии, включая эту вкладку. Поэтому сказано заранее, а после успеха
  человека уводят на вход сами — иначе через несколько секунд его выкинуло бы
  без объяснений.
*/
function ChangePassword({ t }: { t: T }) {
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [msg, setMsg] = useState<Msg>(null);
  const change = trpc.user.changePassword.useMutation({
    onSuccess: () => {
      setPw({ current: "", next: "", confirm: "" });
      setMsg({ kind: "ok", text: t("Пароль изменён. Сейчас откроется вход — войдите с новым паролем.", "Parol o'zgartirildi. Hozir kirish ochiladi — yangi parol bilan kiring.") });
      setTimeout(() => window.location.replace("/login"), 1500);
    },
    onError: (e) => setMsg({ kind: "error", text: errorText(e) }),
  });
  const edit = (patch: Partial<typeof pw>) => { setPw({ ...pw, ...patch }); setMsg(null); };
  const mismatch = pw.confirm.length > 0 && pw.next !== pw.confirm;
  const short = pw.next.length > 0 && pw.next.length < 8;
  const ready = pw.current.length > 0 && pw.next.length >= 8 && pw.next === pw.confirm;

  return (
    <div className="space-y-4">
      <Field label={t("Текущий пароль", "Joriy parol")}>
        <input type="password" className="neo-input" autoComplete="current-password"
          value={pw.current} onChange={e => edit({ current: e.target.value })} data-testid="password-current" />
      </Field>
      <Field label={t("Новый пароль", "Yangi parol")} hint={short ? t("Не короче 8 знаков", "Kamida 8 ta belgi") : undefined}>
        <input type="password" className="neo-input" autoComplete="new-password"
          value={pw.next} onChange={e => edit({ next: e.target.value })} data-testid="password-next" />
      </Field>
      <Field label={t("Повторите новый", "Yangi parolni takrorlang")} hint={mismatch ? t("Пароли не совпадают", "Parollar mos emas") : undefined}>
        <input type="password" className="neo-input" autoComplete="new-password"
          value={pw.confirm} onChange={e => edit({ confirm: e.target.value })} data-testid="password-confirm" />
      </Field>
      <div>
        <ActionButton testId="password-save" full pending={change.isPending} disabled={!ready}
          onClick={() => change.mutate({ currentPassword: pw.current, newPassword: pw.next })}>
          {t("Сменить пароль", "Parolni o'zgartirish")}
        </ActionButton>
        <p className="text-tertiary mt-2" style={{ fontSize: 12 }}>
          {t("Потом войти заново придётся на всех устройствах, включая это.", "Keyin barcha qurilmalarda, shu jumladan bu yerda ham, qaytadan kirish kerak bo'ladi.")}
        </p>
      </div>
      <Note msg={msg} testId="password-note" />
    </div>
  );
}

/* ── Сеансы ────────────────────────────────────────────────────────────── */

/*
  Выход на всех устройствах. Нужен ровно тогда, ради чего заведён: телефон
  потеряли, ноутбук остался у бывшего сотрудника, пароль подсмотрели. Смена
  пароля — не то же самое: чужая сессия живёт своим ключом.

  Выходит и ЭТО устройство: сервер поднимает версию ключа, а она общая для
  всех входов человека. Прежняя надпись «кроме этого устройства» обещала
  обратное — теперь сказано, как есть, и после успеха открывается вход.
*/
function SessionsBlock({ t }: { t: T }) {
  const { confirm, dialog } = useConfirm();
  const [msg, setMsg] = useState<Msg>(null);
  const logoutAll = trpc.user.logoutAll.useMutation({
    onSuccess: () => {
      setMsg({ kind: "ok", text: t("Все входы завершены. Открываю вход…", "Barcha kirishlar tugatildi. Kirish ochilmoqda…") });
      window.location.href = "/login";
    },
    onError: (e) => setMsg({ kind: "error", text: errorText(e) }),
  });

  return (
    <Block id="sessions" icon={LogOut} title={t("Сеансы", "Seanslar")}>
      <p className="text-secondary max-w-prose" style={{ fontSize: 13, lineHeight: 1.5 }} data-testid="sessions-text">
        {t("Завершает все входы в ваш аккаунт — на телефонах, компьютерах и на этом устройстве тоже. Пригодится, если телефон потерян или ноутбук остался у бывшего сотрудника. После этого войдите заново.",
           "Hisobingizdagi barcha kirishlarni tugatadi — telefonlarda, kompyuterlarda va shu qurilmada ham. Telefon yo'qolgan yoki noutbuk sobiq xodimda qolgan bo'lsa kerak bo'ladi. Keyin qaytadan kiring.")}
      </p>
      <div className="mt-4">
        <ActionButton testId="logout-all" primary={false} full pending={logoutAll.isPending}
          onClick={async () => {
            const ok = await confirm({
              title: t("Выйти на всех устройствах?", "Barcha qurilmalardan chiqilsinmi?"),
              message: t("Все входы будут завершены, включая это устройство — придётся войти заново.",
                         "Barcha kirishlar tugatiladi, shu qurilma ham — qaytadan kirish kerak bo'ladi."),
              confirmText: t("Выйти везде", "Hamma joydan chiqish"),
              danger: true,
            });
            if (ok) logoutAll.mutate();
          }}>
          {t("Выйти на всех устройствах", "Barcha qurilmalardan chiqish")}
        </ActionButton>
      </div>
      <Note msg={msg} testId="sessions-note" />
      {dialog}
    </Block>
  );
}

