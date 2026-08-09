import { useState, useEffect, useCallback } from "react";
import { notify } from "@/lib/toast";
import { colorMix } from "@/lib/color-mix";
import {
  Database, Download, Upload, Loader2, RefreshCw, HardDrive,
  Clock, CheckCircle2, XCircle, AlertTriangle, ChevronDown,
} from "lucide-react";
import { F, COLORS } from "./types";
import { Section, BtnPrimary, BtnSecondary, Modal } from "./ui";

interface BackupStatus {
  healthy: boolean;
  lastBackup: { date: string; success: boolean; message: string; bytes?: number; tables?: Record<string, number> } | null;
  s3: {
    configured: boolean;
    totalBackups: number;
    latestKey: string | null;
    latestSize: number | null;
    latestDate: string | null;
    ageDays: number | null;
  };
}

export function BackupSection() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showRestore, setShowRestore] = useState(false);
  const [restoreKey, setRestoreKey] = useState("");
  const [expanded, setExpanded] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/trpc/system.backupStatus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ 0: { json: {} } }),
      });
      const data = await res.json();
      setStatus(data[0]?.result?.data?.json ?? null);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // ── Actions ──────────────────────────────────────────────────────────────

  async function runFullBackup() {
    setBusy("full");
    try {
      const res = await fetch("/api/cron/backup", { credentials: "include" });
      const data = await res.json();
      if (data.success) {
        notify.success(`Бэкап создан: ${data.message}`);
      } else {
        notify.error(`Ошибка: ${data.message}`);
      }
      fetchStatus();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Ошибка бэкапа");
    } finally {
      setBusy(null);
    }
  }

  async function runIncrementalBackup() {
    setBusy("incremental");
    try {
      const res = await fetch("/api/admin/backup/incremental", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (data.success) {
        notify.success(`Инкрементальный: ${data.message}`);
      } else {
        notify.error(`Ошибка: ${data.message}`);
      }
      fetchStatus();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Ошибка инкрементального бэкапа");
    } finally {
      setBusy(null);
    }
  }

  async function downloadBackup() {
    setBusy("download");
    try {
      const res = await fetch("/api/admin/backup/download", { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `Ошибка ${res.status}` }));
        notify.error(body.error ?? `Ошибка ${res.status}`);
        return;
      }
      const disposition = res.headers.get("content-disposition") ?? "";
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "warehouse-pro-backup.sql.gz";
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      notify.success("Резервная копия скачана");
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Не удалось скачать");
    } finally {
      setBusy(null);
    }
  }

  async function restoreBackup() {
    if (!restoreKey) return;
    setBusy("restore");
    try {
      const res = await fetch("/api/admin/backup/restore", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backupKey: restoreKey, confirm: true }),
      });
      const data = await res.json();
      if (data.success) {
        notify.success(`Восстановление завершено: ${data.message}`);
      } else {
        notify.error(`Ошибка: ${data.message}`);
      }
      setShowRestore(false);
      fetchStatus();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Ошибка восстановления");
    } finally {
      setBusy(null);
    }
  }

  // ── Render helpers ───────────────────────────────────────────────────────

  function StatusDot({ ok }: { ok: boolean }) {
    return (
      <span style={{
        display: "inline-block", width: 8, height: 8, borderRadius: "50%",
        background: ok ? COLORS.success : COLORS.danger,
        boxShadow: ok ? `0 0 6px ${COLORS.success}` : `0 0 6px ${COLORS.danger}`,
      }} />
    );
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  const healthColor = loading ? COLORS.textTertiary : status?.healthy ? COLORS.success : COLORS.danger;
  const healthLabel = loading ? "Загрузка…" : status?.healthy ? "Здоров" : status?.lastBackup?.success === false ? "Ошибка" : "Устарел";

  return (
    <Section title="Резервные копии" icon={Database}>
      {/* ── Status bar ────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
        borderRadius: 12, marginBottom: 20,
        background: status?.healthy ? "rgba(74,222,128,0.06)" : "rgba(232,80,80,0.06)",
        border: `1px solid ${status?.healthy ? "rgba(74,222,128,0.15)" : "rgba(232,80,80,0.15)"}`,
      }}>
        <StatusDot ok={!!status?.healthy} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: F.body, fontSize: 13, fontWeight: 600, color: healthColor }}>
            {healthLabel}
          </div>
          {status?.lastBackup && (
            <div style={{ fontFamily: F.body, fontSize: 11, color: COLORS.textTertiary, marginTop: 2 }}>
              {status.lastBackup.success ? "✓" : "✗"} {status.lastBackup.date} — {status.lastBackup.message.slice(0, 60)}
            </div>
          )}
        </div>
        <button onClick={fetchStatus} disabled={loading}
          style={{ background: "none", border: "none", cursor: "pointer", color: COLORS.textTertiary, padding: 4 }}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* ── S3 info ───────────────────────────────────────────────────────── */}
      {status?.s3 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 20 }}>
          {[
            { label: "S3", value: status.s3.configured ? "Подключён" : "Не настроен", icon: HardDrive },
            { label: "Всего бэкапов", value: String(status.s3.totalBackups), icon: Database },
            { label: "Последний", value: status.s3.ageDays !== null ? `${status.s3.ageDays}д назад" : "—"`, icon: Clock },
            { label: "Размер", value: status.s3.latestSize ? formatBytes(status.s3.latestSize) : "—", icon: Download },
          ].map(kpi => (
            <div key={kpi.label} style={{
              padding: "12px 14px", borderRadius: 10,
              background: COLORS.surfaceLight, border: `1px solid ${COLORS.border}`,
            }}>
              <div style={{ fontFamily: F.body, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: COLORS.textTertiary, marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
                <kpi.icon size={10} />{kpi.label}
              </div>
              <div style={{ fontFamily: F.display, fontSize: 18, fontWeight: 700, color: COLORS.textPrimary }}>{kpi.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Description ───────────────────────────────────────────────────── */}
      <p style={{ fontFamily: F.body, fontSize: 13, lineHeight: 1.7, color: COLORS.textSecondary, marginBottom: 8, maxWidth: 620 }}>
        Полный SQL-дамп базы одним файлом. Разворачивается где угодно — можно
        достать отдельную таблицу или записи, не откатывая всю базу.
      </p>
      <p style={{ fontFamily: F.body, fontSize: 12, lineHeight: 1.7, color: COLORS.textTertiary, marginBottom: 20, maxWidth: 620 }}>
        Инкрементальный бэкап сохраняет только строки, изменённые с полуночи.
        Запускается автоматически каждые 6 часов.
      </p>

      {/* ── Action buttons ────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <BtnPrimary onClick={runFullBackup} disabled={!!busy}>
          {busy === "full"
            ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Создаётся…</>
            : <><Database size={14} /> Полный бэкап</>}
        </BtnPrimary>

        <BtnSecondary onClick={runIncrementalBackup} style={{ opacity: busy ? 0.5 : 1 }}>
          {busy === "incremental"
            ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Создаётся…</>
            : <><Clock size={14} /> Инкрементальный</>}
        </BtnSecondary>

        <BtnSecondary onClick={downloadBackup} style={{ opacity: busy ? 0.5 : 1 }}>
          {busy === "download"
            ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Скачивание…</>
            : <><Download size={14} /> Скачать копию</>}
        </BtnSecondary>

        <BtnSecondary onClick={() => setShowRestore(true)} style={{ opacity: busy ? 0.5 : 1, color: COLORS.danger, borderColor: colorMix(COLORS.danger, 30) }}>
          <Upload size={14} /> Восстановить
        </BtnSecondary>
      </div>

      {/* ── Table counts (expandable) ─────────────────────────────────────── */}
      {status?.lastBackup?.tables && Object.keys(status.lastBackup.tables).length > 0 && (
        <div>
          <button onClick={() => setExpanded(!expanded)}
            style={{ background: "none", border: "none", cursor: "pointer", fontFamily: F.body, fontSize: 12, color: COLORS.textTertiary, display: "flex", alignItems: "center", gap: 4, padding: 0 }}>
            <ChevronDown size={12} style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
            Количество строк по таблицам
          </button>
          {expanded && (
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 6 }}>
              {Object.entries(status.lastBackup.tables).map(([table, count]) => (
                <div key={table} style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", borderRadius: 8, background: COLORS.surfaceLight, fontFamily: F.body, fontSize: 12 }}>
                  <span style={{ color: COLORS.textSecondary }}>{table}</span>
                  <span style={{ fontWeight: 600, color: count === -1 ? COLORS.danger : COLORS.textPrimary }}>
                    {count === -1 ? "err" : count.toLocaleString("ru")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Restore modal ─────────────────────────────────────────────────── */}
      {showRestore && (
        <Modal onClose={() => setShowRestore(false)}>
          <div style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(232,80,80,0.1)" }}>
                <AlertTriangle size={18} color={COLORS.danger} />
              </div>
              <div>
                <h3 style={{ fontFamily: F.display, fontSize: 15, fontWeight: 700, color: COLORS.textPrimary, margin: 0 }}>
                  Восстановление из бэкапа
                </h3>
                <p style={{ fontFamily: F.body, fontSize: 11, color: COLORS.danger, margin: 0 }}>
                  ⚠️ Текущие данные будут перезаписаны
                </p>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontFamily: F.body, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: COLORS.textTertiary, display: "block", marginBottom: 6 }}>
                Ключ бэкапа в S3
              </label>
              <input
                value={restoreKey}
                onChange={e => setRestoreKey(e.target.value)}
                placeholder="backups/warehouse-pro-2026-08-10.sql.gz"
                style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: `1px solid ${COLORS.border}`, background: COLORS.surfaceLight, color: COLORS.textPrimary, fontFamily: "monospace", fontSize: 12, outline: "none" }}
              />
            </div>

            <div style={{ padding: "12px 14px", borderRadius: 10, background: "rgba(232,80,80,0.06)", border: "1px solid rgba(232,80,80,0.15)", marginBottom: 20 }}>
              <p style={{ fontFamily: F.body, fontSize: 12, color: COLORS.textSecondary, margin: 0, lineHeight: 1.6 }}>
                Восстановление заменит все данные в базе на содержимое бэкапа.
                Операция записывается в аудит-лог. Убедитесь что вы выбрали правильный файл.
              </p>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <BtnSecondary onClick={() => setShowRestore(false)}>Отмена</BtnSecondary>
              <BtnPrimary onClick={restoreBackup} disabled={!restoreKey || busy === "restore"}
                style={{ background: COLORS.danger, opacity: (!restoreKey || busy === "restore") ? 0.5 : 1 }}>
                {busy === "restore"
                  ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Восстановление…</>
                  : <><Upload size={14} /> Восстановить</>}
              </BtnPrimary>
            </div>
          </div>
        </Modal>
      )}
    </Section>
  );
}
