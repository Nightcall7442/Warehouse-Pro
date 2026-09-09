import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Pencil, Trash2, Loader2, Plus, MapPin, Layers } from "lucide-react";
import { trpc } from "@/providers/trpc.client";
import { notify } from "@/lib/toast";
import { COLORS, F } from "./constants";

interface TerritoryManagerProps {
  lang: string;
  onClose: () => void;
}

export function TerritoryManager({ lang, onClose }: TerritoryManagerProps) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const utils = trpc.useContext();
  const { data: territories = [], isLoading } = trpc.territory.list.useQuery();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#5b6d8a");
  const [editLat, setEditLat] = useState("");
  const [editLng, setEditLng] = useState("");
  const [editRadius, setEditRadius] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  /*
    Разрез «из магазинов»: по городу или по району. Пусто — предложение не
    раскрыто, и лишний запрос не идёт.
  */
  const [byPlace, setByPlace] = useState<"city" | "district" | null>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#5b6d8a");
  const [newLat, setNewLat] = useState("");
  const [newLng, setNewLng] = useState("");
  const [newRadius, setNewRadius] = useState("10");

  const createMutation = trpc.territory.create.useMutation({
    onSuccess: () => {
      utils.territory.list.invalidate();
      utils.shop.territories.invalidate();
      notify.success(t("Территория создана", "Territoriya yaratildi"));
      setShowCreate(false);
      setNewName("");
      setNewLat("");
      setNewLng("");
      setNewRadius("10");
    },
    onError: (e) => notify.error(e.message),
  });

  const updateMutation = trpc.territory.update.useMutation({
    onSuccess: () => {
      utils.territory.list.invalidate();
      utils.shop.territories.invalidate();
      notify.success(t("Территория обновлена", "Territoriya yangilandi"));
      setEditingId(null);
    },
    onError: (e) => notify.error(e.message),
  });

  const deleteMutation = trpc.territory.delete.useMutation({
    onSuccess: () => {
      utils.territory.list.invalidate();
      utils.shop.territories.invalidate();
      notify.success(t("Территория удалена", "Territoriya o'chirildi"));
      setDeleteConfirm(null);
    },
    onError: (e) => notify.error(e.message),
  });

  /*
    Сначала показать, потом делать.

    Создание десятка справочных записей — не то действие, которое делают одним
    нажатием вслепую. Предпросмотр считает и ничего не меняет: человек видит
    города с числом точек и решает, тот ли это разрез.
  */
  const preview = trpc.territory.previewFromShops.useQuery(
    { by: byPlace ?? "city" },
    { enabled: byPlace !== null },
  );

  const fromShopsMutation = trpc.territory.createFromShops.useMutation({
    onSuccess: (r) => {
      utils.territory.list.invalidate();
      utils.shop.list.invalidate();
      utils.shop.territories.invalidate();
      preview.refetch();
      notify.success(t(
        `Создано территорий: ${r.created}, привязано магазинов: ${r.assigned}`,
        `Territoriyalar: ${r.created} ta, do'konlar: ${r.assigned} ta`,
      ));
    },
    onError: (e) => notify.error(e.message),
  });

  const autoAssignMutation = trpc.territory.autoAssign.useMutation({
    onSuccess: (data) => {
      utils.territory.list.invalidate();
      utils.shop.list.invalidate();
      notify.success(t(`Назначено ${data.assigned} из ${data.total} магазинов`, `${data.assigned} / ${data.total} do'kon tayinlandi`));
    },
    onError: (e) => notify.error(e.message),
  });

  /*
    Цвет территории — ДАННЫЕ, а не оформление.

    Он уходит на сервер и ложится в territories.color — varchar(7), с проверкой
    z.string().max(7). Здесь первым цветом стояло «var(--color-primary)»:
    двадцать символов вместо семи. Его же брало и поле по умолчанию, поэтому
    создать территорию было НЕЛЬЗЯ ВООБЩЕ — ни с цветом по умолчанию, ни выбрав
    первый образец: сервер отклонял обе попытки. У арендатора Serena Trade из-за
    этого не заводилось ни одной территории.

    Подмена хекса на переменную темы верна везде, где цвет — оформление, и
    неверна там, где он значение. Отличать просто: если цвет уезжает в мутацию
    или в базу, он должен быть цветом, а не ссылкой на цвет.

    Оттенки приглушённые и из нашей палитры: территория — метка на карте, её
    работа отличаться от соседней, а не кричать. Кислотная восьмёрка Tailwind
    (#22c55e, #8b5cf6, #ec4899) отсюда убрана заодно.
  */
  const PRESET_COLORS = [
    "#5b6d8a", // сланец, фирменный
    "#3a7ca5", // синий
    "#3a9a8a", // бирюзовый
    "#7a9a3a", // оливковый
    "#c49530", // охра
    "#c0703a", // терракота
    "#c06080", // пыльная роза
    "#7a6db5", // сливовый
  ];
  const HEX = /^#[0-9a-f]{6}$/i;

  const startEditing = (ter: { id: number; name: string; color?: string | null; centerLat?: string | null; centerLng?: string | null; radiusKm?: string | null }) => {
    setEditingId(ter.id);
    setEditName(ter.name);
    setEditColor(ter.color || "#5b6d8a");
    setEditLat(ter.centerLat ?? "");
    setEditLng(ter.centerLng ?? "");
    setEditRadius(ter.radiusKm ?? "");
  };

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", inset: 0, background: "var(--overlay-scrim)" }} onClick={onClose} />
      <div style={{
        position: "relative", background: COLORS.surface, borderRadius: "20px", padding: "24px",
        boxShadow: "var(--shadow-overlay)", width: "480px", maxWidth: "90vw", maxHeight: "80vh", display: "flex", flexDirection: "column",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h3 style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
            {t("Управление территориями", "Territoriyalarni boshqarish")}
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px" }}>
            <X size={18} style={{ color: COLORS.textSecondary }} />
          </button>
        </div>

        {/* Create form */}
        {showCreate && (
          <div style={{ padding: "12px", borderRadius: "12px", border: `1px solid ${COLORS.border}`, marginBottom: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <input className="neo-input" placeholder={t("Название территории", "Territoriya nomi")} value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {PRESET_COLORS.map(c => (
                <button key={c} onClick={() => setNewColor(c)} style={{
                  width: "24px", height: "24px", borderRadius: "6px", border: newColor === c ? `2px solid ${COLORS.textPrimary}` : "2px solid transparent",
                  background: c, cursor: "pointer",
                }} />
              ))}
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <input className="neo-input" type="number" step="any" placeholder={t("Широта", "Kenglik")} value={newLat} onChange={e => setNewLat(e.target.value)} style={{ flex: 1 }} />
              <input className="neo-input" type="number" step="any" placeholder={t("Долгота", "Uzunlik")} value={newLng} onChange={e => setNewLng(e.target.value)} style={{ flex: 1 }} />
              <input className="neo-input" type="number" step="any" placeholder={t("Радиус км", "Radius km")} value={newRadius} onChange={e => setNewRadius(e.target.value)} style={{ width: "80px" }} />
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => {
                if (!newName.trim()) return;
                /*
                  Страховка от повторения: если цвет опять окажется не цветом,
                  человек услышит это здесь, а не получит отказ проверки с
                  сервера, из которого не понять, при чём тут вообще цвет.
                */
                if (!HEX.test(newColor)) {
                  notify.error(t("Выберите цвет территории", "Territoriya rangini tanlang"));
                  return;
                }
                createMutation.mutate({
                  name: newName.trim(), color: newColor,
                  centerLat: newLat ? Number(newLat) : undefined,
                  centerLng: newLng ? Number(newLng) : undefined,
                  radiusKm: newRadius ? Number(newRadius) : undefined,
                });
              }}
                disabled={!newName.trim() || createMutation.isPending}
                className="neo-btn-primary" style={{ flex: 1, fontSize: "12px", padding: "8px" }}>
                {createMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : t("Создать", "Yaratish")}
              </button>
              <button onClick={() => setShowCreate(false)} className="neo-btn" style={{ fontSize: "12px", padding: "8px" }}>
                {t("Отмена", "Bekor")}
              </button>
            </div>
          </div>
        )}

        {/*
          ── Собрать из магазинов ───────────────────────────────────────────

          Территории заводили только руками — по одной, с названием, цветом и
          координатами. У арендатора с двумя сотнями точек, где город и район
          уже заполнены в карточке каждого магазина, это работа на вечер, и
          ровно та, где машина вернее человека: данные для неё уже есть.
        */}
        {byPlace !== null && (
          <div style={{
            padding: "12px 14px", borderRadius: "12px", marginBottom: "12px",
            background: "var(--color-surface-light)", boxShadow: "var(--shadow-pressed)",
            display: "flex", flexDirection: "column", gap: "10px",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
              <span className="font-label" style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: COLORS.textTertiary }}>
                {t("Собрать из магазинов", "Do'konlardan yig'ish")}
              </span>
              <div role="group" className="range-pills">
                {(["city", "district"] as const).map(k => (
                  <button key={k} onClick={() => setByPlace(k)} aria-pressed={byPlace === k}
                    className={"range-pill tap" + (byPlace === k ? " active" : "")}
                    style={{ padding: "6px 12px", fontSize: "11.5px" }}>
                    {k === "city" ? t("По городам", "Shaharlar") : t("По районам", "Tumanlar")}
                  </button>
                ))}
              </div>
            </div>

            {preview.isLoading ? (
              <span style={{ fontSize: "12px", color: COLORS.textTertiary }}>{t("Считаю…", "Hisoblanmoqda…")}</span>
            ) : preview.data && preview.data.items.length > 0 ? (
              <>
                {/* Что именно получится — списком, а не одним числом: разнобой
                    в написании города виден только глазами. */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", maxHeight: "96px", overflowY: "auto" }}>
                  {preview.data.items.map(i => (
                    <span key={i.name} title={i.exists ? t("территория уже есть", "territoriya bor") : undefined}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: "5px",
                        padding: "3px 9px", borderRadius: "999px", fontSize: "11.5px",
                        background: i.exists ? "transparent" : "var(--color-primary-subtle)",
                        boxShadow: i.exists ? "inset 0 0 0 1px var(--color-border)" : undefined,
                        color: i.exists ? COLORS.textTertiary : "var(--color-primary-text)",
                      }}>
                      {i.name}
                      <b style={{ fontVariantNumeric: "tabular-nums" }}>{i.shops}</b>
                    </span>
                  ))}
                </div>

                {(() => {
                  /*
                    Кнопка называется тем, что сделает.

                    Было «Создать N» — и при N = 0 она сообщала «делать нечего»,
                    хотя привязать магазины ещё требовалось. Хуже другое: ноль
                    получается по трём разным причинам — поле не заполнено ни у
                    кого, территории на все города уже заведены, магазины и так
                    разложены, — и в каждом случае делать надо разное. Экран
                    молчал, и владелец спросил, как вообще создать территорию.
                  */
                  const p = preview.data;
                  const nothing = p.toCreate === 0 && p.toAssign === 0;
                  const action = p.toCreate > 0 && p.toAssign > 0
                    ? t(`Создать ${p.toCreate} и привязать ${p.toAssign}`, `${p.toCreate} ta yaratib ${p.toAssign} ta bog'lash`)
                    : p.toCreate > 0
                      ? t(`Создать ${p.toCreate}`, `${p.toCreate} ta yaratish`)
                      : p.toAssign > 0
                        ? t(`Привязать ${p.toAssign} магазинов`, `${p.toAssign} ta do'konni bog'lash`)
                        : t("Делать нечего", "Bajariladigan ish yo'q");

                  // Почему ноль — по порядку убывания вероятности.
                  const why = !nothing ? null
                    : p.withoutPlace === p.totalShops
                      ? byPlace === "city"
                        ? t("Ни у одного магазина не заполнен город. Заполните его в карточках — или соберите по районам.",
                            "Hech bir do'konda shahar to'ldirilmagan. Kartochkalarda to'ldiring yoki tumanlar bo'yicha yig'ing.")
                        : t("Ни у одного магазина не заполнен район. Заполните его в карточках — или соберите по городам.",
                            "Hech bir do'konda tuman to'ldirilmagan. Kartochkalarda to'ldiring yoki shaharlar bo'yicha yig'ing.")
                      : t(
                          `Территории на все ${p.items.length} мест уже заведены, и магазины по ним разложены. Создавать и привязывать нечего.`,
                          `Barcha ${p.items.length} ta joy uchun territoriyalar bor va do'konlar taqsimlangan.`,
                        );

                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                        <button
                          onClick={() => fromShopsMutation.mutate({ by: byPlace })}
                          disabled={fromShopsMutation.isPending || nothing}
                          className="neo-btn-primary tap"
                          style={{ fontSize: "12px", padding: "8px 12px" }}
                        >
                          {fromShopsMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                          {action}
                        </button>
                        {!nothing && (
                          <span style={{ fontSize: "11.5px", color: COLORS.textTertiary }}>
                            {t("Магазины, уже стоящие в территориях, не тронутся.",
                               "Territoriyada turgan do'konlarga tegilmaydi.")}
                          </span>
                        )}
                      </div>

                      {why && (
                        <span style={{ fontSize: "11.5px", color: COLORS.textSecondary, lineHeight: 1.5 }}>{why}</span>
                      )}

                      {/*
                        Магазины без города видны всегда, а не только когда
                        получился ноль: иначе человек создаст территории,
                        недосчитается половины точек и не поймёт, где они.
                      */}
                      {p.withoutPlace > 0 && p.withoutPlace < p.totalShops && (
                        <span style={{ fontSize: "11.5px", color: "var(--color-warning-text)" }}>
                          {byPlace === "city"
                            ? t(`У ${p.withoutPlace} из ${p.totalShops} магазинов город не заполнен — они останутся без территории.`,
                                `${p.totalShops} tadan ${p.withoutPlace} tasida shahar yo'q — ular territoriyasiz qoladi.`)
                            : t(`У ${p.withoutPlace} из ${p.totalShops} магазинов район не заполнен — они останутся без территории.`,
                                `${p.totalShops} tadan ${p.withoutPlace} tasida tuman yo'q — ular territoriyasiz qoladi.`)}
                        </span>
                      )}
                    </div>
                  );
                })()}
              </>
            ) : (
              <span style={{ fontSize: "12px", color: COLORS.textSecondary, lineHeight: 1.5 }}>
                {preview.data && preview.data.totalShops === 0
                  ? t("Действующих магазинов нет — собирать не из чего.", "Faol do'konlar yo'q.")
                  : byPlace === "city"
                    ? t(`Ни у одного из ${preview.data?.totalShops ?? 0} магазинов не заполнен город. Заполните его в карточках — или соберите по районам.`,
                        `${preview.data?.totalShops ?? 0} ta do'konning hech birida shahar to'ldirilmagan. Kartochkalarda to'ldiring yoki tumanlar bo'yicha yig'ing.`)
                    : t(`Ни у одного из ${preview.data?.totalShops ?? 0} магазинов не заполнен район. Заполните его в карточках — или соберите по городам.`,
                        `${preview.data?.totalShops ?? 0} ta do'konning hech birida tuman to'ldirilmagan. Kartochkalarda to'ldiring yoki shaharlar bo'yicha yig'ing.`)}
              </span>
            )}
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
          {isLoading ? (
            <div style={{ padding: "24px", textAlign: "center" }}><Loader2 size={20} className="animate-spin" style={{ color: COLORS.primaryText }} /></div>
          ) : territories.length === 0 && !showCreate ? (
            <div style={{ padding: "24px", textAlign: "center", color: COLORS.textSecondary, fontSize: "13px" }}>
              {t("Нет территорий", "Territoriyalar yo'q")}
            </div>
          ) : (
            territories.map(ter => (
              <div key={ter.id} style={{
                display: "flex", alignItems: "center", gap: "8px",
                padding: "8px 12px", borderRadius: "10px",
                background: deleteConfirm === ter.id ? "var(--color-danger-subtle)" : "transparent",
              }}>
                {editingId === ter.id ? (
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                    <input className="neo-input" style={{ padding: "4px 8px", fontSize: "13px" }} value={editName} onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && editName.trim()) updateMutation.mutate({ id: ter.id, name: editName.trim(), color: editColor }); if (e.key === "Escape") setEditingId(null); }} autoFocus />
                    <div style={{ display: "flex", gap: "4px" }}>
                      {PRESET_COLORS.slice(0, 4).map(c => (
                        <button key={c} onClick={() => setEditColor(c)} style={{
                          width: "18px", height: "18px", borderRadius: "4px", border: editColor === c ? `2px solid ${COLORS.textPrimary}` : "1px solid transparent", background: c, cursor: "pointer",
                        }} />
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <input className="neo-input" type="number" step="any" placeholder={t("Широта", "Kenglik")} value={editLat} onChange={e => setEditLat(e.target.value)} style={{ flex: 1, padding: "4px 8px", fontSize: "12px" }} />
                      <input className="neo-input" type="number" step="any" placeholder={t("Долгота", "Uzunlik")} value={editLng} onChange={e => setEditLng(e.target.value)} style={{ flex: 1, padding: "4px 8px", fontSize: "12px" }} />
                      <input className="neo-input" type="number" step="any" placeholder={t("Радиус", "Radius")} value={editRadius} onChange={e => setEditRadius(e.target.value)} style={{ width: "70px", padding: "4px 8px", fontSize: "12px" }} />
                    </div>
                    <div style={{ display: "flex", gap: "4px" }}>
                      <button onClick={() => editName.trim() && updateMutation.mutate({
                        id: ter.id, name: editName.trim(), color: editColor,
                        centerLat: editLat ? Number(editLat) : undefined,
                        centerLng: editLng ? Number(editLng) : undefined,
                        radiusKm: editRadius ? Number(editRadius) : undefined,
                      })} disabled={updateMutation.isPending}
                        className="neo-btn-primary" style={{ flex: 1, fontSize: "11px", padding: "4px" }}>
                        {updateMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : t("Сохранить", "Saqlash")}
                      </button>
                      <button onClick={() => setEditingId(null)} className="neo-btn" style={{ fontSize: "11px", padding: "4px" }}>
                        {t("Отмена", "Bekor")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ width: "12px", height: "12px", borderRadius: "3px", background: ter.color || COLORS.primary, flexShrink: 0 }} />
                    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: "13px", color: COLORS.textPrimary }}>{ter.name}</span>
                      {ter.centerLat && ter.centerLng && (
                        <span style={{ fontSize: "10px", color: COLORS.textTertiary }}>
                          GPS: {Number(ter.centerLat).toFixed(4)}, {Number(ter.centerLng).toFixed(4)} ({ter.radiusKm || 10} km)
                        </span>
                      )}
                    </div>
                    {ter.shopCount > 0 && <span style={{ fontSize: "11px", color: COLORS.textSecondary }}>{ter.shopCount} {t("магазин(ов)", "do'kon(lar)")}</span>}
                  </>
                )}

                {deleteConfirm === ter.id ? (
                  <div style={{ display: "flex", gap: "4px" }}>
                    <button onClick={() => deleteMutation.mutate({ id: ter.id })} disabled={deleteMutation.isPending}
                      style={{ padding: "4px 10px", borderRadius: "6px", border: "none", fontSize: "11px", fontWeight: 600, background: COLORS.danger, color: "#fff", cursor: "pointer" }}>
                      {deleteMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : t("Да", "Ha")}
                    </button>
                    <button onClick={() => setDeleteConfirm(null)}
                      style={{ padding: "4px 10px", borderRadius: "6px", border: `1px solid ${COLORS.border}`, fontSize: "11px", background: COLORS.surface, color: COLORS.textPrimary, cursor: "pointer" }}>
                      {t("Нет", "Yo'q")}
                    </button>
                  </div>
                ) : editingId !== ter.id && (
                  <div style={{ display: "flex", gap: "2px" }}>
                    <button onClick={() => startEditing(ter)}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: "4px", borderRadius: "6px" }}>
                      <Pencil size={14} style={{ color: COLORS.textSecondary }} />
                    </button>
                    <button onClick={() => setDeleteConfirm(ter.id)}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: "4px", borderRadius: "6px" }}>
                      <Trash2 size={14} style={{ color: COLORS.danger }} />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div style={{ display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
          {!showCreate && (
            <button onClick={() => setShowCreate(true)} className="neo-btn" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", fontSize: "13px" }}>
              <Plus size={14} /> {t("Добавить территорию", "Territoriya qo'shish")}
            </button>
          )}
          {byPlace === null && (
            <button onClick={() => setByPlace("city")} className="neo-btn"
              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", fontSize: "13px" }}>
              <Layers size={14} /> {t("Из магазинов", "Do'konlardan")}
            </button>
          )}
          <button onClick={() => autoAssignMutation.mutate()} disabled={autoAssignMutation.isPending}
            className="neo-btn" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", fontSize: "13px" }}>
            {autoAssignMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <MapPin size={14} />}
            {t("Авто-назначение", "Avtotayinlash")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
