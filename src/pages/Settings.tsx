import { useState } from "react";
import { useLang } from "@/i18n";
import {
  User, Bell, Building2, Moon, Database, Warehouse, Palette,
} from "lucide-react";
import { ProfileSettings } from "@/components/settings/ProfileSettings";
import { CompanySettings } from "@/components/settings/CompanySettings";
import { WarehouseSettings } from "@/components/settings/WarehouseSettings";
import { TelegramSettings } from "@/components/settings/TelegramSettings";
import { OneCSettings } from "@/components/settings/OneCSettings";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { BrandingSettings } from "@/components/settings/BrandingSettings";

const SECTIONS = [
  { key: "profile",    iconRu: "Профиль",    iconUz: "Profil",        Icon: User,      Comp: ProfileSettings    },
  { key: "company",    iconRu: "Компания",   iconUz: "Kompaniya",     Icon: Building2, Comp: CompanySettings    },
  { key: "branding",   iconRu: "Брендинг",   iconUz: "Brending",     Icon: Palette,   Comp: BrandingSettings   },
  { key: "warehouses", iconRu: "Склады",     iconUz: "Omborxona",     Icon: Warehouse, Comp: WarehouseSettings  },
  { key: "telegram",   iconRu: "Telegram",   iconUz: "Telegram",      Icon: Bell,      Comp: TelegramSettings   },
  { key: "onec",       iconRu: "1С",         iconUz: "1C",            Icon: Database,  Comp: OneCSettings       },
  { key: "appearance", iconRu: "Внешний вид",iconUz: "Ko'rinish",     Icon: Moon,      Comp: AppearanceSettings },
];

export default function Settings() {
  const [active, setActive] = useState("profile");
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const Current = SECTIONS.find(s => s.key === active)?.Comp ?? ProfileSettings;

  return (
    <div className="max-w-3xl mx-auto animate-fade-up">
      <h1 className="font-display text-2xl font-bold text-primary tracking-tight mb-5">{t("Настройки", "Sozlamalar")}</h1>

      <div className="flex flex-col sm:flex-row gap-5">
        {/* Боковое меню */}
        <nav className="sm:w-44 flex-shrink-0">
          <div className="neo-card p-2 flex sm:flex-col gap-1">
            {SECTIONS.map(s => {
              const Icon = s.Icon;
              return (
                <button key={s.key} onClick={() => setActive(s.key)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-sm font-medium transition-all w-full ${
                    active === s.key
                      ? "bg-primary/10 text-primary"
                      : "text-secondary hover:text-primary hover:bg-surface-light"
                  }`}>
                  <Icon size={15} />
                  <span className="hidden sm:inline">{lang === "uz" ? s.iconUz : s.iconRu}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Контент */}
        <div className="flex-1 panel p-5 min-h-[300px]">
          <h2 className="font-display text-base text-primary mb-5">
            {lang === "uz"
              ? SECTIONS.find(s => s.key === active)?.iconUz
              : SECTIONS.find(s => s.key === active)?.iconRu}
          </h2>
          <Current />
        </div>
      </div>
    </div>
  );
}
