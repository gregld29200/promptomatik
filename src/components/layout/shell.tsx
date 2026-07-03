import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useLocation } from "react-router";
import { useAuth } from "@/lib/auth/auth-context";
import { SUPPORTED_LANGUAGES, t, useLanguage, type Language } from "@/lib/i18n";
import { Menu, X, Lock } from "lucide-react";
import s from "./shell.module.css";

interface ShellProps {
  children: ReactNode;
}

export function Shell({ children }: ShellProps) {
  const { user, isParticipant, logout, updateLanguagePreference } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [lang, setLang] = useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  function isActive(path: string) {
    return location.pathname === path || location.pathname.startsWith(path + "/");
  }

  // Close mobile menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  // Close mobile menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  async function handleLanguageChange(nextLang: Language) {
    if (nextLang === lang) return;

    const previousLang = lang;
    setLang(nextLang);

    if (!user) {
      return;
    }

    const error = await updateLanguagePreference(nextLang);
    if (error) {
      console.error("Failed to update language preference", error);
      setLang(previousLang);
    }
  }

  // Gated entries stay visible for free users with a lock badge —
  // hiding them kills feature discovery; showing them sells the upgrade.
  const lockBadge = !isParticipant && (
    <Lock size={11} className={s.navLock} aria-label={t("upgrade.nav_locked")} />
  );

  const navItems = (
    <>
      <li>
        <Link
          to="/prompts"
          className={`${s.navLink} ${
            isActive("/prompts") && !isActive("/prompts/new") && !isActive("/prompts/templates")
              ? s.navLinkActive
              : ""
          }`}
        >
          {t("dashboard.my_prompts")}
        </Link>
      </li>
      <li>
        <Link
          to="/prompts/new"
          className={`${s.navLink} ${isActive("/prompts/new") ? s.navLinkActive : ""}`}
        >
          {t("dashboard.new_prompt")}
        </Link>
      </li>
      <li>
        <Link
          to="/prompts/templates"
          className={`${s.navLink} ${isActive("/prompts/templates") ? s.navLinkActive : ""}`}
        >
          {t("dashboard.templates")}
          {lockBadge}
        </Link>
      </li>
      <li>
        <Link
          to="/audio"
          className={`${s.navLink} ${isActive("/audio") ? s.navLinkActive : ""}`}
        >
          {t("audio.nav_label")}
          {lockBadge}
        </Link>
      </li>
      <li>
        <Link
          to="/profile"
          className={`${s.navLink} ${isActive("/profile") ? s.navLinkActive : ""}`}
        >
          {t("profile.nav_label")}
          {lockBadge}
        </Link>
      </li>
      {user?.role === "admin" && (
        <li>
          <Link
            to="/admin"
            className={`${s.navLink} ${isActive("/admin") ? s.navLinkActive : ""}`}
          >
            {t("admin.nav_label")}
          </Link>
        </li>
      )}
    </>
  );

  const langToggle = (
    <div className={s.langToggle}>
      {SUPPORTED_LANGUAGES.map((option) => (
        <button
          key={option}
          type="button"
          className={`${s.langBtn} ${lang === option ? s.langBtnActive : ""}`}
          onClick={() => void handleLanguageChange(option)}
        >
          {t(`common.lang_${option}`)}
        </button>
      ))}
    </div>
  );

  return (
    <div className={s.shell}>
      <nav className={s.nav} ref={navRef}>
        <Link to="/" className={s.logo} aria-label="TeachInspire Studio">
          <img
            src="/logo.webp"
            alt="TeachInspire Studio"
            className={s.logoImg}
            decoding="async"
          />
        </Link>

        {/* Desktop nav */}
        <ul className={s.navLinks}>
          {navItems}
          <li>{langToggle}</li>
          <li>
            <button onClick={handleLogout} className={s.navLink} type="button">
              {t("auth.logout")}
            </button>
          </li>
        </ul>

        {/* Mobile hamburger */}
        <button
          type="button"
          className={s.hamburger}
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label={menuOpen ? t("common.close") : t("common.menu")}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>

        {/* Mobile dropdown */}
        {menuOpen && (
          <div className={s.mobileMenu}>
            <ul className={s.mobileNavLinks}>
              {navItems}
              <li>{langToggle}</li>
              <li>
                <button onClick={handleLogout} className={s.navLink} type="button">
                  {t("auth.logout")}
                </button>
              </li>
            </ul>
          </div>
        )}
      </nav>
      <main className={`${s.main} ${isActive("/audio") ? s.mainWide : ""}`}>{children}</main>
    </div>
  );
}
