import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { User, Key, Save, Loader2 } from "lucide-react";
import { F, COLORS } from "./types";
import { Section, Input, BtnPrimary } from "./ui";

export function AdminActions() {
  const { data: user } = trpc.user.me.useQuery();
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPwSection, setShowPwSection] = useState(false);
  const [initialized, setInitialized] = useState(false);
  if (user && !initialized) { setName(user.name ?? ""); setPhone(user.phone ?? ""); setInitialized(true); }

  const updateProfile = trpc.user.updateMe.useMutation({ onSuccess: () => { utils.user.me.invalidate(); notify.success("Профиль обновлён"); }, onError: (e) => notify.error(e.message) });
  const changePassword = trpc.user.changePassword.useMutation({ onSuccess: () => { notify.success("Пароль изменён"); setCurrentPw(""); setNewPw(""); setConfirmPw(""); setShowPwSection(false); }, onError: (e) => notify.error(e.message) });

  return (
    <Section title="Мой профиль" icon={User}>
      <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "24px" }}>
        <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "rgba(75,108,246,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}><User size={22} style={{ color: COLORS.primary }} /></div>
        <div>
          <p style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 600, color: COLORS.textPrimary }}>{user?.name}</p>
          <p style={{ fontSize: "12px", color: COLORS.textTertiary }}>{user?.role} · {user?.email}</p>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <Input label="Имя" value={name} onChange={e => setName(e.target.value)} />
        <Input label="Телефон" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+998..." />
      </div>
      <BtnPrimary onClick={() => { if (!name.trim()) { notify.error("Имя обязательно"); return; } updateProfile.mutate({ name: name.trim(), phone: phone.trim() || undefined }); }} disabled={updateProfile.isPending} style={{ marginTop: "16px" }}>
        {updateProfile.isPending ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={14} />} Сохранить
      </BtnPrimary>
      <div style={{ marginTop: "24px", paddingTop: "20px", borderTop: `1px solid ${COLORS.border}` }}>
        <button onClick={() => setShowPwSection(!showPwSection)} style={{ display: "flex", alignItems: "center", gap: "8px", background: "none", border: "none", cursor: "pointer", color: COLORS.textSecondary, fontSize: "13px", fontWeight: 500, fontFamily: F.body }}>
          <Key size={16} /> {showPwSection ? "Скрыть" : "Изменить пароль"}
        </button>
        {showPwSection && (
          <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "12px", maxWidth: "400px" }}>
            <Input label="Текущий пароль" type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} />
            <Input label="Новый пароль" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} minLength={8} />
            <Input label="Подтвердите" type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} />
            <BtnPrimary onClick={() => { if (!currentPw) { notify.error("Введите текущий пароль"); return; } if (newPw.length < 8) { notify.error("Пароль минимум 8 символов"); return; } if (newPw !== confirmPw) { notify.error("Пароли не совпадают"); return; } changePassword.mutate({ currentPassword: currentPw, newPassword: newPw }); }} disabled={changePassword.isPending}>
              {changePassword.isPending ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Key size={14} />} Изменить пароль
            </BtnPrimary>
          </div>
        )}
      </div>
    </Section>
  );
}
