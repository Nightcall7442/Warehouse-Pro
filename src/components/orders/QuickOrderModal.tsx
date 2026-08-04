import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShoppingCart, Plus, Minus, Trash2, Search } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useTranslate } from "@/i18n";
import { F, COLORS, PillButton } from "./theme";

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

/** Small icon-only round button used for cart quantity steppers. */
function IconButton({ onClick, danger, children, size = 22 }: { onClick: () => void; danger?: boolean; children: React.ReactNode; size?: number }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: `${size}px`, height: `${size}px`, borderRadius: "7px", border: "none",
        background: "transparent", color: danger ? COLORS.danger : COLORS.textSecondary, cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

export function QuickOrderModal({ open, onOpenChange, preselectedShopId, onCreated }: Props) {
  const t = useTranslate();
  const utils = trpc.useUtils();

  const [step, setStep] = useState(1);
  const [shopId, setShopId] = useState<number | undefined>(preselectedShopId);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "transfer" | "debt">("cash");
  const [productSearch, setProductSearch] = useState("");

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

  const labelStyle: React.CSSProperties = { fontFamily: F.body, fontSize: "11px", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: COLORS.textTertiary };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle style={{ display: "flex", alignItems: "center", gap: "8px", fontFamily: F.display, color: COLORS.textPrimary }}>
            <ShoppingCart size={18} />
            {t("Новый заказ", "Yangi buyurtma")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          {/* Step 1: Shop + Products */}
          {step === 1 && (
            <div style={{ display: "flex", gap: "16px", height: "100%" }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <Label style={{ ...labelStyle, marginBottom: "4px" }}>{t("Магазин", "Do'kon")}</Label>
                <Select value={shopId ? String(shopId) : undefined} onValueChange={v => setShopId(Number(v))}>
                  <SelectTrigger className="mb-3"><SelectValue placeholder={t("Выберите магазин", "Do'kon tanlang")} /></SelectTrigger>
                  <SelectContent>
                    {shopsData?.data?.map(s => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div style={{ position: "relative", marginBottom: "8px" }}>
                  <Search size={14} color={COLORS.textTertiary} style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)" }} />
                  <Input
                    placeholder={t("Поиск товаров...", "Tovar qidirish...")}
                    value={productSearch}
                    onChange={e => setProductSearch(e.target.value)}
                    className="h-8 text-xs"
                    style={{ paddingLeft: "28px" }}
                  />
                </div>

                <ScrollArea style={{ flex: 1, maxHeight: 280, borderRadius: "10px", border: `1px solid ${COLORS.border}` }}>
                  <div style={{ padding: "8px", display: "flex", flexDirection: "column", gap: "2px" }}>
                    {productsData?.map((p) => (
                      <div
                        key={p.id}
                        onClick={() => addToCart(p)}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px", borderRadius: "8px", cursor: "pointer" }}
                        onMouseEnter={e => { e.currentTarget.style.background = COLORS.surfaceLight; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontFamily: F.body, fontSize: "13px", fontWeight: 500, color: COLORS.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                          <div style={{ fontFamily: F.body, fontSize: "11px", color: COLORS.textTertiary }}>{p.code} · {Number(p.unitPrice).toLocaleString("ru")} сум</div>
                        </div>
                        <IconButton onClick={() => addToCart(p)}><Plus size={14} /></IconButton>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              {/* Cart */}
              <div style={{ width: "256px", display: "flex", flexDirection: "column", borderRadius: "10px", border: `1px solid ${COLORS.border}` }}>
                <div style={{ padding: "10px 12px", borderBottom: `1px solid ${COLORS.border}`, ...labelStyle }}>{t("Корзина", "Savat")} ({cart.length})</div>
                <ScrollArea style={{ flex: 1, maxHeight: 240 }}>
                  <div style={{ padding: "8px", display: "flex", flexDirection: "column", gap: "4px" }}>
                    {cart.map(item => (
                      <div key={item.productId} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 0" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: F.body, fontSize: "12px", fontWeight: 500, color: COLORS.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                          <div style={{ fontFamily: F.body, fontSize: "10px", color: COLORS.textTertiary }}>{item.unitPrice.toLocaleString("ru")} × {item.quantity}</div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                          <IconButton size={20} onClick={() => updateQty(item.productId, item.quantity - 1)}><Minus size={11} /></IconButton>
                          <span style={{ fontFamily: F.display, fontSize: "12px", width: "18px", textAlign: "center", color: COLORS.textPrimary }}>{item.quantity}</span>
                          <IconButton size={20} onClick={() => updateQty(item.productId, item.quantity + 1)}><Plus size={11} /></IconButton>
                        </div>
                        <IconButton size={20} danger onClick={() => updateQty(item.productId, 0)}><Trash2 size={11} /></IconButton>
                      </div>
                    ))}
                    {cart.length === 0 && <div style={{ fontFamily: F.body, fontSize: "12px", color: COLORS.textTertiary, textAlign: "center", padding: "24px 0" }}>{t("Пусто", "Bo'sh")}</div>}
                  </div>
                </ScrollArea>
                <div style={{ borderTop: `1px solid ${COLORS.border}`, padding: "10px 12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.body, fontSize: "12px" }}>
                    <span style={{ color: COLORS.textSecondary }}>{t("Итого", "Jami")}:</span>
                    <span style={{ fontFamily: F.display, fontWeight: 700, color: COLORS.textPrimary }}>{total.toLocaleString("ru")} сум</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Review */}
          {step === 2 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ fontFamily: F.body, fontSize: "13px", color: COLORS.textPrimary }}>
                <b>{t("Магазин", "Do'kon")}:</b> {shopsData?.data?.find(s => s.id === shopId)?.name}
              </div>
              <div style={{ borderRadius: "10px", overflow: "hidden", border: `1px solid ${COLORS.border}` }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: F.body, fontSize: "12px" }}>
                  <thead>
                    <tr style={{ background: COLORS.surfaceLight }}>
                      <th style={{ padding: "8px", textAlign: "left", color: COLORS.textTertiary, fontWeight: 600 }}>{t("Товар", "Tovar")}</th>
                      <th style={{ padding: "8px", textAlign: "right", color: COLORS.textTertiary, fontWeight: 600 }}>{t("Кол-во", "Miqdor")}</th>
                      <th style={{ padding: "8px", textAlign: "right", color: COLORS.textTertiary, fontWeight: 600 }}>{t("Сумма", "Summa")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map(i => (
                      <tr key={i.productId} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                        <td style={{ padding: "8px", color: COLORS.textPrimary }}>{i.name}</td>
                        <td style={{ padding: "8px", textAlign: "right", color: COLORS.textSecondary }}>{i.quantity}</td>
                        <td style={{ padding: "8px", textAlign: "right", fontFamily: F.display, fontWeight: 600, color: COLORS.textPrimary }}>{(i.unitPrice * i.quantity).toLocaleString("ru")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div>
                  <Label style={labelStyle}>{t("Скидка (%)", "Chegirma (%)")}</Label>
                  <Input type="number" min="0" max="100" value={discount} onChange={e => setDiscount(e.target.value)} className="h-8 text-xs" style={{ marginTop: "4px" }} />
                </div>
                <div>
                  <Label style={labelStyle}>{t("Оплата", "To'lov")}</Label>
                  <Select value={paymentMethod} onValueChange={v => setPaymentMethod(v as typeof paymentMethod)}>
                    <SelectTrigger className="h-8 text-xs" style={{ marginTop: "4px" }}><SelectValue /></SelectTrigger>
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
                <Label style={labelStyle}>{t("Примечание", "Izoh")}</Label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} className="h-16 text-xs" style={{ marginTop: "4px" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "baseline", gap: "10px", paddingTop: "8px", borderTop: `1px solid ${COLORS.border}` }}>
                <span style={{ fontFamily: F.body, fontSize: "13px", color: COLORS.textSecondary }}>{t("Итого", "Jami")}:</span>
                <span style={{ fontFamily: F.display, fontSize: "20px", fontWeight: 700, color: COLORS.textPrimary }}>{total.toLocaleString("ru")} сум</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <div style={{ display: "flex", gap: "8px", width: "100%", justifyContent: "flex-end" }}>
            {step === 2 && <PillButton tone="neutral" onClick={() => setStep(1)}>{t("Назад", "Orqaga")}</PillButton>}
            <PillButton tone="ghost" onClick={() => onOpenChange(false)}>{t("Отмена", "Bekor")}</PillButton>
            {step === 1 ? (
              <PillButton tone="primary" onClick={() => setStep(2)} disabled={!shopId || cart.length === 0}>
                {t("Далее", "Keyingi")}
              </PillButton>
            ) : (
              <PillButton tone="success" onClick={handleSubmit} disabled={createOrder.isPending}>
                {createOrder.isPending ? t("Создание...", "Yaratilmoqda...") : t("Создать заказ", "Buyurtma yaratish")}
              </PillButton>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
