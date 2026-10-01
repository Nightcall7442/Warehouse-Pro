import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { FieldGroup, Field, FieldRow, SaveBar } from "./ui";
import { useConfirm } from "@/components/ConfirmDialog";

/**
 * Профиль: имя, телефон, пароль.
 *
 * ── Что здесь было не так ───────────────────────────────────────────────────
 *
 * Поле «Email» было обычным редактируемым инпутом, а сохранение звало
 * user.updateMe с одним лишь именем (api/user-router.ts принимает name, phone
 * и avatar — email там нет вовсе). То есть человек правил адрес, жал
 * «Сохранить», получал зелёное «Профиль обновлён» — и адрес оставался прежним.
 * Ни ошибки, ни объяснения.
 *
 * Адрес — это логин: вход ищет пользователя именно по нему. Поэтому он показан
 * как значение, а не как поле, с подписью, к кому идти за изменением. Кроме
 * суперадмина: идти ему не к кому, и логин он меняет сам (MyLogin ниже).
 *
 * Зато телефон сервер принимает, а формы для него не было — добавлена.
 */

export function ProfileSettings() {
  const { user } = useAuth();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const utils = trpc.useUtils();

  const { confirm, dialog } = useConfirm();

  /*
    Выход завершает и текущую сессию тоже: сервер поднимает версию ключа у
    пользователя, а она общая для всех его входов. Поэтому после успеха
    страница перезагружается — иначе человек остался бы на экране с ключом,
    которым сервер уже не пользуется, и получал бы отказы на каждый запрос.
  */
  const logoutAll = trpc.user.logoutAll.useMutation({
    onSuccess: () => {
      notify.success(t("Все входы завершены", "Barcha kirishlar tugatildi"));
      window.location.href = "/login";
    },
    onError: (e) => notify.error(e.message),
  });

  const [form, setForm] = useState({ name: user?.name ?? "", phone: user?.phone ?? "" });
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });

  /*
    Второй фактор. Секрет показывается один раз — при настройке; человек
    вводит его в приложение-аутентификатор и подтверждает первым кодом.
    ponytail: QR-кода нет (библиотеки в проекте нет) — ключ вводится руками,
    все аутентификаторы это умеют («ввести ключ настройки»).
  */
  const [totpSetup, setTotpSetup] = useState<{ secret: string; url: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const totpStart = trpc.user.totpSetup.useMutation({
    onSuccess: (r) => setTotpSetup(r),
    onError: (e) => notify.error(e.message),
  });
  const totpEnable = trpc.user.totpEnable.useMutation({
    onSuccess: () => { setTotpSetup(null); setTotpCode(""); utils.auth.me.invalidate(); notify.success(t("Двухфакторная защита включена", "Ikki bosqichli himoya yoqildi")); },
    onError: (e) => notify.error(e.message),
  });
  const totpDisable = trpc.user.totpDisable.useMutation({
    onSuccess: () => { setTotpCode(""); utils.auth.me.invalidate(); notify.success(t("Двухфакторная защита выключена", "Ikki bosqichli himoya o'chirildi")); },
    onError: (e) => notify.error(e.message),
  });
  const totpOn = Boolean((user as { totpEnabledAt?: unknown } | null)?.totpEnabledAt);
  const mustHaveTotp = user?.role === "ceo" || user?.role === "superadmin";

  const updateProfile = trpc.user.updateMe.useMutation({
    onSuccess: () => { utils.auth.me.invalidate(); notify.success(t("Профиль обновлён", "Profil yangilandi")); },
    onError:   (e) => notify.error(e.message),
  });
  // Смена пароля поднимает tokenVersion (api/user-router.ts), а значит гасит
  // ВСЕ сессии — включая текущую вкладку. Раньше об этом не говорили: человек
  // видел зелёное «Пароль изменён», продолжал работать, и через несколько
  // секунд его без объяснений выкидывало на вход. Теперь предупреждаем заранее
  // и уводим на вход сами.
  const changePassword = trpc.user.changePassword.useMutation({
    onSuccess: () => {
      setPwForm({ current: "", next: "", confirm: "" });
      notify.success(t("Пароль изменён. Войдите заново.", "Parol o'zgartirildi. Qaytadan kiring."));
      setTimeout(() => window.location.replace("/login"), 1500);
    },
    onError:   (e) => notify.error(e.message),
  });

  const pwReady = pwForm.current.length > 0 && pwForm.next.length > 0 && pwForm.next === pwForm.confirm;

  return (
    <div>
      <FieldGroup first>
        <FieldRow>
          <Field label={t("Имя", "Ism")}>
            <input className="neo-input" autoComplete="name"
              value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={t("Телефон", "Telefon")}
            hint={t("Для звонков из заказов", "Buyurtmalardan qo'ng'iroq uchun")}>
            <input className="neo-input" type="tel" autoComplete="tel" placeholder="+998 XX XXX XX XX"
              value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
          </Field>
        </FieldRow>

        {user?.role === "superadmin" ? null : (
          <div className="mt-4" data-testid="login-readonly">
            <p className="text-[13px] font-medium text-secondary mb-1.5">Email</p>
            <p className="text-sm text-primary font-medium">{user?.email}</p>
            <p className="text-xs text-tertiary mt-1">
              {t("Это логин для входа. Сменить его может администратор организации.",
                 "Bu — kirish uchun login. Uni tashkilot administratori o'zgartira oladi.")}
            </p>
          </div>
        )}

        <SaveBar
          onSave={() => updateProfile.mutate({ name: form.name, phone: form.phone })}
          isPending={updateProfile.isPending}
          disabled={form.name.trim().length < 2}
          label={t("Сохранить", "Saqlash")}
          hint={t("Имя видят коллеги в заказах и отчётах", "Ismni hamkasblar buyurtma va hisobotlarda ko'radi")}
        />
      </FieldGroup>

      {user?.role === "superadmin" && <MyLogin email={user.email ?? ""} totpOn={totpOn} t={t} />}

      <FieldGroup title={t("Смена пароля", "Parolni o'zgartirish")}>
        <div className="max-w-sm space-y-4">
          <Field label={t("Текущий пароль", "Joriy parol")}>
            <input type="password" className="neo-input" autoComplete="current-password"
              value={pwForm.current} onChange={e => setPwForm({ ...pwForm, current: e.target.value })} />
          </Field>
          <Field label={t("Новый пароль", "Yangi parol")}>
            <input type="password" className="neo-input" autoComplete="new-password"
              value={pwForm.next} onChange={e => setPwForm({ ...pwForm, next: e.target.value })} />
          </Field>
          <Field label={t("Повторите новый", "Yangi parolni takrorlang")}
            hint={pwForm.confirm && pwForm.next !== pwForm.confirm
              ? t("Пароли не совпадают", "Parollar mos emas")
              : undefined}>
            <input type="password" className="neo-input" autoComplete="new-password"
              value={pwForm.confirm} onChange={e => setPwForm({ ...pwForm, confirm: e.target.value })} />
          </Field>
        </div>

        <SaveBar
          onSave={() => changePassword.mutate({ currentPassword: pwForm.current, newPassword: pwForm.next })}
          isPending={changePassword.isPending}
          disabled={!pwReady}
          label={t("Изменить пароль", "Parolni o'zgartirish")}
          hint={t("Войти заново придётся на всех устройствах, включая это",
                  "Barcha qurilmalarda, shu jumladan shu yerda ham, qaytadan kirish kerak bo'ladi")}
        />
      </FieldGroup>


      {/*
        Выход на всех устройствах.

        Ручка была написана и не вызывалась ниоткуда, а нужна она в том самом
        случае, ради которого и заводится: телефон потеряли, ноутбук остался у
        бывшего сотрудника, пароль подсмотрели. Сменить пароль — не то же
        самое: чужая сессия живёт своим ключом и переживает смену.
      */}
      <FieldGroup title={t("Вход с кодом из приложения", "Ilova kodi bilan kirish")}>
        {totpOn ? (
          <div className="max-w-sm space-y-3" data-testid="totp-enabled">
            <p className="text-sm text-secondary max-w-prose">
              {t("Включено: при входе, кроме пароля, нужен код из приложения-аутентификатора.",
                 "Yoqilgan: kirishda parol bilan birga autentifikator ilovasidagi kod kerak.")}
            </p>
            <Field label={t("Код из приложения — чтобы выключить", "O'chirish uchun ilovadagi kod")}>
              <input className="neo-input" inputMode="numeric" autoComplete="one-time-code" value={totpCode} onChange={e => setTotpCode(e.target.value)} />
            </Field>
            <button className="neo-btn" disabled={totpDisable.isPending || totpCode.length < 6}
              onClick={() => totpDisable.mutate({ code: totpCode })} data-testid="totp-disable">
              {t("Выключить", "O'chirish")}
            </button>
          </div>
        ) : totpSetup ? (
          <div className="max-w-sm space-y-3" data-testid="totp-setup">
            <p className="text-sm text-secondary max-w-prose">
              {t("Откройте Google Authenticator (или любой другой), выберите «ввести ключ настройки» и введите ключ ниже. Затем подтвердите первым кодом.",
                 "Google Authenticator (yoki boshqasini) oching, «sozlash kalitini kiritish»ni tanlang va quyidagi kalitni kiriting. So'ng birinchi kod bilan tasdiqlang.")}
            </p>
            <Field label={t("Ключ настройки", "Sozlash kaliti")}>
              <input className="neo-input" readOnly value={totpSetup.secret} onFocus={e => e.currentTarget.select()} data-testid="totp-secret" />
            </Field>
            <a href={totpSetup.url} className="text-sm" style={{ color: "var(--color-primary-text)" }}>
              {t("Открыть в приложении на телефоне", "Telefondagi ilovada ochish")}
            </a>
            <Field label={t("Первый код из приложения", "Ilovadagi birinchi kod")}>
              <input className="neo-input" inputMode="numeric" autoComplete="one-time-code" value={totpCode} onChange={e => setTotpCode(e.target.value)} data-testid="totp-code" />
            </Field>
            <button className="neo-btn-primary" disabled={totpEnable.isPending || totpCode.length < 6}
              onClick={() => totpEnable.mutate({ code: totpCode })} data-testid="totp-enable">
              {t("Подтвердить и включить", "Tasdiqlash va yoqish")}
            </button>
          </div>
        ) : (
          <div className="max-w-sm space-y-3">
            <p className="text-sm max-w-prose" style={{ color: mustHaveTotp ? "var(--color-warning-text)" : undefined }}>
              {mustHaveTotp
                ? t("У директора и администратора платформы вход без второго фактора — главная дыра: пароль подсмотрели — и вся организация открыта. Включите.",
                    "Direktor va platforma administratori uchun ikkinchi omilsiz kirish — asosiy xavf. Yoqing.")
                : t("Дополнительная защита входа: пароль плюс код из приложения на телефоне.",
                    "Kirishning qo'shimcha himoyasi: parol va telefondagi ilova kodi.")}
            </p>
            <button className="neo-btn-primary" disabled={totpStart.isPending} onClick={() => totpStart.mutate()} data-testid="totp-start">
              {t("Включить", "Yoqish")}
            </button>
          </div>
        )}
      </FieldGroup>

      <FieldGroup title={t("Безопасность", "Xavfsizlik")}>
        <p className="text-sm text-secondary mb-4 max-w-prose">
          {t(
            "Завершает все входы, кроме этого устройства — если телефон потерян или ноутбук остался у бывшего сотрудника.",
            "Barcha kirishlarni tugatadi — telefon yo'qolgan yoki noutbuk sobiq xodimda qolgan bo'lsa.",
          )}
        </p>
        <button
          className="neo-btn"
          disabled={logoutAll.isPending}
          onClick={async () => {
            const ok = await confirm({
              title: t("Выйти на всех устройствах?", "Barcha qurilmalardan chiqilsinmi?"),
              message: t(
                "Все входы будут завершены, включая это устройство — придётся войти заново.",
                "Barcha kirishlar tugatiladi, shu qurilma ham — qaytadan kirish kerak bo'ladi.",
              ),
              confirmText: t("Выйти везде", "Hamma joydan chiqish"),
              danger: true,
            });
            if (ok) logoutAll.mutate();
          }}
        >
          {t("Выйти на всех устройствах", "Barcha qurilmalardan chiqish")}
        </button>
      </FieldGroup>
      {dialog}
    </div>
  );
}

