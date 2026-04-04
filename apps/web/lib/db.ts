import { PrismaClient } from "@prisma/client";

declare global {
  var __yehPrisma__: PrismaClient | undefined;
  var __yehPrismaShutdownHooks__: boolean | undefined;
}

function getPrismaDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    return databaseUrl;
  }

  try {
    const url = new URL(databaseUrl);
    const defaultConnectionLimit = process.env.NODE_ENV === "production" ? "8" : "2";
    const defaultPoolTimeout = process.env.NODE_ENV === "production" ? "20" : "10";

    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set(
        "connection_limit",
        process.env.PRISMA_CONNECTION_LIMIT ?? defaultConnectionLimit,
      );
    }

    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set(
        "pool_timeout",
        process.env.PRISMA_POOL_TIMEOUT ?? defaultPoolTimeout,
      );
    }

    return url.toString();
  } catch {
    return databaseUrl;
  }
}

export const prisma =
  global.__yehPrisma__ ??
  new PrismaClient({
    datasources: {
      db: {
        url: getPrismaDatabaseUrl(),
      },
    },
  });

if (!global.__yehPrismaShutdownHooks__) {
  const shutdown = async () => {
    try {
      await prisma.$disconnect();
    } catch {
      // Best-effort cleanup during process termination.
    }
  };

  process.once("beforeExit", shutdown);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  global.__yehPrismaShutdownHooks__ = true;
}

if (process.env.NODE_ENV !== "production") {
  global.__yehPrisma__ = prisma;
}
