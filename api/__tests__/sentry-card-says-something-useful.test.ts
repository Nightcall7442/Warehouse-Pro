/**
 * Карточка Sentry говорит то, что знаем только мы.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Sentry — чужое облако, и проверять его доступность незачем: оно живо и без
 * нас, а лишний запрос наружу с каждого открытия страницы — плохая привычка.
 * Поэтому карточка стояла в состоянии «не проверяем», серым.
 *
 * Рядом было пять зелёных карточек, и владелец прочитал серую как поломку —
 * обвёл её на снимке экрана и спросил, что не так. Формально надпись была
 * верной и при этом сообщала ровно ноль: она отвечала на вопрос, который никто
 * не задавал.
 *
 * ── Правило ─────────────────────────────────────────────────────────────────
 *
 * Про службу, которую мы не проверяем, надо говорить не о ней, а о своей связи
 * с ней. Про Sentry стоит знать ровно две вещи, и обе знаем только мы:
 * уходят ли туда падения вообще (задан ли DSN) и загружаются ли карты кода.
 * Без карт стек минифицированный — по нему искать нечего, — и по одному
 * «отвечает» этого не было бы видно никогда.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const env: Record<string, unknown> = {};
vi.mock("../lib/env", () => ({ env }));

const { observabilityServices } = await import("../services/observability");

async function sentryCard() {
  const all = await observabilityServices();
  const card = all.find(s => s.key === "sentry");
  expect(card, "карточка Sentry пропала со страницы").toBeDefined();
  return card!;
}

beforeEach(() => {
  // Ни одного адреса: проверять нечего, и посторонние карточки не мешают.
  for (const k of ["grafanaUrl", "prometheusUrl", "prometheusInternalUrl", "jaegerUrl",
                   "alertmanagerUrl", "alertmanagerInternalUrl", "lokiUrl"]) env[k] = "";
  env.sentryUrl = "https://no-name-a7.sentry.io/issues/";
  env.sentryDsn = "https://key@o1.ingest.de.sentry.io/2";
  env.sentryRelease = "8e687b0def3dc35463467b9db7003bcfcf81aed9";
  env.sentryMapsUploaded = true;
});

describe("карточка Sentry", () => {
  it("не серая, когда всё настроено", async () => {
    const card = await sentryCard();
    // «не проверяем» серым рядом с пятью зелёными читается как поломка.
    expect(card.state).toBe("configured");
    expect(card.state).not.toBe("unknown");
  });

  it("говорит, что карты кода загружаются, и под какой версией", async () => {
    const card = await sentryCard();
    expect(card.note).toContain("Карты кода загружаются");
    // Версия — то самое, по чему Sentry подбирает карты. Не совпала — стек
    // останется минифицированным, даже если карты загружены.
    expect(card.note).toContain("8e687b0");
  });

  it("говорит прямо, когда карты НЕ загружаются", async () => {
    env.sentryMapsUploaded = false;
    const card = await sentryCard();
    expect(card.note).toContain("НЕ загружаются");
    expect(card.note).toContain("SENTRY_AUTH_TOKEN");
    // Сбор ошибок при этом работает — состояние остаётся настроенным.
    expect(card.state).toBe("configured");
  });

  it("без DSN — это «не настроено», и сказано, чем это грозит", async () => {
    env.sentryDsn = "";
    const card = await sentryCard();
    expect(card.state).toBe("not_configured");
    expect(card.note).toContain("падения никуда не уходят");
  });

  it("наружу не уходит сам ключ, только признак", async () => {
    const card = await sentryCard();
    /*
      Страница мониторинга — это ответ сервера браузеру. SENTRY_AUTH_TOKEN даёт
      право писать в организацию Sentry, и его место в переменных окружения, а
      не в ответе HTTP. Поэтому сервер знает лишь «да» или «нет».
    */
    expect(JSON.stringify(card)).not.toContain("sntrys_");
    expect(Object.keys(card)).not.toContain("sentryAuthToken");
  });

  it("чужое облако не опрашивается", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await sentryCard();
    // Запрос наружу с каждого открытия страницы — плохая привычка, и от него
    // всё равно не узнать ничего полезного: Sentry жив и без нас.
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).not.toContain("sentry.io");
    }
    fetchSpy.mockRestore();
  });
});
