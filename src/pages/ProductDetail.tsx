/* eslint-disable @typescript-eslint/no-explicit-any */
import { useParams, useNavigate, useSearchParams } from "react-router";
import { useCurrency } from "@/hooks/useCurrency";
import { useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useTranslate } from "@/i18n";
import { useConfirm } from "@/components/ConfirmDialog";
import { format } from "date-fns";
import { ArrowLeft, Package, Edit2, TrendingUp, TrendingDown, ArrowUpDown, Loader2, Camera } from "lucide-react";
import { exportToExcel, formatMovementsForExport } from "@/lib/excel";
import { PremiumSelect } from "@/components/PremiumSelect";

const UNIT_LABELS: Record<string,[string,string]> = {
  kg:   ["кг","kg"], l: ["л","l"], pcs: ["шт","dona"],
  box:  ["ящ","quti"], pack: ["упак","pachka"], m: ["м","m"],
};

const COLORS = {
  primary: "var(--color-primary, #3a9ab5)",
  secondary: "var(--color-text-secondary, #a39d92)",
  danger: "var(--color-danger, #ff4d6a)",
  surface: "var(--color-surface, #221f1c)",
  surfaceLight: "var(--color-surface-light, #2a2622)",
  border: "var(--color-border, #322e28)",
  borderSubtle: "var(--color-border-subtle, #2a2622)",
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  in:         <TrendingUp  size={13} className="text-success"/>,
  out:        <TrendingDown size={13} className="text-danger"/>,
  adjustment: <ArrowUpDown size={13} className="text-warning"/>,
};

