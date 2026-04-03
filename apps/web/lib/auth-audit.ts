import { prisma } from "@/lib/db";

import { hasDatabaseUrl } from "@/lib/catalog-data";

type PrismaWithAuthAudit = typeof prisma & {
  authAuditLog: {
    create: (args: {
      data: {
        action: string;
        success: boolean;
        email: string | null;
        userId: number | null;
        ipAddress: string | null;
        userAgent: string | null;
        detail: string | null;
      };
    }) => Promise<unknown>;
  };
};

type AuthAuditInput = {
  action: "register" | "login" | "refresh" | "logout" | "forgot-password" | "reset-password" | "verify-email";
  success: boolean;
  email?: string | null;
  userId?: number | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  detail?: string | null;
};

export async function recordAuthAudit(input: AuthAuditInput) {
  if (!hasDatabaseUrl()) {
    return;
  }

  try {
    await (prisma as PrismaWithAuthAudit).authAuditLog.create({
      data: {
        action: input.action,
        success: input.success,
        email: input.email ?? null,
        userId: input.userId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        detail: input.detail ?? null,
      },
    });
  } catch {
    // Auth audit should never block the request path.
  }
}

export function getRequestMetadata(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for");
  const ipAddress = forwarded?.split(",")[0]?.trim() ?? headers.get("x-real-ip") ?? null;
  const userAgent = headers.get("user-agent");

  return {
    ipAddress,
    userAgent,
  };
}
