import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useConfirm } from "@/components/ConfirmDialog";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { SearchInput } from "@/components/SearchInput";
import { SectionNotice } from "@/components/SectionNotice";
import { notify } from "@/lib/toast";
import { F, COLORS } from "@/components/users/types";
import { Loader2, Percent, Plus, X } from "lucide-react";

/**
 * Проценты по товарам.
 *
 * ── Зачем появилось ─────────────────────────────────────────────────────────
 *
 * Жалоба арендатора: «система процентов для агентов неправильная, потому что
 * он поставил разные проценты для разных товаров». Процент был один на
 * человека и на всё, что тот продал, — а торгуют товарами с разной наценкой,
 * и платить с них поровну владелец не хочет.
 *
 * ── Почему список исключений, а не таблица всех товаров ─────────────────────
 *
 * У организации тысячи наименований, а особых из них единицы. Таблица со
 * всеми означала бы тысячу полей, из которых заполнены три, и поиск нужного
 * среди пустых. Здесь заводят только исключения: товара нет в списке —
 * действует процент человека, и это ровно то, как считалось до появления
 * раздела.
 *
 * ── Ноль и «убрать» — разные вещи ───────────────────────────────────────────
 *
 * Ноль означает «с этого товара комиссии нет» и ставится осознанно. «Убрать»
 * возвращает товар под общий процент. Свести их в одно значило бы отнять у
 * владельца один из двух ответов.
 */
