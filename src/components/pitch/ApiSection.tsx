import { useState } from "react";
import { Check, Copy, Play } from "lucide-react";
import { useLang } from "@/i18n";
import { Chapter, Mono } from "./pitch-ui";
import { API_BASE, API_ENDPOINTS, API_ERRORS, API_SAMPLE_RESPONSE, pick } from "./pitch-content";
import type { DemoStatus } from "./demo-access";

/**
 * API Access — открытый API, как его на самом деле отдаёт api/public-api.ts.
 *
 * Ключ жюри: создание ключей в демо-сессии закрыто (services/pitch-demo.ts),
 * поэтому, если владелец настроил PITCH_DEMO_API_KEY, сервер отдаёт здесь
 * проверенный ключ песочницы — только на чтение (API целиком read-only) и
 * только к выдуманным данным. Кнопка «Запустить» делает тот же запрос, что
 * curl, прямо со страницы.
 */
export default function ApiSection({ status }: { status: DemoStatus | null }) {
  const { lang } = useLang();
  const tr = (uz: string, ru: string) => (lang === "uz" ? uz : ru);
  const key = status?.apiKey ?? null;
  const shownKey = key ?? "wp_test_…";
  const curl = `curl -s "${API_BASE}/orders?created_from=2026-10-01&limit=1" \\\n  -H "Authorization: Bearer ${shownKey}"`;

  return (
    <Chapter
      id="api"
      num="07"
      kicker={tr("Qo'shimcha · API Access", "Дополнительно · API Access")}
      title={tr("Ochiq API", "Открытый API")}
      lead={tr(
        "Distribyutorning boshqa tizimlari — 1C, BI, hamkor ERP — ma'lumotni REST orqali o'qiydi. API faqat o'qish uchun: GET va HEAD dan boshqa har qanday so'rov 405 oladi. Tashkilot kalitdan aniqlanadi, so'rovdan emas.",
        "Другие системы дистрибьютора — 1С, BI, ERP партнёра — читают данные по REST. API только на чтение: любой метод, кроме GET и HEAD, получает 405. Организация определяется по ключу, а не по запросу.",
      )}
    >
      <div className="grid lg:grid-cols-12" style={{ gap: "40px 64px" }}>
        <div className="lg:col-span-5">
          <Mono>{tr("ASOSIY MANZIL", "БАЗОВЫЙ АДРЕС")}</Mono>
          <p className="p-mono" style={{ fontSize: 13.5, margin: "8px 0 28px", wordBreak: "break-all" }}>{API_BASE}</p>

          <Mono>{tr("ENDPOINTLAR", "МАРШРУТЫ")}</Mono>
          <ul data-testid="pitch-api-endpoints" style={{ listStyle: "none", padding: 0, margin: "10px 0 0", borderTop: "1px solid var(--rule-strong)" }}>
            {API_ENDPOINTS.map(e => (
              <li key={e.path} className="p-row" style={{ display: "grid", gridTemplateColumns: "44px minmax(0,1fr)", gap: 12, padding: "13px 0" }}>
                <span className="p-mono" style={{ fontSize: 11, color: "var(--teal)", paddingTop: 2 }}>GET</span>
                <span>
                  <code className="p-mono" data-endpoint={e.path} style={{ fontSize: 13.5, fontWeight: 600 }}>{e.path}</code>
                  <span style={{ display: "block", fontSize: 13.5, color: "var(--soft)", marginTop: 3 }}>{pick(lang, e.d)}</span>
                </span>
              </li>
            ))}
          </ul>

          <div style={{ marginTop: 32 }}>
            <Mono>{tr("CHEGARALAR VA XATOLAR", "ЛИМИТЫ И ОШИБКИ")}</Mono>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--soft)", margin: "10px 0 12px" }}>
              {tr(
                "Chegara — har bir kalit uchun daqiqasiga (standart 100, sandbox kaliti 60). Sahifa: buyurtmalar 100 tadan, ko'pi bilan 200, cursor bilan; qolganlari limit/offset, standart 50, ko'pi bilan 200. Har bir javobda X-Warehouse-Environment: sandbox yoki production.",
                "Лимит — на ключ в минуту (по умолчанию 100, ключ песочницы 60). Страница: заказы по 100, максимум 200, курсором; остальное limit/offset, по умолчанию 50, максимум 200. В каждом ответе X-Warehouse-Environment: sandbox или production.",
              )}
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {API_ERRORS.map(e => (
                <li key={e.code} style={{ display: "grid", gridTemplateColumns: "44px minmax(0,1fr)", gap: 12, padding: "6px 0", fontSize: 13.5 }}>
                  <span className="p-mono" style={{ color: "var(--accent-text)", fontWeight: 600 }}>{e.code}</span>
                  <span style={{ color: "var(--soft)" }}>{pick(lang, e.d)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="lg:col-span-7" style={{ minWidth: 0 }}>
          <Mono>{tr("AUTENTIFIKATSIYA", "АВТОРИЗАЦИЯ")}</Mono>
          <pre className="p-code p-mono" style={{ margin: "10px 0 24px" }}>Authorization: Bearer wp_live_…</pre>

          <Mono>{tr("SO'ROV", "ЗАПРОС")}</Mono>
          <pre className="p-code p-mono" data-testid="pitch-api-curl" style={{ margin: "10px 0 24px", whiteSpace: "pre" }}>{curl}</pre>

          <KeyBox apiKey={key} />

          <Mono>{tr("JAVOB (NAMUNA)", "ОТВЕТ (ОБРАЗЕЦ)")}</Mono>
          <pre className="p-code p-mono" data-testid="pitch-api-sample" style={{ margin: "10px 0 0", maxHeight: 420 }}>{API_SAMPLE_RESPONSE}</pre>
          <p style={{ fontSize: 12.5, color: "var(--faint)", margin: "10px 0 0" }}>
            {tr("Ma'lumotlar namunaviy. To'liq hujjat: docs/public-api-orders.md (GitHub).", "Данные образцовые. Полная документация: docs/public-api-orders.md (GitHub).")}
          </p>
        </div>
      </div>
    </Chapter>
  );
}

/** Как жюри получить ключ — честно, в обоих состояниях. */
function KeyBox({ apiKey }: { apiKey: string | null }) {
  const { lang } = useLang();
  const tr = (uz: string, ru: string) => (lang === "uz" ? uz : ru);
  const [copied, setCopied] = useState(false);
  const [run, setRun] = useState<{ status: number; env: string | null; body: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const execute = async () => {
    if (!apiKey) return;
    setBusy(true);
    try {
      const r = await fetch("/api/v1/orders?limit=1", { headers: { Authorization: `Bearer ${apiKey}` } });
      const text = await r.text();
      let body = text;
      try { body = JSON.stringify(JSON.parse(text), null, 2); } catch { /* не JSON — показать как есть */ }
      setRun({ status: r.status, env: r.headers.get("x-warehouse-environment"), body: body.length > 2400 ? `${body.slice(0, 2400)}\n…` : body });
    } catch {
      setRun({ status: 0, env: null, body: tr("Tarmoq xatosi", "Ошибка сети") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="pitch-api-key" style={{ border: "1px solid var(--rule-strong)", borderRadius: 14, padding: "18px 20px", margin: "0 0 28px", background: "var(--accent-soft)" }}>
      <Mono style={{ color: "var(--accent-text)" }}>{tr("KALITNI QANDAY OLISH MUMKIN", "КАК ПОЛУЧИТЬ КЛЮЧ")}</Mono>
      <p style={{ fontSize: 14, lineHeight: 1.6, margin: "8px 0 0" }}>
        {tr(
          "Haqiqiy tashkilotda kalitni direktor yaratadi: Sozlamalar → API kalitlari. Kalit bir marta ko'rsatiladi, bazada faqat uning xeshi saqlanadi. Demo sessiyada kalit yaratish yopiq — xavfsizlik uchun.",
          "В настоящей организации ключ создаёт директор: Настройки → API-ключи. Ключ показывается один раз, в базе хранится только его хеш. В демо-сессии создание ключей закрыто — ради безопасности.",
        )}
      </p>
      {apiKey ? (
        <>
          <p style={{ fontSize: 14, lineHeight: 1.6, margin: "10px 0 12px" }}>
            {tr("Hakamlar uchun demo tashkilotning kaliti — faqat o'qish, namunaviy ma'lumotlar:", "Для жюри — ключ демо-организации, только чтение, образцовые данные:")}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <code className="p-mono" data-testid="pitch-api-key-value" style={{ fontSize: 12.5, wordBreak: "break-all", flex: "1 1 260px", padding: "10px 12px", borderRadius: 10, background: "var(--panel)", border: "1px solid var(--rule)" }}>{apiKey}</code>
            <button type="button" className="p-btn p-btn-line p-focus p-full-sm" style={{ minHeight: 44, fontSize: 13.5 }}
              onClick={() => { navigator.clipboard?.writeText(apiKey).then(() => setCopied(true)).catch(() => {}); }}>
              {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? tr("Nusxalandi", "Скопирован") : tr("Nusxalash", "Копировать")}
            </button>
            <button type="button" className="p-btn p-btn-solid p-focus p-full-sm" style={{ minHeight: 44, fontSize: 13.5 }} onClick={execute} disabled={busy} data-testid="pitch-api-run">
              <Play size={15} /> {tr("Ishga tushirish", "Запустить")}
            </button>
          </div>
          {run && (
            <div style={{ marginTop: 14 }}>
              <Mono>HTTP {run.status}{run.env ? ` · X-Warehouse-Environment: ${run.env}` : ""}</Mono>
              <pre className="p-code p-mono" data-testid="pitch-api-run-result" style={{ margin: "8px 0 0", maxHeight: 320 }}>{run.body}</pre>
            </div>
          )}
        </>
      ) : (
        <p data-testid="pitch-api-key-missing" style={{ fontSize: 14, lineHeight: 1.6, margin: "10px 0 0", color: "var(--soft)" }}>
          {tr(
            "Hakamlar uchun faqat o'qishga mo'ljallangan demo kalit ulanganda shu yerda paydo bo'ladi. Ungacha so'rov va javob shakli — shu yerdagi namunada.",
            "Ключ только для чтения для жюри появится здесь, когда демо подключат. До тех пор форма запроса и ответа — в образце на этой странице.",
          )}
        </p>
      )}
    </div>
  );
}
