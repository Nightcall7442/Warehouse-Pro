import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, ExternalLink, ShieldCheck, Smartphone } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { copyText } from "@/lib/copy-text";
import { useIsMobile } from "@/hooks/use-mobile";
import { Block, Note, ActionButton, type Msg, type T } from "./profile-ui";
import { errorText } from "@/lib/error-text";

/*
  Вход с кодом из приложения — мастер по шагам.

  ── Что было ─────────────────────────────────────────────────────────────────

  Ключ — в поле только для чтения, без кнопки «Скопировать» и без QR-кода, и
  ссылка «Открыть в приложении на телефоне», про которую непонятно, что она
  сделает. 01.10.2026 владелец на iPhone получил ключ (user.totpSetup прошёл)
  и дальше не продвинулся: user.totpEnable не был вызван ни разу.

  ── Что теперь ──────────────────────────────────────────────────────────────

  Три шага, понятные человеку с телефоном в руке: поставить приложение;
  добавить ключ — кнопкой «Открыть в приложении-аутентификаторе» (на
  телефоне она открывает установленное приложение), кнопкой «Скопировать
  ключ» или QR-кодом (когда настраивают на компьютере, а сканируют
  телефоном); ввести шесть цифр. Ошибка кода объяснена: коды меняются каждые
  30 секунд.

  Выданный ключ помнится до конца сеанса вкладки (sessionStorage): на iPhone
  переход в приложение-аутентификатор может выгрузить сайт из памяти, и
  вернувшийся человек нажал бы «Включить» заново — и получил бы НОВЫЙ ключ, а
  код из приложения перестал бы подходить. Ключ ещё не включён и ничего не
  защищает; после включения или отмены запись стирается.

  QR рисует библиотека qrcode (MIT; та же, что печатает QR в чеках на
  сервере, api/services/receipt.ts), загружается только когда мастер дошёл
  до ключа — вход и остальные экраны её не тянут.
*/

const PENDING_KEY = "wp.totp-pending";
type Setup = { secret: string; url: string };

