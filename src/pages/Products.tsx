import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useCurrency } from "@/hooks/useCurrency";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { useNavigate } from "react-router";
import {
  Search, Plus, Package, X, Upload, Camera, Loader2, Tag, Scale,
  ArrowUpRight, ArrowDownRight, Minus, Box, AlertTriangle, BarChart3, Trash2, CheckSquare, Square, FileDown
} from "lucide-react";
import { ExcelImport } from "@/components/ExcelImport";
import { PremiumSelect } from "@/components/PremiumSelect";
import { useConfirm } from "@/components/ConfirmDialog";
import { exportToExcel, formatProductsForExport } from "@/lib/excel";

// Premium Design Constants
const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };
const COLORS = {
  primary: "var(--color-primary)", success: "var(--color-success)",
  warning: "var(--color-warning)", danger: "var(--color-danger)",
  surface: "var(--color-surface)", surfaceLight: "var(--color-surface-light)",
  textPrimary: "var(--color-text-primary)", textSecondary: "var(--color-text-secondary)",
  textTertiary: "var(--color-text-tertiary)", border: "var(--color-border-subtle)",
};
const SHADOW = "0 8px 24px -6px rgba(180,175,165,.25)";

// Premium KpiCard Component
function KpiCard({ label, value, delta, icon, gradient, delay }: {
  label: string; value: string; delta: number | null;
  icon: React.ReactNode; gradient: string; delay: number;
}) {
  const isPositive = delta !== null && delta > 0;
  const isNegative = delta !== null && delta < 0;
  return (
    <div style={{
      background: COLORS.surface, borderRadius: "24px", padding: "24px",
      boxShadow: SHADOW, position: "relative", overflow: "hidden",
      animation: `slideUp ${0.5 + delay}s ease forwards`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <span style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>
          {label}
        </span>
        <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: gradient, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {icon}
        </div>
      </div>
      <div style={{ fontFamily: F.display, fontSize: "32px", fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1, letterSpacing: "-0.03em" }}>
        {value}
      </div>
      {delta !== null && (
        <div style={{
          display: "flex", alignItems: "center", gap: "4px", marginTop: "10px",
          fontSize: "12px", fontWeight: 600, fontFamily: F.body,
          color: isPositive ? "var(--color-success)" : isNegative ? "var(--color-danger)" : COLORS.textTertiary,
        }}>
          {isPositive ? <ArrowUpRight size={14} /> : isNegative ? <ArrowDownRight size={14} /> : <Minus size={14} />}
          {Math.abs(delta).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

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
    <div style={{
      background: COLORS.surface, borderRadius: "24px", padding: "24px",
      boxShadow: SHADOW, animation: "slideUp 0.5s ease forwards",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <h2 style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
          {t("Новый товар","Yangi mahsulot")}
        </h2>
        <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px" }}>
          <X size={18} style={{ color: COLORS.textSecondary }} />
        </button>
      </div>
      <div style={{ display: "flex", gap: "16px" }}>
        <div style={{ flexShrink: 0 }}>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhoto}/>
          <div style={{
            width: "80px", height: "80px", borderRadius: "16px", overflow: "hidden",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", position: "relative",
            background: "color-mix(in srgb, var(--color-primary) 8%, transparent)",
            border: "1px solid var(--color-border-subtle)",
          }} onClick={()=>fileRef.current?.click()}>
            {photo ? <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}/> : <Package size={28} style={{ color: COLORS.primary }}/>}
            <div style={{
              position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)",
              opacity: 0, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: "4px",
              transition: "opacity 0.2s", borderRadius: "16px",
            }}>
              <Camera size={16} color="#fff"/>
              <span style={{ color: "#fff", fontSize: "9px" }}>{t("Фото","Rasm")}</span>
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", flex: 1 }}>
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
      <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
        <button onClick={()=>d.code&&d.name&&d.unitPrice&&onSave({...d,photoUrl:photo??undefined})} disabled={isPending}
          className="btn-primary flex-1 sm:flex-none flex items-center justify-center gap-2">
          {isPending&&<Loader2 size={14} className="animate-spin"/>}{t("Сохранить","Saqlash")}
        </button>
        <button onClick={onCancel} className="btn-secondary flex-1 sm:flex-none">{t("Отмена","Bekor qilish")}</button>
      </div>
    </div>
  );
}

const ProductCard = memo(function ProductCard({ p, onClick, onDelete, selected, onToggleSelect, lang, fmt }: { p: any; onClick:()=>void; onDelete:(id:number)=>void; selected?:boolean; onToggleSelect?:()=>void; lang:string; fmt: (v: string | number, opts?: Record<string, unknown>) => string }) {
  const t = (ru:string,uz:string) => lang==="uz"?uz:ru;
  const low = Number(p.available??0) < Number(p.reorderPoint);
  const u = unitLabel(p.unit as string, lang);
  return (
    <div
      style={{
        background: COLORS.surface, borderRadius: "16px", padding: "16px",
        boxShadow: SHADOW, display: "flex", alignItems: "center", gap: "16px",
        cursor: "pointer", transition: "all 0.2s",
        border: selected ? `2px solid ${COLORS.primary}` : "2px solid transparent",
      }}
      onClick={onClick}
      onMouseEnter={e => {
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {onToggleSelect && (
        <button
          onClick={e => { e.stopPropagation(); onToggleSelect(); }}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, flexShrink: 0, display: "flex" }}
        >
          {selected
            ? <CheckSquare size={20} style={{ color: COLORS.primary }} />
            : <Square size={20} style={{ color: COLORS.textTertiary }} />
          }
        </button>
      )}
      <ProductPhoto productId={p.id as number} photoUrl={p.photoUrl as string} size="lg"/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontFamily: F.display, fontWeight: 600, color: COLORS.textPrimary, fontSize: "16px", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {String(p.name)}
            </p>
            <p style={{ fontFamily: F.body, color: COLORS.textSecondary, fontSize: "12px", margin: "4px 0 0" }}>
              {String(p.code)}
            </p>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <p style={{ fontFamily: F.display, fontSize: "18px", fontWeight: 700, color: COLORS.primary, margin: 0 }}>
              {fmt(String(p.unitPrice),{decimals:2})}
            </p>
            {Number(p.costPrice)>0 && (
              <p style={{ fontSize: "11px", color: COLORS.textSecondary, margin: "2px 0 0" }}>
                {t("себест.","tannarx")} {fmt(String(p.costPrice),{decimals:2})}
              </p>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
          {p.category && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "4px",
              fontSize: "11px", padding: "2px 8px", borderRadius: "6px",
              background: COLORS.surfaceLight, color: COLORS.textSecondary,
              fontFamily: F.body,
            }}>
              <Tag size={10}/>{String(p.category)}
            </span>
          )}
          {Number(p.unitWeight)>0 && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "4px",
              fontSize: "11px", padding: "2px 8px", borderRadius: "6px",
              background: COLORS.surfaceLight, color: COLORS.textSecondary,
              fontFamily: F.body,
            }}>
              <Scale size={10}/>1 {u} = {Number(p.unitWeight).toFixed(2)} {t("кг","kg")}
            </span>
          )}
          <span style={{
            marginLeft: "auto", fontSize: "12px", fontFamily: F.body, fontWeight: 600,
            padding: "2px 8px", borderRadius: "6px",
            background: low ? "rgba(220,38,38,0.15)" : "rgba(22,163,74,0.15)",
            color: low ? "var(--color-danger)" : "var(--color-success)",
          }}>
            {Number(p.available??0).toFixed(0)} {u}
          </span>
          <button
            onClick={e => { e.stopPropagation(); onDelete(Number(p.id)); }}
            style={{
              width: "28px", height: "28px", borderRadius: "8px", border: "none",
              background: "rgba(220,38,38,0.1)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.15s", flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(220,38,38,0.2)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(220,38,38,0.1)"; }}
            title={t("Удалить","O'chirish")}
          >
            <Trash2 size={13} style={{ color: "var(--color-danger)" }} />
          </button>
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
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const navigate             = useNavigate();
  const {data,isLoading}     = trpc.product.list.useQuery({page,pageSize:25,search:search||undefined,category}) as { data: any; isLoading: boolean };
  const {data:categories}    = trpc.product.categories.useQuery();
  const utils                = trpc.useUtils();
  const createMutation       = trpc.product.create.useMutation({
    onSuccess:()=>{ utils.product.list.invalidate(); setShowForm(false); notify.success("Товар добавлен"); },
    onError:(e)=>notify.error(e.message),
  });
  const deleteMutation       = trpc.product.delete.useMutation({
    onSuccess:()=>{ utils.product.list.invalidate(); notify.success("Товар удалён"); },
    onError:(e)=>notify.error(e.message),
  });
  const { confirm, dialog }  = useConfirm();
  const t = useCallback((ru:string,uz:string) => lang==="uz"?uz:ru, [lang]);

  // Calculate stats for KPI cards
  const totalCount = data?.total ?? 0;
  const lowStockCount = data?.data?.filter((p: any) => Number(p.available ?? 0) < Number(p.reorderPoint)).length ?? 0;
  const categoryCount = categories?.length ?? 0;

  const handleDelete = async (id: number, name: string) => {
    const ok = await confirm({
      title: t("Удалить товар?", "Mahsulot o'chirilsinmi?"),
      message: t(`«${name}» будет удалён навсегда.`, `«${name}» doimiy o'chiriladi.`),
      confirmText: t("Удалить", "O'chirish"),
      danger: true,
    });
    if (ok) deleteMutation.mutate({ id });
  };

  const allVisibleIds = useMemo(() => (data?.data ?? []).map((p: any) => p.id as number), [data]);
  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every(id => selected.has(id));

  const toggleSelect = useCallback((id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allVisibleIds));
    }
  }, [allSelected, allVisibleIds]);

  const handleBulkDelete = async () => {
    const count = selected.size;
    if (count === 0) return;
    const ok = await confirm({
      title: t(`Удалить ${count} товаров?`, `${count} ta mahsulot o'chirilsinmi?`),
      message: t("Данные будут удалены безвозвратно.", "Ma'lumotlar qaytarib bo'lmaydigan tarzda o'chiriladi."),
      confirmText: t("Удалить", "O'chirish"),
      danger: true,
    });
    if (ok) {
      for (const id of selected) {
        await deleteMutation.mutateAsync({ id });
      }
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {dialog}
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontFamily: F.display, fontSize: "24px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.025em", margin: 0 }}>
            {t("Товары","Mahsulotlar")}
          </h1>
          <p style={{ fontSize: "13px", color: COLORS.textSecondary, margin: "4px 0 0" }}>
            {t("Управление каталогом товаров","Mahsulotlar katalogini boshqarish")}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={()=>setShowImport(v=>!v)}
            style={{
              display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
              fontSize: "13px", fontWeight: 500, fontFamily: F.body, borderRadius: "10px",
              border: `1px solid ${COLORS.border}`, cursor: "pointer",
              background: COLORS.surface, color: COLORS.textSecondary,
            }}
          >
            <Upload size={14}/><span className="hidden sm:inline">{t("Импорт","Import")}</span>
          </button>
          <button
            onClick={()=>data?.data && exportToExcel(formatProductsForExport(data.data), "products-export", "Товары", t("Список товаров", "Mahsulotlar ro'yxati"))}
            style={{
              display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
              fontSize: "13px", fontWeight: 500, fontFamily: F.body, borderRadius: "10px",
              border: `1px solid ${COLORS.border}`, cursor: "pointer",
              background: COLORS.surface, color: COLORS.textSecondary,
            }}
          >
            <FileDown size={14}/><span className="hidden sm:inline">Excel</span>
          </button>
          <button
            onClick={()=>setShowForm(!showForm)}
            style={{
              display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
              fontSize: "13px", fontWeight: 500, fontFamily: F.body, borderRadius: "10px",
              border: "none", cursor: "pointer",
              background: "linear-gradient(135deg, #6366F1, #8B5CF6)", color: "#fff",
              boxShadow: "0 2px 8px rgba(99,102,241,0.3)",
            }}
          >
            <Plus size={14}/><span className="hidden sm:inline">{t("Добавить","Qo'shish")}</span>
          </button>
        </div>
      </div>

      {/* Import Section */}
      {showImport && <ExcelImport type="products" onDone={()=>{setShowImport(false);utils.product.list.invalidate();}} onCancel={()=>setShowImport(false)}/>}

      {/* Form Section */}
      {showForm && <ProductForm isPending={createMutation.isPending} lang={lang} onSave={d=>createMutation.mutate(d as any)} onCancel={()=>setShowForm(false)}/>}

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
        <KpiCard
          label={t("ВСЕГО ТОВАРОВ", "JAMI MAHSULOTLAR")}
          value={String(totalCount)}
          delta={null}
          icon={<Box size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #6366F1, #8B5CF6)"
          delay={0}
        />
        <KpiCard
          label={t("С КАТЕГОРИЯМИ", "KATEGORIYALI")}
          value={String(categoryCount)}
          delta={null}
          icon={<Tag size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #16a34a, #22c47a)"
          delay={0.05}
        />
        <KpiCard
          label={t("НИЗКИЙ ОСТАТОК", "KAM QOLDIQ")}
          value={String(lowStockCount)}
          delta={lowStockCount > 0 ? -100 : 0}
          icon={<AlertTriangle size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #F97316, #EA580C)"
          delay={0.1}
        />
        <KpiCard
          label={t("СЕССИЯ", "SEANS")}
          value={`p.${page}`}
          delta={null}
          icon={<BarChart3 size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #8B5CF6, #A855F7)"
          delay={0.15}
        />
      </div>

      {/* Search and Filter */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: 1, minWidth: "200px" }}>
            <Search size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: COLORS.textSecondary }}/>
            <input
              className="input-field"
              style={{ paddingLeft: "36px", width: "100%" }}
              placeholder={t("Поиск товаров…","Mahsulot qidirish…")}
              value={search}
              onChange={e=>{setSearch(e.target.value);setPage(1);}}
            />
          </div>
          {!!categories?.length && (
            <PremiumSelect
              value={category??""}
              onChange={v=>{setCategory(v||undefined);setPage(1);}}
              options={[{value:"",label:t("Все категории","Barcha kategoriyalar")},...(categories??[]).map(c=>({value:String(c),label:String(c)}))]}
              width="200px"
            />
          )}
        </div>
      </div>

      {/* Selection bar */}
      {selected.size > 0 && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 20px", borderRadius: "14px",
          background: "color-mix(in srgb, var(--color-primary) 8%, var(--color-surface))",
          border: "1px solid color-mix(in srgb, var(--color-primary) 20%, transparent)",
        }}>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-primary)" }}>
            {selected.size} {t("выбрано","tanlangan")}
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={()=>setSelected(new Set())} className="btn-secondary text-xs py-1.5 px-3">
              {t("Сбросить","Bekor qilish")}
            </button>
            <button onClick={handleBulkDelete} disabled={deleteMutation.isPending}
              style={{
                display: "flex", alignItems: "center", gap: "5px", padding: "6px 14px",
                fontSize: "12px", fontWeight: 600, borderRadius: "8px",
                border: "none", cursor: "pointer", color: "#fff",
                background: "var(--color-danger)", opacity: deleteMutation.isPending ? 0.5 : 1,
              }}>
              <Trash2 size={13} />{t("Удалить","O'chirish")}
            </button>
          </div>
        </div>
      )}

      {/* Select all */}
      {data && data.data.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button onClick={toggleSelectAll}
            style={{ background: "none", border: "none", cursor: "pointer", padding: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
            {allSelected
              ? <CheckSquare size={16} style={{ color: COLORS.primary }} />
              : <Square size={16} style={{ color: COLORS.textTertiary }} />
            }
            <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>{t("Выбрать все","Barchasini tanlash")}</span>
          </button>
        </div>
      )}

      {/* Product List */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {isLoading ? (
          Array.from({length:5}).map((_,i) => (
            <div key={i} style={{
              height: "120px", borderRadius: "16px",
              background: COLORS.surfaceLight, animation: `slideUp ${0.4 + i * 0.05}s ease forwards`,
            }}/>
          ))
        ) : data?.data.length === 0 ? (
          <div style={{
            background: COLORS.surface, borderRadius: "24px", padding: "48px",
            boxShadow: SHADOW, textAlign: "center",
          }}>
            <Package size={48} style={{ color: COLORS.textTertiary, margin: "0 auto 16px" }} />
            <p style={{ color: COLORS.textSecondary, fontSize: "14px", margin: 0 }}>
              {t("Нет товаров","Mahsulot yo'q")}
            </p>
          </div>
        ) : (
          data?.data.map((p: any) => (
            <ProductCard key={p.id} p={p} lang={lang} fmt={fmt}
              onClick={()=>navigate(`/products/${p.id}`)}
              onDelete={(id)=>handleDelete(id, String(p.name))}
              selected={selected.has(p.id)}
              onToggleSelect={()=>toggleSelect(p.id)}
            />
          ))
        )}
      </div>

      {/* Pagination */}
      {data && data.total > 25 && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: COLORS.surface, borderRadius: "16px", padding: "16px 20px",
          boxShadow: SHADOW,
        }}>
          <span style={{ fontSize: "13px", color: COLORS.textSecondary, fontFamily: F.body }}>
            {data.total} {t("всего","jami")}
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}
              style={{
                padding: "8px 16px", fontSize: "13px", fontWeight: 500, fontFamily: F.body,
                borderRadius: "8px", border: `1px solid ${COLORS.border}`, cursor: "pointer",
                background: COLORS.surface, color: page===1 ? COLORS.textTertiary : COLORS.textPrimary,
                opacity: page===1 ? 0.5 : 1,
              }}
            >
              {t("Назад","Orqaga")}
            </button>
            <button
              onClick={()=>setPage(p=>p+1)} disabled={page*25>=data.total}
              style={{
                padding: "8px 16px", fontSize: "13px", fontWeight: 500, fontFamily: F.body,
                borderRadius: "8px", border: "none", cursor: "pointer",
                background: "linear-gradient(135deg, #6366F1, #8B5CF6)", color: "#fff",
                boxShadow: "0 2px 8px rgba(99,102,241,0.3)",
                opacity: page*25>=data.total ? 0.5 : 1,
              }}
            >
              {t("Далее","Keyingi")}
            </button>
          </div>
        </div>
      )}

      {/* SlideUp Animation Keyframes */}
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
