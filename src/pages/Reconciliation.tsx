import { useState } from "react";
import { useSearchParams } from "react-router";
import { keepPreviousData } from "@tanstack/react-query";
import { Search, Store, ArrowLeftRight, ScrollText } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useTranslate } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { SectionNotice } from "@/components/SectionNotice";
import { F, COLORS } from "@/components/users/types";
import { ShopStatement } from "@/components/shops/ShopStatement";
import { ALL_TIME, isStatementPreset, type StatementPeriod } from "@contracts/statement-period";

/* ═══════════════════════════════════════════════════════════════════════════
   Акт сверки — отдельной страницей.

   ── Что было ────────────────────────────────────────────────────────────────

   Акт жил только в карточке магазина, внизу, под заказами и визитами. Чтобы
   сделать его, бухгалтер искал магазин в справочнике, открывал карточку и
   листал её до конца — и так на каждого клиента. Арендатор (09.10.2026)
   назвал это «не полно функциональным» и просил ровно три вещи: выбрать
   клиента отдельно, выбрать период и получить привычный бланк.

   ── Что теперь ──────────────────────────────────────────────────────────────

   Слева — клиенты поиском на сервере (название, владелец, телефон), должники
   сверху: акт чаще всего нужен тем, кто должен. Архивные точки тоже в списке:
   магазин закрылся, а долг остался — и сверяться с ним нужнее всего.
   Справа — тот же блок акта, что в карточке, с периодами бухгалтера и
   печатью по образцу 1С.

   Магазин и период — в адресе страницы: акт можно открыть ссылкой, а при
   смене клиента период не сбрасывается — бухгалтер обычно сверяет многих
   клиентов за один и тот же квартал.

   Права — как у ручки акта (shop.statement — managementQuery): директор,
   оператор, супервайзер.
   ═══════════════════════════════════════════════════════════════════════════ */

const PICK_LIMIT = 30;

