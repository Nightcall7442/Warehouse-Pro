/**
 * Скрипт Яндекс.Карт — один на страницу, один загрузчик на все экраны.
 *
 * Жил внутри карты супервайзера. Карте продаж в «Отчётах» нужен тот же
 * скрипт, и вторая копия загрузчика — это ровно та беда, от которой его
 * чинили: «api is already enabled on this page with same namespace», когда
 * второй тег добавляют, пока первый ещё грузится (прогон 20.09.2026). Теперь
 * загрузчик общий: сначала ищет уже добавленный тег и ждёт его, свой —
 * помечает, а одновременные вызовы получают одно и то же обещание.
 */

/**
 * Ключ Яндекс.Карт.
 *
 * Значение в коде — запасное, на случай сборки без переменной: локально, из
 * форка, в тесте. Секретом оно не является — ключ карт уходит в браузер
 * вместе с бандлом при любом способе хранения, и ограничен на стороне
 * Яндекса списком доменов, а не тайной.
 *
 * Переменную читать всё равно нужно: у разных сред разные списки доменов, и
 * ключ иногда меняют.
 */
export const YANDEX_MAPS_API_KEY: string = import.meta.env.VITE_YANDEX_MAPS_API_KEY || "dd072e98-24e7-4b2e-b328-2989bd981fa5";

let loading: Promise<YandexMaps> | null = null;

/** Скрипт загружен — window.ymaps; отказ — сеть или ключ, тогда следующий вызов попробует заново. */
export function loadYandexMaps(): Promise<YandexMaps> {
  if (window.ymaps) return Promise.resolve(window.ymaps);
  if (loading) return loading;
  loading = new Promise<YandexMaps>((resolve, reject) => {
    const done = () => (window.ymaps ? resolve(window.ymaps) : fail());
    const fail = () => { loading = null; reject(new Error("Яндекс.Карты не загрузились")); };

    const existing = document.querySelector<HTMLScriptElement>("script[data-ymaps]");
    if (existing) {
      existing.addEventListener("load", done, { once: true });
      existing.addEventListener("error", () => { existing.remove(); fail(); }, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.dataset.ymaps = "1";
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${YANDEX_MAPS_API_KEY}&lang=ru_RU`;
    script.onload = done;
    // Тег с отказом убирается: иначе повторная попытка нашла бы его и ждала
    // события, которое уже не придёт.
    script.onerror = () => { script.remove(); fail(); };
    document.head.appendChild(script);
  });
  return loading;
}
