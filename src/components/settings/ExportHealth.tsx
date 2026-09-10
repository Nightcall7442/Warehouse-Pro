import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { format } from "date-fns";
import { Activity, AlertTriangle, CheckCircle2 } from "lucide-react";
import { FieldGroup } from "./ui";

/**
 * Состояние выгрузки наружу за сутки.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * Отвечает на единственный вопрос, который задают про интеграцию: «она
 * работает?». Раньше ответить было нечем — ни следа того, что мы отдали, ни
 * того, чем ответили, — и разговор с интегратором сводился к тому, кто
 * увереннее. Приёмка BEKDRINKS требует этого прямо (17-H): в суточном
 * испытании записаны последняя успешная выгрузка и ошибки.
 *
 * ── Чего здесь нет ──────────────────────────────────────────────────────────
 *
 * Выводов получателя. Сошлась ли у него сверка, не задвоил ли он строки и
 * скольких недосчитался — знает только он. Здесь НАША половина: что отдали,
 * с какой точки продолжат и что за отказ был последним. Выдавать чужую
 * половину за свою нельзя — по ней принимают решение о том, публиковать ли
 * отчёт.
 */
export function ExportHealth() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);

  const q = trpc.apiKey.exportHealth.useQuery();
  const h = q.data;

  /*
    Список обращений грузится только когда его попросили.

    Он нужен для разбора спора, а не для ежедневного взгляда: сводки выше
    хватает, чтобы понять, жив ли обмен. Тянуть полсотни строк на каждый
    заход в настройки ради этого незачем.
  */
  const [showLog, setShowLog] = useState(false);
  const logQ = trpc.apiKey.exportLog.useQuery({ limit: 50 }, { enabled: showLog });

  if (q.isLoading) return <div className="h-16 bg-surface-light animate-pulse rounded-xl" />;
  if (!h) return null;

  const when = (d: Date | string | null) =>
    d ? format(new Date(d), "dd.MM.yyyy HH:mm") : t("не было", "bo'lmagan");

  /*
    Раздел, а не карточка внутри карточки: экран настроек и так карточка, и
    вложенная давала бы вторую рамку вокруг того же самого. Подпись — обычным
    регистром через общий FieldGroup: капс в строке нельзя ни перевести
    аккуратно, ни озвучить — скринридер читает его по буквам.
  */
  return (
    <FieldGroup title={t("Обмен за сутки", "Sutkalik almashinuv")}>
      <p className="text-xs text-secondary mb-2.5 flex items-center gap-1.5">
        <Activity size={12} /> {t("Что мы отдали наружу и чем ответили", "Tashqariga nima berdik va qanday javob berdik")}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px" }}>
        <div>
          <p className="text-xs text-secondary">{t("Последняя удачная", "Oxirgi muvaffaqiyatli")}</p>
          <p className="text-sm font-medium text-primary flex items-center gap-1.5">
            {h.lastSuccessAt && <CheckCircle2 size={13} className="text-success" />}
            {when(h.lastSuccessAt)}
          </p>
        </div>
        <div>
          <p className="text-xs text-secondary">{t("Обращений", "So'rovlar")}</p>
          <p className="text-sm font-data font-medium text-primary">{h.requests24h}</p>
        </div>
        <div>
          <p className="text-xs text-secondary">{t("Отдано строк", "Berilgan qatorlar")}</p>
          <p className="text-sm font-data font-medium text-primary">{h.rows24h}</p>
        </div>
        <div>
          <p className="text-xs text-secondary">{t("Отказов", "Rad javoblar")}</p>
          <p className={`text-sm font-data font-medium ${h.errors24h > 0 ? "text-danger" : "text-primary"}`}>
            {h.errors24h}
          </p>
        </div>
      </div>

      {h.lastError && (
        <p className="text-xs text-danger mt-2.5 flex items-start gap-1.5">
          <AlertTriangle size={12} style={{ marginTop: "2px", flexShrink: 0 }} />
          <span>
            {when(h.lastError.at)} · {h.lastError.status} · {h.lastError.message ?? "—"}
          </span>
        </p>
      )}

      {/*
        Точка возобновления показывается нарочно: именно с неё получатель
        продолжает после обрыва связи, и когда он говорит «мы всё потеряли»,
        сверяют первым делом её.
      */}
      {h.lastCursor && (
        <p className="text-[11px] text-tertiary mt-2 truncate" title={h.lastCursor}>
          {t("Точка возобновления", "Davom etish nuqtasi")}: <span className="font-mono">{h.lastCursor.slice(0, 40)}…</span>
        </p>
      )}

      <button
        type="button"
        className="neo-btn mt-3"
        style={{ fontSize: "12px", padding: "6px 12px" }}
        onClick={() => setShowLog(v => !v)}
      >
        {showLog ? t("Скрыть обращения", "So'rovlarni yashirish") : t("Показать обращения", "So'rovlarni ko'rsatish")}
      </button>

      {showLog && (
        <div style={{ overflowX: "auto", marginTop: "10px" }}>
          {logQ.isLoading ? (
            <div className="h-10 bg-surface-light animate-pulse rounded-xl" />
          ) : !logQ.data?.length ? (
            <p className="text-xs text-tertiary">{t("Обращений не было", "So'rovlar bo'lmagan")}</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
              <thead>
                <tr className="text-secondary">
                  <th style={{ textAlign: "left", padding: "4px 8px 4px 0" }}>{t("Когда", "Qachon")}</th>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>{t("Режим", "Rejim")}</th>
                  <th style={{ textAlign: "right", padding: "4px 8px" }}>{t("Ответ", "Javob")}</th>
                  <th style={{ textAlign: "right", padding: "4px 8px" }}>{t("Строк", "Qator")}</th>
                  <th style={{ textAlign: "right", padding: "4px 8px" }}>{t("Всего", "Jami")}</th>
                  <th style={{ textAlign: "right", padding: "4px 0 4px 8px" }}>{t("мс", "ms")}</th>
                </tr>
              </thead>
              <tbody>
                {logQ.data.map(r => (
                  <tr key={r.id} className="text-primary">
                    <td style={{ padding: "4px 8px 4px 0", whiteSpace: "nowrap" }}>{format(new Date(r.createdAt), "dd.MM HH:mm:ss")}</td>
                    <td style={{ padding: "4px 8px" }}>{r.mode === "changes" ? t("изменения", "o'zgarishlar") : t("снимок", "suratlar")}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right" }} className={r.httpStatus >= 300 ? "text-danger" : ""}>
                      {r.httpStatus}
                    </td>
                    <td style={{ padding: "4px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.rows}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.totalCount ?? "—"}</td>
                    <td style={{ padding: "4px 0 4px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.durationMs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </FieldGroup>
  );
}
