// @vitest-environment jsdom
/**
 * Ошибка на экране — на языке интерфейса.
 *
 * Узбекский интерфейс, экран 1С: «Внутренняя ошибка сервера. Попробуйте
 * позже.» — русский текст сервера, напечатанный как есть через
 * `error.message`. Теперь сервер отвечает на языке из заголовка x-lang и
 * помечает это `data.lang`, а экран печатает ошибку только через errorText
 * (src/lib/error-text.ts), который знает, чему из ответа можно верить.
 */
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorText, humanError } from "@/lib/error-text";

const ROOT = path.resolve(import.meta.dirname, "../..");

function setLang(lang: "ru" | "uz") {
  localStorage.setItem("lang", lang);
}

/** Ошибка tRPC так, как её видит экран: TRPCClientError с data формата сервера. */
function trpcError(message: string, data?: Record<string, unknown>, status?: number) {
  return Object.assign(new Error(message), {
    name: "TRPCClientError",
    data,
    meta: status ? { response: { status } } : undefined,
  });
}

describe("errorText — что показать человеку", () => {
  beforeEach(() => setLang("ru"));
  afterEach(() => localStorage.clear());

  it("слова сервера на языке интерфейса — как есть", () => {
    setLang("uz");
    const e = trpcError("Mahsulot yetarli emas: «Сок» — mavjud 3, yana 7 kerak", { code: "BAD_REQUEST", httpStatus: 400, lang: "uz" });
    expect(errorText(e)).toBe("Mahsulot yetarli emas: «Сок» — mavjud 3, yana 7 kerak");
  });

  it("слова сервера на другом языке — не показываются: язык переключили, ответ старый", () => {
    setLang("uz");
    const e = trpcError("Заказ не найден", { code: "NOT_FOUND", httpStatus: 404, lang: "ru" });
    expect(errorText(e)).toBe("Topilmadi — ehtimol, o'chirilgan.");
  });

  it("старый сервер без пометки: русскому интерфейсу — русский текст, узбекскому — по коду", () => {
    const e = trpcError("Недостаточно товара на складе", { code: "BAD_REQUEST", httpStatus: 400 });
    expect(errorText(e)).toBe("Недостаточно товара на складе");
    setLang("uz");
    expect(errorText(e)).toBe("Bo'lmadi. Qayta urinib ko'ring.");
    expect(errorText(e, "Hisobotni tuzib bo'lmadi")).toBe("Hisobotni tuzib bo'lmadi");
  });

  it("английский отказ сервера — по коду, на обоих языках", () => {
    const e = trpcError("Insufficient permissions", { code: "FORBIDDEN", httpStatus: 403 });
    expect(errorText(e)).toBe("Нет доступа: у вашей роли нет прав на это.");
    setLang("uz");
    expect(errorText(e)).toBe("Ruxsat yo'q: rolingizda bunga huquq yo'q.");
  });

  it("сессия и частота — по коду", () => {
    expect(errorText(trpcError("x", { code: "UNAUTHORIZED" }))).toBe("Сессия закончилась. Войдите снова.");
    setLang("uz");
    expect(errorText(trpcError("x", { code: "TOO_MANY_REQUESTS" }))).toBe("Urinishlar juda ko'p. Keyinroq urinib ko'ring.");
  });

  it("обрыв связи — про связь, а не «Failed to fetch»", () => {
    expect(errorText(trpcError("Failed to fetch"))).toBe("Нет связи с сервером. Проверьте интернет и попробуйте снова.");
    setLang("uz");
    expect(errorText(new TypeError("Failed to fetch"))).toBe("Server bilan aloqa yo'q. Internetni tekshirib, qayta urinib ko'ring.");
    expect(errorText(trpcError("Load failed"))).toBe("Server bilan aloqa yo'q. Internetni tekshirib, qayta urinib ko'ring.");
  });

  it("502 от прокси без конверта tRPC — «сервер недоступен»; 500 с конвертом — «не получилось»", () => {
    expect(errorText(trpcError("Unexpected token '<'", undefined, 502))).toBe("Сервер сейчас недоступен. Попробуйте через минуту.");
    expect(errorText(trpcError("boom", { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 }))).toBe("Не получилось. Попробуйте ещё раз.");
  });

  it("строка библиотеки по-английски не печатается", () => {
    setLang("uz");
    expect(errorText(new Error("Cannot read properties of undefined (reading 'x')"))).toBe("Bo'lmadi. Qayta urinib ko'ring.");
    expect(errorText(new RangeError("Invalid array length"), "Eksport faylini yig'ib bo'lmadi")).toBe("Eksport faylini yig'ib bo'lmadi");
  });

  it("своя ошибка с текстом для человека — как есть, на любом языке", () => {
    setLang("uz");
    expect(errorText(humanError("Email yoki parol noto'g'ri"))).toBe("Email yoki parol noto'g'ri");
  });

  it("нет ошибки — пустая строка: errorText(q.error) можно ставить в условие", () => {
    expect(errorText(null)).toBe("");
    expect(errorText(undefined)).toBe("");
  });
});

