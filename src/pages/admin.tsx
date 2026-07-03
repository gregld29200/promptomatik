import { useState, useEffect, useCallback, type FormEvent, type ReactElement } from "react";
import { Navigate } from "react-router";
import { Shell } from "@/components/layout/shell";
import { Card, Button, Input, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth/auth-context";
import { getLanguage, t } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import * as api from "@/lib/api";
import type {
  Invitation,
  AdminUser,
  AdminTemplate,
  AdminTemplateSubmission,
  AudioAdminMetrics,
  AudioQuality,
  Tier,
} from "@/lib/api";
import s from "./admin.module.css";

type Tab = "invitations" | "users" | "templates" | "audio";

export function AdminPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("invitations");

  if (user?.role !== "admin") {
    return <Navigate to="/prompts" replace />;
  }

  return (
    <Shell>
      <h1 className={s.title}>{t("admin.title")}</h1>
      <p className={s.subtitle}>{t("admin.subtitle")}</p>
      <div className={s.tabs}>
        <button
          type="button"
          className={`${s.tab} ${tab === "invitations" ? s.tabActive : ""}`}
          onClick={() => setTab("invitations")}
        >
          {t("admin.invitations")}
        </button>
        <button
          type="button"
          className={`${s.tab} ${tab === "users" ? s.tabActive : ""}`}
          onClick={() => setTab("users")}
        >
          {t("admin.users")}
        </button>
        <button
          type="button"
          className={`${s.tab} ${tab === "templates" ? s.tabActive : ""}`}
          onClick={() => setTab("templates")}
        >
          {t("admin.templates")}
        </button>
        <button
          type="button"
          className={`${s.tab} ${tab === "audio" ? s.tabActive : ""}`}
          onClick={() => setTab("audio")}
        >
          {t("admin.audio_tab")}
        </button>
      </div>

      {tab === "invitations" && <InvitationsTab />}
      {tab === "users" && <UsersTab />}
      {tab === "templates" && <TemplatesTab />}
      {tab === "audio" && <AudioTab />}
    </Shell>
  );
}

