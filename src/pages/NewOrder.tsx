import { useState, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { useNavigate } from "react-router";
import { notify } from "@/lib/toast";
import { Search, Store, Package, ShoppingCart, Minus, Plus, Check } from "lucide-react";
import { PremiumSelect } from "@/components/PremiumSelect";
import { CardDots, Card, PageHeader, btnPrimary, inputStyle } from "@/components/DashboardLayout";

export default function NewOrder() {
  const [shopId, setShopId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Map<number, number>>(new Map());
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const navigate = useNavigate();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const { data: shops } = trpc.shop.list.useQuery({ pageSize: 100 }) as { data: any };
  const { data: products } = trpc.product.list.useQuery({ search, pageSize: 100 }) as { data: any };

  const createOrder = trpc.order.create.useMutation({
    onSuccess: (d) => { notify.success(t("Заказ создан", "Buyurtma yaratildi")); navigate(`/orders/${d.id}`); },
    onError: (e) => notify.error(e.message),
  });

  const total = useMemo(() => {
    let sum = 0;
    const items = products?.data ?? [];
    cart.forEach((qty, id) => {
      const p = items.find((i: any) => i.id === id);
      if (p) sum += Number(p.unitPrice ?? 0) * qty;
    });
    return sum;
  }, [cart, products]);

  const updateQty = (id: number, delta: number) => {
    setCart(prev => {
      const next = new Map(prev);
      const current = next.get(id) ?? 0;
      const newQty = Math.max(0, current + delta);
      if (newQty === 0) next.delete(id); else next.set(id, newQty);
      return next;
    });
  };

  const handleSubmit = () => {
    if (!shopId || cart.size === 0) { notify.error(t("Выберите магазин и добавьте товары", "Do'kon tanlang va mahsulotlar qo'shing")); return; }
    const items = Array.from(cart.entries()).map(([productId, quantity]) => ({ productId, quantity }));
    createOrder.mutate({ shopId, items });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <PageHeader title={t("Новый заказ", "Yangi buyurtma")} />

      {/* Shop Selection */}
      <Card>
        <p style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary, #9ca3af)", marginBottom: "8px" }}>{t("МАГАЗИН", "DO'KON")}</p>
        <PremiumSelect value={shopId ? String(shopId) : ""} onChange={v => setShopId(Number(v))} options={(shops?.data ?? []).map((s: any) => ({ value: String(s.id), label: s.name }))} width="100%" />
      </Card>

      {/* Products */}
      <Card>
        <p style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary, #9ca3af)", marginBottom: "8px" }}>{t("ТОВАРЫ", "MAHSULOTLAR")}</p>
        <div style={{ position: "relative", marginBottom: "12px" }}>
          <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary, #9ca3af)" }} />
          <input placeholder={t("Выберите товар...", "Mahsulot tanlang...")} value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: "36px" }} className="input-field" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "300px", overflowY: "auto" }}>
          {(products?.data ?? []).map((p: any) => {
            const qty = cart.get(p.id) ?? 0;
            return (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px", borderRadius: "12px", background: qty > 0 ? "var(--color-primary-subtle, rgba(129,140,248,.10))" : "transparent", transition: "all 0.15s" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary, #111827)", margin: 0 }}>{p.name}</p>
                  <p style={{ fontSize: "11px", color: "var(--color-text-tertiary, #9ca3af)", margin: "2px 0 0" }}>{fmt(Number(p.unitPrice ?? 0))}</p>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <button onClick={() => updateQty(p.id, -1)} style={{ width: "28px", height: "28px", borderRadius: "8px", border: "none", background: "var(--color-surface-light, #f3f4f6)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-secondary, #6b7280)" }}><Minus size={14} /></button>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary, #111827)", minWidth: "24px", textAlign: "center" }}>{qty}</span>
                  <button onClick={() => updateQty(p.id, 1)} style={{ width: "28px", height: "28px", borderRadius: "8px", border: "none", background: "var(--color-primary, #818cf8)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}><Plus size={14} /></button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Summary */}
      {cart.size > 0 && (
        <Card>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
            <span style={{ fontSize: "13px", color: "var(--color-text-secondary, #6b7280)" }}>{cart.size} {t("товаров", "mahsulot")}</span>
            <span style={{ fontSize: "20px", fontWeight: 700, color: "var(--color-text-primary, #111827)" }}>{fmt(total)}</span>
          </div>
          <button onClick={handleSubmit} disabled={createOrder.isPending || !shopId} style={{ ...btnPrimary, width: "100%", opacity: !shopId ? 0.5 : 1 }}>
            <ShoppingCart size={14} /> {t("Оформить заказ", "Buyurtma berish")}
          </button>
        </Card>
      )}
    </div>
  );
}
