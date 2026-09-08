/**
 * Из поля фотографии на экран уходит только то, что браузер покажет.
 *
 * ── Что случилось ───────────────────────────────────────────────────────────
 *
 * В каталоге агента карточки товаров стояли с не загрузившимися картинками:
 * на iPhone это синий квадратик с вопросом на месте снимка. Выглядело как
 * плохая связь, а было устройством системы.
 *
 * Столбец photo_url пишется четырьмя местами, а проверялось одно — магазин.
 * Импорт из Excel клал в него содержимое колонки «фото» БЕЗ ЕДИНОЙ ПРОВЕРКИ, а
 * стоит там обычно не картинка: имя файла из папки, откуда собирали прайс, или
 * ссылка по http. Дальше photoRef отдавал это значение списку как есть, и оно
 * доезжало до тега img:
 *
 *   · имя файла достраивается до адреса текущей страницы — /orders/new/IMG_0042.jpg,
 *     это 404, а на экране выглядит как не загрузившаяся картинка;
 *   · http блокирует политика безопасности страницы (imgSrc: 'self' data: blob: https:) —
 *     молча, сообщением в консоли.
 *
 * Хранилище в бою не настроено (/health отдаёт s3: "not_configured"), поэтому
 * своя загрузка фото кладёт строку данных в базу и работает — ломались ровно
 * привезённые импортом строки.
 *
 * Правило проверяется по исходникам, а не по базе: ошибка вся в том, ЧТО
 * попадает в столбец и что из него выходит, и живой базы для этого не нужно.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const API = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(API, ...p), "utf8");

const PHOTO_URL = read("lib", "photo-url.ts");
const IMPORT    = read("import-router.ts");

describe("выдача: наружу уходит только показуемое", () => {
  it("photoRef пропускает лишь строку данных и ссылку по https", () => {
    /*
      Последняя ветвь отдавала СОДЕРЖИМОЕ столбца («ELSE ${photoCol}»), то есть
      что угодно. Проверка стоит на выдаче, а не только на входе, потому что в
      базе такие строки уже лежат: правка входа их не исправит.
    */
    expect(PHOTO_URL).toContain("LIKE 'https://%'");
    expect(PHOTO_URL).toMatch(/LIKE 'https:\/\/%' THEN \$\{photoCol\}/);
    expect(PHOTO_URL, "последняя ветвь снова отдаёт столбец как есть")
      .not.toMatch(/ELSE \$\{photoCol\}/);
  });

  it("строка данных по-прежнему уезжает отдельной ручкой, а не телом в списке", () => {
    // Иначе страница каталога снова весила бы мегабайты.
    expect(PHOTO_URL).toContain("LIKE 'data:%'");
  });
});

describe("вход: в поле фотографии не попадает то, что не покажешь", () => {
  /** Сколько раз в файле объявлено поле фотографии на входе ручки. */
  function photoInputs(src: string): string[] {
    return [...src.matchAll(/photoUrl:\s+z\s*\n?\s*\.?string\(\)[\s\S]{0,300}?(?=\n\s{4,6}\w+:|\n\s*\}\))/g)]
      .map(m => m[0]);
  }

  const ROUTERS = ["product-router.ts", "agent-router.ts", "shop-router.ts"] as const;

  it("разбор находит поля — иначе правило проходило бы вхолостую", () => {
    const total = ROUTERS.reduce((n, f) => n + photoInputs(read(f)).length, 0);
    expect(total).toBeGreaterThanOrEqual(4);
  });

  it("каждое поле фотографии проверяется isSafePhotoValue", () => {
    const holes: string[] = [];
    for (const file of ROUTERS) {
      for (const field of photoInputs(read(file))) {
        if (!field.includes("isSafePhotoValue")) {
          holes.push(`${file}: ${field.replace(/\s+/g, " ").slice(0, 90)}`);
        }
      }
    }
    expect(
      holes,
      "поле фотографии принимает что угодно — на экране это будет битая картинка:\n" +
      holes.map(h => "  " + h).join("\n"),
    ).toEqual([]);
  });

  it("импорт из Excel просеивает колонку «фото»", () => {
    expect(IMPORT).toContain("isSafePhotoValue");
    expect(IMPORT).toContain("usablePhoto(row.photoUrl");
    expect(IMPORT, "колонка снова берётся как есть")
      .not.toMatch(/photoUrl:\s*String\(row\.photoUrl/);
  });

  it("картинка внутри файла не пропадает, когда хранилище не настроено", () => {
    /*
      Здесь стояло `return ""` с примечанием «skip base64 data to avoid DB size
      limits» — и снимок пропадал молча. Ручная загрузка фото товара в том же
      случае кладёт строку данных прямо в базу, столбец mediumtext для этого и
      заведён, а размер ограничен пределом запроса в 10 МБ на весь файл.
    */
    expect(IMPORT).toMatch(/if \(!isS3\) return dataUrl;/);
  });

  it("о непринятых ячейках человеку говорят вслух", () => {
    // Иначе «фото не подхватилось» выясняется через неделю по серым карточкам.
    expect(IMPORT).toContain("unusablePhotos");
    expect(IMPORT).toMatch(/Фото не подхватилось у \$\{unusablePhotos\.count\}/);
  });
});
