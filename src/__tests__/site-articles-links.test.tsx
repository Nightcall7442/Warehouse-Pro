// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { LangProvider } from "@/i18n";
import SiteApp, { type SitePages } from "@/site/SiteApp";
import AgentsArticle from "@/site/articles/AgentsArticle";
import DebtsArticle from "@/site/articles/DebtsArticle";
import ReconciliationArticle from "@/site/articles/ReconciliationArticle";
import DeliveryArticle from "@/site/articles/DeliveryArticle";
import WarehouseArticle from "@/site/articles/WarehouseArticle";
import { ARTICLE_TEXTS } from "@/site/articles/texts";
import { langOfPath } from "@/lib/site-paths";

/**
 * Статья в браузере: язык из адреса, переключатель на парную статью,
 * ссылки «Начать» с метками рекламы и переходы между статьями.
 *
 * ── Что было бы без этого ───────────────────────────────────────────────────
 *
 *   · /uz/shop-debts у человека, когда-то выбравшего русский, открылась бы
 *     по-русски — у адреса было бы два языка;
 *   · «Ру» на узбекской статье переключил бы язык, а адрес остался бы
 *     узбекским;
 *   · «Начать бесплатно» со статьи, на которую пришли по рекламе
 *     (?utm_source=tg), уводил бы на голый /register — источник терялся;
 *   · переход «Ещё по теме» открывал бы следующую статью с середины.
 *
 * Нарочная поломка: убрать UrlLang из ArticleLayout — падает «адрес сильнее
 * выбора»; убрать withAttribution у призыва — «метки рекламы»; убрать
 * ScrollToTop из SiteApp — «с начала».
 */

const leaveSite = vi.hoisted(() => vi.fn());
vi.mock("@/site/leave-site", () => ({ leaveSite }));

const Stub = () => <p>страница</p>;
const PAGES: SitePages = {
  home: Stub, compare: Stub, privacy: Stub,
  agents: AgentsArticle, debts: DebtsArticle, reconciliation: ReconciliationArticle,
  delivery: DeliveryArticle, warehouse: WarehouseArticle,
};

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

function draw(at: string) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <LangProvider>
        <SiteApp pages={PAGES} />
        <Where />
      </LangProvider>
    </MemoryRouter>,
  );
}

const h1 = () => screen.getByRole("heading", { level: 1 }).textContent;
const where = () => screen.getByTestId("where").textContent;

let scrollTo: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  leaveSite.mockClear();
  document.documentElement.lang = "ru";
  scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  scrollTo.mockRestore();
});

describe("язык статьи — из адреса", () => {
  it("langOfPath: /uz и всё под ним — узбекский, остальное — русский", () => {
    expect(langOfPath("/uz")).toBe("uz");
    expect(langOfPath("/uz/shop-debts")).toBe("uz");
    expect(langOfPath("/shop-debts")).toBe("ru");
    expect(langOfPath("/uzum")).toBe("ru");
    expect(langOfPath("/")).toBe("ru");
  });

  it("адрес сильнее выбора: /uz/shop-debts по-узбекски у выбравшего русский, и выбор не перезаписан", () => {
    localStorage.setItem("lang", "ru");
    draw("/uz/shop-debts");
    expect(h1()).toBe(ARTICLE_TEXTS.debts.h1.uz);
    expect(document.documentElement.lang).toBe("uz");
    expect(localStorage.getItem("lang")).toBe("ru");
  });

  it("и наоборот: /shop-debts по-русски у выбравшего узбекский", () => {
    localStorage.setItem("lang", "uz");
    draw("/shop-debts");
    expect(h1()).toBe(ARTICLE_TEXTS.debts.h1.ru);
    expect(document.documentElement.lang).toBe("ru");
    expect(localStorage.getItem("lang")).toBe("uz");
  });

  it("«Ру» на узбекской статье — та же статья по-русски, с теми же метками; выбор сохранён", () => {
    draw("/uz/delivery-cash?utm_source=tg");
    const sw = screen.getByTestId("article-lang-switch");
    expect(sw.getAttribute("href")).toBe("/delivery-cash");
    expect(sw.getAttribute("hreflang")).toBe("ru");
    fireEvent.click(sw);
    expect(where()).toBe("/delivery-cash?utm_source=tg");
    expect(h1()).toBe(ARTICLE_TEXTS.delivery.h1.ru);
    expect(localStorage.getItem("lang")).toBe("ru");
    expect(leaveSite).not.toHaveBeenCalled();
  });
});

describe("призыв и переходы", () => {
  it("метки рекламы из адреса статьи едут в «Начать»: в шапке и в призыве", () => {
    draw("/shop-debts?utm_source=tg&utm_campaign=okt");
    for (const id of ["article-header-register", "article-cta-register"]) {
      expect(screen.getByTestId(id).getAttribute("href")).toBe("/register?utm_source=tg&utm_campaign=okt");
    }
    fireEvent.click(screen.getByTestId("article-cta-register"));
    // Регистрация — в приложении: уход полной загрузкой, метки — в адресе.
    expect(leaveSite).toHaveBeenCalledWith("/register?utm_source=tg&utm_campaign=okt");
  });

  it("демо — на языке статьи", () => {
    draw("/uz/sales-agents");
    expect(screen.getByTestId("article-cta-demo").getAttribute("href")).toBe("/demo?lang=uz");
    cleanup();
    draw("/sales-agents");
    expect(screen.getByTestId("article-cta-demo").getAttribute("href")).toBe("/demo?lang=ru");
  });

  it("«Ещё по теме» — соседняя статья на том же языке, без перезагрузки и с начала", () => {
    draw("/uz/shop-debts");
    scrollTo.mockClear();
    fireEvent.click(screen.getByTestId("article-related-warehouse"));
    expect(where()).toBe("/uz/distributor-warehouse");
    expect(h1()).toBe(ARTICLE_TEXTS.warehouse.h1.uz);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(leaveSite).not.toHaveBeenCalled();
  });

  it("ссылка внутри текста ведёт на статью, о которой говорит", () => {
    draw("/sales-agents");
    const see = screen.getByTestId("article-see-debts");
    expect(see.getAttribute("href")).toBe("/shop-debts");
    fireEvent.click(see);
    expect(h1()).toBe(ARTICLE_TEXTS.debts.h1.ru);
  });

  it("хлебные крошки: главная на языке статьи", () => {
    draw("/uz/reconciliation-act");
    const crumbs = screen.getByRole("navigation", { name: "Navigatsiya yo'li" });
    expect(crumbs.querySelector("a")!.getAttribute("href")).toBe("/uz");
    expect(crumbs.querySelector("[aria-current=page]")!.textContent).toBe("Do'kon bilan solishtirma dalolatnoma");
  });
});
