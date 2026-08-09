import { useState, useCallback } from "react";
import { Copy, Check } from "lucide-react";
import { COLORS } from "./theme";

interface CopyButtonProps {
  text: string;
}

export function CopyButton({ text }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);
  return (
    <button onClick={handleCopy} style={{ padding: "4px", borderRadius: "4px", background: "none", border: "none", cursor: "pointer", color: COLORS.textTertiary }}>
      {copied ? <Check size={13} style={{ color: COLORS.success }} /> : <Copy size={13} />}
    </button>
  );
}
