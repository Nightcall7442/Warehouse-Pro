import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";

const ROLE_HOME: Record<string, string> = {
  superadmin:   "/super-admin",
  ceo:          "/dashboard",
  // Тот же класс ошибки, что был у курьера ниже, только operator стоял здесь
  // с самого начала, а не проваливался сюда через fallback.
  //
  // Все четыре запроса /dashboard (dashboard.kpis, .trends, .statusBreakdown,
  // .activity) заведены на supervisorQuery — это ["ceo", "supervisor"],
  // operator в списке нет. У страницы единственная развилка на isError:
  // `if (isError) return <QueryErrorFallback onRetry={refetch} />`, retry
  // повторяет тот же запрос и получает тот же отказ по роли. Итог: каждый
  // operator видел экран «не получилось загрузить, повторить» как самый
  // первый экран после входа, и повтор ничего не менял — заявка отклонена
  // не сбоем, а правами.
  //
  // /orders — тот раздел, на который у operator действительно есть доступ
  // (fieldSalesQuery, operatorQuery для сводки по агентам) и который у него
  // же идёт вторым пунктом в нижней навигации, сразу после общего «Главная».
  operator:     "/orders",
  supervisor:   "/supervisor",
  agent:        "/agent",
  merchandiser: "/agent",
  // Курьера здесь не было, и он проваливался в общий fallback на /dashboard —
  // экран директора с выручкой и долгами, у которого нет RoleGuard. Его
  // рабочий раздел — список доставок.
  courier:      "/deliveries",
};

export default function Home() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoading || !user) return;
    const dest = ROLE_HOME[user.role] ?? "/dashboard";
    navigate(dest, { replace: true });
  }, [user, isLoading, navigate]);

  return null;
}
