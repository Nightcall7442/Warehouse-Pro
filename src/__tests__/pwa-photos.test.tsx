// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { PhotoOrIcon } from "../components/PhotoOrIcon";

/**
 * Фотографии товаров в PWA.
 *
 * ── Жалоба ──────────────────────────────────────────────────────────────────
 *
 * «В PWA картинки товаров не грузятся»: в каталоге агента на месте снимков
 * стояли синие квадратики с вопросом — знак поломанной картинки в Safari.
 *
 * Причина оказалась не в связи. Столбец photo_url пишется четырьмя местами, а
 * проверялось одно; импорт из Excel клал в него содержимое колонки «фото» без
 * единой проверки, а стоит там обычно не картинка: имя файла из папки, откуда
 * собирали прайс, или ссылка по http. Дальше это значение отдавалось списку
 * как есть и доезжало до тега img — имя достраивалось до адреса текущей
 * страницы и давало 404, http молча блокировала политика безопасности.
 *
 * ── Что проверяется здесь ───────────────────────────────────────────────────
 *
 * Экранная половина: не открывшаяся картинка обязана выглядеть как «фото нет»,
 * а не как поломка, и ни один экран не должен рисовать хранимый снимок голым
 * тегом img в обход этой защиты. Серверная половина — в
 * api/__tests__/photo-value-reaches-screen.test.ts.
 *
 * Отдельно — служебный работник PWA: он перехватывает запросы страницы, и
 * достаточно одного правила кэширования поверх /api/photos, чтобы снимки
 * перестали открываться уже по другой причине.
 */

afterEach(cleanup);

const SRC = join(__dirname, "..");
const ROOT = join(SRC, "..");

describe("не открывшаяся картинка выглядит как «фото нет»", () => {
  it("картинка показывается, пока открывается", () => {
    render(<PhotoOrIcon src="/api/photos/product/7?v=1" alt="товар" fallback={<span>нет фото</span>} />);

    expect(screen.getByAltText("товар")).toBeTruthy();
    expect(screen.queryByText("нет фото")).toBeNull();
  });

  it("отказ показа заменяется значком, а не знаком поломки", () => {
    render(<PhotoOrIcon src="https://example.invalid/a.jpg" alt="товар" fallback={<span>нет фото</span>} />);

    fireEvent.error(screen.getByAltText("товар"));

    expect(screen.queryByAltText("товар"), "битый img остался на экране").toBeNull();
    expect(screen.getByText("нет фото")).toBeTruthy();
  });

  it("пустое поле сразу даёт значок", () => {
    render(<PhotoOrIcon src={null} fallback={<span>нет фото</span>} />);
    expect(screen.getByText("нет фото")).toBeTruthy();
  });

  it("новая ссылка — новая попытка", () => {
    /*
      Запоминается сама не открывшаяся ссылка, а не признак «не открылось».
      Иначе заменённая оператором фотография осталась бы значком до
      перезагрузки страницы.
    */
    const { rerender } = render(
      <PhotoOrIcon src="/api/photos/product/7?v=1" alt="товар" fallback={<span>нет фото</span>} />,
    );
    fireEvent.error(screen.getByAltText("товар"));
    expect(screen.getByText("нет фото")).toBeTruthy();

    rerender(<PhotoOrIcon src="/api/photos/product/7?v=2" alt="товар" fallback={<span>нет фото</span>} />);

    expect(screen.getByAltText("товар")).toBeTruthy();
  });

  it("список не тянет все снимки разом", () => {
    // В каталоге две сотни карточек: без отложенной загрузки браузер полез бы
    // за всеми снимками сразу.
    render(<PhotoOrIcon src="/api/photos/product/7" alt="товар" fallback={<span>нет</span>} />);
    expect(screen.getByAltText("товар").getAttribute("loading")).toBe("lazy");
  });

  it("крупный снимок в открытой шторке нужен сразу", () => {
    render(<PhotoOrIcon src="/api/photos/product/7" alt="товар" lazy={false} fallback={<span>нет</span>} />);
    expect(screen.getByAltText("товар").getAttribute("loading")).toBeNull();
  });
});

describe("хранимое фото нигде не рисуется в обход защиты", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name !== "__tests__" && name !== "node_modules") walk(p, out);
      } else if (name.endsWith(".tsx")) out.push(p);
    }
    return out;
  }

  it("ни один экран не подставляет photoUrl прямо в тег img", () => {
    /*
      Здесь проверяется правило, а не одно место: снимки рисуются на восьми
      экранах, и первая же правка «просто добавлю img» вернула бы синий
      квадратик ровно туда, откуда его убрали.

      Локальный предпросмотр только что выбранного файла не в счёт: там строка
      данных или blob, которым неоткуда не открыться.
    */
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/<img[^>]*\bsrc=\{([^}]*)\}/g)) {
        const expr = m[1];
        if (/photoUrl|photo\.url|\.photo\b/.test(expr)) {
          offenders.push(`${relative(SRC, file)}: src={${expr.trim().slice(0, 50)}}`);
        }
      }
    }
    expect(
      offenders,
      "хранимое фото рисуется голым img — не открывшись, оно станет знаком поломки:\n" +
      offenders.map(o => "  " + o).join("\n"),
    ).toEqual([]);
  });

  it("PhotoOrIcon стоит там, где раньше стоял голый img", () => {
    // Иначе правило выше прошло бы вхолостую на коде, где снимков нет вовсе.
    const users = walk(SRC).filter(f => /PhotoOrIcon/.test(readFileSync(f, "utf8")));
    expect(users.length, "PhotoOrIcon нигде не используется").toBeGreaterThanOrEqual(6);
  });
});

describe("служебный работник PWA не трогает выдачу снимков", () => {
  const vite = readFileSync(join(ROOT, "vite.config.ts"), "utf8");

  it("запросы к /api не подменяются оболочкой приложения", () => {
    /*
      navigateFallback отдаёт index.html вместо ненайденного адреса. Для
      картинки это означало бы html вместо изображения — то есть тот же самый
      синий квадратик, но уже по вине служебного работника.
    */
    expect(vite).toMatch(/navigateFallbackDenylist:\s*\[\/\^\\\/api\\\//);
  });

  it("на /api/photos нет правила кэширования", () => {
    /*
      Снимок отдаётся под куку сессии и с заголовком private. Положить такой
      ответ в общий кэш служебного работника значило бы показать чужую
      фотографию следующему, кто откроет приложение на этом устройстве, — и
      сломать выдачу первым же протухшим ответом.
    */
    const at = vite.indexOf("runtimeCaching");
    const runtime = vite.slice(at, vite.indexOf("]", at));
    // Сначала убеждаемся, что раздел вообще найден: иначе правило ниже
    // проходило бы на пустой строке и не значило бы ничего.
    expect(at, "раздел runtimeCaching не найден — правило ниже пустое").toBeGreaterThan(0);
    expect(runtime).toMatch(/urlPattern/);
    expect(runtime).not.toMatch(/photos/);
  });
});
