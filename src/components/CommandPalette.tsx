import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { trpc } from "@/providers/trpc";
import {
  Search, ShoppingCart, Package, Store, Users, FileText,
  BarChart3, Settings, Truck, ArrowRight,
} from "lucide-react";

interface CommandItem {
  id: string;
  label: string;
  labelUz?: string;
  icon: React.ReactNode;
  path?: string;
  action?: () => void;
  category: "nav" | "action" | "search";
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { lang } = useLang();
  const { fmt } = useCurrency();

  // Search products
  const { data: products } = trpc.product.list.useQuery(
    { page: 1, pageSize: 5, search: query.length > 1 ? query : undefined },
    { enabled: open && query.length > 1 }
  );

  // Search shops
  const { data: shops } = trpc.shop.list.useQuery(
    { page: 1, pageSize: 5, search: query.length > 1 ? query : undefined },
    { enabled: open && query.length > 1 }
  );

  // Search orders
  const { data: orders } = trpc.order.list.useQuery(
    { page: 1, pageSize: 5, search: query.length > 1 ? query : undefined },
    { enabled: open && query.length > 1 }
  );

  // Search users (admin-only endpoint; silently returns nothing for non-admins)
  const { data: usersData } = trpc.user.list.useQuery(
    { page: 1, pageSize: 5, search: query.length > 1 ? query : undefined },
    { enabled: open && query.length > 1 }
  );

  const t = useCallback((ru: string, uz: string) => lang === "uz" ? uz : ru, [lang]);

  // Navigation items
  const navItems: CommandItem[] = useMemo(() => [
    { id: "dashboard", label: "Главная", labelUz: "Bosh sahifa", icon: <BarChart3 size={16} />, path: "/dashboard", category: "nav" },
    { id: "orders", label: "Заказы", labelUz: "Buyurtmalar", icon: <ShoppingCart size={16} />, path: "/orders", category: "nav" },
    { id: "new-order", label: "Новый заказ", labelUz: "Yangi buyurtma", icon: <ArrowRight size={16} />, path: "/orders/new", category: "action" },
    { id: "products", label: "Товары", labelUz: "Mahsulotlar", icon: <Package size={16} />, path: "/products", category: "nav" },
    { id: "shops", label: "Магазины", labelUz: "Do'konlar", icon: <Store size={16} />, path: "/shops", category: "nav" },
    { id: "warehouse", label: "Склад", labelUz: "Ombor", icon: <Package size={16} />, path: "/warehouse", category: "nav" },
    { id: "deliveries", label: "Доставки", labelUz: "Yetkazishlar", icon: <Truck size={16} />, path: "/deliveries", category: "nav" },
    { id: "reports", label: "Отчёты", labelUz: "Hisobotlar", icon: <FileText size={16} />, path: "/reports", category: "nav" },
    { id: "users", label: "Пользователи", labelUz: "Foydalanuvchilar", icon: <Users size={16} />, path: "/users", category: "nav" },
    { id: "settings", label: "Настройки", labelUz: "Sozlamalar", icon: <Settings size={16} />, path: "/settings", category: "nav" },
  ], []);

  // Filter items based on query
  const filteredItems = useMemo(() => {
    if (!query) return navItems;
    const q = query.toLowerCase();
    return navItems.filter(item =>
      item.label.toLowerCase().includes(q) ||
      item.labelUz?.toLowerCase().includes(q)
    );
  }, [query, navItems]);

  // Grouped search results
  const groupedSearchResults = useMemo(() => {
    const groups: { label: string; items: CommandItem[] }[] = [];

    if (products?.data?.length) {
      groups.push({
        label: t("Товары", "Mahsulotlar"),
        items: products.data.map((p) => ({
          id: `product-${p.id}`,
          label: `${p.name} — ${fmt(p.unitPrice)}`,
          icon: <Package size={16} />,
          path: `/products/${p.id}`,
          category: "search" as const,
        })),
      });
    }
    if (shops?.data?.length) {
      groups.push({
        label: t("Магазины", "Do'konlar"),
        items: shops.data.map((s) => ({
          id: `shop-${s.id}`,
          label: `${s.name}${s.city ? `, ${s.city}` : ""}`,
          icon: <Store size={16} />,
          path: `/shops/${s.id}`,
          category: "search" as const,
        })),
      });
    }
    if (orders?.data?.length) {
      groups.push({
        label: t("Заказы", "Buyurtmalar"),
        items: orders.data.map((o) => ({
          id: `order-${o.id}`,
          label: `${o.orderNumber} — ${fmt(Number(o.total))}`,
          icon: <ShoppingCart size={16} />,
          path: `/orders/${o.id}`,
          category: "search" as const,
        })),
      });
    }
    if (usersData?.data?.length) {
      groups.push({
        label: t("Пользователи", "Foydalanuvchilar"),
        items: usersData.data.map((u) => ({
          id: `user-${u.id}`,
          label: `${u.name}${u.email ? ` — ${u.email}` : ""}`,
          icon: <Users size={16} />,
          path: `/users`,
          category: "search" as const,
        })),
      });
    }

    return groups;
  }, [products, shops, orders, usersData, fmt, t]);

