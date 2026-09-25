import { useMemo, useState, type ReactNode } from "react";
import { AlertCircle, ArrowLeft, Check, ChevronRight, Globe, MapPin, Navigation, Search, ShoppingBag, ShoppingCart } from "lucide-react";
import { useLang } from "@/i18n";
import { PhotoOrIcon } from "@/components/PhotoOrIcon";
import { plural } from "@/lib/plural";
import { CARD } from "./tones";
import { EmptyState } from "./kit";

/*
  Магазины на телефоне — экран «Магазины» мобилки v8 (Warehouse-Pro-Mobile,
  app/(tabs)/shops.tsx): поиск, «Все магазины» и карточки территорий; внутри
  территории — карточки точек с фото, долгом, состоянием и кнопкой заказа.
  Поиск и «ближайшие» показывают плоский список сразу — лишний тап на
  территорию там не нужен.

  Один на агента (свои магазины) и руководство (все): страница отдаёт
  список и что делать по нажатию.
*/
export type BrowserShop = {
  id: number; name: string | null; ownerName?: string | null; debt?: string | number | null; status?: string | null;
  address?: string | null; city?: string | null; district?: string | null; photoUrl?: string | null;
  gpsLat?: string | number | null; gpsLng?: string | number | null;
};

function km(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371, dLat = ((bLat - aLat) * Math.PI) / 180, dLng = ((bLng - aLng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const roundBtn = "flex items-center justify-center rounded-full flex-shrink-0 active:scale-95 transition-transform";

export function ShopCard({ shop, distance, onOpen, onOrder }: {
  shop: BrowserShop; distance?: number; onOpen: () => void; onOrder?: () => void;
}) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const debt = Number(shop.debt ?? 0);
  const active = shop.status !== "inactive";
  const where = [shop.city, shop.district, shop.address].filter(Boolean).join(", ");
  return (
    <div className="flex items-center gap-3" style={{ ...CARD, borderRadius: 24, padding: 16 }} data-testid="phone-shop-card">
      <button type="button" onClick={onOpen} className="flex items-center gap-3 flex-1 min-w-0 text-left">
        <span className="flex-shrink-0 overflow-hidden flex items-center justify-center" style={{ width: 56, height: 56, borderRadius: 16, background: "var(--color-primary-subtle)" }}>
          <PhotoOrIcon src={shop.photoUrl ?? null} alt={shop.name ?? ""} className="w-full h-full object-cover" fallback={<ShoppingBag size={20} color="var(--color-primary-text)" />} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              <span className="block truncate" style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)" }}>{shop.name}</span>
              {shop.ownerName && <span className="block truncate" style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>{shop.ownerName}</span>}
            </span>
            <span className="flex items-center gap-1.5 flex-shrink-0">
              {debt > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-data" style={{ fontSize: 11, fontWeight: 600, background: "var(--color-danger-subtle)", color: "var(--color-danger-text)" }}>
                  <AlertCircle size={10} />{debt.toLocaleString("ru")}
                </span>
              )}
              <span className="rounded-full px-2 py-0.5" style={{ fontSize: 10, fontWeight: 500, background: active ? "var(--color-success-subtle)" : "var(--color-surface-light)", color: active ? "var(--color-success-text)" : "var(--color-text-secondary)" }}>
                {active ? t("Актив", "Faol") : t("Неактив", "Nofaol")}
              </span>
              <ChevronRight size={16} color="var(--color-text-secondary)" />
            </span>
          </span>
          {where && (
            <span className="flex items-center gap-1 mt-1.5 min-w-0">
              <MapPin size={10} color="var(--color-text-secondary)" className="flex-shrink-0" />
              <span className="truncate" style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{where}</span>
            </span>
          )}
          {distance !== undefined && Number.isFinite(distance) && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 mt-1.5" style={{ fontSize: 11, fontWeight: 500, background: distance < 1 ? "var(--color-success-subtle)" : "var(--color-warning-subtle)", color: distance < 1 ? "var(--color-success-text)" : "var(--color-warning-text)" }}>
              <Navigation size={10} />
              {distance < 1 ? `${Math.round(distance * 1000)} ${t("м", "m")}` : `${distance.toFixed(1)} ${t("км", "km")}`}
            </span>
          )}
        </span>
      </button>
      {onOrder && (
        <button type="button" onClick={onOrder} aria-label={t("Новый заказ", "Yangi buyurtma")} className="flex items-center justify-center flex-shrink-0 active:scale-95 transition-transform"
          style={{ width: 44, height: 44, borderRadius: 12, background: "var(--color-primary)", color: "var(--color-on-primary)" }}>
          <ShoppingCart size={18} />
        </button>
      )}
    </div>
  );
}

