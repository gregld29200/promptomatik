import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, ArrowUpRight, FileAudio, FileText, Lock, MessageSquareText, Users } from "lucide-react";
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

// The post-login hub: one door per module, recent work at a glance, and —
// for free users — Audio/Documents shown locked but desirable (the ajar
// door that sells the training; hiding them would kill discovery).
export function HomePage() {
  useLanguage();
  const { user, isParticipant } = useAuth();
  const [prompts, setPrompts] = useState<Prompt[] | null>(null);
  const [takes, setTakes] = useState<AudioJob[] | null>(null);
  const [docs, setDocs] = useState<DocumentJobSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.getPrompts().then((res) => {
      if (!cancelled) setPrompts(res.data?.prompts.slice(0, RECENT_COUNT) ?? []);
    });
    if (isParticipant) {
      void api.getAudioJobs(RECENT_COUNT, 0).then((res) => {
        if (!cancelled) setTakes(res.data?.jobs ?? []);
      });
      void api.getDocumentJobs().then((res) => {
        if (!cancelled) setDocs(res.data?.jobs.slice(0, RECENT_COUNT) ?? []);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [isParticipant]);

  const firstName = user?.name?.split(" ")[0] ?? "";

  return (
    <Shell>
      <div className={s.page}>
        <header className={s.header}>
          <p className={s.eyebrow}>{t("home.eyebrow")}</p>
          <h1 className={s.title}>{t("home.greeting", { name: firstName })}</h1>
          <p className={s.subtitle}>{t("home.subtitle")}</p>
        </header>

        <div className={s.grid}>
          {/* Prompts — always open (the freemium module). */}
          <section className={s.card} aria-labelledby="home-card-prompts">
            <div className={s.cardHead}>
              <span className={s.cardIcon}>
                <MessageSquareText size={18} aria-hidden />
              </span>
              <h2 id="home-card-prompts">{t("home.prompts_title")}</h2>
            </div>
            <p className={s.cardDesc}>{t("home.prompts_desc")}</p>
            <RecentList
              loading={prompts === null}
              emptyLabel={t("home.prompts_empty")}
              items={(prompts ?? []).map((prompt) => ({
                key: prompt.id,
                to: `/prompts/${prompt.id}`,
                label: prompt.name || "Untitled",
                meta: formatDate(prompt.updated_at),
              }))}
            />
            <div className={s.cardActions}>
              <Link to="/prompts/new" className={s.cardCta}>
                {t("home.prompts_cta")}
                <ArrowRight size={14} aria-hidden />
              </Link>
              <Link to="/prompts" className={s.cardLink}>
                {t("home.prompts_library")}
              </Link>
            </div>
          </section>

          {isParticipant ? (
            <>
              <section className={s.card} aria-labelledby="home-card-audio">
                <div className={s.cardHead}>
                  <span className={s.cardIcon}>
                    <FileAudio size={18} aria-hidden />
                  </span>
                  <h2 id="home-card-audio">{t("home.audio_title")}</h2>
                </div>
                <p className={s.cardDesc}>{t("home.audio_desc")}</p>
                <RecentList
                  loading={takes === null}
                  emptyLabel={t("home.audio_empty")}
                  items={(takes ?? []).map((job) => ({
                    key: job.id,
                    to: `/audio?job=${job.id}`,
                    label: takeTitle(job),
                    meta: t(`audio.status_${job.status}`),
                  }))}
                />
                <div className={s.cardActions}>
                  <Link to="/audio" className={s.cardCta}>
                    {t("home.audio_cta")}
                    <ArrowRight size={14} aria-hidden />
                  </Link>
                  <Link to="/audio/library" className={s.cardLink}>
                    {t("home.audio_library")}
                  </Link>
                </div>
              </section>

              <section className={s.card} aria-labelledby="home-card-documents">
                <div className={s.cardHead}>
                  <span className={s.cardIcon}>
                    <FileText size={18} aria-hidden />
                  </span>
                  <h2 id="home-card-documents">{t("home.documents_title")}</h2>
                </div>
                <p className={s.cardDesc}>{t("home.documents_desc")}</p>
                <RecentList
                  loading={docs === null}
                  emptyLabel={t("home.documents_empty")}
                  items={(docs ?? []).map((job) => ({
                    key: job.id,
                    to: `/documents?job=${job.id}`,
                    label: job.label,
                    meta: t(`documents.status.${job.status}`),
                  }))}
                />
                <div className={s.cardActions}>
                  <Link to="/documents" className={s.cardCta}>
                    {t("home.documents_cta")}
                    <ArrowRight size={14} aria-hidden />
                  </Link>
                </div>
              </section>

              <section className={`${s.card} ${s.cardCommunity}`} aria-labelledby="home-card-community">
                <div className={s.cardHead}>
                  <span className={s.cardIcon}>
                    <Users size={18} aria-hidden />
                  </span>
                  <h2 id="home-card-community">{t("home.community_title")}</h2>
                </div>
                <p className={s.cardDesc}>{t("home.community_desc")}</p>
                <div className={s.cardActions}>
                  <a href={COMMUNITY_URL} target="_blank" rel="noreferrer" className={s.cardCta}>
                    {t("home.community_cta")}
                    <ArrowUpRight size={14} aria-hidden />
                  </a>
                </div>
              </section>
            </>
          ) : (
            <>
              <LockedCard
                titleId="home-card-audio"
                icon={<FileAudio size={18} aria-hidden />}
                title={t("home.audio_title")}
                pitch={t("home.audio_locked")}
              />
              <LockedCard
                titleId="home-card-documents"
                icon={<FileText size={18} aria-hidden />}
                title={t("home.documents_title")}
                pitch={t("home.documents_locked")}
              />
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}

interface RecentItem {
  key: string;
  to: string;
  label: string;
  meta: string;
}

function RecentList({ items, loading, emptyLabel }: { items: RecentItem[]; loading: boolean; emptyLabel: string }) {
  let content: React.ReactNode;

  if (loading) {
    content = (
      <div className={s.recentSkeleton} aria-hidden>
        <span />
        <span />
      </div>
    );
  } else if (items.length === 0) {
    content = <p className={s.recentEmpty}>{emptyLabel}</p>;
  } else {
    content = (
      <ul className={s.recentList}>
        {items.map((item) => (
          <li key={item.key}>
            <Link to={item.to} className={s.recentRow} title={item.label}>
              <span className={s.recentLabel}>{item.label}</span>
              <span className={s.recentMeta}>{item.meta}</span>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className={s.recentRegion} aria-live="polite" aria-busy={loading}>
      {content}
    </div>
  );
}

// The ajar door: locked modules stay visible and desirable for free users.
function LockedCard({ titleId, icon, title, pitch }: { titleId: string; icon: React.ReactNode; title: string; pitch: string }) {
  return (
    <section className={`${s.card} ${s.cardLocked}`} aria-labelledby={titleId}>
      <div className={s.cardHead}>
        <span className={s.cardIcon}>{icon}</span>
        <h2 id={titleId}>{title}</h2>
        <span className={s.lockBadge}>
          <Lock size={12} aria-hidden />
          {t("home.locked_badge")}
        </span>
      </div>
      <p className={s.cardDesc}>{pitch}</p>
      <div className={s.cardActions}>
        <a href={UPGRADE_CTA_URL} target="_blank" rel="noreferrer" className={s.cardCta}>
          {t("home.locked_cta")}
          <ArrowUpRight size={14} aria-hidden />
        </a>
      </div>
    </section>
  );
}
