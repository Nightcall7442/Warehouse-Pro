import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useCan } from "@/hooks/useCan";
import { PremiumSelect } from "@/components/PremiumSelect";
import { SectionNotice } from "@/components/SectionNotice";
import { exportToExcel } from "@/lib/export";
import { notify } from "@/lib/toast";
import { formatQty } from "@/lib/format";
import { EXPIRY_RULES } from "@contracts/expiry";
import { F, COLORS } from "@/components/users/types";
import { CalendarClock, FileSpreadsheet, Flame, Trash2, CheckCircle2, Tag, ArrowLeftRight, Loader2, Info } from "lucide-react";
import { AdjustModal } from "./AdjustModal";
import { MarkdownDialog } from "./MarkdownDialog";
import { useMoney } from "./use-money";
import {
  sortRows, firstGroup, groupOf, moneyOf, reasonOf, showDay, withUnit, excelRows, excelColumns, VERDICT_LABEL,
  type ExpiryGroup, type ExpiryRowView,
} from "./expiry-view";

/**
 * Сроки годности — рабочее место, а не список.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Список партий с датой и суммой закупки и три плитки «просрочено / горит /
 * скоро». На вопрос «уйдёт ли это само» экран не отвечал: йогурт через 12
 * дней и соус через 12 дней стояли одинаковыми строками, хотя йогурт продаётся
 * по 40 штук в день, а соус — по бутылке в неделю.
 *
 * ── Что стало ───────────────────────────────────────────────────────────────
 *
 * У каждой партии — прогноз «продастся ~X из Y до срока» по темпу продаж и
 * FEFO (contracts/expiry.ts), деньги, которые сгорят, причина словами и
 * действие рядом со строкой:
 *
 *   не успеет / нет продаж — уценить (цена-потолок для всех магазинов, пока
 *                            партия жива; агенты видят «Продать первым»);
 *   не на основном складе  — переместить: продают только с основного;
 *   просрочено             — списать (окно движения, заполненное заранее);
 *   успеет                 — ничего не делать.
 *
 * Плитки — три группы по действию, сверху в группе — что дороже всего.
 *
 * ── Про деньги ──────────────────────────────────────────────────────────────
 *
 * Директору — по закупке: столько сгорит вместе с товаром; и маржа после
 * скидки. Остальным закупку сервер не отдаёт, деньги — по цене продажи, и
 * подпись говорит об этом прямо.
 */
