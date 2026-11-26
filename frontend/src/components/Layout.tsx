import { useState, type FormEvent } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { useAuth } from "../auth/context";

function HeaderSearch() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const current =
    location.pathname === "/search" ? (params.get("q") ?? "") : "";
  const [q, setQ] = useState(current);
  // Follow the URL when it changes (back/forward, links), keep typing otherwise.
  const [shown, setShown] = useState(current);
  if (shown !== current) {
    setShown(current);
    setQ(current);
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    const mode = params.get("mode");
    navigate(
      `/search?q=${encodeURIComponent(query)}${mode ? `&mode=${mode}` : ""}`,
    );
  };

  return (
    <form className="header-search" role="search" onSubmit={submit}>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search inside every book…"
        aria-label="Search the library"
      />
    </form>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="app">
      <header className="site-header">
        <div className="site-header-inner">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              ❦
            </span>
            Libre
          </Link>
          <HeaderSearch />
          <nav className="site-nav">
            <NavLink to="/" end>
              Browse
            </NavLink>
            {user?.role === "admin" && <NavLink to="/admin">Admin</NavLink>}
            {user ? (
              <>
                <span className="user-email" title={user.email}>
                  {user.email}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={() => {
                    logout();
                    navigate("/");
                  }}
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login">Sign in</NavLink>
                <Link to="/register" className="btn btn-small">
                  Join
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="site-main">
        <Outlet />
      </main>
      <footer className="site-footer">
        Libre · public-domain books, searchable by keyword and meaning
      </footer>
    </div>
  );
}