  const hasSearchResults = query.length > 1 && groupedSearchResults.length > 0;

  // Keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(v => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery("");
    }
  }, [open]);

  const handleSelect = useCallback((item: CommandItem) => {
    if (item.path) {
      navigate(item.path);
    }
    if (item.action) {
      item.action();
    }
    setOpen(false);
  }, [navigate]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)" }}
      onClick={() => setOpen(false)}>
      <div className="w-full max-w-lg rounded-2xl overflow-hidden animate-fade-up"
        style={{ background: "var(--color-surface)", boxShadow: "0 25px 60px -15px rgba(0,0,0,0.3)" }}
        onClick={e => e.stopPropagation()}>

        {/* Search Input */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "16px 20px", borderBottom: "1px solid var(--color-border)" }}>
          <Search size={18} style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t("Поиск товаров, магазинов, заказов, пользователей…", "Mahsulot, do'kon, buyurtma, foydalanuvchi qidirish…")}
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: "15px", fontFamily: "'DM Sans', sans-serif", color: "var(--color-text-primary)" }}
          />
          <kbd style={{ fontSize: "11px", padding: "2px 6px", borderRadius: "4px", background: "var(--color-surface-light)", color: "var(--color-text-tertiary)", border: "1px solid var(--color-border)" }}>
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: "400px", overflowY: "auto", padding: "8px" }}>
          {!hasSearchResults && filteredItems.length === 0 ? (
            <div style={{ padding: "32px", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "13px" }}>
              {t("Ничего не найдено", "Hech narsa topilmadi")}
            </div>
          ) : (
            <>
              {/* Grouped search results */}
              {groupedSearchResults.map((group) => (
                <div key={group.label}>
                  <div style={{ padding: "8px 12px 4px", fontSize: "10px", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {group.label}
                  </div>
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleSelect(item)}
                      style={{
                        display: "flex", alignItems: "center", gap: "12px", width: "100%", padding: "10px 12px",
                        borderRadius: "10px", border: "none", cursor: "pointer", background: "transparent",
                        transition: "background 0.1s", textAlign: "left",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--color-surface-light)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <div style={{ width: "32px", height: "32px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-surface-light)", color: "var(--color-text-secondary)", flexShrink: 0 }}>
                        {item.icon}
                      </div>
                      <span style={{ flex: 1, fontSize: "14px", color: "var(--color-text-primary)", fontFamily: "'DM Sans', sans-serif" }}>
                        {item.label}
                      </span>
                      {item.path && <ArrowRight size={14} style={{ color: "var(--color-text-tertiary)" }} />}
                    </button>
                  ))}
                </div>
              ))}

              {/* Navigation items */}
              {filteredItems.length > 0 && (
                <>
                  {hasSearchResults && (
                    <div style={{ padding: "12px 12px 4px", fontSize: "10px", fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", borderTop: "1px solid var(--color-border)", marginTop: "4px" }}>
                      {t("Навигация", "Navigatsiya")}
                    </div>
                  )}
                  {filteredItems.map(item => (
                    <button
                      key={item.id}
                      onClick={() => handleSelect(item)}
                      style={{
                        display: "flex", alignItems: "center", gap: "12px", width: "100%", padding: "10px 12px",
                        borderRadius: "10px", border: "none", cursor: "pointer", background: "transparent",
                        transition: "background 0.1s", textAlign: "left",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--color-surface-light)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <div style={{ width: "32px", height: "32px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-surface-light)", color: "var(--color-text-secondary)", flexShrink: 0 }}>
                        {item.icon}
                      </div>
                      <span style={{ flex: 1, fontSize: "14px", color: "var(--color-text-primary)", fontFamily: "'DM Sans', sans-serif" }}>
                        {lang === "uz" && item.labelUz ? item.labelUz : item.label}
                      </span>
                      {item.path && <ArrowRight size={14} style={{ color: "var(--color-text-tertiary)" }} />}
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "10px 16px", borderTop: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: "16px", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
          <span><kbd style={kbdStyle}>↑↓</kbd> {t("навигация", "navigatsiya")}</span>
          <span><kbd style={kbdStyle}>↵</kbd> {t("выбрать", "tanlash")}</span>
          <span><kbd style={kbdStyle}>esc</kbd> {t("закрыть", "yopish")}</span>
        </div>
      </div>
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  display: "inline-block", padding: "1px 4px", borderRadius: "3px",
  background: "var(--color-surface-light)", border: "1px solid var(--color-border)",
  fontSize: "10px", fontFamily: "monospace",
};
