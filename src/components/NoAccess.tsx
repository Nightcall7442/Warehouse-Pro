import { useNavigate } from "react-router";
import { ShieldOff } from "lucide-react";
import { useLang } from "@/i18n";

/**
 * «Этот раздел не для вашей роли».
 *
 * Раньше RoleGuard молча уводил на главную. Для того, кто пришёл по ссылке из
 * сообщения или по закладке, это выглядело поломкой: нажал — и оказался не
 * там, без единого слова почему. Сказать причину дешевле, чем принимать
 * вопрос «почему меня выкидывает».
 *
 * Кнопка ведёт на «/», а не на конкретный экран: корень сам разводит по ролям
 * (src/pages/Home.tsx), и знать этот список здесь незачем.
 */
export function NoAccess() {
  const navigate = useNavigate();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);

  return (
    <div className="neo-card" style={{
      padding: "48px 24px", textAlign: "center",
      display: "flex", flexDirection: "column", alignItems: "center", gap: "12px",
    }}>
      <ShieldOff size={32} style={{ color: "var(--color-text-tertiary)" }} />
      <h1 className="font-display text-lg font-bold text-primary" style={{ margin: 0 }}>
        {t("Этот раздел не для вашей роли", "Bu bo'lim sizning lavozimingiz uchun emas")}
      </h1>
      <p style={{ margin: 0, fontSize: "13px", color: "var(--color-text-tertiary)", maxWidth: "420px" }}>
        {t("Доступ к разделам определяет руководитель. Если он нужен для работы — попросите его открыть.",
           "Bo'limlarga ruxsatni rahbar belgilaydi. Ish uchun kerak bo'lsa, ochib berishni so'rang.")}
      </p>
      <button onClick={() => navigate("/", { replace: true })} className="neo-btn-primary tap" style={{ marginTop: "4px" }}>
        {t("На главную", "Bosh sahifaga")}
      </button>
    </div>
  );
}
