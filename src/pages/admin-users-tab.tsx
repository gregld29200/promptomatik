import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/lib/auth/auth-context";
import { t } from "@/lib/i18n";
import { formatDate } from "@/lib/format-date";
import * as api from "@/lib/api";
import type { AdminUser } from "@/lib/api";
import s from "./admin.module.css";

export function UsersTab() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [accessLinkId, setAccessLinkId] = useState<string | null>(null);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);

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
    setResult(null);
    const nextTier = user.tier === "free" ? "participant" : "free";
    const res = await api.setUserTier(user.id, nextTier);
    if (res.error) {
      setResult({ type: "error", message: res.error.error });
    } else {
      setUsers((current) => current.map((u) => (u.id === user.id ? { ...u, tier: nextTier } : u)));
      setResult({
        type: "success",
        message: t("admin.tier_updated", { email: user.email, tier: t(`admin.tier_${nextTier}`) }),
      });
    }
    setTogglingId(null);
  }

  async function sendAccessLink(user: AdminUser) {
    setAccessLinkId(user.id);
    setResult(null);
    const res = await api.sendAccessLink(user.id);
    if (res.error) {
      setResult({ type: "error", message: res.error.error });
    } else {
      setResult({
        type: res.data.email_sent ? "success" : "error",
        message: t(res.data.email_sent ? "admin.access_link_sent" : "admin.access_link_not_sent"),
      });
    }
    setAccessLinkId(null);
  }

  if (loading) {
    return (
      <div className={s.empty}>
        <Spinner size={24} />
      </div>
    );
  }

  return (
    <Card className={s.tableCard}>
      {result && (
        <div
          role={result.type === "error" ? "alert" : "status"}
          className={`${s.inviteResult} ${result.type === "success" ? s.inviteSuccess : s.inviteError}`}
        >
          {result.message}
        </div>
      )}
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
                      {u.is_active && (
                        <Button
                          variant="secondary"
                          size="small"
                          disabled={accessLinkId === u.id}
                          onClick={() => sendAccessLink(u)}
                        >
                          {accessLinkId === u.id ? <Spinner size={14} /> : t("admin.access_link")}
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        size="small"
                        disabled={togglingId !== null}
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
                        disabled={togglingId !== null}
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
