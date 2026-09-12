/*
  Штрих-код Code 128 — своими силами, без библиотеки.

  Этикетки печатали «Код: A61-14» текстом: сканер такое не читает, и
  кладовщик набирал код руками. Code 128 читает любой сканер и любая камера
  (BarcodeDetector в браузере, expo-camera в мобилке), кодирует и буквы, и
  цифры, а на длинных числах (EAN поставщика) сам ужимается в набор C.

  Таблица — 107 стандартных знаков как ширины штрихов и пробелов; каждая
  строка суммируется в 11 модулей (стоп — в 13), на этом стоит самопроверка
  в src/__tests__/code128.test.ts.
*/

const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const START_B = 104, START_C = 105, CODE_B = 100, CODE_C = 99, STOP = 106;

export const CODE128_PATTERNS = PATTERNS;

/** Значения знаков: набор B — ASCII 32..127; набор C — пары цифр 00..99. */
export function code128Values(text: string): number[] {
  if (!text) throw new Error("Code 128: пустая строка");
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error(`Code 128: символ «${ch}» не кодируется`);
  }
  const values: number[] = [];
  let i = 0;
  let set: "B" | "C" | null = null;
  const digitsAhead = (from: number) => { let n = 0; while (from + n < text.length && /\d/.test(text[from + n])) n++; return n; };

  while (i < text.length) {
    const run = digitsAhead(i);
    // Набор C выгоден от четырёх цифр подряд (две пары); нечётный хвост — в B.
    if (run >= 4) {
      const pairs = Math.floor(run / 2);
      if (set !== "C") { values.push(set === null ? START_C : CODE_C); set = "C"; }
      for (let k = 0; k < pairs; k++) { values.push(Number(text.slice(i, i + 2))); i += 2; }
      continue;
    }
    if (set !== "B") { values.push(set === null ? START_B : CODE_B); set = "B"; }
    values.push(text.charCodeAt(i) - 32);
    i++;
  }
  let sum = values[0];
  for (let k = 1; k < values.length; k++) sum += values[k] * k;
  values.push(sum % 103, STOP);
  return values;
}

/** Модули штрих-кода: «1» — штрих, «0» — пробел. */
export function code128Modules(text: string): string {
  let out = "";
  for (const v of code128Values(text)) {
    const p = PATTERNS[v];
    for (let k = 0; k < p.length; k++) out += (k % 2 === 0 ? "1" : "0").repeat(Number(p[k]));
  }
  return out;
}

/**
 * SVG строкой — для печатных форм (они собираются HTML-строкой) и для
 * экрана через dangerouslySetInnerHTML. Ширина в модулях × module, высота
 * в тех же единицах; текст под кодом — по желанию.
 */
export function code128Svg(text: string, opts: { module?: number; height?: number; label?: boolean } = {}): string {
  const module = opts.module ?? 1;
  const height = opts.height ?? 30;
  const modules = code128Modules(text);
  const quiet = 10 * module;
  const width = modules.length * module + quiet * 2;
  const labelH = opts.label === false ? 0 : 10;
  let rects = "";
  let x = quiet;
  for (let i = 0; i < modules.length;) {
    let j = i;
    while (j < modules.length && modules[j] === modules[i]) j++;
    const w = (j - i) * module;
    if (modules[i] === "1") rects += `<rect x="${x}" y="0" width="${w}" height="${height}"/>`;
    x += w;
    i = j;
  }
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const label = labelH ? `<text x="${width / 2}" y="${height + 8}" font-family="monospace" font-size="8" text-anchor="middle">${esc}</text>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height + labelH}" width="${width}" height="${height + labelH}" shape-rendering="crispEdges" fill="#000">${rects}${label}</svg>`;
}