function readPending(userId: number): Setup | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null") as { userId?: number; secret?: unknown; url?: unknown } | null;
    return p && p.userId === userId && typeof p.secret === "string" && typeof p.url === "string" ? { secret: p.secret, url: p.url } : null;
  } catch { return null; }
}
function writePending(userId: number, setup: Setup | null) {
  try {
    if (setup) sessionStorage.setItem(PENDING_KEY, JSON.stringify({ userId, ...setup }));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch { /* приватный режим — просто не помним */ }
}

/** Ключ группами по четыре знака, по четыре группы в строке: так его сверяют глазами. */
function keyRows(secret: string): string[] {
  const groups = secret.replace(/\s+/g, "").match(/.{1,4}/g) ?? [];
  const rows: string[] = [];
  for (let i = 0; i < groups.length; i += 4) rows.push(groups.slice(i, i + 4).join(" "));
  return rows;
}

export function TotpBlock({ t, role, userId, totpOn }: { t: T; role: string; userId: number; totpOn: boolean }) {
  const utils = trpc.useUtils();
  // Ответ сервера опережает перечитанный auth.me: без этого между «включено»
  // и обновлением профиля мигнула бы кнопка «Включить».
  // Подсказка живёт, пока профиль не перечитан: пришло новое totpOn — верим ему.
  const [override, setOverrideState] = useState<{ value: boolean; base: boolean } | null>(null);
  const setOverride = (value: boolean) => setOverrideState({ value, base: totpOn });
  const on = override && override.base === totpOn ? override.value : totpOn;

  const [setup, setSetupState] = useState<Setup | null>(() => (totpOn ? null : readPending(userId)));
  const setSetup = (s: Setup | null) => { setSetupState(s); writePending(userId, s); };
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [offOpen, setOffOpen] = useState(false);

  const badCode = t("Код неверный или устарел — коды меняются каждые 30 секунд. Введите тот, что сейчас в приложении. Не подходит и он — проверьте, что время на телефоне ставится автоматически.",
                    "Kod noto'g'ri yoki eskirgan — kodlar har 30 soniyada almashadi. Ilovada hozir turganini kiriting. U ham mos kelmasa — telefonda vaqt avtomatik o'rnatilishini tekshiring.");

  const start = trpc.user.totpSetup.useMutation({
    onSuccess: (r) => { setSetup(r); setCode(""); setMsg(null); },
    onError: (e) => { setMsg({ kind: "error", text: errorText(e) }); if (e.data?.code === "PRECONDITION_FAILED") utils.auth.me.invalidate(); },
  });
  const enable = trpc.user.totpEnable.useMutation({
    onSuccess: () => {
      setSetup(null); setCode(""); setOverride(true);
      utils.auth.me.invalidate();
      setMsg({ kind: "ok", text: t("Готово: вход с кодом из приложения включён. При следующем входе, кроме пароля, введите код из приложения.",
                                   "Tayyor: ilova kodi bilan kirish yoqildi. Keyingi kirishda paroldan tashqari ilovadagi kodni kiriting.") });
    },
    onError: (e) => {
      if (e.data?.code === "PRECONDITION_FAILED") {
        setSetup(null);
        setMsg({ kind: "error", text: t("Ключ больше не действует. Нажмите «Включить» и начните заново.", "Kalit endi amal qilmaydi. «Yoqish»ni bosing va qaytadan boshlang.") });
      } else {
        setMsg({ kind: "error", text: e.data?.code === "BAD_REQUEST" ? badCode : errorText(e) });
      }
    },
  });
  const disable = trpc.user.totpDisable.useMutation({
    onSuccess: () => {
      setCode(""); setOverride(false); setOffOpen(false);
      utils.auth.me.invalidate();
      setMsg({ kind: "ok", text: t("Вход с кодом из приложения выключен.", "Ilova kodi bilan kirish o'chirildi.") });
    },
    onError: (e) => setMsg({ kind: "error", text: e.data?.code === "BAD_REQUEST" ? badCode : errorText(e) }),
  });

  const mustHave = role === "ceo" || role === "superadmin";
  const pill = on
    ? <Pill tone="ok" testId="totp-state">{t("Включён", "Yoqilgan")}</Pill>
    : <Pill tone={mustHave ? "warn" : "muted"} testId="totp-state">{t("Выключен", "O'chirilgan")}</Pill>;

  const onCode = (v: string) => { setCode(v.replace(/\D/g, "").slice(0, 6)); setMsg(null); };

  let body: ReactNode;
  if (on) {
    body = (
      <div data-testid="totp-enabled" className="space-y-4">
        <p className="text-secondary max-w-prose" style={{ fontSize: 13, lineHeight: 1.5 }}>
          {t("При входе, кроме пароля, нужен код из приложения-аутентификатора на вашем телефоне.",
             "Kirishda paroldan tashqari telefoningizdagi autentifikator ilovasining kodi kerak.")}
        </p>
        <Note msg={msg} testId="totp-note" />
        {/* Выключение — отдельным шагом: сразу после включения поле кода
            «чтобы выключить» читалось как продолжение мастера. */}
        {offOpen ? (
          <div>
            <label htmlFor="totp-off-code" className="block text-[13px] font-medium text-secondary mb-1.5">
              {t("Чтобы выключить, введите код из приложения", "O'chirish uchun ilovadagi kodni kiriting")}
            </label>
            <div className="flex flex-wrap gap-3 items-center">
              <CodeInput id="totp-off-code" value={code} onChange={onCode} testId="totp-off-code" />
              <ActionButton testId="totp-disable" primary={false} pending={disable.isPending} disabled={code.length < 6}
                onClick={() => disable.mutate({ code })}>
                {t("Выключить", "O'chirish")}
              </ActionButton>
            </div>
            <button type="button" className="text-secondary underline mt-3" style={{ fontSize: 13, minHeight: 44 }}
              onClick={() => { setOffOpen(false); setCode(""); setMsg(null); }}>
              {t("Не выключать", "O'chirmaslik")}
            </button>
          </div>
        ) : (
          <ActionButton testId="totp-disable-open" primary={false} onClick={() => { setOffOpen(true); setMsg(null); }}>
            {t("Выключить…", "O'chirish…")}
          </ActionButton>
        )}
      </div>
    );
  } else if (setup) {
    body = (
      <div data-testid="totp-setup">
        <ol className="space-y-6">
          <Step n={1} title={t("Установите приложение-аутентификатор", "Autentifikator ilovasini o'rnating")}>
            <p className="text-secondary" style={{ fontSize: 13, lineHeight: 1.5 }}>
              {t("Google Authenticator или Microsoft Authenticator — из App Store или Google Play. На iPhone подходит и встроенное приложение «Пароли».",
                 "Google Authenticator yoki Microsoft Authenticator — App Store yoki Google Play'dan. iPhone'da o'rnatilgan «Parollar» ilovasi ham mos keladi.")}
            </p>
          </Step>
          <Step n={2} title={t("Добавьте ключ в приложение", "Kalitni ilovaga qo'shing")}>
            <KeyStep t={t} setup={setup} />
          </Step>
          <Step n={3} title={t("Введите 6 цифр из приложения", "Ilovadagi 6 ta raqamni kiriting")}>
            <div className="flex flex-wrap gap-3 items-center">
              <CodeInput id="totp-code" value={code} onChange={onCode} testId="totp-code"
                label={t("Код из приложения", "Ilovadagi kod")} />
              <ActionButton testId="totp-enable" pending={enable.isPending} disabled={code.length < 6}
                onClick={() => enable.mutate({ code })}>
                {t("Подтвердить и включить", "Tasdiqlash va yoqish")}
              </ActionButton>
            </div>
            <Note msg={msg} testId="totp-note" />
            <button type="button" className="text-secondary underline mt-3" style={{ fontSize: 13, minHeight: 44 }}
              onClick={() => { setSetup(null); setCode(""); setMsg(null); }} data-testid="totp-cancel">
              {t("Отменить", "Bekor qilish")}
            </button>
          </Step>
        </ol>
      </div>
    );
  } else {
    body = (
      <div className="space-y-4">
        <p className="max-w-prose" style={{ fontSize: 13, lineHeight: 1.5, color: mustHave ? "var(--color-warning-text)" : "var(--color-text-secondary)" }} data-testid="totp-why">
          {role === "superadmin"
            ? t("Без кода из приложения подсмотренного пароля хватит, чтобы войти в платформу со всеми организациями. А удалить организацию или очистить обращения без него нельзя вовсе.",
                "Ilova kodisiz ko'rib qolingan parol barcha tashkilotlari bilan platformaga kirish uchun yetadi. Tashkilotni o'chirish yoki murojaatlarni tozalash esa usiz umuman mumkin emas.")
            : role === "ceo"
              ? t("Без кода из приложения подсмотренного пароля хватит, чтобы открыть всю организацию. А выгрузить копию базы и очистить журнал действий без него нельзя.",
                  "Ilova kodisiz ko'rib qolingan parol butun tashkilotni ochish uchun yetadi. Baza nusxasini yuklab olish va harakatlar jurnalini tozalash esa usiz mumkin emas.")
              : t("Дополнительная защита: при входе, кроме пароля, нужен код из приложения на телефоне.",
                  "Qo'shimcha himoya: kirishda paroldan tashqari telefondagi ilova kodi kerak.")}
        </p>
        <ActionButton testId="totp-start" full pending={start.isPending} onClick={() => start.mutate()}>
          {t("Включить", "Yoqish")}
        </ActionButton>
        <Note msg={msg} testId="totp-note" />
      </div>
    );
  }

  return (
    <Block id="totp" icon={ShieldCheck} title={t("Вход с кодом из приложения", "Ilova kodi bilan kirish")} aside={pill}>
      {body}
    </Block>
  );
}

/* ── Шаг 2: ключ ───────────────────────────────────────────────────────── */

function KeyStep({ t, setup }: { t: T; setup: Setup }) {
  // На телефоне «Открыть в приложении» — главное действие шага, на
  // компьютере — запасное: там сканируют QR.
  const phone = useIsMobile();
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const copy = async () => {
    const ok = await copyText(setup.secret);
    setCopied(ok ? "yes" : "no");
    if (ok) setTimeout(() => setCopied(c => (c === "yes" ? null : c)), 4000);
  };

  /*
    На телефоне сверху — «Открыть в приложении»: это одно нажатие. На
    компьютере QR слева, ключ справа: телефоном сканируют экран.
  */
  return (
    <div className="grid grid-cols-1 md:grid-cols-[auto_minmax(0,1fr)] gap-5 md:gap-6">
      <div className="order-3 md:order-1 md:row-span-2">
        <p className="text-secondary mb-2 md:hidden" style={{ fontSize: 13, lineHeight: 1.5 }}>
          {t("Настраиваете на компьютере? Откройте приложение на телефоне, нажмите «+» и наведите камеру на этот код.",
             "Kompyuterda sozlayapsizmi? Telefondagi ilovani oching, «+» ni bosing va kamerani shu kodga qarating.")}
        </p>
        <TotpQr url={setup.url} alt={t("QR-код для приложения-аутентификатора", "Autentifikator ilovasi uchun QR-kod")} />
        <p className="text-secondary mt-2 hidden md:block" style={{ fontSize: 12, lineHeight: 1.45, maxWidth: 192 }}>
          {t("Откройте приложение на телефоне, нажмите «+» и наведите камеру на код.",
             "Telefondagi ilovani oching, «+» ni bosing va kamerani kodga qarating.")}
        </p>
      </div>

      <div className="order-2 md:order-2 min-w-0">
        <p className="text-[13px] font-medium text-secondary mb-1.5">{t("Ключ настройки", "Sozlash kaliti")}</p>
        <div className="rounded-xl px-3 py-3" style={{ background: "var(--color-canvas)", boxShadow: "var(--shadow-pressed), inset 0 0 0 1px var(--color-border)" }}>
          <p data-testid="totp-secret" className="font-mono text-primary text-center"
            style={{ fontSize: 16, fontWeight: 600, letterSpacing: "0.02em", wordSpacing: "0.15em", lineHeight: 1.6, overflowWrap: "anywhere", userSelect: "all", WebkitUserSelect: "all" }}>
            {/* По четыре группы в строке: 32 знака встают ровно в две. */}
            {keyRows(setup.secret).map((row, i, all) => (
              <span key={i} className="block">{row}{i < all.length - 1 ? " " : ""}</span>
            ))}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <ActionButton testId="totp-copy" primary={false} onClick={() => void copy()}>
            {copied === "yes" ? <Check size={16} /> : <Copy size={16} />}
            {copied === "yes" ? t("Скопировано", "Nusxalandi") : t("Скопировать ключ", "Kalitni nusxalash")}
          </ActionButton>
        </div>
        {copied === "no" && (
          <p role="alert" className="mt-2" style={{ fontSize: 13, color: "var(--color-danger-text)" }} data-testid="totp-copy-failed">
            {t("Не получилось скопировать — нажмите на ключ, чтобы выделить его, и скопируйте сами.",
               "Nusxalab bo'lmadi — kalitni belgilash uchun ustiga bosing va o'zingiz nusxalang.")}
          </p>
        )}
        <p className="text-tertiary mt-2" style={{ fontSize: 12, lineHeight: 1.45 }}>
          {t("В приложении выберите «Ввести ключ настройки» и вставьте его. Название — любое, например Warehouse Pro.",
             "Ilovada «Sozlash kalitini kiritish»ni tanlang va uni qo'ying. Nomi — istalgan, masalan Warehouse Pro.")}
        </p>
      </div>

      <div className="order-1 md:order-3 min-w-0">
        <a href={setup.url} data-testid="totp-open-app" className={`${phone ? "neo-btn-primary w-full" : "neo-btn"}`}
          style={{ minHeight: 44, fontSize: 14, whiteSpace: "normal", textAlign: "center", textDecoration: "none" }}>
          {phone ? <ExternalLink size={16} /> : <Smartphone size={16} />}
          {t("Открыть в приложении-аутентификаторе", "Autentifikator ilovasida ochish")}
        </a>
        <p className="text-tertiary mt-2" style={{ fontSize: 12, lineHeight: 1.45 }}>
          {t("На телефоне откроет установленное приложение, и оно само добавит ключ. Вернитесь сюда и введите код. На компьютере удобнее QR-код.",
             "Telefonda o'rnatilgan ilovani ochadi va u kalitni o'zi qo'shadi. Bu yerga qayting va kodni kiriting. Kompyuterda QR-kod qulayroq.")}
        </p>
      </div>
    </div>
  );
}

/**
 * QR-код той же строки otpauth://, что и кнопка «Открыть в приложении».
 * Библиотека грузится здесь, при первом показе, отдельным куском сборки.
 */
export function TotpQr({ url, alt }: { url: string; alt: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void import("qrcode")
      .then(m => (m.default ?? m).toString(url, { type: "svg", margin: 2, errorCorrectionLevel: "M" }))
      .then(s => { if (alive) setSvg(s); })
      .catch(() => { if (alive) setSvg(null); });
    return () => { alive = false; };
  }, [url]);

  // Светлое поле вокруг кода (margin) рисует сама библиотека, и оно светлое
  // в любой теме: тёмные модули на светлом — то, что читают камеры.
  return (
    <div className="rounded-2xl overflow-hidden flex items-center justify-center" style={{ width: 192, height: 192, background: "var(--color-surface-light)", boxShadow: "var(--shadow-sm)" }}>
      {svg
        ? <img data-testid="totp-qr" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt={alt} width={192} height={192} style={{ display: "block" }} />
        : <span className="text-tertiary" style={{ fontSize: 12 }}>…</span>}
    </div>
  );
}

