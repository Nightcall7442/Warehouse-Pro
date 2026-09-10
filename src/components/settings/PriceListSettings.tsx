import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { useConfirm } from "@/components/ConfirmDialog";
import { PremiumSelect } from "@/components/PremiumSelect";
import { SectionNotice } from "@/components/SectionNotice";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { notify } from "@/lib/toast";
import { F, COLORS } from "@/components/users/types";
import { FieldGroup, FieldRow } from "@/components/settings/ui";
import { ArrowLeft, Plus, Store, Tag, Trash2, X } from "lucide-react";

/**
 * Прайс-листы: свои цены для магазина, категории или объёма.
 *
 * ── Зачем появилось ─────────────────────────────────────────────────────────
 *
 * Мобильное приложение прайс-листы ЧИТАЕТ — агент видит в заказе цену,
 * назначенную его магазину. А завести их было нечем: семь ручек управления
 * (создать, переименовать, удалить, положить товар, убрать товар, привязать
 * магазин, отвязать) написаны и не вызывались ниоткуда.
 *
 * То есть возможность продавать разным магазинам по разной цене существовала
 * ровно до первого вопроса «а где их создать».
 *
 * ── Почему приоритет виден человеку ─────────────────────────────────────────
 *
 * Магазину может подойти несколько списков сразу, и цену даёт тот, у кого
 * приоритет ВЫШЕ. Прятать это число — значит оставить человека гадать, почему
 * в заказе не та цена, которую он только что вписал.
 */

type Detail = { id: number; name: string } | null;

const TYPE_KEYS = ["shop", "tier", "volume"] as const;
type ListType = (typeof TYPE_KEYS)[number];

