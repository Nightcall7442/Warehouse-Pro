import { trpc } from "@/providers/trpc";
import { recallBrand } from "@/lib/remembered-brand";

/**
 * Чья вывеска: арендатора или поставщика системы.
 *
 * Знак и название стояли литералами в шапке, в выдвижном меню, на входе, в
 * первом запуске организации и в предложении установить приложение. Арендатор
 * мог загрузить свой логотип — его не показывали нигде, кроме предпросмотра в
 * самих настройках, — и задать название приложения, которое доходило только до
 * заголовка вкладки.
 *
 * Правило простое: есть своё — показываем своё, нет — показываем наше. Спросить
 * можно только здесь, поэтому забыть подставить бренд на новом экране нельзя.
 *
 * Витрина самого продукта — лендинг и регистрация нового арендатора — вывеску
 * отсюда НЕ берёт и не должна: там продаёт себя поставщик.
 */
export const PRODUCT_NAME = "Warehouse Pro";

export function useAppBrand(signedIn = true) {
  const { data } = trpc.branding.get.useQuery(undefined, { enabled: signedIn });
  // До входа сервер не знает, чей бренд показывать: экран входа один на всех,
  // и тенант выбирается уже после пароля. Остаётся память устройства.
  const remembered = signedIn ? null : recallBrand();

  const logoUrl = (data?.logoUrl ?? remembered?.logoUrl ?? "") || null;
  const name = (data?.appName ?? remembered?.appName ?? "").trim() || PRODUCT_NAME;

  return { logoUrl, name, isTenantOwn: Boolean(logoUrl) || name !== PRODUCT_NAME };
}
