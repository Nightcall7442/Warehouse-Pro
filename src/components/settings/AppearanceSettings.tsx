import { Sun, Moon } from "lucide-react";
import { useLang } from "@/i18n";
import { useTheme } from "@/hooks/useTheme";
import { FieldGroup, Segmented } from "./ui";

/**
 * Внешний вид: тема и язык.
 *
 * ── Две вещи, которые здесь были сломаны ────────────────────────────────────
 *
 * 1. Обе кнопки темы висели на одном и том же toggle. Нажатие на «Светлая»,
 *    когда светлая уже включена, честно переключало на тёмную — то есть
 *    кнопка делала ровно обратное тому, что на ней написано. Теперь каждая
 *    кнопка ставит своё значение.
 *
 * 2. Язык обозначался флагами 🇷🇺 и 🇺🇿. Флаг — это страна, а не язык, и на
 *    Windows флаговые эмодзи вовсе не рисуются: система показывает две буквы,
 *    RU и UZ. То есть на основной платформе пользователей выбор языка выглядел
 *    как опечатка. Теперь — названия языков на них самих.
 */

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  const { lang, setLang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  return (
    <div>
      <FieldGroup first title={t("Тема", "Mavzu")}>
        <Segmented
          ariaLabel={t("Тема оформления", "Mavzu")}
          value={theme}
          onChange={setTheme}
          options={[
            { value: "light", label: t("Светлая", "Yorug'"), Icon: Sun },
            { value: "dark",  label: t("Тёмная",  "To'q"),   Icon: Moon },
          ]}
        />
        <p className="text-xs text-tertiary mt-2">
          {t("Запоминается в этом браузере.", "Ushbu brauzerda eslab qolinadi.")}
        </p>
      </FieldGroup>

      <FieldGroup title={t("Язык интерфейса", "Interfeys tili")}>
        <Segmented
          ariaLabel={t("Язык интерфейса", "Interfeys tili")}
          value={lang}
          onChange={setLang}
          options={[
            { value: "ru", label: "Русский" },
            { value: "uz", label: "O'zbek" },
          ]}
        />
        <p className="text-xs text-tertiary mt-2">
          {t("Меняется сразу, перезагрузка не нужна.", "Darhol o'zgaradi, sahifani yangilash shart emas.")}
        </p>
      </FieldGroup>
    </div>
  );
}
