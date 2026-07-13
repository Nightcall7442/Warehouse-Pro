import { useParams, useNavigate } from "react-router";
import { useCurrency } from "@/hooks/useCurrency";
import { useRef, useState, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { useLang } from "@/i18n";
import { format } from "date-fns";
import {
  ArrowLeft, Store, Phone, MapPin, Edit2, Plus,
  AlertCircle, Loader2, CheckCircle2, X, Trash2, ChevronRight, Camera,
} from "lucide-react";
import { PremiumSelect } from "@/components/PremiumSelect";

const STATUS_COLORS: Record<string, string> = {
  new: "#4b6cf6", processing: "#e8a830", completed: "#34c473", cancelled: "#e85050",
};
const STATUS_LABELS: Record<string, { ru: string; uz: string }> = {
  new:        { ru: "Новый",       uz: "Yangi"         },
  processing: { ru: "В обработке", uz: "Jarayonda"     },
  completed:  { ru: "Выполнен",    uz: "Bajarildi"     },
  cancelled:  { ru: "Отменён",     uz: "Bekor"         },
};

// ── Форма платежа ─────────────────────────────────────────────────────────────
function PaymentModal({ shopId, onClose }: { shopId: number; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [type,   setType]   = useState<"payment" | "debt">("payment");
  const [notes,  setNotes]  = useState("");
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const utils = trpc.useUtils();

  const addPayment = trpc.shop.addPayment.useMutation({
    onSuccess: () => {
      utils.shop.getById.invalidate({ id: shopId });
      notify.success(t("Платёж записан", "To'lov kiritildi"));
      onClose();
    },
    onError: (e) => notify.error(e.message),
  });

  const options = [
    { val: "payment", labelRu: "💰 Оплата (уменьшает долг)",    labelUz: "💰 To'lov (qarzni kamaytiradi)"  },
    { val: "debt",    labelRu: "📋 Новый долг (увеличивает)",    labelUz: "📋 Yangi qarz (oshiradi)"        },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}>
      <div className="w-full sm:max-w-md bg-[#ffffff] rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base text-text-primary">{t("Добавить платёж", "To'lov qo'shish")}</h2>
          <button onClick={onClose} className="btn-ghost p-1.5"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {options.map(o => (
            <button key={o.val} onClick={() => setType(o.val as "payment" | "debt")}
              className={`py-3 px-3 rounded-lg border text-xs font-medium text-left transition-all ${
                type === o.val
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border-subtle text-text-secondary hover:border-border-strong"
              }`}>
              {lang === "uz" ? o.labelUz : o.labelRu}
            </button>
          ))}
        </div>

        <div>
          <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">
            {t("СУММА", "SUMMA")}
          </label>
          <input type="number" step="0.01" min="0"
            className="neo-input w-full font-data text-lg"
            placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} autoFocus />
        </div>

        <div>
          <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">
            {t("ПРИМЕЧАНИЯ", "IZOHLAR")}
          </label>
          <input className="neo-input w-full" placeholder={t("Комментарий…", "Izoh…")}
            value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => amount && addPayment.mutate({ shopId, amount, type, notes: notes || undefined })}
            disabled={addPayment.isPending || !amount}
            className="neo-btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-40">
            {addPayment.isPending && <Loader2 size={14} className="animate-spin" />}
            {t("Записать", "Kiritish")}
          </button>
          <button onClick={onClose} className="neo-btn px-5">{t("Отмена", "Bekor")}</button>
        </div>
      </div>
    </div>
  );
}

