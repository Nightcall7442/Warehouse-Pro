import { useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { Upload, FileSpreadsheet, X, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";

type ImportType = "products" | "shops";

interface ImportRow {
  [key: string]: string;
}

interface Props {
  type:     ImportType;
  onDone:   () => void;
  onCancel: () => void;
}

async function parseExcelFile(file: File): Promise<ImportRow[]> {
  const XLSX = await import("xlsx");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb   = XLSX.read(e.target?.result, { type: "binary" });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { defval: "" }) as ImportRow[];
        resolve(data);
      } catch {
        reject(new Error("Не удалось прочитать файл. Убедитесь что это .xlsx или .xls"));
      }
    };
    reader.onerror = () => reject(new Error("Ошибка чтения файла"));
    reader.readAsBinaryString(file);
  });
}

// Column mapping templates
const TEMPLATES: Record<ImportType, { columns: string[]; example: ImportRow[] }> = {
  products: {
    columns: ["Код", "Название", "Категория", "Цена", "Мин. остаток"],
    example: [
      { "Код": "TOM-001", "Название": "Помидоры свежие", "Категория": "Овощи", "Цена": "4500", "Мин. остаток": "50" },
      { "Код": "CUC-001", "Название": "Огурцы",          "Категория": "Овощи", "Цена": "3200", "Мин. остаток": "40" },
    ],
  },
  shops: {
    columns: ["Название", "Владелец", "Телефон", "Город", "Адрес"],
    example: [
      { "Название": "Зелёный рынок", "Владелец": "Иванов И.", "Телефон": "+998901234567", "Город": "Ташкент", "Адрес": "ул. Чиланзарская 1" },
    ],
  },
};

