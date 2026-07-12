import { trpc } from "@/providers/trpc";

import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import {
  CheckCircle2, AlertTriangle, Loader2, Zap, Users, Package,
  ClipboardList, Check, Crown, Sparkles,
} from "lucide-react";

// ── Premium Design Tokens ────────────────────────────────────────────────────
const COLORS = {
  primary: "#818cf8",
  primaryLight: "#818cf8",
  primaryDark: "#6366f1",
  gradientStart: "#818cf8",
  gradientEnd: "#c7c9f8",
  success: "#4ade80",
  warning: "#fbbf24",
  danger: "#f87171",
  surface: "#ffffff",
  surfaceDark: "#f8f9fb",
  textPrimary: "#111827",
  textSecondary: "#6b7280",
  textTertiary: "#9ca3af",
};

const FONTS = {
  display: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  body: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
};

const SHADOWS = {
  sm: "0 1px 2px rgba(0,0,0,.04)",
  md: "0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04)",
  lg: "0 10px 15px -3px rgba(0,0,0,.06)",
  xl: "0 20px 25px -5px rgba(0,0,0,.06)",
  glow: (color: string, intensity = 0.15) =>
    `0 0 30px rgba(${color === "primary" ? "99,102,241" : color === "success" ? "16,185,129" : color === "warning" ? "245,158,11" : "239,68,68"},${intensity})`,
};

const GRADIENTS = {
  hero: `linear-gradient(135deg, #eff6ff 0%, #eff6ff 50%, #ffffff 100%)`,
  heroExpired: `linear-gradient(135deg, #fee2e2 0%, #fef2f2 50%, #ffffff 100%)`,
  button: `linear-gradient(135deg, ${COLORS.gradientStart}, ${COLORS.gradientEnd})`,
  buttonHover: `linear-gradient(135deg, ${COLORS.primaryDark}, #9333ea)`,
  card: `linear-gradient(180deg, #ffffff 0%, #f8f9fb 100%)`,
};

const ANIMATIONS = {
  fadeIn: "@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }",
  slideUp: "@keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }",
  pulse: "@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }",
  progressFill: "@keyframes progressFill { from { width: 0; } }",
  glowPulse: "@keyframes glowPulse { 0%, 100% { box-shadow: 0 0 20px rgba(129,140,248,0.1); } 50% { box-shadow: 0 0 30px rgba(129,140,248,0.2); } }",
};

// ── Usage meter (premium) ────────────────────────────────────────────────────
function UsageBar({ used, max, label, icon: Icon }: {
  used: number; max: number | null; label: string; icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
}) {
  const pct = max ? Math.min((used / max) * 100, 100) : 100;
  const warn = max && used >= max * 0.85;
  const over = max && used >= max;
  const barColor = over ? COLORS.danger : warn ? COLORS.warning : COLORS.primary;

  return (
    <div style={{
      marginBottom: "20px",
      animation: "fadeIn 0.5s ease forwards",
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "10px",
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
        }}>
          <div style={{
            width: "32px",
            height: "32px",
            borderRadius: "10px",
            background: `${barColor}15`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            <Icon size={16} style={{ color: barColor }} />
          </div>
          <span style={{
            fontSize: "14px",
            fontWeight: "500",
            color: COLORS.textSecondary,
          }}>{label}</span>
        </div>
        <div style={{
          fontFamily: FONTS.body,
          fontSize: "14px",
          fontWeight: over ? "700" : warn ? "600" : "500",
          color: over ? COLORS.danger : warn ? COLORS.warning : COLORS.textPrimary,
        }}>
          {used.toLocaleString()}
          <span style={{
            color: COLORS.textTertiary,
            fontWeight: "400",
            marginLeft: "4px",
          }}>
            / {max ? max.toLocaleString() : "∞"}
          </span>
        </div>
      </div>
      <div style={{
        height: "8px",
        borderRadius: "4px",
        background: `${barColor}12`,
        overflow: "hidden",
        position: "relative",
      }}>
        <div style={{
          height: "100%",
          borderRadius: "4px",
          width: `${pct}%`,
          background: max
            ? `linear-gradient(90deg, ${barColor}, ${barColor}cc)`
            : `linear-gradient(90deg, ${COLORS.success}, #16A38A)`,
          transition: "width 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
          animation: "progressFill 1s ease forwards",
          boxShadow: `0 0 10px ${barColor}40`,
        }} />
      </div>
    </div>
  );
}

// ── Circular days-left ring (premium) ────────────────────────────────────────
function DaysRing({ daysLeft, total = 30, danger }: { daysLeft: number; total?: number; danger: boolean }) {
  const r = 30, circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, daysLeft / total));
  const stroke = danger ? COLORS.danger : daysLeft <= 3 ? COLORS.warning : COLORS.success;

  return (
    <div style={{
      width: "80px",
      height: "80px",
      flexShrink: 0,
      position: "relative",
      filter: `drop-shadow(0 0 8px ${stroke}30)`,
    }}>
      <svg width="80" height="80" style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx="40" cy="40" r={r}
          fill="none"
          stroke={`${stroke}20`}
          strokeWidth="6"
        />
        <circle
          cx="40" cy="40" r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          style={{
            transition: "stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1)",
            filter: `drop-shadow(0 0 6px ${stroke}60)`,
          }}
        />
      </svg>
      <div style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}>
        <span style={{
          fontFamily: FONTS.body,
          fontSize: "22px",
          fontWeight: "700",
          color: COLORS.textPrimary,
          lineHeight: 1,
        }}>{Math.max(0, daysLeft)}</span>
      </div>
    </div>
  );
}

