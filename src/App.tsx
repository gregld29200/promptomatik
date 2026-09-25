import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { AuthProvider } from "@/lib/auth/auth-context";
import { ProtectedRoute } from "@/lib/auth/protected-route";
import { useParams } from "react-router";
import { t, useLanguage } from "@/lib/i18n";
import { OnboardingProvider } from "@/lib/onboarding/onboarding-context";
import { OnboardingTour } from "@/components/onboarding/onboarding-tour";
import { HomePage } from "@/pages/home";

// Every page but the hub loads on demand, so the first paint only ships the
// shell and /home instead of the whole studio.
const LoginPage = lazy(() => import("@/pages/login").then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import("@/pages/register").then((m) => ({ default: m.RegisterPage })));
const SignupPage = lazy(() => import("@/pages/signup").then((m) => ({ default: m.SignupPage })));
const ForgotPasswordPage = lazy(() => import("@/pages/forgot-password").then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import("@/pages/reset-password").then((m) => ({ default: m.ResetPasswordPage })));
const DashboardPage = lazy(() => import("@/pages/dashboard").then((m) => ({ default: m.DashboardPage })));
const NewPromptPage = lazy(() => import("@/pages/new-prompt").then((m) => ({ default: m.NewPromptPage })));
const PromptViewPage = lazy(() => import("@/pages/prompt-view").then((m) => ({ default: m.PromptViewPage })));
const AdminPage = lazy(() => import("@/pages/admin").then((m) => ({ default: m.AdminPage })));
const ProfilePage = lazy(() => import("@/pages/profile").then((m) => ({ default: m.ProfilePage })));
const TemplatesPage = lazy(() => import("@/pages/templates").then((m) => ({ default: m.TemplatesPage })));
const TemplateDetailPage = lazy(() => import("@/pages/template-detail").then((m) => ({ default: m.TemplateDetailPage })));
const AudioStudioPage = lazy(() => import("@/pages/audio").then((m) => ({ default: m.AudioStudioPage })));
const AudioLibraryPage = lazy(() => import("@/pages/audio-library").then((m) => ({ default: m.AudioLibraryPage })));
const TranscribePage = lazy(() => import("@/pages/transcribe").then((m) => ({ default: m.TranscribePage })));
const TranscribeLibraryPage = lazy(() => import("@/pages/transcribe-library").then((m) => ({ default: m.TranscribeLibraryPage })));
const DocumentsPage = lazy(() => import("@/pages/documents").then((m) => ({ default: m.DocumentsPage })));

export function App() {
  // Subscribe to language changes — forces entire route tree to re-render
  useLanguage();

  return (
    <BrowserRouter>
      <AuthProvider>
        <OnboardingProvider>
          <OnboardingTour />
          <Suspense
            fallback={
              <main role="status" style={{ padding: "2rem", minHeight: "100vh" }}>
                {t("common.loading")}
              </main>
            }
          >
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route
              path="/home"
              element={
                <ProtectedRoute>
                  <HomePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/prompts"
              element={
                <ProtectedRoute>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/prompts/new"
              element={
                <ProtectedRoute>
                  <NewPromptPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/prompts/:id"
              element={
                <ProtectedRoute>
                  <PromptViewPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/prompts/templates"
              element={
                <ProtectedRoute>
                  <TemplatesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/prompts/templates/:id"
              element={
                <ProtectedRoute>
                  <TemplateDetailPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/audio"
              element={
                <ProtectedRoute>
                  <AudioStudioPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/audio/library"
              element={
                <ProtectedRoute>
                  <AudioLibraryPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/transcribe"
              element={
                <ProtectedRoute>
                  <TranscribePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/transcribe/library"
              element={
                <ProtectedRoute>
                  <TranscribeLibraryPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/documents"
              element={
                <ProtectedRoute>
                  <DocumentsPage />
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
            {/* Legacy paths (pre TeachInspire Studio) redirect to the new tree. */}
            <Route path="/dashboard" element={<Navigate to="/prompts" replace />} />
            <Route path="/new" element={<Navigate to="/prompts/new" replace />} />
            <Route path="/prompt/:id" element={<LegacyPromptRedirect />} />
            <Route path="/templates" element={<Navigate to="/prompts/templates" replace />} />
            <Route path="/templates/:id" element={<LegacyTemplateRedirect />} />
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Routes>
          </Suspense>
        </OnboardingProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

function LegacyPromptRedirect() {
  const { id } = useParams();
  return <Navigate to={`/prompts/${id}`} replace />;
}

function LegacyTemplateRedirect() {
  const { id } = useParams();
  return <Navigate to={`/prompts/templates/${id}`} replace />;
}
