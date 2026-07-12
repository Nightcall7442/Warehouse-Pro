import { memo, useCallback, useMemo, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { notify } from "@/lib/toast";
import { exportToExcel, formatShopsForExport } from "@/lib/excel";
import { ExcelImport } from "@/components/ExcelImport";
import { useNavigate } from "react-router";
import { Search, Plus, Store, MapPin, Phone, Camera, Loader2, X, ChevronRight, AlertCircle, FileDown, Upload, Users, TrendingUp, DollarSign, ArrowUpRight, ArrowDownRight, Minus, Trash2, CheckSquare, Square } from "lucide-react";
import { PremiumSelect } from "@/components/PremiumSelect";
import { useConfirm } from "@/components/ConfirmDialog";

/* ── Premium Design Constants ── */
const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };
const COLORS = {
  primary: "#818cf8", success: "#4ade80",
  warning: "#fbbf24", danger: "#f87171",
  surface: "#ffffff", surfaceLight: "#f8f9fb",
  textPrimary: "#111827", textSecondary: "#6b7280",
  textTertiary: "#9ca3af", border: "#f3f4f6",
};
const SHADOW = "0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04)";

/* ── KpiCard Component ── */
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
          color: isPositive ? "#4ade80" : isNegative ? "#f87171" : COLORS.textTertiary,
        }}>
          {isPositive ? <ArrowUpRight size={14} /> : isNegative ? <ArrowDownRight size={14} /> : <Minus size={14} />}
          {Math.abs(delta).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

// Photo upload for shops list cards
function ShopPhoto({ shopId, photoUrl, size="md" }: { shopId:number; photoUrl?:string|null; size?:"sm"|"md"|"lg" }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const utils   = trpc.useUtils();
  const upload  = trpc.shop.uploadPhoto.useMutation({
    onSuccess: () => { utils.shop.list.invalidate(); utils.shop.getById.invalidate({id:shopId}); notify.success("Фото обновлено"); },
    onError:   (e) => notify.error(e.message),
  });
  const dim      = size==="sm"?"w-12 h-12":size==="lg"?"w-20 h-20":"w-16 h-16";
  const iconSize = size==="sm"?18:size==="lg"?32:22;
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file=e.target.files?.[0]; if(!file) return;
    if(file.size>2*1024*1024){notify.error("Макс. 2 МБ");return;}
    const r=new FileReader(); r.onload=()=>upload.mutate({shopId,dataUrl:r.result as string}); r.readAsDataURL(file); e.target.value="";
  };
  return (
    <div className="relative group" onClick={e=>e.stopPropagation()}>
      <div className={`${dim} rounded-xl overflow-hidden flex items-center justify-center flex-shrink-0 cursor-pointer border border-border-subtle`}
        style={{background:"rgba(129,140,248,.08)"}} onClick={()=>fileRef.current?.click()}>
        {upload.isPending?<Loader2 size={iconSize} className="text-primary animate-spin"/>
          :photoUrl?<img src={photoUrl} alt="" className="w-full h-full object-cover" loading="lazy"/>
          :<Store size={iconSize} className="text-primary"/>}
        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-xl">
          <Camera size={iconSize-4} color="#fff"/>
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile}/>
    </div>
  );
}

