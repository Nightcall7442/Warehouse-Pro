import { memo, useCallback, useRef, useState } from "react";
import { useCurrency } from "@/hooks/useCurrency";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { useNavigate } from "react-router";
import { Search, Plus, Package, X, Upload, Camera, Loader2, Tag, Scale } from "lucide-react";
import { ExcelImport } from "@/components/ExcelImport";
import { PremiumSelect } from "@/components/PremiumSelect";

const UNITS = [
  { value: "kg",   ru: "кг",       uz: "kg" },
  { value: "l",    ru: "литр",     uz: "litr" },
  { value: "pcs",  ru: "штук",     uz: "dona" },
  { value: "box",  ru: "ящик",     uz: "quti" },
  { value: "pack", ru: "упаковка", uz: "pachka" },
  { value: "m",    ru: "метр",     uz: "metr" },
];
const unitLabel = (u: string | undefined, lang: string) => {
  const e = UNITS.find(x => x.value === u);
  return e ? (lang === "uz" ? e.uz : e.ru) : (u ?? "шт");
};

function ProductPhoto({ productId, photoUrl, size = "md" }: { productId: number; photoUrl?: string | null; size?: "sm"|"md"|"lg" }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const utils   = trpc.useUtils();
  const upload  = trpc.product.uploadPhoto.useMutation({
    onSuccess: () => { utils.product.list.invalidate(); utils.product.getById.invalidate({ id: productId }); notify.success("Фото обновлено"); },
    onError:   (e) => notify.error(e.message),
  });
  const dim      = size === "sm" ? "w-12 h-12" : size === "lg" ? "w-20 h-20" : "w-16 h-16";
  const iconSize = size === "sm" ? 18 : size === "lg" ? 32 : 22;
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) { notify.error("Макс. 2 МБ"); return; }
    const r = new FileReader();
    r.onload = () => upload.mutate({ productId, dataUrl: r.result as string });
    r.readAsDataURL(file); e.target.value = "";
  };
  return (
    <div className="relative group" onClick={e => e.stopPropagation()}>
      <div className={`${dim} rounded-xl overflow-hidden flex items-center justify-center flex-shrink-0 cursor-pointer border border-border-subtle`}
        style={{ background: "color-mix(in srgb, var(--color-primary) 8%, transparent)" }}
        onClick={() => fileRef.current?.click()}>
        {upload.isPending ? <Loader2 size={iconSize} className="text-primary animate-spin" />
          : photoUrl ? <img src={photoUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
          : <Package size={iconSize} className="text-primary" />}
        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-xl">
          <Camera size={iconSize - 4} color="#fff" />
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFile} />
    </div>
  );
}

