import { PrismaClient } from "@prisma/client";

declare global {
  var __yehPrisma__: PrismaClient | undefined;
}

export const prisma = global.__yehPrisma__ ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__yehPrisma__ = prisma;
}