export default function ProductDetail() {
  const { id }           = useParams<{id:string}>();
  const { fmt } = useCurrency();
  const tr = useTranslate();
  const navigate         = useNavigate();
  const [searchParams]   = useSearchParams();
  const fromPage         = searchParams.get("fromPage") || "1";
  const fromSearch       = searchParams.get("search") || "";
  const fromCategory     = searchParams.get("category") || "";
  const { confirm, dialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<Record<string, unknown>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const { data: product, isLoading } = trpc.product.getById.useQuery({ id: Number(id) }, { enabled: !!id });

  const updateProduct = trpc.product.update.useMutation({
    onSuccess: () => { utils.product.getById.invalidate({id:Number(id)}); setEditing(false); notify.success(tr("Товар обновлён", "Mahsulot yangilandi")); },
    onError:   (e) => notify.error(e.message),
  });

  const deleteProduct = trpc.product.delete.useMutation({
    onSuccess: () => { navigate(`/products?page=${fromPage}${fromSearch ? `&search=${encodeURIComponent(fromSearch)}` : ""}${fromCategory ? `&category=${encodeURIComponent(fromCategory)}` : ""}`); notify.success(tr("Товар удалён", "Mahsulot o'chirildi")); },
    onError:   (e) => notify.error(e.message),
  });

  const uploadPhoto = trpc.product.uploadPhoto.useMutation({
    onSuccess: () => { utils.product.getById.invalidate({id:Number(id)}); notify.success(tr("Фото обновлено", "Rasm yangilandi")); },
    onError:   (e) => notify.error(e.message),
  });

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { notify.error(tr("Файл слишком большой (макс. 2 МБ)", "Fayl juda katta (maks. 2 MB)")); return; }
    const reader = new FileReader();
    reader.onload = () => uploadPhoto.mutate({ productId: Number(id), dataUrl: reader.result as string });
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleDelete = async () => {
    const ok = await confirm({ title:tr("Удалить товар?","Mahsulot o'chirilsinmi?"), message:tr("Все данные об остатках будут удалены.","Barcha qoldiq ma'lumotlari o'chiriladi."), confirmText:tr("Удалить","O'chirish"), danger:true });
    if (ok) deleteProduct.mutate({ id: Number(id) });
  };

  if (isLoading) return <div className="h-64 bg-surface-light animate-pulse rounded"/>;
  if (!product) return <div className="text-center py-20 text-secondary">{tr("Товар не найден","Mahsulot topilmadi")}</div>;

  const stock      = product.stock as any;
  const movements  = (product.movements ?? []) as any[];
  const low        = stock && Number(stock.available) < Number((product as any).reorderPoint);

  const unitLabel = (u?:string) => { const e = UNIT_LABELS[u||"pcs"]; return e ? tr(e[0],e[1]) : (u||""); };
  const totalWeightKg = stock ? (Number(stock.currentStock) * Number((product as any).unitWeight||0)) : 0;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {dialog}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <button onClick={()=>navigate(`/products?page=${fromPage}${fromSearch ? `&search=${encodeURIComponent(fromSearch)}` : ""}${fromCategory ? `&category=${encodeURIComponent(fromCategory)}` : ""}`)} className="neo-btn flex items-center gap-2 py-1.5 px-3 text-sm">
          <ArrowLeft size={18}/><span className="text-sm">{tr("Назад","Orqaga")}</span>
        </button>
        <div className="flex gap-2">
          <button onClick={()=>setEditing(v=>!v)} className="neo-btn flex items-center gap-2 text-sm py-2"><Edit2 size={14}/>{tr("Изменить","Tahrirlash")}</button>
          <button onClick={handleDelete} className="neo-btn text-danger border-danger/30 text-sm py-2">{tr("Удалить","O'chirish")}</button>
        </div>
      </div>

      {/* Info card */}
      <div className="neo-card p-6">
        <div className="flex items-start gap-4">
          {/* Photo area */}
          <div className="flex-shrink-0">
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePhotoUpload} />
            <div
              className="w-20 h-20 rounded-xl overflow-hidden flex items-center justify-center cursor-pointer relative group border border-border-subtle"
              style={{ background: "rgba(75,108,246,.08)" }}
              onClick={() => fileRef.current?.click()}
              title={tr("Нажмите чтобы загрузить фото","Rasm yuklash uchun bosing")}
            >
              {uploadPhoto.isPending ? (
                <Loader2 size={28} className="text-primary animate-spin" />
              ) : product.photoUrl ? (
                <img src={product.photoUrl} alt={product.name} className="w-full h-full object-cover" />
              ) : (
                <Package size={28} className="text-primary" />
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 rounded-xl">
                <Camera size={18} color="#fff" />
                <span className="text-white text-[10px] font-medium">{tr("Загрузить","Yuklash")}</span>
              </div>
            </div>
          </div>
          <div className="flex-1">
            {editing ? (
              <div className="grid grid-cols-2 gap-3">
                {[["code","Код"],["name","Название"],["category","Категория"]].map(([k,p])=>(
                  <input key={k} className="neo-input" placeholder={p}
                    defaultValue={(product as any)[k] ?? ""}
                    onChange={e=>setEditData((d: Record<string, unknown>)=>({...d,[k]:e.target.value}))}/>
                ))}
                <PremiumSelect value={(product as any).unit ?? "pcs"}
                  onChange={v=>setEditData((d: Record<string, unknown>)=>({...d,unit:v}))}
                  options={Object.keys(UNIT_LABELS).map(u=>({value:u,label:unitLabel(u)}))}
                  width="100%" />
                <input className="neo-input font-data" placeholder={tr("Себестоимость","Tannarx")}
                  defaultValue={(product as any).costPrice} type="number" step="0.01"
                  onChange={e=>setEditData((d: Record<string, unknown>)=>({...d,costPrice:e.target.value}))}/>
                <input className="neo-input font-data" placeholder={tr("Цена продажи","Sotish narxi")}
                  defaultValue={(product as any).unitPrice} type="number" step="0.01"
                  onChange={e=>setEditData((d: Record<string, unknown>)=>({...d,unitPrice:e.target.value}))}/>
                <input className="neo-input font-data" placeholder={tr("Масса 1 ед. (кг)","1 dona vazni (kg)")}
                  defaultValue={(product as any).unitWeight} type="number" step="0.001"
                  onChange={e=>setEditData((d: Record<string, unknown>)=>({...d,unitWeight:e.target.value}))}/>
                <input className="neo-input font-data" placeholder={tr("Порог дозаказа","Qayta buyurtma chegarasi")}
                  defaultValue={(product as any).reorderPoint} type="number" step="0.01"
                  onChange={e=>setEditData((d: Record<string, unknown>)=>({...d,reorderPoint:e.target.value}))}/>
                <input className="neo-input col-span-2" placeholder={tr("Описание","Tavsif")}
                  defaultValue={(product as any).description ?? ""}
                  onChange={e=>setEditData((d: Record<string, unknown>)=>({...d,description:e.target.value}))}/>
                <div className="col-span-2 flex gap-2">
                  <button onClick={()=>updateProduct.mutate({id:product.id,...editData})} disabled={updateProduct.isPending}
                    className="neo-btn-primary flex items-center gap-2">
                    {updateProduct.isPending&&<Loader2 size={14} className="animate-spin"/>}{tr("Сохранить","Saqlash")}
                  </button>
                  <button onClick={()=>setEditing(false)} className="neo-btn">{tr("Отмена","Bekor qilish")}</button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start gap-3">
                  <div>
                    <h1 className="font-display text-xl font-bold text-primary tracking-tight">{product.name}</h1>
                    <p className="font-data text-secondary text-sm">{product.code}</p>
                  </div>
                  <div className="ml-auto text-right">
                    <span className="font-data text-xl text-primary font-bold">{fmt(product.unitPrice, {decimals:2})}/{unitLabel(product.unit)}</span>
                    {Number(product.costPrice) > 0 && (
                      <p className="text-xs text-secondary mt-0.5">{tr("Себест.","Tannarx")}: {fmt(product.costPrice, {decimals:2})}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {product.category && <span className="text-sm text-secondary">{product.category}</span>}
                  {Number(product.unitWeight) > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-surface-light text-secondary">
                      1 {unitLabel(product.unit)} = {Number(product.unitWeight).toFixed(2)} {tr("кг","kg")}
                    </span>
                  )}
                </div>
                {product.description && <p className="text-sm text-secondary mt-2">{product.description}</p>}
              </>
            )}
          </div>
        </div>

        {/* Stock summary */}
        {stock && (
          <div className={`mt-4 pt-4 border-t border-border-subtle grid grid-cols-3 gap-4 ${low?"border-danger/30":""}`}>
            {[
              {label:tr("Доступно","Mavjud"), value:Number(stock.available).toFixed(2), danger:low},
              {label:tr("Резерв","Zaxira"),  value:Number(stock.reserved).toFixed(2),  danger:false},
              {label:tr("Всего","Jami"),     value:Number(stock.currentStock).toFixed(2), danger:false},
            ].map(s=>(
              <div key={s.label} className="text-center">
                <p className={`font-data text-2xl font-bold ${s.danger?"text-danger":"text-primary"}`}>{s.value}</p>
                <p className="font-label text-secondary text-[10px] tracking-wide">{unitLabel(product.unit).toUpperCase()} {s.label.toUpperCase()}</p>
              </div>
            ))}
            {Number(product.unitWeight) > 0 && (
              <div className="col-span-3 mt-2 pt-2 border-t border-border-subtle/50 flex items-center justify-between">
                <span className="text-xs text-secondary">{tr("Общий вес на складе (для сверки)","Ombordagi umumiy vazn (tekshirish uchun)")}</span>
                <span className="font-data text-sm font-bold text-primary">{totalWeightKg.toFixed(2)} {tr("кг","kg")}</span>
              </div>
            )}
          </div>
        )}

        {low && (
          <p className="text-xs text-danger mt-3 font-medium">⚠ {tr("Ниже точки дозаказа","Qayta buyurtma nuqtasidan past")} ({Number(product.reorderPoint).toFixed(0)} {unitLabel(product.unit)})</p>
        )}
      </div>

      {/* Movement history */}
      <div className="neo-card">
        <div className="px-4 pt-4 pb-2 border-b border-border-subtle flex items-center justify-between">
          <span className="font-label text-primary tracking-wider text-xs">{tr("ИСТОРИЯ ДВИЖЕНИЙ","HARAKATLAR TARIXI")}</span>
          {movements.length>0 && (
            <button onClick={()=>exportToExcel(formatMovementsForExport(movements as any),`movements-${product.name}`)}
              className="neo-btn py-1 px-3 text-xs">{tr("Экспорт","Eksport")}</button>
          )}
        </div>
        {movements.length===0 ? (
          <p className="px-4 py-8 text-center text-secondary text-sm">{tr("Движений пока нет","Hozircha harakatlar yo'q")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="bg-surface-light">
              {[tr("Дата","Sana"),tr("Тип","Turi"),tr("Кол-во","Miqdor"),tr("Документ","Hujjat"),tr("Заметки","Izoh")].map(h=>(
                <th key={h} className="text-left px-4 py-2 font-h3 text-secondary text-xs">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {movements.map(m=>(
                <tr key={m.id} className="border-b border-border-subtle">
                  <td className="px-4 py-2 text-xs text-secondary">{m.createdAt?format(new Date(m.createdAt),"dd/MM/yy HH:mm"):""}</td>
                  <td className="px-4 py-2"><div className="flex items-center gap-1">{TYPE_ICONS[m.type]}<span className={`text-xs ${m.type==="in"?"text-success":m.type==="out"?"text-danger":"text-warning"}`}>{m.type.toUpperCase()}</span></div></td>
                  <td className={`px-4 py-2 font-data text-sm ${m.type==="in"?"text-success":m.type==="out"?"text-danger":"text-warning"}`}>
                    {m.type==="in"?"+":m.type==="out"?"−":"±"}{Number(m.quantity).toFixed(2)} {unitLabel(product.unit)}
                  </td>
                  <td className="px-4 py-2 text-xs text-secondary">{m.referenceType?`${m.referenceType} #${m.referenceId}`:"—"}</td>
                  <td className="px-4 py-2 text-xs text-secondary">{m.notes??"—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
