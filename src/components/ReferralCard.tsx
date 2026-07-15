import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { Share2, Copy, Gift, Users, CheckCircle2, ArrowRight } from "lucide-react";

export function ReferralCard() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const { data: referral, isLoading } = trpc.user.referral.myCode.useQuery();
  const applyCode = trpc.user.referral.applyCode.useMutation({
    onSuccess: () => notify.success(t("Код применён!", "Kod qo'llanildi!")),
    onError: (e) => notify.error(e.message),
  });
  const { data: referrals } = trpc.user.referral.list.useQuery();
  const [inputCode, setInputCode] = useState("");
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (referral?.code) {
      navigator.clipboard.writeText(referral.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleShare = () => {
    const url = `${window.location.origin}/register?ref=${referral?.code}`;
    if (navigator.share) {
      navigator.share({
        title: "Warehouse Pro",
        text: t("Присоединяйтесь к Warehouse Pro!", "Warehouse Pro ga qo'shiling!"),
        url,
      });
    } else {
      navigator.clipboard.writeText(url);
      notify.success(t("Ссылка скопирована!", "Havola nusxalandi!"));
    }
  };

  if (isLoading) return null;

  return (
    <div className="neo-card" style={{ padding: "20px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
        <div style={{
          width: "36px", height: "36px", borderRadius: "10px",
          background: "linear-gradient(135deg, #f06895, #f5a825)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Gift size={18} color="#fff" />
        </div>
        <div>
          <h3 style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>
            {t("Реферальная программа", "Taklif dasturi")}
          </h3>
          <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: "2px 0 0" }}>
            {t("Приглашайте друзей — получайте 30 дней бесплатно", "Do'stlarni taklif qiling — 30 kun bepul")}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "16px" }}>
        <div className="neo-card-sm" style={{ padding: "12px", textAlign: "center" }}>
          <p style={{ fontSize: "22px", fontWeight: 700, color: "var(--color-primary)", margin: 0 }}>
            {referral?.referralCount ?? 0}
          </p>
          <p style={{ fontSize: "10px", color: "var(--color-text-tertiary)", margin: "2px 0 0", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {t("Приглашено", "Taklif qilindi")}
          </p>
        </div>
        <div className="neo-card-sm" style={{ padding: "12px", textAlign: "center" }}>
          <p style={{ fontSize: "22px", fontWeight: 700, color: "var(--color-success)", margin: 0 }}>
            {referral?.totalRewards ?? 0}
          </p>
          <p style={{ fontSize: "10px", color: "var(--color-text-tertiary)", margin: "2px 0 0", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {t("Дней бонус", "Kun bonus")}
          </p>
        </div>
      </div>

      {/* Referral Code */}
      <div style={{ marginBottom: "16px" }}>
        <p style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
          {t("Ваш код", "Sizning kodingiz")}
        </p>
        <div style={{ display: "flex", gap: "8px" }}>
          <div style={{
            flex: 1, padding: "10px 14px", borderRadius: "10px",
            background: "var(--color-surface-light)", fontFamily: "monospace",
            fontSize: "14px", fontWeight: 600, color: "var(--color-primary)",
            display: "flex", alignItems: "center",
          }}>
            {referral?.code ?? "—"}
          </div>
          <button onClick={handleCopy} className="neo-btn" style={{ padding: "10px 14px" }}>
            {copied ? <CheckCircle2 size={16} style={{ color: "var(--color-success)" }} /> : <Copy size={16} />}
          </button>
          <button onClick={handleShare} className="neo-btn-primary" style={{ padding: "10px 14px" }}>
            <Share2 size={16} />
          </button>
        </div>
      </div>

      {/* Apply Code */}
      <div style={{ marginBottom: "16px" }}>
        <p style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
          {t("Ввести чужой код", "Boshqa kodni kiritish")}
        </p>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            className="neo-input flex-1"
            placeholder={t("Реферальный код", "Taklif kodi")}
            value={inputCode}
            onChange={e => setInputCode(e.target.value.toUpperCase())}
          />
          <button
            onClick={() => { if (inputCode) applyCode.mutate({ code: inputCode }); }}
            disabled={!inputCode || applyCode.isPending}
            className="neo-btn-primary"
            style={{ padding: "10px 16px" }}
          >
            {applyCode.isPending ? "…" : t("Применить", "Qo'llash")}
          </button>
        </div>
      </div>

      {/* Referral List */}
      {referrals && referrals.length > 0 && (
        <div>
          <p style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
            {t("Ваши рефералы", "Sizning takliflaringiz")}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {referrals.slice(0, 5).map(r => (
              <div key={r.id} style={{
                display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px",
                borderRadius: "8px", background: "var(--color-surface-light)",
              }}>
                <div style={{
                  width: "28px", height: "28px", borderRadius: "8px",
                  background: "var(--color-primary-subtle)", display: "flex",
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Users size={12} style={{ color: "var(--color-primary)" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-primary)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.name}
                  </p>
                  <p style={{ fontSize: "10px", color: "var(--color-text-tertiary)", margin: 0 }}>
                    {r.daysSinceRegistration} {t("дн. назад", "kun oldin")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
