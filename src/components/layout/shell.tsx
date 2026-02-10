import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "@/lib/auth/auth-context";
import { t } from "@/lib/i18n";
import s from "./shell.module.css";

interface ShellProps {
  children: ReactNode;
}

export function Shell({ children }: ShellProps) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <div className={s.shell}>
      <nav className={s.nav}>
        <Link to="/" className={s.logo}>
          Promptomatic
        </Link>
        <ul className={s.navLinks}>
          <li>
            <Link to="/dashboard" className={s.navLink}>
              {t("dashboard.my_prompts")}
            </Link>
          </li>
          <li>
            <Link to="/templates" className={s.navLink}>
              {t("dashboard.templates")}
            </Link>
          </li>
          <li>
            <button onClick={handleLogout} className={s.navLink} type="button">
              {t("auth.logout")}
            </button>
          </li>
        </ul>
      </nav>
      <main className={s.main}>{children}</main>
    </div>
  );
}