export function PriceListSettings() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { confirm, dialog } = useConfirm();
  const utils = trpc.useUtils();

  const [open, setOpen] = useState<Detail>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<{ name: string; type: ListType; priority: string; description: string }>(
    { name: "", type: "shop", priority: "0", description: "" },
  );

  const TYPE_LABEL: Record<ListType, string> = {
    shop:   t("для магазина", "do'kon uchun"),
    tier:   t("по категории", "toifa bo'yicha"),
    volume: t("за объём", "hajm uchun"),
  };

  const listQ = trpc.priceList.list.useQuery();

  const create = trpc.priceList.create.useMutation({
    onSuccess: () => {
      notify.success(t("Прайс-лист создан", "Narx ro'yxati yaratildi"));
      utils.priceList.list.invalidate();
      setCreating(false);
      setForm({ name: "", type: "shop", priority: "0", description: "" });
    },
    onError: e => notify.error(e.message),
  });

  const update = trpc.priceList.update.useMutation({
    onSuccess: () => { utils.priceList.list.invalidate(); },
    onError: e => notify.error(e.message),
  });

  const remove = trpc.priceList.delete.useMutation({
    onSuccess: () => {
      notify.success(t("Прайс-лист удалён", "Narx ro'yxati o'chirildi"));
      utils.priceList.list.invalidate();
      setOpen(null);
    },
    onError: e => notify.error(e.message),
  });

  const onDelete = async (id: number, name: string) => {
    const ok = await confirm({
      title: t("Удалить прайс-лист?", "Narx ro'yxati o'chirilsinmi?"),
      message: t(
        `«${name}»: магазины, которым он назначен, вернутся к обычной цене товара.`,
        `«${name}»: unga bog'langan do'konlar oddiy narxga qaytadi.`,
      ),
      confirmText: t("Удалить", "O'chirish"),
      danger: true,
    });
    if (ok) remove.mutate({ id });
  };

  if (open) return <PriceListDetail list={open} onBack={() => setOpen(null)} onDelete={onDelete} />;

  const lists = listQ.data ?? [];

  return (
    <div className="space-y-4">
      {dialog}

      <div className="flex items-center justify-between gap-3">
        <p style={{ fontSize: "13px", color: COLORS.textSecondary }}>
          {t(
            "Цену даёт список с бо́льшим приоритетом",
            "Narxni yuqori ustuvorlikdagi ro'yxat beradi",
          )}
        </p>
        <button className="neo-btn-primary" onClick={() => setCreating(c => !c)}
          style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Plus size={15} />{t("Создать", "Yaratish")}
        </button>
      </div>

      {creating && (
        <FieldGroup title={t("Новый прайс-лист", "Yangi narx ro'yxati")}>
          <FieldRow>
            <label className="space-y-1">
              <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>{t("Название", "Nomi")}</span>
              <input className="neo-input w-full" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </label>
            <label className="space-y-1">
              <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>{t("Вид", "Turi")}</span>
              <PremiumSelect
                value={form.type}
                onChange={v => setForm(f => ({ ...f, type: v as ListType }))}
                options={TYPE_KEYS.map(k => ({ value: k, label: TYPE_LABEL[k] }))}
              />
            </label>
            <label className="space-y-1">
              <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>
                {t("Приоритет — чем больше, тем важнее", "Ustuvorlik — qancha katta, shuncha muhim")}
              </span>
              <DecimalInput className="neo-input w-full" value={form.priority}
                onValueChange={v => setForm(f => ({ ...f, priority: v }))} />
            </label>
            <label className="space-y-1">
              <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>{t("Описание", "Tavsif")}</span>
              <input className="neo-input w-full" value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </label>
          </FieldRow>
          <div className="flex justify-end gap-2 mt-4">
            <button className="neo-btn" onClick={() => setCreating(false)}>{t("Отмена", "Bekor")}</button>
            <button className="neo-btn-primary" disabled={create.isPending}
              onClick={() => {
                if (!form.name.trim()) return notify.error(t("Укажите название", "Nomini kiriting"));
                create.mutate({
                  name: form.name.trim(),
                  type: form.type,
                  priority: Number(form.priority) || 0,
                  description: form.description || undefined,
                });
              }}>
              {t("Создать", "Yaratish")}
            </button>
          </div>
        </FieldGroup>
      )}

      {listQ.isLoadingError ? (
        <SectionNotice kind="error" message={t("Не удалось загрузить прайс-листы", "Narx ro'yxatlarini yuklab bo'lmadi")} onRetry={() => listQ.refetch()} />
      ) : listQ.isLoading ? (
        <div className="space-y-2">{[1, 2].map(i => <div key={i} className="h-16 bg-surface-light animate-pulse rounded-xl" />)}</div>
      ) : lists.length === 0 ? (
        <SectionNotice kind="empty" message={t(
          "Прайс-листов нет — все магазины покупают по обычной цене товара",
          "Narx ro'yxatlari yo'q — barcha do'konlar oddiy narxda oladi",
        )} />
      ) : (
        <div className="space-y-2">
          {lists.map(l => (
            <div key={l.id} className="rounded-2xl p-3.5" style={{ background: COLORS.surfaceLight }}>
              <div className="flex items-start justify-between gap-3">
                <button className="text-left" style={{ minWidth: 0 }} onClick={() => setOpen({ id: l.id, name: l.name })}>
                  <div style={{ fontFamily: F.display, fontWeight: 600, color: COLORS.textPrimary }}>
                    {l.name}
                    {!l.isActive && (
                      <span style={{ marginLeft: "8px", fontSize: "11px", color: COLORS.textTertiary }}>
                        · {t("выключен", "o'chirilgan")}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "12px", color: COLORS.textTertiary }}>
                    {TYPE_LABEL[l.type as ListType] ?? l.type}
                    {" · "}{t("приоритет", "ustuvorlik")} {l.priority}
                    {" · "}{Number(l.itemCount)} {t("товаров", "mahsulot")}
                    {" · "}{Number(l.shopCount)} {t("магазинов", "do'kon")}
                  </div>
                </button>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    className="neo-btn"
                    style={{ fontSize: "12px", padding: "6px 10px" }}
                    onClick={() => update.mutate({ id: l.id, isActive: !l.isActive })}
                  >
                    {l.isActive ? t("Выключить", "O'chirish") : t("Включить", "Yoqish")}
                  </button>
                  <button className="neo-btn text-danger" style={{ padding: "6px 8px" }}
                    aria-label={t("Удалить", "O'chirish")}
                    onClick={() => onDelete(l.id, l.name)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Содержимое одного прайс-листа: товары с ценами и магазины, которым он назначен. */
function PriceListDetail({ list, onBack, onDelete }: {
  list: { id: number; name: string };
  onBack: () => void;
  onDelete: (id: number, name: string) => void;
}) {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const utils = trpc.useUtils();

  const [productSearch, setProductSearch] = useState("");
  const [picked, setPicked] = useState<{ id: number; name: string } | null>(null);
  const [price, setPrice] = useState("");
  const [minQuantity, setMinQuantity] = useState("1");
  const [shopId, setShopId] = useState("");

  const detailQ = trpc.priceList.getById.useQuery({ id: list.id });
  const productsQ = trpc.product.list.useQuery(
    { page: 1, pageSize: 20, search: productSearch || undefined },
    { enabled: productSearch.length >= 2 },
  );
  const shopsQ = trpc.shop.list.useQuery({ page: 1, pageSize: 500 });

  const refresh = () => {
    utils.priceList.getById.invalidate({ id: list.id });
    utils.priceList.list.invalidate();
  };

  const upsert = trpc.priceList.upsertItem.useMutation({
    onSuccess: () => {
      notify.success(t("Цена сохранена", "Narx saqlandi"));
      refresh();
      setPicked(null); setProductSearch(""); setPrice(""); setMinQuantity("1");
    },
    onError: e => notify.error(e.message),
  });
  const removeItem = trpc.priceList.removeItem.useMutation({
    onSuccess: () => { refresh(); }, onError: e => notify.error(e.message),
  });
  const assign = trpc.priceList.assignShop.useMutation({
    onSuccess: () => { notify.success(t("Магазин привязан", "Do'kon bog'landi")); refresh(); setShopId(""); },
    onError: e => notify.error(e.message),
  });
  const unassign = trpc.priceList.unassignShop.useMutation({
    onSuccess: () => { refresh(); }, onError: e => notify.error(e.message),
  });

  const items = detailQ.data?.items ?? [];
  const assignments = detailQ.data?.assignments ?? [];
  const assignedIds = new Set(assignments.map(a => a.shopId));
  const shopOptions = (shopsQ.data?.data ?? [])
    .filter(s => !assignedIds.has(s.id))
    .map(s => ({ value: String(s.id), label: s.name }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <button className="neo-btn" onClick={onBack} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <ArrowLeft size={15} />{t("Назад", "Orqaga")}
        </button>
        <span style={{ fontFamily: F.display, fontWeight: 700, color: COLORS.textPrimary }}>{list.name}</span>
        <button className="neo-btn text-danger" onClick={() => onDelete(list.id, list.name)}
          style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Trash2 size={14} />{t("Удалить", "O'chirish")}
        </button>
      </div>

      {/* ── Товары и цены ──────────────────────────────────────────────────── */}
      <FieldGroup first>
        <div className="flex items-center gap-2 mb-3">
          <Tag size={15} style={{ color: COLORS.textTertiary }} />
          <span style={{ fontFamily: F.display, fontSize: "13px", fontWeight: 600, color: COLORS.textPrimary }}>
            {t("Товары и цены", "Mahsulot va narxlar")}
          </span>
        </div>

        <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
          <div className="space-y-1">
            <input className="neo-input w-full"
              placeholder={t("Найти товар…", "Mahsulot qidirish…")}
              value={picked ? picked.name : productSearch}
              onChange={e => { setProductSearch(e.target.value); setPicked(null); }} />
            {!picked && productSearch.length >= 2 && (productsQ.data?.data?.length ?? 0) > 0 && (
              <div className="max-h-36 overflow-y-auto space-y-1">
                {productsQ.data!.data.map(p => (
                  <button key={p.id} className="neo-btn w-full text-left"
                    style={{ fontSize: "13px", padding: "6px 10px" }}
                    onClick={() => { setPicked({ id: p.id, name: p.name }); setPrice(String(p.unitPrice ?? "")); }}>
                    {p.name} <span style={{ color: COLORS.textTertiary }}>· {p.code}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <DecimalInput className="neo-input" value={price} onValueChange={setPrice}
            placeholder={t("Цена", "Narx")} />
          <div className="flex gap-2">
            <DecimalInput className="neo-input flex-1" value={minQuantity} onValueChange={setMinQuantity}
              placeholder={t("От количества", "Miqdordan")} />
            <button className="neo-btn-primary" disabled={upsert.isPending}
              onClick={() => {
                if (!picked) return notify.error(t("Выберите товар", "Mahsulotni tanlang"));
                const value = Number(price);
                if (!(value >= 0)) return notify.error(t("Укажите цену", "Narxni kiriting"));
                upsert.mutate({
                  priceListId: list.id, productId: picked.id,
                  price: value, minQuantity: Number(minQuantity) || 1,
                });
              }}>
              <Plus size={15} />
            </button>
          </div>
        </div>

        {detailQ.isLoading ? (
          <div className="h-10 bg-surface-light animate-pulse rounded mt-3" />
        ) : items.length === 0 ? (
          <p style={{ fontSize: "13px", color: COLORS.textTertiary, marginTop: "12px" }}>
            {t("Пока пусто — цены берутся из карточки товара", "Hozircha bo'sh — narxlar mahsulot kartasidan olinadi")}
          </p>
        ) : (
          <div className="mt-3 space-y-1">
            {items.map(i => (
              <div key={i.id} className="flex items-center justify-between" style={{ fontSize: "13px" }}>
                <span style={{ color: COLORS.textSecondary, minWidth: 0 }} className="truncate">
                  {i.productName ?? "—"}
                  {Number(i.minQuantity) > 1 && (
                    <span style={{ color: COLORS.textTertiary }}> · {t("от", "dan")} {Number(i.minQuantity)}</span>
                  )}
                </span>
                <span className="flex items-center gap-3 shrink-0">
                  {/* Обычная цена рядом: без неё не видно, скидка это или наценка. */}
                  <span style={{ color: COLORS.textTertiary, textDecoration: "line-through" }}>
                    {fmt(Number(i.unitPrice ?? 0))}
                  </span>
                  <b style={{ color: COLORS.textPrimary, fontVariantNumeric: "tabular-nums" }}>
                    {fmt(Number(i.price))}
                  </b>
                  <button aria-label={t("Убрать", "Olib tashlash")} className="text-danger"
                    onClick={() => removeItem.mutate({ id: i.id })}>
                    <X size={14} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </FieldGroup>

      {/* ── Магазины ───────────────────────────────────────────────────────── */}
      <FieldGroup>
        <div className="flex items-center gap-2 mb-3">
          <Store size={15} style={{ color: COLORS.textTertiary }} />
          <span style={{ fontFamily: F.display, fontSize: "13px", fontWeight: 600, color: COLORS.textPrimary }}>
            {t("Кому назначен", "Kimga tayinlangan")}
          </span>
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <PremiumSelect
              value={shopId}
              onChange={setShopId}
              options={shopOptions}
              placeholder={t("Выберите магазин…", "Do'konni tanlang…")}
            />
          </div>
          <button className="neo-btn-primary" disabled={assign.isPending}
            onClick={() => {
              if (!shopId) return notify.error(t("Выберите магазин", "Do'konni tanlang"));
              assign.mutate({ priceListId: list.id, shopId: Number(shopId) });
            }}>
            <Plus size={15} />
          </button>
        </div>

        {assignments.length === 0 ? (
          <p style={{ fontSize: "13px", color: COLORS.textTertiary, marginTop: "12px" }}>
            {t("Никому не назначен — список ни на что не влияет", "Hech kimga tayinlanmagan — ro'yxat ta'sir qilmaydi")}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2 mt-3">
            {assignments.map(a => (
              <span key={a.id} className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg"
                style={{ background: COLORS.surfaceLight, fontSize: "13px", color: COLORS.textPrimary }}>
                {a.shopName ?? `№${a.shopId}`}
                <button aria-label={t("Отвязать", "Uzish")} className="text-danger"
                  onClick={() => unassign.mutate({ priceListId: list.id, shopId: a.shopId })}>
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        )}
      </FieldGroup>
    </div>
  );
}
