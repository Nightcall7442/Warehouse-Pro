import { useState } from "react";
import { useCurrency } from "@/hooks/useCurrency";
import { trpc } from "@/providers/trpc";
import { useNavigate } from "react-router";
import { notify } from "@/lib/toast";
import { useLang } from "@/i18n";
import {
  Store, Phone, MapPin, AlertCircle, PlusCircle,
  Search, X, Loader2, Plus,
} from "lucide-react";

// ── Форма добавления магазина агентом ─────────────────────────────────────────
function AddShopModal({ onClose }: { onClose: () => void }) {
  const { lang } = useLang();
  const utils    = trpc.useUtils();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const [form, setForm] = useState({
    name: "", ownerName: "", phone: "", address: "", city: "", district: "", notes: "",
  });
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsCoords, setGpsCoords] = useState<{ lat: string; lng: string } | null>(null);

  const createMutation = trpc.agent.createShop.useMutation({
    onSuccess: () => {
      utils.agent.myShops.invalidate();
      notify.success(t("Магазин добавлен!", "Do'kon qo'shildi!"));
      onClose();
    },
    onError: (e) => notify.error(e.message),
  });

  const captureGps = () => {
    if (!navigator.geolocation) { notify.error("GPS недоступен"); return; }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsCoords({
          lat: pos.coords.latitude.toFixed(8),
          lng: pos.coords.longitude.toFixed(8),
        });
        setGpsLoading(false);
        notify.success(t("GPS определён", "GPS aniqlandi"));
      },
      () => { notify.error(t("Не удалось определить GPS", "GPS aniqlanmadi")); setGpsLoading(false); }
    );
  };

  const handleSave = () => {
    if (!form.name.trim()) { notify.error(t("Введите название", "Nom kiriting")); return; }
    createMutation.mutate({
      ...form,
      gpsLat: gpsCoords?.lat,
      gpsLng: gpsCoords?.lng,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
    >
      <div className="w-full sm:max-w-md bg-[#ffffff] rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg text-text-primary">
            {t("Новый магазин", "Yangi do'kon")}
          </h2>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <X size={18} />
          </button>
        </div>

        {/* Fields */}
        <div className="space-y-3">
          <div>
            <label className="font-label text-text-secondary text-xs block mb-1">
              {t("НАЗВАНИЕ *", "NOMI *")}
            </label>
            <input
              className="neo-input"
              placeholder={t("Название магазина", "Do'kon nomi")}
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-label text-text-secondary text-xs block mb-1">
                {t("ВЛАДЕЛЕЦ", "EGASI")}
              </label>
              <input
                className="neo-input"
                placeholder={t("Имя владельца", "Egasi ismi")}
                value={form.ownerName}
                onChange={e => setForm({ ...form, ownerName: e.target.value })}
              />
            </div>
            <div>
              <label className="font-label text-text-secondary text-xs block mb-1">
                {t("ТЕЛЕФОН", "TELEFON")}
              </label>
              <input
                className="neo-input"
                placeholder="+998 ..."
                type="tel"
                value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="font-label text-text-secondary text-xs block mb-1">
              {t("АДРЕС", "MANZIL")}
            </label>
            <input
              className="neo-input"
              placeholder={t("Улица, дом", "Ko'cha, uy")}
              value={form.address}
              onChange={e => setForm({ ...form, address: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-label text-text-secondary text-xs block mb-1">
                {t("ГОРОД", "SHAHAR")}
              </label>
              <input
                className="neo-input"
                placeholder={t("Город", "Shahar")}
                value={form.city}
                onChange={e => setForm({ ...form, city: e.target.value })}
              />
            </div>
            <div>
              <label className="font-label text-text-secondary text-xs block mb-1">
                {t("РАЙОН", "TUMAN")}
              </label>
              <input
                className="neo-input"
                placeholder={t("Район", "Tuman")}
                value={form.district}
                onChange={e => setForm({ ...form, district: e.target.value })}
              />
            </div>
          </div>

          {/* GPS */}
          <div>
            <button
              type="button"
              onClick={captureGps}
              disabled={gpsLoading}
              className="neo-btn w-full flex items-center justify-center gap-2 text-sm py-2.5"
            >
              {gpsLoading
                ? <Loader2 size={15} className="animate-spin" />
                : <MapPin size={15} className={gpsCoords ? "text-success" : ""} />}
              {gpsCoords
                ? t(`GPS: ${gpsCoords.lat}, ${gpsCoords.lng}`, `GPS: ${gpsCoords.lat}, ${gpsCoords.lng}`)
                : t("Определить GPS", "GPS aniqlash")}
            </button>
          </div>

          <div>
            <label className="font-label text-text-secondary text-xs block mb-1">
              {t("ЗАМЕТКИ", "ESLATMALAR")}
            </label>
            <textarea
              className="neo-input resize-none"
              rows={2}
              placeholder={t("Дополнительная информация", "Qo'shimcha ma'lumot")}
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={createMutation.isPending || !form.name.trim()}
            className="neo-btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {createMutation.isPending && <Loader2 size={14} className="animate-spin" />}
            {t("Добавить магазин", "Do'kon qo'shish")}
          </button>
          <button onClick={onClose} className="neo-btn px-4">
            {t("Отмена", "Bekor")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function AgentShops() {
  const [search, setSearch]       = useState("");
  const [showAdd, setShowAdd]     = useState(false);
  const { fmt }                   = useCurrency();
  const { lang }                  = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const { data: shops, isLoading } = trpc.agent.myShops.useQuery();
  const navigate                   = useNavigate();

  const filtered = shops?.filter(s =>
    !search ||
    s.name?.toLowerCase().includes(search.toLowerCase()) ||
    s.ownerName?.toLowerCase().includes(search.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-surface-light animate-pulse rounded" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 bg-surface-light animate-pulse rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showAdd && <AddShopModal onClose={() => setShowAdd(false)} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-primary tracking-tight">
            {t("Мои магазины", "Mening do'konlarim")}
          </h1>
          <p className="text-text-secondary text-sm mt-0.5">
            {shops?.length ?? 0} {t("магазинов", "ta do'kon")}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="neo-btn-primary flex items-center gap-2"
        >
          <Plus size={16} />
          <span className="hidden sm:inline">{t("Добавить", "Qo'shish")}</span>
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
        <input
          className="neo-input pl-10 w-full"
          placeholder={t("Поиск магазинов…", "Do'kon qidirish…")}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {filtered?.length === 0 && (
        <div className="text-center py-16">
          <Store size={40} className="text-text-secondary mx-auto mb-3 opacity-40" />
          <p className="text-text-secondary text-sm">
            {shops?.length === 0
              ? t("Нет магазинов — добавьте первый!", "Do'kon yo'q — birinchisini qo'shing!")
              : t("Ничего не найдено", "Hech narsa topilmadi")}
          </p>
          {shops?.length === 0 && (
            <button
              onClick={() => setShowAdd(true)}
              className="neo-btn-primary mt-4 flex items-center gap-2 mx-auto"
            >
              <Plus size={16} />
              {t("Добавить магазин", "Do'kon qo'shish")}
            </button>
          )}
        </div>
      )}

      <div className="space-y-3">
        {filtered?.map(shop => (
          <div key={shop.id} className="neo-card p-4">
            <div className="flex items-start gap-3">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(75,108,246,.10)" }}
              >
                <Store size={19} className="text-primary" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-text-primary">{shop.name}</p>
                    <p className="text-sm text-text-secondary">{shop.ownerName ?? t("Владелец не указан", "Egasi ko'rsatilmagan")}</p>
                  </div>
                  {Number(shop.debt ?? 0) > 0 && (
                    <div className="flex items-center gap-1 flex-shrink-0 px-2 py-1 rounded-lg"
                      style={{ background: "rgba(232,80,80,.10)" }}>
                      <AlertCircle size={13} className="text-danger" />
                      <span className="text-sm font-data text-danger">{fmt(shop.debt)}</span>
                    </div>
                  )}
                </div>

                {shop.address && (
                  <div className="flex items-center gap-1.5 mt-2">
                    <MapPin size={11} className="text-text-secondary flex-shrink-0" />
                    <span className="text-xs text-text-secondary truncate">{shop.address}</span>
                  </div>
                )}

                {shop.phone && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <Phone size={11} className="text-text-secondary flex-shrink-0" />
                    <a href={`tel:${shop.phone}`} className="text-xs text-primary" onClick={e => e.stopPropagation()}>
                      {shop.phone}
                    </a>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => navigate(`/orders/new?shopId=${shop.id}`)}
                    className="neo-btn-primary flex-1 py-2 text-xs flex items-center justify-center gap-1.5"
                  >
                    <PlusCircle size={13} />
                    {t("Новый заказ", "Yangi buyurtma")}
                  </button>
                  {shop.gpsLat && shop.gpsLng && (
                    <a
                      href={`https://maps.google.com/?q=${shop.gpsLat},${shop.gpsLng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="neo-btn py-2 px-3 flex items-center gap-1.5 text-xs"
                      onClick={e => e.stopPropagation()}
                    >
                      <MapPin size={13} />
                      {t("Карта", "Xarita")}
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