export default function Reconciliation() {
  const t = useTranslate();
  const { fmt } = useCurrency();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const term = useDebouncedValue(search.trim());

  const shopId = Number(params.get("shop")) || 0;
  const preset = params.get("p");
  const period: StatementPeriod = isStatementPreset(preset)
    ? { preset, from: params.get("from") ?? "", to: params.get("to") ?? "" }
    : ALL_TIME;

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v); else next.delete(k);
    }
    setParams(next, { replace: true });
  };
  const setPeriod = (p: StatementPeriod) => update({ p: p.preset === "all" ? null : p.preset, from: p.from || null, to: p.to || null });
  const pickShop = (id: number | null) => update({ shop: id ? String(id) : null });

  const list = trpc.shop.list.useQuery(
    { search: term || undefined, pageSize: PICK_LIMIT, archived: "all", sortBy: "debtDesc" },
    { placeholderData: keepPreviousData },
  );
  // Магазин из ссылки может не попасть в выдачу поиска — имя берём из карточки.
  const picked = trpc.shop.getById.useQuery({ id: shopId }, { enabled: shopId > 0 });

  const rows = list.data?.data ?? [];

  const picker = (
    <div className="neo-card p-4" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ position: "relative" }}>
        <Search size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: COLORS.textTertiary, pointerEvents: "none" }} />
        <input
          className="neo-input"
          style={{ width: "100%", paddingLeft: "38px", minHeight: "44px" }}
          placeholder={t("Клиент: название, владелец, телефон", "Mijoz: nomi, egasi, telefon")}
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label={t("Поиск клиента", "Mijozni qidirish")}
          data-hotkey-search=""
        />
      </div>
      <p style={{ fontFamily: F.body, fontSize: "12px", color: COLORS.textTertiary, margin: 0 }}>
        {(list.data?.total ?? 0) > PICK_LIMIT
          ? t(`Показаны ${PICK_LIMIT} — должники сверху. Уточните поиск.`, `${PICK_LIMIT} tasi ko'rsatildi — qarzdorlar yuqorida. Qidiruvni aniqlashtiring.`)
          : t("Должники сверху", "Qarzdorlar yuqorida")}
      </p>

      {list.isLoadingError ? (
        <SectionNotice kind="error" message={t("Не удалось загрузить клиентов.", "Mijozlarni yuklab bo'lmadi.")} onRetry={() => list.refetch()} />
      ) : list.isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="animate-pulse bg-surface-light" style={{ height: "56px", borderRadius: "12px" }} />)}
        </div>
      ) : rows.length === 0 ? (
        <p style={{ fontFamily: F.body, fontSize: "13px", color: COLORS.textSecondary, padding: "16px 0", textAlign: "center", margin: 0 }}>
          {t("Ничего не найдено", "Hech narsa topilmadi")}
        </p>
      ) : (
        <div role="listbox" aria-label={t("Клиенты", "Mijozlar")} style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "60vh", overflowY: "auto" }}>
          {rows.map(s => {
            const debt = Number(s.debt ?? 0);
            const active = s.id === shopId;
            return (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={active}
                data-testid={`recon-shop-${s.id}`}
                onClick={() => pickShop(s.id)}
                className="tap"
                style={{
                  display: "flex", alignItems: "center", gap: "10px", width: "100%", minHeight: "52px",
                  padding: "8px 10px", borderRadius: "12px", textAlign: "left", cursor: "pointer",
                  border: active ? "1px solid var(--color-primary)" : "1px solid transparent",
                  background: active ? "color-mix(in srgb, var(--color-primary) 10%, transparent)" : "transparent",
                }}
              >
                <Store size={16} style={{ color: COLORS.textTertiary, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontFamily: F.body, fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.name}
                    {s.status === "inactive" && (
                      <span style={{ marginLeft: "6px", fontSize: "11px", fontWeight: 500, color: COLORS.textTertiary }}>
                        {t("архив", "arxiv")}
                      </span>
                    )}
                  </span>
                  <span style={{ display: "block", fontFamily: F.body, fontSize: "12px", color: COLORS.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {[s.ownerName, s.phone, s.agentName].filter(Boolean).join(" · ") || "—"}
                  </span>
                </span>
                <span style={{ fontFamily: F.body, fontSize: "13px", fontWeight: 700, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", color: debt > 0 ? "var(--color-danger-text)" : COLORS.textTertiary }}>
                  {debt > 0 ? fmt(debt) : t("нет долга", "qarz yo'q")}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const pickedName = picked.data?.name ?? rows.find(r => r.id === shopId)?.name ?? "";

  return (
    <div className="space-y-4">
      <div>
        <h1 style={{ fontFamily: F.display, fontSize: "22px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.02em" }}>
          {t("Акт сверки", "Solishtirma dalolatnoma")}
        </h1>
        <p style={{ fontFamily: F.body, fontSize: "13px", color: COLORS.textSecondary }}>
          {t("Выберите клиента и период — акт можно распечатать по форме 1С или выгрузить в Excel",
             "Mijoz va davrni tanlang — dalolatnomani 1C shaklida chop etish yoki Excelga yuklash mumkin")}
        </p>
      </div>

      {/*
        Колонки — minmax(0, …), а не авто: иначе длинная строка «владелец ·
        телефон · агент» (nowrap) распирает колонку шире экрана телефона, и
        сумма долга справа уезжает за край.
      */}
      <div className="grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[360px_minmax(0,1fr)]" style={{ alignItems: "start" }}>
        {/* На телефоне выбранный клиент сворачивает список: акт и так длинный. */}
        <div className={shopId ? "hidden lg:block" : undefined} style={{ minWidth: 0 }}>{picker}</div>

        <div className="space-y-3" style={{ minWidth: 0 }}>
          {shopId > 0 ? (
            <>
              <div className="neo-card p-4" style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <Store size={18} style={{ color: COLORS.primaryText }} />
                <span data-testid="recon-picked" style={{ flex: 1, minWidth: 0, fontFamily: F.display, fontSize: "16px", fontWeight: 700, color: COLORS.textPrimary }}>
                  {pickedName || "…"}
                </span>
                <button type="button" className="neo-btn tap flex items-center gap-1.5 lg:hidden" style={{ minHeight: "44px" }} onClick={() => pickShop(null)}>
                  <ArrowLeftRight size={14} />
                  {t("Другой клиент", "Boshqa mijoz")}
                </button>
              </div>
              <ShopStatement shopId={shopId} period={period} onPeriodChange={setPeriod} />
            </>
          ) : (
            <div className="neo-card p-8 hidden lg:flex" style={{ flexDirection: "column", alignItems: "center", gap: "10px", textAlign: "center" }}>
              <ScrollText size={28} style={{ color: COLORS.textTertiary }} />
              <p style={{ fontFamily: F.body, fontSize: "14px", color: COLORS.textSecondary, margin: 0 }}>
                {t("Выберите клиента слева — акт появится здесь", "Chapdan mijozni tanlang — dalolatnoma shu yerda paydo bo'ladi")}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
