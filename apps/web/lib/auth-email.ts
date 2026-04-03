import nodemailer from "nodemailer";

function getAppUrl() {
  return process.env.APP_URL ?? "http://localhost:3000";
}

async function sendMail(subject: string, to: string, text: string) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM ?? "noreply@yehthatrocks.local";

  if (!host || !user || !pass) {
    console.log(`[auth-email] ${subject} -> ${to}\n${text}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
  });

  await transporter.sendMail({
    from,
    to,
    subject,
    text,
  });
}

export async function sendVerificationEmail(to: string, token: string) {
  const url = `${getAppUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  await sendMail("Verify your Yeh That Rocks account", to, `Verify your email: ${url}`);
}

export async function sendPasswordResetEmail(to: string, token: string) {
  const url = `${getAppUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  await sendMail("Reset your Yeh That Rocks password", to, `Reset your password: ${url}`);
}
