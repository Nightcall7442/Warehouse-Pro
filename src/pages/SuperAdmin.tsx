import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Zap, RefreshCw, Plus } from "lucide-react";
import { F, COLORS } from "@/components/superadmin/types";
import { BtnPrimary, BtnSecondary } from "@/components/superadmin/ui";
import { PlatformStats, TenantList, TenantDetail, AdminActions, CreateTenantModal } from "@/components/superadmin";

export default function SuperAdmin() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const { refetch } = trpc.tenant.list.useQuery();
  const utils = trpc.useUtils();
  const invalidate = () => { utils.tenant.list.invalidate(); utils.tenant.platformStats.invalidate(); };

  if (selectedId !== null) return <TenantDetail tenantId={selectedId} onBack={() => setSelectedId(null)} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      {showCreate && <CreateTenantModal onClose={() => setShowCreate(false)} onCreated={invalidate} />}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "44px", height: "44px", borderRadius: "14px", background: "linear-gradient(135deg, #4b6cf6, #4b6cf6)", display: "flex", alignItems: "center", justifyContent: "center" }}><Zap size={22} color="#fff" /></div>
          <div>
            <h1 style={{ fontFamily: F.display, fontSize: "24px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.02em" }}>Super Admin</h1>
            <p style={{ fontSize: "13px", color: COLORS.textSecondary }}>Управление платформой</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <BtnSecondary onClick={() => refetch()} style={{ padding: "8px 16px", fontSize: "12px" }}><RefreshCw size={13} /> Обновить</BtnSecondary>
          <BtnPrimary onClick={() => setShowCreate(true)} style={{ padding: "8px 16px", fontSize: "12px" }}><Plus size={13} /> Создать</BtnPrimary>
        </div>
      </div>

      <PlatformStats />
      <AdminActions />
      <TenantList onSelect={id => setSelectedId(id)} />
    </div>
  );
}