function downloadTemplate(type: ImportType) {
  const t = TEMPLATES[type];
  const rows = t.example.map(r => t.columns.map(c => r[c] ?? "").join(",")).join("\n");
  const csv  = "\uFEFF" + t.columns.join(",") + "\n" + rows;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `template-${type}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExcelImport({ type, onDone, onCancel }: Props) {
  const fileRef               = useRef<HTMLInputElement>(null);
  const [rows, setRows]       = useState<ImportRow[]>([]);
  const [errors, setErrors]   = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const utils                 = trpc.useUtils();

  const createProduct = trpc.product.create.useMutation();
  const createShop    = trpc.shop.create.useMutation();

  const handleFile = async (file: File) => {
    try {
      const data = await parseExcelFile(file);
      setRows(data);
      setErrors([]);
    } catch (e: unknown) {
      setErrors([e instanceof Error ? e.message : "Unknown error"]);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    const errs: string[] = [];
    let success = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        if (type === "products") {
          const code  = row["Код"] || row["code"] || row["Code"] || `IMPORT-${i+1}`;
          const name  = row["Название"] || row["name"] || row["Name"];
          const price = row["Цена"] || row["price"] || row["Price"] || "0";
          if (!name) { errs.push(`Строка ${i+2}: отсутствует название`); continue; }
          await createProduct.mutateAsync({
            code,
            name,
            category:     row["Категория"] || row["category"] || undefined,
            unitPrice:    String(Number(price.toString().replace(/\s/g, ""))),
            reorderPoint: row["Мин. остаток"] || row["reorder"] || "10.00",
          });
        } else {
          const name = row["Название"] || row["name"] || row["Name"];
          if (!name) { errs.push(`Строка ${i+2}: отсутствует название`); continue; }
          await createShop.mutateAsync({
            name,
            ownerName: row["Владелец"] || row["owner"] || undefined,
            phone:     row["Телефон"] || row["phone"] || undefined,
            city:      row["Город"] || row["city"] || undefined,
            address:   row["Адрес"] || row["address"] || undefined,
          });
        }
        success++;
      } catch (e: unknown) {
        errs.push(`Строка ${i+2}: ${e instanceof Error ? e.message : "Unknown error"}`);
      }
    }

    setImporting(false);
    setErrors(errs);

    if (success > 0) {
      notify.success(`Импортировано ${success} записей`);
      if (type === "products") utils.product.list.invalidate();
      else utils.shop.list.invalidate();
      if (errs.length === 0) onDone();
    } else if (errs.length > 0) {
      notify.error("Импорт не удался — проверьте ошибки");
    }
  };

  const template = TEMPLATES[type];
  const typeLabel = type === "products" ? "товаров" : "магазинов";

  return (
    <div className="panel p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-semibold text-text-primary">
          Импорт {typeLabel} из Excel
        </h2>
        <button onClick={onCancel}><X size={18} className="text-text-secondary"/></button>
      </div>

      {/* Template download */}
      <div className="bg-info/10 border border-info/30 rounded p-3 flex items-start gap-3">
        <FileSpreadsheet size={18} className="text-info flex-shrink-0 mt-0.5"/>
        <div>
          <p className="text-sm text-text-primary">
            Скачайте шаблон, заполните данные и загрузите файл.
          </p>
          <p className="text-xs text-text-secondary mt-0.5">
            Обязательные колонки: <b>{template.columns.slice(0,2).join(", ")}</b>
          </p>
          <button onClick={() => downloadTemplate(type)}
            className="text-info text-sm hover:underline mt-1">
            ↓ Скачать шаблон CSV
          </button>
        </div>
      </div>

      {/* File drop zone */}
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          rows.length > 0 ? "border-success/50 bg-success/5" : "border-border-custom hover:border-primary/50"
        }`}
        onClick={() => fileRef.current?.click()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        onDragOver={e => e.preventDefault()}
      >
        <input
          ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        {rows.length > 0 ? (
          <>
            <CheckCircle2 size={32} className="mx-auto text-success mb-2"/>
            <p className="text-success font-medium">{rows.length} строк загружено</p>
            <p className="text-xs text-text-secondary mt-1">Нажмите чтобы заменить файл</p>
          </>
        ) : (
          <>
            <Upload size={32} className="mx-auto text-text-secondary mb-2"/>
            <p className="text-text-primary">Перетащите .xlsx / .csv файл</p>
            <p className="text-xs text-text-secondary mt-1">или нажмите для выбора</p>
          </>
        )}
      </div>

      {/* Preview */}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-surface-light">
                {Object.keys(rows[0]).map(k => (
                  <th key={k} className="text-left px-3 py-2 font-label text-text-secondary">{k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0,5).map((row, i) => (
                <tr key={i} className="border-b border-border-subtle">
                  {Object.values(row).map((v, j) => (
                    <td key={j} className="px-3 py-1.5 text-text-primary">{String(v)}</td>
                  ))}
                </tr>
              ))}
              {rows.length > 5 && (
                <tr>
                  <td colSpan={Object.keys(rows[0]).length}
                    className="px-3 py-2 text-xs text-text-secondary text-center">
                    ... и ещё {rows.length - 5} строк
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div className="bg-danger/10 border border-danger/30 rounded p-3 space-y-1">
          <div className="flex items-center gap-2 text-danger font-medium text-sm">
            <AlertTriangle size={15}/>Ошибки импорта
          </div>
          {errors.slice(0,5).map((e,i) => <p key={i} className="text-xs text-danger">{e}</p>)}
          {errors.length > 5 && <p className="text-xs text-danger">... и ещё {errors.length-5}</p>}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2 border-t border-border-subtle">
        <button
          onClick={handleImport}
          disabled={rows.length === 0 || importing}
          className="btn-primary flex items-center gap-2 disabled:opacity-40"
        >
          {importing ? <Loader2 size={14} className="animate-spin"/> : <Upload size={14}/>}
          {importing ? "Импортирую..." : `Импортировать ${rows.length > 0 ? rows.length + " строк" : ""}`}
        </button>
        <button onClick={onCancel} className="btn-secondary">Отмена</button>
      </div>
    </div>
  );
}
