import { useRef } from "react";
import { Package, Camera, Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";

export interface ProductPhotoProps {
  productId: number;
  photoUrl?: string | null;
  size?: "sm" | "md" | "lg";
}

export function ProductPhoto({ productId, photoUrl, size = "md" }: ProductPhotoProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const upload = trpc.product.uploadPhoto.useMutation({
    onSuccess: () => { utils.product.list.invalidate(); utils.product.getById.invalidate({ id: productId }); notify.success("Фото обновлено"); },
    onError: (e) => notify.error(e.message),
  });
  const dim = size === "sm" ? "w-12 h-12" : size === "lg" ? "w-20 h-20" : "w-16 h-16";
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
        style={{ background: "rgba(75,108,246,.08)" }}
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
