import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router";
import { Shell } from "@/components/layout/shell";
import { Card, Badge, Button, Spinner } from "@/components/ui";
import { FadeIn } from "@/reactbits/fade-in";
import { useAuth } from "@/lib/auth/auth-context";
import { t } from "@/lib/i18n";
import { Search, ArrowUpRight } from "lucide-react";
import * as api from "@/lib/api";
import type { Template, Technique } from "@/lib/api";
import s from "./templates.module.css";

export function TemplatesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [usingId, setUsingId] = useState<string | null>(null);
  const [scope, setScope] = useState<"all" | "official" | "community">("all");

  useEffect(() => {
    setLoaded(false);
    api.getTemplates(scope === "all" ? undefined : scope).then((res) => {
      if (res.data) setTemplates(res.data.templates);
      setLoaded(true);
    });
  }, [scope]);

  const filtered = useMemo(() => {
    if (!search) return templates;
    const q = search.toLowerCase();
    return templates.filter(
      (tpl) =>
        tpl.name.toLowerCase().includes(q) ||
        tpl.tags.some((tag) => tag.toLowerCase().includes(q))
    );
  }, [templates, search]);

  async function handleUse(e: React.MouseEvent, templateId: string) {
    e.preventDefault();
    e.stopPropagation();
    setUsingId(templateId);
    const res = await api.useTemplate(templateId);
    if (res.data) {
      navigate(`/prompt/${res.data.prompt.id}`);
    }
    setUsingId(null);
  }

  const hasTemplates = templates.length > 0;
  const hasResults = filtered.length > 0;

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
            <Button variant="cta" onClick={() => navigate("/new")}>
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
            <div className={s.scopeTabs}>
              <button
                type="button"
                className={`${s.scopeTab} ${scope === "all" ? s.scopeTabActive : ""}`}
                onClick={() => setScope("all")}
              >
                {t("templates.scope_all")}
              </button>
              <button
                type="button"
                className={`${s.scopeTab} ${scope === "official" ? s.scopeTabActive : ""}`}
                onClick={() => setScope("official")}
              >
                {t("templates.scope_official")}
              </button>
              <button
                type="button"
                className={`${s.scopeTab} ${scope === "community" ? s.scopeTabActive : ""}`}
                onClick={() => setScope("community")}
              >
                {t("templates.scope_community")}
              </button>
            </div>

            <div className={s.searchBar}>
              <Search size={16} className={s.searchIcon} />
              <input
                type="text"
                name="search"
                autoComplete="off"
                className={s.searchInput}
                placeholder={t("templates.search_placeholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {!hasResults && (
              <div className={s.noResults}>
                <p>{t("templates.no_results")}</p>
              </div>
            )}

            {hasResults && (
              <div className={s.grid}>
                {filtered.map((tpl) => (
                  <Link key={tpl.id} to={`/templates/${tpl.id}`} className={s.templateLink}>
                    <Card variant="gilt" className={s.templateCard}>
                      <div className={s.cardHeading}>
                        <h3 className={s.cardName}>{tpl.name || "Untitled"}</h3>
                        <span className={s.cardOpenHint} aria-hidden="true">
                          <ArrowUpRight size={13} />
                        </span>
                      </div>
                      <div className={s.cardBadges}>
                        {tpl.blocks.slice(0, 3).map((b, i) => (
                          <Badge key={i} technique={b.technique as Technique}>
                            {t(`techniques.${b.technique}`)}
                          </Badge>
                        ))}
                        {tpl.tags.map((tag) => (
                          <Badge key={tag}>{tag}</Badge>
                        ))}
                      </div>
                      <div className={s.cardMeta}>
                        <div className={s.cardMetaInfo}>
                          <span className={s.cardAuthor}>
                            {t("templates.by", { name: tpl.author_name ?? "" })}
                          </span>
                          <span
                            className={`${s.kindBadge} ${
                              tpl.template_kind === "community" ? s.kindCommunity : s.kindOfficial
                            }`}
                          >
                            {tpl.template_kind === "community"
                              ? t("templates.kind_community")
                              : t("templates.kind_official")}
                          </span>
                        </div>
                        <Button
                          variant="primary"
                          size="small"
                          disabled={usingId === tpl.id}
                          onClick={(e) => handleUse(e, tpl.id)}
                        >
                          {usingId === tpl.id ? <Spinner size={14} /> : t("templates.use")}
                        </Button>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </FadeIn>
    </Shell>
  );
}
