/*
  Положить текст в буфер обмена — с запасным путём.

  navigator.clipboard есть не везде: его нет на странице без https, его
  может не дать встроенный браузер, и на старых iPhone он отказывает вне
  прямого нажатия. Тогда — старый способ: невидимое поле, выделение и
  команда «копировать». Не вышло и так — false, и экран просит выделить
  текст руками.
*/
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* запасной путь ниже */ }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    // 16px — иначе iPhone приближает страницу при фокусе на поле.
    Object.assign(area.style, { position: "fixed", top: "0", left: "0", opacity: "0", fontSize: "16px" });
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = typeof document.execCommand === "function" && document.execCommand("copy");
    document.body.removeChild(area);
    return Boolean(ok);
  } catch {
    return false;
  }
}
