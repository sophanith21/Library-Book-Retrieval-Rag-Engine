import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, setUnauthorizedHandler, tokenStore } from "../api/client";
import type { AuthResponse, AuthUser } from "../api/types";
import { AuthContext, type AuthState } from "./context";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(() => tokenStore.get() !== null);
  const queryClient = useQueryClient();

  const logout = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
    queryClient.removeQueries({ queryKey: ["indexStats"] });
    queryClient.removeQueries({ queryKey: ["indexStatuses"] });
  }, [queryClient]);

  useEffect(() => {
    setUnauthorizedHandler(logout);
  }, [logout]);

  // Restore the session from a stored token.
  useEffect(() => {
    if (!tokenStore.get()) return;
    let cancelled = false;
    api<AuthUser>("/auth/me")
      .then((me) => !cancelled && setUser(me))
      .catch(() => !cancelled && tokenStore.set(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const accept = useCallback((res: AuthResponse) => {
    tokenStore.set(res.accessToken);
    setUser(res.user);
    return res.user;
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      login: (email, password) =>
        api<AuthResponse>("/auth/login", { body: { email, password } }).then(
          accept,
        ),
      register: (email, password) =>
        api<AuthResponse>("/auth/register", { body: { email, password } }).then(
          accept,
        ),
      logout,
    }),
    [user, loading, accept, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
