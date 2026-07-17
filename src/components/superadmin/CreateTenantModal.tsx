import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { Plus, XCircle } from "lucide-react";
import { PremiumSelect } from "@/components/PremiumSelect";
import { F, COLORS } from "./types";
import { Modal, Input, BtnPrimary, BtnSecondary } from "./ui";

interface CreateTenantModalProps {
  onClose: () => void;
  onCreated: () => void;
}

export function CreateTenantModal({ onClose, onCreated }: CreateTenantModalProps) {
  const [form, setForm] = useState({ orgName: "", ownerName: "", ownerEmail: "", ownerPassword: "", plan: "trial" as "trial" | "basic" | "pro" | "exclusive", trialDays: 14 });
  const create = trpc.tenant.create.useMutation({
    onSuccess: (d) => { notify.success(`Создан: ${d.slug}`); onCreated(); onClose(); },
    onError: (e) => notify.error(e.message),
  });
  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }));
  return (
    <Modal onClose={onClose}>
      <div style={{ padding: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ width: "40px", height: "40px", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(75,108,246,0.1)", color: COLORS.primary }}><Plus size={20} /></div>
            <div>
              <h2 style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 700, color: COLORS.textPrimary }}>Новая организация</h2>
              <p style={{ fontSize: "12px", color: COLORS.textTertiary }}>Создайте тенант и владельца</p>
            </div>
          </div>
          <button onClick={onClose} style={{ padding: "8px", borderRadius: "8px", background: "none", border: "none", cursor: "pointer", color: COLORS.textSecondary }}><XCircle size={20} /></button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <Input label="Название компании" placeholder="ООО Ромашка" value={form.orgName} onChange={f("orgName")} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <Input label="Имя владельца" placeholder="Иван Петров" value={form.ownerName} onChange={f("ownerName")} />
            <Input label="Email" type="email" placeholder="owner@..." value={form.ownerEmail} onChange={f("ownerEmail")} />
          </div>
          <Input label="Пароль" type="password" placeholder="мин. 8 символов" value={form.ownerPassword} onChange={f("ownerPassword")} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div>
              <label style={{ fontFamily: F.body, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary, display: "block", marginBottom: "6px" }}>Тариф</label>
              <PremiumSelect value={form.plan} onChange={v => setForm(p => ({ ...p, plan: v as any }))} options={[{ value: "trial", label: "Trial" }, { value: "basic", label: "Basic" }, { value: "pro", label: "Pro" }, { value: "exclusive", label: "Exclusive" }]} width="100%" />
            </div>
            <Input label="Trial дней" type="number" min="0" max="365" value={String(form.trialDays)} onChange={e => setForm(p => ({ ...p, trialDays: Number(e.target.value) }))} />
          </div>
        </div>
        <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
          <BtnSecondary onClick={onClose} style={{ flex: 1 }}>Отмена</BtnSecondary>
          <BtnPrimary onClick={() => create.mutate(form)} disabled={create.isPending || !form.orgName || !form.ownerEmail || !form.ownerPassword} style={{ flex: 1 }}>
            {create.isPending ? "Создаём…" : "Создать"}
          </BtnPrimary>
        </div>
      </div>
    </Modal>
  );
}
