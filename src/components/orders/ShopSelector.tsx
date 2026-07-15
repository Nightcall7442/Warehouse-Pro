import { useState, useMemo } from "react";
import { useCurrency } from "@/hooks/useCurrency";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useLang } from "@/i18n";
import { Store, Search, AlertCircle } from "lucide-react";

interface ShopSelectorProps {
  shopId: number;
  onSelect: (id: number, name: string) => void;
}

export function ShopSelector({ shopId, onSelect }: ShopSelectorProps) {
  const [search, setSearch] = useState("");
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const { fmt } = useCurrency();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const { user } = useAuth();
  const isAgent = user?.role === "agent" || user?.role === "merchandiser";

  const { data: myShops, isLoading: myShopsLoading } = trpc.agent.myShops.useQuery(undefined, { enabled: isAgent }) as { data: any; isLoading: boolean };
  const { data: allShopsData, isLoading: allShopsLoading } = trpc.shop.list.useQuery({ page: 1, pageSize: 200 }, { enabled: !isAgent }) as { data: any; isLoading: boolean };

  const shops = isAgent ? myShops : allShopsData?.data;
  const isLoading = isAgent ? myShopsLoading : allShopsLoading;

  const cities = useMemo(() => {
    const set = new Set<string>();
    (shops ?? []).forEach((s: any) => { if (s.city) set.add(s.city); });
    return Array.from(set).sort();
  }, [shops]);

  const filtered = useMemo(() => {
    return (shops ?? []).filter((s: any) => {
      const matchCity = !selectedCity || s.city === selectedCity;
      const matchSearch = !search ||
        s.name?.toLowerCase().includes(search.toLowerCase()) ||
        s.ownerName?.toLowerCase().includes(search.toLowerCase()) ||
        s.district?.toLowerCase().includes(search.toLowerCase());
      return matchCity && matchSearch;
    });
  }, [shops, selectedCity, search]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Header */}
      <div>
        <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "20px", fontWeight: 700, color: "var(--color-text-primary, #2b3450)", margin: "0 0 4px", letterSpacing: "-0.02em" }}>
          {t("Выберите магазин", "Do'kon tanlang")}
        </h2>
        <p style={{ fontSize: "13px", color: "var(--color-text-tertiary, #98a0b8)", margin: 0 }}>
          {t("Для которого оформляем заказ", "Buyurtma uchun do'kon")}
        </p>
      </div>

      {/* Cities filter */}
      {cities.length > 0 && (
        <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "4px" }}>
          <button onClick={() => setSelectedCity(null)} style={{
            flexShrink: 0, padding: "8px 18px", borderRadius: "24px", fontSize: "13px", fontWeight: 600,
            fontFamily: "'DM Sans', sans-serif", cursor: "pointer", transition: "all 0.25s ease",
            background: !selectedCity ? "linear-gradient(135deg, #4b6cf6, #4b6cf6)" : "var(--color-surface-light, #f0f3f8)",
            color: !selectedCity ? "#fff" : "var(--color-text-secondary, #6a7290)",
            border: "none", boxShadow: !selectedCity ? "0 4px 12px rgba(75,108,246,0.3)" : "none",
          }}>
            {t("Все", "Barchasi")}
          </button>
          {cities.map(city => (
            <button key={city} onClick={() => setSelectedCity(selectedCity === city ? null : city)} style={{
              flexShrink: 0, padding: "8px 18px", borderRadius: "24px", fontSize: "13px", fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif", cursor: "pointer", transition: "all 0.25s ease",
              background: selectedCity === city ? "linear-gradient(135deg, #4b6cf6, #4b6cf6)" : "var(--color-surface-light, #f0f3f8)",
              color: selectedCity === city ? "#fff" : "var(--color-text-secondary, #6a7290)",
              border: "none", boxShadow: selectedCity === city ? "0 4px 12px rgba(75,108,246,0.3)" : "none",
            }}>
              {city}
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      <div style={{ position: "relative" }}>
        <Search size={16} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary, #98a0b8)", pointerEvents: "none" }} />
        <input
          style={{
            width: "100%", padding: "12px 14px 12px 42px", borderRadius: "14px",
            background: "var(--color-surface-light, #f0f3f8)", border: "2px solid transparent",
            fontSize: "14px", fontFamily: "'DM Sans', sans-serif", color: "var(--color-text-primary, #2b3450)",
            outline: "none", transition: "all 0.2s ease",
          }}
          placeholder={t("Поиск магазинов…", "Do'kon qidirish…")}
          value={search}
          onChange={e => setSearch(e.target.value)}
          onFocus={e => { e.currentTarget.style.borderColor = "#4b6cf6"; e.currentTarget.style.boxShadow = "0 0 0 4px rgba(75,108,246,0.1)"; e.currentTarget.style.background = "var(--color-surface, #ffffff)"; }}
          onBlur={e => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.background = "var(--color-surface-light, #f0f3f8)"; }}
        />
      </div>

      {/* Counter */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #98a0b8)", fontFamily: "'DM Sans', sans-serif", margin: 0 }}>
          {filtered?.length ?? 0} {t("магазинов", "do'kon")}
        </p>
        {selectedCity && (
          <button onClick={() => setSelectedCity(null)} style={{
            fontSize: "11px", color: "#4b6cf6", background: "none", border: "none",
            cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, padding: 0,
          }}>
            {t("Сбросить", "Tozalash")} ×
          </button>
        )}
      </div>

      {/* Shop list */}
      {isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ height: "72px", background: "var(--color-surface-light, #f0f3f8)", borderRadius: "16px" }} className="animate-pulse" />
          ))}
        </div>
      ) : filtered?.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0" }}>
          <div style={{
            width: "64px", height: "64px", borderRadius: "24px", display: "flex",
            alignItems: "center", justifyContent: "center", margin: "0 auto 12px",
            background: "var(--color-surface-light, #f0f3f8)",
          }}>
            <Store size={28} style={{ color: "var(--color-text-tertiary, #98a0b8)", opacity: 0.4 }} />
          </div>
          <p style={{ fontSize: "14px", fontWeight: 500, color: "var(--color-text-secondary, #6a7290)", margin: "0 0 4px" }}>
            {selectedCity ? t("Нет магазинов в этом городе", "Bu shaharda do'kon yo'q") : t("Магазины не найдены", "Do'kon topilmadi")}
          </p>
          <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #98a0b8)" }}>
            {t("Попробуйте другой фильтр", "Boshqa filtringizni sinab ko'ring")}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "420px", overflowY: "auto", paddingBottom: "4px" }}>
          {filtered?.map((shop: any) => (
            <button
              key={shop.id}
              onClick={() => onSelect(shop.id, shop.name ?? "")}
              style={{
                width: "100%", padding: "16px", textAlign: "left", display: "flex", alignItems: "center", gap: "14px",
                borderRadius: "16px", cursor: "pointer", transition: "all 0.25s cubic-bezier(0.25,0.46,0.45,0.94)",
                border: shopId === shop.id ? "2px solid #4b6cf6" : "2px solid transparent",
                background: shopId === shop.id ? "var(--color-primary-subtle, rgba(75,108,246,.10))" : "var(--color-surface, #ffffff)",
                boxShadow: shopId === shop.id
                  ? "0 4px 16px rgba(75,108,246,0.12)"
                  : "0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04)",
              }}
            >
              <div style={{
                width: "44px", height: "44px", borderRadius: "12px", display: "flex",
                alignItems: "center", justifyContent: "center", flexShrink: 0,
                background: shopId === shop.id ? "linear-gradient(135deg, #4b6cf6, #4b6cf6)" : "var(--color-surface-light, #f0f3f8)",
                boxShadow: shopId === shop.id ? "0 4px 12px rgba(75,108,246,0.25)" : "none",
              }}>
                <Store size={20} style={{ color: shopId === shop.id ? "#fff" : "var(--color-text-secondary, #6a7290)" }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: "14px", color: "var(--color-text-primary, #2b3450)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {shop.name}
                </p>
                <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px", color: "var(--color-text-secondary, #6a7290)", margin: "3px 0 0" }}>
                  {shop.ownerName ?? "—"}
                  {shop.district ? ` · ${shop.district}` : ""}
                  {shop.city ? `, ${shop.city}` : ""}
                </p>
                {Number(shop.debt ?? 0) > 0 && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", marginTop: "6px", padding: "3px 8px", borderRadius: "6px", background: "rgba(232,80,80,0.08)" }}>
                    <AlertCircle size={10} style={{ color: "#e85050" }} />
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "#e85050" }}>
                      {fmt(shop.debt)} {t("долг", "qarz")}
                    </span>
                  </div>
                )}
              </div>
              {shopId === shop.id && (
                <div style={{
                  width: "28px", height: "28px", borderRadius: "50%", flexShrink: 0,
                  background: "#4b6cf6", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