export function ExpiringBatches({ onOpenTransfers }: {
  /** «Переместить на основной» — раздел перемещений той же страницы склада. */
  onOpenTransfers?: () => void;
} = {}) {
  const { lang } = useLang();
  const fmt = useMoney();
  const { user } = useAuth();
  const can = useCan();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);

  const [withinDays, setWithinDays] = useState(30);
  const [picked, setPicked] = useState<ExpiryGroup | null>(null);
  const [markdownFor, setMarkdownFor] = useState<ExpiryRowView | null>(null);
  const [writeOff, setWriteOff] = useState<{ row: ExpiryRowView; onHand: number } | null>(null);
  const [opening, setOpening] = useState<number | null>(null);

  const listQ = trpc.warehouseReports.expiring.useQuery({ withinDays });
  const sumQ = trpc.warehouseReports.expiringSummary.useQuery({ withinDays });

  const seesCost = user?.role === "ceo";
  const canPrice = can("prices.manage");
  const canAdjust = can("warehouse.adjust");

  // Пустой список берётся из useMemo, а не из `?? []` по месту: новый массив
  // на каждом отрисовывании сбрасывал бы память порядка ниже.
  const rows = useMemo(() => (listQ.data ?? []).map(r => withUnit(r, lang)), [listQ.data, lang]);
  const group = picked ?? firstGroup(rows);
  const shown = useMemo(() => sortRows(rows, group), [rows, group]);

  const clear = trpc.priceList.clearMarkdown.useMutation({
    onSuccess: () => {
      utils.warehouseReports.expiring.invalidate();
      utils.warehouseReports.expiringSummary.invalidate();
      utils.product.listAll.invalidate();
      notify.success(t("Уценка снята — цена снова обычная", "Arzonlashtirish bekor — narx yana odatiy"));
    },
    onError: (e) => notify.error(e.message),
  });
  const adjust = trpc.warehouse.adjustStock.useMutation({
    onSuccess: () => {
      setWriteOff(null);
      utils.warehouseReports.expiring.invalidate();
      utils.warehouseReports.expiringSummary.invalidate();
      notify.success(t("Списано", "Hisobdan chiqarildi"));
    },
    onError: (e) => notify.error(e.message),
  });

  /* Списание: окно движения нужно с настоящим остатком склада — берём его у карточки партий. */
  const openWriteOff = async (r: ExpiryRowView) => {
    setOpening(r.batchId);
    try {
      const b = await utils.warehouseReports.productBatches.fetch({ productId: r.productId, warehouseId: r.warehouseId });
      setWriteOff({ row: r, onHand: b.onHand });
    } catch (e) {
      notify.error((e as Error).message);
    } finally {
      setOpening(null);
    }
  };

  const s = sumQ.data;
  const tiles: Array<{ key: ExpiryGroup; label: string; count: number; money: string | null; gradient: string; icon: React.ReactNode }> = [
    {
      key: "risk",
      label: t("Не успеют до срока", "Muddatgacha ulgurmaydi"),
      count: s?.riskCount ?? 0,
      money: s ? (s.riskCost != null
        ? t(`сгорит ${fmt(s.riskCost)} по закупке`, `xarid bo'yicha ${fmt(s.riskCost)} yonadi`)
        : t(`на ${fmt(s.riskSale)} по цене продажи`, `sotuv narxida ${fmt(s.riskSale)}`)) : null,
      gradient: "linear-gradient(135deg, var(--color-warning), var(--color-danger))",
      icon: <Flame size={20} color="#fff" />,
    },
    {
      key: "expired",
      label: t("Просрочено", "Muddati o'tgan"),
      count: s?.expiredCount ?? 0,
      money: s ? (s.expiredCost != null
        ? t(`потеряно ${fmt(s.expiredCost)} по закупке`, `xarid bo'yicha ${fmt(s.expiredCost)} yo'qotildi`)
        : t(`на ${fmt(s.expiredSale)} по цене продажи`, `sotuv narxida ${fmt(s.expiredSale)}`)) : null,
      gradient: "linear-gradient(135deg, var(--color-danger), var(--color-danger-text))",
      icon: <Trash2 size={20} color="#fff" />,
    },
    {
      key: "sells",
      label: t("Успевают сами", "O'zi ulguradi"),
      count: s?.sellsCount ?? 0,
      money: t("делать ничего не нужно", "hech narsa qilish shart emas"),
      gradient: "linear-gradient(135deg, var(--color-success), var(--color-info))",
      icon: <CheckCircle2 size={20} color="#fff" />,
    },
  ];

  /* Выгрузка — по-русски всегда: это бумага, а не экран. Вся группа, что на экране. */
  const handleExport = async () => {
    if (shown.length === 0) {
      notify.info(t("Нечего выгружать", "Yuklab olish uchun hech narsa yo'q"));
      return;
    }
    await exportToExcel([{ name: "Сроки годности", data: excelRows(shown), columns: excelColumns(seesCost) }], "sroki-godnosti");
  };

  return (
    <div className="space-y-4">
      <div className="neo-card neo-card-static" style={{ borderRadius: "24px", padding: "20px" }}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div style={{ minWidth: 0 }}>
            <h3 style={{ fontFamily: F.display, fontSize: "18px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.02em" }}>
              {t("Сроки годности", "Yaroqlilik muddati")}
            </h3>
            <p style={{ fontFamily: F.body, fontSize: "13px", color: COLORS.textSecondary, marginTop: "2px" }}>
              {t("Что не успеет продаться до срока и что с этим сделать", "Muddatgacha nima sotilmay qoladi va nima qilish kerak")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <PremiumSelect
              value={String(withinDays)}
              onChange={v => setWithinDays(Number(v))}
              options={[
                { value: "7", label: t("7 дней", "7 kun") },
                { value: "30", label: t("30 дней", "30 kun") },
                { value: "90", label: t("90 дней", "90 kun") },
                { value: "180", label: t("180 дней", "180 kun") },
              ]}
            />
            <button className="neo-btn tap" onClick={handleExport} style={{ display: "flex", alignItems: "center", gap: "6px" }} aria-label="Excel">
              <FileSpreadsheet size={15} />
              <span className="hidden sm:inline">Excel</span>
            </button>
          </div>
        </div>

        {/* Три группы — три плитки: по ним делают разное. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {tiles.map(tile => {
            const active = group === tile.key;
            return (
              <button
                key={tile.key}
                type="button"
                onClick={() => setPicked(tile.key)}
                className={active ? "kpi-hero neo-card-pressed" : "kpi-hero"}
                style={{ borderRadius: "20px", padding: "14px 16px", textAlign: "left", cursor: "pointer", minHeight: 44 }}
                aria-pressed={active}
                data-testid={`expiry-tile-${tile.key}`}
              >
                {/* Телефон: строкой — три плитки столбиком съедали экран до первой партии. */}
                <div className="flex items-center gap-3 sm:hidden">
                  <div style={{ width: "34px", height: "34px", flexShrink: 0, borderRadius: "10px", background: tile.gradient, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {tile.icon}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontFamily: F.display, fontSize: "13px", fontWeight: 700, color: COLORS.textPrimary }}>{tile.label}</div>
                    {tile.money && <div style={{ fontSize: "12px", color: COLORS.textSecondary }}>{tile.money}</div>}
                  </div>
                  <div className="font-data" style={{ fontSize: "22px", fontWeight: 700, color: COLORS.textPrimary, flexShrink: 0 }}>{tile.count}</div>
                </div>
                <div className="hidden sm:block">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span style={{ fontFamily: F.display, fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: COLORS.textTertiary }}>
                      {tile.label}
                    </span>
                    <div style={{ width: "36px", height: "36px", flexShrink: 0, borderRadius: "11px", background: tile.gradient, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {tile.icon}
                    </div>
                  </div>
                  <div className="font-data" style={{ fontFamily: F.display, fontSize: "26px", fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1, letterSpacing: "-0.03em" }}>
                    {tile.count}
                  </div>
                  {tile.money && (
                    <div style={{ marginTop: "8px", fontFamily: F.body, fontSize: "12px", fontWeight: 600, color: COLORS.textSecondary }}>
                      {tile.money}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
        {s && s.markedDown > 0 && (
          <p className="flex items-center gap-1.5" style={{ marginTop: 12, fontSize: 13, color: COLORS.textSecondary }}>
            <Tag size={14} style={{ color: "var(--color-primary-text)" }} />
            {t(`Уценено ${s.markedDown} из ${s.riskCount} — агенты видят их первыми`, `${s.riskCount} tadan ${s.markedDown} tasi arzonlashtirilgan — agentlar ularni birinchi ko'radi`)}
          </p>
        )}
      </div>

      {listQ.isLoadingError ? (
        <SectionNotice kind="error" message={t("Не удалось загрузить сроки", "Muddatlarni yuklab bo'lmadi")} onRetry={() => listQ.refetch()} />
      ) : listQ.isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-24 bg-surface-light animate-pulse rounded-2xl" />)}
        </div>
      ) : shown.length === 0 ? (
        <SectionNotice
          kind="empty"
          message={rows.length === 0
            ? t("Ничего не сгорает в этот срок", "Bu muddatda hech narsa yonmaydi")
            : t("В этой группе ничего нет", "Bu guruhda hech narsa yo'q")}
        />
      ) : (
        <div className="space-y-3" data-testid="expiry-rows">
          {shown.map(r => (
            <ExpiryRowCard
              key={r.batchId}
              r={r}
              seesCost={seesCost}
              canPrice={canPrice}
              canAdjust={canAdjust}
              opening={opening === r.batchId}
              clearing={clear.isPending && clear.variables?.productId === r.productId}
              onMarkdown={() => setMarkdownFor(r)}
              onClear={() => clear.mutate({ productId: r.productId })}
              onWriteOff={() => openWriteOff(r)}
              onMove={() => (onOpenTransfers ? onOpenTransfers() : navigate("/warehouse?tab=transfers"))}
            />
          ))}
        </div>
      )}

      {/* Правило — словами, чтобы прогнозу можно было не верить на слово. */}
      <p className="flex items-start gap-2" style={{ fontSize: 12, color: COLORS.textTertiary, lineHeight: 1.55, padding: "0 4px" }}>
        <Info size={14} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          {t(`Темп — доставленные заказы за ${EXPIRY_RULES.PACE_WINDOW_DAYS} дней минус возвраты. Первой уходит партия, которая раньше сгорит. Скидка: до 7 дней — 30 %, до 14 — 20 %, дальше — 10 %.`,
             `Sur'at — ${EXPIRY_RULES.PACE_WINDOW_DAYS} kunlik yetkazilgan buyurtmalar minus qaytarishlar. Birinchi bo'lib muddati oldin tugaydigan partiya ketadi. Chegirma: 7 kungacha — 30 %, 14 kungacha — 20 %, undan keyin — 10 %.`)}
        </span>
      </p>

      {markdownFor && <MarkdownDialog row={markdownFor} seesCost={seesCost} onClose={() => setMarkdownFor(null)} />}
      {writeOff && (
        <AdjustModal
          productId={writeOff.row.productId}
          productName={writeOff.row.productName ?? ""}
          currentStock={writeOff.onHand}
          unitWeight={0}
          warehouseId={writeOff.row.warehouseId}
          initial={{
            type: "out",
            qty: String(writeOff.row.quantity),
            notes: t(`Просрочка: партия ${writeOff.row.batchNumber ?? "—"}, годен до ${showDay(writeOff.row.expiresAt)}`, `Muddati o'tgan: ${writeOff.row.batchNumber ?? "—"} partiya, ${showDay(writeOff.row.expiresAt)} gacha`),
          }}
          onSave={d => adjust.mutate(d as Parameters<typeof adjust.mutate>[0])}
          onClose={() => setWriteOff(null)}
          isPending={adjust.isPending}
        />
      )}
    </div>
  );
}

const TONE = {
  danger:  { fill: "var(--color-danger-subtle)", text: "var(--color-danger-text)" },
  warning: { fill: "var(--color-warning-subtle)", text: "var(--color-warning-text)" },
  success: { fill: "var(--color-success-subtle)", text: "var(--color-success-text)" },
} as const;

/**
 * Строка партии: что это, уйдёт ли само, сколько денег, что сделать.
 * На широком экране — четыре колонки, на телефоне — те же блоки столбиком.
 */
function ExpiryRowCard({ r, seesCost, canPrice, canAdjust, opening, clearing, onMarkdown, onClear, onWriteOff, onMove }: {
  r: ExpiryRowView; seesCost: boolean; canPrice: boolean; canAdjust: boolean; opening: boolean; clearing: boolean;
  onMarkdown: () => void; onClear: () => void; onWriteOff: () => void; onMove: () => void;
}) {
  const { lang } = useLang();
  const fmt = useMoney();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const v = VERDICT_LABEL[r.verdict];
  const tone = TONE[v.tone];
  // Цвет срока — по дням, а не по вердикту: «19 дн.» не горит, даже если продаж нет.
  const dayTone = TONE[r.daysLeft <= 7 ? "danger" : r.daysLeft <= 14 ? "warning" : "success"];
  const u = r.unitLabel;
  const group = groupOf(r.verdict);
  const soldShare = r.quantity > 0 ? Math.min(1, r.sold / r.quantity) : 0;

  const daysChip = r.daysLeft < 0
    ? t(`${-r.daysLeft} дн. назад`, `${-r.daysLeft} kun oldin`)
    : r.daysLeft === 0 ? t("сегодня", "bugun") : t(`${r.daysLeft} дн.`, `${r.daysLeft} kun`);

  const moneyLabel = group === "expired"
    ? t("Потеряно", "Yo'qotildi")
    : group === "sells" ? t("Уйдёт само", "O'zi ketadi") : t("Сгорит", "Yonadi");
  const moneyBasis = r.atRiskCost != null ? t("по закупке", "xarid bo'yicha") : t("по цене продажи", "sotuv narxida");

  return (
    <div className="neo-card-sm" style={{ borderRadius: "18px", padding: "16px" }} data-testid={`expiry-row-${r.batchId}`}>
      <div className="grid gap-3 lg:gap-5 lg:items-center lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,0.8fr)_minmax(0,1.5fr)]">
        {/* Что это */}
        <div style={{ minWidth: 0 }}>
          <div className="flex items-start justify-between gap-2">
            <div style={{ fontFamily: F.display, fontSize: 15, fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1.3, minWidth: 0 }}>
              {r.productName ?? "—"}
            </div>
            <span className="lg:hidden shrink-0 inline-flex items-center gap-1 rounded-lg font-data" style={{ padding: "3px 8px", fontSize: 12, fontWeight: 700, background: dayTone.fill, color: dayTone.text, whiteSpace: "nowrap" }}>
              <CalendarClock size={12} />{daysChip}
            </span>
          </div>
          <div style={{ fontSize: 12, color: COLORS.textTertiary, marginTop: 2 }}>
            {[r.productCode, r.batchNumber && `${t("партия", "partiya")} ${r.batchNumber}`, r.warehouseName].filter(Boolean).join(" · ")}
          </div>
          <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 6, fontSize: 13, color: COLORS.textSecondary }}>
            <span className="font-data" style={{ whiteSpace: "nowrap" }}>{t("до", "gacha")} {showDay(r.expiresAt)}</span>
            <span className="hidden lg:inline-flex items-center gap-1 rounded-lg font-data" style={{ padding: "2px 8px", fontSize: 12, fontWeight: 700, background: dayTone.fill, color: dayTone.text, whiteSpace: "nowrap" }}>
              <CalendarClock size={12} />{daysChip}
            </span>
            <span className="font-data" style={{ whiteSpace: "nowrap" }}>· {formatQty(r.quantity)} {u}</span>
          </div>
        </div>

        {/* Уйдёт ли само */}
        <div style={{ minWidth: 0 }}>
          <span className="inline-flex items-center rounded-lg" style={{ padding: "2px 8px", fontSize: 12, fontWeight: 700, background: tone.fill, color: tone.text }}>
            {lang === "uz" ? v.uz : v.ru}
          </span>
          {(r.verdict === "short" || r.verdict === "sells") && (
            <div aria-hidden style={{ height: 6, borderRadius: 3, marginTop: 8, background: "var(--color-danger-subtle)", overflow: "hidden" }}>
              <div style={{ width: `${Math.round(soldShare * 100)}%`, height: "100%", background: "var(--color-success)" }} />
            </div>
          )}
          <p style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 6, lineHeight: 1.45 }}>{reasonOf(r, lang)}</p>
        </div>

        {/* Деньги */}
        <div className="flex items-baseline justify-between gap-2 lg:block" style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: COLORS.textTertiary }}>{moneyLabel}</div>
          <div className="text-right lg:text-left">
            <div className="font-data" style={{ fontSize: 16, fontWeight: 700, whiteSpace: "nowrap", color: group === "sells" ? COLORS.textSecondary : tone.text }}>
              {group === "sells" ? formatQty(r.quantity) + " " + u : fmt(moneyOf(r))}
            </div>
            {group !== "sells" && <div style={{ fontSize: 11, color: COLORS.textTertiary }}>{moneyBasis}</div>}
          </div>
        </div>

        {/* Что сделать */}
        <div style={{ minWidth: 0 }}>
          {r.markdown ? (
            <div>
              <p className="flex items-center gap-1.5" style={{ fontSize: 13, fontWeight: 700, color: "var(--color-primary-text)" }}>
                <Tag size={14} />
                <span className="font-data" style={{ whiteSpace: "nowrap" }}>{t("Уценено:", "Arzonlashtirilgan:")} {fmt(r.markdown.price)}</span>
              </p>
              <p style={{ fontSize: 12, color: COLORS.textTertiary, marginTop: 2 }}>
                {t(`до ${showDay(r.markdown.endsOn)} или пока партия не продана · агенты видят «Продать первым»`, `${showDay(r.markdown.endsOn)} gacha yoki partiya sotilguncha · agentlar «Birinchi sotish»ni ko'radi`)}
              </p>
              {canPrice && (
                <button type="button" className="neo-btn tap w-full lg:w-auto" style={{ marginTop: 8 }} onClick={onClear} disabled={clearing} data-testid={`expiry-clear-${r.batchId}`}>
                  {clearing && <Loader2 size={14} className="animate-spin" />}
                  {t("Снять уценку", "Bekor qilish")}
                </button>
              )}
            </div>
          ) : r.advice ? (
            <div>
              <p style={{ fontSize: 12, color: COLORS.textTertiary }}>
                {t("Совет: скидка", "Maslahat: chegirma")} <b className="font-data" style={{ color: COLORS.textPrimary }}>{r.advice.pct} %</b>
              </p>
              <p className="font-data" style={{ fontSize: 15, fontWeight: 700, color: COLORS.textPrimary, whiteSpace: "nowrap", marginTop: 1 }}>
                {fmt(r.advice.price)}{" "}
                <span style={{ fontSize: 12, fontWeight: 500, color: COLORS.textTertiary, textDecoration: "line-through" }}>{fmt(r.price)}</span>
              </p>
              {seesCost && r.adviceMoney?.costKnown && (
                r.adviceMoney.belowCost ? (
                  <p style={{ fontSize: 12, color: "var(--color-warning-text)", marginTop: 4, lineHeight: 1.45 }}>
                    {t(`Ниже закупки на ${fmt(-r.adviceMoney.unitMargin)} за ${u}. Но списание — минус ${fmt(r.adviceMoney.writeOff)}, а так вернётся ${fmt(r.adviceMoney.recovered)}`,
                       `Xariddan ${u} uchun ${fmt(-r.adviceMoney.unitMargin)} past. Lekin hisobdan chiqarish — minus ${fmt(r.adviceMoney.writeOff)}, bunda ${fmt(r.adviceMoney.recovered)} qaytadi`)}
                  </p>
                ) : (
                  <p style={{ fontSize: 12, color: "var(--color-success-text)", marginTop: 4 }}>
                    {t(`Маржа останется ${fmt(r.adviceMoney.unitMargin)} за ${u}`, `Marja ${u} uchun ${fmt(r.adviceMoney.unitMargin)} qoladi`)}
                  </p>
                )
              )}
              {!seesCost && r.needsDirector ? (
                <p style={{ fontSize: 12, color: COLORS.textTertiary, marginTop: 4 }}>
                  {t("Эта цена ниже закупки — уценку ставит директор", "Bu narx xariddan past — arzonlashtirishni direktor qo'yadi")}
                </p>
              ) : canPrice && (
                <button type="button" className="neo-btn-primary tap w-full lg:w-auto" style={{ marginTop: 8 }} onClick={onMarkdown} data-testid={`expiry-markdown-${r.batchId}`}>
                  <Tag size={14} />
                  {t("Уценить", "Arzonlashtirish")}
                </button>
              )}
            </div>
          ) : r.verdict === "elsewhere" ? (
            <button type="button" className="neo-btn tap w-full lg:w-auto" onClick={onMove}>
              <ArrowLeftRight size={14} />
              {t("Переместить на основной", "Asosiyga ko'chirish")}
            </button>
          ) : r.verdict === "expired" ? (
            canAdjust ? (
              <button type="button" className="neo-btn tap w-full lg:w-auto" onClick={onWriteOff} disabled={opening} style={{ color: "var(--color-danger-text)" }} data-testid={`expiry-writeoff-${r.batchId}`}>
                {opening ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {t("Списать", "Hisobdan chiqarish")}
              </button>
            ) : (
              <p style={{ fontSize: 12, color: COLORS.textTertiary }}>{t("Списывает директор", "Direktor hisobdan chiqaradi")}</p>
            )
          ) : (
            <p className="flex items-center gap-1.5" style={{ fontSize: 13, color: "var(--color-success-text)" }}>
              <CheckCircle2 size={14} />
              {t("Делать ничего не нужно", "Hech narsa qilish shart emas")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
