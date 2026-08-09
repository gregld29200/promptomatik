import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { AuthProvider } from "@/lib/auth/auth-context";
import { ProtectedRoute } from "@/lib/auth/protected-route";
import { useParams } from "react-router";
import { useLanguage } from "@/lib/i18n";
import { OnboardingProvider } from "@/lib/onboarding/onboarding-context";
import { OnboardingTour } from "@/components/onboarding/onboarding-tour";
import { LoginPage } from "@/pages/login";
import { RegisterPage } from "@/pages/register";
import { SignupPage } from "@/pages/signup";
import { ForgotPasswordPage } from "@/pages/forgot-password";
import { ResetPasswordPage } from "@/pages/reset-password";
import { DashboardPage } from "@/pages/dashboard";
import { NewPromptPage } from "@/pages/new-prompt";
import { PromptViewPage } from "@/pages/prompt-view";
import { AdminPage } from "@/pages/admin";
import { ProfilePage } from "@/pages/profile";
import { TemplatesPage } from "@/pages/templates";
import { TemplateDetailPage } from "@/pages/template-detail";
import { AudioStudioPage } from "@/pages/audio";
import { AudioLibraryPage } from "@/pages/audio-library";
import { TranscribePage } from "@/pages/transcribe";
import { TranscribeLibraryPage } from "@/pages/transcribe-library";
import { DocumentsPage } from "@/pages/documents";
import { HomePage } from "@/pages/home";

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