function InvitationsTab() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [inviteTier, setInviteTier] = useState<Tier>("participant");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    loadInvitations();
  }, []);

  async function loadInvitations() {
    const res = await api.getInvitations();
    if (res.data) setInvitations(res.data.invitations);
    setLoading(false);
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    setResult(null);

    const res = await api.sendInvitation(email.trim(), inviteTier);
    if (res.error) {
      setResult({ type: "error", message: res.error.error });
    } else {
      const emailNote = res.data.email_sent
        ? t("admin.invite_sent")
        : t("admin.invite_created_no_email");
      setResult({ type: "success", message: emailNote });
      setEmail("");
      loadInvitations();
    }
    setSending(false);
  }

  function copyLink(token: string, id: string) {
    const link = `${window.location.origin}/register?token=${token}`;
    navigator.clipboard.writeText(link);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function invitationStatus(inv: Invitation): string {
    if (inv.status === "accepted") return "accepted";
    if (new Date(inv.expires_at) < new Date()) return "expired";
    return "pending";
  }

  const statusClass: Record<string, string> = {
    pending: s.statusPending,
    accepted: s.statusAccepted,
    expired: s.statusExpired,
  };

  if (loading) {
    return (
      <div className={s.empty}>
        <Spinner size={24} />
      </div>
    );
  }

  return (
    <Card>
      <form className={s.inviteForm} onSubmit={handleSend}>
        <div className={s.inviteInput}>
          <Input
            label={t("admin.invite_email_label")}
            type="email"
            placeholder="enseignant@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <label className={s.tierSelect}>
          {t("admin.tier")}
          <select
            value={inviteTier}
            onChange={(e) => setInviteTier(e.target.value as Tier)}
          >
            <option value="participant">{t("admin.tier_participant")}</option>
            <option value="free">{t("admin.tier_free")}</option>
          </select>
        </label>
        <Button variant="primary" type="submit" disabled={sending}>
          {sending ? <Spinner size={16} /> : t("admin.send_invite")}
        </Button>
      </form>

      {result && (
        <div className={`${s.inviteResult} ${result.type === "success" ? s.inviteSuccess : s.inviteError}`}>
          {result.message}
        </div>
      )}

      {invitations.length === 0 ? (
        <p className={s.empty}>{t("admin.no_invitations")}</p>
      ) : (
        <table className={s.table}>
          <thead>
            <tr>
              <th>{t("auth.email")}</th>
              <th>{t("admin.status")}</th>
              <th>{t("admin.tier")}</th>
              <th>{t("admin.kind")}</th>
              <th>{t("admin.date")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invitations.map((inv) => {
              const status = invitationStatus(inv);
              return (
                <tr key={inv.id}>
                  <td>{inv.email}</td>
                  <td>
                    <span className={`${s.statusBadge} ${statusClass[status]}`}>
                      {t(`admin.status_${status}`)}
                    </span>
                  </td>
                  <td>{t(`admin.tier_${inv.tier}`)}</td>
                  <td>{t(`admin.kind_${inv.kind}`)}</td>
                  <td>{formatDate(inv.created_at)}</td>
                  <td>
                    {status === "pending" && (
                      <button
                        type="button"
                        className={s.copyBtn}
                        onClick={() => copyLink(inv.token, inv.id)}
                      >
                        {copiedId === inv.id ? t("common.copied") : t("admin.copy_link")}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function UsersTab() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    const res = await api.getUsers();
    if (res.data) setUsers(res.data.users);
    setLoading(false);
  }

  async function toggleActive(user: AdminUser) {
    setTogglingId(user.id);
    if (user.is_active) {
      await api.deactivateUser(user.id);
    } else {
      await api.reactivateUser(user.id);
    }
    await loadUsers();
    setTogglingId(null);
  }

  async function toggleTier(user: AdminUser) {
    setTogglingId(user.id);
    await api.setUserTier(user.id, user.tier === "free" ? "participant" : "free");
    await loadUsers();
    setTogglingId(null);
  }

  if (loading) {
    return (
      <div className={s.empty}>
        <Spinner size={24} />
      </div>
    );
  }

  return (
    <Card>
      {users.length === 0 ? (
        <p className={s.empty}>{t("admin.no_users")}</p>
      ) : (
        <table className={s.table}>
          <thead>
            <tr>
              <th>{t("auth.name")}</th>
              <th>{t("auth.email")}</th>
              <th>{t("admin.role")}</th>
              <th>{t("admin.tier")}</th>
              <th>{t("admin.status")}</th>
              <th>{t("admin.date")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td>{t(`admin.tier_${u.tier}`)}</td>
                <td>
                  <span
                    className={`${s.statusBadge} ${u.is_active ? s.statusActive : s.statusInactive}`}
                  >
                    {u.is_active ? t("admin.active") : t("admin.inactive")}
                  </span>
                </td>
                <td>{formatDate(u.created_at)}</td>
                <td className={s.rowActions}>
                  {u.id !== currentUser?.id && (
                    <>
                      <Button
                        variant="secondary"
                        size="small"
                        disabled={togglingId === u.id}
                        onClick={() => toggleTier(u)}
                      >
                        {togglingId === u.id ? (
                          <Spinner size={14} />
                        ) : u.tier === "free" ? (
                          t("admin.promote_participant")
                        ) : (
                          t("admin.demote_free")
                        )}
                      </Button>
                      <Button
                        variant={u.is_active ? "danger" : "secondary"}
                        size="small"
                        disabled={togglingId === u.id}
                        onClick={() => toggleActive(u)}
                      >
                        {togglingId === u.id ? (
                          <Spinner size={14} />
                        ) : u.is_active ? (
                          t("admin.deactivate")
                        ) : (
                          t("admin.reactivate")
                        )}
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function TemplatesTab() {
  const [templates, setTemplates] = useState<AdminTemplate[]>([]);
  const [submissions, setSubmissions] = useState<AdminTemplateSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [promptId, setPromptId] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [unpublishingId, setUnpublishingId] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    const [templatesRes, submissionsRes] = await Promise.all([
      api.getAdminTemplates(),
      api.getAdminTemplateSubmissions(),
    ]);
    if (templatesRes.data) setTemplates(templatesRes.data.templates);
    if (submissionsRes.data) setSubmissions(submissionsRes.data.submissions);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  async function handlePublish(e: FormEvent) {
    e.preventDefault();
    const id = promptId.trim();
    if (!id) return;
    setPublishing(true);
    setResult(null);

    const res = await api.publishTemplate(id);
    if (res.error) {
      setResult({ type: "error", message: res.error.error });
    } else {
      setResult({ type: "success", message: t("admin.publish_template") });
      setPromptId("");
      loadTemplates();
    }
    setPublishing(false);
  }

  async function handleUnpublish(id: string) {
    setUnpublishingId(id);
    await api.unpublishTemplate(id);
    setTemplates((prev) => prev.filter((tpl) => tpl.id !== id));
    setUnpublishingId(null);
  }

  async function handleApprove(id: string) {
    setReviewingId(id);
    const res = await api.approveTemplateSubmission(id);
    if (res.error) {
      setResult({ type: "error", message: res.error.error });
    } else {
      setResult({ type: "success", message: t("admin.submission_approved") });
      await loadTemplates();
    }
    setReviewingId(null);
  }

  async function handleReject(id: string) {
    setReviewingId(id);
    const res = await api.rejectTemplateSubmission(id);
    if (res.error) {
      setResult({ type: "error", message: res.error.error });
    } else {
      setResult({ type: "success", message: t("admin.submission_rejected") });
      await loadTemplates();
    }
    setReviewingId(null);
  }

  if (loading) {
    return (
      <div className={s.empty}>
        <Spinner size={24} />
      </div>
    );
  }

  return (
    <Card>
      <form className={s.inviteForm} onSubmit={handlePublish}>
        <div className={s.inviteInput}>
          <Input
            label={t("admin.prompt_id_label")}
            type="text"
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            value={promptId}
            onChange={(e) => setPromptId(e.target.value)}
            required
          />
        </div>
        <Button variant="primary" type="submit" disabled={publishing}>
          {publishing ? <Spinner size={16} /> : t("admin.publish")}
        </Button>
      </form>

      {result && (
        <div className={`${s.inviteResult} ${result.type === "success" ? s.inviteSuccess : s.inviteError}`}>
          {result.message}
        </div>
      )}

      <h3 className={s.sectionTitle}>{t("admin.pending_submissions")}</h3>
      {submissions.length === 0 ? (
        <p className={s.empty}>{t("admin.no_pending_submissions")}</p>
      ) : (
        <table className={s.table}>
          <thead>
            <tr>
              <th>{t("auth.name")}</th>
              <th>{t("auth.email")}</th>
              <th>{t("admin.date")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {submissions.map((submission) => (
              <tr key={submission.id}>
                <td>{submission.name}</td>
                <td>{submission.author_name}</td>
                <td>{formatDate(submission.updated_at)}</td>
                <td className={s.rowActions}>
                  <Button
                    variant="primary"
                    size="small"
                    disabled={reviewingId === submission.id}
                    onClick={() => handleApprove(submission.id)}
                  >
                    {reviewingId === submission.id ? <Spinner size={14} /> : t("admin.approve")}
                  </Button>
                  <Button
                    variant="danger"
                    size="small"
                    disabled={reviewingId === submission.id}
                    onClick={() => handleReject(submission.id)}
                  >
                    {reviewingId === submission.id ? <Spinner size={14} /> : t("admin.reject")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className={s.sectionTitle}>{t("admin.published_templates")}</h3>
      {templates.length === 0 ? (
        <p className={s.empty}>{t("admin.no_templates")}</p>
      ) : (
        <table className={s.table}>
          <thead>
            <tr>
              <th>{t("auth.name")}</th>
              <th>{t("auth.email")}</th>
              <th>{t("admin.date")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {templates.map((tpl) => (
              <tr key={tpl.id}>
                <td>{tpl.name}</td>
                <td>{tpl.author_name}</td>
                <td>{formatDate(tpl.updated_at)}</td>
                <td>
                  <Button
                    variant="danger"
                    size="small"
                    disabled={unpublishingId === tpl.id}
                    onClick={() => handleUnpublish(tpl.id)}
                  >
                    {unpublishingId === tpl.id ? (
                      <Spinner size={14} />
                    ) : (
                      t("admin.unpublish_template")
                    )}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

const GO_NO_GO_FAILURE_MAX = 0.05;
const GO_NO_GO_FINAL_COST_PER_HOUR_MAX_USD = 3.6;
const QUALITY_KEYS: AudioQuality[] = ["draft", "final"];

function qualityLabel(quality: AudioQuality | "overall"): string {
  if (quality === "overall") return t("admin.audio_overall");
  return t(`audio.${quality}`);
}

function AudioTab() {
  const lang = getLanguage();
  const [metrics, setMetrics] = useState<AudioAdminMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [grantMinutes, setGrantMinutes] = useState<Record<string, string>>({});
  const [grantingId, setGrantingId] = useState<string | null>(null);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const loadMetrics = useCallback(async () => {
    const res = await api.getAudioAdminMetrics();
    if (res.data) setMetrics(res.data.metrics);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  function formatPercent(rate: number | null): string {
    if (rate === null) return t("admin.audio_no_data");
    return `${(rate * 100).toLocaleString(lang, { maximumFractionDigits: 1 })} %`;
  }

  function formatUsd(value: number | null, digits = 2): string {
    if (value === null) return t("admin.audio_no_data");
    return value.toLocaleString(lang === "fr" ? "fr-FR" : "en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function formatSeconds(seconds: number): string {
    const safe = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(safe / 60);
    const rest = safe % 60;
    if (minutes === 0) return `${rest} s`;
    return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
  }

  function formatSpeed(msPerAudioSecond: number | null): string {
    if (msPerAudioSecond === null) return t("admin.audio_no_data");
    return t("admin.audio_speed_value", {
      seconds: (msPerAudioSecond / 1000).toLocaleString(lang, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    });
  }

  function thresholdStatus(pass: boolean | null): ReactElement | null {
    if (pass === null) return null;
    return (
      <span className={`${s.statusBadge} ${pass ? s.statusActive : s.statusInactive}`}>
        {pass ? "GO" : "NO-GO"}
      </span>
    );
  }

  async function handleGrant(userId: string, email: string) {
    const minutes = Number.parseInt(grantMinutes[userId] ?? "", 10);
    if (!Number.isInteger(minutes) || minutes <= 0) return;
    setGrantingId(userId);
    setResult(null);

    const res = await api.grantAudioCredits(userId, minutes * 60);
    if (res.error) {
      setResult({ type: "error", message: res.error.error });
    } else {
      setResult({ type: "success", message: t("admin.audio_grant_success", { email }) });
      setGrantMinutes((prev) => ({ ...prev, [userId]: "" }));
      await loadMetrics();
    }
    setGrantingId(null);
  }

  if (loading || !metrics) {
    return (
      <div className={s.empty}>
        <Spinner size={24} />
      </div>
    );
  }

  const failureRate = metrics.jobs.overall.failureRate;
  const finalCostPerHour = metrics.cost.costPerGeneratedHourUsd.final;

  return (
    <>
      <Card>
        <h3 className={s.sectionTitle}>{t("admin.audio_go_no_go_title")}</h3>
        <table className={s.table}>
          <thead>
            <tr>
              <th>{t("admin.audio_gng_metric")}</th>
              <th>{t("admin.audio_gng_threshold")}</th>
              <th>{t("admin.audio_gng_live")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t("admin.audio_gng_failure")}</td>
              <td>{t("admin.audio_gng_failure_threshold")}</td>
              <td>{formatPercent(failureRate)}</td>
              <td>{thresholdStatus(failureRate === null ? null : failureRate < GO_NO_GO_FAILURE_MAX)}</td>
            </tr>
            <tr>
              <td>{t("admin.audio_gng_cost")}</td>
              <td>{t("admin.audio_gng_cost_threshold")}</td>
              <td>{formatUsd(finalCostPerHour)}</td>
              <td>
                {thresholdStatus(
                  finalCostPerHour === null ? null : finalCostPerHour < GO_NO_GO_FINAL_COST_PER_HOUR_MAX_USD
                )}
              </td>
            </tr>
            <tr>
              <td>{t("admin.audio_gng_quality")}</td>
              <td>—</td>
              <td className={s.gngNote}>{t("admin.audio_gng_quality_note")}</td>
              <td></td>
            </tr>
            <tr>
              <td>{t("admin.audio_gng_median")}</td>
              <td>{t("admin.audio_gng_median_threshold")}</td>
              <td className={s.gngNote}>{t("admin.audio_gng_median_note")}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </Card>

      <Card>
        <h3 className={s.sectionTitle}>{t("admin.audio_reliability_title")}</h3>
        <table className={s.table}>
          <thead>
            <tr>
              <th>{t("audio.quality")}</th>
              <th>{t("admin.audio_jobs_total")}</th>
              <th>{t("admin.audio_jobs_ready")}</th>
              <th>{t("admin.audio_jobs_failed")}</th>
              <th>{t("admin.audio_jobs_active")}</th>
              <th>{t("admin.audio_failure_rate")}</th>
            </tr>
          </thead>
          <tbody>
            {(["draft", "final", "overall"] as const).map((quality) => (
              <tr key={quality}>
                <td>{qualityLabel(quality)}</td>
                <td>{metrics.jobs[quality].total}</td>
                <td>{metrics.jobs[quality].ready}</td>
                <td>{metrics.jobs[quality].failed}</td>
                <td>{metrics.jobs[quality].active}</td>
                <td>{formatPercent(metrics.jobs[quality].failureRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <h3 className={s.sectionTitle}>{t("admin.audio_speed_title")}</h3>
        <p className={s.subtitle}>{t("admin.audio_speed_desc")}</p>
        <table className={s.table}>
          <tbody>
            {QUALITY_KEYS.map((quality) => (
              <tr key={quality}>
                <td>{qualityLabel(quality)}</td>
                <td>{formatSpeed(metrics.speed[quality].medianMsPerAudioSecond)}</td>
                <td className={s.gngNote}>
                  {t("admin.audio_speed_samples", { count: String(metrics.speed[quality].sampleCount) })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <h3 className={s.sectionTitle}>{t("admin.audio_cost_title")}</h3>
        <table className={s.table}>
          <tbody>
            <tr>
              <td>{t("admin.audio_cumulative_cost")}</td>
              <td>{formatUsd(metrics.cost.cumulativeApiCostUsd, 4)}</td>
            </tr>
            <tr>
              <td>{t("admin.audio_charged_time")}</td>
              <td>{formatSeconds(metrics.cost.chargedSeconds)}</td>
            </tr>
            {QUALITY_KEYS.map((quality) => (
              <tr key={quality}>
                <td>
                  {t("admin.audio_cost_per_hour")} — {qualityLabel(quality)}
                </td>
                <td>{formatUsd(metrics.cost.costPerGeneratedHourUsd[quality])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <h3 className={s.sectionTitle}>{t("admin.audio_users_title")}</h3>
        {result && (
          <div className={`${s.inviteResult} ${result.type === "success" ? s.inviteSuccess : s.inviteError}`}>
            {result.message}
          </div>
        )}
        {metrics.users.length === 0 ? (
          <p className={s.empty}>{t("admin.audio_no_users")}</p>
        ) : (
          <table className={s.table}>
            <thead>
              <tr>
                <th>{t("auth.name")}</th>
                <th>{t("auth.email")}</th>
                <th>{t("admin.audio_included_used")}</th>
                <th>{t("admin.audio_credits_used")}</th>
                <th>{t("admin.audio_credits_remaining")}</th>
                <th>{t("admin.audio_grant_minutes_label")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {metrics.users.map((usage) => (
                <tr key={usage.userId}>
                  <td>{usage.name}</td>
                  <td>{usage.email}</td>
                  <td>{formatSeconds(usage.includedUsedMonth)}</td>
                  <td>{formatSeconds(usage.creditsUsed)}</td>
                  <td>{formatSeconds(usage.creditsRemaining)}</td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      className={s.grantInput}
                      aria-label={t("admin.audio_grant_minutes_label")}
                      value={grantMinutes[usage.userId] ?? ""}
                      onChange={(e) =>
                        setGrantMinutes((prev) => ({ ...prev, [usage.userId]: e.target.value }))
                      }
                    />
                  </td>
                  <td className={s.rowActions}>
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={
                        grantingId === usage.userId ||
                        !(Number.parseInt(grantMinutes[usage.userId] ?? "", 10) > 0)
                      }
                      onClick={() => handleGrant(usage.userId, usage.email)}
                    >
                      {grantingId === usage.userId ? <Spinner size={14} /> : t("admin.audio_grant")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