describe("клиент шлёт язык интерфейса в каждом запросе", () => {
  afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

  it("x-lang берётся в момент запроса", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get("x-lang") ?? "—");
      return new Response(JSON.stringify([{ result: { data: { json: null } } }]), { headers: { "content-type": "application/json" } });
    }));
    const { trpcClient } = await import("@/providers/trpc.client");
    setLang("uz");
    await trpcClient.auth.me.query();
    setLang("ru");
    await trpcClient.auth.me.query();
    expect(seen).toEqual(["uz", "ru"]);
  });
});

/**
 * Страж: ни один экран не печатает error.message сам.
 *
 * Сравнивать с текстом можно (`e.message === FILE_READ_FAILED`), печатать —
 * только через errorText. Исключения — списком и с причиной.
 */
const ALLOWED: Record<string, string> = {
  "src/lib/error-text.ts": "сам перевод ошибки",
  "src/providers/trpc.client.ts": "глобальный обработчик пишет текст только в консоль и узнаёт отказ по подписке",
  "src/main.tsx": "необработанная ошибка уходит в консоль, человеку — общая фраза uiText",
  "src/components/ErrorBoundary.tsx": "экран падения: текст ошибки — в свёрнутых «технических деталях», рядом со стеком",
  "src/lib/stale-app-recovery.ts": "по тексту узнаётся устаревшая сборка, на экран он не выводится",
};
const ALLOWED_DIRS: Record<string, string> = {
  "src/components/monitoring/": "мониторинг показывает строки журнала ошибок сервера — журнал остаётся русским",
};

const RAW_MESSAGE = /(?<![\w$.])(?:this\.)?(?:[\w$]+\??\.)*?(?:e|err|error|ex)\??\.message\b(?!\s*[!=]==)/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "__tests__") walk(f, out); }
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(f);
  }
  return out;
}

describe("страж: error.message не печатается в обход errorText", () => {
  it("ни одного места вне списка", () => {
    const found: string[] = [];
    for (const file of walk(path.join(ROOT, "src"))) {
      const rel = path.relative(ROOT, file).replace(/\\/g, "/");
      if (ALLOWED[rel] || Object.keys(ALLOWED_DIRS).some((d) => rel.startsWith(d))) continue;
      fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        for (const m of line.matchAll(RAW_MESSAGE)) found.push(`${rel}:${i + 1}  ${m[0]}`);
      });
    }
    expect(found, "печатайте errorText(e) из @/lib/error-text").toEqual([]);
  });

  it("страж видит то, что должен", () => {
    const sample = [
      "onError: (e) => notify.error(e.message),",
      "{q.error?.message}",
      "setMsg(err.message)",
    ].join("\n");
    expect([...sample.matchAll(RAW_MESSAGE)]).toHaveLength(3);
    expect([..."if (e.message === FILE_READ_FAILED)".matchAll(RAW_MESSAGE)]).toHaveLength(0);
    expect([..."p.message[lang]".matchAll(RAW_MESSAGE)]).toHaveLength(0);
  });
});
