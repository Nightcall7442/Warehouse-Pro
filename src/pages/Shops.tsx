import { memo, useCallback, useMemo, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { notify } from "@/lib/toast";
import { exportToExcel, formatShopsForExport } from "@/lib/excel";
import { ExcelImport } from "@/components/ExcelImport";
import { useNavigate } from "react-router";
import { Search, Plus, Store, MapPin, Phone, Camera, Loader2, X, ChevronRight, AlertCircle, FileDown, Upload } from "lucide-react";
import { PremiumSelect } from "@/components/PremiumSelect";

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
        style={{background:"color-mix(in srgb, var(--color-primary) 8%, transparent)"}} onClick={()=>fileRef.current?.click()}>
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
    <div className="panel p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg font-semibold text-text-primary">{t("Новый магазин","Yangi do'kon")}</h2>
        <button onClick={onCancel}><X size={18} className="text-text-secondary"/></button>
      </div>
      <div className="flex gap-4">
        {/* Photo */}
        <div className="flex-shrink-0">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto}/>
          <div className="w-20 h-20 rounded-xl overflow-hidden flex items-center justify-center cursor-pointer relative group border border-border-subtle"
            style={{background:"color-mix(in srgb, var(--color-primary) 8%, transparent)"}} onClick={()=>fileRef.current?.click()}>
            {photo?<img src={photo} alt="" className="w-full h-full object-cover"/>:<Store size={28} className="text-primary"/>}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 rounded-xl">
              <Camera size={16} color="#fff"/><span className="text-white text-[9px]">{t("Фото","Rasm")}</span>
            </div>
          </div>
          <p className="text-[10px] text-text-secondary text-center mt-1">{t("Фото магазина","Do'kon rasmi")}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
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
          <textarea className="input-field sm:col-span-2 resize-none" rows={2} placeholder={t("Заметки","Izoh")} value={d.notes} onChange={e=>setD({...d,notes:e.target.value})}/>
        </div>
      </div>
      <div className="flex gap-2 mt-4">
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
const ShopCard = memo(function ShopCard({ s, onClick, lang, fmt }: { s:ShopCardData; onClick:()=>void; lang:string; fmt:(v: number | string | null | undefined, opts?: { decimals?: number }) => string }) {
  const t = (ru:string,uz:string) => lang==="uz"?uz:ru;
  const hasDebt = Number(s.debt??0) > 0;
  return (
    <div className="panel panel-hover p-4 flex items-center gap-4" onClick={onClick}>
      <ShopPhoto shopId={s.id} photoUrl={s.photoUrl} size="lg"/>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-display font-semibold text-text-primary text-base truncate">{s.name}</p>
            {s.ownerName&&<p className="text-xs text-text-secondary mt-0.5 truncate">{s.ownerName}</p>}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {hasDebt&&<span className="inline-flex items-center gap-1 text-xs font-data font-semibold px-2 py-0.5 rounded-full bg-danger/15 text-danger"><AlertCircle size={11}/>{fmt(s.debt,{decimals:0})}</span>}
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${s.status==="active"?"bg-success/15 text-success":"bg-surface-light text-text-secondary"}`}>
              {s.status==="active"?t("Актив","Aktiv"):t("Неактив","Noaktiv")}
            </span>
            <ChevronRight size={16} className="text-text-secondary"/>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          {(s.city||s.district)&&(
            <span className="inline-flex items-center gap-1 text-[11px] text-text-secondary">
              <MapPin size={10}/>{[s.city,s.district].filter(Boolean).join(", ")}
            </span>
          )}
          {s.phone&&<span className="inline-flex items-center gap-1 text-[11px] text-text-secondary"><Phone size={10}/>{s.phone}</span>}
          {s.agentName&&<span className="ml-auto text-[11px] text-text-secondary">👤 {s.agentName}</span>}
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-text-primary tracking-tight">{t("Магазины","Do'konlar")}</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => data?.data && exportToExcel(formatShopsForExport(data.data), "shops-export", "Магазины", t("Список магазинов", "Do'konlar ro'yxati"))}
            className="btn-secondary flex items-center gap-2 text-sm py-2 px-4">
            <FileDown size={15} /> Excel
          </button>
          <button onClick={()=>setShowImport(v=>!v)} className="btn-secondary flex items-center gap-2 text-sm py-2">
            <Upload size={15}/><span className="hidden sm:inline">{t("Импорт","Import")}</span>
          </button>
          <button onClick={()=>setShowForm(!showForm)} className="btn-primary flex items-center gap-2">
            <Plus size={16}/><span className="hidden sm:inline">{t("Добавить","Qo'shish")}</span>
          </button>
        </div>
      </div>

      {showForm&&<ShopForm isPending={createMutation.isPending} lang={lang} agents={agents} onSave={d=>createMutation.mutate(d)} onCancel={()=>setShowForm(false)}/>}

      {showImport&&<ExcelImport type="shops" onDone={()=>{setShowImport(false);utils.shop.list.invalidate();}} onCancel={()=>setShowImport(false)}/>}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"/>
          <input className="input-field pl-10 w-full" placeholder={t("Поиск магазинов…","Do'kon qidirish…")} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>
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
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <MapPin size={14} className="text-primary"/>
          <span>{city&&<strong className="text-text-primary">{city}</strong>}</span>
          {district&&<><span>›</span><strong className="text-text-primary">{district}</strong></>}
          <span className="text-text-secondary">({data?.total??0} {t("магазинов","do'kon")})</span>
        </div>
      )}

      {/* Cards */}
      <div className="space-y-3">
        {isLoading?Array.from({length:4}).map((_,i)=><div key={i} className="h-24 bg-surface-light animate-pulse rounded-xl"/>)
          :data?.data.length===0?<p className="text-center text-text-secondary py-12 text-sm">{t("Нет магазинов","Do'kon yo'q")}</p>
          :data?.data.map((s: any)=><ShopCard key={s.id} s={s} lang={lang} fmt={fmt} onClick={()=>navigate(`/shops/${s.id}`)}/>)}
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
