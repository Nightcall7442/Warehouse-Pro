import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Отправка журнала в Loki не должна вредить приложению.
 *
 * Журнал — вспомогательная вещь. Если хранилище журналов недоступно, отвечает
 * медленно или ошибкой, склад обязан продолжать работать: заказы важнее
 * записей о заказах. Поэтому здесь проверяется не «дошло ли», а три свойства
 * безопасности:
 *
 *   • при недоступном Loki наружу не летит исключение;
 *   • очередь не растёт без предела, сколько бы он ни лежал;
 *   • без заданного адреса не делается ни одного обращения к сети.
 *
 * Плюс формат: Loki принимает наносекунды строкой и группировку по ярлыкам —
 * ошибка здесь означает молчаливый отказ с ответом 400.
 */

const envStub = vi.hoisted(() => ({
  lokiUrl: undefined as string | undefined,
  lokiBasicAuth: undefined as string | undefined,
  isProduction: false,
}));

vi.mock("../lib/env", () => ({ env: envStub }));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  envStub.lokiUrl = undefined;
  envStub.lokiBasicAuth = undefined;
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Отправка журнала в Loki", () => {
  it("молчит, пока адрес не задан", async () => {
    const { queueForLoki, flushLoki, _lokiQueueSize } = await import("../lib/loki");

    queueForLoki("info", JSON.stringify({ msg: "заказ создан" }));
    await flushLoki();

    // Ни очереди, ни обращения к сети: Loki просто не подключён.
    expect(_lokiQueueSize()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("отправляет пачкой в том виде, какого ждёт Loki", async () => {
    envStub.lokiUrl = "http://loki:3100";
    const { queueForLoki, flushLoki } = await import("../lib/loki");

    queueForLoki("info", JSON.stringify({ msg: "первая" }));
    queueForLoki("info", JSON.stringify({ msg: "вторая" }));
    queueForLoki("error", JSON.stringify({ msg: "третья" }));
    await flushLoki();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://loki:3100/loki/api/v1/push");

    const body = JSON.parse(init.body);
    // Поток — это набор ярлыков, поэтому уровни разъезжаются по разным потокам.
    expect(body.streams).toHaveLength(2);

    const info = body.streams.find((s: { stream: { level: string } }) => s.stream.level === "info");
    expect(info.values).toHaveLength(2);
    expect(info.stream.app).toBe("warehouse-pro");

    // Время — наносекунды строкой. Число или миллисекунды дают 400.
    const [ts, line] = info.values[0];
    expect(typeof ts).toBe("string");
    expect(ts).toMatch(/^\d{19}$/);
    expect(JSON.parse(line).msg).toBe("первая");
  });

  it("не пропускает исключение наружу, когда Loki недоступен", async () => {
    envStub.lokiUrl = "http://loki:3100";
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const { queueForLoki, flushLoki, _lokiQueueSize } = await import("../lib/loki");

    queueForLoki("info", JSON.stringify({ msg: "заказ создан" }));

    // Ни исключения, ни отказа обещания.
    await expect(flushLoki()).resolves.toBeUndefined();
    // Запись не потеряна — вернулась в очередь до следующей попытки.
    expect(_lokiQueueSize()).toBe(1);
  });

  it("не растёт без предела, пока Loki лежит", async () => {
    envStub.lokiUrl = "http://loki:3100";
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const { queueForLoki, _lokiQueueSize } = await import("../lib/loki");

    // Втрое больше потолка: приложение под нагрузкой пишет много.
    for (let i = 0; i < 6000; i++) {
      queueForLoki("info", JSON.stringify({ msg: `запись ${i}` }));
    }

    // Потолок 2000. Без него это была бы утечка памяти, растущая ровно столько,
    // сколько Loki недоступен, — то есть падение приложения из-за журнала.
    expect(_lokiQueueSize()).toBeLessThanOrEqual(2000);
  });

  it("не повторяет партию, которую Loki отверг по существу", async () => {
    envStub.lokiUrl = "http://loki:3100";
    fetchMock.mockResolvedValue({ ok: false, status: 400 });
    const { queueForLoki, flushLoki, _lokiQueueSize } = await import("../lib/loki");

    queueForLoki("info", JSON.stringify({ msg: "кривая запись" }));
    await flushLoki();

    // 400 — наша ошибка в теле запроса. Повторять её бесконечно значит
    // намертво заклинить очередь на одной плохой партии.
    expect(_lokiQueueSize()).toBe(0);
  });

  it("повторяет партию, когда Loki отвечает пятисотой", async () => {
    envStub.lokiUrl = "http://loki:3100";
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    const { queueForLoki, flushLoki, _lokiQueueSize } = await import("../lib/loki");

    queueForLoki("info", JSON.stringify({ msg: "заказ создан" }));
    await flushLoki();

    // Временная неисправность на той стороне — запись не выбрасываем.
    expect(_lokiQueueSize()).toBe(1);
  });
});
