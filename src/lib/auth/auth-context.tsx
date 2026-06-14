import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import * as api from "@/lib/api";
import type { Quota, User } from "@/lib/api";
import { setLanguage, type Language } from "@/lib/i18n";

interface AuthState {
  user: User | null;
  loading: boolean;
  /** True for participants and admins — admins bypass tier gates. */
  isParticipant: boolean;
  /** Daily generation quota — null for participants/admins (unlimited). */
  quota: Quota | null;
  login: (email: string, password: string) => Promise<api.ApiError | null>;
  register: (token: string, name: string, password: string) => Promise<api.ApiError | null>;
  updateLanguagePreference: (language: Language) => Promise<api.ApiError | null>;
  /** Re-fetch /me — used to refresh the quota counter after a generation. */
  refreshMe: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [loading, setLoading] = useState(true);

  // Check session on mount
  useEffect(() => {
    api.me().then((result) => {
      if (result.data) {
        setUser(result.data.user);
        setQuota(result.data.quota);
        setLanguage(result.data.user.languagePreference);
      }
      setLoading(false);
    });
  }, []);

  const refreshMe = useCallback(async () => {
    const result = await api.me();
    if (result.data) {
      setUser(result.data.user);
      setQuota(result.data.quota);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password);
    if (result.error) return result.error;
    setUser(result.data.user);
    setLanguage(result.data.user.languagePreference);
    void refreshMe(); // login response has no quota — fetch it
    return null;
  }, [refreshMe]);

  const register = useCallback(async (token: string, name: string, password: string) => {
    const result = await api.register(token, name, password);
    if (result.error) return result.error;
    setUser(result.data.user);
    setLanguage(result.data.user.languagePreference);
    void refreshMe();
    return null;
  }, [refreshMe]);

  const updateLanguagePreference = useCallback(async (language: Language) => {
    const result = await api.updateLanguagePreference(language);
    if (result.error) return result.error;
    setUser(result.data.user);
    setLanguage(result.data.user.languagePreference);
    return null;
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
    setQuota(null);
  }, []);

  const isParticipant = user !== null && (user.tier === "participant" || user.role === "admin");

  return (
    <AuthContext.Provider
      value={{ user, loading, isParticipant, quota, login, register, updateLanguagePreference, refreshMe, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
