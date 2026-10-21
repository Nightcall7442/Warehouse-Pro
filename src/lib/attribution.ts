import { cleanSignupTag } from "@contracts/signup";

/* ═══════════════════════════════════════════════════════════════════════════
   Метки рекламной ссылки — от первого захода на сайт до регистрации и заявки.

   ── Что было ────────────────────────────────────────────────────────────────

   Метки читала только страница регистрации, и только из своего адреса:
   /register?utm_source=… Но реклама ведёт на лендинг (/?utm_source=ig), а
   «Начать бесплатно» уходил на голый /register — метка терялась на первом же
   нажатии. Заявка «перезвоните» меток не несла вовсе. Организаций было
   тринадцать, и откуда пришла хоть одна, не знал никто.

   ── Что делает ──────────────────────────────────────────────────────────────

   · captureAttribution — на входе сайта (лендинг, сравнение, страницы в
     оболочке конкурса) запоминает utm_source, utm_medium, utm_campaign и ref
     в sessionStorage. Первое касание: человек пришёл по рекламе и потом
     походил по ссылкам — источник остаётся тем, по которому он пришёл;
   · withAttribution("/register") — те же метки в адресе ссылки на
     регистрацию: страница регистрации читает их из адреса, как и раньше;
   · readAttribution — для формы заявки и для регистрации, если адрес меток
     не несёт.

   Метки чистятся тем же правилом, что у сервера (cleanSignupTag): в
   хранилище и в адрес — только похожее на метку, до 60 знаков.

   ── Почему sessionStorage ───────────────────────────────────────────────────

   Вкладка — это один заход. Ссылки сайта открываются в той же вкладке
   (landing-tokens, linkProps), поэтому метки доживают до регистрации; а
   завтрашний заход без рекламы не унаследует вчерашнюю кампанию. Хранилище
   бывает закрыто (приватный режим, запрет сайта) — тогда всё молча
   работает без меток: метка не стоит ни одной регистрации.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface Attribution {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  ref?: string;
}

const KEY = "wp-attribution";

/** Параметр адреса ↔ поле. Порядок — тот же, что в строке источника. */
const PARAMS: Array<[param: string, field: keyof Attribution]> = [
  ["utm_source", "utmSource"],
  ["utm_medium", "utmMedium"],
  ["utm_campaign", "utmCampaign"],
  ["ref", "ref"],
];

/** Метки из строки запроса; нет ни одной — null. */
export function attributionFromSearch(search: string): Attribution | null {
  let q: URLSearchParams;
  try { q = new URLSearchParams(search); } catch { return null; }
  const out: Attribution = {};
  for (const [param, field] of PARAMS) {
    const v = cleanSignupTag(q.get(param));
    if (v) out[field] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** Метки, запомненные в этой вкладке; нет или хранилище закрыто — {}. */
export function readAttribution(): Attribution {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Attribution = {};
    for (const [, field] of PARAMS) {
      const v = cleanSignupTag(typeof parsed[field] === "string" ? (parsed[field] as string) : null);
      if (v) out[field] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Запомнить метки из адреса — если в этой вкладке их ещё нет (первое
 * касание). Возвращает то, что теперь запомнено.
 */
export function captureAttribution(search: string = typeof window === "undefined" ? "" : window.location.search): Attribution {
  const have = readAttribution();
  if (Object.keys(have).length) return have;
  const fresh = attributionFromSearch(search);
  if (!fresh) return {};
  try { sessionStorage.setItem(KEY, JSON.stringify(fresh)); } catch { /* закрыто — без меток */ }
  return fresh;
}

/**
 * Свой адрес с запомненными метками: "/register" → "/register?utm_source=ig".
 * Метку, которая в адресе уже стоит, не трогает; якорь сохраняет.
 */
export function withAttribution(path: string): string {
  const a = readAttribution();
  if (!Object.keys(a).length) return path;
  const hashAt = path.indexOf("#");
  const hash = hashAt >= 0 ? path.slice(hashAt) : "";
  const noHash = hashAt >= 0 ? path.slice(0, hashAt) : path;
  const qAt = noHash.indexOf("?");
  const base = qAt >= 0 ? noHash.slice(0, qAt) : noHash;
  const q = new URLSearchParams(qAt >= 0 ? noHash.slice(qAt + 1) : "");
  for (const [param, field] of PARAMS) {
    const v = a[field];
    if (v && !q.has(param)) q.set(param, v);
  }
  const query = q.toString();
  return `${base}${query ? `?${query}` : ""}${hash}`;
}
