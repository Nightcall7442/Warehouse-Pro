import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { useNavigate, useParams } from "react-router";
import { notify } from "@/lib/toast";
import { Check, Package, ShoppingCart, MapPin } from "lucide-react";
import { CardDots, Card, KpiCard, PageHeader, btnPrimary, inputStyle } from "@/components/DashboardLayout";

export default function MerchandiserVisit() {
  const { id } = useParams();
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const navigate = useNavigate();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const { data: shop } = trpc.shop.getById.useQuery({ id: Number(id) }) as { data: any };
  const { data: products } = trpc.product.list.useQuery({ pageSize: 1000 }) as { data: any };
  const [items, setItems] = useState<Array<{ productId: number; quantity: number }>>([]);

  const visitMutation = trpc.agent.visit.useMutation({
    onSuccess: () => { notify.success(t("Визит оформлен", "Tashrif bajarildi")); navigate("/agent/shops"); },
    onError: (e) => notify.error(e.message),
  });

  const addItem = (productId: number) => setItems(prev => {
    const existing = prev.find(i => i.productId === productId);
    if (existing) return prev.map(i => i.productId === productId ? { ...i, quantity: i.quantity + 1 } : i);
    return [...prev, { productId, quantity: 1 }];
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <PageHeader title={t("Визит в магазин", "Do'konga tashrif")} subtitle={shop?.name ?? ""} />

      {shop && (
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: "rgba(129,140,248,.10)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <MapPin size={18} color="var(--color-primary, #818cf8)" />
            </div>
            <div>
              <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary, #111827)", margin: 0 }}>{shop.name}</p>
              <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #9ca3af)", margin: "2px 0 0" }}>{shop.city ?? ""} · {shop.phone ?? ""}</p>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <p style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary, #9ca3af)", marginBottom: "12px" }}>{t("ТОВАРЫ", "MAHSULOTLAR")}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "300px", overflowY: "auto" }}>
          {(products?.data ?? []).map((p: any) => {
            const qty = items.find(i => i.productId === p.id)?.quantity ?? 0;
            return (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px", borderRadius: "12px", background: qty > 0 ? "var(--color-primary-subtle, rgba(129,140,248,.10))" : "transparent", transition: "all 0.15s" }}>
                <Package size={16} color="var(--color-text-tertiary, #9ca3af)" />
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary, #111827)", margin: 0 }}>{p.name}</p>
                </div>
                {qty > 0 && <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-primary, #818cf8)" }}>×{qty}</span>}
                <button onClick={() => addItem(p.id)} style={{ padding: "6px 12px", borderRadius: "8px", border: "none", background: "var(--color-primary, #818cf8)", color: "#fff", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
                  <Plus size={14} />
                </button>
              </div>
            );
          })}
        </div>
      </Card>

      {items.length > 0 && (
        <button onClick={() => visitMutation.mutate({ shopId: Number(id), items })} disabled={visitMutation.isPending} style={{ ...btnPrimary, width: "100%" }}>
          <Check size={14} /> {t("Завершить визит", "Tashrifni tugatish")} ({items.length} {t("товаров", "mahsulot")})
        </button>
      )}
    </div>
  );
}
