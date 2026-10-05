/**
 * Карточка ссылки для публичных страниц конкурса — /pitch и /demo.
 *
 * ── Зачем на сервере ────────────────────────────────────────────────────────
 *
 * Приложение одностраничное: на любой адрес сервер отдаёт один index.html, и
 * в нём карточка лендинга по-русски. Telegram, Facebook и поисковик скриптов
 * не выполняют — они читают ровно то, что пришло с сервера. Ссылка на /pitch,
 * отправленная жюри, показала бы чужие заголовок и описание на чужом языке.
 * Поэтому для этих двух адресов сервер подменяет теги в отдаваемой оболочке:
 * заголовок, описание, canonical, og:* и twitter:*, язык документа и
 * короткий текст в #root, который видит робот до загрузки скрипта.
 *
 * Только эти два адреса: у остальных карточка общая и правильная.
 */
export interface PageMeta {
  lang: "uz";
  title: string;
  description: string;
  url: string;
  image: string;
  /** Короткий текст вместо заглушки лендинга в #root — для робота и медленной связи. */
  fallbackHtml: string;
}

const SITE = "https://www.warehouse-pro.uz";
const OG_IMAGE = `${SITE}/pitch/og.jpg`;

export const PUBLIC_PAGES: Record<"/pitch" | "/demo", PageMeta> = {
  "/pitch": {
    lang: "uz",
    title: "Warehouse Pro — distribyutorlar uchun ombor, buyurtma va agentlar tizimi · Pitch Day 3.0",
    description: "O'zbekistondagi FMCG distribyutorlari uchun SaaS: agent buyurtmani telefonda oflayn oladi, qarz har bir buyurtma bo'yicha yuritiladi, ombor partiya va muddatlar bilan, 1C integratsiyasi va ochiq API.",
    url: `${SITE}/pitch`,
    image: OG_IMAGE,
    fallbackHtml:
      "<h1>Warehouse Pro — distribyutorlar uchun ombor, buyurtma va agentlar tizimi</h1>" +
      "<p>Muammo va yechim, jamoa, yo'l xaritasi, amalga oshirish bosqichlari va ochiq API.</p>" +
      "<p><a href=\"/demo\">Demo: video va ishlaydigan prototip</a></p>",
  },
  "/demo": {
    lang: "uz",
    title: "Warehouse Pro — demo: video va ishlaydigan prototip",
    description: "Demo video va namunaviy tashkilotda direktor yoki agent sifatida kirish — parolsiz va ro'yxatdan o'tmasdan.",
    url: `${SITE}/demo`,
    image: OG_IMAGE,
    fallbackHtml:
      "<h1>Warehouse Pro — demo</h1>" +
      "<p>Demo video, uning tavsifi va ishlaydigan prototipga kirish.</p>" +
      "<p><a href=\"/pitch\">Loyiha haqida</a></p>",
  },
};

/** Адрес → карточка; хвостовая косая черта не мешает. */
export function pageMetaFor(path: string): PageMeta | null {
  const p = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return (PUBLIC_PAGES as Record<string, PageMeta>)[p] ?? null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Подставить карточку в оболочку. Тег, которого нет, просто не меняется. */
export function withPageMeta(html: string, m: PageMeta): string {
  const attr = (re: RegExp, value: string) => (s: string) => s.replace(re, (_all, a: string, b: string) => `${a}${esc(value)}${b}`);
  const steps: Array<(s: string) => string> = [
    s => s.replace(/<html lang="[^"]*"/, `<html lang="${m.lang}"`),
    s => s.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(m.title)}</title>`),
    attr(/(<meta name="description" content=")[^"]*(")/, m.description),
    attr(/(<link rel="canonical" href=")[^"]*(")/, m.url),
    attr(/(<meta property="og:url" content=")[^"]*(")/, m.url),
    attr(/(<meta property="og:title" content=")[^"]*(")/, m.title),
    attr(/(<meta property="og:description" content=")[^"]*(")/, m.description),
    attr(/(<meta property="og:image" content=")[^"]*(")/, m.image),
    attr(/(<meta property="og:locale" content=")[^"]*(")/, "uz_UZ"),
    attr(/(<meta property="og:locale:alternate" content=")[^"]*(")/, "ru_RU"),
    attr(/(<meta name="twitter:card" content=")[^"]*(")/, "summary_large_image"),
    attr(/(<meta name="twitter:title" content=")[^"]*(")/, m.title),
    attr(/(<meta name="twitter:description" content=")[^"]*(")/, m.description),
    attr(/(<meta name="twitter:image" content=")[^"]*(")/, m.image),
    // Заглушка #root размечена комментариями в index.html — меняется только она.
    s => s.replace(/<!--root-fallback-->[\s\S]*?<!--\/root-fallback-->/,
      `<!--root-fallback--><div style="max-width:640px;margin:0 auto;padding:64px 24px;font-family:'Manrope',system-ui,sans-serif">${m.fallbackHtml}</div><!--/root-fallback-->`),
  ];
  return steps.reduce((s, f) => f(s), html);
}
