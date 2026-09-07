/**
 * У ссылки на фотографию есть ручка, которая её отдаёт.
 *
 * ── Что случилось ───────────────────────────────────────────────────────────
 *
 * Фотоотчёт агента о визите хранился с самого начала: приложение снимает
 * магазин, agent.saveVisitPhoto проверяет снимок на подлог и кладёт его в
 * daily_plans.photo_url — до пяти мегабайт.
 *
 * Показать его было нельзя. В api/photos.ts были только товар и магазин, в
 * photoRef — только два вида, ни один запрос колонку не выбирал, а журнал
 * визитов печатал про неё «да» или «нет». Доказательство, на которое нельзя
 * посмотреть, доказательством не является: супервайзер видел отметку «фото
 * есть» и должен был ей верить — при том что ради этой самой недоверчивости
 * фотоотчёт и заводят.
 *
 * Ошибка тихая по устройству: ссылка отдаётся, картинка не грузится, и
 * выглядит это как «интернет медленный». Поэтому правило, а не проверка
 * одного места.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const API = join(__dirname, "..");
const PHOTO_URL = readFileSync(join(API, "lib", "photo-url.ts"), "utf8");
const PHOTOS = readFileSync(join(API, "photos.ts"), "utf8");

/** Виды, которые принимает photoRef — прямо из его подписи. */
function kindsOfPhotoRef(): string[] {
  const m = PHOTO_URL.match(/kind:\s*((?:"[a-z]+"\s*\|\s*)*"[a-z]+")/);
  if (!m) throw new Error("не разобрать перечень видов в photoRef");
  return [...m[1].matchAll(/"([a-z]+)"/g)].map(x => x[1]);
}

/** Пути, объявленные в api/photos.ts. */
function routesOfPhotos(): string[] {
  return [...PHOTOS.matchAll(/photos\.get\(\s*"\/([a-z]+)\/:id"/g)].map(x => x[1]);
}

describe("ссылка на фотографию ведёт к ручке", () => {
  it("перечень видов и перечень путей читаются", () => {
    // Иначе оба разбора могли бы вернуть пусто, и правило ниже прошло бы
    // вхолостую на любом коде.
    expect(kindsOfPhotoRef().length).toBeGreaterThanOrEqual(3);
    expect(routesOfPhotos().length).toBeGreaterThanOrEqual(3);
  });

  it("у каждого вида в photoRef есть свой путь в photos.ts", () => {
    const routes = new Set(routesOfPhotos());
    const orphans = kindsOfPhotoRef().filter(kind => !routes.has(kind));

    expect(
      orphans,
      "photoRef отдаёт ссылку вида, которого никто не обслуживает — " +
      "картинка не загрузится, и выглядеть это будет как плохая связь:\n" +
      orphans.map(k => `  /api/photos/${k}/:id`).join("\n"),
    ).toEqual([]);
  });

  it("фотоотчёт о визите отдаётся из планов и в пределах организации", () => {
    /*
      Именно эта ручка и была пропущена. Проверяется и то, откуда она берёт
      снимок, и то, что чужая организация до него не доберётся: путь открыт
      всем ролям, и без фильтра по арендатору номер плана из соседней
      организации отдал бы её фотографию.
    */
    const route = PHOTOS.slice(PHOTOS.indexOf('photos.get("/visit/:id"'));
    expect(route).toMatch(/dailyPlans\.photoUrl/);
    expect(route).toMatch(/eq\(dailyPlans\.tenantId, tenantId\)/);
  });
});

describe("фотоотчёт видно там, где разбирают визит", () => {
  const AGENT = readFileSync(join(API, "agent-router.ts"), "utf8");
  const REPORTS = readFileSync(join(API, "reports-router.ts"), "utf8");

  it("список планов отдаёт ссылку, а не сам снимок", () => {
    /*
      Ссылку — потому что снимок это data-url до пяти мегабайт, и сотня планов
      превратила бы список в полгигабайта. Но и не пусто: без строки вовсе
      открыть фотоотчёт было негде.
    */
    expect(AGENT, "в списке планов нет ссылки на фотоотчёт")
      .toMatch(/photoRef\("visit", dailyPlans\.id/);
    expect(AGENT, "в списке планов сам снимок — он туда не поместится")
      .not.toMatch(/photoUrl: dailyPlans\.photoUrl/);
  });

  it("журнал визитов отдаёт не только признак «да/нет»", () => {
    expect(REPORTS).toMatch(/photoRef\("visit", dailyPlans\.id/);
  });
});