/*
  Логин суперадмина — редактируемый.

  У сотрудника организации логин меняет директор или суперадмин, а над
  суперадмином никого нет: superadmin@system.local из засева оставался
  навсегда (владелец, 01.10.2026). Смена — по текущему паролю и, если второй
  фактор включён, по коду из приложения (user.changeMyLogin). Без второго
  фактора хватает пароля — и поэтому здесь же прямо сказано, что его стоит
  включить: подсмотренного пароля тогда хватило бы, чтобы увести и логин.

  Прочие входы после смены гаснут, эта вкладка получает новую куку и
  остаётся — выкидывать человека, который только что подтвердил себя
  паролем, незачем.
*/
function MyLogin({ email, totpOn, t }: { email: string; totpOn: boolean; t: (ru: string, uz: string) => string }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({ email: "", password: "", code: "" });
  const change = trpc.user.changeMyLogin.useMutation({
    onSuccess: (r) => {
      setForm({ email: "", password: "", code: "" });
      utils.auth.me.invalidate();
      notify.success(t(`Логин изменён: ${r.email}. На других устройствах войдите заново с новым логином.`,
                       `Login o'zgartirildi: ${r.email}. Boshqa qurilmalarda yangi login bilan qayta kiring.`));
    },
    onError: (e) => notify.error(e.message),
  });
  const next = form.email.trim().toLowerCase();
  const ready = next.includes("@") && next !== email.toLowerCase() && form.password.length > 0 && (!totpOn || form.code.trim().length >= 6);

  return (
    <FieldGroup title={t("Логин для входа", "Kirish logini")}>
      <div className="max-w-sm space-y-4" data-testid="my-login">
        <p className="text-sm text-secondary">
          {t("Сейчас: ", "Hozir: ")}<span className="text-primary font-medium" data-testid="my-login-current">{email}</span>
        </p>
        <Field label={t("Новый логин (почта)", "Yangi login (pochta)")}>
          <input className="neo-input" type="email" autoComplete="username" placeholder="owner@example.com"
            value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} data-testid="my-login-email" />
        </Field>
        <Field label={t("Текущий пароль", "Joriy parol")}>
          <input className="neo-input" type="password" autoComplete="current-password"
            value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} data-testid="my-login-password" />
        </Field>
        {totpOn ? (
          <Field label={t("Код из приложения", "Ilovadagi kod")}>
            <input className="neo-input" inputMode="numeric" autoComplete="one-time-code"
              value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} data-testid="my-login-code" />
          </Field>
        ) : (
          <p className="text-sm" style={{ color: "var(--color-warning-text)" }} data-testid="my-login-no-totp">
            {t("Вход с кодом из приложения не включён — логин сейчас меняется по одному паролю. Включите его ниже: тогда смену логина подтвердит и код.",
               "Ilova kodi bilan kirish yoqilmagan — login hozir faqat parol bilan o'zgaradi. Uni quyida yoqing: shunda login o'zgarishini kod ham tasdiqlaydi.")}
          </p>
        )}
      </div>
      <SaveBar
        onSave={() => change.mutate({ email: next, currentPassword: form.password, code: totpOn ? form.code.trim() : undefined })}
        isPending={change.isPending}
        disabled={!ready}
        label={t("Сменить логин", "Loginni o'zgartirish")}
        hint={t("Другие устройства выйдут; это останется в системе", "Boshqa qurilmalar chiqadi; bu qurilma tizimda qoladi")}
      />
    </FieldGroup>
  );
}
