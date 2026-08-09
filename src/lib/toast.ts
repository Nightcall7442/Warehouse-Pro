// Thin wrapper around sonner so we can swap implementations easily
import { toast } from "sonner";

export const notify = {
  success: (msg: string) => toast.success(msg),
  error:   (msg: string) => toast.error(msg),
  info:    (msg: string) => toast.info(msg),
  loading: (msg: string) => toast.loading(msg),
  dismiss: (id?: string | number) => toast.dismiss(id),
};
