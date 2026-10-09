/* ═══════════════════════════════════════════════════════════════════════════
   Сумма прописью — для бумаг, которые подписывают.

   Акт сверки кончается фразой «задолженность в пользу … составляет 1 250 000
   сум (Один миллион двести пятьдесят тысяч сумов 00 тийинов)». Цифры в
   подписанной бумаге исправить легко, прописью — нет; поэтому бухгалтер
   ищет её глазами и без неё считает акт неполным.

   Только русский: печатные формы в системе русские (их подшивают и
   показывают проверяющим), экран — на языке интерфейса.

   Знак отбрасывается: в чью пользу долг, говорит сама фраза, а не минус.
   ═══════════════════════════════════════════════════════════════════════════ */

const ONES_M = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const ONES_F = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const TEENS = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать",
  "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
const TENS = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
const HUNDREDS = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];

type Forms = readonly [one: string, few: string, many: string];

/** Разряды по тысяче: тысяча — женского рода (одна, две), остальные — мужского. */
const SCALES: ReadonlyArray<{ forms: Forms; feminine: boolean }> = [
  { forms: ["", "", ""], feminine: false },
  { forms: ["тысяча", "тысячи", "тысяч"], feminine: true },
  { forms: ["миллион", "миллиона", "миллионов"], feminine: false },
  { forms: ["миллиард", "миллиарда", "миллиардов"], feminine: false },
  { forms: ["триллион", "триллиона", "триллионов"], feminine: false },
];

const SUM: Forms = ["сум", "сума", "сумов"];
const TIYIN: Forms = ["тийин", "тийина", "тийинов"];

/** Форма слова после числа: 1 сум, 2 сума, 5 сумов, 11 сумов, 21 сум. */
export function plural(n: number, [one, few, many]: Forms): string {
  const n100 = n % 100;
  const n10 = n % 10;
  if (n100 >= 11 && n100 <= 14) return many;
  if (n10 === 1) return one;
  if (n10 >= 2 && n10 <= 4) return few;
  return many;
}

function triad(n: number, feminine: boolean): string[] {
  const words: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) words.push(HUNDREDS[h]);
  if (rest >= 10 && rest < 20) words.push(TEENS[rest - 10]);
  else {
    const t = Math.floor(rest / 10);
    const o = rest % 10;
    if (t) words.push(TENS[t]);
    if (o) words.push((feminine ? ONES_F : ONES_M)[o]);
  }
  return words;
}

/** Целое прописью: 1250000 → «один миллион двести пятьдесят тысяч». */
export function integerInWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "ноль";
  const parts: string[] = [];
  for (let scale = 0; n > 0 && scale < SCALES.length; scale++) {
    const chunk = n % 1000;
    n = Math.floor(n / 1000);
    if (!chunk) continue;
    const { forms, feminine } = SCALES[scale];
    const words = triad(chunk, feminine);
    if (scale > 0) words.push(plural(chunk, forms));
    parts.unshift(words.join(" "));
  }
  return parts.join(" ");
}

/** «Один миллион двести пятьдесят тысяч сумов 00 тийинов». */
export function amountInWords(amount: number): string {
  const abs = Math.abs(amount);
  let whole = Math.floor(abs);
  let tiyin = Math.round((abs - whole) * 100);
  if (tiyin === 100) { whole += 1; tiyin = 0; }
  const words = integerInWords(whole);
  const text = `${words} ${plural(whole, SUM)} ${String(tiyin).padStart(2, "0")} ${plural(tiyin, TIYIN)}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
