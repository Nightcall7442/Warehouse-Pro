import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { FieldGroup, Field, FieldRow, SaveBar } from "./ui";

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
 * как значение, а не как поле, с подписью, к кому идти за изменением.
 *
 * Зато телефон сервер принимает, а формы для него не было — добавлена.
 */

export function ProfileSettings() {
  const { user } = useAuth();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const utils = trpc.useUtils();

  const [form, setForm] = useState({ name: user?.name ?? "", phone: user?.phone ?? "" });
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });

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

        <div className="mt-4">
          <p className="text-[13px] font-medium text-secondary mb-1.5">Email</p>
          <p className="text-sm text-primary font-medium">{user?.email}</p>
          <p className="text-xs text-tertiary mt-1">
            {t("Это логин для входа. Сменить его может администратор организации.",
               "Bu — kirish uchun login. Uni tashkilot administratori o'zgartira oladi.")}
          </p>
        </div>

        <SaveBar
          onSave={() => updateProfile.mutate({ name: form.name, phone: form.phone })}
          isPending={updateProfile.isPending}
          disabled={form.name.trim().length < 2}
          label={t("Сохранить", "Saqlash")}
          hint={t("Имя видят коллеги в заказах и отчётах", "Ismni hamkasblar buyurtma va hisobotlarda ko'radi")}
        />
      </FieldGroup>

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
    </div>
  );
}
