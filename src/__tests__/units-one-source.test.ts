import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { UNITS, unitLabel, unitShort } from "@/lib/units";

/**
 * Единицы измерения — один список.
 *
 * Их было восемь: своя таблица в форме товара, в карточке товара, в заказах, в
 * карточке заказа, в панели заказа, в окне приёмки, на складе, в приходах и в
 * печатных документах. Списки разошлись: `box` в четырёх из них назывался
 * «блок» — тем же словом, что и отдельная единица `block`. Ящик от блока было
 * не отличить ни на экране, ни в накладной.
 *
 * А в выгрузках Excel единицы и вовсе печатались кодом из базы: «pcs», «box»,
 * «pack» — с этого и начался разбор.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

describe("список единиц", () => {
  it("совпадает с тем, что принимает сервер", () => {
    /*
      Значения — перечисление в базе и в z.enum. Разойдутся — товар с новой
      единицей приедет на экран кодом, и никто не поймёт, где его подписать.
    */
    const schema = read("db/schema.ts").match(/mysqlEnum\("unit",\s*\[([^\]]+)\]/);
    expect(schema, "перечисление единиц в схеме не найдено").not.toBeNull();
    const inDb = schema![1].split(",").map(x => x.trim().replace(/"/g, ""));

    const router = read("api/product-router.ts").match(/unit:\s*z\.enum\(\[([^\]]+)\]/);
    expect(router, "перечисление единиц в роутере не найдено").not.toBeNull();
    const inApi = router![1].split(",").map(x => x.trim().replace(/"/g, ""));

    const known = UNITS.map(u => u.value);
    expect([...known].sort()).toEqual([...inDb].sort());
    expect([...inDb].sort()).toEqual([...inApi].sort());
  });

  it("ящик и блок называются по-разному", () => {
    // Ровно та беда, ради которой всё сводилось в один список.
    expect(unitLabel("box")).not.toBe(unitLabel("block"));
    expect(unitShort("box")).not.toBe(unitShort("block"));
    expect(unitLabel("box")).toBe("ящик");
    expect(unitLabel("block")).toBe("блок");
  });

  it("короткая подпись — для таблиц, полная — для списков", () => {
    expect(unitShort("pcs")).toBe("шт");
    expect(unitLabel("pcs")).toBe("штук");
    expect(unitShort("pcs", "uz")).toBe("dona");
  });

  it("неизвестный код возвращается как есть, а не пропадает", () => {
    // Если в базе однажды появится единица, о которой фронтенд не знает,
    // пусть её видно будет кодом, чем пустотой на месте количества.
    expect(unitShort("barrel")).toBe("barrel");
    expect(unitShort(undefined)).toBe("шт");
  });
});

describe("своих таблиц единиц больше нет", () => {
  const walk = (dir: string, out: string[] = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== "__tests__") walk(p, out); continue; }
      if (/\.tsx?$/.test(e.name)) out.push(p);
    }
    return out;
  };

  it("никто не заводит свой список кодов", () => {
    const own: string[] = [];
    for (const file of walk(path.resolve(process.cwd(), "src"))) {
      if (file.endsWith(path.join("lib", "units.ts"))) continue;
      const src = fs.readFileSync(file, "utf8");
      // Признак своей таблицы: рядом стоят ключи kg и pcs.
      if (/\bkg:\s*[["{]/.test(src) && /\bpcs:\s*[["{]/.test(src)) {
        own.push(path.relative(process.cwd(), file));
      }
    }
    expect(own, `снова завели свою таблицу единиц:\n${own.join("\n")}`).toEqual([]);
  });

  it("выгрузки и документы печатают подпись, а не код", () => {
    /*
      Здесь и была жалоба: в Excel «pcs» вместо «шт». Проверяем не наличие
      импорта — им легко обмануться, — а отсутствие сырого поля.
    */
    for (const file of ["src/lib/excel.ts", "src/lib/export.ts", "src/lib/documents.ts", "src/components/reports/report-registry.ts"]) {
      const src = read(file);
      expect(src, `${file}: единица печатается кодом`).not.toMatch(/String\(\w+\.unit\s*\?\?/);
      expect(src, `${file}: единица печатается кодом`).not.toMatch(/\$\{\w+\.unit\s*\?\?/);
      expect(src, `${file}: единицы берутся не из общего списка`).toMatch(/unitShort|unitLabel/);
    }
  });
});
