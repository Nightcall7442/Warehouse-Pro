import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/toast", () => ({
  notify: { info: vi.fn(), error: vi.fn(), success: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}));

import { exportToExcel } from "@/lib/excel";
import { notify } from "@/lib/toast";

/**
 * Выгрузка в Excel на пустом наборе просто выходила из функции: кнопка нажата,
 * файла нет, объяснения нет. Со стороны человека это неотличимо от сломанной
 * кнопки, и сделать он ничего не может — он не знает, что случилось.
 *
 * Сообщение живёт в самой библиотеке, а не у вызывающих: выгрузку зовут из
 * девятнадцати мест, и почти везде это одна строка в обработчике нажатия.
 */
describe("выгрузка в Excel не молчит", () => {
  beforeEach(() => vi.clearAllMocks());

  it("на пустом наборе человек видит причину", async () => {
    await exportToExcel([], "пусто");
    expect(notify.info, "выгрузка снова вышла молча").toHaveBeenCalledTimes(1);
    expect(vi.mocked(notify.info).mock.calls[0][0]).toMatch(/нет данных/i);
  });

  it("сообщение появляется до всякой работы с файлом", async () => {
    // Если бы сообщение стояло после сборки книги, пустой набор всё равно
    // успел бы уронить ExcelJS на отсутствующих заголовках.
    await expect(exportToExcel([], "пусто")).resolves.toBeUndefined();
  });
});

describe("кнопки выгрузки не висят над пустым списком", () => {
  const SRC = readFileSync(
    join(process.cwd(), "src", "components", "warehouse", "MovementHistory.tsx"),
    "utf8",
  );

  it("кнопка Excel показывается только когда есть что выгружать", () => {
    // Ниже в том же блоке уже написано «Движений нет» — кнопке там нечего
    // делать, и предлагать её значит обещать несуществующее.
    expect(SRC, "кнопка выгрузки снова показывается всегда").toContain("{!!movements?.length && (");
  });
});
