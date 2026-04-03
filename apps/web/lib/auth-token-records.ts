import { createHash, randomBytes } from "crypto";

import { prisma } from "@/lib/db";

type VerificationDelegate = {
  create: (args: { data: { userId: number; tokenHash: string; expiresAt: Date } }) => Promise<unknown>;
  findUnique: (args: { where: { tokenHash: string } }) => Promise<{
    id: number;
    userId: number;
    expiresAt: Date;
    consumedAt: Date | null;
  } | null>;
  updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<unknown>;
};

type PasswordResetDelegate = VerificationDelegate;

type UserDelegate = {
  update: (args: {
    where: { id: number };
    data: { emailVerifiedAt?: Date; passwordHash?: string; password?: null };
  }) => Promise<unknown>;
};

type PrismaWithTokenModels = typeof prisma & {
  emailVerificationToken: VerificationDelegate;
  passwordResetToken: PasswordResetDelegate;
  user: UserDelegate;
};

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function randomToken() {
  return randomBytes(32).toString("hex");
}

function db() {
  return prisma as PrismaWithTokenModels;
}

export async function createEmailVerificationToken(userId: number) {
  const token = randomToken();
  await db().emailVerificationToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
    },
  });
  return token;
}

export async function consumeEmailVerificationToken(token: string) {
  const tokenHash = hashToken(token);
  const record = await db().emailVerificationToken.findUnique({
    where: { tokenHash },
  });

  if (!record || record.consumedAt || record.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  await db().emailVerificationToken.updateMany({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });

  await db().user.update({
    where: { id: record.userId },
    data: { emailVerifiedAt: new Date() },
  });

  return record.userId;
}

export async function createPasswordResetToken(userId: number) {
  const token = randomToken();
  await db().passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    },
  });
  return token;
}

export async function consumePasswordResetToken(token: string) {
  const tokenHash = hashToken(token);
  const record = await db().passwordResetToken.findUnique({
    where: { tokenHash },
  });

  if (!record || record.consumedAt || record.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  await db().passwordResetToken.updateMany({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });

  return record.userId;
}
