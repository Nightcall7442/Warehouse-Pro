import { useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { notify } from "@/lib/toast";
import { canOperate } from "@/lib/permissions";
import { ShopForm } from "@/components/shops";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { ShopBrowser } from "./ShopBrowser";

/*
  «Магазины» руководства на телефоне — экран мобилки (app/(tabs)/shops.tsx)
  с полным списком точек: территории, поиск, ближайшие. Настольная страница с
  фильтрами, выгрузкой и отметками остаётся для большого экрана.

  Весь список одним запросом: группировка по территориям и «ближайшие»
  считаются на телефоне, как в мобилке. Архив — только на большом экране.
*/
export function OversightShops() {
  const navigate = useNavigate();
  const { lang } = useLang();
  const { user } = useAuth();
  const canEdit = canOperate(user?.role);
  const [adding, setAdding] = useState(false);
  const utils = trpc.useUtils();

  const { data, isLoading, isLoadingError, refetch } = trpc.shop.list.useQuery({ page: 1, pageSize: 5000 });
  const { data: agentList } = trpc.agent.listAgents.useQuery(undefined, { enabled: adding });
  const { data: territories } = trpc.territory.list.useQuery(undefined, { enabled: adding });
  const create = trpc.shop.create.useMutation({
    onSuccess: () => { utils.shop.list.invalidate(); utils.shop.cities.invalidate(); setAdding(false); notify.success(lang === "uz" ? "Do'kon qo'shildi" : "Магазин добавлен"); },
    onError: e => notify.error(e.message),
  });

  if (isLoadingError) return <QueryErrorFallback onRetry={refetch} />;

  return (
    <>
      <ShopBrowser
        shops={data?.data ?? []}
        loading={isLoading}
        onOpen={id => navigate(`/shops/${id}`)}
        onOrder={id => navigate(`/orders/new?shopId=${id}`)}
        onAdd={canEdit ? () => setAdding(true) : undefined}
      />
      {canEdit && adding && (
        <ShopForm isPending={create.isPending} lang={lang} agents={agentList ?? []} territories={territories ?? []} onSave={d => create.mutate(d)} onCancel={() => setAdding(false)} />
      )}
    </>
  );
}
