import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useCan } from "@/hooks/useCan";
import { useConfirm } from "@/components/ConfirmDialog";
import { PremiumSelect } from "@/components/PremiumSelect";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { AppModal, modalFieldLabel } from "@/components/ui/AppModal";
import { findScanned } from "@/lib/scan-match";
import { notify } from "@/lib/toast";
import { formatQty } from "@/lib/format";
import { useCurrency } from "@/hooks/useCurrency";
import { F, COLORS, thStyle, tdStyle } from "@/components/users/types";
import { format } from "@/lib/business-time";
import { ClipboardList, Plus, ScanLine, Check, X, Send, Undo2 } from "lucide-react";
import { errorText } from "@/lib/error-text";

/**
 * Инвентаризация — документ, а не кнопка по одному товару.
 *
 * Пересчёт был «Скорректировать» на строке: без «ожидалось / посчитано»,
 * без итога недостачи, без одного действия «применить». Здесь: черновик со
 * снимком остатков склада; по каждому товару — что насчитали (поле, сканер
 * или клавиатура-сканер: код + Enter → +1); внизу итог излишков и недостач в
 * штуках и деньгах по себестоимости; «Применить» проводит всё разом через
 * дверь остатка. Непосчитанные строки не трогаются: «не считали» — не «ноль».
 *
 * Считать можно и не весь склад: категорию или выбранные товары. Оператор,
 * которому директор закрыл «проводить без утверждения» (warehouse.apply),
 * вместо «Применить» видит «На утверждение»; директор — «Утвердить» и
 * «Вернуть» с объяснением. Сюда же приходят заявки на ручную правку и
 * начальные остатки из файла: это такие же документы на утверждении.
 */

type Warehouse = { id: number; name: string; isDefault?: boolean | null };
type Translate = (ru: string, uz: string) => string;

/** Статус документа: подпись, цвет текста, фон метки. */
function statusLook(t: Translate): Record<string, [string, string, string]> {
  return {
    draft: [t("черновик", "qoralama"), "var(--color-warning-text)", "color-mix(in srgb, var(--color-warning) 12%, transparent)"],
    submitted: [t("на утверждении", "tasdiqlashda"), "var(--color-info-text)", "var(--color-info-subtle)"],
    applied: [t("применена", "qo'llandi"), "var(--color-success-text)", "color-mix(in srgb, var(--color-success) 12%, transparent)"],
    cancelled: [t("отменена", "bekor qilindi"), "var(--color-text-tertiary)", "var(--color-surface-light)"],
  };
}

/**
 * Учёт, от которого считается разница. У отправленного на утверждение — учёт
 * при отправке: именно разницу от него директор проводит поверх текущего
 * остатка. У черновика — снимок при создании (при отказе учёт отправки
 * стирается, и строка снова считается от снимка). У вернувшейся заявки снимок —
 * учёт в минуту заявки, и разница от него — то самое «списать 2»: она и
 * проводится поверх текущего остатка, сколько бы ни пришло и ни ушло с тех пор.
 */
function baseOf(it: { expected: string; bookAtSubmit: string | null }): number {
  return Number(it.bookAtSubmit ?? it.expected);
}

/** Что это за документ: пересчёт склада, категории, выбранных товаров, заявка на правку, остатки из файла. */
function kindOf(t: Translate, c: { origin?: string | null; adjustType?: string | null; scope?: string | null; scopeCategory?: string | null }): string {
  if (c.origin === "adjust") {
    return c.adjustType === "in" ? t("правка: приход", "tuzatish: kirim")
      : c.adjustType === "out" ? t("правка: списание", "tuzatish: chiqim")
      : t("правка: установить остаток", "tuzatish: qoldiqni o'rnatish");
  }
  if (c.origin === "import") return t("остатки из файла", "fayldagi qoldiqlar");
  if (c.scope === "category") return `${t("категория", "turkum")} «${c.scopeCategory ?? ""}»`;
  if (c.scope === "items") return t("выбранные товары", "tanlangan tovarlar");
  return t("весь склад", "butun ombor");
}

