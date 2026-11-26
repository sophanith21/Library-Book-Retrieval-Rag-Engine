import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, Link, RouterProvider } from "react-router-dom";
import { ApiError } from "./api/client";
import { AuthProvider } from "./auth/AuthContext";
import { RequireAdmin } from "./components/guards";
import { Layout } from "./components/Layout";
import { EmptyState } from "./components/ui";
import { AdminBooks } from "./pages/admin/AdminBooks";
import { AdminLayout } from "./pages/admin/AdminLayout";
import { BookEdit } from "./pages/admin/BookEdit";
import { Dashboard } from "./pages/admin/Dashboard";
import { Upload } from "./pages/admin/Upload";
import { Login, Register } from "./pages/AuthPages";
import { BookDetail } from "./pages/BookDetail";
import { Home } from "./pages/Home";
import { Search } from "./pages/Search";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Don't retry client errors (404, 401…); retry network/server errors once.
      retry: (count, err) =>
        !(err instanceof ApiError && err.status >= 400 && err.status < 500) &&
        count < 1,
    },
  },
});

function NotFound() {
  return (
    <div className="page">
      <EmptyState title="Page not found">
        <Link to="/">Back to the catalogue</Link>
      </EmptyState>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: (
      <AuthProvider>
        <Layout />
      </AuthProvider>
    ),
    children: [
      { path: "/", element: <Home /> },
      { path: "/search", element: <Search /> },
      { path: "/books/:id", element: <BookDetail /> },
      { path: "/login", element: <Login /> },
      { path: "/register", element: <Register /> },
      {
        path: "/admin",
        element: (
          <RequireAdmin>
            <AdminLayout />
          </RequireAdmin>
        ),
        children: [
          { index: true, element: <Dashboard /> },
          { path: "books", element: <AdminBooks /> },
          { path: "books/:id", element: <BookEdit /> },
          { path: "upload", element: <Upload /> },
        ],
      },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
