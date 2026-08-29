import { useNavigate } from "react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslate, useLang } from "@/i18n";
import { Menu, X, Send, Phone } from "lucide-react";
import { cn, LX, MONO, CONTACT, tgLink } from "./landing-tokens";

/** Переключатель языка: посетитель-узбек не должен искать его в приложении. */
function LangSwitch({ className }: { className?: string }) {
  const { lang, setLang } = useLang();
  return (
    <div
      className={cn("flex items-center rounded-md overflow-hidden", className)}
      style={{ border: `1px solid ${LX.ruleStrong}` }}
    >
      {(["ru", "uz"] as const).map(l => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          // На касании цель должна быть не меньше 44px: 32×28 попадали мимо
          // пальца, а язык — первое, что переключает узбекоязычный посетитель.
          className="px-3.5 h-11 lg:px-2.5 lg:h-8 text-[11px] uppercase cursor-pointer transition-colors"
          style={{
            ...MONO,
            letterSpacing: "0.08em",
            background: lang === l ? LX.ink : "transparent",
            color: lang === l ? LX.paperOnInk : LX.inkSoft,
          }}
        >
          {l === "ru" ? "Ру" : "Uz"}
        </button>
      ))}
    </div>
  );
}

export default function LandingHeader() {
  const navigate = useNavigate();
  const tr = useTranslate();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 16);
    h();
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);

  const navLinks = useMemo(
    () => [
      { label: tr("Продукт", "Mahsulot"), href: "#features" },
      { label: tr("Как работает", "Qanday ishlaydi"), href: "#how" },
      { label: tr("Роли", "Rollar"), href: "#roles" },
      { label: tr("Цены", "Narxlar"), href: "#pricing" },
    ],
    [tr],
  );

  return (
    <nav
      className={cn("fixed top-0 inset-x-0 z-50 transition-all duration-300 lx-anim", scrolled && "backdrop-blur-md")}
      style={{
        background: scrolled ? "rgba(244,242,237,0.88)" : "transparent",
        borderBottom: `1px solid ${scrolled ? LX.rule : "transparent"}`,
      }}
    >
      <div className="max-w-[1240px] mx-auto px-6 h-16 flex items-center justify-between gap-4">
        {/* Штамп-логотип: моно-литеры в рамке, как оттиск нумератора */}
        <a href="#top" className="flex items-center gap-3 shrink-0">
          <span
            className="w-9 h-9 rounded-[8px] flex items-center justify-center text-[13px] font-medium"
            style={{ ...MONO, border: `1.5px solid ${LX.ink}`, color: LX.ink }}
          >
            WP
          </span>
          <span className="font-bold tracking-tight text-[15px]" style={{ color: LX.ink }}>
            Warehouse Pro
          </span>
        </a>

        <div className="hidden lg:flex items-center gap-1">
          {navLinks.map(item => (
            <a
              key={item.href}
              href={item.href}
              className="px-3.5 py-2 text-[13.5px] rounded-md transition-colors duration-200 hover:bg-[#ece9e2]"
              style={{ color: LX.inkSoft }}
            >
              {item.label}
            </a>
          ))}
        </div>

        <div className="hidden lg:flex items-center gap-2.5">
          <LangSwitch />
          {CONTACT.phone && (
            <a
              href={`tel:${CONTACT.phone.replace(/[^+\d]/g, "")}`}
              className="inline-flex items-center gap-2 px-3 py-2 text-[13px] rounded-md hover:bg-[#ece9e2] transition-colors"
              style={{ ...MONO, color: LX.inkSoft }}
            >
              <Phone size={13} />
              {CONTACT.phone}
            </a>
          )}
          {tgLink() && (
            <a
              href={tgLink()!}
              target="_blank"
              rel="noreferrer"
              aria-label="Telegram"
              className="w-9 h-9 rounded-md flex items-center justify-center hover:bg-[#ece9e2] transition-colors"
              style={{ border: `1px solid ${LX.ruleStrong}`, color: LX.ink }}
            >
              <Send size={15} />
            </a>
          )}
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="text-[13.5px] px-3.5 py-2 rounded-md font-medium cursor-pointer hover:bg-[#ece9e2] transition-colors"
            style={{ color: LX.ink }}
          >
            {tr("Войти", "Kirish")}
          </button>
          <button
            type="button"
            onClick={() => navigate("/register")}
            className="h-10 px-5 rounded-[9px] text-[13.5px] font-semibold cursor-pointer transition-all duration-200 hover:-translate-y-px"
            style={{ background: LX.ink, color: LX.paperOnInk }}
          >
            {tr("Начать", "Boshlash")}
          </button>
        </div>

        <div className="lg:hidden flex items-center gap-2.5">
        <LangSwitch />
        <button
          type="button"
          aria-label={open ? tr("Закрыть меню", "Menyuni yopish") : tr("Открыть меню", "Menyuni ochish")}
          className="lg:hidden w-11 h-11 rounded-md flex items-center justify-center cursor-pointer"
          style={{ border: `1px solid ${LX.ruleStrong}`, color: LX.ink }}
          onClick={() => setOpen(!open)}
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
        </div>
      </div>

      {/*
        inert на закрытом меню обязателен: max-h-0 + overflow-hidden прячет
        его только визуально. Пять ссылок и две кнопки оставались в порядке
        обхода табом — фокус уезжал за пределы экрана, а Enter на невидимой
        «Начать» неожиданно уводил на регистрацию.
      */}
      <div
        inert={!open}
        className={cn("lg:hidden overflow-hidden transition-all duration-300 lx-anim", open ? "max-h-[420px]" : "max-h-0")}
        style={{ background: "rgba(244,242,237,0.97)", borderBottom: open ? `1px solid ${LX.rule}` : "none" }}
      >
        <div className="px-6 pb-6 pt-2 space-y-1">
          {navLinks.map(item => (
            <a
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="block px-3 py-2.5 text-[14px] rounded-md"
              style={{ color: LX.inkSoft }}
            >
              {item.label}
            </a>
          ))}
          <div className="pt-3 flex gap-2.5">
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="flex-1 h-11 rounded-[9px] text-[14px] font-medium cursor-pointer"
              style={{ border: `1px solid ${LX.ruleStrong}`, color: LX.ink }}
            >
              {tr("Войти", "Kirish")}
            </button>
            <button
              type="button"
              onClick={() => navigate("/register")}
              className="flex-1 h-11 rounded-[9px] text-[14px] font-semibold cursor-pointer"
              style={{ background: LX.ink, color: LX.paperOnInk }}
            >
              {tr("Начать", "Boshlash")}
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
