import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router";
import { motion } from "motion/react";
import { Shell } from "@/components/layout/shell";
import { Button, Card, Badge } from "@/components/ui";
import { FadeIn } from "@/reactbits/fade-in";
import BlurText from "@/reactbits/blur-text";
import { useAuth } from "@/lib/auth/auth-context";
import { useOnboarding } from "@/lib/onboarding/onboarding-context";
import { t } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import { FileText, Search, Copy, Trash2, Sparkles, ArrowUpRight } from "lucide-react";
import * as api from "@/lib/api";
import type { Prompt, Technique } from "@/lib/api";
import s from "./dashboard.module.css";

/* ────────────────────────────────────────────────
 * ANIMATION STORYBOARD — Prompt Library
 *
 * Read top-to-bottom. Each `at` is ms after prompts load.
 *
 *     0ms    waiting for prompts
 *   220ms    search bar fades/scales in
 *   920ms    search bar settles into resting position
 *  1180ms    prompt cards pop in (staggered)
 * ──────────────────────────────────────────────── */
const TIMING = {
  searchAppear: 220,
  searchSettle: 920,
  cardsAppear: 1180,
} as const;

const SEARCH = {
  centeredScale: 1.06,
  finalScale: 1,
  centeredY: 14,
  finalY: 0,
  spring: { type: "spring" as const, stiffness: 260, damping: 24 },
} as const;

const CARDS = {
  initialScale: 0.96,
  initialY: 18,
  stagger: 0.05,
  spring: { type: "spring" as const, stiffness: 330, damping: 26 },
} as const;

