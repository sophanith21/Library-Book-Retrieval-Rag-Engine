import { createContext, useContext } from "react";
import type { AuthUser } from "../api/types";

export interface AuthState {
  user: AuthUser | null;
  /** True until the stored token has been checked on page load */
  loading: boolean;
  login(email: string, password: string): Promise<AuthUser>;
  register(email: string, password: string): Promise<AuthUser>;
  logout(): void;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
