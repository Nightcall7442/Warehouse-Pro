import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, ImageOff, Loader2, X, ClipboardList, Store } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { PhotoOrIcon } from "@/components/PhotoOrIcon";
import { PremiumSelect } from "@/components/PremiumSelect";
import { monthEnd, monthLabel } from "./month";

/*
  ── Отчёты о визитах ────────────────────────────────────────────────────────

  Мерчандайзер снимает полку, отмечает по каждому товару «стоит / не стоит»,
  пишет цену, промо и что делают конкуренты. Всё это писалось в базу с самого
  начала — и не показывалось НИКОМУ: три ручки (по магазину, по промежутку дат,
  по одному отчёту) не вызывал ни один экран. Из браузера звали только запись.

  Причина, по которой витрину нельзя было просто нарисовать, лежала в хранении:
  photos — массив JSON с data-url внутри, по мегабайту с лишним каждый. Теперь
  список отдаёт их число, а снимок тянется по ссылке
  /api/photos/report/<id>/<номер> — лениво, по одному, и кэшируется браузером.

  Главное число на карточке — представленность: сколько позиций чек-листа
  стоит на полке из отмеченных. Ради него отчёт и заводят; фотография его
  подтверждает, а не заменяет.
*/

type Checklist = Array<{ productId: number; productName: string; present: boolean; price?: string; promoNote?: string }>;

type Report = {
  id: number;
  shopId: number;
  userId: number;
  planId: number;
  photoCount: number;
  checklist: Checklist | null;
  competitorNotes: string | null;
  createdAt: string | Date;
  userName: string | null;
  shopName: string | null;
};

/** Ссылка на снимок отчёта. Постоянная — иначе браузеру нечего кэшировать. */
const photoUrl = (reportId: number, n: number) => `/api/photos/report/${reportId}/${n}`;

/** Сколько позиций чек-листа стоит на полке. */
function presence(checklist: Checklist | null): { present: number; total: number; pct: number | null } {
  const items = checklist ?? [];
  const total = items.length;
  const present = items.filter(i => i.present).length;
  return { present, total, pct: total > 0 ? Math.round((present / total) * 100) : null };
}

