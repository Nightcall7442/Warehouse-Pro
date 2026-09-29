import { Suspense } from "react";
import { lazyWithRecovery } from "@/lib/stale-app-recovery";
import { closeQuickOrder, useQuickOrderSession } from "@/lib/quick-order";

/*
  Окно подгружается по первому открытию: хозяин стоит в корне приложения, и
  статический импорт положил бы окно со всеми его зависимостями в стартовый
  файл каждой роли — курьеру и агенту оно не нужно вовсе.
*/
const QuickOrderModal = lazyWithRecovery(() => import("./QuickOrderModal").then(m => ({ default: m.QuickOrderModal })));

/**
 * Единственное окно быстрого заказа вне страницы «Заказы» (lib/quick-order.ts).
 *
 * Рисуется только открытым: окно на монтировании спрашивает каталог, и
 * закрытое, но смонтированное, дёргало бы сервер на каждой странице. Ключ —
 * номер открытия: повтор другого заказа начинается с его строк, а не с
 * корзины прошлого окна.
 */
export function QuickOrderHost() {
  const session = useQuickOrderSession();
  if (!session) return null;
  return (
    <Suspense fallback={null}>
      <QuickOrderModal
        key={session.key}
        open
        onOpenChange={open => { if (!open) closeQuickOrder(); }}
        start={session}
      />
    </Suspense>
  );
}
