import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useConfirm } from "@/components/ConfirmDialog";
import { PremiumSelect } from "@/components/PremiumSelect";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { notify } from "@/lib/toast";
import { formatQty } from "@/lib/format";
import { useCurrency } from "@/hooks/useCurrency";
import { F, COLORS, thStyle, tdStyle } from "@/components/users/types";
import { format } from "date-fns";
import { ClipboardList, Plus, ScanLine, Check, X } from "lucide-react";

/**
 * Инвентаризация — документ, а не кнопка по одному товару.
 *
 * Пересчёт был «Скорректировать» на строке: без «ожидалось / посчитано»,
 * без итога недостачи, без одного действия «применить». Здесь: черновик со
 * снимком остатков склада; по каждому товару — что насчитали (поле, сканер
 * или клавиатура-сканер: код + Enter → +1); внизу итог излишков и недостач в
 * штуках и деньгах по себестоимости; «Применить» проводит всё разом через
 * дверь остатка. Непосчитанные строки не трогаются: «не считали» — не «ноль».
 */

type Warehouse = { id: number; name: string; isDefault?: boolean | null };

export function StockCounts({ warehouses }: { warehouses: Warehouse[] }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const utils = trpc.useUtils();
  const [openId, setOpenId] = useState<number | null>(null);
  const [warehouseId, setWarehouseId] = useState<string>(String(warehouses.find(w => w.isDefault)?.id ?? warehouses[0]?.id ?? ""));

  const listQ = trpc.stockCount.list.useQuery({ limit: 50 });
  const create = trpc.stockCount.create.useMutation({
    onSuccess: (r) => { utils.stockCount.list.invalidate(); setOpenId(r.id); notify.success(t(`Черновик ${r.number} создан`, `${r.number} qoralamasi yaratildi`)); },
    onError: (e) => notify.error(e.message),
  });

  if (openId != null) return <StockCountSheet id={openId} onBack={() => { setOpenId(null); utils.stockCount.list.invalidate(); }} />;

  const STATUS: Record<string, [string, string, string]> = {
    draft: [t("черновик", "qoralama"), "var(--color-warning-text)", "color-mix(in srgb, var(--color-warning) 12%, transparent)"],
    applied: [t("применена", "qo'llandi"), "var(--color-success-text)", "color-mix(in srgb, var(--color-success) 12%, transparent)"],
    cancelled: [t("отменена", "bekor qilindi"), "var(--color-text-tertiary)", "var(--color-surface-light)"],
  };

  return (
    <div className="space-y-4">
      <div className="neo-card p-5 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px]">
          <p className="text-[10px] font-semibold tracking-wider uppercase mb-2" style={{ color: COLORS.textTertiary }}>{t("Склад", "Ombor")}</p>
          <PremiumSelect value={warehouseId} onChange={setWarehouseId} width="100%"
            options={warehouses.map(w => ({ value: String(w.id), label: w.name }))} />
        </div>
        <button className="neo-btn-primary tap flex items-center gap-2" disabled={!warehouseId || create.isPending}
          onClick={() => create.mutate({ warehouseId: Number(warehouseId) })} data-testid="stock-count-new">
          <Plus size={16} /> {t("Новая инвентаризация", "Yangi inventarizatsiya")}
        </button>
        <p className="text-xs" style={{ color: COLORS.textTertiary }}>
          {t("Черновик снимает остатки склада на этот момент; считать можно несколько дней.", "Qoralama shu paytdagi qoldiqlarni oladi; hisoblash bir necha kun davom etishi mumkin.")}
        </p>
      </div>

      <div className="neo-card overflow-hidden">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead><tr>
              {[t("НОМЕР", "RAQAM"), t("СКЛАД", "OMBOR"), t("СОЗДАНА", "YARATILDI"), t("СТРОК", "QATORLAR"), t("ПОСЧИТАНО", "HISOBLANDI"), t("СТАТУС", "HOLAT"), ""].map((h, i) => (
                <th key={i} style={{ ...thStyle, textAlign: i === 0 || i === 1 ? "left" : "right" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {(listQ.data ?? []).map(c => {
                const [label, color, bg] = STATUS[c.status] ?? STATUS.draft;
                return (
                  <tr key={c.id} className="row-hover" data-testid={`stock-count-${c.id}`}>
                    <td style={tdStyle}><span style={{ fontWeight: 700, fontFamily: F.display }}>{c.number}</span></td>
                    <td style={tdStyle}>{c.warehouseName ?? "—"}</td>
                    <td style={{ ...tdStyle, textAlign: "right", color: COLORS.textSecondary }}>{format(new Date(c.createdAt), "dd.MM.yyyy HH:mm")}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{c.lines}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{c.counted}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, color, background: bg }}>{label}</span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <button className="neo-btn neo-btn-xs tap" onClick={() => setOpenId(c.id)}>{c.status === "draft" ? t("Продолжить", "Davom etish") : t("Открыть", "Ochish")}</button>
                    </td>
                  </tr>
                );
              })}
              {listQ.data?.length === 0 && (
                <tr><td colSpan={7} style={{ ...tdStyle, textAlign: "center", padding: "40px", color: COLORS.textTertiary }}>
                  <ClipboardList size={28} style={{ margin: "0 auto 8px", display: "block" }} />
                  {t("Инвентаризаций ещё не было", "Inventarizatsiya hali bo'lmagan")}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StockCountSheet({ id, onBack }: { id: number; onBack: () => void }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { fmt } = useCurrency();
  const { confirm, dialog } = useConfirm();
  const utils = trpc.useUtils();
  const q = trpc.stockCount.get.useQuery({ id });
  const [search, setSearch] = useState("");
  const [wedge, setWedge] = useState("");
  const [scanning, setScanning] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [onlyDiff, setOnlyDiff] = useState(false);

  const setCounted = trpc.stockCount.setCounted.useMutation({
    onSuccess: () => utils.stockCount.get.invalidate({ id }),
    onError: (e) => notify.error(e.message),
  });
  const apply = trpc.stockCount.applyCount.useMutation({
    onSuccess: (r) => {
      utils.stockCount.get.invalidate({ id }); utils.warehouseMulti.getStock.invalidate();
      notify.success(t(`${r.number} применена: изменено ${r.changed} из ${r.applied}, излишек ${formatQty(r.surplus)}, недостача ${formatQty(r.shortage)}`,
        `${r.number} qo'llandi: ${r.applied} dan ${r.changed} o'zgardi`));
    },
    onError: (e) => notify.error(e.message),
  });
  const cancel = trpc.stockCount.cancel.useMutation({
    onSuccess: () => { notify.info(t("Инвентаризация отменена", "Inventarizatsiya bekor qilindi")); onBack(); },
    onError: (e) => notify.error(e.message),
  });

  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const draft = q.data?.status === "draft";

  const summary = useMemo(() => {
    let surplusQty = 0, shortageQty = 0, surplusMoney = 0, shortageMoney = 0, counted = 0;
    for (const it of items) {
      if (it.counted == null) continue;
      counted++;
      const diff = Number(it.counted) - Number(it.expected);
      const cost = Number(it.costPrice ?? 0);
      if (diff > 0) { surplusQty += diff; surplusMoney += diff * cost; }
      else if (diff < 0) { shortageQty += -diff; shortageMoney += -diff * cost; }
    }
    return { surplusQty, shortageQty, surplusMoney, shortageMoney, counted, total: items.length };
  }, [items]);

  /** Скан или код + Enter: найденной строке +1; незнакомый код — вслух. */
  const scanned = (code: string) => {
    const norm = code.trim().toLowerCase();
    const hit = items.find(i => (i.barcode ?? "").toLowerCase() === norm || (i.productCode ?? "").toLowerCase() === norm);
    if (!hit) { setLastScanned(t(`Не найден: ${code}`, `Topilmadi: ${code}`)); notify.error(t(`Товар со штрих-кодом ${code} не найден в документе`, `${code} shtrix-kodli mahsulot hujjatda topilmadi`)); return; }
    setCounted.mutate({ id, productId: hit.productId, delta: 1 });
    setLastScanned(hit.productName);
  };

  const visible = items.filter(it => {
    if (search) { const s = search.toLowerCase(); if (!it.productName.toLowerCase().includes(s) && !(it.productCode ?? "").toLowerCase().includes(s)) return false; }
    if (onlyDiff) { if (it.counted == null) return false; if (Math.abs(Number(it.counted) - Number(it.expected)) < 0.005) return false; }
    return true;
  });

  const onApply = async () => {
    const ok = await confirm({
      title: t("Применить инвентаризацию?", "Inventarizatsiyani qo'llash?"),
      message: t(
        `${q.data?.number}: посчитано ${summary.counted} из ${summary.total} строк. Излишек ${formatQty(summary.surplusQty)} (${fmt(summary.surplusMoney.toFixed(0))}), недостача ${formatQty(summary.shortageQty)} (${fmt(summary.shortageMoney.toFixed(0))}). Остатки станут такими, как посчитано; непосчитанные строки не тронутся. Отменить нельзя.`,
        `${q.data?.number}: ${summary.total} qatordan ${summary.counted} hisoblandi. Ortiqcha ${formatQty(summary.surplusQty)}, kamomad ${formatQty(summary.shortageQty)}. Bekor qilib bo'lmaydi.`,
      ),
      confirmText: t("Применить", "Qo'llash"),
      danger: summary.shortageQty > 0,
    });
    if (ok) apply.mutate({ id });
  };

  if (q.isLoading || !q.data) return <div className="neo-card p-8 text-center" style={{ color: COLORS.textTertiary }}>…</div>;

  return (
    <div className="space-y-4">
      {scanning && <BarcodeScanner continuous lastResult={lastScanned} onScan={scanned} onClose={() => setScanning(false)}
        label={t("Сканируйте товары — каждый код прибавляет единицу", "Mahsulotlarni skanerlang — har bir kod bittadan qo'shadi")} />}

      <div className="neo-card p-5 flex flex-wrap items-center gap-3">
        <button className="neo-btn neo-btn-xs tap" onClick={onBack}>← {t("Назад", "Orqaga")}</button>
        <div>
          <p style={{ margin: 0, fontFamily: F.display, fontWeight: 700, fontSize: 16 }}>{q.data.number} · {q.data.status === "draft" ? t("черновик", "qoralama") : q.data.status === "applied" ? t("применена", "qo'llandi") : t("отменена", "bekor qilindi")}</p>
          <p style={{ margin: 0, fontSize: 12, color: COLORS.textTertiary }}>{format(new Date(q.data.createdAt), "dd.MM.yyyy HH:mm")}{q.data.appliedAt ? ` · ${t("применена", "qo'llandi")} ${format(new Date(q.data.appliedAt), "dd.MM.yyyy HH:mm")}` : ""}</p>
        </div>
        <div className="flex-1" />
        {draft && (
          <>
            <input className="neo-input" style={{ width: 170, padding: "6px 8px", fontSize: 12 }} placeholder={t("Штрих-код + Enter", "Shtrix-kod + Enter")}
              value={wedge} onChange={e => setWedge(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && wedge.trim()) { e.preventDefault(); scanned(wedge); setWedge(""); } }}
              data-testid="stock-count-wedge" />
            <button className="neo-btn tap flex items-center gap-1" onClick={() => { setLastScanned(null); setScanning(true); }} data-testid="stock-count-scan"><ScanLine size={14} /> {t("Сканер", "Skaner")}</button>
            <button className="neo-btn tap flex items-center gap-1 text-danger" disabled={cancel.isPending} onClick={async () => {
              if (await confirm({ title: t("Отменить инвентаризацию?", "Bekor qilinsinmi?"), message: t("Посчитанное пропадёт, остатки не изменятся.", "Hisoblanganlar yo'qoladi, qoldiqlar o'zgarmaydi."), confirmText: t("Отменить", "Bekor qilish"), danger: true })) cancel.mutate({ id });
            }}><X size={14} /> {t("Отменить", "Bekor qilish")}</button>
            <button className="neo-btn-primary tap flex items-center gap-1" disabled={apply.isPending || summary.counted === 0} onClick={onApply} data-testid="stock-count-apply"><Check size={14} /> {t("Применить", "Qo'llash")}</button>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          [t("Посчитано строк", "Hisoblangan qatorlar"), `${summary.counted} / ${summary.total}`, COLORS.textPrimary],
          [t("Излишек", "Ortiqcha"), `${formatQty(summary.surplusQty)} · ${fmt(summary.surplusMoney.toFixed(0))}`, "var(--color-success-text)"],
          [t("Недостача", "Kamomad"), `${formatQty(summary.shortageQty)} · ${fmt(summary.shortageMoney.toFixed(0))}`, "var(--color-danger-text)"],
          [t("Итого по себестоимости", "Tannarx bo'yicha jami"), fmt((summary.surplusMoney - summary.shortageMoney).toFixed(0)), COLORS.textPrimary],
        ].map(([label, value, color]) => (
          <div key={label} className="neo-card p-4">
            <p className="text-[10px] font-semibold tracking-wider uppercase" style={{ color: COLORS.textTertiary, margin: 0 }}>{label}</p>
            <p style={{ margin: "4px 0 0", fontFamily: F.display, fontWeight: 700, fontSize: 16, color, fontVariantNumeric: "tabular-nums" }}>{value}</p>
          </div>
        ))}
      </div>

      <div className="neo-card p-4 flex flex-wrap items-center gap-3">
        <input className="neo-input" style={{ maxWidth: 320 }} placeholder={t("Поиск по названию или коду…", "Nomi yoki kodi bo'yicha qidirish…")} value={search} onChange={e => setSearch(e.target.value)} />
        <label className="flex items-center gap-2 text-sm" style={{ color: COLORS.textSecondary }}>
          <input type="checkbox" checked={onlyDiff} onChange={e => setOnlyDiff(e.target.checked)} /> {t("Только расхождения", "Faqat farqlar")}
        </label>
        <span className="text-xs" style={{ color: COLORS.textTertiary }}>{visible.length} {t("строк", "qator")}</span>
      </div>

      <div className="neo-card overflow-hidden">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead><tr>
              {[t("ТОВАР", "MAHSULOT"), t("КОД", "KOD"), t("ПО УЧЁТУ", "HISOBDA"), t("ПОСЧИТАНО", "HISOBLANDI"), t("РАЗНИЦА", "FARQ")].map((h, i) => (
                <th key={i} style={{ ...thStyle, textAlign: i < 2 ? "left" : "right" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {visible.map(it => {
                const diff = it.counted == null ? null : Number(it.counted) - Number(it.expected);
                return (
                  <tr key={it.id} className="row-hover" data-testid={`count-row-${it.productId}`}>
                    <td style={tdStyle}>{it.productName}</td>
                    <td style={{ ...tdStyle, color: COLORS.textTertiary, fontSize: 12 }}>{it.productCode}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatQty(it.expected)}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      {draft ? (
                        <CountedInput value={it.counted} onCommit={v => setCounted.mutate({ id, productId: it.productId, counted: v })} />
                      ) : (it.counted == null ? "—" : formatQty(it.counted))}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: diff == null ? COLORS.textTertiary : diff > 0 ? "var(--color-success-text)" : diff < 0 ? "var(--color-danger-text)" : COLORS.textSecondary }}>
                      {diff == null ? "—" : diff > 0 ? `+${formatQty(diff)}` : formatQty(diff)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {dialog}
    </div>
  );
}

/** Поле «посчитано»: пишется по Enter или уходу с поля; пусто — «не считали». */
function CountedInput({ value, onCommit }: { value: string | null; onCommit: (v: number | null) => void }) {
  const [text, setText] = useState(value == null ? "" : String(Number(value)));
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setText(value == null ? "" : String(Number(value))); }
  const commit = () => {
    const raw = text.trim().replace(",", ".");
    const n = raw === "" ? null : Number(raw);
    if (n !== null && (!Number.isFinite(n) || n < 0)) return;
    if ((n == null && value == null) || (n != null && value != null && Math.abs(n - Number(value)) < 0.005)) return;
    onCommit(n);
  };
  return (
    <input className="neo-input" style={{ width: 96, textAlign: "right", padding: "4px 8px" }} inputMode="decimal" value={text}
      onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit(); } }} />
  );
}
