import { useState } from "react";
import { ChevronRight, User, AlertCircle, CheckSquare, Square, Package } from "lucide-react";
import { F, COLORS, SHADOW, STATUS, PAYMENT } from "./theme-tokens";
import { colorMix } from "@/lib/color-mix";

export interface AgentSummaryRow {
  agentId: number;
  agentName: string;
  orderCount: number;
  totalValue: string;
  openCount: number;
  deliveredCount: number;
  debt: string;
  lastOrderAt: string | null;
}

export interface AgentGroupOrder {
  id: number;
  orderNumber: string;
  status: string;
  total: string;
  shopName: string | null;
  paymentMethod: string;
  createdAt: string | Date;
}

interface Props {
  agents: AgentSummaryRow[];
  /** Orders for the one expanded agent; the parent fetches them on demand. */
  expandedAgentId: number | null;
  expandedOrders: AgentGroupOrder[];
  expandedLoading: boolean;
  onToggleAgent: (agentId: number) => void;
  selected: Set<number>;
  onToggleOrder: (orderId: number) => void;
  /** Select/deselect every order currently shown for the expanded agent. */
  onToggleAllForAgent: (orderIds: number[]) => void;
  onOrderClick: (orderId: number) => void;
  fmt: (n: number) => string;
  t: (ru: string, uz: string) => string;
  lang: string;
}

/**
 * Orders grouped by the agent who placed them.
 *
 * An operator working through the day's orders thinks in terms of "what did
 * Davron bring in, is any of it waiting on me, and can I push it all forward
 * at once" — not in terms of a flat list they have to filter and re-filter.
 * So each row is a decision: how much is still open, how much money is tied up,
 * how much is unpaid. Expanding one keeps the operator on the same screen with
 * the existing bulk-action bar, rather than sending them to a filtered view and
 * back.
 *
 * Only one agent is expanded at a time, and its orders are fetched on demand —
 * loading every agent's orders up front would mean paging through work the
 * operator hasn't asked to see.
 */
