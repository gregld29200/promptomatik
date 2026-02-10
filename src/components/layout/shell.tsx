import type { ReactNode } from "react";
import { Link } from "react-router";
import { t } from "@/lib/i18n";
import s from "./shell.module.css";

interface ShellProps {
  children: ReactNode;
}

export function Shell({ children }: ShellProps) {
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
        </ul>
      </nav>
      <main className={s.main}>{children}</main>
    </div>
  );
}
