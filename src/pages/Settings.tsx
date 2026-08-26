import { useState } from "react";
import type { ReactElement } from "react";
import { useSearchParams } from "react-router";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import {
  User, Bell, Building2, SunMoon, Database, Warehouse, Palette,
} from "lucide-react";
import { ProfileSettings } from "@/components/settings/ProfileSettings";
import { CompanySettings } from "@/components/settings/CompanySettings";
import { WarehouseSettings } from "@/components/settings/WarehouseSettings";
import { TelegramSettings } from "@/components/settings/TelegramSettings";
import { OneCSettings } from "@/components/settings/OneCSettings";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { BrandingSettings } from "@/components/settings/BrandingSettings";
import { SectionHeader } from "@/components/settings/ui";

/**
 * Настройки.
 *
 * ── Что было и почему выглядело дёшево ──────────────────────────────────────
 *
 * Колонка разделов была приподнятой карточкой (.neo-card — радиус 24, тень,
 * подъём при наведении), а карточка контента рядом — плоской панелью (.panel —
 * радиус 12, простая рамка). Две разные поверхности в двадцати пикселях друг
 * от друга читаются как две несвязанные вещи, случайно оказавшиеся рядом;
 * вдобавок колонка меню поднималась при наведении, будто она кликабельна
 * целиком.
 *
 * Заголовок раздела в карточке дословно повторял активный пункт меню слева —
 * то есть слово «Внешний вид» стояло на экране дважды и не сообщало ничего.
 *
 * Контейнер был max-w-3xl: на экране 1280+ страница занимала левую треть, а
 * дальше шла пустота. При этом внутри — форма в две колонки, которой ширины
 * как раз не хватало.
 *
 * ── Как сейчас ──────────────────────────────────────────────────────────────
 *
 * Одна карточка, внутри — рельс разделов и содержимое, разделённые линией.
 * Одна поверхность, один радиус, одна тень. Заголовок раздела объясняет, что
 * именно здесь настраивается. Выбранный раздел попадает в адрес, поэтому
 * ссылку на «Настройки → Брендинг» можно передать, а перезагрузка не
 * возвращает на «Профиль».
 */

type Section = {
  key: string;
  Icon: typeof User;
  titleRu: string; titleUz: string;
  descRu: string;  descUz: string;
  /** Кому раздел показывается. Без поля — всем. */
  roles?: string[];
  Comp: () => ReactElement;
};

const SECTIONS: Section[] = [
  {
    key: "profile", Icon: User,
    titleRu: "Профиль",     titleUz: "Profil",
    descRu: "Ваше имя, контакты и пароль для входа.",
    descUz: "Ismingiz, aloqa ma'lumotlari va kirish paroli.",
    Comp: ProfileSettings,
  },
  {
    key: "company", Icon: Building2, roles: ["ceo", "operator", "superadmin"],
    titleRu: "Компания",    titleUz: "Kompaniya",
    descRu: "Реквизиты организации — они попадают в накладные, счета и печатные формы.",
    descUz: "Tashkilot rekvizitlari — ular hujjatlar va chop etiladigan shakllarga tushadi.",
    Comp: CompanySettings,
  },
  {
    key: "branding", Icon: Palette, roles: ["ceo", "operator", "superadmin"],
    titleRu: "Брендинг",    titleUz: "Brending",
    descRu: "Логотип и цвета, которыми приложение показывается вашим сотрудникам и на экране входа.",
    descUz: "Logotip va ranglar — xodimlaringiz va kirish ekrani shu ko'rinishda ko'radi.",
    Comp: BrandingSettings,
  },
  {
    key: "warehouses", Icon: Warehouse, roles: ["ceo", "operator", "superadmin"],
    titleRu: "Склады",      titleUz: "Omborxonalar",
    descRu: "Склады организации и тот, который подставляется по умолчанию.",
    descUz: "Tashkilot omborxonalari va sukut bo'yicha tanlanadigani.",
    Comp: WarehouseSettings,
  },
  {
    key: "telegram", Icon: Bell,
    titleRu: "Telegram",    titleUz: "Telegram",
    descRu: "Уведомления о заказах, статусах доставки и низких остатках в Telegram.",
    descUz: "Buyurtmalar, yetkazish holati va kam qoldiq haqida Telegram xabarlari.",
    Comp: TelegramSettings,
  },
  {
    key: "onec", Icon: Database, roles: ["ceo", "operator", "superadmin"],
    titleRu: "1С",          titleUz: "1C",
    descRu: "Обмен номенклатурой и заказами с 1С:Предприятие.",
    descUz: "1C:Korxona bilan nomenklatura va buyurtmalar almashinuvi.",
    Comp: OneCSettings,
  },
  {
    key: "appearance", Icon: SunMoon,
    titleRu: "Внешний вид", titleUz: "Ko'rinish",
    descRu: "Тема оформления и язык интерфейса. Настройка личная — на других сотрудников не влияет.",
    descUz: "Mavzu va interfeys tili. Sozlama shaxsiy — boshqa xodimlarga ta'sir qilmaydi.",
    Comp: AppearanceSettings,
  },
];

