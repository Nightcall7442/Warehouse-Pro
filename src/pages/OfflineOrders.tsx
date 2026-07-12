import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { useNavigate } from "react-router";
import { notify } from "@/lib/toast";
import { WifiOff, Store, ShoppingCart, Plus, Trash2 } from "lucide-react";
import { CardDots, Card, PageHeader, btnPrimary, btnDanger, inputStyle } from "@/components/DashboardLayout";

export default function OfflineOrders() {
  const [shopName, setShopName] = useState("");
  const [items, setItems] = useState<Array<{ name: string; qty: number; price: number }>>([]);
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const addItem = () => setItems(prev => [...prev, { name: "", qty: 1, price: 0 }]);
  const removeItem = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: string, value: any) => setItems(prev => prev.map((item, idx) => idx === i ? { ...item, [field]: value } : item));

  const total = items.reduce((s, item) => s + item.qty * item.price, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <PageHeader title={t("Офлайн заказы", "Oflayn buyurtmalar")} subtitle={t("Создание заказов без интернета", "Internetsiz buyurtma yaratish")} />

      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
          <WifiOff size={16} color="var(--color-warning, #fbbf24)" />
          <span style={{ fontSize: "13px", color: "var(--color-text-secondary, #6b7280)" }}>{t("Заказы сохраняются локально и синхронизируются при подключении", "Buyurtmalar mahalliy saqlanadi va ulanganda sinxronlashtiriladi")}</span>
        </div>
        <div>
          <label style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary, #9ca3af)", display: "block", marginBottom: "6px" }}>{t("МАГАЗИН", "DO'KON")}</label>
          <input placeholder={t("Название магазина", "Do'kon nomi")} value={shopName} onChange={e => setShopName(e.target.value)} style={inputStyle} />
        </div>
      </Card>

      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <p style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary, #9ca3af)", margin: 0 }}>{t("ТОВАРЫ", "MAHSULOTLAR")}</p>
          <button onClick={addItem} style={{ display: "flex", alignItems: "center", gap: "4px", padding: "6px 12px", borderRadius: "8px", border: "none", background: "var(--color-primary-subtle, rgba(129,140,248,.10))", color: "var(--color-primary, #818cf8)", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
            <Plus size={14} /> {t("Добавить", "Qo'shish")}
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {items.map((item, i) => (
            <div key={i} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input placeholder={t("Название", "Nomi")} value={item.name} onChange={e => updateItem(i, "name", e.target.value)} style={{ ...inputStyle, flex: 2 }} />
              <input type="number" placeholder="0" value={item.qty || ""} onChange={e => updateItem(i, "qty", Number(e.target.value))} style={{ ...inputStyle, flex: 1 }} />
              <input type="number" placeholder="0" value={item.price || ""} onChange={e => updateItem(i, "price", Number(e.target.value))} style={{ ...inputStyle, flex: 1 }} />
              <button onClick={() => removeItem(i)} style={{ padding: "8px", borderRadius: "8px", border: "none", background: "rgba(248,113,113,.10)", color: "#f87171", cursor: "pointer" }}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </Card>

      {items.length > 0 && (
        <Card>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "13px", color: "var(--color-text-secondary, #6b7280)" }}>{items.length} {t("товаров", "mahsulot")}</span>
            <span style={{ fontSize: "20px", fontWeight: 700, color: "var(--color-text-primary, #111827)" }}>{fmt(total)}</span>
          </div>
          <button onClick={() => { notify.success(t("Офлайн заказ сохранён", "Oflayn buyurtma saqlandi")); setItems([]); setShopName(""); }} disabled={!shopName || items.length === 0} style={{ ...btnPrimary, width: "100%", marginTop: "12px", opacity: !shopName || items.length === 0 ? 0.5 : 1 }}>
            <ShoppingCart size={14} /> {t("Сохранить офлайн", "Oflayn saqlash")}
          </button>
        </Card>
      )}
    </div>
  );
}