export function StockCounts({ warehouses }: { warehouses: Warehouse[] }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const isDirector = user?.role === "ceo";
  const [openId, setOpenId] = useState<number | null>(null);
  const [warehouseId, setWarehouseId] = useState<string>(String(warehouses.find(w => w.isDefault)?.id ?? warehouses[0]?.id ?? ""));
  // Что считаем: весь склад, одну категорию или выбранные товары.
  const [scope, setScope] = useState<"full" | "category" | "items">("full");
  const [category, setCategory] = useState("");
  const [picked, setPicked] = useState<Array<{ id: number; name: string }>>([]);
  const [search, setSearch] = useState("");

  const listQ = trpc.stockCount.list.useQuery({ limit: 50 });
  const categoriesQ = trpc.product.categories.useQuery(undefined, { enabled: scope === "category" });
  const productsQ = trpc.warehouseMulti.getStock.useQuery(
    { warehouseId: Number(warehouseId) || undefined, search, pageSize: 20 },
    { enabled: scope === "items" && search.trim().length >= 2 },
  );
  const create = trpc.stockCount.create.useMutation({
    onSuccess: (r) => {
      utils.stockCount.list.invalidate(); setOpenId(r.id); setPicked([]); setSearch("");
      notify.success(t(`Черновик ${r.number} создан`, `${r.number} qoralamasi yaratildi`));
    },
    onError: (e) => notify.error(errorText(e)),
  });

  if (openId != null) return <StockCountSheet id={openId} onBack={() => { setOpenId(null); utils.stockCount.list.invalidate(); }} />;

  const STATUS = statusLook(t);
  const rows = listQ.data ?? [];
  const waiting = rows.filter(c => c.status === "submitted").length;
  const ready = scope === "full" || (scope === "category" && !!category) || (scope === "items" && picked.length > 0);
  const found = ((productsQ.data?.data ?? []) as Array<{ productId: number; productName?: string | null; productCode?: string | null }>)
    .filter(p => !picked.some(x => x.id === Number(p.productId)));

  const start = () => create.mutate({
    warehouseId: Number(warehouseId),
    ...(scope === "category" ? { category } : {}),
    ...(scope === "items" ? { productIds: picked.map(p => p.id) } : {}),
  });

  return (
    <div className="space-y-4">
      {waiting > 0 && (
        <div className="neo-card p-4 flex items-center gap-3" data-testid="stock-count-waiting"
          style={{ background: "var(--color-info-subtle)", color: "var(--color-info-text)" }}>
          <Send size={16} />
          <span className="text-sm font-semibold">
            {isDirector
              ? t(`Ждут вашего утверждения: ${waiting}`, `Tasdiqlashingizni kutmoqda: ${waiting}`)
              : t(`На утверждении у руководителя: ${waiting}`, `Rahbar tasdiqlashida: ${waiting}`)}
          </span>
        </div>
      )}

      <div className="neo-card p-5 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          {/* Выбор склада — только когда есть из чего выбирать. */}
          {warehouses.length > 1 && (
            <div className="min-w-[220px]">
              <p className="text-[10px] font-semibold tracking-wider uppercase mb-2" style={{ color: COLORS.textTertiary }}>{t("Склад", "Ombor")}</p>
              <PremiumSelect value={warehouseId} onChange={setWarehouseId} width="100%"
                options={warehouses.map(w => ({ value: String(w.id), label: w.name }))} />
            </div>
          )}
          <div>
            <p className="text-[10px] font-semibold tracking-wider uppercase mb-2" style={{ color: COLORS.textTertiary }}>{t("Что считаем", "Nimani sanaymiz")}</p>
            <div className="range-pills" role="tablist" data-testid="stock-count-scope">
              {([["full", t("Весь склад", "Butun ombor")], ["category", t("Категория", "Turkum")], ["items", t("Выбранные товары", "Tanlangan tovarlar")]] as const).map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={scope === key} onClick={() => setScope(key)}
                  className={"range-pill tap" + (scope === key ? " active" : "")} data-testid={`stock-count-scope-${key}`}>{label}</button>
              ))}
            </div>
          </div>
          {scope === "category" && (
            <div className="min-w-[220px]">
              <p className="text-[10px] font-semibold tracking-wider uppercase mb-2" style={{ color: COLORS.textTertiary }}>{t("Категория", "Turkum")}</p>
              <PremiumSelect value={category} onChange={setCategory} width="100%" placeholder={t("Выберите категорию", "Turkumni tanlang")}
                options={(categoriesQ.data ?? []).map(c => ({ value: c, label: c }))} />
            </div>
          )}
          <button className="neo-btn-primary tap flex items-center gap-2" disabled={!warehouseId || !ready || create.isPending}
            onClick={start} data-testid="stock-count-new">
            <Plus size={16} /> {t("Новая инвентаризация", "Yangi inventarizatsiya")}
          </button>
        </div>

        {scope === "items" && (
          <div className="space-y-2">
            <input className="neo-input" style={{ maxWidth: 360 }} value={search} onChange={e => setSearch(e.target.value)} data-testid="stock-count-item-search"
              placeholder={t("Найти товар: название, код или штрих-код (от 2 знаков)", "Tovarni topish: nomi, kodi yoki shtrix-kodi (2 belgidan)")} />
            {/* Ищем / ничего — словами: пустое место под полем читалось как «поиск не работает». */}
            {search.trim().length >= 2 && productsQ.isFetching && found.length === 0 && (
              <p className="text-xs" style={{ color: COLORS.textTertiary, margin: 0 }} data-testid="stock-count-search-loading">{t("Ищем…", "Qidirilmoqda…")}</p>
            )}
            {search.trim().length >= 2 && !productsQ.isFetching && productsQ.isError && (
              <p className="text-xs" role="alert" style={{ color: "var(--color-danger-text)", margin: 0 }}>{t("Не удалось найти — повторите", "Topib bo'lmadi — qayta urinib ko'ring")}</p>
            )}
            {search.trim().length >= 2 && !productsQ.isFetching && !productsQ.isError && found.length === 0 && (
              <p className="text-xs" style={{ color: COLORS.textTertiary, margin: 0 }} data-testid="stock-count-search-empty">{t("Ничего не нашлось — проверьте название или код", "Hech narsa topilmadi — nomi yoki kodini tekshiring")}</p>
            )}
            {search.trim().length >= 2 && found.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {found.slice(0, 10).map(p => (
                  <button key={p.productId} type="button" className="neo-btn neo-btn-xs tap" data-testid={`stock-count-pick-${p.productId}`}
                    onClick={() => { setPicked(prev => [...prev, { id: Number(p.productId), name: p.productName ?? "" }]); }}>
                    + {p.productName}{p.productCode ? ` · ${p.productCode}` : ""}
                  </button>
                ))}
              </div>
            )}
            {picked.length > 0 && (
              <div className="flex flex-wrap gap-2" data-testid="stock-count-picked">
                {picked.map(p => (
                  <span key={p.id} className="flex items-center gap-1" style={{ padding: "3px 10px", borderRadius: 999, fontSize: 12, background: "var(--color-primary-subtle)", color: "var(--color-primary-text)" }}>
                    {p.name}
                    <button type="button" className="tap" aria-label={t("Убрать", "Olib tashlash")} style={{ border: "none", background: "transparent", color: "inherit", cursor: "pointer", padding: 0 }}
                      onClick={() => setPicked(prev => prev.filter(x => x.id !== p.id))}><X size={12} /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="text-xs" style={{ color: COLORS.textTertiary, margin: 0 }}>
          {t("Черновик снимает остатки склада на этот момент; считать можно несколько дней.", "Qoralama shu paytdagi qoldiqlarni oladi; hisoblash bir necha kun davom etishi mumkin.")}
        </p>
      </div>

      <div className="neo-card overflow-hidden">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead><tr>
              {[t("НОМЕР", "RAQAM"), t("СКЛАД", "OMBOR"), t("ЧТО", "NIMA"), t("СОЗДАНА", "YARATILDI"), t("СТРОК", "QATORLAR"), t("ПОСЧИТАНО", "HISOBLANDI"), t("СТАТУС", "HOLAT"), ""].map((h, i) => (
                <th key={i} style={{ ...thStyle, textAlign: i <= 2 ? "left" : "right" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {rows.map(c => {
                const [label, color, bg] = STATUS[c.status] ?? STATUS.draft;
                return (
                  <tr key={c.id} className="row-hover" data-testid={`stock-count-${c.id}`}>
                    <td style={tdStyle}><span style={{ fontWeight: 700, fontFamily: F.display }}>{c.number}</span></td>
                    <td style={tdStyle}>{c.warehouseName ?? "—"}</td>
                    <td style={{ ...tdStyle, color: COLORS.textSecondary, fontSize: 12 }}>
                      {kindOf(t, c)}
                      {c.status === "draft" && c.reviewNote && (
                        <span style={{ display: "block", color: "var(--color-danger-text)" }}>{t("Возвращено", "Qaytarildi")}: {c.reviewNote}</span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", color: COLORS.textSecondary }}>{format(new Date(c.createdAt), "dd.MM.yyyy HH:mm")}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{c.lines}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{c.counted}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, color, background: bg }}>{label}</span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <button className="neo-btn neo-btn-xs tap" onClick={() => setOpenId(c.id)}>
                        {c.status === "draft" ? t("Продолжить", "Davom etish") : c.status === "submitted" && isDirector ? t("Рассмотреть", "Ko'rib chiqish") : t("Открыть", "Ochish")}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {listQ.data?.length === 0 && (
                <tr><td colSpan={8} style={{ ...tdStyle, textAlign: "center", padding: "40px", color: COLORS.textTertiary }}>
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
  const { user } = useAuth();
  const isDirector = user?.role === "ceo";
  const can = useCan();
  // Без права проводить оператор не применяет, а отправляет директору.
  const canApply = can("warehouse.apply");
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const q = trpc.stockCount.get.useQuery({ id });
  const [search, setSearch] = useState("");
  const [wedge, setWedge] = useState("");
  const [scanning, setScanning] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [onlyDiff, setOnlyDiff] = useState(false);

  const setCounted = trpc.stockCount.setCounted.useMutation({
    onSuccess: () => utils.stockCount.get.invalidate({ id }),
    onError: (e) => notify.error(errorText(e)),
  });
  const apply = trpc.stockCount.applyCount.useMutation({
    onSuccess: (r) => {
      utils.stockCount.get.invalidate({ id }); utils.warehouseMulti.getStock.invalidate();
      notify.success(t(`${r.number} применена: изменено ${r.changed} из ${r.applied}, излишек ${formatQty(r.surplus)}, недостача ${formatQty(r.shortage)}`,
        `${r.number} qo'llandi: ${r.applied} tadan ${r.changed} o'zgardi, ortiqcha ${formatQty(r.surplus)}, kamomad ${formatQty(r.shortage)}`));
    },
    onError: (e) => notify.error(errorText(e)),
  });
  const cancel = trpc.stockCount.cancel.useMutation({
    onSuccess: () => { notify.info(t("Инвентаризация отменена", "Inventarizatsiya bekor qilindi")); onBack(); },
    onError: (e) => notify.error(errorText(e)),
  });
  const submit = trpc.stockCount.submitCount.useMutation({
    onSuccess: (r) => {
      utils.stockCount.get.invalidate({ id }); utils.stockCount.list.invalidate();
      notify.success(t(`${r.number} отправлена руководителю на утверждение`, `${r.number} rahbarga tasdiqlash uchun yuborildi`));
    },
    onError: (e) => notify.error(errorText(e)),
  });
  const approve = trpc.stockCount.approveCount.useMutation({
    onSuccess: (r) => {
      utils.stockCount.get.invalidate({ id }); utils.stockCount.list.invalidate(); utils.warehouseMulti.getStock.invalidate();
      notify.success(t(`${r.number} утверждена: изменено ${r.changed} из ${r.applied}, излишек ${formatQty(r.surplus)}, недостача ${formatQty(r.shortage)}`,
        `${r.number} tasdiqlandi: ${r.applied} tadan ${r.changed} o'zgardi, ortiqcha ${formatQty(r.surplus)}, kamomad ${formatQty(r.shortage)}`));
    },
    onError: (e) => notify.error(errorText(e)),
  });
  const reject = trpc.stockCount.rejectCount.useMutation({
    onSuccess: (r) => {
      setRejecting(false); setRejectNote("");
      utils.stockCount.get.invalidate({ id }); utils.stockCount.list.invalidate();
      notify.info(t(`${r.number} возвращена на доработку`, `${r.number} qayta ishlashga qaytarildi`));
    },
    onError: (e) => notify.error(errorText(e)),
  });

  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const draft = q.data?.status === "draft";
  const submitted = q.data?.status === "submitted";
  // Заявка (правка, остатки из файла) — сдвиг, а не полка: и вернувшаяся
  // черновиком, она проводится разницей поверх текущего остатка.
  const request = !!q.data?.origin && q.data.origin !== "count";
  const showWill = submitted || (draft && request);

  const summary = useMemo(() => {
    let surplusQty = 0, shortageQty = 0, surplusMoney = 0, shortageMoney = 0, counted = 0;
    for (const it of items) {
      if (it.counted == null) continue;
      counted++;
      const diff = Number(it.counted) - baseOf(it);
      const cost = Number(it.costPrice ?? 0);
      if (diff > 0) { surplusQty += diff; surplusMoney += diff * cost; }
      else if (diff < 0) { shortageQty += -diff; shortageMoney += -diff * cost; }
    }
    return { surplusQty, shortageQty, surplusMoney, shortageMoney, counted, total: items.length };
  }, [items]);

  /** Скан или код + Enter: найденной строке +1; незнакомый код — вслух. */
  const scanned = (code: string) => {
    const hit = findScanned(items, code, i => ({ code: i.productCode, barcode: i.barcode, barcodes: i.barcodes }));
    if (!hit) { setLastScanned(t(`Не найден: ${code}`, `Topilmadi: ${code}`)); notify.error(t(`Товар со штрих-кодом ${code} не найден в документе`, `${code} shtrix-kodli mahsulot hujjatda topilmadi`)); return; }
    setCounted.mutate({ id, productId: hit.productId, delta: 1 });
    setLastScanned(hit.productName);
  };

  const visible = items.filter(it => {
    if (search) { const s = search.toLowerCase(); if (!it.productName.toLowerCase().includes(s) && !(it.productCode ?? "").toLowerCase().includes(s)) return false; }
    if (onlyDiff) { if (it.counted == null) return false; if (Math.abs(Number(it.counted) - baseOf(it)) < 0.005) return false; }
    return true;
  });

  const onApply = async () => {
    const money = `${t("Излишек", "Ortiqcha")} ${formatQty(summary.surplusQty)} (${fmt(summary.surplusMoney.toFixed(0))}), ${t("недостача", "kamomad")} ${formatQty(summary.shortageQty)} (${fmt(summary.shortageMoney.toFixed(0))}).`;
    const ok = await confirm({
      title: t("Применить инвентаризацию?", "Inventarizatsiyani qo'llash?"),
      message: request
        ? t(
          `${q.data?.number}: ${money} К текущему остатку прибавится изменение по заявке — «посчитано − ожидалось», сколько бы ни пришло и ни ушло с тех пор. Отменить нельзя.`,
          `${q.data?.number}: ${money} Joriy qoldiqqa so'rov bo'yicha o'zgarish — «sanalgan − kutilgan» qo'shiladi, o'shandan beri qancha kelgan yoki ketganidan qat'i nazar. Bekor qilib bo'lmaydi.`,
        )
        : t(
          `${q.data?.number}: посчитано ${summary.counted} из ${summary.total} строк. ${money} Остатки станут такими, как посчитано; непосчитанные строки не тронутся. Отменить нельзя.`,
          `${q.data?.number}: ${summary.total} qatordan ${summary.counted} hisoblandi. ${money} Qoldiqlar sanalganidek bo'ladi; sanalmagan qatorlarga tegilmaydi. Bekor qilib bo'lmaydi.`,
        ),
      confirmText: t("Применить", "Qo'llash"),
      danger: summary.shortageQty > 0,
    });
    if (ok) apply.mutate({ id });
  };

  const onSubmit = async () => {
    const ok = await confirm({
      title: t("Отправить на утверждение?", "Tasdiqlashga yuborilsinmi?"),
      message: t(
        `${q.data?.number}: посчитано ${summary.counted} из ${summary.total} строк. Руководитель увидит излишек ${formatQty(summary.surplusQty)} и недостачу ${formatQty(summary.shortageQty)}. До его решения остатки не изменятся, а документ нельзя будет править.`,
        `${q.data?.number}: ${summary.total} qatordan ${summary.counted} hisoblandi. Rahbar ortiqcha ${formatQty(summary.surplusQty)} va kamomad ${formatQty(summary.shortageQty)} ni ko'radi. Uning qaroriga qadar qoldiqlar o'zgarmaydi, hujjatni esa tahrirlab bo'lmaydi.`,
      ),
      confirmText: t("Отправить", "Yuborish"),
    });
    if (ok) submit.mutate({ id });
  };

  const onApprove = async () => {
    const ok = await confirm({
      title: t("Утвердить и провести?", "Tasdiqlab o'tkazilsinmi?"),
      message: t(
        `${q.data?.number}: излишек ${formatQty(summary.surplusQty)} (${fmt(summary.surplusMoney.toFixed(0))}), недостача ${formatQty(summary.shortageQty)} (${fmt(summary.shortageMoney.toFixed(0))}). К текущему остатку прибавится разница «посчитано − учёт при отправке»: проданное после отправки останется проданным. Отменить нельзя.`,
        `${q.data?.number}: ortiqcha ${formatQty(summary.surplusQty)} (${fmt(summary.surplusMoney.toFixed(0))}), kamomad ${formatQty(summary.shortageQty)} (${fmt(summary.shortageMoney.toFixed(0))}). Joriy qoldiqqa «sanalgan − yuborilgandagi hisob» farqi qo'shiladi: yuborilgandan keyin sotilgani sotilganligicha qoladi. Bekor qilib bo'lmaydi.`,
      ),
      confirmText: t("Утвердить", "Tasdiqlash"),
      danger: summary.shortageQty > 0,
    });
    if (ok) approve.mutate({ id });
  };

  if (q.isLoading || !q.data) return <div className="neo-card p-8 text-center" style={{ color: COLORS.textTertiary }}>…</div>;

  return (
    <div className="space-y-4">
      {scanning && <BarcodeScanner continuous lastResult={lastScanned} onScan={scanned} onClose={() => setScanning(false)}
        label={t("Сканируйте товары — каждый код прибавляет единицу", "Mahsulotlarni skanerlang — har bir kod bittadan qo'shadi")} />}

      <div className="neo-card p-5 flex flex-wrap items-center gap-3">
        <button className="neo-btn neo-btn-xs tap" onClick={onBack}>← {t("Назад", "Orqaga")}</button>
        <div>
          <p style={{ margin: 0, fontFamily: F.display, fontWeight: 700, fontSize: 16 }}>{q.data.number} · {(statusLook(t)[q.data.status] ?? statusLook(t).draft)[0]}</p>
          <p style={{ margin: 0, fontSize: 12, color: COLORS.textTertiary }}>
            {kindOf(t, q.data)} · {format(new Date(q.data.createdAt), "dd.MM.yyyy HH:mm")}
            {q.data.submittedAt && submitted ? ` · ${t("отправлена", "yuborildi")} ${format(new Date(q.data.submittedAt), "dd.MM.yyyy HH:mm")}` : ""}
            {q.data.appliedAt ? ` · ${t("применена", "qo'llandi")} ${format(new Date(q.data.appliedAt), "dd.MM.yyyy HH:mm")}` : ""}
          </p>
        </div>
        <div className="flex-1" />
        {submitted && !isDirector && (
          <span className="text-xs" style={{ color: "var(--color-info-text)" }}>{t("Ждёт решения руководителя", "Rahbar qarorini kutmoqda")}</span>
        )}
        {submitted && isDirector && (
          <>
            <button className="neo-btn tap flex items-center gap-1" disabled={reject.isPending} onClick={() => setRejecting(true)} data-testid="stock-count-reject">
              <Undo2 size={14} /> {t("Вернуть", "Qaytarish")}
            </button>
            <button className="neo-btn-primary tap flex items-center gap-1" disabled={approve.isPending} onClick={onApprove} data-testid="stock-count-approve">
              <Check size={14} /> {t("Утвердить", "Tasdiqlash")}
            </button>
          </>
        )}
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
            {canApply ? (
              <button className="neo-btn-primary tap flex items-center gap-1" disabled={apply.isPending || summary.counted === 0} onClick={onApply} data-testid="stock-count-apply"><Check size={14} /> {t("Применить", "Qo'llash")}</button>
            ) : (
              <button className="neo-btn-primary tap flex items-center gap-1" disabled={submit.isPending || summary.counted === 0} onClick={onSubmit} data-testid="stock-count-submit"><Send size={14} /> {t("На утверждение", "Tasdiqlashga")}</button>
            )}
          </>
        )}
      </div>

      {draft && q.data.reviewNote && (
        <div className="neo-card p-4 text-sm" data-testid="stock-count-review-note" style={{ background: "var(--color-danger-subtle)", color: "var(--color-danger-text)" }}>
          <b>{t("Руководитель вернул документ", "Rahbar hujjatni qaytardi")}:</b> {q.data.reviewNote}
        </div>
      )}

      {rejecting && (
        <AppModal open onClose={() => setRejecting(false)} dirty={rejectNote.trim() !== ""} maxWidth={480}
          title={t("Вернуть на доработку", "Qayta ishlashga qaytarish")} subtitle={q.data.number}
          footer={<>
            <button type="button" className="neo-btn flex-1" onClick={() => setRejecting(false)}>{t("Отмена", "Bekor")}</button>
            <button type="button" className="neo-btn-primary flex-1" data-testid="stock-count-reject-send"
              disabled={!rejectNote.trim() || reject.isPending} onClick={() => reject.mutate({ id, note: rejectNote.trim() })}>
              {t("Вернуть", "Qaytarish")}
            </button>
          </>}>
          <div>
            <label className={modalFieldLabel}>{t("Что исправить", "Nimani tuzatish kerak")}</label>
            <textarea className="neo-input w-full" rows={3} maxLength={500} value={rejectNote} onChange={e => setRejectNote(e.target.value)} data-testid="stock-count-reject-note"
              placeholder={t("Например: пересчитайте воду на второй полке", "Masalan: ikkinchi tokchadagi suvni qayta sanang")} />
          </div>
          <p className="text-xs" style={{ color: COLORS.textTertiary, margin: 0 }}>
            {request
              ? t("Остатки не изменятся; заявка снова станет черновиком у того, кто её подал. При повторной отправке её изменение перенесётся на учёт той минуты.",
                  "Qoldiqlar o'zgarmaydi; so'rov uni bergan odamda yana qoralama bo'ladi. Qayta yuborilganda uning o'zgarishi o'sha daqiqadagi hisobga o'tkaziladi.")
              : t("Остатки не изменятся; документ снова станет черновиком у того, кто считал.", "Qoldiqlar o'zgarmaydi; hujjat sanagan odamda yana qoralama bo'ladi.")}
          </p>
        </AppModal>
      )}

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
        <input className="neo-input" style={{ maxWidth: 320 }} placeholder={t("Поиск по названию или коду…", "Nomi yoki kodi bo'yicha qidirish…")} data-hotkey-search="" value={search} onChange={e => setSearch(e.target.value)} />
        <label className="flex items-center gap-2 text-sm" style={{ color: COLORS.textSecondary }}>
          <input type="checkbox" checked={onlyDiff} onChange={e => setOnlyDiff(e.target.checked)} /> {t("Только расхождения", "Faqat farqlar")}
        </label>
        <span className="text-xs" style={{ color: COLORS.textTertiary }}>{visible.length} {t("строк", "qator")}</span>
      </div>

      <div className="neo-card overflow-hidden">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead><tr>
              {[t("ТОВАР", "MAHSULOT"), t("КОД", "KOD"), submitted ? t("ПРИ ОТПРАВКЕ", "YUBORILGANDA") : request ? t("ПРИ ЗАЯВКЕ", "SO'ROVDA") : t("ПО УЧЁТУ", "HISOBDA"), t("ПОСЧИТАНО", "HISOBLANDI"), t("РАЗНИЦА", "FARQ"),
                ...(showWill ? [t("СЕЙЧАС → СТАНЕТ", "HOZIR → BO'LADI")] : [])].map((h, i) => (
                <th key={i} style={{ ...thStyle, textAlign: i < 2 ? "left" : "right" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {visible.map(it => {
                const diff = it.counted == null ? null : Number(it.counted) - baseOf(it);
                return (
                  <tr key={it.id} className="row-hover" data-testid={`count-row-${it.productId}`}>
                    <td style={tdStyle}>{it.productName}{it.note && q.data?.origin === "adjust" ? <span style={{ display: "block", fontSize: 11, color: COLORS.textTertiary }}>{it.note}</span> : null}</td>
                    <td style={{ ...tdStyle, color: COLORS.textTertiary, fontSize: 12 }}>{it.productCode}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatQty(baseOf(it))}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      {draft ? (
                        <CountedInput value={it.counted} onCommit={v => setCounted.mutate({ id, productId: it.productId, counted: v })} />
                      ) : (it.counted == null ? "—" : formatQty(it.counted))}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: diff == null ? COLORS.textTertiary : diff > 0 ? "var(--color-success-text)" : diff < 0 ? "var(--color-danger-text)" : COLORS.textSecondary }}>
                      {diff == null ? "—" : diff > 0 ? `+${formatQty(diff)}` : formatQty(diff)}
                    </td>
                    {showWill && (
                      <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", color: COLORS.textSecondary }} data-testid={`count-will-${it.productId}`}>
                        {diff == null ? "—" : `${formatQty(Number(it.current ?? 0))} → ${formatQty(Number(it.current ?? 0) + diff)}`}
                      </td>
                    )}
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
