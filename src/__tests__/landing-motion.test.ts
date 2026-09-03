// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startLandingMotion } from "@/lib/landing-motion";

/**
 * Слой движения лендинга.
 *
 * ── Что здесь важнее анимации ────────────────────────────────────────────────
 *
 * Проверяется не красота, а два обещания, нарушение которых ломает страницу
 * молча:
 *
 * 1. НИЧЕГО НЕ ПРЯЧЕТСЯ СТИЛЯМИ. Начальное состояние выставляется из
 *    сценария. Если сценарий не выполнится — текст остаётся видимым. Стоит
 *    перенести сокрытие в CSS, и одна ошибка сборки покажет посетителю пустой
 *    лист; поймать это глазами невозможно, потому что в разработке скрипт
 *    выполняется всегда.
 * 2. УБОРКА ОБЯЗАТЕЛЬНА. Наблюдатели пересечений переживают уход со
 *    страницы, если их не отключить, и продолжают держать узлы. На SPA это
 *    утечка, которая накапливается за сеанс.
 *
 * Плюс поведение «уменьшить движение»: при нём не анимируется и НЕ ПРЯЧЕТСЯ
 * ничего — страница просто стоит.
 */

type Cb = (entries: Array<{ isIntersecting: boolean; target: Element }>) => void;

/** Наблюдатель, которым можно управлять из теста. */
class FakeIO {
  static live: FakeIO[] = [];
  cb: Cb;
  observed = new Set<Element>();
  disconnected = false;
  constructor(cb: Cb) { this.cb = cb; FakeIO.live.push(this); }
  observe(el: Element) { this.observed.add(el); }
  unobserve(el: Element) { this.observed.delete(el); }
  disconnect() { this.disconnected = true; this.observed.clear(); }
  takeRecords() { return []; }
  /** Впустить элементы в поле зрения. */
  fire(els: Element[]) { this.cb(els.map(target => ({ isIntersecting: true, target }))); }
  fireAll() { this.fire([...this.observed]); }
}

function setReduced(matches: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches, media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
}

beforeEach(() => {
  FakeIO.live = [];
  vi.stubGlobal("IntersectionObserver", FakeIO);
  setReduced(false);
  document.body.innerHTML = "";
});
afterEach(() => vi.unstubAllGlobals());

const root = (html: string) => {
  document.body.innerHTML = `<div id="root">${html}</div>`;
  return document.getElementById("root") as HTMLElement;
};

describe("движение: ничего не прячется стилями", () => {
  it("сокрытие ставится из сценария, а не из разметки", () => {
    const r = root(`<p data-reveal="a">текст</p>`);
    const el = r.querySelector("p") as HTMLElement;
    // До запуска элемент видим: в разметке нет ни opacity, ни класса.
    expect(el.style.opacity).toBe("");
    startLandingMotion(r);
    expect(el.style.opacity, "элемент не спрятан — появления не будет").toBe("0");
  });

  it("при «уменьшить движение» не прячется ничего", () => {
    setReduced(true);
    const r = root(`<p data-reveal="a">текст</p><span data-count="1200">1200</span>`);
    startLandingMotion(r);
    const el = r.querySelector("p") as HTMLElement;
    expect(el.style.opacity, "текст спрятан вопреки просьбе убрать движение").toBe("");
    expect(r.querySelector("span")!.textContent, "счётчик обнулил число").toBe("1200");
    expect(FakeIO.live.length, "наблюдатели заведены впустую").toBe(0);
  });
});

describe("движение: появление разделов", () => {
  it("соседи с общим родителем выходят одной волной", () => {
    const r = root(`<div><p data-reveal="x">1</p><p data-reveal="x">2</p><p data-reveal="x">3</p></div>`);
    startLandingMotion(r);
    const ps = Array.from(r.querySelectorAll("p")) as HTMLElement[];
    expect(ps.every(p => p.style.opacity === "0")).toBe(true);

    const io = FakeIO.live.find(o => o.observed.has(ps[0]!))!;
    expect(io, "наблюдатель за появлением не заведён").toBeTruthy();
    io.fire([ps[0]!]);
    // Вошёл один — снялись с наблюдения все трое: волна идёт группой,
    // иначе при быстрой прокрутке соседи всплывают вразнобой.
    expect(io.observed.size).toBe(0);
  });
});

describe("движение: числа", () => {
  it("счётчик обнуляется до появления и не теряет цель", () => {
    const r = root(`<span data-count="200000">200 000</span>`);
    startLandingMotion(r);
    const el = r.querySelector("span") as HTMLElement;
    expect(el.textContent, "число не сброшено — считать будет не с нуля").toBe("0");
    expect(el.dataset.count, "цель счёта потеряна").toBe("200000");
  });
});

describe("движение: линии и печати", () => {
  it("линия готовится к прочерчиванию слева направо", () => {
    const r = root(`<div data-rule="" style="height:2px"></div>`);
    startLandingMotion(r);
    const el = r.querySelector("[data-rule]") as HTMLElement;
    expect(el.style.transform).toMatch(/scaleX\(0\)/);
    expect(el.style.transformOrigin).toContain("0");
  });

  it("печать готовится к оттиску: крупнее и невидима", () => {
    const r = root(`<div data-stamp="">печать</div>`);
    startLandingMotion(r);
    const el = r.querySelector("[data-stamp]") as HTMLElement;
    expect(el.style.opacity).toBe("0");
    expect(el.style.transform).toMatch(/scale\(1\.35\)/);
  });
});

describe("движение: уборка", () => {
  it("все наблюдатели отключаются", () => {
    const r = root(`
      <p data-reveal="a">1</p>
      <span data-count="10">10</span>
      <div data-rule=""></div>
      <div data-stamp="">п</div>
    `);
    const stop = startLandingMotion(r);
    expect(FakeIO.live.length, "ни одного наблюдателя не заведено").toBeGreaterThan(0);
    stop();
    expect(FakeIO.live.every(o => o.disconnected), "наблюдатель пережил уход со страницы").toBe(true);
  });

  it("пустая страница не заводит наблюдателей и не падает", () => {
    const r = root(`<p>без пометок</p>`);
    expect(() => startLandingMotion(r)()).not.toThrow();
    expect(FakeIO.live.length).toBe(0);
  });

  it("отсутствие корня переносится молча", () => {
    expect(() => startLandingMotion(null)()).not.toThrow();
  });
});

describe("движение: первый экран", () => {
  it("заголовок готовится к выходу, разобран он на слова или нет", () => {
    const r = root(`<h1 data-hero-title="">Учёт склада и доставки</h1><p data-hero-step="0">лид</p>`);
    startLandingMotion(r);
    const h1 = r.querySelector("h1") as HTMLElement;

    // Разбор на слова — украшение, а не обещание: в некоторых средах splitText
    // не срабатывает, и в коде на этот случай стоит запасной путь «выйти
    // целиком». Проверяется именно обещание: заголовок так или иначе спрятан
    // и, значит, будет показан сценарием.
    const words = Array.from(h1.querySelectorAll<HTMLElement>("span"));
    const hidden = words.length > 0
      ? words.every(w => w.style.opacity === "0")
      : h1.style.opacity === "0";
    expect(hidden, "заголовок не готов к выходу — движение его пропустит").toBe(true);

    expect((r.querySelector("p") as HTMLElement).style.opacity, "шаг первого экрана не спрятан").toBe("0");
  });
});
