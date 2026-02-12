import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useLocation } from "react-router";
import { useAuth } from "@/lib/auth/auth-context";
import { t, useLanguage } from "@/lib/i18n";
import { Menu, X } from "lucide-react";
import s from "./shell.module.css";

interface ShellProps {
  children: ReactNode;
}

export function Shell({ children }: ShellProps) {
  const { user, logout } = useAuth();
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

  const navItems = (
    <>
      <li>
        <Link
          to="/dashboard"
          className={`${s.navLink} ${isActive("/dashboard") ? s.navLinkActive : ""}`}
        >
          {t("dashboard.my_prompts")}
        </Link>
      </li>
      <li>
        <Link
          to="/new"
          className={`${s.navLink} ${isActive("/new") ? s.navLinkActive : ""}`}
        >
          {t("dashboard.new_prompt")}
        </Link>
      </li>
      <li>
        <Link
          to="/templates"
          className={`${s.navLink} ${isActive("/templates") ? s.navLinkActive : ""}`}
        >
          {t("dashboard.templates")}
        </Link>
      </li>
      <li>
        <Link
          to="/profile"
          className={`${s.navLink} ${isActive("/profile") ? s.navLinkActive : ""}`}
        >
          {t("profile.nav_label")}
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
      <button
        type="button"
        className={`${s.langBtn} ${lang === "fr" ? s.langBtnActive : ""}`}
        onClick={() => setLang("fr")}
      >
        {t("common.lang_fr")}
      </button>
      <button
        type="button"
        className={`${s.langBtn} ${lang === "en" ? s.langBtnActive : ""}`}
        onClick={() => setLang("en")}
      >
        {t("common.lang_en")}
      </button>
    </div>
  );

  return (
    <div className={s.shell}>
      <nav className={s.nav} ref={navRef}>
        <Link to="/" className={s.logo} aria-label="Promptomatik">
          <img
            src="/logo.webp"
            alt="Promptomatik"
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
      <main className={s.main}>{children}</main>
    </div>
  );
}
