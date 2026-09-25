import { useRef, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { AlertCircle, Camera, CheckCircle2, Crosshair, FileText, Loader2, MapPin, Navigation, Phone, ShoppingCart, User, WifiOff, Search } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/hooks/useCurrency";
import { notify } from "@/lib/toast";
import { compressImage } from "@/lib/compress-image";
import { PhotoOrIcon } from "@/components/PhotoOrIcon";
import { ListCard, ListRow, EmptyState, StatusPill } from "@/components/phone/kit";
import { CARD } from "@/components/phone/tones";

/*
  Карточка магазина для агента — экран мобилки v8 (Warehouse-Pro-Mobile,
  app/shop/[id].tsx): фото шапкой, долг, сведения о точке, состояние и
  «Новый заказ». В вебе у агента карточки не было вовсе: /shops/:id открыт
  только руководству, и нажатие на магазин вело сразу в новый заказ.
  Владелец, 25.09.2026: «все сделай абсолютно».

  Запросы — агентские: agent.getShopById (любая точка своей организации) и
  agent.uploadMyShopPhoto (фото — то, что агент снимает на месте). Правка
  реквизитов — дело офиса, как и в мобилке.
*/
export default function AgentShopDetail() {
  const { id } = useParams();
  const shopId = Number(id);
  const navigate = useNavigate();
  const { lang } = useLang();
  const { user } = useAuth();
  const { fmt } = useCurrency();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const file = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const { data: shop, isLoading, isError, refetch } = trpc.agent.getShopById.useQuery({ id: shopId }, { enabled: Number.isFinite(shopId) });
  const photo = trpc.agent.uploadMyShopPhoto.useMutation({
    onSuccess: () => {
      utils.agent.getShopById.invalidate({ id: shopId });
      utils.agent.myShops.invalidate();
      notify.success(t("Фото обновлено", "Rasm yangilandi"));
    },
    onError: e => notify.error(e.message),
  });

  const pick = async (f: File | undefined) => {
    if (!f) return;
    try {
      photo.mutate({ shopId, dataUrl: await compressImage(f) });
    } catch (e) {
      notify.error(e instanceof Error ? e.message : t("Ошибка загрузки", "Yuklashda xato"));
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[200, 72, 220].map((h, i) => <div key={i} className="rounded-3xl animate-pulse" style={{ height: h, background: "var(--color-surface-light)" }} />)}
      </div>
    );
  }
  if (isError || !shop) {
    return (
      <div style={{ ...CARD, borderRadius: 24 }}>
        <EmptyState icon={isError ? WifiOff : Search} title={isError ? t("Ошибка загрузки", "Yuklashda xato") : t("Магазин не найден", "Do'kon topilmadi")} />
        {isError && (
          <div className="flex justify-center pb-6">
            <button type="button" onClick={() => refetch()} className="neo-btn-primary">{t("Повторить", "Qayta urinish")}</button>
          </div>
        )}
      </div>
    );
  }

  const debt = Number(shop.debt ?? 0);
  const hasDebt = debt > 0;
  const active = shop.status === "active";
  const place = [shop.city, shop.district].filter(Boolean).join(", ");
  const hasGps = !!(shop.gpsLat && shop.gpsLng);
  const sells = user?.role !== "merchandiser";

  return (
    <div className="space-y-4 animate-fade-up" data-testid="agent-shop-detail">
      {/* ── Фото шапкой: нажатие — снять или выбрать новое ── */}
      <button
        type="button"
        onClick={() => file.current?.click()}
        disabled={photo.isPending}
        className="relative w-full overflow-hidden block text-left"
        style={{ height: 200, borderRadius: 24, background: "var(--color-primary)" }}
        aria-label={t("Фото магазина", "Do'kon rasmi")}
      >
        {shop.photoUrl && <PhotoOrIcon src={shop.photoUrl} alt={shop.name ?? ""} className="absolute inset-0 w-full h-full object-cover" fallback={null} />}
        <span className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,.05) 30%, rgba(0,0,0,.55) 100%)" }} />
        <span className="absolute top-3 right-3 flex items-center justify-center rounded-full" style={{ width: 36, height: 36, background: "rgba(0,0,0,.4)", color: "#fff" }}>
          {photo.isPending ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
        </span>
        <span className="absolute left-4 right-4 bottom-4">
          <span className="block" style={{ fontSize: 24, fontWeight: 800, color: "#fff", lineHeight: 1.2 }}>{shop.name}</span>
          {place && <span className="block" style={{ fontSize: 13, color: "rgba(255,255,255,.85)", marginTop: 2 }}>{place}</span>}
        </span>
      </button>
      <input ref={file} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { void pick(e.target.files?.[0]); e.target.value = ""; }} />

      {/* ── Долг ── */}
      <div
        className="flex items-center justify-between"
        style={{ borderRadius: 20, padding: 16, background: hasDebt ? "var(--color-danger-subtle)" : "var(--color-success-subtle)" }}
        data-testid="agent-shop-debt"
      >
        <div>
          <p style={{ fontSize: 13, color: hasDebt ? "var(--color-danger-text)" : "var(--color-success-text)", margin: "0 0 4px" }}>
            {hasDebt ? t("Текущий долг", "Joriy qarz") : t("Задолженность", "Qarz")}
          </p>
          <p className="font-data" style={{ fontSize: 26, fontWeight: 800, color: hasDebt ? "var(--color-danger-text)" : "var(--color-success-text)", margin: 0 }}>{fmt(debt)}</p>
        </div>
        {hasDebt ? <AlertCircle size={28} color="var(--color-danger-text)" /> : <CheckCircle2 size={28} color="var(--color-success-text)" />}
      </div>

      {/* ── Сведения ── */}
      <ListCard>
        {[
          shop.ownerName && <Info key="o" icon={<User size={16} />} label={t("Владелец", "Egasi")} value={shop.ownerName} />,
          shop.phone && <Info key="p" icon={<Phone size={16} />} label={t("Телефон", "Telefon")} value={<a href={`tel:${shop.phone}`} style={{ color: "var(--color-primary-text)" }}>{shop.phone}</a>} />,
          shop.address && <Info key="a" icon={<MapPin size={16} />} label={t("Адрес", "Manzil")} value={shop.address} />,
          shop.city && <Info key="c" icon={<Navigation size={16} />} label={t("Город", "Shahar")} value={place} />,
          hasGps && <Info key="g" icon={<Crosshair size={16} />} label={t("Геолокация", "Joylashuv")} value={
            <a href={`https://maps.google.com/?q=${shop.gpsLat},${shop.gpsLng}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-primary-text)" }}>
              {Number(shop.gpsLat).toFixed(6)}, {Number(shop.gpsLng).toFixed(6)}
            </a>
          } />,
          shop.notes && <Info key="n" icon={<FileText size={16} />} label={t("Заметки", "Izoh")} value={shop.notes} />,
        ].filter(Boolean).map((row, i) => <ListRow key={i} first={i === 0}>{row}</ListRow>)}
      </ListCard>

      {/* ── Состояние ── */}
      <div className="flex items-center justify-between" style={{ ...CARD, borderRadius: 20, padding: 16 }}>
        <span style={{ fontSize: 15, fontWeight: 500, color: "var(--color-text-primary)" }}>{t("Статус", "Holat")}</span>
        <StatusPill
          dot={active ? "var(--color-success)" : "var(--color-text-tertiary)"}
          text={active ? "var(--color-success-text)" : "var(--color-text-secondary)"}
          label={active ? t("Активен", "Faol") : t("Неактивен", "Faol emas")}
        />
      </div>

      {/* ── Новый заказ ── */}
      {active && sells && (
        <button
          type="button"
          onClick={() => navigate(`/orders/new?shopId=${shop.id}`)}
          className="w-full flex items-center justify-center gap-2.5 active:scale-[0.99] transition-transform"
          style={{ background: "var(--color-primary)", color: "var(--color-on-primary)", borderRadius: 20, padding: "16px 20px", fontSize: 15, fontWeight: 700 }}
          data-testid="agent-shop-order"
        >
          <ShoppingCart size={20} />
          {t("Новый заказ", "Yangi buyurtma")}
        </button>
      )}
    </div>
  );
}

function Info({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <>
      <span className="flex items-center justify-center flex-shrink-0" style={{ width: 36, height: 36, borderRadius: 10, background: "var(--color-primary-subtle)", color: "var(--color-primary-text)" }}>{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block" style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{label}</span>
        <span className="block break-words" style={{ fontSize: 15, fontWeight: 500, color: "var(--color-text-primary)", marginTop: 2 }}>{value}</span>
      </span>
    </>
  );
}
