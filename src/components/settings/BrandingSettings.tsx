import { useState, useRef } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { compressImage, LOGO_LIMITS, FAVICON_LIMITS } from "@/lib/compress-image";
import { Upload, RotateCcw } from "lucide-react";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { colorMix } from "@/lib/color-mix";
import { derivePalette, CARD, PREVIEW, type Theme } from "@/lib/brand-palette";
import { FieldGroup, Field, FieldRow, SaveBar } from "./ui";

/**
 * Брендинг: логотип, цвета, тексты.
 *
 * ── Почему раздел выглядел хуже остальных ───────────────────────────────────
 *
 * Он был собран из трёх карточек .neo-card p-5, вложенных в карточку страницы,
 * а внутри них лежал ещё один тон — ряды цветов. Четыре уровня поверхности, и
 * четвёртый по фону совпадал с первым: глубина не читалась вовсе, просто рябь.
 *
 * Ряд цвета при этом получал 256 пикселей ширины, из которых 172 занимала
 * несжимаемая фурнитура — образец, поле hex и отступы. На название и описание
 * оставалось 84: отсюда и «крошечные образцы», и переносы посреди строки.
 * Один и тот же hex выводился в строке ДВАЖДЫ — в неизменяемом <code> и в поле
 * ввода рядом.
 *
 * Предпросмотр был зажат в ту же колонку (визитка на пол-экрана) и нарисован
 * дефолтной тенью Tailwind — в тёмной теме она не видна вовсе, потому что
 * рассчитана на белый фон.
 *
 * Кнопка «Сохранить» красилась градиентом из выбранных цветов с белым текстом:
 * стоило выбрать светлый основной цвет, и надпись пропадала. Теперь текст
 * подбирается по яркости фона (lib/contrast.ts), а сама кнопка — обычная
 * системная: сохранение не должно менять вид в зависимости от настройки,
 * которую сохраняет.
 */

/*
  Имени компании здесь нет намеренно.

  Оно стояло и тут, и в разделе «Компания» — и печать берёт его ОТТУДА,
  вместе с ИНН, адресом и банком. Заполнив имя здесь, арендатор менял
  строку, которую не читает никто, а накладная оставалась прежней.

  Домена тут тоже нет: разбора домена в запрос не существует, и поле
  ничего бы не изменило.
*/
const DEFAULTS = {
  primaryColor: "#5b6d8a",
  secondaryColor: "#4a5c78",
  appName: "Warehouse Pro",
  logoUrl: "",
  faviconUrl: "",
  loginTitle: "",
  loginSubtitle: "",
  footerText: "",
  supportEmail: "",
  supportPhone: "",
};

