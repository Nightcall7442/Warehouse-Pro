import React from "react";
import { F, COLORS } from "./styles";

interface DateInputProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
}

export function DateInput({ value, onChange, label }: DateInputProps) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <span
        style={{
          fontSize: "10px",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: COLORS.textTertiary,
          fontFamily: F.body,
        }}
      >
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: "7px 10px",
          fontSize: "13px",
          fontFamily: F.body,
          borderRadius: "8px",
          border: `1px solid ${COLORS.border}`,
          background: COLORS.surfaceLight,
          color: COLORS.textPrimary,
          outline: "none",
          width: "140px",
        }}
      />
    </label>
  );
}
