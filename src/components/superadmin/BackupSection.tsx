import { useState } from "react";
import { notify } from "@/lib/toast";
import { Database, Download, Loader2 } from "lucide-react";
import { F, COLORS } from "./types";
import { Section, BtnPrimary } from "./ui";

/**
 * Резервная копия по требованию.
 *
 * Снимки диска, которые делает платформа, остаются первой линией, но защищают
 * только от смерти диска: чтобы отменить одно ошибочное удаление, снимок
 * предлагает откатить базу целиком на сутки назад. Здесь — копия, из которой
 * можно достать одну таблицу, и которую можно развернуть у себя и проверить.
 */
export function BackupSection() {
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      // Скачивание идёт запросом, а не обычной ссылкой, ради внятной ошибки.
      // По ссылке отказ сервера открылся бы новой вкладкой с техническим
      // текстом; здесь он превращается в понятное сообщение, а браузер не
      // уходит со страницы.
      const res = await fetch("/api/admin/backup/download", { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `Ошибка ${res.status}` })) as { error?: string };
        notify.error(body.error ?? `Ошибка ${res.status}`);
        return;
      }

      // Имя файла задаёт сервер — в нём дата и время выгрузки, чтобы копии не
      // затирали друг друга в папке загрузок.
      const disposition = res.headers.get("content-disposition") ?? "";
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "warehouse-pro-backup.sql.gz";

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      // Без отзыва ссылки файл остаётся в памяти вкладки до её закрытия.
      URL.revokeObjectURL(url);
      notify.success("Резервная копия скачана");
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Не удалось скачать копию");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Резервная копия" icon={Database}>
      <p style={{ fontFamily: F.body, fontSize: "13px", lineHeight: 1.7, color: COLORS.textSecondary, marginBottom: "16px", maxWidth: "620px" }}>
        Полный SQL-дамп базы одним файлом. Разворачивается где угодно, и из него
        можно достать отдельную таблицу или отдельные записи — не откатывая всю
        базу назад, как это делают снимки диска.
      </p>
      <p style={{ fontFamily: F.body, fontSize: "12px", lineHeight: 1.7, color: COLORS.textTertiary, marginBottom: "20px", maxWidth: "620px" }}>
        Файл содержит данные всех организаций. Храните его так же бережно, как
        доступ к самой базе, и держите копию вне этого сервера — в этом весь
        смысл.
      </p>
      <BtnPrimary onClick={download} disabled={busy}>
        {busy
          ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Готовится…</>
          : <><Download size={14} /> Скачать копию</>}
      </BtnPrimary>
    </Section>
  );
}
