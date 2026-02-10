import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { AuthProvider } from "@/lib/auth/auth-context";
import { ProtectedRoute } from "@/lib/auth/protected-route";
import { LoginPage } from "@/pages/login";
import { DashboardPage } from "@/pages/dashboard";
import { NewPromptPage } from "@/pages/new-prompt";
import { PromptViewPage } from "@/pages/prompt-view";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/new"
            element={
              <ProtectedRoute>
                <NewPromptPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/prompt/:id"
            element={
              <ProtectedRoute>
                <PromptViewPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