export function ProductRates({ t }: { t: (ru: string, uz: string) => string }) {
  const utils = trpc.useUtils();
  const { confirm, dialog } = useConfirm();
  const [adding, setAdding] = useState(false);
  // SearchInput придерживает набор сам — своего useDebouncedValue здесь не
  // нужно: два придерживания подряд дают задержку в полсекунды на букву.
  const [search, setSearch] = useState("");
  /*
    Черновики — по товару. Пока человек набирает, на экране его цифра, а на
    сервере прежняя, и путать их нельзя: подставь мы сохранённое поверх
    набранного, поле дёргалось бы под пальцами.
  */
  const [draft, setDraft] = useState<Record<number, string>>({});

  const listQ = trpc.commission.productRates.useQuery();
  const rows = listQ.data ?? [];

  const productsQ = trpc.product.list.useQuery(
    { page: 1, pageSize: 20, search: search.trim() || undefined },
    { enabled: adding },
  );

  const save = trpc.commission.setProductRate.useMutation({
    onSuccess: () => {
      utils.commission.productRates.invalidate();
      notify.success(t("Ставка сохранена", "Stavka saqlandi"));
    },
    onError: (e) => notify.error(e.message),
  });

  const remove = trpc.commission.deleteProductRate.useMutation({
    onSuccess: () => {
      utils.commission.productRates.invalidate();
      notify.success(t("Ставка убрана", "Stavka olib tashlandi"));
    },
    onError: (e) => notify.error(e.message),
  });

  const commit = (productId: number, raw: string | undefined, saved: number) => {
    setDraft(d => { const next = { ...d }; delete next[productId]; return next; });
    if (raw === undefined) return;
    const value = Number(raw.replace(",", "."));
    // Не число или вне границ — молча возвращаем сохранённое: сообщать об
    // опечатке в поле, из которого человек уже ушёл, некуда.
    if (!Number.isFinite(value) || value < 0 || value > 100) return;
    if (Math.abs(value - saved) < 0.005) return;
    save.mutate({ productId, rate: value });
  };

  const drop = async (productId: number, name: string) => {
    const ok = await confirm({
      title: t("Убрать ставку?", "Stavka olib tashlansinmi?"),
      message: t(
        `«${name}» вернётся под общий процент агента. Это не то же самое, что поставить 0%.`,
        `«${name}» agentning umumiy foiziga qaytadi. Bu 0% qo'yish bilan bir xil emas.`,
      ),
      confirmText: t("Убрать", "Olib tashlash"),
    });
    if (ok) remove.mutate({ productId });
  };

  const known = new Set(rows.map(r => r.productId));

  return (
    <div className="neo-card" style={{ padding: "16px 20px 20px" }}>
      {dialog}

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h4 style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 700, color: COLORS.textPrimary, display: "flex", alignItems: "center", gap: "6px" }}>
            <Percent size={14} style={{ color: COLORS.textTertiary }} />
            {t("Проценты по товарам", "Tovarlar bo'yicha foizlar")}
          </h4>
          <p className="text-xs" style={{ color: COLORS.textTertiary, margin: "4px 0 0", maxWidth: "52ch" }}>
            {t(
              "Исключения из процента агента. Товара нет в списке — считается его обычный процент. Ставка одна на товар и действует у всех агентов.",
              "Agent foizidan istisnolar. Ro'yxatda yo'q tovar oddiy foiz bilan hisoblanadi. Stavka tovarga bitta va barcha agentlarda ishlaydi.",
            )}
          </p>
        </div>
        <button
          onClick={() => { setAdding(v => !v); setSearch(""); }}
          className="tap flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0"
          style={{
            background: adding ? "color-mix(in srgb, var(--color-primary) 10%, transparent)" : "var(--color-surface-light)",
            color: adding ? "var(--color-primary)" : COLORS.textSecondary,
          }}
        >
          {adding ? <X size={13} /> : <Plus size={13} />}
          {adding ? t("Закрыть", "Yopish") : t("Добавить товар", "Tovar qo'shish")}
        </button>
      </div>

      {/* ── Выбор товара ───────────────────────────────────────────────── */}
      {adding && (
        <div className="mt-3 space-y-2">
          <SearchInput
            onSearch={setSearch}
            placeholder={t("Название или код товара", "Tovar nomi yoki kodi")}
          />
          {productsQ.isLoading ? (
            <div className="h-10 rounded-xl animate-pulse" style={{ background: "var(--color-surface-light)" }} />
          ) : (productsQ.data?.data ?? []).length === 0 ? (
            <p className="text-xs" style={{ color: COLORS.textTertiary }}>
              {t("Ничего не нашлось", "Hech narsa topilmadi")}
            </p>
          ) : (
            <div className="space-y-1" style={{ maxHeight: "220px", overflowY: "auto" }}>
              {(productsQ.data?.data ?? []).map((p: { id: number; name: string; code?: string | null }) => (
                <button
                  key={p.id}
                  // Товар уже в списке — добавлять нечего: ставка у него есть,
                  // и правится она строкой ниже, а не повторным выбором.
                  disabled={known.has(p.id) || save.isPending}
                  onClick={() => { save.mutate({ productId: p.id, rate: 0 }); setAdding(false); setSearch(""); }}
                  className="tap w-full text-left px-3 py-2 rounded-lg text-sm disabled:opacity-40"
                  style={{ background: "var(--color-surface-light)", color: COLORS.textPrimary }}
                >
                  {p.name}
                  {p.code ? <span style={{ color: COLORS.textTertiary }}> · {p.code}</span> : null}
                  {known.has(p.id) ? <span style={{ color: COLORS.textTertiary }}> · {t("уже в списке", "ro'yxatda bor")}</span> : null}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Заведённые ставки ──────────────────────────────────────────── */}
      <div className="mt-3">
        {listQ.isLoadingError ? (
          <SectionNotice kind="error" message={t("Не удалось загрузить ставки", "Stavkalarni yuklab bo'lmadi")} onRetry={() => listQ.refetch()} />
        ) : listQ.isLoading ? (
          <div className="h-10 rounded-xl animate-pulse" style={{ background: "var(--color-surface-light)" }} />
        ) : rows.length === 0 ? (
          <p className="text-xs" style={{ color: COLORS.textTertiary }}>
            {t("Исключений нет — всем товарам считается процент агента.", "Istisnolar yo'q — barcha tovarlarga agent foizi hisoblanadi.")}
          </p>
        ) : (
          <div className="space-y-1.5">
            {rows.map(r => (
              <div key={r.productId} className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm" style={{ color: COLORS.textPrimary, minWidth: 0 }}>
                  {r.productName || `#${r.productId}`}
                  {r.code ? <span style={{ color: COLORS.textTertiary }}> · {r.code}</span> : null}
                </span>
                <DecimalInput
                  value={draft[r.productId] ?? String(r.rate)}
                  onValueChange={v => setDraft(d => ({ ...d, [r.productId]: v }))}
                  onBlur={() => commit(r.productId, draft[r.productId], r.rate)}
                  inputMode="decimal"
                  aria-label={t(`Процент по товару ${r.productName}`, `${r.productName} bo'yicha foiz`)}
                  className="neo-input text-right"
                  style={{ width: "84px", fontVariantNumeric: "tabular-nums" }}
                />
                <span className="text-xs shrink-0" style={{ color: COLORS.textTertiary, width: "14px" }}>%</span>
                <button
                  onClick={() => drop(r.productId, r.productName || `#${r.productId}`)}
                  disabled={remove.isPending}
                  aria-label={t("Убрать ставку", "Stavkani olib tashlash")}
                  className="tap shrink-0 p-1.5 rounded-lg disabled:opacity-40"
                  style={{ color: COLORS.textTertiary }}
                >
                  {remove.isPending && remove.variables?.productId === r.productId
                    ? <Loader2 size={14} className="animate-spin" />
                    : <X size={14} />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
