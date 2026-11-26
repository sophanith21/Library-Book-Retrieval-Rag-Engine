import { NavLink, Outlet } from "react-router-dom";

export function AdminLayout() {
  return (
    <div className="page admin">
      <header className="admin-header">
        <h1>Admin</h1>
        <nav className="tabs" aria-label="Admin sections">
          <NavLink to="/admin" end>
            Overview
          </NavLink>
          <NavLink to="/admin/books">Books</NavLink>
          <NavLink to="/admin/upload">Upload</NavLink>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
