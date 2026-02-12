interface InvitationEmailParams {
  to: string;
  inviterName: string;
  token: string;
  lang: "fr" | "en";
  appBaseUrl?: string;
}

interface PasswordResetEmailParams {
  to: string;
  token: string;
  lang: "fr" | "en";
  appBaseUrl?: string;
}

interface EmailResult {
  success: boolean;
  error?: string;
}

const APP_BASE_URL = "https://promptomatik.com";

const invitationSubjects: Record<"fr" | "en", string> = {
  fr: "Vous etes invite(e) sur Promptomatik",
  en: "You're invited to Promptomatik",
};

const resetSubjects: Record<"fr" | "en", string> = {
  fr: "Reinitialisation de mot de passe Promptomatik",
  en: "Promptomatik password reset",
};

function buildHtml(params: InvitationEmailParams): string {
  const baseUrl = params.appBaseUrl || APP_BASE_URL;
  const link = `${baseUrl}/register?token=${params.token}`;

  if (params.lang === "fr") {
    return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; color: #1a2744; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="margin-bottom: 8px;">Promptomatik</h2>
  <p>${params.inviterName} vous invite a rejoindre <strong>Promptomatik</strong>, l'outil de creation de prompts pour enseignants.</p>
  <p>Utilisez ce lien de connexion pour creer votre mot de passe.</p>
  <p>
    <a href="${link}" style="display: inline-block; padding: 12px 24px; background-color: #c8a951; color: #1a2744; text-decoration: none; font-weight: bold;">
      Ouvrir le lien de connexion
    </a>
  </p>
  <p style="font-size: 13px; color: #666;">Ce lien expire dans 7 jours.</p>
</body>
</html>`.trim();
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; color: #1a2744; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="margin-bottom: 8px;">Promptomatik</h2>
  <p>${params.inviterName} has invited you to join <strong>Promptomatik</strong>, the prompt-building tool for teachers.</p>
  <p>Use this login link to create your password.</p>
  <p>
    <a href="${link}" style="display: inline-block; padding: 12px 24px; background-color: #c8a951; color: #1a2744; text-decoration: none; font-weight: bold;">
      Open login link
    </a>
  </p>
  <p style="font-size: 13px; color: #666;">This link expires in 7 days.</p>
</body>
</html>`.trim();
}

function buildResetHtml(params: PasswordResetEmailParams): string {
  const baseUrl = params.appBaseUrl || APP_BASE_URL;
  const link = `${baseUrl}/reset-password?token=${params.token}`;

  if (params.lang === "fr") {
    return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; color: #1a2744; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="margin-bottom: 8px;">Promptomatik</h2>
  <p>Vous avez demande une reinitialisation de mot de passe.</p>
  <p>
    <a href="${link}" style="display: inline-block; padding: 12px 24px; background-color: #c8a951; color: #1a2744; text-decoration: none; font-weight: bold;">
      Reinitialiser mon mot de passe
    </a>
  </p>
  <p style="font-size: 13px; color: #666;">Ce lien expire dans 1 heure.</p>
</body>
</html>`.trim();
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; color: #1a2744; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="margin-bottom: 8px;">Promptomatik</h2>
  <p>You requested a password reset.</p>
  <p>
    <a href="${link}" style="display: inline-block; padding: 12px 24px; background-color: #c8a951; color: #1a2744; text-decoration: none; font-weight: bold;">
      Reset my password
    </a>
  </p>
  <p style="font-size: 13px; color: #666;">This link expires in 1 hour.</p>
</body>
</html>`.trim();
}

async function sendEmail(
  apiKey: string,
  to: string,
  subject: string,
  html: string
): Promise<EmailResult> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Promptomatik <noreply@promptomatik.com>",
      to: [to],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return {
      success: false,
      error: (body as { message?: string }).message ?? `Resend error ${res.status}`,
    };
  }

  return { success: true };
}

export async function sendInvitationEmail(
  apiKey: string,
  params: InvitationEmailParams
): Promise<EmailResult> {
  try {
    return await sendEmail(
      apiKey,
      params.to,
      invitationSubjects[params.lang],
      buildHtml(params)
    );
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Email send failed",
    };
  }
}

export async function sendPasswordResetEmail(
  apiKey: string,
  params: PasswordResetEmailParams
): Promise<EmailResult> {
  try {
    return await sendEmail(
      apiKey,
      params.to,
      resetSubjects[params.lang],
      buildResetHtml(params)
    );
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Email send failed",
    };
  }
}
