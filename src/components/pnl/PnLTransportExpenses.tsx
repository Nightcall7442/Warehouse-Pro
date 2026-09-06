import { format } from "date-fns";
import { F, COLORS, thStyle, tdStyle, numeric } from "./styles";
import { SectionNotice } from "./SectionNotice";

interface Arrival {
  id: number;
  arrivalNumber: string;
  arrivalDate: Date | string | null;
  truckId: string | null;
  fuelCost: number | string;
  tollCost: number | string;
  otherCost?: number | string;
  totalExpense: number | string;
  status: string;
}

interface PnLTransportExpensesProps {
  arrivals: Arrival[] | undefined;
  /** Границы периода — те же, по которым сервер считает расходы в карточке. */
  from: string;
  to: string;
  error?: boolean;
  onRetry?: () => void;
  fmt: (value: number) => string;
  lang: string;
}

const SHOWN = 20;

/** День прихода в виде «2026-08-14» — для сравнения с границами периода. */
function day(value: Date | string | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : format(d, "yyyy-MM-dd");
}

export function PnLTransportExpenses({
  arrivals,
  from,
  to,
  error,
  onRetry,
  fmt,
  lang,
}: PnLTransportExpensesProps) {
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);

  /*
    Отбор по периоду был потерян целиком.

    Раздел фильтровал приходы только по статусу «completed» и показывал первые
    двадцать из последней тысячи — то есть за всё время работы, — а подпись под
    пустым списком говорила «Нет завершённых приходов ЗА ПЕРИОД». Карточка
    «Расходы на доставку» вверху страницы при этом считается сервером строго по
    выбранным датам. Две цифры об одном и том же на одном экране расходились, и
    сойтись не могли: в таблице лежал другой отрезок времени.

    Потолок здесь остаётся: запрос берёт тысячу последних приходов без учёта
    дат, поэтому для давнего периода нужных строк в этой тысяче может уже не
    быть. Чинится это фильтром по датам в arrival.list — файл не наш.
  */
  const rows = (Array.isArray(arrivals) ? arrivals : [])
    .filter((a) => {
      if (a.status !== "completed") return false;
      const d = day(a.arrivalDate);
      return d !== null && d >= from && d <= to;
    })
    .map((a) => ({ ...a, expense: Number(a.totalExpense) || 0 }))
    .sort((a, b) => b.expense - a.expense);

  const total = rows.reduce((s, a) => s + a.expense, 0);
  const shown = rows.slice(0, SHOWN);

  return (
    <div className="neo-card neo-card-static" style={{ padding: "24px" }}>
      <h2
        style={{
          fontFamily: F.display,
          fontSize: "16px",
          fontWeight: 600,
          color: COLORS.textPrimary,
          margin: "0 0 4px",
        }}
      >
        {t("Куда ушло на доставку", "Yetkazishga qayerga ketdi")}
      </h2>
      <p style={{ margin: "0 0 20px", fontSize: "12px", color: COLORS.textTertiary }}>
        {t(
          "Завершённые приходы за выбранный период, от самого дорогого",
          "Tanlangan davrdagi yakunlangan kirimlar, eng qimmatidan"
        )}
      </p>

      {error ? (
        <SectionNotice
          kind="error"
          message={t("Не удалось загрузить приходы.", "Kirimlarni yuklab bo'lmadi.")}
          onRetry={onRetry}
          retryLabel={t("Повторить", "Qayta urinish")}
        />
      ) : rows.length === 0 ? (
        <SectionNotice
          kind="empty"
          message={t(
            "За выбранный период завершённых приходов не было.",
            "Tanlangan davrda yakunlangan kirim bo'lmagan."
          )}
        />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("Приход", "Kirim")}</th>
                <th style={thStyle}>{t("Дата", "Sana")}</th>
                <th style={thStyle}>{t("Машина", "Mashina")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("Топливо", "Yoqilg'i")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("Дорога", "Yo'l")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("Итого", "Jami")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => (
                <tr
                  key={a.id}
                  style={{ transition: "background 0.15s" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background =
                      "color-mix(in srgb, var(--color-primary) 4%, transparent)")
                  }
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <td style={{ ...tdStyle, fontWeight: 500 }}>{a.arrivalNumber}</td>
                  <td style={{ ...tdStyle, color: COLORS.textSecondary }}>
                    {a.arrivalDate ? format(new Date(a.arrivalDate), "dd.MM.yyyy") : "—"}
                  </td>
                  <td style={{ ...tdStyle, color: COLORS.textSecondary }}>{a.truckId ?? "—"}</td>
                  <td style={{ ...tdStyle, ...numeric, color: COLORS.textSecondary }}>
                    {fmt(Number(a.fuelCost) || 0)}
                  </td>
                  <td style={{ ...tdStyle, ...numeric, color: COLORS.textSecondary }}>
                    {fmt(Number(a.tollCost) || 0)}
                  </td>
                  <td style={{ ...tdStyle, ...numeric, fontWeight: 700 }}>{fmt(a.expense)}</td>
                </tr>
              ))}
              <tr style={{ background: COLORS.surfaceLight }}>
                <td
                  colSpan={5}
                  style={{ ...tdStyle, fontWeight: 700, borderTop: `2px solid ${COLORS.border}` }}
                >
                  {/* Итог считается по ВСЕМ приходам периода, а не только по
                      показанным двадцати: иначе он расходился бы с карточкой
                      «Расходы на доставку» наверху. */}
                  {t("Итого за период", "Davr uchun jami")}
                  {rows.length > shown.length && (
                    <span style={{ fontWeight: 500, color: COLORS.textTertiary }}>
                      {t(
                        ` — показаны ${shown.length} прихода из ${rows.length}`,
                        ` — ${rows.length} tadan ${shown.length} tasi ko'rsatilgan`
                      )}
                    </span>
                  )}
                </td>
                <td
                  style={{
                    ...tdStyle,
                    ...numeric,
                    fontWeight: 700,
                    borderTop: `2px solid ${COLORS.border}`,
                    color: "var(--color-danger-text)",
                  }}
                >
                  {fmt(total)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
