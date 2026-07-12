// Единый компонент Skeleton — используется везде вместо кастомных animate-pulse
import React from "react";
import { cn } from "@/lib/utils";

interface SkeletonProps { className?: string; style?: React.CSSProperties; }

// Базовый блок
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn("animate-pulse rounded-lg", className)}
      style={{ background: "#f3f4f6" }}
    />
  );
}

// Карточка KPI (4 штуки в ряд)
export function SkeletonKpi() {
  return (
    <div className="kpi-card" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>
      <Skeleton className="h-8 w-28" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

// Строка таблицы
export function SkeletonRow({ cols = 5 }: { cols?: number }) {
  const widths = React.useMemo(
    () => Array.from({ length: cols }, (_, i) => `${50 + ((i * 17 + 7) % 50)}%`),
    [cols],
  );
  return (
    <tr>
      {widths.map((w, i) => (
        <td key={i} style={{ padding: "12px 16px" }}>
          <Skeleton className="h-4" style={{ width: w } as React.CSSProperties} />
        </td>
      ))}
    </tr>
  );
}

// Таблица целиком
export function SkeletonTable({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="panel" style={{ overflow: "hidden" }}>
      <div style={{ height: "40px", background: "#f8f9fb", borderBottom: "1px solid #f3f4f6" }} />
      <table style={{ width: "100%" }}>
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <SkeletonRow key={i} cols={cols} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Мобильная карточка
export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <div className="panel" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <Skeleton style={{ width: "40px", height: "40px", borderRadius: "12px", flexShrink: 0 }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px" }}>
          <Skeleton className="h-4" style={{ width: "66%" }} />
          <Skeleton className="h-3" style={{ width: "50%" }} />
        </div>
        <Skeleton style={{ width: "64px", height: "24px", borderRadius: "12px" }} />
      </div>
      {lines > 2 && <Skeleton className="h-3" style={{ width: "100%" }} />}
      {lines > 3 && <Skeleton className="h-3" style={{ width: "80%" }} />}
    </div>
  );
}

// Карточки KPI x4
export function SkeletonKpiGrid() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
      {Array.from({ length: 4 }).map((_, i) => <SkeletonKpi key={i} />)}
    </div>
  );
}

// Страница-заглушка при загрузке
export function SkeletonPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Skeleton style={{ height: "28px", width: "176px" }} />
        <Skeleton style={{ height: "36px", width: "112px", borderRadius: "10px" }} />
      </div>
      <SkeletonKpiGrid />
      <SkeletonTable rows={6} cols={5} />
    </div>
  );
}
