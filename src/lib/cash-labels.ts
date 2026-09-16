/*
  Счёт и статья — слова, а не коды. Коды (cash.office, expense.fuel) живут
  в проводках; директор видит «сейф», «расход · Бензин и транспорт». Для
  бумаги и Excel — всегда по-русски, для экрана — на языке интерфейса.
*/
const ACCOUNT_LABEL: Array<[test: (a: string) => boolean, ru: string, uz: string]> = [
  [a => a.startsWith("cash.employee."), "на руках", "qo'lda"],
  [a => a === "cash.office", "сейф", "seyf"],
  [a => a.startsWith("receivable.employee."), "долг сотрудника", "xodim qarzi"],
  [a => a === "owner", "директор", "direktor"],
  [a => a === "income.unexplained", "до выяснения", "aniqlanguncha"],
];
export function accountLabel(a: string, lang: "ru" | "uz", catName: (code: string) => string): string {
  if (a.startsWith("expense.")) return `${lang === "uz" ? "xarajat" : "расход"} · ${catName(a.slice(8))}`;
  const hit = ACCOUNT_LABEL.find(([test]) => test(a));
  return hit ? (lang === "uz" ? hit[2] : hit[1]) : a;
}

/** Код статьи из названия, латиницей: «Ремонт машин» → remont_mashin; занятый код получает _2, _3. */
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p",
  р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  ў: "o", қ: "q", ғ: "g", ҳ: "h",
};
export function categoryCode(name: string, taken: string[] = []): string {
  const base = [...name.toLowerCase()].map(ch => TRANSLIT[ch] ?? ch).join("")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "other";
  let code = base;
  for (let n = 2; taken.includes(code); n++) code = `${base}_${n}`;
  return code;
}
