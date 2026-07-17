import { useParams, useNavigate, useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { useTranslate } from "@/i18n";
import { useState, useEffect } from "react";
import { ArrowLeft, Camera, CheckCircle2, Circle, Save, Trash2 } from "lucide-react";
import { notify } from "@/lib/toast";

interface ChecklistItem {
  productId: number;
  productName: string;
  present: boolean;
  price?: string;
  promoNote?: string;
}

export default function MerchandiserVisit() {
  const { id: planId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const shopId = Number(searchParams.get("shopId") ?? 0);
  const shopName = searchParams.get("shopName") ?? "";
  const navigate = useNavigate();
  const t = useTranslate();
  const utils = trpc.useUtils();

  const [photos, setPhotos] = useState<string[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [competitorNotes, setCompetitorNotes] = useState("");

  const { data: products } = trpc.product.list.useQuery(
    { page: 1, pageSize: 100 },
    { enabled: !!shopId }
  );

  const submitReport = trpc.merchandiser.submitReport.useMutation({
    onSuccess: () => {
      utils.agent.getPlans.invalidate();
      notify.success(t("Отчёт отправлен!", "Hisobot yuborildi!"));
      navigate("/agent/plans");
    },
    onError: (e) => notify.error(e.message),
  });

  useEffect(() => {
    const productList = (products as unknown as { data?: Array<{ id: number; name: string }> })?.data;
    if (productList && checklist.length === 0) {
      setChecklist(productList.map(p => ({
        productId: p.id,
        productName: p.name,
        present: false,
      })));
    }
  }, [products]);

  const toggleChecklist = (productId: number) => {
    setChecklist(prev => prev.map(item =>
      item.productId === productId ? { ...item, present: !item.present } : item
    ));
  };

  const updateChecklistPrice = (productId: number, price: string) => {
    setChecklist(prev => prev.map(item =>
      item.productId === productId ? { ...item, price } : item
    ));
  };

  const updateChecklistPromo = (productId: number, promoNote: string) => {
    setChecklist(prev => prev.map(item =>
      item.productId === productId ? { ...item, promoNote } : item
    ));
  };

  const handleSubmit = () => {
    if (!planId || !shopId) return;
    submitReport.mutate({
      planId: Number(planId),
      shopId,
      photos,
      checklist,
      competitorNotes: competitorNotes || undefined,
    });
  };

  const presentCount = checklist.filter(i => i.present).length;
  const totalItems = checklist.length;
  const completionPct = totalItems > 0 ? Math.round((presentCount / totalItems) * 100) : 0;

  if (!shopId) {
    return (
      <div className="max-w-3xl mx-auto p-4 text-center py-20">
        <p className="text-secondary">{t("Магазин не выбран", "Do'kon tanlanmagan")}</p>
        <button onClick={() => navigate(-1)} className="neo-btn-primary mt-4">{t("Назад", "Orqaga")}</button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-surface-light rounded-lg">
          <ArrowLeft size={20} />
        </button>
        <div>
          <div style={{ display: "flex", gap: "6px", marginBottom: "4px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-pink, #c06080)", boxShadow: "var(--shadow-xs)" }} />
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-orange, #c49530)", boxShadow: "var(--shadow-xs)" }} />
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-teal, #3a9a8a)", boxShadow: "var(--shadow-xs)" }} />
          </div>
          <h1 className="text-lg font-bold">{t("Отчёт о визите", "Tashrif hisoboti")}</h1>
          <p className="text-sm text-secondary">{shopName}</p>
        </div>
      </div>

      {/* Photos */}
      <div className="neo-card" style={{ padding: "16px" }}>
        <h2 className="font-semibold flex items-center gap-2">
          <Camera size={18} />
          {t("Фотографии", "Rasmlar")}
        </h2>
        <div className="flex flex-wrap gap-2">
          {photos.map((photo, i) => (
            <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border">
              <img src={photo} alt="" className="w-full h-full object-cover" />
              <button
                onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                className="absolute top-1 right-1 bg-danger/80 rounded-full p-0.5"
              >
                <Trash2 size={12} className="text-white" />
              </button>
            </div>
          ))}
          <label className="w-20 h-20 rounded-lg border-2 border-dashed border-border flex items-center justify-center cursor-pointer hover:border-primary">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  if (reader.result) setPhotos(prev => [...prev, reader.result as string]);
                };
                reader.readAsDataURL(file);
              }}
            />
            <Camera size={20} className="text-secondary" />
          </label>
        </div>
      </div>

      {/* Checklist */}
      <div className="neo-card" style={{ padding: "16px" }}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t("Чек-лист товаров", "Mahsulotlar ro'yxati")}</h2>
          <span className="text-sm text-secondary">
            {presentCount}/{totalItems} ({completionPct}%)
          </span>
        </div>
        <div className="w-full bg-surface-light rounded-full h-2">
          <div
            className="bg-primary h-2 rounded-full transition-all"
            style={{ width: `${completionPct}%` }}
          />
        </div>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {checklist.map(item => (
            <div key={item.productId} className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface-light">
              <button
                onClick={() => toggleChecklist(item.productId)}
                className={`flex-shrink-0 ${item.present ? "text-success" : "text-secondary"}`}
              >
                {item.present ? <CheckCircle2 size={20} /> : <Circle size={20} />}
              </button>
              <span className={`flex-1 text-sm ${item.present ? "" : "text-secondary"}`}>
                {item.productName}
              </span>
              <input
                type="text"
                placeholder={t("Цена", "Narxi")}
                value={item.price ?? ""}
                onChange={(e) => updateChecklistPrice(item.productId, e.target.value)}
                className="w-20 text-xs px-2 py-1 neo-input"
              />
              <input
                type="text"
                placeholder={t("Акция", "Aksiya")}
                value={item.promoNote ?? ""}
                onChange={(e) => updateChecklistPromo(item.productId, e.target.value)}
                className="w-24 text-xs px-2 py-1 neo-input"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Competitor Notes */}
      <div className="neo-card" style={{ padding: "16px" }}>
        <h2 className="font-semibold">{t("Заметки о конкурентах", "Raqobatchilar haqida eslatmalar")}</h2>
        <textarea
          value={competitorNotes}
          onChange={(e) => setCompetitorNotes(e.target.value)}
          rows={4}
          placeholder={t("Что видно на полках конкурентов...", "Raqobatchilar polkalarida nima bor...")}
          className="w-full px-3 py-2 neo-input text-sm resize-none"
        />
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={submitReport.isPending}
        className="w-full py-3 neo-btn-primary font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <Save size={18} />
        {submitReport.isPending
          ? t("Отправка...", "Yuborilmoqda...")
          : t("Завершить визит", "Tashrifni yakunlash")}
      </button>
    </div>
  );
}
