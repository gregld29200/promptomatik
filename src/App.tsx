import { BrowserRouter, Routes, Route } from "react-router";
import { LoginPage } from "@/pages/login";
import { DashboardPage } from "@/pages/dashboard";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
      </Routes>
    </BrowserRouter>
  );
}
