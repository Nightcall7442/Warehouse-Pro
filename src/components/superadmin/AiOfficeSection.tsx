import { useState } from "react";
import { Bot, ExternalLink, ArrowLeft, PanelsTopLeft } from "lucide-react";
import { F, COLORS } from "./types";
import { Section, Input, BtnPrimary, BtnSecondary } from "./ui";

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
 *
 * ── Два способа открыть ─────────────────────────────────────────────────────
 *
 * «Здесь» — офис встраивается страницей внутрь супер-админки (iframe на всю
 * высоту), «В новой вкладке» — как отдельное окно. Встроенный вариант
 * работает только по https-адресу туннеля: cookie входа в офис требует
 * защищённого соединения, когда её ставят внутри чужого домена.
 */
const KEY = "wp.aiOfficeUrl";

export function readOfficeUrl(): string {
  try { return localStorage.getItem(KEY) || ""; } catch { return ""; }
}

export function AiOfficeSection({ onEmbed }: { onEmbed: (url: string) => void }) {
  const [url, setUrl] = useState(readOfficeUrl);
  const ok = /^https?:\/\/\S+$/.test(url.trim());

  const remember = () => {
    const u = url.trim().replace(/\/+$/, "");
    try { localStorage.setItem(KEY, u); } catch { /* приватное окно — просто откроем */ }
    return u;
  };

  return (
    <Section title="ИИ-офис" icon={Bot}>
      <p style={{ fontFamily: F.body, fontSize: "13px", color: COLORS.textSecondary, marginBottom: "16px", maxWidth: "62ch" }}>
        Виртуальная команда: ревью коммитов, находки, посты в канал, ответы арендаторам.
        Офис запущен на компьютере владельца — вставьте адрес туннеля из <code>start_tunnel.bat</code>
        (или <code>http://127.0.0.1:8123</code>, если вы за этим же компьютером).
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "12px", alignItems: "end" }}>
        <Input label="Адрес офиса" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://xxxx.trycloudflare.com" />
        <BtnPrimary onClick={() => onEmbed(remember())} disabled={!ok} style={{ padding: "10px 18px", fontSize: "13px" }}>
          <PanelsTopLeft size={14} /> Открыть здесь
        </BtnPrimary>
        <BtnSecondary onClick={() => window.open(remember(), "_blank", "noopener")} disabled={!ok} style={{ padding: "10px 18px", fontSize: "13px" }}>
          <ExternalLink size={14} /> В новой вкладке
        </BtnSecondary>
      </div>
    </Section>
  );
}

/** Офис страницей внутри супер-админки: шапка с «Назад», ниже — сам офис на всю высоту. */
export function AiOfficeFrame({ url, onBack }: { url: string; onBack: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", height: "calc(100vh - 120px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <BtnSecondary onClick={onBack} style={{ padding: "8px 14px", fontSize: "12px" }}><ArrowLeft size={13} /> Super Admin</BtnSecondary>
        <span style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 700, color: COLORS.textPrimary }}>ИИ-офис</span>
        <a href={url} target="_blank" rel="noopener" style={{ marginLeft: "auto", fontSize: "12px", color: COLORS.textSecondary }}>{url}</a>
      </div>
      <iframe
        title="ИИ-офис"
        src={url}
        style={{ flex: 1, width: "100%", border: `1px solid ${COLORS.border}`, borderRadius: "14px", background: COLORS.surface }}
        allow="clipboard-write"
      />
    </div>
  );
}
