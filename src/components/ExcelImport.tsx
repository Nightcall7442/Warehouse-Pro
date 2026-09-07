import { useRef, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { Upload, FileSpreadsheet, X, CheckCircle2, AlertTriangle, Loader2, Download } from "lucide-react";
import type { AppRouter } from "../../api/router";
import { useTranslate } from "@/i18n";

type ImportType = "products" | "shops";

type PreviewRow = inferRouterOutputs<AppRouter>["import"]["previewImport"]["preview"][number];

interface Props {
  type: ImportType;
  onDone: () => void;
  onCancel: () => void;
}

/** Метка отказа чтения: текст для человека подставляется в компоненте. */
const FILE_READ_FAILED = "file-read-failed";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip data URL prefix
      const base64 = result.split(",")[1] || result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error(FILE_READ_FAILED));
    reader.readAsDataURL(file);
  });
}

export function ExcelImport({ type, onDone, onCancel }: Props) {
  const t = useTranslate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [base64, setBase64] = useState("");
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  const previewMutation = trpc.import.previewImport.useMutation();
  const executeMutation = trpc.import.executeImport.useMutation();
  const templateQuery = trpc.import.downloadTemplate.useQuery({ type });

  const typeLabel = type === "products"
    ? t("товаров", "mahsulotlarni")
    : t("магазинов", "do'konlarni");

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setErrors([]);
    setPreview([]);
    setTotalRows(0);

    try {
      const b64 = await fileToBase64(file);
      setBase64(b64);

      const result = await previewMutation.mutateAsync({
        type,
        base64: b64,
        filename: file.name,
      });
      setPreview(result.preview);
      setTotalRows(result.totalRows);
    } catch (e: unknown) {
      const failed = t("Ошибка чтения файла", "Faylni o'qishda xatolik");
      setErrors([e instanceof Error && e.message !== FILE_READ_FAILED ? e.message : failed]);
    }
  };

  const handleImport = async () => {
    if (!base64) return;
    setImporting(true);
    setErrors([]);

    try {
      const result = await executeMutation.mutateAsync({
        type,
        base64,
        filename: fileName,
      });

      if (result.success > 0) {
        notify.success(t(
          `Импортировано ${result.success} из ${result.total} записей`,
          `${result.total} ta yozuvdan ${result.success} tasi import qilindi`,
        ));
        if (result.errors.length > 0) setErrors(result.errors);
        if (result.skipped.length > 0) setErrors(prev => [...prev, ...result.skipped.map(s => `${t("Пропущено", "O'tkazib yuborildi")}: ${s}`)]);
        // Only close if no errors
        if (result.errors.length === 0) {
          onDone();
        }
      } else if (result.errors.length > 0) {
        setErrors(result.errors);
        notify.error(t("Импорт не удался", "Import amalga oshmadi"));
      }
    } catch (e: unknown) {
      setErrors([e instanceof Error ? e.message : t("Ошибка импорта", "Import xatosi")]);
      notify.error(t("Ошибка импорта", "Import xatosi"));
    } finally {
      setImporting(false);
    }
  };

  const handleDownloadTemplate = () => {
    if (templateQuery.isLoading) {
      notify.error(t("Шаблон ещё загружается, попробуйте через секунду", "Shablon hali yuklanmoqda, bir soniyadan keyin urinib ko'ring"));
      return;
    }
    if (templateQuery.isError || !templateQuery.data) {
      notify.error(
        templateQuery.error instanceof Error
          ? templateQuery.error.message
          : t("Не удалось загрузить шаблон. Проверьте права доступа.", "Shablonni yuklab bo'lmadi. Kirish huquqlarini tekshiring.")
      );
      return;
    }
    const base64 = templateQuery.data.base64;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = templateQuery.data.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Preview rows are keyed by the field the server mapped each column to, not by
  // the column title in the file — a file with Russian headers has no "Название"
  // key to look up. Columns the importer didn't recognise aren't in the row at
  // all, which is worth seeing before you commit the import.
  const columns = preview.length > 0 ? Object.keys(preview[0]) : [];

  return (
    <div style={{ background: "var(--color-surface, #efedea)", borderRadius: "20px", padding: "24px", boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.04)" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
        <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary, #2b2a28)" }}>
          {t("Импорт", "Import")} {typeLabel}
        </h2>
        <button onClick={onCancel} style={{ padding: "8px", borderRadius: "8px", background: "none", border: "none", cursor: "pointer", color: "var(--color-text-secondary, #5e5b54)" }}>
          <X size={18} />
        </button>
      </div>

      {/* Template download */}
      <div style={{ padding: "16px", borderRadius: "12px", background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.2)", display: "flex", alignItems: "flex-start", gap: "12px", marginBottom: "20px" }}>
        <FileSpreadsheet size={18} style={{ color: "#60a5fa", flexShrink: 0, marginTop: "2px" }} />
        <div>
          <p style={{ fontSize: "13px", color: "var(--color-text-primary, #2b2a28)", margin: 0 }}>
            {t("Скачайте шаблон, заполните данные и загрузите файл обратно.", "Shablonni yuklab oling, ma'lumotlarni to'ldiring va faylni qaytadan yuklang.")}
          </p>
          <p style={{ fontSize: "11px", color: "var(--color-text-secondary, #5e5b54)", marginTop: "4px", margin: "4px 0 0" }}>
            {t("Поддерживаемые форматы:", "Qo'llab-quvvatlanadigan formatlar:")} <b>.xlsx</b>, <b>.xls</b>, <b>.csv</b>
          </p>
          <button onClick={handleDownloadTemplate} style={{ display: "inline-flex", alignItems: "center", gap: "6px", marginTop: "8px", padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 600, color: "#60a5fa", background: "rgba(37,99,235,0.1)", border: "none", cursor: "pointer" }}>
            <Download size={13} /> {t("Скачать шаблон", "Shablonni yuklab olish")}
          </button>
        </div>
      </div>

      {/* File drop zone */}
      <div
        style={{
          border: `2px dashed ${preview.length > 0 ? "rgba(22,163,74,0.5)" : "var(--color-border, #d8d5cd)"}`,
          borderRadius: "12px", padding: "32px", textAlign: "center", cursor: "pointer",
          transition: "all 0.2s", background: preview.length > 0 ? "rgba(22,163,74,0.05)" : "transparent",
        }}
        onClick={() => fileRef.current?.click()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        onDragOver={e => e.preventDefault()}
      >
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        {preview.length > 0 ? (
          <>
            <CheckCircle2 size={32} style={{ margin: "0 auto 8px", color: "var(--color-success-text)" }} />
            <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-success-text)" }}>{fileName}</p>
            <p style={{ fontSize: "12px", color: "var(--color-text-secondary, #5e5b54)", marginTop: "4px" }}>{totalRows} {t("строк для импорта", "qator import uchun")}</p>
            <p style={{ fontSize: "11px", color: "var(--color-text-tertiary, #6b6760)", marginTop: "4px" }}>{t("Нажмите чтобы заменить файл", "Faylni almashtirish uchun bosing")}</p>
          </>
        ) : (
          <>
            <Upload size={32} style={{ margin: "0 auto 8px", color: "var(--color-text-tertiary, #6b6760)" }} />
            <p style={{ fontSize: "14px", color: "var(--color-text-primary, #2b2a28)" }}>{t("Перетащите .xlsx / .csv файл", ".xlsx / .csv faylni bu yerga tashlang")}</p>
            <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #6b6760)", marginTop: "4px" }}>{t("или нажмите для выбора", "yoki tanlash uchun bosing")}</p>
          </>
        )}
      </div>

      {/* Preview */}
      {preview.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: "16px" }}>
          <table style={{ width: "100%", fontSize: "11px", fontFamily: "'DM Sans', sans-serif" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border, #d8d5cd)" }}>
                {columns.map(c => (
                  <th key={c} style={{ textAlign: "left", padding: "8px 10px", fontWeight: 600, color: "var(--color-text-tertiary, #6b6760)", textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "10px" }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((row, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--color-border, #d8d5cd)" }}>
                  {columns.map(c => (
                    <td key={c} style={{ padding: "6px 10px", color: "var(--color-text-primary, #2b2a28)" }}>{String(row[c] ?? "")}</td>
                  ))}
                </tr>
              ))}
              {totalRows > 5 && (
                <tr><td colSpan={columns.length} style={{ padding: "8px 10px", textAlign: "center", color: "var(--color-text-tertiary, #6b6760)", fontSize: "11px" }}>... {t("и ещё", "va yana")} {totalRows - 5} {t("строк", "qator")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div style={{ marginTop: "16px", padding: "12px", borderRadius: "12px", background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", color: "var(--color-danger-text)", fontSize: "13px", fontWeight: 600 }}>
            <AlertTriangle size={15} /> {t("Ошибки", "Xatolar")}
          </div>
          {errors.slice(0, 5).map((e, i) => <p key={i} style={{ fontSize: "11px", color: "var(--color-danger-text)", margin: "2px 0" }}>{e}</p>)}
          {errors.length > 5 && <p style={{ fontSize: "11px", color: "var(--color-danger-text)" }}>... {t("и ещё", "va yana")} {errors.length - 5}</p>}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: "12px", marginTop: "20px", paddingTop: "16px", borderTop: "1px solid var(--color-border, #d8d5cd)" }}>
        {executeMutation.isSuccess ? (
          <button onClick={onDone}
            style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "10px 20px", borderRadius: "12px", fontSize: "13px", fontWeight: 600, color: "#fff", background: "linear-gradient(135deg, var(--color-success), #22c47a)", border: "none", cursor: "pointer", transition: "all 0.2s" }}>
            <CheckCircle2 size={14} /> {t("Готово", "Tayyor")}
          </button>
        ) : (
          <button onClick={handleImport} disabled={!base64 || importing}
            style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "10px 20px", borderRadius: "12px", fontSize: "13px", fontWeight: 600, color: "var(--color-on-primary)", background: "var(--color-primary)", border: "none", cursor: !base64 || importing ? "not-allowed" : "pointer", opacity: !base64 || importing ? 0.5 : 1, transition: "all 0.2s" }}>
            {importing ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Upload size={14} />}
            {importing
              ? t("Импортирую...", "Import qilinmoqda...")
              : t(`Импортировать${totalRows > 0 ? ` ${totalRows} строк` : ""}`,
                  `Import qilish${totalRows > 0 ? ` — ${totalRows} qator` : ""}`)}
          </button>
        )}
        <button onClick={onCancel} style={{ padding: "10px 20px", borderRadius: "12px", fontSize: "13px", fontWeight: 600, color: "var(--color-text-secondary, #5e5b54)", background: "var(--color-surface, #efedea)", border: "1px solid var(--color-border, #d8d5cd)", cursor: "pointer" }}>
          {executeMutation.isSuccess ? t("Закрыть", "Yopish") : t("Отмена", "Bekor qilish")}
        </button>
      </div>
    </div>
  );
}