export function ShopBrowser({ shops, loading, onOpen, onOrder, onAdd, note }: {
  shops: BrowserShop[]; loading?: boolean;
  onOpen: (id: number) => void; onOrder?: (id: number) => void; onAdd?: () => void;
  /** Строка под поиском: «с устройства» и подобное. */
  note?: ReactNode;
}) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const [search, setSearch] = useState("");
  const [territory, setTerritory] = useState<string | null>(null);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const count = (n: number) => `${n} ${t(plural(n, "магазин", "магазина", "магазинов"), "ta do'kon")}`;

  /*
    «Ближайшие» — по кнопке, а не при открытии: браузер спрашивает разрешение
    на место, и спрашивать его без действия человека — значит получить отказ
    на всю жизнь сайта. В мобилке сортировка включена сразу, потому что там
    разрешение уже выдано на входе.
  */
  const toggleNear = () => {
    if (here) { setHere(null); return; }
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      p => { setHere({ lat: p.coords.latitude, lng: p.coords.longitude }); setLocating(false); setTerritory(null); },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = shops
      .filter(s => !q || s.name?.toLowerCase().includes(q) || s.ownerName?.toLowerCase().includes(q) || s.district?.toLowerCase().includes(q))
      .map(s => {
        const lat = Number(s.gpsLat), lng = Number(s.gpsLng);
        return { s, d: here && lat && lng ? km(here.lat, here.lng, lat, lng) : Infinity };
      });
    return here ? list.sort((a, b) => a.d - b.d) : list;
  }, [shops, search, here]);

  const other = lang === "uz" ? "Boshqalar" : "Другие";
  const groups = useMemo(() => {
    const m = new Map<string, typeof filtered>();
    for (const x of filtered) {
      const key = x.s.district || x.s.city || other;
      m.set(key, [...(m.get(key) ?? []), x]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b, "ru"));
  }, [filtered, other]);

  const flat = !!here || !!search.trim();
  const inside = territory === "__all__" ? filtered : groups.find(([k]) => k === territory)?.[1] ?? [];

  const cards = (list: typeof filtered) => list.length === 0
    ? <div style={{ ...CARD, borderRadius: 20 }}><EmptyState icon={ShoppingBag} title={t("Ничего не найдено", "Hech narsa topilmadi")} /></div>
    : list.map(({ s, d }) => (
      <ShopCard key={s.id} shop={s} distance={here ? d : undefined} onOpen={() => onOpen(s.id)} onOrder={onOrder ? () => onOrder(s.id) : undefined} />
    ));

  // ── Внутри территории ──
  if (territory && !flat) {
    return (
      <div className="space-y-3 animate-fade-up">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setTerritory(null)} aria-label={t("Назад", "Orqaga")} className={roundBtn} style={{ ...CARD, width: 36, height: 36, background: "var(--color-surface)" }}>
            <ArrowLeft size={18} color="var(--color-text-primary)" />
          </button>
          <div className="min-w-0">
            <p className="truncate" style={{ fontSize: 20, fontWeight: 800, color: "var(--color-text-primary)", margin: 0 }}>{territory === "__all__" ? t("Все магазины", "Barcha do'konlar") : territory}</p>
            <p style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-tertiary)", margin: "2px 0 0" }}>{count(inside.length)}</p>
          </div>
        </div>
        {cards(inside)}
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-fade-up" data-testid="phone-shops">
      <div className="flex items-center gap-2">
        <label className="flex-1 min-w-0 flex items-center gap-2 px-4" style={{ background: "var(--color-field)", borderRadius: 16, height: 48, boxShadow: "var(--shadow-pressed)" }}>
          <Search size={16} color="var(--color-text-tertiary)" className="flex-shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("Поиск магазинов…", "Do'kon qidirish…")}
            className="flex-1 min-w-0 bg-transparent outline-none"
            style={{ fontSize: 15, color: "var(--color-text-primary)" }}
          />
        </label>
        {typeof navigator !== "undefined" && "geolocation" in navigator && (
          <button type="button" onClick={toggleNear} aria-pressed={!!here} aria-label={t("Сначала ближайшие", "Avval yaqinlari")} className={roundBtn}
            style={{ width: 44, height: 44, background: here ? "var(--color-primary)" : "var(--color-surface)", color: here ? "var(--color-on-primary)" : "var(--color-text-primary)", boxShadow: here ? "none" : "var(--shadow-sm)" }}>
            {here ? <Check size={18} /> : <Navigation size={18} className={locating ? "animate-pulse" : ""} />}
          </button>
        )}
        {onAdd && (
          <button type="button" onClick={onAdd} aria-label={t("Добавить магазин", "Do'kon qo'shish")} className={roundBtn}
            style={{ width: 44, height: 44, background: "var(--color-primary)", color: "var(--color-on-primary)" }}>
            <span style={{ fontSize: 22, lineHeight: 1, marginTop: -2 }}>+</span>
          </button>
        )}
      </div>
      {note}

      {loading ? (
        [0, 1, 2, 3].map(i => <div key={i} className="h-[88px] rounded-3xl animate-pulse" style={{ background: "var(--color-surface-light)" }} />)
      ) : flat ? cards(filtered) : (
        <>
          <TerritoryRow icon={<Globe size={20} color="var(--color-primary-text)" />} title={t("Все магазины", "Barcha do'konlar")} sub={count(filtered.length)} onClick={() => setTerritory("__all__")} />
          {groups.map(([name, list]) => (
            <TerritoryRow key={name} icon={<MapPin size={20} color="var(--color-primary-text)" />} title={name} sub={count(list.length)} onClick={() => setTerritory(name)} />
          ))}
        </>
      )}
    </div>
  );
}

function TerritoryRow({ icon, title, sub, onClick }: { icon: ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full flex items-center gap-3 text-left active:scale-[0.99] transition-transform" style={{ ...CARD, borderRadius: 24, padding: 16 }} data-testid="phone-territory">
      <span className="flex items-center justify-center flex-shrink-0" style={{ width: 48, height: 48, borderRadius: 16, background: "var(--color-primary-subtle)" }}>{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block truncate" style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)" }}>{title}</span>
        <span className="block" style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 2 }}>{sub}</span>
      </span>
      <ChevronRight size={18} color="var(--color-text-secondary)" />
    </button>
  );
}