/* ── Мелочи ────────────────────────────────────────────────────────────── */

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3" data-testid={`totp-step-${n}`}>
      <span className="flex items-center justify-center flex-shrink-0 rounded-full font-semibold"
        style={{ width: 28, height: 28, fontSize: 13, background: "var(--color-primary-subtle)", color: "var(--color-primary-text)" }}>{n}</span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-primary" style={{ fontSize: 14, lineHeight: 1.4, paddingTop: 4 }}>{title}</p>
        <div className="mt-1.5">{children}</div>
      </div>
    </li>
  );
}

function CodeInput({ id, value, onChange, testId, label }: { id: string; value: string; onChange: (v: string) => void; testId: string; label?: string }) {
  return (
    <input id={id} className="neo-input font-mono text-center" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*"
      aria-label={label} placeholder="000000" maxLength={6} data-testid={testId}
      style={{ width: 168, fontSize: 20, letterSpacing: "0.25em", minHeight: 48 }}
      value={value} onChange={e => onChange(e.target.value)} />
  );
}

function Pill({ tone, children, testId }: { tone: "ok" | "warn" | "muted"; children: ReactNode; testId: string }) {
  const bg = tone === "ok" ? "var(--color-success-subtle)" : tone === "warn" ? "var(--color-warning-subtle)" : "var(--color-surface-light)";
  const fg = tone === "ok" ? "var(--color-success-text)" : tone === "warn" ? "var(--color-warning-text)" : "var(--color-text-secondary)";
  return <span data-testid={testId} className="rounded-full px-3 py-1 flex-shrink-0 font-semibold" style={{ fontSize: 12, background: bg, color: fg }}>{children}</span>;
}
