import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { FieldGroup, Segmented, SaveBar } from "./ui";
import { FileText, Rows3, Columns2, Printer } from "lucide-react";
import {
  INVOICE_TEMPLATES, INVOICE_TEMPLATE_LABELS, INVOICE_DEFAULTS, resolveInvoiceOptions,
  type InvoiceOptions, type InvoiceTemplateId,
} from "@contracts/invoice-template";
import { invoicePreviewHtml, sampleInvoiceView } from "@/lib/invoice-templates";
import { useSellerCompany } from "@/hooks/useSellerCompany";

/*
  Накладные — шаблон и галочки.

  Владелец (19.09.2026): «накладные занимают больше места на бумаге и нет
  номера магазинов; сделай настройки, где можно кастомизировать накладные
  полностью, и два-три готовых шаблона». Слева — три карточки шаблонов и
  галочки, справа — живой предпросмотр на вымышленном заказе: каждая галочка
  видна сразу, до печати.

  В базу уходят только отличия от умолчаний шаблона: выбрал «Компактную» и
  ничего не трогал — сохраняется один шаблон, и будущие правки умолчаний
  дойдут до арендатора сами.
*/

type Bool = { [K in keyof InvoiceOptions]: InvoiceOptions[K] extends boolean ? K : never }[keyof InvoiceOptions];