const fmtWhen = (v: string | Date) => {
  const d = new Date(v);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// ── Карточка одного отчёта ────────────────────────────────────────────────────
function ReportCard({ report, onOpen, lang }: { report: Report; onOpen: () => void; lang: string }) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const p = presence(report.checklist);
  /*
    Цвет доли — по смыслу, а не по красоте: ниже половины полка пустая, и это
    повод ехать в точку, а не оттенок в таблице.
  */
  const tone = p.pct === null ? "var(--color-text-tertiary)"
    : p.pct >= 80 ? "var(--color-success-text)"
    : p.pct >= 50 ? "var(--color-warning-text)"
    : "var(--color-danger-text)";

  return (
    <button
      type="button"
      onClick={onOpen}
      className="neo-card row-hover tap"
      style={{
        padding: "14px", textAlign: "left", cursor: "pointer", border: "none",
        display: "flex", flexDirection: "column", gap: "10px", width: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {report.shopName ?? t("Магазин удалён", "Do'kon o'chirilgan")}
          </p>
          <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: "2px 0 0" }}>
            {report.userName ?? "—"} · {fmtWhen(report.createdAt)}
          </p>
        </div>
        {p.pct !== null && (
          <span className="font-data" style={{ fontSize: "16px", fontWeight: 700, color: tone, whiteSpace: "nowrap" }}>
            {p.pct}%
          </span>
        )}
      </div>

      {/* Снимки — превью в ряд. Больше трёх не показываем: остальное в карточке. */}
      {report.photoCount > 0 && (
        <div style={{ display: "flex", gap: "6px" }}>
          {Array.from({ length: Math.min(report.photoCount, 3) }, (_, i) => (
            <PhotoOrIcon
              key={i}
              src={photoUrl(report.id, i)}
              alt={t("Снимок полки", "Javon surati")}
              style={{ width: "56px", height: "56px", borderRadius: "8px", objectFit: "cover", border: "1px solid var(--color-border)" }}
              fallback={<ImageOff size={16} style={{ color: "var(--color-text-tertiary)" }} />}
            />
          ))}
          {report.photoCount > 3 && (
            <span style={{
              width: "56px", height: "56px", borderRadius: "8px",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "var(--color-surface-light)", color: "var(--color-text-secondary)",
              fontSize: "12px", fontWeight: 700,
            }}>
              +{report.photoCount - 3}
            </span>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: "12px", fontSize: "11px", color: "var(--color-text-tertiary)", flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
          <ClipboardList size={12} />
          {p.total > 0
            ? t(`${p.present} из ${p.total} на полке`, `${p.total} tadan ${p.present} tasi javonda`)
            : t("чек-лист пуст", "ro'yxat bo'sh")}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
          <Camera size={12} />
          {report.photoCount || t("без фото", "fotosiz")}
        </span>
        {report.competitorNotes && (
          <span style={{ color: "var(--color-primary-text)" }}>
            {t("есть заметка о конкурентах", "raqobatchilar haqida izoh bor")}
          </span>
        )}
      </div>
    </button>
  );
}

// ── Развёрнутый отчёт ─────────────────────────────────────────────────────────
function ReportModal({ reportId, onClose, lang }: { reportId: number; onClose: () => void; lang: string }) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const { data, isLoading } = trpc.merchandiser.getReportById.useQuery({ id: reportId });
  const p = presence((data?.checklist ?? null) as Checklist | null);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("Отчёт о визите", "Tashrif hisoboti")}
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 60, padding: "16px",
        background: "var(--overlay-scrim, rgba(0,0,0,.45))",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="neo-card"
        style={{ width: "min(720px, 100%)", maxHeight: "90vh", overflowY: "auto", padding: "20px", boxShadow: "var(--shadow-overlay)" }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", marginBottom: "14px" }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>
              {data?.shopName ?? t("Отчёт о визите", "Tashrif hisoboti")}
            </h3>
            <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: "3px 0 0" }}>
              {data ? `${data.userName ?? "—"} · ${fmtWhen(data.createdAt)}` : ""}
              {data?.shopAddress ? ` · ${data.shopAddress}` : ""}
            </p>
          </div>
          <button onClick={onClose} aria-label={t("Закрыть", "Yopish")} className="neo-btn tap"
            style={{ width: "36px", height: "36px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <X size={16} />
          </button>
        </div>

        {isLoading ? (
          <div style={{ padding: "40px", textAlign: "center" }}>
            <Loader2 size={20} style={{ animation: "spin 1s linear infinite", color: "var(--color-primary-text)" }} />
          </div>
        ) : !data ? (
          <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", textAlign: "center", padding: "24px 0" }}>
            {t("Отчёт не найден", "Hisobot topilmadi")}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            {/* Снимки во всю ширину — ради них отчёт и открывают. */}
            {data.photoCount > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "8px" }}>
                {Array.from({ length: data.photoCount }, (_, i) => (
                  <a key={i} href={photoUrl(data.id, i)} target="_blank" rel="noreferrer" style={{ display: "block" }}>
                    <PhotoOrIcon
                      src={photoUrl(data.id, i)}
                      alt={t(`Снимок ${i + 1}`, `${i + 1}-surat`)}
                      style={{ width: "100%", borderRadius: "10px", objectFit: "cover", aspectRatio: "4 / 3", border: "1px solid var(--color-border)" }}
                      fallback={<ImageOff size={20} style={{ color: "var(--color-text-tertiary)" }} />}
                    />
                  </a>
                ))}
              </div>
            )}

            <div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "8px" }}>
                <span className="font-label" style={{ fontSize: "11px", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-secondary)" }}>
                  {t("Чек-лист выкладки", "Javon ro'yxati")}
                </span>
                {p.pct !== null && (
                  <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                    {t(`на полке ${p.present} из ${p.total}`, `${p.total} tadan ${p.present} tasi`)} · <span className="font-data" style={{ fontWeight: 700 }}>{p.pct}%</span>
                  </span>
                )}
              </div>
              {p.total === 0 ? (
                <p style={{ fontSize: "12px", color: "var(--color-text-tertiary)", margin: 0 }}>
                  {t("Чек-лист не заполняли", "Ro'yxat to'ldirilmagan")}
                </p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="data-table" style={{ minWidth: "420px" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>{t("Товар", "Tovar")}</th>
                        <th style={{ textAlign: "center" }}>{t("На полке", "Javonda")}</th>
                        <th style={{ textAlign: "right" }}>{t("Цена", "Narx")}</th>
                        <th style={{ textAlign: "left" }}>{t("Промо", "Promo")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {((data.checklist ?? []) as Checklist).map(item => (
                        <tr key={item.productId} className="row-hover">
                          <td style={{ color: "var(--color-text-primary)" }}>{item.productName}</td>
                          <td style={{ textAlign: "center" }}>
                            <span className="status-badge" style={{
                              fontSize: "10px", padding: "2px 8px",
                              background: item.present ? "var(--color-success-subtle)" : "var(--color-danger-subtle, var(--color-surface-light))",
                              color: item.present ? "var(--color-success-text)" : "var(--color-danger-text)",
                            }}>
                              {item.present ? t("да", "ha") : t("нет", "yo'q")}
                            </span>
                          </td>
                          <td className="font-data" style={{ textAlign: "right", color: "var(--color-text-secondary)" }}>{item.price || "—"}</td>
                          <td style={{ color: "var(--color-text-tertiary)", fontSize: "12px" }}>{item.promoNote || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {data.competitorNotes && (
              <div>
                <span className="font-label" style={{ fontSize: "11px", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-secondary)", display: "block", marginBottom: "6px" }}>
                  {t("Конкуренты", "Raqobatchilar")}
                </span>
                <p style={{ fontSize: "13px", color: "var(--color-text-primary)", margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                  {data.competitorNotes}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── Вкладка «Отчёты» ──────────────────────────────────────────────────────────
export function VisitReports({ month, lang }: { month: string; lang: string }) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const [openId, setOpenId] = useState<number | null>(null);
  const [agentId, setAgentId] = useState(0);

  const { data: agents = [] } = trpc.agent.listAgents.useQuery();
  const { data, isLoading } = trpc.merchandiser.getReportsByDateRange.useQuery({
    dateFrom: `${month}-01`,
    dateTo: monthEnd(month),
    page: 1,
    pageSize: 200,
  });

  /*
    Отбор по сотруднику — на экране, а не запросом.

    Ручка отбирать по сотруднику не умеет, а месяц отчётов у организации — это
    десятки строк, не тысячи. Городить ради этого новый вход в API значит
    менять контракт, которым уже пользуется мобильное приложение.
  */
  const rows = useMemo(() => {
    const all = (data?.data ?? []) as Report[];
    return agentId > 0 ? all.filter(r => r.userId === agentId) : all;
  }, [data, agentId]);

  const totals = useMemo(() => {
    const withList = rows.filter(r => (r.checklist ?? []).length > 0);
    const present = withList.reduce((s, r) => s + presence(r.checklist).present, 0);
    const total = withList.reduce((s, r) => s + presence(r.checklist).total, 0);
    return {
      reports: rows.length,
      photos: rows.reduce((s, r) => s + r.photoCount, 0),
      pct: total > 0 ? Math.round((present / total) * 100) : null,
    };
  }, [rows]);

  return (
    <div className="neo-card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
      {openId !== null && <ReportModal reportId={openId} onClose={() => setOpenId(null)} lang={lang} />}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <div>
          <h3 style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>
            {t("Отчёты о визитах за", "Tashrif hisobotlari")} {monthLabel(month, lang).toLowerCase()}
          </h3>
          <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: "4px 0 0" }}>
            {totals.reports > 0
              ? t(
                `${totals.reports} отчётов · ${totals.photos} снимков${totals.pct !== null ? ` · представленность ${totals.pct}%` : ""}`,
                `${totals.reports} hisobot · ${totals.photos} surat${totals.pct !== null ? ` · ${totals.pct}%` : ""}`,
              )
              : t("Фото полки, чек-лист выкладки и заметки о конкурентах.", "Javon surati, ro'yxat va raqobatchilar haqida izoh.")}
          </p>
        </div>
        <PremiumSelect
          value={String(agentId)}
          onChange={v => setAgentId(Number(v))}
          width="200px"
          options={[
            { value: "0", label: t("Все сотрудники", "Barcha xodimlar") },
            ...agents.map(a => ({ value: String(a.id), label: a.name })),
          ]}
        />
      </div>

      {isLoading ? (
        <div style={{ padding: "40px", textAlign: "center" }}>
          <Loader2 size={20} style={{ animation: "spin 1s linear infinite", color: "var(--color-primary-text)" }} />
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: "40px", textAlign: "center" }}>
          <Store size={28} style={{ margin: "0 auto 10px", opacity: 0.2, color: "var(--color-text-tertiary)" }} />
          <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", margin: 0 }}>
            {t("За этот месяц отчётов нет", "Bu oyda hisobot yo'q")}
          </p>
          <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: "6px 0 0" }}>
            {t("Отчёт сдаёт мерчандайзер с экрана визита в мобильном приложении.",
               "Hisobotni merchandayzer mobil ilovadagi tashrif ekranidan yuboradi.")}
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
          {rows.map(r => (
            <ReportCard key={r.id} report={r} lang={lang} onOpen={() => setOpenId(r.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Отчёты одной точки — для карточки магазина ────────────────────────────────
/**
 * Что привозили с визитов В ЭТУ точку.
 *
 * Отдельно от витрины за месяц, потому что вопрос другой: не «как поработали
 * в сентябре», а «что у этого магазина на полке». Ручка getReportsByShop под
 * это и написана — и до сих пор её не звал никто.
 */
export function ShopVisitReports({ shopId, lang }: { shopId: number; lang: string }) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const [openId, setOpenId] = useState<number | null>(null);
  const { data, isLoading } = trpc.merchandiser.getReportsByShop.useQuery({ shopId, page: 1, pageSize: 10 });
  const rows = (data?.data ?? []) as Report[];

  if (isLoading) {
    return (
      <div style={{ padding: "20px", textAlign: "center" }}>
        <Loader2 size={16} style={{ animation: "spin 1s linear infinite", color: "var(--color-primary-text)" }} />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <p style={{ fontSize: "12px", color: "var(--color-text-tertiary)", margin: 0, padding: "12px 0" }}>
        {t("По этой точке отчётов о визитах ещё нет.", "Bu do'kon bo'yicha tashrif hisobotlari yo'q.")}
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {openId !== null && <ReportModal reportId={openId} onClose={() => setOpenId(null)} lang={lang} />}
      {rows.map(r => {
        const p = presence(r.checklist);
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => setOpenId(r.id)}
            className="row-hover tap"
            style={{
              display: "flex", alignItems: "center", gap: "10px", padding: "8px 10px",
              borderRadius: "10px", background: "var(--color-surface-light)",
              border: "none", cursor: "pointer", textAlign: "left", width: "100%",
            }}
          >
            {r.photoCount > 0 ? (
              <PhotoOrIcon
                src={photoUrl(r.id, 0)}
                alt={t("Снимок полки", "Javon surati")}
                style={{ width: "40px", height: "40px", borderRadius: "8px", objectFit: "cover", flexShrink: 0, border: "1px solid var(--color-border)" }}
                fallback={<ImageOff size={14} style={{ color: "var(--color-text-tertiary)" }} />}
              />
            ) : (
              <span style={{
                width: "40px", height: "40px", borderRadius: "8px", flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "var(--color-surface)", color: "var(--color-text-tertiary)",
              }}>
                <Camera size={14} />
              </span>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>
                {fmtWhen(r.createdAt)} · {r.userName ?? "—"}
              </p>
              <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: "2px 0 0" }}>
                {p.total > 0
                  ? t(`на полке ${p.present} из ${p.total}`, `${p.total} tadan ${p.present} tasi`)
                  : t("без чек-листа", "ro'yxatsiz")}
                {r.photoCount > 0 ? ` · ${r.photoCount} ${t("фото", "surat")}` : ""}
              </p>
            </div>
            {p.pct !== null && (
              <span className="font-data" style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-secondary)" }}>
                {p.pct}%
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
