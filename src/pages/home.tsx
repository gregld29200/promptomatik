import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  FileText,
  Lock,
  MessageSquareText,
  Mic2,
} from "lucide-react";
import { Shell } from "@/components/layout/shell";
import { useAuth } from "@/lib/auth/auth-context";
import { t, useLanguage } from "@/lib/i18n";
import * as api from "@/lib/api";
import type { AudioJob, DocumentJobSummary, Prompt } from "@/lib/api";
import { COMMUNITY_URL, UPGRADE_CTA_URL } from "@/lib/config";
import { formatDate } from "@/lib/format-date";
import { takeTitle } from "@/lib/audio-display";
import s from "./home.module.css";

const RECENT_COUNT = 3;

type WorkKind = "prompt" | "audio" | "document";

interface WorkItem {
  id: string;
  kind: WorkKind;
  label: string;
  meta: string;
  timestamp: string;
  to: string;
}

interface WorkshopProps {
  number: string;
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  primary: ReactNode;
  secondary?: ReactNode;
  locked?: boolean;
}

export function HomePage() {
  useLanguage();
  const { user, isParticipant } = useAuth();
  const [prompts, setPrompts] = useState<Prompt[] | null>(null);
  const [takes, setTakes] = useState<AudioJob[] | null>(null);
  const [docs, setDocs] = useState<DocumentJobSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    void api.getPrompts().then((response) => {
      if (!cancelled) setPrompts(response.data?.prompts.slice(0, RECENT_COUNT) ?? []);
    });

    if (isParticipant) {
      void api.getAudioJobs(RECENT_COUNT, 0).then((response) => {
        if (!cancelled) setTakes(response.data?.jobs ?? []);
      });
      void api.getDocumentJobs().then((response) => {
        if (!cancelled) setDocs(response.data?.jobs.slice(0, RECENT_COUNT) ?? []);
      });
    } else {
      setTakes([]);
      setDocs([]);
    }

    return () => {
      cancelled = true;
    };
  }, [isParticipant]);

  const firstName = user?.name?.split(" ")[0] ?? "";
  const recentWork = useMemo(() => buildRecentWork(prompts, takes, docs), [prompts, takes, docs]);
  const loading = prompts === null || takes === null || docs === null;

  return (
    <Shell>
      <div className={s.page}>
        <header className={s.header}>
          <p className={s.eyebrow}>{t("home.eyebrow_short")}</p>
          <h1 className={s.title}>{t("home.greeting", { name: firstName })}</h1>
          <p className={s.subtitle}>{t("home.subtitle_short")}</p>
        </header>

        <div className={s.dashboardGrid}>
          <section className={s.workshops} aria-labelledby="workshops-title">
            <h2 id="workshops-title" className={s.sectionTitle}>{t("home.start_workshop")}</h2>

            <div className={s.workshopList}>
              <Workshop
                number="01"
                title={t("home.prompts_title")}
                description={t("home.prompts_desc_short")}
                image="workshop-prompts"
                imageAlt={t("home.prompts_image_alt")}
                primary={<Link to="/prompts/new">{t("home.prompts_cta_short")}<ArrowRight size={17} aria-hidden /></Link>}
                secondary={<Link to="/prompts">{t("home.prompts_library")}</Link>}
              />

              <Workshop
                number="02"
                title={t("home.audio_title")}
                description={isParticipant ? t("home.audio_desc_short") : t("home.audio_locked")}
                image="workshop-audio"
                imageAlt={t("home.audio_image_alt")}
                locked={!isParticipant}
                primary={
                  isParticipant
                    ? <Link to="/audio">{t("home.audio_cta_short")}<ArrowRight size={17} aria-hidden /></Link>
                    : <a href={UPGRADE_CTA_URL} target="_blank" rel="noreferrer">{t("home.locked_cta")}<ArrowUpRight size={17} aria-hidden /></a>
                }
                secondary={isParticipant ? <Link to="/audio/library">{t("home.audio_library")}</Link> : undefined}
              />

              <Workshop
                number="03"
                title={t("home.documents_title")}
                description={isParticipant ? t("home.documents_desc_short") : t("home.documents_locked")}
                image="workshop-documents"
                imageAlt={t("home.documents_image_alt")}
                locked={!isParticipant}
                primary={
                  isParticipant
                    ? <Link to="/documents">{t("home.documents_cta_short")}<ArrowRight size={17} aria-hidden /></Link>
                    : <a href={UPGRADE_CTA_URL} target="_blank" rel="noreferrer">{t("home.locked_cta")}<ArrowUpRight size={17} aria-hidden /></a>
                }
              />

              <article className={`${s.training} ${!isParticipant ? s.trainingLocked : ""}`}>
                <picture className={s.trainingVisual}>
                  <source
                    srcSet="/images/workshops/workshop-training.webp 660w, /images/workshops/workshop-training@2x.webp 1320w"
                    sizes="(max-width: 820px) 100vw, 370px"
                    type="image/webp"
                  />
                  <img
                    src="/images/workshops/workshop-training.webp"
                    width="660"
                    height="300"
                    alt={t("home.training_image_alt")}
                    loading="lazy"
                    decoding="async"
                  />
                </picture>
                <div className={s.trainingContent}>
                  <div>
                    <h3>{t("home.community_title")}</h3>
                    <p>{isParticipant ? t("home.community_desc_short") : t("home.community_desc")}</p>
                  </div>
                  <a
                    href={isParticipant ? COMMUNITY_URL : UPGRADE_CTA_URL}
                    target="_blank"
                    rel="noreferrer"
                    className={s.trainingCta}
                  >
                    {isParticipant ? t("home.community_cta") : t("home.locked_cta")}
                    <ArrowUpRight size={16} aria-hidden />
                  </a>
                </div>
              </article>
            </div>
          </section>

          <aside className={s.rail} aria-label={t("home.work_overview")}>
            <RailPanel title={t("home.resume_work")}>
              <WorkList items={recentWork} loading={loading} emptyLabel={t("home.recent_empty")} />
            </RailPanel>

            <RailPanel title={t("home.recent_activity")}>
              <ActivityList items={recentWork.slice(0, 2)} loading={loading} />
              <Link to="/prompts" className={s.viewAll}>
                {t("home.view_all_activity")}
                <ArrowRight size={16} aria-hidden />
              </Link>
            </RailPanel>
          </aside>
        </div>
      </div>
    </Shell>
  );
}