export function DashboardPage() {
  const { user } = useAuth();
  const onboarding = useOnboarding();
  const navigate = useNavigate();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showProfileNudge, setShowProfileNudge] = useState(false);
  const [profile, setProfile] = useState<api.TeacherProfile | null>(null);
  const [search, setSearch] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [libraryStage, setLibraryStage] = useState(0);

  useEffect(() => {
    api.getPrompts().then((res) => {
      if (res.data) setPrompts(res.data.prompts);
      setLoaded(true);
    });
    api.getProfile().then((res) => {
      if (res.data) {
        setProfile(res.data.profile);
        if (!res.data.profile.setup_completed) setShowProfileNudge(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    onboarding.maybeAutoStartMain({ promptsCount: prompts.length, profile });
  }, [loaded, prompts.length, profile, onboarding]);

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const p of prompts) {
      for (const tag of p.tags) tagSet.add(tag);
    }
    return Array.from(tagSet).sort();
  }, [prompts]);

  const filtered = useMemo(() => {
    let list = prompts;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    }
    if (selectedTags.length > 0) {
      list = list.filter((p) =>
        selectedTags.every((tag) => p.tags.includes(tag))
      );
    }
    return list;
  }, [prompts, search, selectedTags]);

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  async function handleDuplicate(e: React.MouseEvent, promptId: string) {
    e.preventDefault();
    e.stopPropagation();
    const res = await api.duplicatePrompt(promptId);
    if (res.data) {
      setPrompts((prev) => [res.data!.prompt, ...prev]);
    }
  }

  async function handleDelete(e: React.MouseEvent, promptId: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(t("dashboard.delete_confirm"))) return;
    const res = await api.deletePrompt(promptId);
    if (res.data) {
      setPrompts((prev) => prev.filter((p) => p.id !== promptId));
    }
  }

  const hasPrompts = prompts.length > 0;
  const hasResults = filtered.length > 0;

  useEffect(() => {
    if (!loaded || !hasPrompts) {
      setLibraryStage(0);
      return;
    }

    setLibraryStage(0);
    const timers = [
      window.setTimeout(() => setLibraryStage(1), TIMING.searchAppear),
      window.setTimeout(() => setLibraryStage(2), TIMING.searchSettle),
      window.setTimeout(() => setLibraryStage(3), TIMING.cardsAppear),
    ];

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [
    loaded,
    hasPrompts,
    TIMING.searchAppear,
    TIMING.searchSettle,
    TIMING.cardsAppear,
  ]);

  return (
    <Shell>
      {showProfileNudge && (
        <FadeIn delay={0.2} duration={0.4} direction="down" distance={8}>
          <div className={s.nudgeBanner}>
            <span>{t("profile.setup_banner")}</span>
            <div className={s.nudgeActions}>
              <Link to="/profile" className={s.nudgeLink}>
                {t("profile.setup_banner_cta")}
              </Link>
              <button
                type="button"
                className={s.nudgeDismiss}
                onClick={() => setShowProfileNudge(false)}
              >
                {t("common.close")}
              </button>
            </div>
          </div>
        </FadeIn>
      )}

      <div className={s.header}>
        <div>
          <BlurText
            text={t("dashboard.welcome", { name: user?.name ?? "" })}
            className={s.greeting}
            delay={60}
            animateBy="words"
            direction="top"
          />
          <FadeIn delay={0.3} duration={0.4} direction="up" distance={10}>
            <p className={s.greetingSub}>{t("dashboard.subtitle")}</p>
          </FadeIn>
        </div>
        <FadeIn delay={0.4} duration={0.4} direction="right" distance={16}>
          <Button
            variant="cta"
            size="large"
            onClick={() => navigate("/new")}
            data-onboard="new-prompt"
          >
            {t("dashboard.new_prompt")}
          </Button>
        </FadeIn>
      </div>

      <FadeIn delay={0.45} duration={0.6} direction="none">
        <div className={s.headerDivider}>
          <Sparkles size={14} className={s.headerOrnament} />
        </div>
      </FadeIn>

      {loaded && !hasPrompts && (
        <FadeIn delay={0.5} duration={0.6} direction="up" distance={20}>
          <div className={s.emptyState}>
            <FileText className={s.emptyIcon} strokeWidth={1.5} />
            <p className={s.emptyTitle}>{t("dashboard.empty_title")}</p>
            <p className={s.emptyText}>{t("dashboard.empty")}</p>
            <Button variant="secondary" onClick={() => navigate("/new")}>
              {t("dashboard.new_prompt")}
            </Button>
          </div>
        </FadeIn>
      )}

      {loaded && hasPrompts && (
        <>
          <motion.div
            className={s.searchBar}
            initial={false}
            animate={{
              opacity: libraryStage >= 1 ? 1 : 0,
              scale: libraryStage >= 2
                ? SEARCH.finalScale
                : SEARCH.centeredScale,
              y: libraryStage >= 2 ? SEARCH.finalY : SEARCH.centeredY,
            }}
            transition={SEARCH.spring}
          >
            <Search size={16} className={s.searchIcon} />
            <input
              type="text"
              name="search"
              autoComplete="off"
              className={s.searchInput}
              placeholder={t("dashboard.search_placeholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </motion.div>

          {allTags.length > 0 && (
            <motion.div
              className={s.filterChips}
              initial={false}
              animate={{
                opacity: libraryStage >= 2 ? 1 : 0,
                y: libraryStage >= 2 ? 0 : 10,
              }}
              transition={SEARCH.spring}
            >
              {allTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`${s.filterChip} ${selectedTags.includes(tag) ? s.filterChipActive : ""}`}
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </button>
              ))}
            </motion.div>
          )}

          {!hasResults && (
            <div className={s.noResults}>
              <p>{t("dashboard.no_results")}</p>
            </div>
          )}

          {hasResults && (
            <div className={s.promptList}>
              {filtered.map((p, i) => (
                <motion.div
                  key={p.id}
                  initial={false}
                  animate={{
                    opacity: libraryStage >= 3 ? 1 : 0,
                    scale: libraryStage >= 3 ? 1 : CARDS.initialScale,
                    y: libraryStage >= 3 ? 0 : CARDS.initialY,
                  }}
                  transition={{
                    ...CARDS.spring,
                    delay: i * CARDS.stagger,
                  }}
                >
                  <Link to={`/prompt/${p.id}`} className={s.promptLink}>
                    <Card variant="gilt" className={s.promptCard}>
                      <div className={s.cardTop}>
                        <div className={s.cardHeading}>
                          <h3 className={s.promptName}>{p.name || "Untitled"}</h3>
                          <span className={s.cardOpenHint} aria-hidden="true">
                            <ArrowUpRight size={13} />
                          </span>
                        </div>
                        <div className={s.cardActions}>
                          <button
                            type="button"
                            className={s.cardAction}
                            title={t("dashboard.duplicate")}
                            aria-label={t("dashboard.duplicate")}
                            onClick={(e) => handleDuplicate(e, p.id)}
                          >
                            <Copy size={14} />
                          </button>
                          <button
                            type="button"
                            className={`${s.cardAction} ${s.cardActionDanger}`}
                            title={t("common.delete")}
                            aria-label={t("common.delete")}
                            onClick={(e) => handleDelete(e, p.id)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      <div className={s.promptTags}>
                        {p.blocks.slice(0, 3).map((b, j) => (
                          <Badge key={j} technique={b.technique as Technique}>
                            {t(`techniques.${b.technique}`)}
                          </Badge>
                        ))}
                        {p.tags.length > 0 &&
                          p.tags.map((tag) => (
                            <Badge key={tag}>{tag}</Badge>
                          ))}
                      </div>
                      <p className={s.promptDate}>
                        {formatDate(p.updated_at)}
                      </p>
                    </Card>
                  </Link>
                </motion.div>
              ))}
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
