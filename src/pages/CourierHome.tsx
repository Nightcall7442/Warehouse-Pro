import { useNavigate } from "react-router";
import { Truck, User } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import {
  ListCard, ListRow, SectionHead, Tile, CtaTile, EmptyState, RowsSkeleton, HomeGreeting, Donut, MiniBars, ProgressBar, StatusPill,
} from "@/components/phone/kit";
import { CARD, deliveryTone, deliveryStatusWord } from "@/components/phone/tones";

/*
  Главная курьера — CourierHome мобилки v8 (Warehouse-Pro-Mobile,
  app/(tabs)/index.tsx). В вебе её не было: курьер сразу попадал в список
  доставок и не видел дня целиком — сколько ждёт, сколько в пути, сколько
  довёз. Владелец, 25.09.2026: «все сделай абсолютно».

  Список доставок отдаёт только не довезённое, поэтому «Доставлено» за
  сегодня считает сервер (kpi.courierKpi, период today) — как в мобилке.
*/
/** Показатель дня: слово, число его цветом и столбики трёх состояний. */
function Stat({ label, value, color, bars }: { label: string; value: number; color: string; bars: number[] }) {
  return (
    <div className="flex-1 min-w-0" style={{ ...CARD, borderRadius: 24, padding: 16 }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-tertiary)", margin: 0 }}>{label}</p>
      <p className="font-data" style={{ fontSize: 28, fontWeight: 700, color, margin: "6px 0 8px", lineHeight: 1.1 }}>{value}</p>
      <MiniBars data={bars} color={color} />
    </div>
  );
}
export default function CourierHome() {
  const navigate = useNavigate();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);

  const { data: deliveries, isLoading } = trpc.courier.listMyDeliveries.useQuery(undefined);
  const { data: today } = trpc.kpi.courierKpi.useQuery({ period: "today" }, { retry: false });

  const assigned  = (deliveries ?? []).filter(d => d.deliveryStatus === "assigned").length;
  const inTransit = (deliveries ?? []).filter(d => d.deliveryStatus === "out_for_delivery").length;
  const delivered = Number(today?.delivered ?? 0);
  const total     = assigned + inTransit + delivered;
  const pct       = total > 0 ? Math.round((delivered / total) * 100) : 0;
  const pctColor  = pct >= 80 ? "var(--color-success-text)" : "var(--color-primary-text)";
  const bars      = [assigned, inTransit, delivered];

  return (
    <div className="space-y-5 animate-fade-up" data-testid="courier-home">
      <HomeGreeting title={t("Доставки", "Yetkazish")} />

      {/* ── День в числах ── */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-[132px] rounded-3xl animate-pulse" style={{ background: "var(--color-surface-light)" }} />)}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-3">
            <Stat bars={bars} label={t("Ожидают", "Kutilmoqda")} value={assigned} color="var(--color-info-text)" />
            <Stat bars={bars} label={t("В пути", "Yo'lda")} value={inTransit} color="var(--color-warning-text)" />
          </div>
          <div className="flex gap-3">
            <Stat bars={bars} label={t("Доставлено", "Yetkazildi")} value={delivered} color="var(--color-success-text)" />
            <div className="flex-1 min-w-0 flex flex-col items-center justify-center" style={{ ...CARD, borderRadius: 24, padding: 16 }}>
              <Donut size={72} stroke={7} segments={[{ value: pct, color: pctColor }, { value: 100 - pct, color: "transparent" }]} center={`${pct}%`} />
              <p style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", margin: "6px 0 0" }}>{t("Прогресс", "Jarayon")}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Прогресс дня ── */}
      <section style={{ ...CARD, borderRadius: 24, padding: 20 }}>
        <div className="flex items-center justify-between mb-3">
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)" }}>{t("Прогресс дня", "Kun jarayoni")}</span>
          <span className="font-data" style={{ fontSize: 13, fontWeight: 700, color: pctColor }}>{delivered}/{total} · {pct}%</span>
        </div>
        <ProgressBar value={pct} color={pct >= 80 ? "var(--color-success)" : "var(--color-primary)"} />
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", margin: "10px 0 0" }}>
          {total === 0
            ? t("Нет заказов на сегодня", "Bugunga buyurtma yo'q")
            : delivered === total ? t("Все доставлены!", "Hammasi yetkazildi!") : t(`Осталось ${total - delivered}`, `${total - delivered} ta qoldi`)}
        </p>
      </section>

      {/* ── Быстрые действия ── */}
      <div className="flex gap-3">
        <CtaTile icon={Truck} label={t("Доставки", "Yetkazish")} onClick={() => navigate("/deliveries")} testId="courier-deliveries" />
        <Tile big icon={User} label={t("Профиль", "Profil")} tint="var(--color-info-text)" onClick={() => navigate("/settings")} />
      </div>

      {/* ── Последние доставки ── */}
      <section>
        <SectionHead
          icon={Truck}
          title={t("Последние доставки", "So'nggi yetkazishlar")}
          aside={<span className="flex-shrink-0" style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-tertiary)" }}>{total} {t("заказов", "ta buyurtma")}</span>}
        />
        <ListCard>
          {isLoading ? <RowsSkeleton rows={3} /> : !deliveries?.length ? (
            <EmptyState icon={Truck} title={t("Доставок пока нет", "Hali yetkazish yo'q")} />
          ) : deliveries.slice(0, 5).map((d, i) => {
            const tone = deliveryTone(d.deliveryStatus ?? "");
            return (
              <ListRow key={d.id} first={i === 0} onClick={() => navigate("/deliveries")}>
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: tone.dot }} />
                <div className="flex-1 min-w-0">
                  <p className="truncate font-data" style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>{d.orderNumber}</p>
                  <p className="truncate" style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: "2px 0 0" }}>{d.shopName ?? "—"}</p>
                </div>
                <StatusPill dot={tone.dot} text={tone.text} label={deliveryStatusWord(d.deliveryStatus ?? "", lang)} />
              </ListRow>
            );
          })}
        </ListCard>
      </section>
    </div>
  );
}
