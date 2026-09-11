import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router";
import { Shell } from "@/components/layout/shell";
import { Button, Spinner } from "@/components/ui";
import { FadeIn } from "@/reactbits/fade-in";
import { useAuth } from "@/lib/auth/auth-context";
import { UpgradeGate } from "@/components/upgrade-gate";
import { t } from "@/lib/i18n";
import { Search } from "lucide-react";
import * as api from "@/lib/api";
import { TEMPLATE_THEMES, type Template, type TemplateTheme } from "@/lib/api";
import s from "./templates.module.css";


/** Fallback for templates published before cards existed: first lines of the prompt itself. */
function excerptOf(tpl: Template): string {
  return [...tpl.blocks]
    .sort((a, b) => a.order - b.order)
    .map((b) => b.content)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

export function TemplatesPage() {
  const { user, isParticipant } = useAuth();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [usingId, setUsingId] = useState<string | null>(null);
  const [theme, setTheme] = useState<TemplateTheme | "all">("all");

  useEffect(() => {
    if (!isParticipant) return;
    api.getTemplates().then((res) => {
      if (res.data) setTemplates(res.data.templates);
      setLoaded(true);
    });
  }, [isParticipant]);

  // Only themes that have at least one template become a filter.
  const themes = useMemo(
    () => TEMPLATE_THEMES.filter((value) => templates.some((tpl) => tpl.template_card?.theme === value)),
    [templates]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((tpl) => {
      if (theme !== "all" && tpl.template_card?.theme !== theme) return false;
      if (!q) return true;
      return (
        tpl.name.toLowerCase().includes(q) ||
        (tpl.template_card?.need.toLowerCase().includes(q) ?? false) ||
        tpl.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }, [templates, search, theme]);

  async function handleUse(templateId: string) {
    setUsingId(templateId);
    const res = await api.useTemplate(templateId);
    if (res.data) {
      navigate(`/prompts/${res.data.prompt.id}`);
    }
    setUsingId(null);
  }

  const hasTemplates = templates.length > 0;
  const hasResults = filtered.length > 0;

  if (!isParticipant) {
    return (
      <Shell>
        <UpgradeGate variant="page" message={t("upgrade.feature_templates")} />
      </Shell>
    );
  }

  if (!loaded) {
    return (
      <Shell>
        <div className={s.center}>
          <Spinner size={28} />
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <FadeIn duration={0.5} direction="up" distance={16}>
        <div className={s.header}>
          <div>
            <h1 className={s.title}>{t("templates.title")}</h1>
            <p className={s.subtitle}>{t("templates.subtitle")}</p>
          </div>
          {user?.role === "admin" && (
            <Button variant="cta" onClick={() => navigate("/prompts/new")}>
              {t("templates.create_official")}
            </Button>
          )}
        </div>

        {!hasTemplates && (
          <div className={s.emptyState}>
            <p className={s.emptyText}>{t("templates.empty")}</p>
          </div>
        )}

        {hasTemplates && (
          <>
            <div className={s.toolbar}>
              <div className={s.scopeTabs} role="group" aria-label={t("templates.theme_label")}>
                <button
                  type="button"
                  className={`${s.scopeTab} ${theme === "all" ? s.scopeTabActive : ""}`}
                  aria-pressed={theme === "all"}
                  onClick={() => setTheme("all")}
                >
                  {t("templates.theme_all")}
                </button>
                {themes.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`${s.scopeTab} ${theme === value ? s.scopeTabActive : ""}`}
                    aria-pressed={theme === value}
                    onClick={() => setTheme(value)}
                  >
                    {t(`themes.${value}`)}
                  </button>
                ))}
              </div>

              <div className={s.searchBar}>
                <Search size={16} className={s.searchIcon} />
                <input
                  type="search"
                  name="search"
                  autoComplete="off"
                  className={s.searchInput}
                  placeholder={t("templates.search_placeholder")}
                  aria-label={t("templates.search_placeholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            {!hasResults && (
              <div className={s.noResults}>
                <p>{t("templates.no_results")}</p>
              </div>
            )}

            {hasResults && (
              <ul className={s.grid}>
                {filtered.map((tpl) => {
                  const detailHref = `/prompts/templates/${tpl.id}`;
                  const isUsing = usingId === tpl.id;
                  return (
                    <li key={tpl.id} className={s.templateCard}>
                      <p className={s.cardOrigin}>
                        {tpl.template_card?.theme && (
                          <>
                            <span className={s.cardTheme}>{t(`themes.${tpl.template_card.theme}`)}</span>
                            {" · "}
                          </>
                        )}
                        {tpl.template_kind === "community"
                          ? t("templates.by", { name: tpl.author_name ?? "" })
                          : t("templates.kind_official")}
                      </p>

                      <h3 className={s.cardName}>
                        <Link to={detailHref} className={s.cardNameLink}>
                          {(tpl.template_card?.need ?? tpl.name) || "Untitled"}
                        </Link>
                      </h3>

                      <p className={s.cardExcerpt}>{tpl.template_card?.when ?? excerptOf(tpl)}</p>

                      <div className={s.cardActions}>
                        <Link to={detailHref} className={s.readLink}>
                          {t("templates.read")}
                        </Link>
                        <Button
                          variant="primary"
                          size="small"
                          disabled={isUsing}
                          onClick={() => handleUse(tpl.id)}
                        >
                          {isUsing ? <Spinner size={14} /> : t("templates.use")}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </FadeIn>
    </Shell>
  );
}
