import { useLang } from "@/i18n";
import { useTheme } from "@/hooks/useTheme";

export function AppearanceSettings() {
  const { theme, toggle } = useTheme();
  const { lang, setLang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  return (
    <div className="space-y-6">
      <div>
        <p className="font-label text-[10px] text-secondary tracking-wider mb-3">{t("ТЕМА","MAVZU")}</p>
        <div className="grid grid-cols-2 gap-3 max-w-xs">
          {[
            { val: "light", labelRu: "☀️ Светлая", labelUz: "☀️ Yorug'" },
            { val: "dark",  labelRu: "🌙 Тёмная",  labelUz: "🌙 To'q"  },
          ].map(opt => (
            <button key={opt.val} onClick={toggle}
              className={`py-3 rounded-xl border text-sm font-medium transition-all ${
                theme === opt.val ? "border-primary bg-primary/10 text-primary" : "border-border-subtle text-secondary hover:border-border-strong"
              }`}>
              {lang === "uz" ? opt.labelUz : opt.labelRu}
            </button>
          ))}
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--color-border, #d8d5cd)", paddingTop: 20 }}>
        <p className="font-label text-[10px] text-secondary tracking-wider mb-3">{t("ЯЗЫК ИНТЕРФЕЙСА","INTERFEYS TILI")}</p>
        <div className="grid grid-cols-2 gap-3 max-w-xs">
          {[
            { val: "ru", label: "🇷🇺 Русский"  },
            { val: "uz", label: "🇺🇿 O'zbek"   },
          ].map(l => (
            <button key={l.val} onClick={() => setLang(l.val as "ru" | "uz")}
              className={`py-3 rounded-xl border text-sm font-medium transition-all ${
                lang === l.val ? "border-primary bg-primary/10 text-primary" : "border-border-subtle text-secondary hover:border-border-strong"
              }`}>
              {l.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
