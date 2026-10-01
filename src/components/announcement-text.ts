/** Текст объявления на языке пользователя: узбекский — если он есть у объявления (оба поля), иначе русский. */
export function localized(a: { title: string; body: string; titleUz?: string | null; bodyUz?: string | null }, lang: string) {
  return lang === "uz" && a.titleUz && a.bodyUz ? { title: a.titleUz, body: a.bodyUz } : { title: a.title, body: a.body };
}
