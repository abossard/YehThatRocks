import { createHash, randomUUID } from "crypto";

import { prisma } from "@/lib/db";
import {
  REFRESH_TOKEN_TTL_REMEMBER_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
} from "@/lib/auth-config";

type AuthSessionDelegate = {
  create: (args: {
    data: {
      userId: number;
      familyId: string;
      tokenHash: string;
      remember: boolean;
      expiresAt: Date;
    };
  }) => Promise<unknown>;
  findUnique: (args: {
    where: {
      tokenHash: string;
    };
  }) => Promise<{
    id: number;
    userId: number;
    familyId: string;
    expiresAt: Date;
    revokedAt: Date | null;
    replacedByHash: string | null;
  } | null>;
  updateMany: (args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => Promise<unknown>;
  update: (args: {
    where: {
      id: number;
    };
    data: {
      revokedAt: Date;
      replacedByHash: string;
    };
  }) => Promise<unknown>;
};

type PrismaWithAuthSession = typeof prisma & {
  authSession: AuthSessionDelegate;
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function getAuthPrisma() {
  return prisma as PrismaWithAuthSession;
}

function getRefreshExpiry(remember: boolean) {
  const seconds = remember ? REFRESH_TOKEN_TTL_REMEMBER_SECONDS : REFRESH_TOKEN_TTL_SECONDS;
  return new Date(Date.now() + seconds * 1000);
}

export async function createRefreshSession(userId: number, refreshToken: string, remember: boolean) {
  await getAuthPrisma().authSession.create({
    data: {
      userId,
      familyId: randomUUID().replace(/-/g, ""),
      tokenHash: hashToken(refreshToken),
      remember,
      expiresAt: getRefreshExpiry(remember),
    },
  });
}

export async function rotateRefreshSession(userId: number, currentToken: string, nextToken: string, remember: boolean) {
  const currentHash = hashToken(currentToken);
  const nextHash = hashToken(nextToken);

  await prisma.$transaction(async (tx) => {
    const authTx = tx as typeof tx & { authSession: AuthSessionDelegate };
    const session = await authTx.authSession.findUnique({
      where: {
        tokenHash: currentHash,
      },
    });

    if (!session || session.userId !== userId) {
      throw new Error("Session not found");
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      throw new Error("Session expired");
    }

    if (session.revokedAt || session.replacedByHash) {
      await authTx.authSession.updateMany({
        where: {
          familyId: session.familyId,
        },
        data: {
          revokedAt: new Date(),
        },
      });
      throw new Error("Refresh token reuse detected");
    }

    await authTx.authSession.update({
      where: {
        id: session.id,
      },
      data: {
        revokedAt: new Date(),
        replacedByHash: nextHash,
      },
    });

    await authTx.authSession.create({
      data: {
        userId,
        familyId: session.familyId,
        tokenHash: nextHash,
        remember,
        expiresAt: getRefreshExpiry(remember),
      },
    });
  });
}

export async function revokeRefreshSession(refreshToken: string) {
  await getAuthPrisma().authSession.updateMany({
    where: {
      tokenHash: hashToken(refreshToken),
    },
    data: {
      revokedAt: new Date(),
    },
  });
}

export async function revokeUserRefreshSessions(userId: number) {
  await getAuthPrisma().authSession.updateMany({
    where: {
      userId,
    },
    data: {
      revokedAt: new Date(),
    },
  });
}
