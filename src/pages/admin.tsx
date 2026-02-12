import { useState, useEffect, useCallback, type FormEvent } from "react";
import { Navigate } from "react-router";
import { Shell } from "@/components/layout/shell";
import { Card, Button, Input, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth/auth-context";
import { t } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import * as api from "@/lib/api";
import type {
  Invitation,
  AdminUser,
  AdminTemplate,
  AdminTemplateSubmission,
} from "@/lib/api";
import s from "./admin.module.css";

type Tab = "invitations" | "users" | "templates";

export function AdminPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("invitations");

  if (user?.role !== "admin") {
    return <Navigate to="/dashboard" replace />;
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
      </div>

      {tab === "invitations" && <InvitationsTab />}
      {tab === "users" && <UsersTab />}
      {tab === "templates" && <TemplatesTab />}
    </Shell>
  );
}

function InvitationsTab() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
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

    const res = await api.sendInvitation(email.trim());
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
                <td>
                  <span
                    className={`${s.statusBadge} ${u.is_active ? s.statusActive : s.statusInactive}`}
                  >
                    {u.is_active ? t("admin.active") : t("admin.inactive")}
                  </span>
                </td>
                <td>{formatDate(u.created_at)}</td>
                <td>
                  {u.id !== currentUser?.id && (
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
