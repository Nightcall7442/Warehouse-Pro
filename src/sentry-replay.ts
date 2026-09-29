import { addIntegration, replayIntegration } from "@sentry/react";

/**
 * Запись сеанса (Sentry Replay, внутри — rrweb) — отдельным куском.
 *
 * Сюда её вынесли из src/sentry.ts: там она ехала во входном файле и
 * занимала в нём больше сотни килобайт, которые телефон агента качал и
 * разбирал до первого экрана. Подгружает её src/sentry.ts, когда страница
 * уже нарисована и браузер свободен.
 *
 * Настройки те же, что были в init: в записи не должно быть ни сумм, ни
 * названий магазинов — она уходит третьей стороне; текст и поля ввода
 * закрываются целиком. Частоту записи (только сеансы с ошибкой) задаёт
 * init — replaysOnErrorSampleRate, интеграция читает её оттуда.
 */
export function startReplay(): void {
  addIntegration(replayIntegration({
    maskAllText: true,
    maskAllInputs: true,
    blockAllMedia: true,
  }));
}