export function InvoiceSettings() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const utils = trpc.useUtils();
  const branding = trpc.branding.get.useQuery();
  const { company, currency } = useSellerCompany();

  const [template, setTemplate] = useState<InvoiceTemplateId | null>(null);
  const [overrides, setOverrides] = useState<Partial<InvoiceOptions> | null | undefined>(undefined);
  // Первое чтение — из базы; дальше форма живёт своей жизнью до «Сохранить».
  const tpl: InvoiceTemplateId = template ?? branding.data?.invoiceTemplate ?? "classic";
  const saved = overrides === undefined ? (branding.data?.invoiceOptions ?? null) : overrides;
  const opts = useMemo(() => resolveInvoiceOptions(tpl, saved), [tpl, saved]);

  const set = <K extends keyof InvoiceOptions>(key: K, value: InvoiceOptions[K]) => {
    // Совпало с умолчанием шаблона — ключ не хранится.
    const next: Partial<InvoiceOptions> = { ...(saved ?? {}) };
    if (INVOICE_DEFAULTS[tpl][key] === value) delete next[key]; else next[key] = value;
    setOverrides(Object.keys(next).length ? next : null);
  };
  const pickTemplate = (id: InvoiceTemplateId) => { setTemplate(id); setOverrides(null); };

  const save = trpc.branding.update.useMutation({
    onSuccess: () => { utils.branding.get.invalidate(); notify.success(t("Накладные сохранены", "Yuk xatlari saqlandi")); },
    onError: e => notify.error(e.message),
  });

  const fallbackName = lang === "uz" ? "Sizning kompaniyangiz" : "Ваша компания";
  const preview = useMemo(
    () => invoicePreviewHtml(sampleInvoiceView({ ...company, name: company.name || fallbackName }, currency), tpl, opts),
    [company, currency, tpl, opts, fallbackName],
  );

  const toggles: Array<{ key: Bool; ru: string; uz: string }> = [
    { key: "showShopPhone",    ru: "Телефон магазина",            uz: "Do'kon telefoni" },
    { key: "showShopAddress",  ru: "Адрес магазина",              uz: "Do'kon manzili" },
    { key: "showAgent",        ru: "Агент",                       uz: "Agent" },
    { key: "showAgentPhone",   ru: "Телефон агента",              uz: "Agent telefoni" },
    { key: "showCourier",      ru: "Курьер",                      uz: "Kuryer" },
    { key: "showPaymentMethod",ru: "Способ оплаты",               uz: "To'lov usuli" },
    { key: "showProductCode",  ru: "Артикул товара",              uz: "Tovar artikuli" },
    { key: "showUnit",         ru: "Единица измерения",           uz: "O'lchov birligi" },
    { key: "showDiscount",     ru: "Строка скидки",               uz: "Chegirma qatori" },
    { key: "showDebt",         ru: "Долг магазина и последняя оплата", uz: "Do'kon qarzi va oxirgi to'lov" },
    { key: "showBarcode",      ru: "Штрих-код номера заказа",     uz: "Buyurtma raqami shtrix-kodi" },
    { key: "showNotes",        ru: "Примечание к заказу",         uz: "Buyurtma izohi" },
    { key: "showSignatures",   ru: "Подписи",                     uz: "Imzolar" },
    { key: "showPrintedAt",    ru: "Дата и время печати",         uz: "Chop etish sanasi va vaqti" },
  ];

  return (
    <div>
      <FieldGroup first title={t("Шаблон", "Shablon")}>
        <p className="text-sm text-secondary max-w-prose -mt-2 mb-4">
          {t("Шаблон печатается из карточки заказа («Документы» → «Расходная накладная») и из пачки в «Заказах» («Накладные»). Галочки ниже — что на нём показывать; справа видно, как это ляжет на бумагу.",
             "Shablon buyurtma kartasidan («Hujjatlar» → «Chiqim nakladnaya») va «Buyurtmalar»dagi to'plamdan («Yuk xatlari») chop etiladi. Quyidagi belgilar — unda nimani ko'rsatish; o'ngda qog'ozga qanday tushishi ko'rinadi.")}
        </p>
        <div role="radiogroup" aria-label={t("Шаблон накладной", "Yuk xati shabloni")} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {INVOICE_TEMPLATES.map(id => {
            const l = INVOICE_TEMPLATE_LABELS[id];
            const selected = id === tpl;
            return (
              <button key={id} type="button" role="radio" aria-checked={selected} onClick={() => pickTemplate(id)} data-testid={`invoice-template-${id}`}
                className="text-left rounded-2xl p-4 transition-all"
                style={{ background: "var(--color-surface)", boxShadow: selected ? "0 0 0 2px var(--color-primary), var(--shadow-sm)" : "var(--shadow-sm)" }}>
                <div className="flex items-center gap-2 mb-1">
                  <FileText size={16} style={{ color: selected ? "var(--color-primary-text)" : "var(--color-text-tertiary)" }} />
                  <span className="text-sm font-semibold text-primary">{lang === "uz" ? l.uz : l.ru}</span>
                </div>
                <p className="text-xs text-secondary" style={{ lineHeight: 1.45 }}>{lang === "uz" ? l.descUz : l.descRu}</p>
              </button>
            );
          })}
        </div>
      </FieldGroup>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-8 mt-8 pt-8 border-t border-border-subtle">
        <div>
          <h3 className="text-sm font-semibold text-primary mb-4">{t("Что печатать", "Nimani chop etish")}</h3>
          <div className="space-y-4">
            <div>
              <p className="text-[13px] font-medium text-secondary mb-1.5">{t("Логотип в шапке", "Sarlavhadagi logotip")}</p>
              <Segmented<InvoiceOptions["logo"]> value={opts.logo} onChange={v => set("logo", v)} ariaLabel={t("Логотип", "Logotip")}
                options={[
                  { value: "none", label: t("Нет", "Yo'q") },
                  { value: "company", label: t("Организации", "Tashkilotniki") },
                  { value: "warehouse-pro", label: "Warehouse Pro" },
                ]} />
              {opts.logo === "company" && !company.logoUrl && (
                <p className="text-xs mt-1.5" style={{ color: "var(--color-warning-text)" }}>{t("Логотип не загружен — «Компания» → «Загрузить логотип». Пока его нет, шапка печатается без знака.", "Logotip yuklanmagan — «Kompaniya» → «Logotip yuklash». U bo'lmaguncha sarlavha belgisiz chop etiladi.")}</p>
              )}
            </div>
            <div>
              <p className="text-[13px] font-medium text-secondary mb-1.5">{t("Экземпляров на листе", "Varaqdagi nusxalar")}</p>
              <Segmented<"1" | "2"> value={String(opts.copies) as "1" | "2"} onChange={v => set("copies", Number(v) as 1 | 2)} ariaLabel={t("Экземпляры", "Nusxalar")}
                options={[{ value: "1", label: t("Один", "Bitta") }, { value: "2", label: t("Два — покупателю и поставщику", "Ikkita — xaridor va yetkazib beruvchiga") }]} />
            </div>
            {opts.copies === 2 && (
              <div>
                <p className="text-[13px] font-medium text-secondary mb-1.5">{t("Расположение экземпляров", "Nusxalar joylashuvi")}</p>
                <Segmented<InvoiceOptions["copiesLayout"]> value={opts.copiesLayout} onChange={v => set("copiesLayout", v)} ariaLabel={t("Расположение", "Joylashuv")}
                  options={[
                    { value: "stack", label: t("Друг под другом", "Ustma-ust"), Icon: Rows3 },
                    { value: "side", label: t("Рядом (альбомный лист)", "Yonma-yon (albom varaq)"), Icon: Columns2 },
                  ]} />
                {opts.copiesLayout === "side" && <p className="text-xs text-tertiary mt-1.5">{t("В окне печати выберите альбомную ориентацию — тогда два экземпляра встанут рядом, как на образце.", "Chop etish oynasida albom yo'nalishini tanlang — shunda ikki nusxa namunadagidek yonma-yon turadi.")}</p>}
              </div>
            )}
            <div>
              <p className="text-[13px] font-medium text-secondary mb-1.5">{t("Размер шрифта", "Shrift o'lchami")}</p>
              <Segmented<InvoiceOptions["fontSize"]> value={opts.fontSize} onChange={v => set("fontSize", v)} ariaLabel={t("Шрифт", "Shrift")}
                options={[{ value: "small", label: t("Мелкий — больше строк на лист", "Mayda — varaqqa ko'proq qator") }, { value: "normal", label: t("Обычный", "Oddiy") }]} />
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-x-5 gap-y-2 pt-2">
              {toggles.map(tg => (
                <label key={tg.key} className="flex items-center gap-2.5 text-sm text-primary cursor-pointer">
                  <input type="checkbox" checked={opts[tg.key]} onChange={e => set(tg.key, e.target.checked)} data-testid={`invoice-${tg.key}`}
                    style={{ width: "16px", height: "16px", accentColor: "var(--color-primary)" }} />
                  <span>{t(tg.ru, tg.uz)}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-primary mb-4 flex items-center gap-2"><Printer size={15} /> {t("Предпросмотр", "Oldindan ko'rish")}</h3>
          <div className="rounded-2xl overflow-hidden" style={{ background: "var(--color-surface-light)", boxShadow: "var(--shadow-pressed)", padding: "12px" }}>
            {/* Вымышленный заказ, не данные арендатора; масштаб — чтобы лист поместился в колонку. */}
            <iframe title={t("Предпросмотр накладной", "Yuk xatini oldindan ko'rish")} srcDoc={preview} data-testid="invoice-preview"
              style={{ width: opts.copies === 2 && opts.copiesLayout === "side" ? "1000px" : "760px", height: opts.copies === 2 && opts.copiesLayout === "side" ? "560px" : "900px", border: "none", background: "var(--color-surface)", transform: "scale(0.62)", transformOrigin: "top left", borderRadius: "8px", display: "block", marginBottom: opts.copies === 2 && opts.copiesLayout === "side" ? "-212px" : "-342px" }} />
          </div>
          <p className="text-xs text-tertiary mt-2">{t("Образец — вымышленный магазин и товары. Реквизиты продавца — из «Компании».", "Namuna — o'ylab topilgan do'kon va tovarlar. Sotuvchi rekvizitlari — «Kompaniya»dan.")}</p>
        </div>
      </div>

      <SaveBar
        onSave={() => save.mutate({ invoiceTemplate: tpl, invoiceOptions: saved })}
        isPending={save.isPending}
        label={t("Сохранить", "Saqlash")}
        hint={t("Применяется ко всем, кто печатает накладные в организации.", "Tashkilotda yuk xatini chop etadigan hammaga qo'llanadi.")}
      />
    </div>
  );
}
