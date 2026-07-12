import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { Scan, Package, Search } from "lucide-react";
import { CardDots, Card, PageHeader, inputStyle } from "@/components/DashboardLayout";

export default function Barcode() {
  const [code, setCode] = useState("");
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const { data: product } = trpc.product.getByCode.useQuery({ code }, { enabled: code.length > 0 });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <PageHeader title={t("Сканер штрих-кодов", "Shtrix-kod skaneri")} />

      <Card>
        <div style={{ position: "relative" }}>
          <Scan size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary, #9ca3af)" }} />
          <input placeholder={t("Введите или отсканируйте код...", "Kodni kiriting yoki skanerlang...")} value={code} onChange={e => setCode(e.target.value)} style={{ paddingLeft: "36px" }} className="input-field" autoFocus />
        </div>
      </Card>

      {product && (
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ width: "56px", height: "56px", borderRadius: "14px", background: "var(--color-surface-light, #f3f4f6)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Package size={24} color="var(--color-text-tertiary, #9ca3af)" />
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: "16px", fontWeight: 600, color: "var(--color-text-primary, #111827)", margin: 0 }}>{product.name}</p>
              <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #9ca3af)", margin: "2px 0 0" }}>{product.code} · {product.category ?? ""}</p>
              <p style={{ fontSize: "20px", fontWeight: 700, color: "var(--color-primary, #818cf8)", margin: "8px 0 0" }}>{fmt(Number(product.unitPrice ?? 0))}</p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
