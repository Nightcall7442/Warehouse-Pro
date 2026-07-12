import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Search, Store, Package, ClipboardList, X } from "lucide-react";
import { useTranslate } from "@/i18n";

export function GlobalSearch() {
  const tr = useTranslate();
  const [open,  setOpen]  = useState(false);
  const [query, setQuery] = useState("");
  const inputRef          = useRef<HTMLInputElement>(null);
  const navigate          = useNavigate();

  // Cmd+K / Ctrl+K to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(v => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const { data: shops    } = trpc.shop.list.useQuery(    { search: query, pageSize: 5 }, { enabled: query.length > 1 }) as { data: any };
  const { data: products } = trpc.product.list.useQuery( { search: query, pageSize: 5 }, { enabled: query.length > 1 }) as { data: any };
  const { data: orders   } = trpc.order.list.useQuery(   { search: query, pageSize: 5 }, { enabled: query.length > 1 }) as { data: any };

  const hasResults = (shops?.data?.length ?? 0) + (products?.data?.length ?? 0) + (orders?.data?.length ?? 0) > 0;

  const go = (path: string) => { navigate(path); setOpen(false); };

  if (!open) return (
    <button
      onClick={() => setOpen(true)}
      style={{
        display: "none", alignItems: "center", gap: "8px",
        padding: "6px 12px", borderRadius: "8px", border: "1px solid #e5e7eb",
        background: "transparent", color: "#6b7280", fontSize: "13px",
        fontFamily: "'DM Sans', sans-serif", cursor: "pointer",
      }}
      className="hidden md:flex"
    >
      <Search size={14}/>
      <span>{tr("Поиск…","Qidirish…")}</span>
      <span style={{ marginLeft: "8px", fontSize: "10px", fontWeight: 600, background: "#f8f9fb", padding: "2px 6px", borderRadius: "4px" }}>⌘K</span>
    </button>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "10vh", padding: "16px" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }} onClick={() => setOpen(false)}/>
      <div style={{ position: "relative", width: "100%", maxWidth: "540px", background: "#ffffff", border: "1px solid #f3f4f6", borderRadius: "14px", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.15)", overflow: "hidden" }}>
        {/* Input */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
          <Search size={18} style={{ color: "#9ca3af", flexShrink: 0 }}/>
          <input
            ref={inputRef}
            style={{ flex: 1, background: "transparent", color: "#111827", border: "none", outline: "none", fontSize: "14px", fontFamily: "'DM Sans', sans-serif" }}
            placeholder={tr("Поиск магазинов, товаров, заказов…","Do'kon, mahsulot, buyurtma qidirish…")}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}>
            <X size={16}/>
          </button>
        </div>

        {/* Results */}
        <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
          {query.length < 2 ? (
            <div style={{ padding: "32px 16px", textAlign: "center", color: "#6b7280", fontSize: "13px" }}>
              {tr("Введите минимум 2 символа для поиска","Qidirish uchun kamida 2 belgi kiriting")}
            </div>
          ) : !hasResults ? (
            <div style={{ padding: "32px 16px", textAlign: "center", color: "#6b7280", fontSize: "13px" }}>
              {tr("Ничего не найдено по","Hech narsa topilmadi:")} "<b>{query}</b>"
            </div>
          ) : (
            <>
              {(shops?.data?.length ?? 0) > 0 && (
                <div>
                  <p style={{ padding: "8px 16px", fontSize: "10px", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", background: "#f8f9fb" }}>{tr("МАГАЗИНЫ","DO'KONLAR")}</p>
                  {shops!.data.map((s: any) => (
                    <button key={s.id} onClick={() => go(`/shops/${s.id}`)}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", padding: "12px 16px", borderBottom: "1px solid #f3f4f6", textAlign: "left", background: "transparent", border: "none", cursor: "pointer", borderBottomLeftRadius: "8px", borderBottomRightRadius: "8px" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#f8f9fb")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <Store size={16} style={{ color: "#818cf8", flexShrink: 0 }}/>
                      <div>
                        <p style={{ fontSize: "13px", color: "#111827", margin: 0 }}>{s.name}</p>
                        <p style={{ fontSize: "11px", color: "#6b7280", margin: "2px 0 0" }}>{s.city ?? ""} · {s.ownerName ?? ""}</p>
                      </div>
                      {Number(s.debt ?? 0) > 0 && (
                        <span style={{ marginLeft: "auto", fontSize: "11px", color: "#f87171", fontWeight: 500 }}>{Number(s.debt).toLocaleString()} {tr("сум","so'm")}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {(products?.data?.length ?? 0) > 0 && (
                <div>
                  <p style={{ padding: "8px 16px", fontSize: "10px", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", background: "#f8f9fb" }}>{tr("ТОВАРЫ","MAHSULOTLAR")}</p>
                  {products!.data.map((p: any) => (
                    <button key={p.id} onClick={() => go(`/products/${p.id}`)}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", padding: "12px 16px", borderBottom: "1px solid #f3f4f6", textAlign: "left", background: "transparent", border: "none", cursor: "pointer" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#f8f9fb")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <Package size={16} style={{ color: "#818cf8", flexShrink: 0 }}/>
                      <div>
                        <p style={{ fontSize: "13px", color: "#111827", margin: 0 }}>{p.name}</p>
                        <p style={{ fontSize: "11px", color: "#6b7280", margin: "2px 0 0" }}>{p.code} · {p.category ?? ""}</p>
                      </div>
                      <span style={{ marginLeft: "auto", fontSize: "11px", color: "#6b7280", fontWeight: 500 }}>{Number(p.unitPrice).toFixed(2)} {tr("сум/кг","so'm/kg")}</span>
                    </button>
                  ))}
                </div>
              )}

              {(orders?.data?.length ?? 0) > 0 && (
                <div>
                  <p style={{ padding: "8px 16px", fontSize: "10px", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", background: "#f8f9fb" }}>{tr("ЗАКАЗЫ","BUYURTMALAR")}</p>
                  {orders!.data.map((o: any) => (
                    <button key={o.id} onClick={() => go(`/orders/${o.id}`)}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: "12px", padding: "12px 16px", borderBottom: "1px solid #f3f4f6", textAlign: "left", background: "transparent", border: "none", cursor: "pointer" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#f8f9fb")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <ClipboardList size={16} style={{ color: "#818cf8", flexShrink: 0 }}/>
                      <div>
                        <p style={{ fontSize: "13px", color: "#111827", margin: 0, fontWeight: 500 }}>{o.orderNumber}</p>
                        <p style={{ fontSize: "11px", color: "#6b7280", margin: "2px 0 0" }}>{o.shopName ?? ""} · {o.status}</p>
                      </div>
                      <span style={{ marginLeft: "auto", fontSize: "11px", color: "#111827", fontWeight: 600 }}>{Number(o.total).toLocaleString()} {tr("сум","so'm")}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ padding: "8px 16px", borderTop: "1px solid #f3f4f6", background: "#f8f9fb" }}>
          <p style={{ fontSize: "10px", color: "#9ca3af" }}>
            <kbd style={{ background: "#ffffff", border: "1px solid #e5e7eb", padding: "1px 4px", borderRadius: "3px", fontSize: "10px" }}>↑↓</kbd> {tr("навигация","navigatsiya")} · <kbd style={{ background: "#ffffff", border: "1px solid #e5e7eb", padding: "1px 4px", borderRadius: "3px", fontSize: "10px" }}>Esc</kbd> {tr("закрыть","yopish")}
          </p>
        </div>
      </div>
    </div>
  );
}
