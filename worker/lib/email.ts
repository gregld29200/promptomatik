import { type Language } from "./language";

interface InvitationEmailParams {
  to: string;
  inviterName: string;
  token: string;
  lang: Language;
  appBaseUrl?: string;
}

interface PasswordResetEmailParams {
  to: string;
  token: string;
  lang: Language;
  appBaseUrl?: string;
}

interface SignupConfirmationEmailParams {
  to: string;
  token: string;
  lang: Language;
  appBaseUrl?: string;
}

interface EmailResult {
  success: boolean;
  error?: string;
}

const APP_BASE_URL = "https://promptomatik.com";

const invitationSubjects: Record<Language, string> = {
  fr: "Vous êtes invité(e) sur TeachInspire Studio",
  en: "You're invited to TeachInspire Studio",
  es: "Estas invitado(a) a TeachInspire Studio",
};

const resetSubjects: Record<Language, string> = {
  fr: "Réinitialisation de mot de passe TeachInspire Studio",
  en: "TeachInspire Studio password reset",
  es: "Restablecimiento de contrasena de TeachInspire Studio",
};

const signupSubjects: Record<Language, string> = {
  fr: "Confirmez votre accès gratuit à TeachInspire Studio",
  en: "Confirm your free TeachInspire Studio access",
  es: "Confirma tu acceso gratuito a TeachInspire Studio",
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
  <h2 style="margin-bottom: 8px;">TeachInspire Studio</h2>
  <p>${params.inviterName} vous invite à rejoindre <strong>TeachInspire Studio</strong>, l'outil de création de prompts pour enseignants.</p>
  <p>Utilisez ce lien de connexion pour créer votre mot de passe.</p>
  <p>
    <a href="${link}" style="display: inline-block; padding: 12px 24px; background-color: #c8a951; color: #1a2744; text-decoration: none; font-weight: bold;">
      Ouvrir le lien de connexion
    </a>
  </p>
  <p style="font-size: 13px; color: #666;">Ce lien expire dans 7 jours.</p>
</body>
</html>`.trim();
  }

  if (params.lang === "es") {
    return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; color: #1a2744; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="margin-bottom: 8px;">TeachInspire Studio</h2>
  <p>${params.inviterName} te ha invitado a unirte a <strong>TeachInspire Studio</strong>, la herramienta de creacion de prompts para docentes.</p>
  <p>Usa este enlace de acceso para crear tu contrasena.</p>
  <p>
    <a href="${link}" style="display: inline-block; padding: 12px 24px; background-color: #c8a951; color: #1a2744; text-decoration: none; font-weight: bold;">
      Abrir enlace de acceso
    </a>
  </p>
  <p style="font-size: 13px; color: #666;">Este enlace caduca en 7 dias.</p>
</body>
</html>`.trim();
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; color: #1a2744; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="margin-bottom: 8px;">TeachInspire Studio</h2>
  <p>${params.inviterName} has invited you to join <strong>TeachInspire Studio</strong>, the prompt-building tool for teachers.</p>
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
  <h2 style="margin-bottom: 8px;">TeachInspire Studio</h2>
  <p>Vous avez demandé une réinitialisation de mot de passe.</p>
  <p>
    <a href="${link}" style="display: inline-block; padding: 12px 24px; background-color: #c8a951; color: #1a2744; text-decoration: none; font-weight: bold;">
      Réinitialiser mon mot de passe
    </a>
  </p>
  <p style="font-size: 13px; color: #666;">Ce lien expire dans 1 heure.</p>
</body>
</html>`.trim();
  }

  if (params.lang === "es") {
    return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; color: #1a2744; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="margin-bottom: 8px;">TeachInspire Studio</h2>
  <p>Has solicitado restablecer tu contrasena.</p>
  <p>
    <a href="${link}" style="display: inline-block; padding: 12px 24px; background-color: #c8a951; color: #1a2744; text-decoration: none; font-weight: bold;">
      Restablecer mi contrasena
    </a>
  </p>
  <p style="font-size: 13px; color: #666;">Este enlace caduca en 1 hora.</p>
</body>
</html>`.trim();
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; color: #1a2744; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="margin-bottom: 8px;">TeachInspire Studio</h2>
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

function buildSignupHtml(params: SignupConfirmationEmailParams): string {
  const baseUrl = params.appBaseUrl || APP_BASE_URL;
  const link = `${baseUrl}/register?token=${params.token}`;

  if (params.lang === "fr") {
    return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; color: #1a2744; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="margin-bottom: 8px;">TeachInspire Studio</h2>
  <p>Bienvenue ! Confirmez votre adresse email pour activer votre accès gratuit à <strong>TeachInspire Studio</strong>, l'outil de création de prompts pour enseignants.</p>
  <p>
    <a href="${link}" style="display: inline-block; padding: 12px 24px; background-color: #c8a951; color: #1a2744; text-decoration: none; font-weight: bold;">
      Activer mon accès gratuit
    </a>
  </p>
  <p style="font-size: 13px; color: #666;">Ce lien expire dans 7 jours. Si vous n'avez pas demandé cet accès, ignorez cet email.</p>
</body>
</html>`.trim();
  }

  if (params.lang === "es") {
    return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; color: #1a2744; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="margin-bottom: 8px;">TeachInspire Studio</h2>
  <p>Bienvenido(a)! Confirma tu direccion de email para activar tu acceso gratuito a <strong>TeachInspire Studio</strong>, la herramienta de creacion de prompts para docentes.</p>
  <p>
    <a href="${link}" style="display: inline-block; padding: 12px 24px; background-color: #c8a951; color: #1a2744; text-decoration: none; font-weight: bold;">
      Activar mi acceso gratuito
    </a>
  </p>
  <p style="font-size: 13px; color: #666;">Este enlace caduca en 7 dias. Si no solicitaste este acceso, ignora este email.</p>
</body>
</html>`.trim();
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; color: #1a2744; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="margin-bottom: 8px;">TeachInspire Studio</h2>
  <p>Welcome! Confirm your email address to activate your free access to <strong>TeachInspire Studio</strong>, the prompt-building tool for teachers.</p>
  <p>
    <a href="${link}" style="display: inline-block; padding: 12px 24px; background-color: #c8a951; color: #1a2744; text-decoration: none; font-weight: bold;">
      Activate my free access
    </a>
  </p>
  <p style="font-size: 13px; color: #666;">This link expires in 7 days. If you didn't request this access, you can ignore this email.</p>
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
      from: "TeachInspire Studio <noreply@promptomatik.com>",
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

export async function sendSignupConfirmationEmail(
  apiKey: string,
  params: SignupConfirmationEmailParams
): Promise<EmailResult> {
  try {
    return await sendEmail(
      apiKey,
      params.to,
      signupSubjects[params.lang],
      buildSignupHtml(params)
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