// ── Skeleton loader ──────────────────────────────────────────────────────────
function SkeletonBlock({ height, style = {} }: { height: number; style?: React.CSSProperties }) {
  return (
    <div style={{
      height: `${height}px`,
      borderRadius: "16px",
      background: `linear-gradient(90deg, ${COLORS.surfaceDark} 25%, ${COLORS.surface} 50%, ${COLORS.surfaceDark} 75%)`,
      backgroundSize: "200% 100%",
      animation: "pulse 1.5s ease-in-out infinite",
      ...style,
    }} />
  );
}

export default function BillingPage() {
  const { data: billing, isLoading } = trpc.billing.status.useQuery();
  const { lang } = useLang();
  const upgrade = trpc.billing.requestUpgrade.useMutation({
    onSuccess: (d) => notify.success(d.message),
    onError: (e) => notify.error(e.message),
  });

  const planName = (p: { name: string; nameUz: string }) => (lang === "uz" ? p.nameUz : p.name);
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);

  if (isLoading) {
    return (
      <div style={{
        maxWidth: "768px",
        margin: "0 auto",
        padding: "0 20px",
      }}>
        <style>{ANIMATIONS.pulse}</style>
        <SkeletonBlock height={128} style={{ marginBottom: "24px" }} />
        <SkeletonBlock height={160} style={{ marginBottom: "24px" }} />
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: "16px",
        }}>
          {[1, 2, 3].map((i) => (
            <SkeletonBlock key={i} height={280} />
          ))}
        </div>
      </div>
    );
  }

  if (!billing) return null;

  const { trialActive, isExpired, daysLeft } = billing;

  return (
    <div style={{
      maxWidth: "768px",
      margin: "0 auto",
      padding: "0 20px 60px",
    }}>
      <style>{`
        ${ANIMATIONS.fadeIn}
        ${ANIMATIONS.slideUp}
        ${ANIMATIONS.progressFill}
        ${ANIMATIONS.glowPulse}
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
      `}</style>

      {/* ── Page Header ──────────────────────────────────────────────────── */}
      <div style={{
        marginBottom: "32px",
        animation: "fadeIn 0.6s ease forwards",
      }}>
        <h1 style={{
          fontFamily: FONTS.display,
          fontSize: "28px",
          fontWeight: "800",
          color: COLORS.textPrimary,
          letterSpacing: "-0.025em",
          margin: 0,
        }}>
          {t("Подписка и тарифы", "Obuna va tariflar")}
        </h1>
        <p style={{
          fontSize: "15px",
          color: COLORS.textSecondary,
          marginTop: "8px",
          margin: "8px 0 0",
        }}>
          {t("Управляйте планом и следите за лимитами", "Rejani boshqaring va limitlarni kuzating")}
        </p>
      </div>

      {/* ── Hero Status Card ──────────────────────────────────────────────── */}
      <div style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: "24px",
        padding: "28px",
        background: isExpired ? GRADIENTS.heroExpired : GRADIENTS.hero,
        boxShadow: isExpired
          ? `${SHADOWS.lg}, ${SHADOWS.glow("danger", 0.08)}`
          : `${SHADOWS.lg}, ${SHADOWS.glow("primary", 0.08)}`,
        marginBottom: "24px",
        animation: "slideUp 0.7s ease forwards",
      }}>
        {/* Ambient glow */}
        <div style={{
          position: "absolute",
          top: "-40px",
          right: "-40px",
          width: "160px",
          height: "160px",
          borderRadius: "50%",
          background: isExpired ? "#f87171" : "#818cf8",
          opacity: 0.06,
          filter: "blur(40px)",
        }} />
        <div style={{
          position: "absolute",
          bottom: "-60px",
          left: "-20px",
          width: "120px",
          height: "120px",
          borderRadius: "50%",
          background: isExpired ? "#f87171" : "#818cf8",
          opacity: 0.04,
          filter: "blur(50px)",
        }} />

        <div style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: "20px",
        }}>
          <DaysRing daysLeft={daysLeft} danger={!!isExpired} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "6px",
            }}>
              {isExpired
                ? <AlertTriangle size={18} style={{ color: COLORS.danger }} />
                : <CheckCircle2 size={18} style={{ color: COLORS.success }} />}
              <span style={{
                fontFamily: FONTS.display,
                fontSize: "18px",
                fontWeight: "700",
                color: COLORS.textPrimary,
              }}>
                {lang === "uz" ? billing.planNameUz : billing.planName}
              </span>
            </div>
            <p style={{
              fontSize: "14px",
              color: COLORS.textSecondary,
              margin: 0,
            }}>
              {isExpired
                ? t("Подписка истекла — продлите доступ", "Obuna tugadi — kirishni uzaytiring")
                : trialActive
                  ? t(`Осталось ${daysLeft} дн. пробного периода`, `Sinov muddati ${daysLeft} kun qoldi`)
                  : t(`Активна ещё ${daysLeft} дней`, `Yana ${daysLeft} kun faol`)}
            </p>
          </div>
        </div>
      </div>

      {/* ── Usage Section ─────────────────────────────────────────────────── */}
      <div style={{
        borderRadius: "24px",
        padding: "28px",
        background: GRADIENTS.card,
        boxShadow: SHADOWS.md,
        marginBottom: "32px",
        animation: "slideUp 0.8s ease forwards",
      }}>
        <p style={{
          fontSize: "12px",
          fontWeight: "600",
          letterSpacing: "0.08em",
          color: COLORS.textSecondary,
          margin: "0 0 20px",
          textTransform: "uppercase",
        }}>
          {t("ИСПОЛЬЗОВАНИЕ В ЭТОМ МЕСЯЦЕ", "SHU OYDAGI FOYDALANISH")}
        </p>
        <UsageBar icon={Users} used={billing.usage.users} max={billing.limits.maxUsers} label={t("Пользователи", "Foydalanuvchilar")} />
        <UsageBar icon={Package} used={billing.usage.products} max={billing.limits.maxProducts} label={t("Товары (SKU)", "Mahsulotlar (SKU)")} />
        <UsageBar icon={ClipboardList} used={billing.usage.orders} max={billing.limits.maxOrdersMonth} label={t("Заказы (мес.)", "Buyurtmalar (oy)")} />
      </div>

      {/* ── Plan Cards ────────────────────────────────────────────────────── */}
      <div>
        <p style={{
          fontSize: "12px",
          fontWeight: "600",
          letterSpacing: "0.08em",
          color: COLORS.textSecondary,
          margin: "0 0 16px",
          textTransform: "uppercase",
        }}>
          {t("ВЫБЕРИТЕ ТАРИФ", "TARIFNI TANLANG")}
        </p>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "16px",
        }}>
          {billing.plans.map((plan, index) => {
            const current = billing.plan === plan.key;
            const isPro = plan.key === "pro";
            return (
              <div
                key={plan.key}
                style={{
                  position: "relative",
                  borderRadius: "24px",
                  padding: "24px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                  background: current || isPro ? GRADIENTS.card : COLORS.surface,
                  boxShadow: isPro
                    ? `${SHADOWS.xl}, ${SHADOWS.glow("primary", 0.12)}`
                    : current
                      ? `${SHADOWS.lg}, 0 0 0 2px ${COLORS.primary}30`
                      : SHADOWS.md,
                  transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                  animation: `slideUp ${0.8 + index * 0.1}s ease forwards`,
                  cursor: "default",
                }}
                onMouseEnter={(e) => {
                  if (!current) {
                    (e.currentTarget as HTMLElement).style.transform = "translateY(-4px)";
                    (e.currentTarget as HTMLElement).style.boxShadow = isPro
                      ? `${SHADOWS.xl}, ${SHADOWS.glow("primary", 0.18)}`
                      : SHADOWS.xl;
                  }
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
                  (e.currentTarget as HTMLElement).style.boxShadow = isPro
                    ? `${SHADOWS.xl}, ${SHADOWS.glow("primary", 0.12)}`
                    : current
                      ? `${SHADOWS.lg}, 0 0 0 2px ${COLORS.primary}30`
                      : SHADOWS.md;
                }}
              >
                {/* Popular badge */}
                {isPro && !current && (
                  <div style={{
                    position: "absolute",
                    top: "-12px",
                    left: "50%",
                    transform: "translateX(-50%)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "4px 12px",
                    borderRadius: "100px",
                    fontSize: "10px",
                    fontWeight: "700",
                    color: "#fff",
                    background: GRADIENTS.button,
                    boxShadow: `0 2px 8px ${COLORS.primary}40`,
                    whiteSpace: "nowrap",
                  }}>
                    <Sparkles size={11} />
                    {t("ПОПУЛЯРНЫЙ", "OMMABOP")}
                  </div>
                )}

                {/* Plan header */}
                <div>
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}>
                    {isPro && <Crown size={16} style={{ color: COLORS.primary }} />}
                    <p style={{
                      fontFamily: FONTS.display,
                      fontWeight: "700",
                      color: COLORS.textPrimary,
                      margin: 0,
                      fontSize: "16px",
                    }}>{planName(plan)}</p>
                    {current && (
                      <span style={{
                        marginLeft: "auto",
                        padding: "2px 8px",
                        borderRadius: "6px",
                        fontSize: "10px",
                        fontWeight: "600",
                        color: COLORS.primary,
                        background: "rgba(129,140,248,.15)",
                      }}>
                        {t("ТЕКУЩИЙ", "JORIY")}
                      </span>
                    )}
                  </div>
                  <p style={{
                    fontFamily: FONTS.body,
                    fontSize: "28px",
                    fontWeight: "700",
                    color: COLORS.textPrimary,
                    marginTop: "12px",
                    margin: "12px 0 0",
                    lineHeight: 1.2,
                  }}>
                    {plan.price === 0
                      ? t("Бесплатно", "Bepul")
                      : <>{plan.price.toLocaleString("ru-RU")}<span style={{
                          fontSize: "14px",
                          fontWeight: "500",
                          color: COLORS.textSecondary,
                          fontFamily: FONTS.display,
                        }}> {t("сум/мес", "so'm/oy")}</span></>}
                  </p>
                </div>

                {/* Divider */}
                <div style={{
                  height: "1px",
                  background: `linear-gradient(90deg, transparent, ${COLORS.textTertiary}30, transparent)`,
                  margin: "4px 0",
                }} />

                {/* Features */}
                <div style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  fontSize: "14px",
                  flex: 1,
                }}>
                  {[
                    { val: plan.maxUsers, label: t("пользователей", "foydalanuvchi") },
                    { val: plan.maxProducts, label: t("SKU товаров", "SKU mahsulot") },
                    { val: plan.maxOrdersMonth, label: t("заказов/мес", "buyurtma/oy") },
                  ].map((item) => (
                    <div key={item.label} style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                    }}>
                      <div style={{
                        width: "20px",
                        height: "20px",
                        borderRadius: "50%",
                        background: "rgba(74,222,128,.15)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}>
                        <Check size={12} style={{ color: "#4ade80" }} />
                      </div>
                      <span style={{ color: COLORS.textSecondary }}>
                        <span style={{
                          color: COLORS.textPrimary,
                          fontWeight: "600",
                          fontFamily: FONTS.body,
                        }}>
                          {item.val === null ? t("Безлимит", "Cheksiz") : item.val.toLocaleString()}
                        </span> {item.label}
                      </span>
                    </div>
                  ))}
                </div>

                {/* CTA Button */}
                {!current && (
                  <button
                    onClick={() => upgrade.mutate({ plan: plan.key as "basic" | "pro" | "exclusive" })}
                    disabled={upgrade.isPending}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      fontSize: "14px",
                      fontWeight: "600",
                      padding: "12px 20px",
                      borderRadius: "12px",
                      border: "none",
                      cursor: upgrade.isPending ? "not-allowed" : "pointer",
                      color: "#fff",
                      background: isPro ? GRADIENTS.button : `${COLORS.primary}`,
                      boxShadow: isPro ? `0 4px 14px ${COLORS.primary}40` : SHADOWS.sm,
                      transition: "all 0.2s ease",
                      opacity: upgrade.isPending ? 0.7 : 1,
                    }}
                    onMouseEnter={(e) => {
                      if (!upgrade.isPending) {
                        (e.target as HTMLElement).style.background = isPro ? GRADIENTS.buttonHover : COLORS.primaryDark;
                        (e.target as HTMLElement).style.boxShadow = isPro ? `0 6px 20px ${COLORS.primary}50` : SHADOWS.md;
                        (e.target as HTMLElement).style.transform = "translateY(-1px)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      (e.target as HTMLElement).style.background = isPro ? GRADIENTS.button : COLORS.primary;
                      (e.target as HTMLElement).style.boxShadow = isPro ? `0 4px 14px ${COLORS.primary}40` : SHADOWS.sm;
                      (e.target as HTMLElement).style.transform = "translateY(0)";
                    }}
                  >
                    {upgrade.isPending ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Zap size={16} />}
                    {t("Подключить", "Ulash")}
                  </button>
                )}
                {current && (
                  <div style={{
                    width: "100%",
                    textAlign: "center",
                    fontSize: "14px",
                    fontWeight: "500",
                    padding: "12px 20px",
                    borderRadius: "12px",
                    color: COLORS.textTertiary,
                    background: "rgba(156,163,175,.10)",
                  }}>
                    {t("Активен", "Faol")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Payment Methods ───────────────────────────────────────────────── */}
      <div style={{
        borderRadius: "24px",
        padding: "24px",
        background: GRADIENTS.card,
        boxShadow: SHADOWS.md,
        marginTop: "32px",
        animation: "slideUp 1s ease forwards",
      }}>
        <div style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "16px",
        }}>
          <div style={{
            width: "40px",
            height: "40px",
            borderRadius: "12px",
            background: "rgba(129,140,248,.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}>
            <Zap size={18} style={{ color: COLORS.primary }} />
          </div>
          <div style={{ fontSize: "14px" }}>
            <p style={{
              fontWeight: "600",
              color: COLORS.textPrimary,
              margin: "0 0 4px",
            }}>{t("Способы оплаты", "To'lov usullari")}</p>
            <p style={{
              color: COLORS.textSecondary,
              margin: 0,
              lineHeight: 1.5,
            }}>
              {t("Оплата через Click, Payme, Uzum Pay. Оператор свяжется с вами в течение 30 минут после запроса.",
                "Click, Payme, Uzum Pay orqali to'lash mumkin. Operator 30 daqiqa ichida bog'lanadi.")}
            </p>
          </div>
        </div>
      </div>

      {/* Spin animation for loader */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
