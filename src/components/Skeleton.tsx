// Единый компонент Skeleton — используется везде вместо кастомных animate-pulse
import React from "react";
import { cn } from "@/lib/utils";

interface SkeletonProps { className?: string; style?: React.CSSProperties; }

// Базовый блок
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn("animate-pulse rounded-lg", className)}
      style={{ background: "var(--color-surface-light)" }}
    />
  );
}

// Карточка KPI (4 штуки в ряд)
export function SkeletonKpi() {
  return (
    <div className="kpi-card space-y-3">
      <div className="flex justify-between">
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
        <td key={i} className="px-4 py-3">
          <Skeleton className="h-4" style={{ width: w } as React.CSSProperties} />
        </td>
      ))}
    </tr>
  );
}

// Таблица целиком
export function SkeletonTable({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="panel overflow-hidden">
      <div className="h-10 bg-surface-light border-b" style={{ borderColor: "var(--color-border)" }} />
      <table className="w-full">
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
    <div className="panel p-4 space-y-3">
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10 rounded-xl flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
      {lines > 2 && <Skeleton className="h-3 w-full" />}
      {lines > 3 && <Skeleton className="h-3 w-4/5" />}
    </div>
  );
}

// Карточки KPI x4
export function SkeletonKpiGrid() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {Array.from({ length: 4 }).map((_, i) => <SkeletonKpi key={i} />)}
    </div>
  );
}

// Страница-заглушка при загрузке
export function SkeletonPage() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      <SkeletonKpiGrid />
      <SkeletonTable rows={6} cols={5} />
    </div>
  );
}