export function BrandingSettings() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const logoRef = useRef<HTMLInputElement>(null);
  const faviconRef = useRef<HTMLInputElement>(null);

  const { data: branding, isLoading, isLoadingError, refetch } = trpc.branding.get.useQuery();
  const utils = trpc.useUtils();
  const [form, setForm] = useState<typeof DEFAULTS | null>(null);

  if (!isLoading && branding && !form) {
    setForm({
      // Пусто — «цвет решает тема»; подставлять стандартный нельзя: он ушёл бы в базу как выбор.
      primaryColor: branding.primaryColor ?? "",
      secondaryColor: branding.secondaryColor ?? "",
      appName: branding.appName ?? DEFAULTS.appName,
      logoUrl: branding.logoUrl ?? "",
      faviconUrl: branding.faviconUrl ?? "",
      loginTitle: branding.loginTitle ?? "",
      loginSubtitle: branding.loginSubtitle ?? "",
      footerText: branding.footerText ?? "",
      supportEmail: branding.supportEmail ?? "",
      supportPhone: branding.supportPhone ?? "",
    });
  }

  /*
    Вторичный цвет больше не выбирают: он выводится из основного (наведение
    светлой темы) и уходит в базу только ради старых читателей поля. Пустой
    основной — пустой вторичный: бренд снят целиком.
  */
  const withDerived = (f: typeof DEFAULTS) => ({ ...f, secondaryColor: f.primaryColor ? (derivePalette(f.primaryColor, "light")?.hover ?? "") : "" });
  const saveMutation = trpc.branding.update.useMutation({
    onSuccess: () => {
      utils.branding.get.invalidate();
      notify.success(t("Брендинг сохранён", "Brending saqlandi"));
    },
    onError: (e) => notify.error(e.message),
  });

  /*
    Знак и значок ужимаются под столбец: оба лежат строкой data:… в TEXT,
    это 65 535 байт. Раньше сюда клался результат общего сжатия — до
    семисот тысяч знаков; такая строка не помещалась в базу, а значок с
    его прежним пределом в 500 знаков заодно ронял ВЕСЬ запрос, вместе с
    цветами. Второй довод за малый размер: бренд приезжает с каждой
    загрузкой приложения, и лишние полмегабайта платит каждый сотрудник.
  */
  // Те же пределы, что и во вкладке «Компания»: столбец один и тот же по
  // устройству, и знать про него два окна по-разному уже стоило нам
  // несохранённых реквизитов.
  const IMAGE_LIMITS = { logoUrl: LOGO_LIMITS, faviconUrl: FAVICON_LIMITS };

  const handleImage = async (e: React.ChangeEvent<HTMLInputElement>, field: "logoUrl" | "faviconUrl", maxMb: number) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > maxMb * 1024 * 1024) { notify.error(t(`Макс. ${maxMb} МБ`, `Maks. ${maxMb} MB`)); return; }
    try {
      const compressed = await compressImage(file, IMAGE_LIMITS[field]);
      setForm(f => f ? { ...f, [field]: compressed } : f);
    } catch { notify.error(t("Ошибка обработки", "Qayta ishlash xatosi")); }
  };

  if (isLoadingError) return <QueryErrorFallback onRetry={refetch} />;
  if (isLoading || !form) return <div className="h-48 bg-surface-light animate-pulse rounded-2xl" />;

  const p = form.primaryColor;
  const set = (key: keyof typeof DEFAULTS) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(v => v ? { ...v, [key]: e.target.value } : v);
  const brand = p || DEFAULTS.primaryColor;
  const PAL: Record<Theme, ReturnType<typeof derivePalette>> = { light: derivePalette(brand, "light"), dark: derivePalette(brand, "dark") };

  return (
    <div>
      {/* ── Логотип и favicon ─────────────────────────────────────────────── */}
      <FieldGroup first title={t("Логотип", "Logotip")}>
        <div className="flex flex-wrap items-start gap-8">
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => logoRef.current?.click()}
              aria-label={t("Загрузить логотип", "Logotipni yuklash")}
              className="w-20 h-20 rounded-2xl flex items-center justify-center overflow-hidden"
              style={{ border: "2px dashed var(--color-primary-muted)", background: "var(--color-primary-subtle)" }}>
              {form.logoUrl
                ? <img src={form.logoUrl} alt="" className="w-full h-full object-contain p-1" />
                : <Upload size={20} style={{ color: "var(--color-primary-text)" }} />}
            </button>
            <div>
              <button type="button" onClick={() => logoRef.current?.click()} className="neo-btn">
                <Upload size={14} />{form.logoUrl ? t("Заменить", "Almashtirish") : t("Логотип", "Logotip")}
              </button>
              <p className="text-xs text-tertiary mt-1.5">PNG, JPG · {t("до 5 МБ", "5 MB gacha")}</p>
            </div>
            <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={e => handleImage(e, "logoUrl", 5)} />
          </div>

          <div className="flex items-center gap-4">
            <button type="button" onClick={() => faviconRef.current?.click()}
              aria-label={t("Загрузить favicon", "Favicon yuklash")}
              className="w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden"
              style={{ border: "2px dashed var(--color-border)", background: "var(--color-surface-light)" }}>
              {form.faviconUrl
                ? <img src={form.faviconUrl} alt="" className="w-full h-full object-contain p-0.5" />
                : <Upload size={14} className="text-tertiary" />}
            </button>
            <div>
              <button type="button" onClick={() => faviconRef.current?.click()} className="neo-btn neo-btn-sm">
                <Upload size={12} />Favicon
              </button>
              <p className="text-xs text-tertiary mt-1.5">ICO, PNG · 32×32</p>
            </div>
            <input ref={faviconRef} type="file" accept="image/*,.ico" className="hidden" onChange={e => handleImage(e, "faviconUrl", 1)} />
          </div>
        </div>
      </FieldGroup>

      {/* ── Цвет ──────────────────────────────────────────────────────────── */}
      <FieldGroup title={t("Фирменный цвет", "Firma rangi")}>
        <div className="flex items-start justify-between gap-4 flex-wrap mb-4 -mt-2">
          <p className="text-sm text-secondary max-w-prose">
            {t("Один цвет — оттенок фирмы. Кнопки, ссылки, активные пункты меню и наведение приложение подбирает само, отдельно под светлую и тёмную тему: тон ваш, светлота — под фон.",
               "Bitta rang — firma ohangi. Tugmalar, havolalar, faol menyu va hover ranglarini ilova o'zi tanlaydi — yorug' va qorong'i mavzu uchun alohida: ohang sizniki, yorqinlik — fonga mos.")}
          </p>
          {/*
            Возврат к стандартным СНИМАЕТ цвет, а не вписывает светлый: пустое
            значение приложение понимает как «цвет решает таблица стилей» — у
            неё он объявлен и для светлой темы, и для тёмной.
          */}
          <button type="button"
            onClick={() => setForm(f => f ? { ...f, primaryColor: "", secondaryColor: "" } : f)}
            className="neo-btn neo-btn-sm">
            <RotateCcw size={12} />{t("Вернуть стандартные", "Standartga qaytarish")}
          </button>
        </div>

        <div className="grid gap-5 grid-cols-1 xl:grid-cols-[minmax(280px,360px)_1fr]">
          <div className="flex items-center gap-4 p-3 rounded-xl self-start" style={{ background: "var(--color-surface-light)" }}>
            {/* Поле выбора цвета не умеет быть пустым — без значения браузер
                показывает чёрный. Пустая форма показывает стандартный цвет,
                но в базу уходит пустота. */}
            <input type="color" value={brand} onChange={set("primaryColor")}
              aria-label={t("Фирменный цвет", "Firma rangi")}
              className="w-14 h-14 rounded-xl cursor-pointer flex-shrink-0"
              style={{ border: "1px solid var(--color-border)" }} data-testid="brand-color" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-primary">{t("Оттенок", "Ohang")}</p>
              <p className="text-xs text-tertiary mt-0.5">{p ? t("Свой цвет", "O'z rangingiz") : t("Стандартный: цвет темы", "Standart: mavzu rangi")}</p>
            </div>
            <input className="neo-input font-data w-28 text-center flex-shrink-0"
              aria-label={t("Фирменный цвет — HEX", "Firma rangi — HEX")}
              value={form.primaryColor} onChange={set("primaryColor")} placeholder={DEFAULTS.primaryColor} />
          </div>

          {/* Предпросмотр: обе темы, настоящими производными цветами — то, что увидят сотрудники. */}
          <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(260px,1fr))]" data-testid="brand-preview">
            {(["light", "dark"] as Theme[]).map(theme => {
              const pal = PAL[theme];
              if (!pal) return null;
              const { bg, ink, sub } = PREVIEW[theme];
              return (
                <div key={theme} className="rounded-2xl overflow-hidden" style={{ background: bg, border: `1px solid ${colorMix(pal.primary, 18)}`, boxShadow: "var(--shadow-raised)" }}>
                  <div className="px-4 py-2.5 flex items-center justify-between" style={{ background: CARD[theme], borderBottom: `1px solid ${colorMix(ink, 10)}` }}>
                    <div className="flex items-center gap-2 min-w-0">
                      {form.logoUrl
                        ? <img src={form.logoUrl} alt="" className="w-5 h-5 rounded object-contain" />
                        : <div className="w-5 h-5 rounded" style={{ background: pal.primary }} />}
                      <span className="text-sm font-semibold truncate" style={{ color: ink }}>{form.appName || "Warehouse Pro"}</span>
                    </div>
                    <span style={{ fontSize: "10px", letterSpacing: "0.08em", textTransform: "uppercase", color: sub }}>{theme === "light" ? t("Светлая", "Yorug'") : t("Тёмная", "Qorong'i")}</span>
                  </div>
                  <div className="p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-lg text-xs font-semibold" style={{ background: pal.subtle, color: pal.text }}>{t("Заказы", "Buyurtmalar")}</span>
                      <span className="px-2.5 py-1 rounded-lg text-xs" style={{ color: sub }}>{t("Склад", "Ombor")}</span>
                      <span className="px-2.5 py-1 rounded-lg text-xs" style={{ color: sub }}>{t("Касса", "Kassa")}</span>
                    </div>
                    <div className="rounded-xl p-3" style={{ background: CARD[theme] }}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold" style={{ color: ink }}>{t("Магазин «Альфа»", "«Alfa» do'koni")}</span>
                        <span className="text-xs font-semibold" style={{ color: pal.text }}>{t("Директор", "Direktor")}</span>
                      </div>
                      <p className="text-xs mt-1" style={{ color: sub }}>{t("Долг 1 250 000 · ", "Qarz 1 250 000 · ")}<span style={{ color: pal.text, textDecoration: "underline" }}>{t("акт сверки", "solishtirish dalolatnomasi")}</span></p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" className="flex-1 h-9 rounded-xl text-xs font-semibold" style={{ background: pal.primary, color: pal.onPrimary }}>{t("Создать заказ", "Buyurtma yaratish")}</button>
                      <button type="button" className="flex-1 h-9 rounded-xl text-xs font-semibold" style={{ border: `1px solid ${pal.muted}`, color: pal.text, background: pal.subtle }}>{t("Отмена", "Bekor qilish")}</button>
                    </div>
                    <div className="flex gap-1.5" aria-hidden>
                      {[pal.primary, pal.hover, pal.active, pal.text, pal.muted].map((c, i) => <div key={i} className="h-3 flex-1 rounded-full" style={{ background: c }} title={c} />)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </FieldGroup>

      {/* ── Тексты ────────────────────────────────────────────────────────── */}
      <FieldGroup title={t("Тексты и контакты", "Matnlar va kontaktlar")}>
        <p className="text-sm text-secondary max-w-prose mb-4 -mt-2">
          {t("Контакты поддержки видны внизу меню — там их ищут, когда что-то не работает. Текст в подвале печатается на накладных и счетах и стоит на экране входа.",
             "Qo'llab-quvvatlash kontaktlari menyu pastida ko'rinadi. Pastki matn hujjatlarda va kirish ekranida chiqadi.")}
        </p>
        <FieldRow>
          <Field label={t("Название приложения", "Ilova nomi")}>
            <input className="neo-input" value={form.appName} onChange={set("appName")} placeholder="Warehouse Pro" />
          </Field>
          <Field label={t("Заголовок на входе", "Kirish sarlavhasi")}>
            <input className="neo-input" value={form.loginTitle} onChange={set("loginTitle")} placeholder={t("Добро пожаловать", "Xush kelibsiz")} />
          </Field>
          <Field label={t("Подзаголовок на входе", "Kirish taglavhasi")}>
            <input className="neo-input" value={form.loginSubtitle} onChange={set("loginSubtitle")} placeholder={t("Войдите в систему", "Tizimga kiring")} />
          </Field>
          <Field label={t("Email поддержки", "Qo'llab-quvvatlash email")}>
            <input className="neo-input" type="email" value={form.supportEmail} onChange={set("supportEmail")} placeholder="support@company.com" />
          </Field>
          <Field label={t("Телефон поддержки", "Qo'llab-quvvatlash telefoni")}>
            <input className="neo-input font-data" type="tel" value={form.supportPhone} onChange={set("supportPhone")} placeholder="+998 XX XXX XX XX" />
          </Field>
        </FieldRow>
        <div className="mt-4 max-w-md">
          <Field label={t("Текст в подвале", "Pastki matn")}>
            <input className="neo-input" value={form.footerText} onChange={set("footerText")} placeholder="© 2026 Company Name" />
          </Field>
        </div>
      </FieldGroup>

      <SaveBar
        onSave={() => saveMutation.mutate(withDerived(form))}
        isPending={saveMutation.isPending}
        label={t("Сохранить", "Saqlash")}
        hint={t("Изменения увидят все сотрудники организации", "O'zgarishlarni tashkilotning barcha xodimlari ko'radi")}
      />
    </div>
  );
}
