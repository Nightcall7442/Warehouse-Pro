import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShoppingCart, Plus, Minus, Trash2, Search } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useTranslate } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";

interface CartItem {
  productId: number;
  name: string;
  code: string;
  unitPrice: number;
  quantity: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedShopId?: number;
  onCreated?: () => void;
}

export function QuickOrderModal({ open, onOpenChange, preselectedShopId, onCreated }: Props) {
  const t = useTranslate();
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const [step, setStep] = useState(1);
  const [shopId, setShopId] = useState<number | undefined>(preselectedShopId);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "transfer" | "debt">("cash");
  const [productSearch, setProductSearch] = useState("");
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);

  const { data: shopsData } = trpc.shop.list.useQuery({ pageSize: 500 });
  const { data: productsData } = trpc.product.listAll.useQuery({ search: productSearch || undefined });
  const createOrder = trpc.order.create.useMutation({
    onSuccess: () => {
      notify.success(t("Заказ создан", "Buyurtma yaratildi"));
      utils.order.list.invalidate();
      onCreated?.();
      onOpenChange(false);
      resetForm();
    },
    onError: (e) => notify.error(e.message),
  });

  const resetForm = () => {
    setStep(1);
    setShopId(preselectedShopId);
    setCart([]);
    setNotes("");
    setDiscount("0");
    setPaymentMethod("cash");
    setProductSearch("");
  };

  const subtotal = useMemo(() => cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0), [cart]);
  const discountAmount = subtotal * (Number(discount) / 100);
  const total = subtotal - discountAmount;

  const addToCart = (product: { id: number; name: string; code: string; unitPrice: string }) => {
    const existing = cart.find(c => c.productId === product.id);
    if (existing) {
      setCart(cart.map(c => c.productId === product.id ? { ...c, quantity: c.quantity + 1 } : c));
    } else {
      setCart([...cart, { productId: product.id, name: product.name, code: product.code, unitPrice: Number(product.unitPrice), quantity: 1 }]);
    }
  };

  const updateQty = (productId: number, qty: number) => {
    if (qty <= 0) { setCart(cart.filter(c => c.productId !== productId)); return; }
    setCart(cart.map(c => c.productId === productId ? { ...c, quantity: qty } : c));
  };

  const handleSubmit = () => {
    if (!shopId || cart.length === 0) return;
    createOrder.mutate({
      shopId,
      items: cart.map(c => ({ productId: c.productId, quantity: c.quantity })),
      notes: notes || undefined,
      discount,
      paymentMethod,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            {t("Новый заказ", "Yangi buyurtma")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          {/* Step 1: Shop + Products */}
          {step === 1 && (
            <div className="flex gap-4 h-full">
              <div className="flex-1 flex flex-col">
                <Label className="font-label text-xs mb-1">{t("Магазин", "Do'kon")}</Label>
                <Select value={shopId ? String(shopId) : undefined} onValueChange={v => setShopId(Number(v))}>
                  <SelectTrigger className="mb-3"><SelectValue placeholder={t("Выберите магазин", "Do'kon tanlang")} /></SelectTrigger>
                  <SelectContent>
                    {shopsData?.data?.map(s => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="relative mb-2">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder={t("Поиск товаров...", "Tovar qidirish...")}
                    value={productSearch}
                    onChange={e => setProductSearch(e.target.value)}
                    className="pl-7 h-8 text-xs"
                  />
                </div>

                <ScrollArea className="flex-1 border rounded-lg" style={{ maxHeight: 280 }}>
                  <div className="p-2 space-y-1">
                    {productsData?.map((p) => (
                      <div key={p.id} className="flex items-center justify-between p-2 rounded hover:bg-muted/50 cursor-pointer" onClick={() => addToCart(p)}>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{p.name}</div>
                          <div className="text-xs text-muted-foreground">{p.code} · {Number(p.unitPrice).toLocaleString("ru")} сум</div>
                        </div>
                        <Button variant="ghost" size="icon-sm"><Plus className="h-3.5 w-3.5" /></Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              {/* Cart */}
              <div className="w-64 flex flex-col border rounded-lg">
                <div className="px-3 py-2 border-b text-xs font-label">{t("Корзина", "Savat")} ({cart.length})</div>
                <ScrollArea className="flex-1" style={{ maxHeight: 240 }}>
                  <div className="p-2 space-y-1">
                    {cart.map(item => (
                      <div key={item.productId} className="flex items-center gap-2 py-1.5">
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">{item.name}</div>
                          <div className="text-[10px] text-muted-foreground">{item.unitPrice.toLocaleString("ru")} × {item.quantity}</div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon-sm" className="h-5 w-5" onClick={() => updateQty(item.productId, item.quantity - 1)}><Minus className="h-2.5 w-2.5" /></Button>
                          <span className="text-xs font-data w-5 text-center">{item.quantity}</span>
                          <Button variant="ghost" size="icon-sm" className="h-5 w-5" onClick={() => updateQty(item.productId, item.quantity + 1)}><Plus className="h-2.5 w-2.5" /></Button>
                        </div>
                        <Button variant="ghost" size="icon-sm" className="h-5 w-5 text-destructive" onClick={() => updateQty(item.productId, 0)}><Trash2 className="h-2.5 w-2.5" /></Button>
                      </div>
                    ))}
                    {cart.length === 0 && <div className="text-xs text-muted-foreground text-center py-6">{t("Пусто", "Bo'sh")}</div>}
                  </div>
                </ScrollArea>
                <div className="border-t p-2 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">{t("Итого", "Jami")}:</span><span className="font-data font-bold">{total.toLocaleString("ru")} сум</span></div>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Review */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="text-sm">
                <b>{t("Магазин", "Do'kon")}:</b> {shopsData?.data?.find(s => s.id === shopId)?.name}
              </div>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50"><tr><th className="p-2 text-left">{t("Товар", "Tovar")}</th><th className="p-2 text-right">{t("Кол-во", "Miqdor")}</th><th className="p-2 text-right">{t("Сумма", "Summa")}</th></tr></thead>
                  <tbody>{cart.map(i => <tr key={i.productId} className="border-t"><td className="p-2">{i.name}</td><td className="p-2 text-right">{i.quantity}</td><td className="p-2 text-right font-data">{(i.unitPrice * i.quantity).toLocaleString("ru")}</td></tr>)}</tbody>
                </table>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs">{t("Скидка (%)", "Chegirma (%)")}</Label>
                  <Input type="number" min="0" max="100" value={discount} onChange={e => setDiscount(e.target.value)} className="h-8 text-xs" />
                </div>
                <div>
                  <Label className="text-xs">{t("Оплата", "To'lov")}</Label>
                  <Select value={paymentMethod} onValueChange={v => setPaymentMethod(v as typeof paymentMethod)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">{t("Наличные", "Naqd")}</SelectItem>
                      <SelectItem value="card">{t("Карта", "Karta")}</SelectItem>
                      <SelectItem value="transfer">{t("Перевод", "O'tkazma")}</SelectItem>
                      <SelectItem value="debt">{t("В долг", "Qarzga")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">{t("Примечание", "Izoh")}</Label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} className="h-16 text-xs" />
              </div>
              <Separator />
              <div className="flex justify-end gap-4 text-sm">
                <span className="text-muted-foreground">{t("Итого", "Jami")}:</span>
                <span className="font-data font-bold text-lg">{total.toLocaleString("ru")} сум</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {step === 2 && <Button variant="outline" onClick={() => setStep(1)}>{t("Назад", "Orqaga")}</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("Отмена", "Bekor")}</Button>
          {step === 1 ? (
            <Button onClick={() => setStep(2)} disabled={!shopId || cart.length === 0}>
              {t("Далее", "Keyingi")}
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={createOrder.isPending}>
              {createOrder.isPending ? t("Создание...", "Yaratilmoqda...") : t("Создать заказ", "Buyurtma yaratish")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
