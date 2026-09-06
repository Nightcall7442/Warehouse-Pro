import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { PremiumSelect } from "@/components/PremiumSelect";
import { F, COLORS } from "./types";
import { Modal, Input, BtnPrimary, BtnSecondary } from "./ui";

interface CreateTenantModalProps {
  onClose: () => void;
  onCreated: () => void;
}

type Plan = "trial" | "basic" | "pro" | "exclusive";

export function CreateTenantModal({ onClose, onCreated }: CreateTenantModalProps) {
  const [form, setForm] = useState({ orgName: "", ownerName: "", ownerEmail: "", ownerPassword: "", plan: "trial" as Plan, trialDays: 14 });
  const create = trpc.tenant.create.useMutation({
    onSuccess: (d) => { notify.success(`Создан: ${d.slug}`); onCreated(); onClose(); },
    onError: (e) => notify.error(e.message),
  });
  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }));
  return (
    <Modal
      onClose={onClose}
      title="Новая организация"
      subtitle="Тенант и его владелец создаются одним шагом"
      footer={
        <>
          <BtnSecondary onClick={onClose} style={{ flex: 1 }}>Отмена</BtnSecondary>
          <BtnPrimary onClick={() => create.mutate(form)} disabled={create.isPending || !form.orgName || !form.ownerEmail || !form.ownerPassword} style={{ flex: 1 }}>
            {create.isPending ? "Создаём…" : "Создать"}
          </BtnPrimary>
        </>
      }
    >
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
            <PremiumSelect value={form.plan} onChange={v => setForm(p => ({ ...p, plan: v as Plan }))} options={[{ value: "trial", label: "Trial" }, { value: "basic", label: "Basic" }, { value: "pro", label: "Pro" }, { value: "exclusive", label: "Exclusive" }]} width="100%" />
          </div>
          <Input label="Trial дней" type="number" min="0" max="365" value={String(form.trialDays)} onChange={e => setForm(p => ({ ...p, trialDays: Number(e.target.value) }))} />
        </div>
      </div>
    </Modal>
  );
}