function Workshop({ number, title, description, image, imageAlt, primary, secondary, locked }: WorkshopProps) {
  return (
    <article className={`${s.workshop} ${locked ? s.workshopLocked : ""}`}>
      <picture className={s.workshopVisual}>
        <source
          srcSet={`/images/workshops/${image}.webp 660w, /images/workshops/${image}@2x.webp 1320w`}
          sizes="(max-width: 820px) 100vw, 370px"
          type="image/webp"
        />
        <img
          src={`/images/workshops/${image}.webp`}
          width="660"
          height="300"
          alt={imageAlt}
          loading={number === "01" ? "eager" : "lazy"}
          fetchPriority={number === "01" ? "high" : "auto"}
          decoding="async"
        />
      </picture>

      <div className={s.workshopContent}>
        <div className={s.workshopCopy}>
          <div className={s.workshopTitleRow}>
            <h3><span>{number}</span> · {title}</h3>
            {locked && <span className={s.lockBadge}><Lock size={12} aria-hidden />{t("home.locked_badge")}</span>}
          </div>
          <p>{description}</p>
        </div>
        <div className={s.workshopActions}>
          <span className={s.primaryAction}>{primary}</span>
          {secondary && <span className={s.secondaryAction}>{secondary}</span>}
        </div>
      </div>
    </article>
  );
}

function RailPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={s.railPanel} aria-live="polite">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function WorkList({ items, loading, emptyLabel }: { items: WorkItem[]; loading: boolean; emptyLabel: string }) {
  if (loading) return <LoadingRows />;
  if (items.length === 0) return <p className={s.empty}>{emptyLabel}</p>;

  return (
    <ul className={s.workList}>
      {items.map((item) => (
        <li key={`${item.kind}-${item.id}`}>
          <Link to={item.to}>
            <WorkIcon kind={item.kind} />
            <span className={s.workText}>
              <strong>{item.label}</strong>
              <small>{item.meta}</small>
            </span>
            <ChevronRight size={18} aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ActivityList({ items, loading }: { items: WorkItem[]; loading: boolean }) {
  if (loading) return <LoadingRows />;
  if (items.length === 0) return <p className={s.empty}>{t("home.recent_empty")}</p>;

  return (
    <ul className={s.activityList}>
      {items.map((item) => (
        <li key={`activity-${item.kind}-${item.id}`}>
          <WorkIcon kind={item.kind} />
          <span className={s.workText}>
            <span>{t(`home.activity_${item.kind}`, { name: item.label })}</span>
            <small>{formatDate(item.timestamp)}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}

function WorkIcon({ kind }: { kind: WorkKind }) {
  const icon = kind === "audio"
    ? <Mic2 size={23} />
    : kind === "document"
      ? <FileText size={23} />
      : <MessageSquareText size={23} />;

  return <span className={`${s.workIcon} ${s[`workIcon_${kind}`]}`} aria-hidden>{icon}</span>;
}

function LoadingRows() {
  return (
    <div className={s.loadingRows} role="status" aria-live="polite">
      <span className="sr-only">{t("common.loading")}</span>
      <span className={s.loadingBar} aria-hidden />
      <span className={s.loadingBar} aria-hidden />
      <span className={s.loadingBar} aria-hidden />
    </div>
  );
}

function buildRecentWork(
  prompts: Prompt[] | null,
  takes: AudioJob[] | null,
  docs: DocumentJobSummary[] | null,
): WorkItem[] {
  if (prompts === null || takes === null || docs === null) return [];

  const items: WorkItem[] = [
    ...prompts.map((prompt) => ({
      id: prompt.id,
      kind: "prompt" as const,
      label: prompt.name || t("home.untitled"),
      meta: `${t("home.kind_prompt")} · ${formatDate(prompt.updated_at)}`,
      timestamp: prompt.updated_at,
      to: `/prompts/${prompt.id}`,
    })),
    ...takes.map((job) => ({
      id: job.id,
      kind: "audio" as const,
      label: takeTitle(job),
      meta: `${t("home.kind_audio")} · ${t(`audio.status_${job.status}`)}`,
      timestamp: job.createdAt,
      to: `/audio?job=${job.id}`,
    })),
    ...docs.map((job) => ({
      id: job.id,
      kind: "document" as const,
      label: job.label,
      meta: `${t("home.kind_document")} · ${t(`documents.status.${job.status}`)}`,
      timestamp: job.createdAt,
      to: `/documents?job=${job.id}`,
    })),
  ];

  return items
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
    .slice(0, RECENT_COUNT);
}
