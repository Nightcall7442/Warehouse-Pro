import { Link } from "react-router";
import { SearchX, Home } from "lucide-react";
import { useTranslate } from "@/i18n";

export default function NotFound() {
  const tr = useTranslate();

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center px-4">
      <div className="neo-card w-full max-w-md p-10 text-center space-y-6">
        <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center"
          style={{ background: "var(--kpi-amber)" }}>
          <SearchX size={28} className="text-white" />
        </div>

        <div>
          <p className="font-data text-5xl font-bold text-primary tracking-tight">404</p>
          <h1 className="font-display text-xl font-bold text-primary tracking-tight mt-2">
            {tr("Страница не найдена", "Sahifa topilmadi")}
          </h1>
          <p className="text-secondary text-sm mt-2">
            {tr("Возможно, она была удалена или адрес введён неверно.", "Ehtimol, u o'chirilgan yoki manzil noto'g'ri kiritilgan.")}
          </p>
        </div>

        <Link
          to="/"
          className="neo-btn-primary w-full flex items-center justify-center gap-2 py-3"
        >
          <Home size={18} />
          {tr("На главную", "Bosh sahifaga")}
        </Link>
      </div>
    </div>
  );
}
