import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { AuthProvider } from "@/lib/auth/auth-context";
import { ProtectedRoute } from "@/lib/auth/protected-route";
import { useLanguage } from "@/lib/i18n";
import { OnboardingProvider } from "@/lib/onboarding/onboarding-context";
import { OnboardingTour } from "@/components/onboarding/onboarding-tour";
import { LoginPage } from "@/pages/login";
import { RegisterPage } from "@/pages/register";
import { ForgotPasswordPage } from "@/pages/forgot-password";
import { ResetPasswordPage } from "@/pages/reset-password";
import { DashboardPage } from "@/pages/dashboard";
import { NewPromptPage } from "@/pages/new-prompt";
import { PromptViewPage } from "@/pages/prompt-view";
import { AdminPage } from "@/pages/admin";
import { ProfilePage } from "@/pages/profile";
import { TemplatesPage } from "@/pages/templates";
import { TemplateDetailPage } from "@/pages/template-detail";

export function App() {
  // Subscribe to language changes — forces entire route tree to re-render
  useLanguage();

  return (
    <BrowserRouter>
      <AuthProvider>
        <OnboardingProvider>
          <OnboardingTour />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
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
            <Route
              path="/templates"
              element={
                <ProtectedRoute>
                  <TemplatesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/templates/:id"
              element={
                <ProtectedRoute>
                  <TemplateDetailPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <ProfilePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute>
                  <AdminPage />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </OnboardingProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