// ── Главная страница магазина ─────────────────────────────────────────────────
export default function ShopDetail() {
  const { id }   = useParams<{ id: string }>();
  const { fmt }  = useCurrency();
  const { lang } = useLang();
  const navigate = useNavigate();
  const { confirm, dialog } = useConfirm();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const [editing, setEditing]       = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [editData, setEditData]     = useState<Record<string, unknown>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const { data: shop, isLoading } = trpc.shop.getById.useQuery({ id: Number(id) }, { enabled: !!id });
  const { data: usersData } = trpc.user.list.useQuery({ page: 1, pageSize: 100 });
  const agents = useMemo(() => (usersData?.data ?? []).filter((u: { role: string }) => u.role === "agent"), [usersData?.data]);

  const uploadPhoto = trpc.shop.uploadPhoto.useMutation({
    onSuccess: () => { utils.shop.getById.invalidate({ id: Number(id) }); notify.success(t("Фото обновлено", "Rasm yangilandi")); },
    onError:   (e) => notify.error(e.message),
  });
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 2*1024*1024) { notify.error("Макс. 2 МБ"); return; }
    const r = new FileReader();
    r.onload = () => uploadPhoto.mutate({ shopId: Number(id), dataUrl: r.result as string });
    r.readAsDataURL(file); e.target.value = "";
  };

  const updateShop = trpc.shop.update.useMutation({
    onSuccess: () => { utils.shop.getById.invalidate({ id: Number(id) }); setEditing(false); notify.success(t("Магазин обновлён", "Do'kon yangilandi")); },
    onError:   (e) => notify.error(e.message),
  });
  const deleteShop = trpc.shop.delete.useMutation({
    onSuccess: () => { navigate("/shops"); notify.success(t("Магазин удалён", "Do'kon o'chirildi")); },
    onError:   (e) => notify.error(e.message),
  });

  const handleDelete = async () => {
    const ok = await confirm({
      title: t("Удалить магазин?", "Do'konni o'chirish?"),
      message: t("Все данные магазина будут удалены безвозвратно.", "Barcha ma'lumotlar o'chib ketadi."),
      confirmText: t("Удалить", "O'chirish"), danger: true,
    });
    if (ok) deleteShop.mutate({ id: Number(id) });
  };

  if (isLoading) return (
    <div className="space-y-4">
      <div className="h-8 w-48 bg-surface-light animate-pulse rounded" />
      <div className="h-40 bg-surface-light animate-pulse rounded-xl" />
      <div className="h-64 bg-surface-light animate-pulse rounded-xl" />
    </div>
  );
  if (!shop) return <div className="text-center py-20 text-text-secondary">{t("Магазин не найден", "Do'kon topilmadi")}</div>;

  const hasDebt = Number(shop.debt ?? 0) > 0;

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-up">
      {dialog}
      {showPayment && <PaymentModal shopId={shop.id} onClose={() => setShowPayment(false)} />}

      {/* Навигация */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <button onClick={() => navigate("/shops")} className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors">
          <ArrowLeft size={18} /><span className="text-sm">{t("Магазины", "Do'konlar")}</span>
        </button>
        <div className="flex gap-2">
          <button onClick={() => setEditing(v => !v)} className="neo-btn flex items-center gap-1.5 text-sm py-2">
            <Edit2 size={13} />{t("Изменить", "O'zgartirish")}
          </button>
          <button onClick={handleDelete} className="btn-ghost flex items-center gap-1.5 text-sm text-danger">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Карточка магазина */}
      <div className="neo-card p-5">
        {editing ? (
          <div className="space-y-3">
            <p className="font-label text-[10px] text-primary tracking-wider">{t("РЕДАКТИРОВАНИЕ", "TAHRIRLASH")}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { key: "name",      ru: "Название",  uz: "Nomi"      },
                { key: "ownerName", ru: "Владелец",  uz: "Egasi"     },
                { key: "phone",     ru: "Телефон",   uz: "Telefon"   },
                { key: "address",   ru: "Адрес",     uz: "Manzil"    },
                { key: "city",      ru: "Город",     uz: "Shahar"    },
                { key: "district",  ru: "Район",     uz: "Tuman"     },
              ].map(f => (
                <input key={f.key} className="neo-input"
                  placeholder={lang === "uz" ? f.uz : f.ru}
                  defaultValue={(shop as Record<string, unknown>)[f.key] as string ?? ""}
                  onChange={e => setEditData((d: Record<string, unknown>) => ({ ...d, [f.key]: e.target.value }))} />
              ))}
            </div>
            {agents.length > 0 && (
              <div>
                <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">
                  {t("АГЕНТ", "AGENT")}
                </label>
                <PremiumSelect
                  value={String((shop as Record<string, unknown>).agentId ?? "")}
                  onChange={v => setEditData((d: Record<string, unknown>) => ({ ...d, agentId: v ? Number(v) : null }))}
                  options={[
                    { value: "", label: t("Без агента", "Agentsiz") },
                    ...agents.map((a: { id: number; name: string }) => ({ value: String(a.id), label: a.name })),
                  ]}
                  width="100%"
                />
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => updateShop.mutate({ id: shop.id, ...editData })}
                disabled={updateShop.isPending}
                className="neo-btn-primary flex items-center gap-2 disabled:opacity-40">
                {updateShop.isPending && <Loader2 size={14} className="animate-spin" />}
                {t("Сохранить", "Saqlash")}
              </button>
              <button onClick={() => setEditing(false)} className="neo-btn">{t("Отмена", "Bekor")}</button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-4">
            {/* Photo with upload */}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload}/>
            <div className="relative group flex-shrink-0 cursor-pointer" onClick={() => fileRef.current?.click()}>
              <div className="w-20 h-20 rounded-xl overflow-hidden flex items-center justify-center border border-border-subtle"
                style={{ background: "rgba(75,108,246,.10)" }}>
                {uploadPhoto.isPending ? <Loader2 size={28} className="text-primary animate-spin"/>
                  : shop.photoUrl ? <img src={shop.photoUrl} alt={shop.name} className="w-full h-full object-cover"/>
                  : <Store size={28} className="text-primary"/>}
              </div>
              <div className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 rounded-xl">
                <Camera size={18} color="#fff"/><span className="text-white text-[9px]">{t("Фото","Rasm")}</span>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="font-display text-xl font-bold text-text-primary tracking-tight">{shop.name}</h1>
              <p className="text-text-secondary text-sm mt-0.5">{shop.ownerName ?? t("Владелец не указан", "Egasi ko'rsatilmagan")}</p>
              <div className="flex flex-wrap gap-4 mt-3">
                {shop.phone && (
                  <a href={`tel:${shop.phone}`} className="flex items-center gap-1.5 text-sm text-primary">
                    <Phone size={13} />{shop.phone}
                  </a>
                )}
                {(shop.city || shop.address) && (
                  <span className="flex items-center gap-1.5 text-sm text-text-secondary">
                    <MapPin size={13} />{[shop.address, shop.city, shop.district].filter(Boolean).join(", ")}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Блок долга */}
      <div className="neo-card p-5"
        style={hasDebt ? { borderColor: "color-mix(in srgb, #e85050 35%, transparent)" } : undefined}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="font-label text-[10px] tracking-wider mb-1"
              style={{ color: hasDebt ? "#e85050" : "var(--color-text-tertiary, #98a0b8)" }}>
              {t("ТЕКУЩИЙ ДОЛГ", "JORIY QARZ")}
            </p>
            <div className="flex items-center gap-2">
              {hasDebt
                ? <AlertCircle size={18} className="text-danger" />
                : <CheckCircle2 size={18} className="text-success" />}
              <span className={`font-data text-3xl font-bold ${hasDebt ? "text-danger" : "text-success"}`}>
                {fmt(shop.debt ?? "0.00")}
              </span>
            </div>
            {!hasDebt && (
              <p className="text-xs mt-1 text-success">{t("Задолженности нет", "Qarz yo'q")}</p>
            )}
          </div>
          <button onClick={() => setShowPayment(true)} className="neo-btn-primary flex items-center gap-2">
            <Plus size={15} />{t("Добавить платёж", "To'lov qo'shish")}
          </button>
        </div>

        {/* История платежей */}
        {shop.paymentHistory && shop.paymentHistory.length > 0 && (
          <div className="mt-4 space-y-0" style={{ borderTop: "1px solid var(--color-border, #f0f3f8)", paddingTop: 12 }}>
            <p className="font-label text-[10px] text-text-secondary tracking-wider mb-2">
              {t("ИСТОРИЯ ПЛАТЕЖЕЙ", "TO'LOVLAR TARIXI")}
            </p>
            {shop.paymentHistory.slice(0, 5).map((p: { id: number; type: string; notes: string | null; amount: string; createdAt: string | Date }) => (
              <div key={p.id} className="flex items-center justify-between py-2"
                style={{ borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
                <div>
                  <p className="text-sm text-text-primary">
                    {p.type === "payment"
                      ? t("💰 Оплата", "💰 To'lov")
                      : t("📋 Долг", "📋 Qarz")}
                    {p.notes ? ` — ${p.notes}` : ""}
                  </p>
                  <p className="text-xs text-text-secondary mt-0.5">
                    {p.createdAt ? format(new Date(p.createdAt), "dd.MM.yyyy HH:mm") : ""}
                  </p>
                </div>
                <span className={`font-data font-bold ${p.type === "payment" ? "text-success" : "text-danger"}`}>
                  {p.type === "payment" ? "−" : "+"}{fmt(p.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* История заказов */}
      {shop.recentOrders && shop.recentOrders.length > 0 && (
        <div className="neo-card overflow-hidden">
          <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
            <p className="font-label text-[10px] text-primary tracking-wider">
              {t("ЗАКАЗЫ МАГАЗИНА", "DO'KON BUYURTMALARI")}
            </p>
          </div>
          <div className="divide-y" style={{ borderColor: "var(--color-border, #f0f3f8)" }}>
            {shop.recentOrders.slice(0, 10).map((o: { id: number; orderNumber: string; status: string; total: string; createdAt: string | Date }) => (
              <div key={o.id}
                className="flex items-center gap-3 px-5 py-3.5 cursor-pointer hover:bg-surface-light/40 transition-colors"
                onClick={() => navigate(`/orders/${o.id}`)}>
                <span className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: STATUS_COLORS[o.status ?? "new"] }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-data font-semibold text-text-primary">{o.orderNumber}</p>
                  <p className="text-xs text-text-secondary mt-0.5">
                    {STATUS_LABELS[o.status ?? "new"]?.[lang]} ·{" "}
                    {o.createdAt ? format(new Date(o.createdAt), "dd.MM.yyyy") : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-data text-sm font-bold text-text-primary">{fmt(o.total)}</span>
                  <ChevronRight size={14} className="text-text-secondary" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
