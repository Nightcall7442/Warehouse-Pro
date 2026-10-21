import { LX, MONO } from "@/components/landing/landing-tokens";

/**
 * «Страница не найдена» — на двух языках сразу.
 *
 * Сервер отдаёт её с кодом 404 на адрес, которого нет ни у сайта, ни у
 * приложения (/nonexistent, /uz/xyz). Раньше на такой адрес приходила
 * оболочка приложения с кодом 200, и поиск считал опечатки страницами.
 *
 * Язык из адреса не узнать (/xyz — чей он?), поэтому оба: русский сверху,
 * узбекский под ним, каждый со своим lang — экранный диктор читает их
 * правильным голосом. Страница — готовый HTML без скрипта (scripts/
 * prerender.mjs вынимает его): здесь нечему оживать, ссылки работают и так.
 */
export default function SiteNotFound() {
  return (
    <main
      data-testid="site-not-found"
      className="min-h-screen flex items-center"
      style={{ background: LX.paper, color: LX.ink }}
    >
      <div className="w-full max-w-[640px] mx-auto px-6 py-16">
        <p className="text-[13px] mb-6" style={{ ...MONO, color: LX.brassText, letterSpacing: "0.08em" }}>404</p>
        <section lang="ru" className="mb-10">
          <h1 className="text-[32px] leading-tight font-extrabold mb-3" style={{ letterSpacing: "-0.03em" }}>
            Такой страницы нет
          </h1>
          <p className="text-[16px] leading-relaxed" style={{ color: LX.inkSoft }}>
            Адрес мог измениться, или в нём опечатка. Начните с главной — оттуда видно всё, что есть на сайте.
          </p>
        </section>
        <section lang="uz" className="mb-10 pt-8" style={{ borderTop: `1px solid ${LX.rule}` }}>
          <h2 className="text-[28px] leading-tight font-extrabold mb-3" style={{ letterSpacing: "-0.03em" }}>
            Bunday sahifa yo'q
          </h2>
          <p className="text-[16px] leading-relaxed" style={{ color: LX.inkSoft }}>
            Manzil o'zgargan yoki unda xato bor. Bosh sahifadan boshlang — saytdagi hamma narsa o'sha yerdan ko'rinadi.
          </p>
        </section>
        <nav className="flex flex-wrap gap-x-6 gap-y-3 text-[15px] font-semibold">
          <a href="/" lang="ru" style={{ color: LX.ink }}>На главную</a>
          <a href="/uz" lang="uz" style={{ color: LX.ink }}>Bosh sahifaga</a>
          <a href="/login" style={{ color: LX.inkSoft }}>Войти · Kirish</a>
        </nav>
      </div>
    </main>
  );
}
