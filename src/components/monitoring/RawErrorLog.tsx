import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { F, COLORS } from "@/components/users/types";
import { format } from "date-fns";

/**
 * Сырой журнал ошибок — по времени, а не по видам.
 *
 * ── Чем отличается от блока выше ────────────────────────────────────────────
 *
 * Тот группирует ошибки по подписи: «такое случилось сорок раз». Это отвечает
 * на вопрос «что ломается чаще всего», и это нужный вопрос.
 *
 * Но при разборе происшествия вопрос другой: ЧТО ПРОИСХОДИЛО в 14:32. Группы
 * на него не отвечают — порядок в них потерян, и связать «упало сохранение» с
 * «за секунду до этого отвалилась база» по ним нельзя.
 *
 * Ручка sse — то есть system.errors — была написана ровно для этого и не
 * вызывалась ниоткуда.
 *
 * ── Почему свёрнут ──────────────────────────────────────────────────────────
 *
 * Это инструмент разбора, а не наблюдения: открывают его, когда уже что-то
 * случилось. Развёрнутым он занимал бы экран у того, кто пришёл просто
 * посмотреть, всё ли в порядке.
 */
export function RawErrorLog({ onSelectError }: { onSelectError: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pathFilter, setPathFilter] = useState("");

  const q = trpc.system.errors.useQuery(
    { limit: 50, path: pathFilter || undefined },
    { enabled: open },
  );

  const rows = q.data?.errors ?? [];

  return (
    <div style={{
      background: COLORS.surface, borderRadius: "20px", padding: "20px",
      boxShadow: "var(--shadow-sm)",
    }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={() => setOpen(o => !o)}
          style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 700, color: COLORS.textPrimary }}>
          Сырой журнал {open ? "▾" : "▸"}
        </button>
        {open && (
          <input
            className="neo-input"
            style={{ maxWidth: "260px" }}
            placeholder="Фильтр по пути, например /api/orders"
            value={pathFilter}
            onChange={e => setPathFilter(e.target.value)}
          />
        )}
      </div>

      {open && (
        <div className="mt-3">
          {q.isLoading ? (
            <div className="h-20 bg-surface-light animate-pulse rounded-xl" />
          ) : rows.length === 0 ? (
            <p style={{ fontSize: "13px", color: COLORS.textTertiary }}>
              {pathFilter ? "По этому пути ошибок нет" : "Ошибок нет"}
            </p>
          ) : (
            <>
              <div className="space-y-1">
                {rows.map(e => (
                  <button key={e.id} onClick={() => onSelectError(e.id)}
                    className="w-full text-left rounded-lg px-2.5 py-1.5"
                    style={{ background: COLORS.surfaceLight, fontSize: "12px" }}>
                    <span style={{ color: COLORS.textTertiary, fontFamily: "monospace" }}>
                      {format(new Date(e.timestamp), "HH:mm:ss")}
                    </span>
                    {" "}
                    <span style={{ color: "var(--color-danger-text)", fontWeight: 600 }}>{e.code}</span>
                    {" "}
                    <span style={{ color: COLORS.textSecondary }}>{e.path}</span>
                    <span style={{ color: COLORS.textPrimary }}> — {e.message}</span>
                  </button>
                ))}
              </div>
              {/*
                Всего и показано — разные числа: список обрезан полусотней
                последних. Без этой строки человек решил бы, что ошибок ровно
                столько, сколько он видит.
              */}
              <p style={{ fontSize: "11px", color: COLORS.textTertiary, marginTop: "8px" }}>
                Показаны последние {rows.length} из {q.data?.total ?? rows.length}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
