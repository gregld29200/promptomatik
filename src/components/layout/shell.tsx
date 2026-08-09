import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  ArrowUpRight,
  AudioLines,
  BookOpen,
  FileText,
  Home,
  LayoutTemplate,
  Library,
  Lock,
  LogOut,
  Menu,
  MessageSquareText,
  Mic2,
  Plus,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { COMMUNITY_URL, UPGRADE_CTA_URL } from "@/lib/config";
import { SUPPORTED_LANGUAGES, t, useLanguage, type Language } from "@/lib/i18n";
import s from "./shell.module.css";

interface ShellProps {
  children: ReactNode;
  /**
   * Replaces the last breadcrumb for a page that stands for one named thing —
   * an open transcript, say. The route only knows it is "the workspace"; the
   * page knows what the teacher actually opened, and the breadcrumb should say
   * so rather than repeating the section.
   */
  pageLabel?: string | null;
}

interface NavItemProps {
  to: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  locked?: boolean;
  nested?: boolean;
}

export function Shell({ children, pageLabel }: ShellProps) {
  const { user, isParticipant, logout, updateLanguagePreference } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [lang, setLang] = useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const context = getPageContext(location.pathname);

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  function isActive(path: string) {
    return location.pathname === path || location.pathname.startsWith(path + "/");
  }

  useEffect(() => {
    if (!menuOpen) return;

    function handleClick(event: MouseEvent) {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClick);
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  async function handleLanguageChange(nextLang: Language) {
    if (nextLang === lang) return;

    const previousLang = lang;
    setLang(nextLang);
    if (!user) return;

    const error = await updateLanguagePreference(nextLang);
    if (error) {
      console.error("Failed to update language preference", error);
      setLang(previousLang);
    }
  }

  const isPromptLibrary = isActive("/prompts") && !isActive("/prompts/new") && !isActive("/prompts/templates");
  const navigation = (
    <div className={s.navigation}>
      <p className={s.navSectionLabel}>{t("shell.studio")}</p>
      <ul className={s.navLinks}>
        <li>
          <NavItem to="/home" label={t("home.nav_home")} icon={<Home size={20} />} active={isActive("/home")} />
        </li>
      </ul>

      <p className={s.navSectionLabel}>{t("shell.workshops")}</p>
      <ul className={s.navLinks}>
        <li className={s.promptGroup}>
          <NavItem
            to="/prompts"
            label="Promptomatik"
            icon={<MessageSquareText size={20} />}
            active={isActive("/prompts")}
          />
          <ul className={s.subnav} aria-label="Promptomatik">
            <li>
              <NavItem
                to="/prompts/new"
                label={t("dashboard.new_prompt")}
                icon={<Plus size={16} />}
                active={isActive("/prompts/new")}
                nested
              />
            </li>
            <li>
              <NavItem
                to="/prompts"
                label={t("dashboard.my_prompts")}
                icon={<Library size={16} />}
                active={isPromptLibrary}
                nested
              />
            </li>
            <li>
              <NavItem
                to="/prompts/templates"
                label={t("dashboard.templates")}
                icon={<LayoutTemplate size={16} />}
                active={isActive("/prompts/templates")}
                locked={!isParticipant}
                nested
              />
            </li>
          </ul>
        </li>
        <li>
          <NavItem
            to="/audio"
            label={t("audio.nav_label")}
            icon={<Mic2 size={20} />}
            active={isActive("/audio")}
            locked={!isParticipant}
          />
        </li>
        <li>
          <NavItem
            to="/transcribe"
            label={t("transcription.nav_label")}
            icon={<AudioLines size={20} />}
            active={isActive("/transcribe")}
            locked={!isParticipant}
          />
        </li>
        <li>
          <NavItem
            to="/documents"
            label={t("documents.nav_label")}
            icon={<FileText size={20} />}
            active={isActive("/documents")}
            locked={!isParticipant}
          />
        </li>
        <li>
          <a
            href={isParticipant ? COMMUNITY_URL : UPGRADE_CTA_URL}
            target="_blank"
            rel="noreferrer"
            className={s.navLink}
          >
            <span className={s.navIcon} aria-hidden><BookOpen size={20} /></span>
            <span>{t("home.community_title")}</span>
            {!isParticipant
              ? <><Lock size={12} className={s.navLock} aria-hidden /><span className="sr-only">{t("upgrade.nav_locked")}</span></>
              : <ArrowUpRight size={13} className={s.navLock} aria-hidden />}
          </a>
        </li>
      </ul>

      <p className={s.navSectionLabel}>{t("shell.account")}</p>
      <ul className={s.navLinks}>
        <li>
          <NavItem
            to="/profile"
            label={t("profile.nav_label")}
            icon={<UserRound size={20} />}
            active={isActive("/profile")}
            locked={!isParticipant}
          />
        </li>
        {user?.role === "admin" && (
          <li>
            <NavItem
              to="/admin"
              label={t("admin.nav_label")}
              icon={<ShieldCheck size={20} />}
              active={isActive("/admin")}
            />
          </li>
        )}
      </ul>
    </div>
  );

  const langToggle = (
    <div className={s.langToggle} role="group" aria-label={t("home.language_label")}>
      {SUPPORTED_LANGUAGES.map((option) => (
        <button
          key={option}
          type="button"
          className={`${s.langBtn} ${lang === option ? s.langBtnActive : ""}`}
          onClick={() => void handleLanguageChange(option)}
          aria-pressed={lang === option}
        >
          {t(`common.lang_${option}`)}
        </button>
      ))}
    </div>
  );

  return (
    <div className={s.shell}>
      <a href="#main-content" className={s.skipLink}>{t("shell.skip_to_content")}</a>
      <nav className={s.nav} ref={navRef} aria-label={t("home.main_navigation")}>
        <div className={s.navTop}>
          <Link to="/home" className={s.logo} aria-label="TeachInspire Studio" translate="no">
            <span className={s.logoName}>TeachInspire</span>
            <span className={s.logoStudio}>Studio</span>
          </Link>

          <button
            type="button"
            className={s.hamburger}
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            aria-label={menuOpen ? t("common.close") : t("common.menu")}
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        <div className={s.desktopNavigation}>{navigation}</div>

        <div className={s.navFooter}>
          {langToggle}
          <button onClick={handleLogout} className={s.logout} type="button">
            <LogOut size={19} aria-hidden />
            <span>{t("auth.logout")}</span>
          </button>
        </div>

        {menuOpen && (
          <div className={s.mobileMenu} id="mobile-navigation">
            {navigation}
            <div className={s.mobileFooter}>
              {langToggle}
              <button onClick={handleLogout} className={s.logout} type="button">
                <LogOut size={19} aria-hidden />
                <span>{t("auth.logout")}</span>
              </button>
            </div>
          </div>
        )}
      </nav>

      <div className={s.workspace}>
        <header className={s.topbar}>
          <p className={s.breadcrumb}>
            <span>{context.section}</span>
            <span aria-hidden>/</span>
            <strong>{pageLabel?.trim() || context.page}</strong>
          </p>
          <div className={s.topbarRight}>
            {context.action && (
              <Link to={context.action.to} className={s.contextAction}>
                <Plus size={16} aria-hidden />
                {context.action.label}
              </Link>
            )}
            <span className={s.accountSummary}>
              <strong>{isParticipant ? t("shell.participant") : t("shell.free")}</strong>
              <span aria-hidden>·</span>
              <span>{user?.name ?? ""}</span>
            </span>
          </div>
        </header>

        {/* Transcripts are long documents, like an audio take's editor — both
            get the wide workspace rather than the reading-width column. */}
        <main
          className={`${s.main} ${isActive("/audio") || isActive("/transcribe") ? s.mainWide : ""}`}
          id="main-content"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

function NavItem({ to, label, icon, active, locked, nested }: NavItemProps) {
  return (
    <Link
      to={to}
      className={`${s.navLink} ${active ? s.navLinkActive : ""} ${nested ? s.navLinkNested : ""}`}
      aria-current={active ? "page" : undefined}
    >
      <span className={s.navIcon} aria-hidden>{icon}</span>
      <span>{label}</span>
      {locked && <Lock size={12} className={s.navLock} aria-label={t("upgrade.nav_locked")} />}
    </Link>
  );
}

function getPageContext(pathname: string) {
  if (pathname === "/home") {
    return {
      section: t("shell.studio"),
      page: t("home.nav_home"),
      action: { to: "/prompts/new", label: t("home.prompts_cta_short") },
    };
  }

  if (pathname.startsWith("/prompts/templates")) {
    return { section: "Promptomatik", page: t("dashboard.templates"), action: null };
  }

  if (pathname.startsWith("/prompts/new")) {
    return { section: "Promptomatik", page: t("dashboard.new_prompt"), action: null };
  }

  if (pathname.startsWith("/prompts")) {
    return {
      section: "Promptomatik",
      page: t("dashboard.my_prompts"),
      action: { to: "/prompts/new", label: t("home.prompts_cta_short") },
    };
  }

  if (pathname.startsWith("/audio/library")) {
    return { section: t("audio.nav_label"), page: t("home.audio_library"), action: { to: "/audio", label: t("home.audio_cta_short") } };
  }

  if (pathname.startsWith("/audio")) {
    return { section: t("audio.nav_label"), page: t("shell.workspace"), action: null };
  }

  if (pathname.startsWith("/transcribe/library")) {
    return {
      section: t("transcription.nav_label"),
      page: t("transcription.library_title"),
      action: { to: "/transcribe", label: t("transcription.new_transcript") },
    };
  }

  if (pathname.startsWith("/transcribe")) {
    return { section: t("transcription.nav_label"), page: t("shell.workspace"), action: null };
  }

  if (pathname.startsWith("/documents")) {
    return { section: t("documents.nav_label"), page: t("shell.workspace"), action: null };
  }

  if (pathname.startsWith("/profile")) {
    return { section: t("shell.account"), page: t("profile.nav_label"), action: null };
  }

  return { section: t("shell.account"), page: t("admin.nav_label"), action: null };
}
