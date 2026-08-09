import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { Loader2 } from "lucide-react";

export function ProfileSettings() {
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

      <div className="space-y-3" style={{ borderTop: "1px solid var(--color-border, #d8d5cd)", paddingTop: 20 }}>
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
