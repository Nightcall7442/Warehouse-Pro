import { useState } from "react";
import { Calendar, Plus, Trash2, Loader2, Play } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { COLORS, SHADOW, F } from "./constants";
import { PremiumSelect } from "@/components/PremiumSelect";

const DAY_NAMES_RU = ["ВС", "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"];
const DAY_NAMES_UZ = ["Yak", "Dush", "Sesh", "Chor", "Pay", "Jum", "Shan"];

export function ScheduleManager({ lang }: { lang: string }) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const dayNames = lang === "uz" ? DAY_NAMES_UZ : DAY_NAMES_RU;
  const utils = trpc.useUtils();

  const [selectedAgent, setSelectedAgent] = useState<number | undefined>(undefined);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split("T")[0];
  });

  const { data: usersData } = trpc.user.list.useQuery({ page: 1, pageSize: 100 });
  const agents = (usersData?.data ?? []).filter((u: { role: string }) => u.role === "agent");

  const { data: agentShops } = trpc.agent.myShops.useQuery(undefined, { enabled: false });
  const { data: allShopsData } = trpc.shop.list.useQuery({ page: 1, pageSize: 500 });
  const shops = allShopsData?.data ?? [];

  const { data: schedules = [], isLoading } = trpc.schedule.list.useQuery(
    { agentId: selectedAgent },
    { enabled: !!selectedAgent }
  );

  const createMutation = trpc.schedule.create.useMutation({
    onSuccess: () => {
      utils.schedule.list.invalidate();
      notify.success(t("Расписание добавлено", "Jadval qo'shildi"));
    },
    onError: (e) => notify.error(e.message),
  });

  const deleteMutation = trpc.schedule.delete.useMutation({
    onSuccess: () => {
      utils.schedule.list.invalidate();
      notify.success(t("Расписание удалено", "Jadval o'chirildi"));
    },
    onError: (e) => notify.error(e.message),
  });

  const generateMutation = trpc.schedule.generatePlans.useMutation({
    onSuccess: (data) => {
      utils.schedule.list.invalidate();
      notify.success(t(`Создано ${data.created} планов, пропущено ${data.skipped}`, `${data.created} reja yaratildi, ${data.skipped} o'tkazildi`));
    },
    onError: (e) => notify.error(e.message),
  });

  const toggleSchedule = (shopId: number, day: number) => {
    const existing = schedules.find((s: { shopId: number; dayOfWeek: number }) => s.shopId === shopId && s.dayOfWeek === day);
    if (existing) {
      deleteMutation.mutate({ id: existing.id });
    } else if (selectedAgent) {
      createMutation.mutate({ agentId: selectedAgent, shopId, dayOfWeek: day });
    }
  };

  return (
    <div style={{ background: COLORS.surface, borderRadius: "16px", padding: "20px", boxShadow: SHADOW }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
        <Calendar size={18} style={{ color: COLORS.primary }} />
        <h3 style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
          {t("Расписание визитов", "Tashrif jadvali")}
        </h3>
      </div>

      {/* Agent selector */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
        <PremiumSelect
          value={selectedAgent != null ? String(selectedAgent) : ""}
          onChange={v => setSelectedAgent(v ? Number(v) : undefined)}
          width="100%"
          placeholder={t("Выберите агента", "Agent tanlang")}
          aria-label={t("Агент", "Agent")}
          options={agents.map((a: { id: number; name: string }) => ({ value: String(a.id), label: a.name }))}
        />
      </div>

      {selectedAgent && (
        <>
          {/* Schedule grid */}
          {isLoading ? (
            <div style={{ padding: "24px", textAlign: "center" }}>
              <Loader2 size={20} className="animate-spin" style={{ color: COLORS.primary }} />
            </div>
          ) : (
            <div style={{ overflowX: "auto", marginBottom: "16px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "6px 8px", color: COLORS.textSecondary, fontWeight: 500 }}>
                      {t("Магазин", "Do'kon")}
                    </th>
                    {dayNames.map((name, i) => (
                      <th key={i} style={{ padding: "6px 4px", color: COLORS.textSecondary, fontWeight: 500, textAlign: "center", width: "40px" }}>
                        {name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shops.slice(0, 50).map((shop: { id: number; name: string }) => (
                    <tr key={shop.id} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                      <td style={{ padding: "6px 8px", color: COLORS.textPrimary, maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {shop.name}
                      </td>
                      {[0, 1, 2, 3, 4, 5, 6].map(day => {
                        const hasSchedule = schedules.some((s: { shopId: number; dayOfWeek: number }) => s.shopId === shop.id && s.dayOfWeek === day);
                        return (
                          <td key={day} style={{ padding: "4px", textAlign: "center" }}>
                            <button
                              onClick={() => toggleSchedule(shop.id, day)}
                              disabled={createMutation.isPending || deleteMutation.isPending}
                              style={{
                                width: "28px", height: "28px", borderRadius: "6px", border: "none", cursor: "pointer",
                                background: hasSchedule ? COLORS.primary : COLORS.surfaceHover,
                                color: hasSchedule ? "#fff" : COLORS.textTertiary,
                                fontSize: "10px", fontWeight: 600, transition: "all 0.15s",
                              }}
                            >
                              {hasSchedule ? "✓" : "+"}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Generate plans */}
          <div style={{ display: "flex", gap: "8px", alignItems: "center", padding: "12px", borderRadius: "10px", background: COLORS.surfaceHover }}>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              className="neo-input" style={{ fontSize: "12px", padding: "6px 8px" }} />
            <span style={{ color: COLORS.textSecondary, fontSize: "12px" }}>—</span>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              className="neo-input" style={{ fontSize: "12px", padding: "6px 8px" }} />
            <button
              onClick={() => generateMutation.mutate({ startDate, endDate, agentId: selectedAgent })}
              disabled={generateMutation.isPending}
              className="neo-btn-primary"
              style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", padding: "6px 12px", whiteSpace: "nowrap" }}
            >
              {generateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {t("Сгенерировать", "Yaratish")}
            </button>
          </div>
        </>
      )}

      {!selectedAgent && (
        <div style={{ padding: "32px", textAlign: "center", color: COLORS.textSecondary, fontSize: "13px" }}>
          {t("Выберите агента для настройки расписания", "Jadvalni sozlash uchun agent tanlang")}
        </div>
      )}
    </div>
  );
}
