import { trpc, tko_workspaceHeaders } from "@/lib/trpc";
import { COOKIE_NAME, UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { startLogin } from "./const";
import "./index.css";

const tko_queryClient = new QueryClient();

const tko_redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const tko_isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!tko_isUnauthorized) return;

  startLogin();
};

tko_queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const tko_error = event.query.state.error;
    tko_redirectToLoginIfUnauthorized(tko_error);
    console.error("[API Query Error]", tko_error);
  }
});

tko_queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const tko_error = event.mutation.state.error;
    tko_redirectToLoginIfUnauthorized(tko_error);
    console.error("[API Mutation Error]", tko_error);
  }
});

const tko_trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      headers() {
        // Preview auto-login fallback: when the browser blocks iframe cookies
        // (Safari ITP / private browsing / WebView), the runtime mirrors the
        // session into sessionStorage so we can forward it as a Bearer token.
        // The regular OAuth cookie flow keeps working and takes priority server-side.
        try {
          const tko_raw = sessionStorage.getItem("manus-cookie");
          if (tko_raw) {
            const tko_prefix = `${COOKIE_NAME}=`;
            const tko_pair = tko_raw.split(";").find(s => s.trim().startsWith(tko_prefix));
            const tko_token = tko_pair?.trim().slice(tko_prefix.length);
            if (tko_token) {
              return { Authorization: `Bearer ${tko_token}`, ...tko_workspaceHeaders() };
            }
          }
        } catch {
          // sessionStorage unavailable
        }
        return { ...tko_workspaceHeaders() };
      },
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={tko_trpcClient} queryClient={tko_queryClient}>
    <QueryClientProvider client={tko_queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
