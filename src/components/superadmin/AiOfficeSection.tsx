import { useState } from "react";
import { Bot, ExternalLink } from "lucide-react";
import { F, COLORS } from "./types";
import { Section, Input, BtnPrimary } from "./ui";

/**
 * Вход в ИИ-офис из супер-админки.
 *
 * ── Почему адрес хранится в браузере, а не в базе ───────────────────────────
 *
 * Офис живёт на компьютере владельца и открывается наружу туннелем
 * (start_tunnel.bat): адрес у туннеля каждый раз новый и знает его только
 * владелец. Хранить такое на сервере незачем — это личный ярлык, и он лежит
 * в localStorage того браузера, где им пользуются. Вход в сам офис — по его
 * паролю, платформа к нему доступа не даёт и не проверяет.
 */
const KEY = "wp.aiOfficeUrl";

export function AiOfficeSection() {
  const [url, setUrl] = useState(() => {
    try { return localStorage.getItem(KEY) || ""; } catch { return ""; }
  });
  const ok = /^https?:\/\/\S+$/.test(url.trim());

  const open = () => {
    const u = url.trim();
    if (!ok) return;
    try { localStorage.setItem(KEY, u); } catch { /* приватное окно — просто откроем */ }
    window.open(u, "_blank", "noopener");
  };

  return (
    <Section title="ИИ-офис" icon={Bot}>
      <p style={{ fontFamily: F.body, fontSize: "13px", color: COLORS.textSecondary, marginBottom: "16px", maxWidth: "62ch" }}>
        Виртуальная команда: ревью коммитов, находки, посты в канал, ответы арендаторам.
        Офис запущен на компьютере владельца — вставьте адрес туннеля из <code>start_tunnel.bat</code>
        (или <code>http://127.0.0.1:8123</code>, если вы за этим же компьютером).
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "12px", alignItems: "end" }}>
        <Input label="Адрес офиса" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://xxxx.trycloudflare.com" />
        <BtnPrimary onClick={open} disabled={!ok} style={{ padding: "10px 18px", fontSize: "13px" }}>
          <ExternalLink size={14} /> Открыть офис
        </BtnPrimary>
      </div>
    </Section>
  );
}
