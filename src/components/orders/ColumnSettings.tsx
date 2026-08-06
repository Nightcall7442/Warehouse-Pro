import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Columns3, Eye, EyeOff, GripVertical, Lock, RotateCcw } from "lucide-react";
import {
  DndContext, PointerSensor, KeyboardSensor, closestCenter,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { F, COLORS, SHADOW } from "@/components/reports/report-constants";
import type { ColumnId, OrderColumnDef } from "./order-columns";

/**
 * Which columns the orders table shows, and in what order.
 *
 * Reordering is drag-and-drop because that is what people mean when they say
 * they want to move a column left or right. Keyboard reordering comes with it —
 * dnd-kit's keyboard sensor moves the focused row with the arrow keys — so the
 * feature isn't mouse-only.
 */
export function ColumnSettings({ all, hidden, onToggle, onMove, onReset, isCustomised, t, lang }: {
  all: OrderColumnDef[];
  hidden: ColumnId[];
  onToggle: (id: ColumnId) => void;
  onMove: (from: ColumnId, to: ColumnId) => void;
  onReset: () => void;
  isCustomised: boolean;
  t: (ru: string, uz: string) => string;
  lang: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so a click on the eye icon
    // inside the row is still a click and not an accidental one-pixel drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const place = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    // Right-aligned to the trigger and clamped, so it can't hang off-screen on
    // a narrow window.
    setPos({ top: r.bottom + 8, left: Math.max(8, Math.min(r.right - 300, window.innerWidth - 308)) });
  };

  useEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (over && active.id !== over.id) onMove(active.id as ColumnId, over.id as ColumnId);
  };

  const visibleCount = all.length - hidden.length;

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label={t("Настроить столбцы", "Ustunlarni sozlash")}
        style={{
          display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
          fontSize: "13px", fontWeight: 500, fontFamily: F.body, borderRadius: "10px",
          border: `1px solid ${COLORS.border}`, cursor: "pointer",
          background: isCustomised ? COLORS.surfaceLight : COLORS.surface,
          color: COLORS.textSecondary,
        }}
      >
        <Columns3 size={14} />
        {t("Столбцы", "Ustunlar")}
        {isCustomised && (
          <span style={{
            fontSize: "11px", fontWeight: 600, color: COLORS.primaryText,
            padding: "1px 6px", borderRadius: "999px", background: COLORS.surface,
          }}>
            {visibleCount}/{all.length}
          </span>
        )}
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label={t("Настройка столбцов", "Ustunlarni sozlash")}
          style={{
            position: "fixed", top: pos.top, left: pos.left, width: "300px", zIndex: 60,
            background: COLORS.surface, borderRadius: "14px", boxShadow: SHADOW,
            border: `1px solid ${COLORS.border}`, overflow: "hidden",
          }}
        >
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "12px 14px", borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <span style={{
              fontFamily: F.display, fontSize: "10px", fontWeight: 600,
              textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary,
            }}>
              {t("Столбцы таблицы", "Jadval ustunlari")}
            </span>
            <button
              type="button"
              onClick={onReset}
              disabled={!isCustomised}
              style={{
                display: "flex", alignItems: "center", gap: "4px", padding: "4px 8px",
                fontSize: "11px", fontFamily: F.body, borderRadius: "7px",
                border: "none", background: "transparent",
                cursor: isCustomised ? "pointer" : "default",
                color: isCustomised ? COLORS.primaryText : COLORS.textTertiary,
                opacity: isCustomised ? 1 : 0.5,
              }}
            >
              <RotateCcw size={11} />
              {t("Сбросить", "Tiklash")}
            </button>
          </div>

          <div style={{ maxHeight: "340px", overflowY: "auto", padding: "6px" }}>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={all.map(c => c.id)} strategy={verticalListSortingStrategy}>
                {all.map(col => (
                  <SortableRow
                    key={col.id}
                    col={col}
                    hidden={hidden.includes(col.id)}
                    onToggle={onToggle}
                    t={t}
                    lang={lang}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function SortableRow({ col, hidden, onToggle, t, lang }: {
  col: OrderColumnDef;
  hidden: boolean;
  onToggle: (id: ColumnId) => void;
  t: (ru: string, uz: string) => string;
  lang: string;
}) {
  // A locked column is not sortable at all, so dnd-kit won't let anything be
  // dropped onto it either.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: col.id, disabled: col.locked });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        display: "flex", alignItems: "center", gap: "8px",
        padding: "7px 8px", borderRadius: "8px",
        background: isDragging ? COLORS.surfaceLight : "transparent",
        opacity: isDragging ? 0.9 : 1,
      }}
    >
      {col.locked ? (
        <span
          title={t("Столбец нельзя скрыть или переместить", "Ustunni yashirib yoki ko'chirib bo'lmaydi")}
          style={{ display: "flex", width: "16px", justifyContent: "center", color: COLORS.textTertiary }}
        >
          <Lock size={12} />
        </span>
      ) : (
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={t("Переместить столбец", "Ustunni ko'chirish")}
          style={{
            display: "flex", width: "16px", justifyContent: "center", padding: 0,
            border: "none", background: "transparent", cursor: "grab", color: COLORS.textTertiary,
          }}
        >
          <GripVertical size={14} />
        </button>
      )}

      <span style={{
        flex: 1, minWidth: 0, fontFamily: F.body, fontSize: "13px",
        color: hidden ? COLORS.textTertiary : COLORS.textPrimary,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {lang === "uz" ? col.label.uz : col.label.ru}
      </span>

      <button
        type="button"
        onClick={() => onToggle(col.id)}
        disabled={col.locked}
        aria-pressed={!hidden}
        aria-label={hidden ? t("Показать столбец", "Ustunni ko'rsatish") : t("Скрыть столбец", "Ustunni yashirish")}
        style={{
          display: "flex", padding: "4px", borderRadius: "6px", border: "none",
          background: "transparent", cursor: col.locked ? "default" : "pointer",
          color: col.locked ? COLORS.textTertiary : hidden ? COLORS.textTertiary : COLORS.primaryText,
          opacity: col.locked ? 0.4 : 1,
        }}
      >
        {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}
