import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { trpc, trpcClient, queryClient } from "./trpc.client";

// eslint-disable-next-line react-refresh/only-export-components
export { trpc, queryClient };

export function TRPCProvider({ children }: { children: ReactNode }) {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
