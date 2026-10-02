import { useNavigate } from "react-router";
import { Flame, ChevronRight } from "lucide-react";
import { useLang } from "@/i18n";
import { useMoney } from "./use-money";
import { plural } from "@/lib/plural";
import { CARD } from "@/components/phone/tones";
import { useExpiryHome } from "./use-expiry-home";

/*
  «Сгорит на складе» — на главной директора, без поиска по меню.

  Раньше директор узнавал о сгорающем, дойдя до склада → отчётов и
  прокрутив. Здесь — одна карточка, только когда есть что делать (партии не
  успеют до срока или уже просрочены), и только директору: деньги в ней по
  закупке, а главную открывает ещё супервайзер, которому склад не отдают.
  Тап ведёт в раздел склада «Сроки», где у каждой партии — действие.
*/
export function ExpiryHomeCard({ variant }: { variant: "desk" | "phone" }) {
  const { lang } = useLang();
  const fmt = useMoney();
  const navigate = useNavigate();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const data = useExpiryHome();
  if (!data) return null;

  const batches = (n: number) => lang === "uz" ? `${n} partiya` : `${n} ${plural(n, "партия", "партии", "партий")}`;
  const risk = data.riskCost ?? data.riskSale;
  const lost = data.expiredCost ?? data.expiredSale;
  const open = () => navigate("/warehouse?tab=expiry");

  const numbers = (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
      {data.riskCount > 0 && (
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: 0 }}>
            {t(`не успеют до срока: ${batches(data.riskCount)}`, `muddatgacha ulgurmaydi: ${batches(data.riskCount)}`)}
          </p>
          <p className="font-data" style={{ fontSize: 18, fontWeight: 800, color: "var(--color-text-primary)", margin: 0, whiteSpace: "nowrap" }} data-testid="expiry-home-risk">
            {fmt(risk)}
          </p>
        </div>
      )}
      {data.expiredCount > 0 && (
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: 0 }}>
            {t(`просрочено: ${batches(data.expiredCount)}`, `muddati o'tgan: ${batches(data.expiredCount)}`)}
          </p>
          <p className="font-data" style={{ fontSize: 18, fontWeight: 800, color: "var(--color-danger-text)", margin: 0, whiteSpace: "nowrap" }}>
            {fmt(lost)}
          </p>
        </div>
      )}
    </div>
  );
  const note = data.markedDown > 0
    ? t(`по закупке · уценено ${data.markedDown} из ${data.riskCount}`, `xarid bo'yicha · ${data.riskCount} tadan ${data.markedDown} tasi arzonlashtirilgan`)
    : t("по закупке · уценить или списать — в разделе «Сроки»", "xarid bo'yicha · arzonlashtirish yoki hisobdan chiqarish — «Muddatlar» bo'limida");
  const title = (
    <span className="flex items-center gap-2">
      <Flame size={16} color="var(--color-danger-text)" />
      <span style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text-primary)" }}>{t("Сгорит на складе", "Omborda yonadi")}</span>
    </span>
  );

  /*
    На телефоне — карточкой в ленте главной, как «Долги магазинов»; на столе —
    полосой: заголовок слева, числа посередине, куда идти — справа.
  */
  return variant === "phone" ? (
    <button type="button" onClick={open} className="w-full text-left" style={{ ...CARD, borderRadius: 24, padding: 20 }} data-testid="expiry-home-card">
      <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
        {title}
        <span className="flex-1" />
        <ChevronRight size={18} color="var(--color-text-tertiary)" />
      </div>
      {numbers}
      <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: "8px 0 0" }}>{note}</p>
    </button>
  ) : (
    <button type="button" onClick={open} className="neo-card-sm w-full text-left" style={{ padding: "16px 20px", borderLeft: "3px solid var(--color-danger)", cursor: "pointer" }} data-testid="expiry-home-card">
      <div className="flex flex-wrap items-center gap-x-10 gap-y-3">
        <div style={{ minWidth: 200 }}>
          {title}
          <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: "4px 0 0" }}>{note}</p>
        </div>
        {numbers}
        <span className="flex-1" />
        <span className="flex items-center gap-1" style={{ fontSize: 13, fontWeight: 600, color: "var(--color-primary-text)", whiteSpace: "nowrap" }}>
          {t("Открыть «Сроки»", "«Muddatlar»ni ochish")}
          <ChevronRight size={16} />
        </span>
      </div>
    </button>
  );
}
