import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Отчёт о визите можно посмотреть.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Мерчандайзер снимает полку, отмечает по каждому товару «стоит / не стоит»,
 * пишет цену, промо и что делают конкуренты. Служба и три ручки к ней написаны
 * целиком: по магазину, по промежутку дат, по одному отчёту. Из браузера не
 * вызывалась НИ ОДНА — только запись (submitReport). То есть отчёт сдавали, и
 * не видел его никто и никогда.
 *
 * Причина, по которой витрину нельзя было просто нарисовать, лежала в хранении:
 * photos — массив JSON, внутри data-url по мегабайту с лишним. Список из
 * двадцати пяти отчётов по три снимка — это сотни мегабайт в одном ответе.
 *
 * ── Что проверяется здесь ───────────────────────────────────────────────────
 *
 * 1. Снимки НЕ уезжают в ответах — ни списком, ни поштучно.
 * 2. Раздача снимка по ссылке есть и закрыта по организации.
 * 3. Экран, который всё это показывает, существует и подключён.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const SERVICE = read("api/services/merchandiser.ts");
const PHOTOS = read("api/photos.ts");
const VIEW = read("src/components/plans/VisitReports.tsx");
const PAGE = read("src/pages/SupervisorPlans.tsx");

describe("снимки не ездят в ответах", () => {
  it("ни один запрос не выбирает столбец photos", () => {
    /*
      Ровно то, из-за чего витрины не существовало. Стоит кому-нибудь вернуть
      `photos: visitReports.photos` в выборку — и страница отчётов за месяц
      станет ответом на сотни мегабайт, причём заметят это не сразу, а когда у
      арендатора накопятся снимки.
    */
    const code = SERVICE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code, "снимки снова выбираются в запросе").not.toContain("visitReports.photos,");
  });

  it("вместо них отдаётся число", () => {
    const uses = SERVICE.match(/JSON_LENGTH\(\$\{visitReports\.photos\}\)/g) ?? [];
    // Три места: два списка и одна карточка.
    expect(uses.length, "не везде считается число снимков").toBe(3);
    expect(SERVICE).toContain("photoCount:");
  });
});

describe("раздача снимка", () => {
  it("ручка есть и берёт номер из адреса", () => {
    // Постоянная ссылка — единственное, что браузер умеет кэшировать.
    expect(PHOTOS).toContain('photos.get("/report/:id/:n"');
    expect(PHOTOS).toContain("JSON_EXTRACT");
  });

  it("закрыта по организации", () => {
    /*
      Отчёт принадлежит организации, и запрос обязан её сверять: иначе по
      перебору id выгружаются чужие снимки полок — то есть чужая коммерческая
      информация о выкладке и ценах.
    */
    const at = PHOTOS.indexOf('photos.get("/report/:id/:n"');
    const body = PHOTOS.slice(at, at + 900);
    expect(body).toContain("eq(visitReports.tenantId, tenantId)");
  });

  it("негодный номер не доходит до базы", () => {
    // MySQL на пути вида $[-1] отвечает ошибкой, а не NULL: запрос упал бы
    // пятисоткой вместо честного «нет такого снимка».
    const at = PHOTOS.indexOf('photos.get("/report/:id/:n"');
    const body = PHOTOS.slice(at, at + 900);
    expect(body).toMatch(/Number\.isInteger\(n\)/);
    expect(body).toMatch(/n < 0/);
  });
});

describe("экран подключён", () => {
  it("вкладка отчётов стоит на странице планов", () => {
    expect(PAGE).toContain("<VisitReports");
    expect(PAGE).toContain('["reports", t("Отчёты", "Hisobotlar")]');
  });

  it("все три ручки наконец кто-то зовёт", () => {
    /*
      Главная проверка файла. Ручки существовали годами и не вызывались
      ниоткуда — это подпись дефектов этого продукта, и она тем опаснее, что
      снаружи выглядит работающей: код есть, типы сходятся, тесты на службу
      есть.

      getReportsByShop зовёт карточка магазина, остальные две — витрина.
    */
    const callers = [
      "src/components/plans/VisitReports.tsx",
      "src/pages/ShopDetail.tsx",
    ].map(read).join("\n");
    for (const proc of ["getReportsByDateRange", "getReportById", "getReportsByShop"]) {
      expect(callers, `merchandiser.${proc} снова никто не зовёт`)
        .toContain(`trpc.merchandiser.${proc}`);
    }
  });

  it("ссылка на снимок собирается из id и номера", () => {
    expect(VIEW).toContain("/api/photos/report/");
  });

  it("главное число — представленность, а не количество фото", () => {
    // Ради него отчёт и заводят: фотография его подтверждает, а не заменяет.
    expect(VIEW).toContain("function presence(");
    expect(VIEW).toMatch(/present.*total/s);
  });
});
