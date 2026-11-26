import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/context";
import { ErrorNotice } from "../components/ui";

function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={from} replace />;

  const isLogin = mode === "login";
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isLogin && password.length < 8) {
      setError(new Error("Use at least 8 characters for your password."));
      return;
    }
    setBusy(true);
    try {
      const u = await (isLogin ? login : register)(email.trim(), password);
      navigate(u.role === "admin" && from === "/" ? "/admin" : from, {
        replace: true,
      });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page-auth">
      <form className="auth-card" onSubmit={submit} noValidate>
        <h1>{isLogin ? "Welcome back" : "Create your library card"}</h1>
        <p className="muted">
          {isLogin
            ? "Sign in to download books."
            : "A free account lets you download the EPUB of any book."}
        </p>
        <label className="field">
          <span>Email</span>
          <input
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            className="input"
            type="password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={isLogin ? undefined : 8}
            required
          />
          {!isLogin && <small className="muted">At least 8 characters.</small>}
        </label>
        {error !== null && <ErrorNotice error={error} />}
        <button
          type="submit"
          className="btn btn-block"
          disabled={busy || !email || !password}
        >
          {busy ? "Please wait…" : isLogin ? "Sign in" : "Create account"}
        </button>
        <p className="muted small center">
          {isLogin ? (
            <>
              New here?{" "}
              <Link to="/register" state={location.state}>
                Create an account
              </Link>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Link to="/login" state={location.state}>
                Sign in
              </Link>
            </>
          )}
        </p>
      </form>
    </div>
  );
}

export const Login = () => <AuthForm mode="login" />;
export const Register = () => <AuthForm mode="register" />;