const DEFAULT_SECTION = "profile";

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const { lang } = useLang();
  const { user } = useAuth();

  // Разделы, доступные этой роли. Показывать пункт, который ведёт в отказ, —
  // худший из вариантов: человек считает, что у него что-то сломалось.
  const sections = SECTIONS.filter(s => !s.roles || s.roles.includes(user?.role ?? ""));
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const fromUrl = params.get("section");
  const [fallback, setFallback] = useState(DEFAULT_SECTION);
  const active = sections.some(s => s.key === fromUrl) ? fromUrl! : fallback;
  const current = sections.find(s => s.key === active) ?? sections[0];
  const Current = current.Comp;

  const select = (key: string) => {
    setFallback(key);
    setParams(prev => {
      const next = new URLSearchParams(prev);
      next.set("section", key);
      return next;
    }, { replace: true });
  };

  return (
    <div className="max-w-5xl mx-auto animate-fade-up">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold text-primary tracking-tight">
          {t("Настройки", "Sozlamalar")}
        </h1>
        <p className="text-sm text-secondary mt-1">
          {t("Организация, оформление и подключения", "Tashkilot, ko'rinish va ulanishlar")}
        </p>
      </header>

      <div className="neo-card neo-card-static p-0 flex flex-col md:flex-row">
        {/* ── Рельс разделов ───────────────────────────────────────────────
            На узком экране — горизонтальная лента с прокруткой: семь пунктов
            в столбик занимали бы весь первый экран телефона. */}
        <nav aria-label={t("Разделы настроек", "Sozlamalar bo'limlari")}
          className="md:w-56 flex-shrink-0 flex md:flex-col gap-1 p-2 overflow-x-auto md:overflow-visible border-b md:border-b-0 md:border-r border-border-subtle">
          {sections.map(s => {
            const Icon = s.Icon;
            const selected = active === s.key;
            return (
              <button key={s.key} onClick={() => select(s.key)}
                aria-current={selected ? "page" : undefined}
                className={`flex items-center gap-2.5 h-10 px-3 rounded-lg text-left text-sm whitespace-nowrap transition-colors flex-shrink-0 md:w-full ${
                  selected
                    ? "font-semibold text-primary"
                    : "font-medium text-secondary hover:text-primary"
                }`}
                style={selected ? { background: "var(--color-primary-subtle, color-mix(in srgb, var(--color-primary) 12%, transparent))" } : undefined}>
                <Icon size={16} className="flex-shrink-0" />
                {lang === "uz" ? s.titleUz : s.titleRu}
              </button>
            );
          })}
        </nav>

        {/* ── Содержимое раздела ─────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 p-6 sm:p-8">
          <SectionHeader
            title={lang === "uz" ? current.titleUz : current.titleRu}
            description={lang === "uz" ? current.descUz : current.descRu}
          />
          <Current />
        </div>
      </div>
    </div>
  );
}
