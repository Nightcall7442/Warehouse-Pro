import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import { QueryClient } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";

export const trpc = createTRPCReact<AppRouter>();

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

const customFetch = (input: RequestInfo | URL, init?: RequestInit) =>
  globalThis.fetch(input, { ...init, credentials: "include" });

export const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition: (op) => op.type === "subscription",
      true: httpLink({ url: "/api/trpc", transformer: superjson, fetch: customFetch }),
      false: splitLink({
        condition: (op) => op.type === "mutation",
        true: httpLink({ url: "/api/trpc", transformer: superjson, fetch: customFetch }),
        false: httpBatchLink({ url: "/api/trpc", transformer: superjson, fetch: customFetch }),
      }),
    }),
  ],
});
