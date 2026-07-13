import { useState } from "react";
import { useParams, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { UserPlus, Loader2, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { useTranslate } from "@/i18n";

export default function AcceptInvite() {
  const tr = useTranslate();
  const { token }    = useParams<{ token: string }>();
  const navigate     = useNavigate();
  const [name, setName]     = useState("");
  const [pw,   setPw]       = useState("");
  const [showPw, setShowPw] = useState(false);
  const [done, setDone]     = useState(false);

  const { data: invite, isLoading, error } = trpc.invite.verify.useQuery(
    { token: token! }, { enabled: !!token }
  );

  const accept = trpc.invite.accept.useMutation({
    onSuccess: () => setDone(true),
    onError:   (e) => notify.error(e.message),
  });

  if (isLoading) return (
    <div className="min-h-screen bg-canvas flex items-center justify-center">
      <Loader2 size={32} className="text-primary animate-spin"/>
    </div>
  );

  if (error || !invite) return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center px-4">
      <div className="neo-card w-full max-w-sm p-8 text-center space-y-4">
        <h1 className="font-display text-xl font-bold text-text-primary">{tr("Ссылка недействительна","Havola yaroqsiz")}</h1>
        <p className="text-text-secondary text-sm">
          {tr("Приглашение истекло или уже было принято. Попросите администратора отправить новое.","Taklif muddati tugagan yoki allaqachon qabul qilingan. Administratordan yangisini so'rang.")}
        </p>
        <button onClick={() => navigate("/login")} className="neo-btn w-full">
          {tr("Войти в аккаунт","Hisobga kirish")}
        </button>
      </div>
    </div>
  );

  if (done) return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center px-4">
      <div className="neo-card w-full max-w-sm p-8 text-center space-y-4">
        <div className="w-14 h-14 rounded-full bg-success/15 flex items-center justify-center mx-auto">
          <CheckCircle2 size={28} className="text-success"/>
        </div>
        <h1 className="font-display text-xl font-bold text-text-primary">{tr("Добро пожаловать!","Xush kelibsiz!")}</h1>
        <p className="text-text-secondary text-sm">
          {tr("Аккаунт создан. Войдите в систему.","Hisob yaratildi. Tizimga kiring.")}
        </p>
        <button onClick={() => navigate("/login")} className="neo-btn-primary w-full">
          {tr("Войти","Kirish")}
        </button>
      </div>
    </div>
  );

  const ROLE_LABELS: Record<string, string> = {
    operator: tr("Оператор","Operator"), agent: tr("Агент","Agent"),
    supervisor: tr("Супервайзер","Nazoratchi"), merchandiser: tr("Мерчандайзер","Merchandayzer"),
  };

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center px-4">
      <div className="text-center mb-8">
        <span className="font-label text-primary tracking-[0.15em] text-sm">WAREHOUSE PRO</span>
      </div>
      <div className="neo-card w-full max-w-[400px] p-8 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center">
            <UserPlus size={18} className="text-primary"/>
          </div>
          <div>
            <h1 className="font-display text-lg font-bold text-text-primary">{tr("Принять приглашение","Taklifni qabul qilish")}</h1>
            <p className="text-xs text-text-secondary">{invite.orgName} · {ROLE_LABELS[invite.role] ?? invite.role}</p>
          </div>
        </div>

        <div>
          <label className="font-label text-text-secondary text-[10px] tracking-wider block mb-1">EMAIL</label>
          <input className="neo-input w-full opacity-60 cursor-not-allowed" value={invite.email} disabled/>
        </div>

        <div>
          <label className="font-label text-text-secondary text-[10px] tracking-wider block mb-1">{tr("ВАШЕ ИМЯ","ISMINGIZ")} *</label>
          <input className="neo-input w-full" placeholder={tr("Имя Фамилия","Ism Familiya")}
            value={name} onChange={e => setName(e.target.value)} autoFocus/>
        </div>

        <div>
          <label className="font-label text-text-secondary text-[10px] tracking-wider block mb-1">{tr("ПРИДУМАЙТЕ ПАРОЛЬ","PAROL O'YLAB TOPING")} *</label>
          <div className="relative">
            <input type={showPw ? "text" : "password"} className="neo-input w-full pr-10"
              placeholder={tr("Минимум 8 символов","Kamida 8 belgi")}
              value={pw} onChange={e => setPw(e.target.value)}/>
            <button type="button" onClick={() => setShowPw(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary">
              {showPw ? <EyeOff size={16}/> : <Eye size={16}/>}
            </button>
          </div>
        </div>

        <button
          onClick={() => {
            if (!name.trim()) return notify.error(tr("Введите имя","Ismni kiriting"));
            if (pw.length < 8)  return notify.error(tr("Пароль должен быть не менее 8 символов","Parol kamida 8 belgidan iborat bo'lishi kerak"));
            accept.mutate({ token: token!, name: name.trim(), password: pw });
          }}
          disabled={accept.isPending}
          className="neo-btn-primary w-full flex items-center justify-center gap-2 py-3"
        >
          {accept.isPending ? <Loader2 size={16} className="animate-spin"/> : <UserPlus size={16}/>}
          {tr("Создать аккаунт","Hisob yaratish")}
        </button>
      </div>
    </div>
  );
}