function ProductForm({ onSave, onCancel, isPending, lang }: { onSave: (d: Record<string, unknown>) => void; onCancel:()=>void; isPending:boolean; lang:string }) {
  const t = (ru:string,uz:string) => lang==="uz"?uz:ru;
  const [d, setD] = useState({ code:"", barcode:"", name:"", category:"", costPrice:"", unitPrice:"", unit:"pcs", unitWeight:"", reorderPoint:"10.00", description:"" });
  const [photo, setPhoto] = useState<string|null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 2*1024*1024) { notify.error("Макс. 2 МБ"); return; }
    const r = new FileReader(); r.onload = () => setPhoto(r.result as string); r.readAsDataURL(file);
  };
  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg font-semibold text-text-primary">{t("Новый товар","Yangi mahsulot")}</h2>
        <button onClick={onCancel}><X size={18} className="text-text-secondary"/></button>
      </div>
      <div className="flex gap-4">
        <div className="flex-shrink-0">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto}/>
          <div className="w-20 h-20 rounded-xl overflow-hidden flex items-center justify-center cursor-pointer relative group border border-border-subtle"
            style={{background:"color-mix(in srgb, var(--color-primary) 8%, transparent)"}} onClick={()=>fileRef.current?.click()}>
            {photo ? <img src={photo} alt="" className="w-full h-full object-cover"/> : <Package size={28} className="text-primary"/>}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 rounded-xl">
              <Camera size={16} color="#fff"/><span className="text-white text-[9px]">{t("Фото","Rasm")}</span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
          <input className="input-field" placeholder={t("Код *","Kod *")} value={d.code} onChange={e=>setD({...d,code:e.target.value})}/>
          <input className="input-field" placeholder={t("Штрих-код (необязательно)","Shtrix-kod (ixtiyoriy)")} value={d.barcode} onChange={e=>setD({...d,barcode:e.target.value})}/>
          <input className="input-field" placeholder={t("Название *","Nomi *")} value={d.name} onChange={e=>setD({...d,name:e.target.value})}/>
          <input className="input-field" placeholder={t("Категория","Kategoriya")} value={d.category} onChange={e=>setD({...d,category:e.target.value})}/>
          <PremiumSelect value={d.unit} onChange={v=>setD({...d,unit:v})}
            options={UNITS.map(u=>({value:u.value,label:lang==="uz"?u.uz:u.ru}))}
            width="100%" />
          <input className="input-field font-data" placeholder={t("Себестоимость","Tannarx")} type="number" step="0.01" value={d.costPrice} onChange={e=>setD({...d,costPrice:e.target.value})}/>
          <input className="input-field font-data" placeholder={t("Цена продажи *","Sotish narxi *")} type="number" step="0.01" value={d.unitPrice} onChange={e=>setD({...d,unitPrice:e.target.value})}/>
          <input className="input-field font-data" placeholder={t("Масса 1 ед. в кг (ящик=8)","1 dona vazni, kg")} type="number" step="0.001" value={d.unitWeight} onChange={e=>setD({...d,unitWeight:e.target.value})}/>
          <input className="input-field font-data" placeholder={t("Порог дозаказа","Qayta buyurtma chegarasi")} type="number" value={d.reorderPoint} onChange={e=>setD({...d,reorderPoint:e.target.value})}/>
          <input className="input-field sm:col-span-2" placeholder={t("Описание","Tavsif")} value={d.description} onChange={e=>setD({...d,description:e.target.value})}/>
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <button onClick={()=>d.code&&d.name&&d.unitPrice&&onSave({...d,photoUrl:photo??undefined})} disabled={isPending}
          className="btn-primary flex-1 sm:flex-none flex items-center justify-center gap-2">
          {isPending&&<Loader2 size={14} className="animate-spin"/>}{t("Сохранить","Saqlash")}
        </button>
        <button onClick={onCancel} className="btn-secondary flex-1 sm:flex-none">{t("Отмена","Bekor qilish")}</button>
      </div>
    </div>
  );
}

