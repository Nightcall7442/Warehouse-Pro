/*
  Текст уведомления на языке экрана.

  Сервер хранит русский в title/message и узбекский рядом (title_uz,
  message_uz, с 20.09.2026). У старых записей и у служебных узбекского нет —
  показывается русский, а не пусто.
*/
export function notificationText(
  n: { title: string; message?: string | null; titleUz?: string | null; messageUz?: string | null },
  lang: string,
): { title: string; message: string | null } {
  const uz = lang === "uz";
  return {
    title: (uz && n.titleUz) || n.title,
    message: (uz && n.messageUz) || n.message || null,
  };
}