export function OrderAgentGroups({
  agents, expandedAgentId, expandedOrders, expandedLoading,
  onToggleAgent, selected, onToggleOrder, onToggleAllForAgent, onOrderClick,
  fmt, t, lang,
}: Props) {
  if (agents.length === 0) {
    return (
      <div style={{
        background: COLORS.surface, borderRadius: "16px", padding: "48px 24px",
        textAlign: "center", boxShadow: SHADOW,
      }}>
        <User size={28} style={{ color: COLORS.textTertiary, marginBottom: "10px" }} />
        <p style={{ fontFamily: F.body, fontSize: "13px", color: COLORS.textSecondary, margin: 0 }}>
          {t("Нет агентов", "Agentlar yo'q")}
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {agents.map(agent => (
        <AgentRow
          key={agent.agentId}
          agent={agent}
          expanded={expandedAgentId === agent.agentId}
          orders={expandedAgentId === agent.agentId ? expandedOrders : []}
          loading={expandedAgentId === agent.agentId && expandedLoading}
          onToggle={() => onToggleAgent(agent.agentId)}
          selected={selected}
          onToggleOrder={onToggleOrder}
          onToggleAllForAgent={onToggleAllForAgent}
          onOrderClick={onOrderClick}
          fmt={fmt}
          t={t}
          lang={lang}
        />
      ))}
    </div>
  );
}

function AgentRow({
  agent, expanded, orders, loading, onToggle, selected,
  onToggleOrder, onToggleAllForAgent, onOrderClick, fmt, t, lang,
}: {
  agent: AgentSummaryRow;
  expanded: boolean;
  orders: AgentGroupOrder[];
  loading: boolean;
  onToggle: () => void;
  selected: Set<number>;
  onToggleOrder: (id: number) => void;
  onToggleAllForAgent: (ids: number[]) => void;
  onOrderClick: (id: number) => void;
  fmt: (n: number) => string;
  t: (ru: string, uz: string) => string;
  lang: string;
}) {
  const [hover, setHover] = useState(false);
  const debt = Number(agent.debt);
  const idle = agent.orderCount === 0;
  const orderIds = orders.map(o => o.id);
  const allSelected = orderIds.length > 0 && orderIds.every(id => selected.has(id));

  return (
    <div style={{
      background: COLORS.surface,
      borderRadius: "16px",
      boxShadow: SHADOW,
      overflow: "hidden",
      // The open row is the operator's current focus, so it gets the accent
      // edge; an agent with nothing in the window is dimmed rather than hidden,
      // because "nothing today" is itself the answer a supervisor is after.
      border: expanded ? `1px solid ${COLORS.primary}` : "1px solid transparent",
      opacity: idle && !expanded ? 0.6 : 1,
      transition: "border-color .15s ease, opacity .15s ease",
    }}>
      <button
        onClick={onToggle}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        aria-expanded={expanded}
        style={{
          display: "flex", alignItems: "center", gap: "14px",
          width: "100%", padding: "14px 18px",
          background: hover ? COLORS.surfaceLight : "transparent",
          border: "none", cursor: "pointer", textAlign: "left",
          transition: "background .15s ease",
        }}
      >
        <ChevronRight
          size={16}
          style={{
            color: COLORS.textTertiary, flexShrink: 0,
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform .15s ease",
          }}
        />

        <div style={{
          width: "34px", height: "34px", borderRadius: "10px", flexShrink: 0,
          background: COLORS.primarySubtle,
          color: COLORS.primaryText,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: F.display, fontSize: "13px", fontWeight: 700,
        }}>
          {agent.agentName.trim().charAt(0).toUpperCase() || "?"}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: F.display, fontSize: "14px", fontWeight: 600,
            color: COLORS.textPrimary, overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {agent.agentName.trim()}
          </div>
          <div style={{ fontFamily: F.body, fontSize: "11px", color: COLORS.textTertiary, marginTop: "1px" }}>
            {idle
              ? t("Нет заказов за период", "Davr uchun buyurtma yo'q")
              : t(
                  `${agent.orderCount} заказ(ов) · доставлено ${agent.deliveredCount}`,
                  `${agent.orderCount} ta buyurtma · yetkazildi ${agent.deliveredCount}`,
                )}
          </div>
        </div>

        {/* Stats. Ordered by what an operator acts on first: what's still
            waiting, then what it's worth, then what's unpaid. */}
        <div style={{ display: "flex", alignItems: "center", gap: "20px", flexShrink: 0 }}>
          {agent.openCount > 0 && (
            <Stat
              label={t("В работе", "Jarayonda")}
              value={String(agent.openCount)}
              tone="attention"
            />
          )}
          <Stat
            label={t("Сумма", "Summa")}
            value={fmt(Number(agent.totalValue))}
          />
          {debt > 0 && (
            <Stat
              label={t("Долг", "Qarz")}
              value={fmt(debt)}
              tone="danger"
              icon
            />
          )}
        </div>
      </button>

      {expanded && (
        <div style={{ borderTop: `1px solid ${COLORS.border}` }}>
          {loading ? (
            <div style={{ padding: "24px", textAlign: "center", fontFamily: F.body, fontSize: "12px", color: COLORS.textTertiary }}>
              {t("Загрузка…", "Yuklanmoqda…")}
            </div>
          ) : orders.length === 0 ? (
            <div style={{ padding: "24px", textAlign: "center", fontFamily: F.body, fontSize: "12px", color: COLORS.textTertiary }}>
              <Package size={18} style={{ marginBottom: "6px", opacity: 0.6 }} />
              <div>{t("Нет заказов за выбранный период", "Tanlangan davrda buyurtma yo'q")}</div>
            </div>
          ) : (
            <>
              <div style={{
                display: "flex", alignItems: "center", gap: "8px",
                padding: "8px 18px", background: COLORS.surfaceLight,
                borderBottom: `1px solid ${COLORS.border}`,
              }}>
                <button
                  onClick={() => onToggleAllForAgent(orderIds)}
                  style={{
                    display: "flex", alignItems: "center", gap: "6px",
                    background: "none", border: "none", cursor: "pointer", padding: 0,
                    fontFamily: F.body, fontSize: "11px", fontWeight: 600,
                    color: allSelected ? COLORS.primaryText : COLORS.textSecondary,
                  }}
                >
                  {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                  {t("Выбрать все", "Barchasini tanlash")}
                </button>
              </div>

              {orders.map(order => {
                const isSelected = selected.has(order.id);
                const st = STATUS[order.status];
                const pay = PAYMENT[order.paymentMethod];
                return (
                  <div
                    key={order.id}
                    style={{
                      display: "flex", alignItems: "center", gap: "12px",
                      padding: "10px 18px",
                      borderBottom: `1px solid ${COLORS.border}`,
                      background: isSelected ? COLORS.primarySubtle : "transparent",
                      transition: "background .15s ease",
                    }}
                  >
                    <button
                      onClick={() => onToggleOrder(order.id)}
                      aria-label={t("Выбрать заказ", "Buyurtmani tanlash")}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", flexShrink: 0 }}
                    >
                      {isSelected
                        ? <CheckSquare size={15} style={{ color: COLORS.primaryText }} />
                        : <Square size={15} style={{ color: COLORS.textTertiary }} />}
                    </button>

                    <button
                      onClick={() => onOrderClick(order.id)}
                      style={{
                        flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "12px",
                        background: "none", border: "none", cursor: "pointer",
                        padding: 0, textAlign: "left",
                      }}
                    >
                      <span style={{
                        fontFamily: F.display, fontSize: "12px", fontWeight: 600,
                        color: COLORS.primaryText, flexShrink: 0, minWidth: "92px",
                      }}>
                        {order.orderNumber}
                      </span>
                      <span style={{
                        flex: 1, minWidth: 0, fontFamily: F.body, fontSize: "12px",
                        color: COLORS.textSecondary, overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {order.shopName ?? "—"}
                      </span>
                    </button>

                    {pay && (
                      <span style={{
                        fontFamily: F.body, fontSize: "10px", fontWeight: 600,
                        padding: "2px 7px", borderRadius: "6px", flexShrink: 0,
                        background: colorMix(pay.color, 9), color: pay.color,
                      }}>
                        {lang === "uz" ? pay.uz : pay.ru}
                      </span>
                    )}

                    {st && (
                      <span style={{
                        fontFamily: F.body, fontSize: "10px", fontWeight: 600,
                        padding: "2px 8px", borderRadius: "6px", flexShrink: 0,
                        background: colorMix(st.dot, 9), color: st.dot,
                      }}>
                        {lang === "uz" ? st.uz : st.ru}
                      </span>
                    )}

                    <span style={{
                      fontFamily: F.display, fontSize: "12px", fontWeight: 700,
                      color: COLORS.textPrimary, flexShrink: 0, minWidth: "96px", textAlign: "right",
                    }}>
                      {fmt(Number(order.total))}
                    </span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone, icon }: {
  label: string; value: string; tone?: "attention" | "danger"; icon?: boolean;
}) {
  const color = tone === "danger" ? COLORS.dangerText
    : tone === "attention" ? COLORS.warningText
    : COLORS.textPrimary;
  return (
    <div style={{ textAlign: "right", minWidth: 0 }}>
      <div style={{
        fontFamily: F.body, fontSize: "9px", fontWeight: 600, letterSpacing: ".06em",
        textTransform: "uppercase", color: COLORS.textTertiary, whiteSpace: "nowrap",
      }}>
        {label}
      </div>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "4px",
        fontFamily: F.display, fontSize: "13px", fontWeight: 700, color, whiteSpace: "nowrap",
      }}>
        {icon && <AlertCircle size={11} />}
        {value}
      </div>
    </div>
  );
}