const ProductCard = memo(function ProductCard({ p, onClick, lang, fmt }: { p: any; onClick:()=>void; lang:string; fmt: (v: string | number, opts?: Record<string, unknown>) => string }) {
  const t = (ru:string,uz:string) => lang==="uz"?uz:ru;
  const low = Number(p.available??0) < Number(p.reorderPoint);
  const u = unitLabel(p.unit as string, lang);
  return (
    <div className="panel panel-hover p-4 flex items-center gap-4" onClick={onClick}>
      <ProductPhoto productId={p.id as number} photoUrl={p.photoUrl as string} size="lg"/>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display font-semibold text-text-primary text-base truncate">{String(p.name)}</p>
            <p className="font-data text-text-secondary text-xs mt-0.5">{String(p.code)}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="font-data text-lg font-bold text-primary">{fmt(String(p.unitPrice),{decimals:2})}</p>
            {Number(p.costPrice)>0&&<p className="text-[11px] text-text-secondary">{t("себест.","tannarx")} {fmt(String(p.costPrice),{decimals:2})}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {p.category&&<span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-surface-light text-text-secondary"><Tag size={10}/>{String(p.category)}</span>}
          {Number(p.unitWeight)>0&&<span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-surface-light text-text-secondary"><Scale size={10}/>1 {u} = {Number(p.unitWeight).toFixed(2)} {t("кг","kg")}</span>}
          <span className={`ml-auto text-xs font-data font-semibold px-2 py-0.5 rounded-full ${low?"bg-danger/15 text-danger":"bg-success/15 text-success"}`}>
            {Number(p.available??0).toFixed(0)} {u}
          </span>
        </div>
      </div>
    </div>
  );
});

export default function Products() {
  const [page,setPage]       = useState(1);
  const {fmt}                = useCurrency();
  const {lang}               = useLang();
  const [search,setSearch]   = useState("");
  const [category,setCategory] = useState<string|undefined>(undefined);
  const [showForm,setShowForm] = useState(false);
  const [showImport,setShowImport] = useState(false);
  const navigate             = useNavigate();
  const {data,isLoading}     = trpc.product.list.useQuery({page,pageSize:25,search:search||undefined,category}) as { data: any; isLoading: boolean };
  const {data:categories}    = trpc.product.categories.useQuery();
  const utils                = trpc.useUtils();
  const createMutation       = trpc.product.create.useMutation({
    onSuccess:()=>{ utils.product.list.invalidate(); setShowForm(false); notify.success("Товар добавлен"); },
    onError:(e)=>notify.error(e.message),
  });
  const t = useCallback((ru:string,uz:string) => lang==="uz"?uz:ru, [lang]);


  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-text-primary tracking-tight">{t("Товары","Mahsulotlar")}</h1>
        <div className="flex gap-2">
          <button onClick={()=>setShowImport(v=>!v)} className="btn-secondary flex items-center gap-2 text-sm py-2"><Upload size={15}/><span className="hidden sm:inline">{t("Импорт","Import")}</span></button>
          <button onClick={()=>setShowForm(!showForm)} className="btn-primary flex items-center gap-2"><Plus size={16}/><span className="hidden sm:inline">{t("Добавить","Qo'shish")}</span></button>
        </div>
      </div>
      {showImport&&<ExcelImport type="products" onDone={()=>{setShowImport(false);utils.product.list.invalidate();}} onCancel={()=>setShowImport(false)}/>}
      {showForm&&<ProductForm isPending={createMutation.isPending} lang={lang} onSave={d=>createMutation.mutate(d as any)} onCancel={()=>setShowForm(false)}/>}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"/>
          <input className="input-field pl-10 w-full" placeholder={t("Поиск товаров…","Mahsulot qidirish…")} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>
        </div>
        {!!categories?.length&&(
          <PremiumSelect value={category??""} onChange={v=>{setCategory(v||undefined);setPage(1);}}
            options={[{value:"",label:t("Все категории","Barcha kategoriyalar")},...(categories??[]).map(c=>({value:String(c),label:String(c)}))]}
            width="200px" />
        )}
      </div>
      <div className="space-y-3">
        {isLoading ? Array.from({length:5}).map((_,i)=><div key={i} className="h-24 bg-surface-light animate-pulse rounded-xl"/>)
          : data?.data.length===0 ? <p className="text-center text-text-secondary py-12 text-sm">{t("Нет товаров","Mahsulot yo'q")}</p>
          : data?.data.map((p: any)=><ProductCard key={p.id} p={p} lang={lang} fmt={fmt} onClick={()=>navigate(`/products/${p.id}`)}/>)}
      </div>
      {data&&data.total>25&&(
        <div className="flex items-center justify-between">
          <span className="text-sm text-text-secondary">{data.total} {t("всего","jami")}</span>
          <div className="flex gap-2">
            <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1} className="btn-secondary py-1 px-3 text-sm disabled:opacity-40">{t("Назад","Orqaga")}</button>
            <button onClick={()=>setPage(p=>p+1)} disabled={page*25>=data.total} className="btn-secondary py-1 px-3 text-sm disabled:opacity-40">{t("Далее","Keyingi")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
