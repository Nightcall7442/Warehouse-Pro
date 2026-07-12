import { useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { Upload, FileSpreadsheet, X, CheckCircle2, AlertTriangle, Loader2, Download } from "lucide-react";

type ImportType = "products" | "shops";

interface Props {
  type: ImportType;
  onDone: () => void;
  onCancel: () => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip data URL prefix
      const base64 = result.split(",")[1] || result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Ошибка чтения файла"));
    reader.readAsDataURL(file);
  });
}

export function ExcelImport({ type, onDone, onCancel }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [base64, setBase64] = useState("");
  const [preview, setPreview] = useState<any[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  const previewMutation = trpc.import.previewImport.useMutation();
  const executeMutation = trpc.import.executeImport.useMutation();
  const templateQuery = trpc.import.downloadTemplate.useQuery({ type });

  const typeLabel = type === "products" ? "товаров" : "магазинов";

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setErrors([]);
    setPreview([]);
    setHeaders([]);
    setTotalRows(0);

    try {
      const b64 = await fileToBase64(file);
      setBase64(b64);

      const result = await previewMutation.mutateAsync({
        type,
        base64: b64,
        filename: file.name,
      });
      setHeaders(result.headers);
      setPreview(result.preview);
      setTotalRows(result.totalRows);
    } catch (e: unknown) {
      setErrors([e instanceof Error ? e.message : "Ошибка чтения файла"]);
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
        notify.success(`Импортировано ${result.success} из ${result.total} записей`);
        if (result.errors.length > 0) setErrors(result.errors);
        if (result.skipped.length > 0) setErrors(prev => [...prev, ...result.skipped.map(s => `Пропущено: ${s}`)]);
        onDone();
      } else if (result.errors.length > 0) {
        setErrors(result.errors);
        notify.error("Импорт не удался");
      }
    } catch (e: unknown) {
      setErrors([e instanceof Error ? e.message : "Ошибка импорта"]);
      notify.error("Ошибка импорта");
    } finally {
      setImporting(false);
    }
  };

  const handleDownloadTemplate = () => {
    if (!templateQuery.data) return;
    const csv = templateQuery.data.csv;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = templateQuery.data.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ background: "var(--color-surface, #ffffff)", borderRadius: "20px", padding: "24px", boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.04)" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
        <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary, #111827)" }}>
          Импорт {typeLabel}
        </h2>
        <button onClick={onCancel} style={{ padding: "8px", borderRadius: "8px", background: "none", border: "none", cursor: "pointer", color: "var(--color-text-secondary, #6b7280)" }}>
          <X size={18} />
        </button>
      </div>

      {/* Template download */}
      <div style={{ padding: "16px", borderRadius: "12px", background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.2)", display: "flex", alignItems: "flex-start", gap: "12px", marginBottom: "20px" }}>
        <FileSpreadsheet size={18} style={{ color: "#60a5fa", flexShrink: 0, marginTop: "2px" }} />
        <div>
          <p style={{ fontSize: "13px", color: "var(--color-text-primary, #111827)", margin: 0 }}>
            Скачайте шаблон, заполните данные и загрузите файл обратно.
          </p>
          <p style={{ fontSize: "11px", color: "var(--color-text-secondary, #6b7280)", marginTop: "4px", margin: "4px 0 0" }}>
            Поддерживаемые форматы: <b>.xlsx</b>, <b>.xls</b>, <b>.csv</b>
          </p>
          <button onClick={handleDownloadTemplate} style={{ display: "inline-flex", alignItems: "center", gap: "6px", marginTop: "8px", padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 600, color: "#60a5fa", background: "rgba(37,99,235,0.1)", border: "none", cursor: "pointer" }}>
            <Download size={13} /> Скачать шаблон
          </button>
        </div>
      </div>

      {/* File drop zone */}
      <div
        style={{
          border: `2px dashed ${preview.length > 0 ? "rgba(22,163,74,0.5)" : "var(--color-border, #f3f4f6)"}`,
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
            <CheckCircle2 size={32} style={{ margin: "0 auto 8px", color: "#4ade80" }} />
            <p style={{ fontSize: "14px", fontWeight: 600, color: "#4ade80" }}>{fileName}</p>
            <p style={{ fontSize: "12px", color: "var(--color-text-secondary, #6b7280)", marginTop: "4px" }}>{totalRows} строк для импорта</p>
            <p style={{ fontSize: "11px", color: "var(--color-text-tertiary, #9ca3af)", marginTop: "4px" }}>Нажмите чтобы заменить файл</p>
          </>
        ) : (
          <>
            <Upload size={32} style={{ margin: "0 auto 8px", color: "var(--color-text-tertiary, #9ca3af)" }} />
            <p style={{ fontSize: "14px", color: "var(--color-text-primary, #111827)" }}>Перетащите .xlsx / .csv файл</p>
            <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #9ca3af)", marginTop: "4px" }}>или нажмите для выбора</p>
          </>
        )}
      </div>

      {/* Preview */}
      {preview.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: "16px" }}>
          <table style={{ width: "100%", fontSize: "11px", fontFamily: "'DM Sans', sans-serif" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border, #f3f4f6)" }}>
                {headers.map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "8px 10px", fontWeight: 600, color: "var(--color-text-tertiary, #9ca3af)", textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "10px" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((row, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--color-border, #f3f4f6)" }}>
                  {headers.map(h => (
                    <td key={h} style={{ padding: "6px 10px", color: "var(--color-text-primary, #111827)" }}>{String(row[h] ?? "")}</td>
                  ))}
                </tr>
              ))}
              {totalRows > 5 && (
                <tr><td colSpan={headers.length} style={{ padding: "8px 10px", textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)", fontSize: "11px" }}>... и ещё {totalRows - 5} строк</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div style={{ marginTop: "16px", padding: "12px", borderRadius: "12px", background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", color: "#f87171", fontSize: "13px", fontWeight: 600 }}>
            <AlertTriangle size={15} /> Ошибки
          </div>
          {errors.slice(0, 5).map((e, i) => <p key={i} style={{ fontSize: "11px", color: "#f87171", margin: "2px 0" }}>{e}</p>)}
          {errors.length > 5 && <p style={{ fontSize: "11px", color: "#f87171" }}>... и ещё {errors.length - 5}</p>}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: "12px", marginTop: "20px", paddingTop: "16px", borderTop: "1px solid var(--color-border, #f3f4f6)" }}>
        <button onClick={handleImport} disabled={!base64 || importing}
          style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "10px 20px", borderRadius: "12px", fontSize: "13px", fontWeight: 600, color: "#fff", background: "linear-gradient(135deg, #818cf8, #6366f1)", border: "none", cursor: !base64 || importing ? "not-allowed" : "pointer", opacity: !base64 || importing ? 0.5 : 1, transition: "all 0.2s" }}>
          {importing ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Upload size={14} />}
          {importing ? "Импортирую..." : `Импортировать${totalRows > 0 ? ` ${totalRows} строк` : ""}`}
        </button>
        <button onClick={onCancel} style={{ padding: "10px 20px", borderRadius: "12px", fontSize: "13px", fontWeight: 600, color: "var(--color-text-secondary, #6b7280)", background: "var(--color-surface, #ffffff)", border: "1px solid var(--color-border, #f3f4f6)", cursor: "pointer" }}>
          Отмена
        </button>
      </div>
    </div>
  );
}