// Shop create form
interface ShopFormData { name: string; ownerName: string; phone: string; address: string; city: string; district: string; agentId: number | undefined; notes: string; photoUrl?: string; }
interface AgentOption { id: number; name: string; }
function ShopForm({ onSave, onCancel, isPending, lang, agents }: { onSave:(d:ShopFormData)=>void; onCancel:()=>void; isPending:boolean; lang:string; agents:AgentOption[] }) {
  const t = (ru:string,uz:string) => lang==="uz"?uz:ru;
  const [d, setD] = useState({ name:"", ownerName:"", phone:"", address:"", city:"", district:"", agentId:"", notes:"" });
  const [photo, setPhoto] = useState<string|null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file=e.target.files?.[0]; if(!file) return;
    if(file.size>2*1024*1024){notify.error("Макс. 2 МБ");return;}
    const r=new FileReader(); r.onload=()=>setPhoto(r.result as string); r.readAsDataURL(file);
  };
  return (
    <div style={{
      background: COLORS.surface, borderRadius: "24px", padding: "24px",
      boxShadow: SHADOW,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
        <h2 style={{ fontFamily: F.display, fontSize: "18px", fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
          {t("Новый магазин","Yangi do'kon")}
        </h2>
        <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px" }}>
          <X size={18} style={{ color: COLORS.textSecondary }}/>
        </button>
      </div>
      <div style={{ display: "flex", gap: "20px" }}>
        {/* Photo */}
        <div style={{ flexShrink: 0 }}>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto}/>
          <div style={{
            width: "80px", height: "80px", borderRadius: "16px", overflow: "hidden",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", position: "relative", border: `1px solid ${COLORS.border}`,
            background: "rgba(129,140,248,.08)",
          }} onClick={()=>fileRef.current?.click()}>
            {photo?<img src={photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<Store size={28} style={{color:COLORS.primary}}/>}
            <div style={{
              position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)",
              opacity: 0, display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", gap: "4px", borderRadius: "16px",
              transition: "opacity 0.2s",
            }} className="group-hover:opacity-100">
              <Camera size={16} color="#fff"/><span style={{color:"#fff",fontSize:"9px"}}>{t("Фото","Rasm")}</span>
            </div>
          </div>
          <p style={{ fontSize: "10px", color: COLORS.textSecondary, textAlign: "center", marginTop: "4px" }}>
            {t("Фото магазина","Do'kon rasmi")}
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px", flex: 1 }}>
          <input className="input-field" placeholder={t("Название *","Nomi *")} value={d.name} onChange={e=>setD({...d,name:e.target.value})}/>
          <input className="input-field" placeholder={t("Владелец","Egasi")} value={d.ownerName} onChange={e=>setD({...d,ownerName:e.target.value})}/>
          <input className="input-field" placeholder={t("Телефон","Telefon")} value={d.phone} onChange={e=>setD({...d,phone:e.target.value})}/>
          <input className="input-field" placeholder={t("Город","Shahar")} value={d.city} onChange={e=>setD({...d,city:e.target.value})}/>
          <input className="input-field" placeholder={t("Район","Tuman")} value={d.district} onChange={e=>setD({...d,district:e.target.value})}/>
          <input className="input-field" placeholder={t("Адрес","Manzil")} value={d.address} onChange={e=>setD({...d,address:e.target.value})}/>
          {agents.length>0&&(
            <PremiumSelect value={d.agentId} onChange={v=>setD({...d,agentId:v})}
              options={[{value:"",label:t("— Агент —","— Agent —")},...(agents??[]).map((a:AgentOption)=>({value:String(a.id),label:String(a.name)}))]}
              width="100%" />
          )}
          <textarea className="input-field resize-none" style={{gridColumn:"span 2"}} rows={2} placeholder={t("Заметки","Izoh")} value={d.notes} onChange={e=>setD({...d,notes:e.target.value})}/>
        </div>
      </div>
      <div style={{ display: "flex", gap: "12px", marginTop: "20px" }}>
        <button onClick={()=>d.name&&onSave({...d,agentId:d.agentId?Number(d.agentId):undefined,photoUrl:photo??undefined} as ShopFormData)}
          disabled={isPending} className="btn-primary flex-1 sm:flex-none flex items-center justify-center gap-2">
          {isPending&&<Loader2 size={14} className="animate-spin"/>}{t("Сохранить","Saqlash")}
        </button>
        <button onClick={onCancel} className="btn-secondary flex-1 sm:flex-none">{t("Отмена","Bekor qilish")}</button>
      </div>
    </div>
  );
}

// Shop card
interface ShopCardData { id: number; name: string; ownerName: string | null; phone: string | null; city: string | null; district: string | null; status: string; debt: string | null; photoUrl: string | null; agentName: string | null; }
const ShopCard = memo(function ShopCard({ s, onClick, selected, onToggleSelect, lang, fmt, delay }: { s:ShopCardData; onClick:()=>void; selected?:boolean; onToggleSelect?:()=>void; lang:string; fmt:(v: number | string | null | undefined, opts?: { decimals?: number }) => string; delay:number }) {
  const t = (ru:string,uz:string) => lang==="uz"?uz:ru;
  const hasDebt = Number(s.debt??0) > 0;
  return (
    <div style={{
      background: COLORS.surface, borderRadius: "24px", padding: "20px",
      boxShadow: SHADOW, display: "flex", alignItems: "center", gap: "16px",
      cursor: "pointer", transition: "transform 0.2s, box-shadow 0.2s",
      animation: `slideUp ${0.4 + delay}s ease forwards`,
      border: selected ? `2px solid ${COLORS.primary}` : "2px solid transparent",
    }}
    onClick={onClick}
    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 20px rgba(0,0,0,0.08)"; }}
    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(0)"; (e.currentTarget as HTMLElement).style.boxShadow = SHADOW; }}
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
      <ShopPhoto shopId={s.id} photoUrl={s.photoUrl} size="lg"/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontFamily: F.display, fontWeight: 600, color: COLORS.textPrimary, fontSize: "16px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>
              {s.name}
            </p>
            {s.ownerName&&<p style={{ fontSize: "12px", color: COLORS.textSecondary, marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>
              {s.ownerName}
            </p>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
            {hasDebt&&<span style={{
              display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px", fontWeight: 600,
              padding: "2px 8px", borderRadius: "9999px", background: "rgba(248,113,113,.15)",
              color: "#f87171", fontFamily: F.body,
            }}><AlertCircle size={11}/>{fmt(s.debt,{decimals:0})}</span>}
            <span style={{
              fontSize: "10px", padding: "2px 8px", borderRadius: "9999px", fontWeight: 500,
              background: s.status==="active" ? "rgba(74,222,128,.15)" : COLORS.surfaceLight,
              color: s.status==="active" ? "#4ade80" : COLORS.textSecondary,
            }}>
              {s.status==="active"?t("Актив","Aktiv"):t("Неактив","Noaktiv")}
            </span>
            <ChevronRight size={16} style={{ color: COLORS.textSecondary }}/>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "8px", flexWrap: "wrap" }}>
          {(s.city||s.district)&&(
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", color: COLORS.textSecondary }}>
              <MapPin size={10}/>{[s.city,s.district].filter(Boolean).join(", ")}
            </span>
          )}
          {s.phone&&<span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", color: COLORS.textSecondary }}><Phone size={10}/>{s.phone}</span>}
          {s.agentName&&<span style={{ marginLeft: "auto", fontSize: "11px", color: COLORS.textSecondary }}>👤 {s.agentName}</span>}
        </div>
      </div>
    </div>
  );
});

export default function Shops() {
  const {lang} = useLang();
  const {fmt}  = useCurrency();
  const navigate = useNavigate();
  const t = useCallback((ru:string,uz:string) => lang==="uz"?uz:ru, [lang]);

  const [page,setPage]     = useState(1);
  const [search,setSearch] = useState("");
  const [city,setCity]     = useState<string|undefined>(undefined);
  const [district,setDistrict] = useState<string|undefined>(undefined);
  const [agentFilter,setAgentFilter] = useState<string|undefined>(undefined);
  const [showForm,setShowForm] = useState(false);
  const [showImport,setShowImport] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const {data,isLoading}   = trpc.shop.list.useQuery({page,pageSize:25,search:search||undefined,city,district,agentId:agentFilter?Number(agentFilter):undefined}) as { data: any; isLoading: boolean };
  const {data:cities}      = trpc.shop.cities.useQuery();
  const {data:districts}   = trpc.shop.districts.useQuery({city});
  const {data:usersData}   = trpc.user.list.useQuery({page:1,pageSize:100});
  const agents = useMemo(() => (usersData?.data??[]).filter((u:{role:string})=>u.role==="agent"), [usersData?.data]);
  const utils = trpc.useUtils();

  const createMutation = trpc.shop.create.useMutation({
    onSuccess:()=>{ utils.shop.list.invalidate(); utils.shop.cities.invalidate(); setShowForm(false); notify.success("Магазин добавлен"); },
    onError:(e)=>notify.error(e.message),
  });
  const deleteMutation = trpc.shop.delete.useMutation({
    onSuccess:()=>{ utils.shop.list.invalidate(); setSelected(new Set()); notify.success("Магазины удалены"); },
    onError:(e)=>notify.error(e.message),
  });
  const { confirm, dialog } = useConfirm();

  // Compute KPI stats from data
  const kpiStats = useMemo(() => {
    const shops = data?.data ?? [];
    const total = data?.total ?? 0;
    const activeCount = shops.filter((s: any) => s.status === "active").length;
    const debtCount = shops.filter((s: any) => Number(s.debt ?? 0) > 0).length;
    const totalDebt = shops.reduce((sum: number, s: any) => sum + Number(s.debt ?? 0), 0);
    return { total, activeCount, debtCount, totalDebt };
  }, [data]);

  const allVisibleIds = useMemo(() => (data?.data ?? []).map((s: any) => s.id as number), [data]);
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
      title: t(`Удалить ${count} магазинов?`, `${count} ta do'kon o'chirilsinmi?`),
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

  // Loading skeleton
  if (isLoading && !data) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ height: "28px", width: "200px", borderRadius: "8px", background: COLORS.surfaceLight, marginBottom: "8px" }} />
            <div style={{ height: "16px", width: "260px", borderRadius: "6px", background: COLORS.surfaceLight }} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{ height: "140px", borderRadius: "24px", background: COLORS.surfaceLight, animation: `slideUp ${0.4 + i * 0.05}s ease forwards` }} />
          ))}
        </div>
        {Array.from({length:4}).map((_,i) => (
          <div key={i} style={{ height: "96px", borderRadius: "24px", background: COLORS.surfaceLight, animation: `slideUp ${0.4 + i * 0.05}s ease forwards` }} />
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {dialog}
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontFamily: F.display, fontSize: "24px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.025em", margin: 0 }}>
            {t("Магазины","Do'konlar")}
          </h1>
          <p style={{ fontSize: "13px", color: COLORS.textSecondary, margin: "4px 0 0" }}>
            {t("Управление точками продаж","Savdo nuqtalarini boshqarish")}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button onClick={() => data?.data && exportToExcel(formatShopsForExport(data.data), "shops-export", "Магазины", t("Список магазинов", "Do'konlar ro'yxati"))}
            style={{
              display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
              fontSize: "13px", fontWeight: 500, fontFamily: F.body, borderRadius: "10px",
              border: `1px solid ${COLORS.border}`, cursor: "pointer",
              background: COLORS.surface, color: COLORS.textSecondary,
            }}>
            <FileDown size={14} /> Excel
          </button>
          <button onClick={()=>setShowImport(v=>!v)} style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
            fontSize: "13px", fontWeight: 500, fontFamily: F.body, borderRadius: "10px",
            border: `1px solid ${COLORS.border}`, cursor: "pointer",
            background: COLORS.surface, color: COLORS.textSecondary,
          }}>
            <Upload size={14}/><span className="hidden sm:inline">{t("Импорт","Import")}</span>
          </button>
          <button onClick={()=>setShowForm(!showForm)} className="btn-primary flex items-center gap-2">
            <Plus size={16}/><span className="hidden sm:inline">{t("Добавить","Qo'shish")}</span>
          </button>
        </div>
      </div>

      {showForm&&<ShopForm isPending={createMutation.isPending} lang={lang} agents={agents} onSave={d=>createMutation.mutate(d)} onCancel={()=>setShowForm(false)}/>}

      {showImport&&<ExcelImport type="shops" onDone={()=>{setShowImport(false);utils.shop.list.invalidate();}} onCancel={()=>setShowImport(false)}/>}

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
        <KpiCard
          label={t("ВСЕГО МАГАЗИНОВ","JAMI DO'KONLAR")}
          value={String(kpiStats.total)}
          delta={null}
          icon={<Store size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #818cf8, #6366f1)"
          delay={0}
        />
        <KpiCard
          label={t("АКТИВНЫЕ","FAOLLAR")}
          value={String(kpiStats.activeCount)}
          delta={null}
          icon={<Users size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #16a34a, #22c47a)"
          delay={0.05}
        />
        <KpiCard
          label={t("С ДОЛГОМ","QARZDOR")}
          value={String(kpiStats.debtCount)}
          delta={null}
          icon={<AlertCircle size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #fb923c, #f97316)"
          delay={0.1}
        />
        <KpiCard
          label={t("ОБЩИЙ ДОЛГ","UMUMIY QARZ")}
          value={fmt(kpiStats.totalDebt, { decimals: 0 })}
          delta={null}
          icon={<DollarSign size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #f87171, #ef4444)"
          delay={0.15}
        />
      </div>

      {/* Filters */}
      <div style={{
        background: COLORS.surface, borderRadius: "16px", padding: "16px 20px",
        boxShadow: SHADOW, display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
      }}>
        <div style={{ position: "relative", flex: 1, minWidth: "200px" }}>
          <Search size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: COLORS.textSecondary }}/>
          <input className="input-field" style={{ paddingLeft: "40px", width: "100%" }} placeholder={t("Поиск магазинов…","Do'kon qidirish…")} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>
        </div>
        {agents.length > 0 && (
          <PremiumSelect value={agentFilter??""} onChange={v=>{setAgentFilter(v||undefined);setPage(1);}}
            options={[{value:"",label:t("Все агенты","Barcha agentlar"),...(agents??[]).map((a:{id:number;name:string})=>({value:String(a.id),label:a.name}))}]}
            width="180px" />
        )}
        {(!!cities?.length || !!districts?.length) && (
          <div style={{ display: "flex", gap: "8px" }}>
            {!!cities?.length && (
              <PremiumSelect value={city??""} onChange={v=>{setCity(v||undefined);setDistrict(undefined);setPage(1);}}
                options={[{value:"",label:t("Все города","Barcha shaharlar")},...(cities??[]).map((c: any)=>({value:String(c),label:String(c)}))]}
                width="180px" />
            )}
            {!!districts?.length && (
              <PremiumSelect value={district??""} onChange={v=>{setDistrict(v||undefined);setPage(1);}}
                options={[{value:"",label:t("Все районы","Barcha tumanlar")},...(districts??[]).map((d: any)=>({value:String(d),label:String(d)}))]}
                width="180px" />
            )}
          </div>
        )}
        {(city||district||agentFilter)&&(
          <button onClick={()=>{setCity(undefined);setDistrict(undefined);setAgentFilter(undefined);setPage(1);}} className="btn-secondary text-sm px-3 flex items-center gap-1">
            <X size={14}/>{t("Сбросить","Tozalash")}
          </button>
        )}
      </div>

      {/* City/district breadcrumb */}
      {(city||district)&&(
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: COLORS.textSecondary }}>
          <MapPin size={14} style={{ color: COLORS.primary }}/>
          <span>{city&&<strong style={{ color: COLORS.textPrimary }}>{city}</strong>}</span>
          {district&&<><span>›</span><strong style={{ color: COLORS.textPrimary }}>{district}</strong></>}
          <span style={{ color: COLORS.textSecondary }}>({data?.total??0} {t("магазинов","do'kon")})</span>
        </div>
      )}

      {/* Selection bar */}
      {selected.size > 0 && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 20px", borderRadius: "14px",
          background: "#eff6ff",
          border: "1px solid rgba(129,140,248,.20)",
        }}>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "#818cf8" }}>
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
                background: "#f87171", opacity: deleteMutation.isPending ? 0.5 : 1,
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

      {/* Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {isLoading?Array.from({length:4}).map((_,i)=>(
          <div key={i} style={{ height: "96px", borderRadius: "24px", background: COLORS.surfaceLight, animation: `slideUp ${0.4 + i * 0.05}s ease forwards` }}/>
        ))
          :data?.data.length===0?<p style={{ textAlign: "center", color: COLORS.textSecondary, padding: "48px 0", fontSize: "14px" }}>{t("Нет магазинов","Do'kon yo'q")}</p>
          :data?.data.map((s: any, i: number)=><ShopCard key={s.id} s={s} lang={lang} fmt={fmt} delay={i*0.03}
            onClick={()=>navigate(`/shops/${s.id}`)}
            selected={selected.has(s.id)}
            onToggleSelect={()=>toggleSelect(s.id)}
          />)}
      </div>

      {data&&data.total>25&&(
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "13px", color: COLORS.textSecondary }}>{data.total} {t("всего","jami")}</span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1} className="btn-secondary py-1 px-3 text-sm disabled:opacity-40">{t("Назад","Orqaga")}</button>
            <button onClick={()=>setPage(p=>p+1)} disabled={page*25>=data.total} className="btn-secondary py-1 px-3 text-sm disabled:opacity-40">{t("Далее","Keyingi")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
