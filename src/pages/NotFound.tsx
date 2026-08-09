import { Link } from "react-router";
import { SearchX, Home } from "lucide-react";
import { useLang } from "@/i18n";

export default function NotFound() {
  const { t } = useLang();

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
            {t("auth.notFound.title")}
          </h1>
          <p className="text-secondary text-sm mt-2">
            {t("auth.notFound.hint")}
          </p>
        </div>

        <Link
          to="/"
          className="neo-btn-primary w-full flex items-center justify-center gap-2 py-3"
        >
          <Home size={18} />
          {t("auth.notFound.home")}
        </Link>
      </div>
    </div>
  );
}
