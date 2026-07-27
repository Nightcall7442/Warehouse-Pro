import { useNavigate } from "react-router";
import { useEffect, useState, useMemo } from "react";
import { useTranslate } from "@/i18n";
import { Warehouse, Menu, X } from "lucide-react";
import { cn, NEU, raisedSm, NeuButton } from "./landing-shared";

export default function LandingHeader() {
  const navigate = useNavigate();
  const tr = useTranslate();
  const [scrollY, setScrollY] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const h = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);

  const navLinks = useMemo(
    () => [
      { label: tr("Продукт", "Mahsulot"), href: "#features" },
      { label: tr("Как работает", "Qanday ishlaydi"), href: "#how" },
      { label: tr("Решения", "Yechimlar"), href: "#roles" },
      { label: tr("Отзывы", "Sharhlar"), href: "#testimonials" },
      { label: tr("Цены", "Narxlar"), href: "#pricing" },
    ],
    [tr]
  );

  return (
    <nav
      className={cn(
        "fixed top-0 inset-x-0 z-50 transition-all duration-500",
        scrollY > 20 && "backdrop-blur-sm"
      )}
      style={{ background: scrollY > 20 ? "rgba(242,240,236,0.85)" : "transparent" }}
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", raisedSm)} style={{ background: NEU.bg }}>
            <Warehouse size={16} style={{ color: NEU.accent }} strokeWidth={2.2} />
          </div>
          <span className="font-medium tracking-tight text-[15px]">Warehouse Pro</span>
        </div>

        <div className="hidden md:flex items-center gap-0.5">
          {navLinks.map(item => (
            <a
              key={item.label}
              href={item.href}
              className="px-3.5 py-2 text-[13px] rounded-lg transition-colors duration-200"
              style={{ color: NEU.textSecondary }}
            >
              {item.label}
            </a>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          <button
            onClick={() => navigate("/login")}
            className="text-[13px] px-3 py-2 rounded-lg font-medium"
            style={{ color: NEU.textSecondary }}
          >
            {tr("Войти", "Kirish")}
          </button>
          <NeuButton onClick={() => navigate("/register")} className="h-9 px-5">
            {tr("Начать", "Boshlash")}
          </NeuButton>
        </div>

        <button
          className={cn("md:hidden w-9 h-9 rounded-lg flex items-center justify-center", raisedSm)}
          style={{ background: NEU.bg }}
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      <div
        className={cn("md:hidden transition-all duration-400 overflow-hidden", mobileMenuOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0")}
        style={{ background: "rgba(242,240,236,0.97)" }}
      >
        <div className="px-6 pb-6 space-y-1">
          {navLinks.map(item => (
            <a
              key={item.label}
              href={item.href}
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2.5 text-sm rounded-lg"
              style={{ color: NEU.textSecondary }}
            >
              {item.label}
            </a>
          ))}
          <div className="pt-2 flex gap-2">
            <NeuButton variant="inset" onClick={() => navigate("/login")} className="flex-1 h-10">{tr("Войти", "Kirish")}</NeuButton>
            <NeuButton onClick={() => navigate("/register")} className="flex-1 h-10">{tr("Начать", "Boshlash")}</NeuButton>
          </div>
        </div>
      </div>
    </nav>
  );
}
