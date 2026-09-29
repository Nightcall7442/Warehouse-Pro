import { useState, useMemo } from "react";
import { useCurrency } from "@/hooks/useCurrency";
import { useShopSearch, SHOP_PICK_LIMIT } from "@/hooks/useShopSearch";
import { useLang } from "@/i18n";
import { Store, Search, AlertCircle } from "lucide-react";

interface ShopSelectorProps {
  shopId: number;
  /** Имя выбранного магазина: он показывается, даже если поиск его не вернул. */
  shopName?: string;
  onSelect: (id: number, name: string) => void;
}

/*
  Магазины — поиском на сервере (useShopSearch), одним путём для всех ролей.

  Здесь грузились 200 самых новых магазинов (агенту — все) и фильтровались
  у себя: у организации с тысячами точек основные, давние клиенты не
  находились, телефон не искался. Кнопки городов собирались из тех же 200 и
  отбирали только среди них — теперь город ищется той же строкой.
*/
export function ShopSelector({ shopId, shopName, onSelect }: ShopSelectorProps) {
  const [search, setSearch] = useState("");
  const { fmt } = useCurrency();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const pinned = useMemo(() => (shopId > 0 && shopName ? { id: shopId, name: shopName } : null), [shopId, shopName]);
  const { shops: filtered, isLoading, more } = useShopSearch(search, { pinned });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Header */}
      <div>
        <h2 style={{ fontFamily: "'Manrope', sans-serif", fontSize: "20px", fontWeight: 700, color: "var(--color-text-primary, #2b2a28)", margin: "0 0 4px", letterSpacing: "-0.02em" }}>
          {t("Выберите магазин", "Do'kon tanlang")}
        </h2>
        <p style={{ fontSize: "13px", color: "var(--color-text-tertiary, #6b6760)", margin: 0 }}>
          {t("Для которого оформляем заказ", "Buyurtma uchun do'kon")}
        </p>
      </div>

      {/* Search */}
      <div style={{ position: "relative" }}>
        <Search size={16} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary, #6b6760)", pointerEvents: "none" }} />
        <input
          style={{
            width: "100%", padding: "12px 14px 12px 42px", borderRadius: "14px",
            background: "var(--color-surface-light, #f6f4f0)", border: "2px solid transparent",
            fontSize: "14px", fontFamily: "'Manrope', sans-serif", color: "var(--color-text-primary, #2b2a28)",
            outline: "none", transition: "all 0.2s ease",
          }}
          placeholder={t("Поиск магазинов…", "Do'kon qidirish…")}
          value={search}
          onChange={e => setSearch(e.target.value)}
          onFocus={e => { e.currentTarget.style.borderColor = "var(--color-primary)"; e.currentTarget.style.boxShadow = "0 0 0 4px color-mix(in srgb, var(--color-primary) 10%, transparent)"; e.currentTarget.style.background = "var(--color-surface, #efedea)"; }}
          onBlur={e => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.background = "var(--color-surface-light, #f6f4f0)"; }}
        />
      </div>

      {/* Counter */}
      <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #6b6760)", fontFamily: "'Manrope', sans-serif", margin: 0 }}>
        {more
          ? t(`Показаны первые ${SHOP_PICK_LIMIT} — уточните поиск: название, владелец, телефон, район, город`, `Dastlabki ${SHOP_PICK_LIMIT} tasi ko'rsatildi — qidiruvni aniqlashtiring: nomi, egasi, telefon, tuman, shahar`)
          : `${filtered.length} ${t("магазинов", "do'kon")}`}
      </p>

      {/* Shop list */}
      {isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ height: "72px", background: "var(--color-surface-light, #f6f4f0)", borderRadius: "16px" }} className="animate-pulse" />
          ))}
        </div>
      ) : filtered?.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0" }}>
          <div style={{
            width: "64px", height: "64px", borderRadius: "24px", display: "flex",
            alignItems: "center", justifyContent: "center", margin: "0 auto 12px",
            background: "var(--color-surface-light, #f6f4f0)",
          }}>
            <Store size={28} style={{ color: "var(--color-text-tertiary, #6b6760)", opacity: 0.4 }} />
          </div>
          <p style={{ fontSize: "14px", fontWeight: 500, color: "var(--color-text-secondary, #5e5b54)", margin: "0 0 4px" }}>
            {t("Магазины не найдены", "Do'kon topilmadi")}
          </p>
          <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #6b6760)" }}>
            {t("Попробуйте другой поиск", "Boshqa qidiruvni sinab ko'ring")}
          </p>
        </div>
      ) : (
        /* Список течёт в общей прокрутке страницы.
           Здесь стояло maxHeight: 420px, overflowY: auto — отдельная
           прокрутка поверх прокрутки страницы. На 375×812 это упирало список
           в невидимую границу посреди экрана: палец докручивал его до конца,
           дальше ничего, и надо было сообразить провести пальцем по другому
           месту, чтобы поехала уже сама страница. При десятке магазинов агент
           решал, что список кончился.
           Ровно этот приём уже признали ловушкой и убрали из каталога товаров
           (ProductSelector), а на первом шаге мастера он остался. */
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", paddingBottom: "4px" }}>
          {filtered?.map((shop) => (
            <button
              key={shop.id}
              onClick={() => onSelect(shop.id, shop.name ?? "")}
              style={{
                width: "100%", padding: "16px", textAlign: "left", display: "flex", alignItems: "center", gap: "14px",
                borderRadius: "16px", cursor: "pointer", transition: "all 0.25s cubic-bezier(0.25,0.46,0.45,0.94)",
                border: shopId === shop.id ? "2px solid var(--color-primary)" : "2px solid transparent",
                background: shopId === shop.id ? "var(--color-primary-subtle)" : "var(--color-surface, #efedea)",
                boxShadow: shopId === shop.id
                  ? "0 4px 16px color-mix(in srgb, var(--color-primary) 12%, transparent)"
                  : "var(--shadow-sm)",
              }}
            >
              <div style={{
                width: "44px", height: "44px", borderRadius: "12px", display: "flex",
                alignItems: "center", justifyContent: "center", flexShrink: 0,
                background: shopId === shop.id ? "var(--color-primary)" : "var(--color-surface-light, #f6f4f0)",
                boxShadow: shopId === shop.id ? "0 4px 12px color-mix(in srgb, var(--color-primary) 25%, transparent)" : "none",
              }}>
                <Store size={20} style={{ color: shopId === shop.id ? "#fff" : "var(--color-text-secondary, #5e5b54)" }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600, fontSize: "14px", color: "var(--color-text-primary, #2b2a28)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {shop.name}
                </p>
                <p style={{ fontFamily: "'Manrope', sans-serif", fontSize: "12px", color: "var(--color-text-secondary, #5e5b54)", margin: "3px 0 0" }}>
                  {shop.ownerName ?? "—"}
                  {shop.district ? ` · ${shop.district}` : ""}
                  {shop.city ? `, ${shop.city}` : ""}
                </p>
                {Number(shop.debt ?? 0) > 0 && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", marginTop: "6px", padding: "3px 8px", borderRadius: "6px", background: "var(--color-danger-subtle)" }}>
                    <AlertCircle size={10} style={{ color: "var(--color-danger-text)" }} />
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-danger-text)" }}>
                      {fmt(shop.debt)} {t("долг", "qarz")}
                    </span>
                  </div>
                )}
              </div>
              {shopId === shop.id && (
                <div style={{
                  width: "28px", height: "28px", borderRadius: "50%", flexShrink: 0,
                  background: "var(--color-primary)", display: "flex", alignItems: "center", justifyContent: "center",
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
