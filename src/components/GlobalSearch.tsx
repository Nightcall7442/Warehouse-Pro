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
      className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded border border-border-custom text-text-secondary text-sm hover:border-primary/40 hover:text-text-primary transition-colors"
    >
      <Search size={14}/>
      <span>{tr("Поиск…","Qidirish…")}</span>
      <span className="ml-2 font-label text-[10px] bg-surface-light px-1.5 py-0.5 rounded">⌘K</span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)}/>
      <div className="relative w-full max-w-lg bg-surface border border-border-custom rounded-xl shadow-2xl overflow-hidden">
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-custom">
          <Search size={18} className="text-text-secondary flex-shrink-0"/>
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-text-primary placeholder-text-secondary outline-none text-base"
            placeholder={tr("Поиск магазинов, товаров, заказов…","Do'kon, mahsulot, buyurtma qidirish…")}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <button onClick={() => setOpen(false)}>
            <X size={16} className="text-text-secondary hover:text-text-primary"/>
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {query.length < 2 ? (
            <div className="px-4 py-8 text-center text-text-secondary text-sm">
              {tr("Введите минимум 2 символа для поиска","Qidirish uchun kamida 2 belgi kiriting")}
            </div>
          ) : !hasResults ? (
            <div className="px-4 py-8 text-center text-text-secondary text-sm">
              {tr("Ничего не найдено по","Hech narsa topilmadi:")} "<b>{query}</b>"
            </div>
          ) : (
            <>
              {(shops?.data?.length ?? 0) > 0 && (
                <div>
                  <p className="px-4 py-2 font-label text-[10px] text-text-secondary tracking-wider bg-surface-light">{tr("МАГАЗИНЫ","DO'KONLAR")}</p>
                  {shops!.data.map((s: any) => (
                    <button key={s.id} onClick={() => go(`/shops/${s.id}`)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-light text-left border-b border-border-subtle/50">
                      <Store size={16} className="text-primary flex-shrink-0"/>
                      <div>
                        <p className="text-sm text-text-primary">{s.name}</p>
                        <p className="text-xs text-text-secondary">{s.city ?? ""} · {s.ownerName ?? ""}</p>
                      </div>
                      {Number(s.debt ?? 0) > 0 && (
                        <span className="ml-auto text-xs font-data text-danger">{Number(s.debt).toLocaleString()} {tr("сум","so'm")}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {(products?.data?.length ?? 0) > 0 && (
                <div>
                  <p className="px-4 py-2 font-label text-[10px] text-text-secondary tracking-wider bg-surface-light">{tr("ТОВАРЫ","MAHSULOTLAR")}</p>
                  {products!.data.map((p: any) => (
                    <button key={p.id} onClick={() => go(`/products/${p.id}`)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-light text-left border-b border-border-subtle/50">
                      <Package size={16} className="text-primary flex-shrink-0"/>
                      <div>
                        <p className="text-sm text-text-primary">{p.name}</p>
                        <p className="text-xs text-text-secondary">{p.code} · {p.category ?? ""}</p>
                      </div>
                      <span className="ml-auto text-xs font-data text-text-secondary">{Number(p.unitPrice).toFixed(2)} {tr("сум/кг","so'm/kg")}</span>
                    </button>
                  ))}
                </div>
              )}

              {(orders?.data?.length ?? 0) > 0 && (
                <div>
                  <p className="px-4 py-2 font-label text-[10px] text-text-secondary tracking-wider bg-surface-light">{tr("ЗАКАЗЫ","BUYURTMALAR")}</p>
                  {orders!.data.map((o: any) => (
                    <button key={o.id} onClick={() => go(`/orders/${o.id}`)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-light text-left border-b border-border-subtle/50">
                      <ClipboardList size={16} className="text-primary flex-shrink-0"/>
                      <div>
                        <p className="text-sm font-data text-text-primary">{o.orderNumber}</p>
                        <p className="text-xs text-text-secondary">{o.shopName ?? ""} · {o.status}</p>
                      </div>
                      <span className="ml-auto text-xs font-data text-text-primary">{Number(o.total).toLocaleString()} {tr("сум","so'm")}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-4 py-2 border-t border-border-custom bg-surface-light">
          <p className="text-[10px] font-label text-text-secondary">
            <kbd className="bg-surface border border-border-custom px-1 rounded text-[10px]">↑↓</kbd> {tr("навигация","navigatsiya")} · <kbd className="bg-surface border border-border-custom px-1 rounded text-[10px]">Esc</kbd> {tr("закрыть","yopish")}
          </p>
        </div>
      </div>
    </div>
  );
}
