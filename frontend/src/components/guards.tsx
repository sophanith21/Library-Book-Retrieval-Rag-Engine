import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/context";
import { EmptyState, Spinner } from "./ui";

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Checking your session" />;
  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }
  if (user.role !== "admin") {
    return (
      <div className="page">
        <EmptyState title="Admins only">
          You're signed in as {user.email}, which doesn't have admin access.
        </EmptyState>
      </div>
    );
  }
  return children;
}
