import fs from "node:fs/promises";
import os from "node:os";

import { NextRequest, NextResponse } from "next/server";

import { requireAdminApiAuth } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";

type NetworkSample = {
  ts: number;
  totalBytes: number;
};

let previousNetworkSample: NetworkSample | null = null;

type CpuSample = {
  ts: number;
  usageMicros: number;
};

let previousCpuSample: CpuSample | null = null;
const METRIC_SAMPLE_MS = Math.max(50, Number(process.env.ADMIN_METRIC_SAMPLE_MS || "200"));

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readLinuxNetworkTotalBytes() {
  if (process.platform !== "linux") {
    return null;
  }

  try {
    const raw = await fs.readFile("/proc/net/dev", "utf8");
    const lines = raw.split("\n").slice(2).map((line) => line.trim()).filter(Boolean);
    let totalRx = 0;
    let totalTx = 0;

    for (const line of lines) {
      const [ifaceWithColon, stats] = line.split(":");
      const iface = ifaceWithColon?.trim();
      if (!iface || iface === "lo") {
        continue;
      }

      const parts = stats.trim().split(/\s+/);
      const rx = Number(parts[0] ?? 0);
      const tx = Number(parts[8] ?? 0);
      if (Number.isFinite(rx)) {
        totalRx += rx;
      }
      if (Number.isFinite(tx)) {
        totalTx += tx;
      }
    }

    return totalRx + totalTx;
  } catch {
    return null;
  }
}

async function computeNetworkUsagePercent() {
  const totalBytes = await readLinuxNetworkTotalBytes();
  if (totalBytes === null) {
    return null;
  }

  const now = Date.now();
  const current: NetworkSample = { ts: now, totalBytes };
  const prev = previousNetworkSample;
  previousNetworkSample = current;

  if (!prev || now <= prev.ts || totalBytes < prev.totalBytes) {
    await sleep(METRIC_SAMPLE_MS);
    const sampledTotalBytes = await readLinuxNetworkTotalBytes();
    const sampledNow = Date.now();

    if (sampledTotalBytes === null || sampledNow <= now || sampledTotalBytes < totalBytes) {
      return null;
    }

    previousNetworkSample = { ts: sampledNow, totalBytes: sampledTotalBytes };
    const bytesPerSec = (sampledTotalBytes - totalBytes) / ((sampledNow - now) / 1000);
    const maxBytesPerSec = Number(process.env.ADMIN_NETWORK_DIAL_MAX_BYTES_PER_SEC || "12500000");
    if (!Number.isFinite(bytesPerSec) || !Number.isFinite(maxBytesPerSec) || maxBytesPerSec <= 0) {
      return null;
    }

    return Math.max(0, Math.min(100, (bytesPerSec / maxBytesPerSec) * 100));
  }

  const bytesPerSec = (totalBytes - prev.totalBytes) / ((now - prev.ts) / 1000);
  const maxBytesPerSec = Number(process.env.ADMIN_NETWORK_DIAL_MAX_BYTES_PER_SEC || "12500000");
  if (!Number.isFinite(bytesPerSec) || !Number.isFinite(maxBytesPerSec) || maxBytesPerSec <= 0) {
    return null;
  }

  return Math.max(0, Math.min(100, (bytesPerSec / maxBytesPerSec) * 100));
}

async function computeCpuUsagePercent() {
  const usage = process.cpuUsage();
  const usageMicros = usage.user + usage.system;
  const now = Date.now();
  const current: CpuSample = { ts: now, usageMicros };
  const prev = previousCpuSample;
  previousCpuSample = current;

  if (!prev || now <= prev.ts || usageMicros < prev.usageMicros) {
    const start = process.cpuUsage();
    const startTs = Date.now();
    await sleep(METRIC_SAMPLE_MS);
    const delta = process.cpuUsage(start);
    const elapsedMicros = Math.max(1, (Date.now() - startTs) * 1000);
    const cpuCount = Math.max(1, os.cpus().length);
    const percent = ((delta.user + delta.system) / elapsedMicros / cpuCount) * 100;
    if (!Number.isFinite(percent)) {
      return null;
    }

    previousCpuSample = { ts: Date.now(), usageMicros: process.cpuUsage().user + process.cpuUsage().system };
    return Math.max(0, Math.min(100, percent));
  }

  const elapsedMicros = (now - prev.ts) * 1000;
  const cpuCount = Math.max(1, os.cpus().length);
  const percent = ((usageMicros - prev.usageMicros) / elapsedMicros / cpuCount) * 100;
  if (!Number.isFinite(percent)) {
    return null;
  }

  return Math.max(0, Math.min(100, percent));
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminApiAuth(request);

  if (!auth.ok) {
    return auth.response;
  }

  const startedAt = Date.now();

  const cpuUsagePercent = await computeCpuUsagePercent();
  const networkUsagePercent = await computeNetworkUsagePercent();
  const memoryUsagePercent = Math.max(
    0,
    Math.min(
      100,
      ((os.totalmem() - os.freemem()) / Math.max(1, os.totalmem())) * 100,
    ),
  );

  const health = {
    nodeUptimeSec: Math.floor(process.uptime()),
    memory: {
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
    host: {
      platform: process.platform,
      loadAvg: os.loadavg(),
      totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
      freeMemMb: Math.round(os.freemem() / 1024 / 1024),
      cpuUsagePercent,
      memoryUsagePercent,
      networkUsagePercent,
    },
  };

  const [users, videos, artists, categories] = await Promise.all([
    prisma.user.count().catch(() => 0),
    prisma.video.count().catch(() => 0),
    prisma.artist.count().catch(() => 0),
    prisma.genreCard.count().catch(() => 0),
  ]);

  const locations = await prisma.$queryRaw<Array<{ location: string; count: bigint | number }>>`
    SELECT location, COUNT(*) AS count
    FROM users
    WHERE location IS NOT NULL
      AND TRIM(location) <> ''
    GROUP BY location
    ORDER BY COUNT(*) DESC
    LIMIT 20
  `.catch(() => []);

  const traffic = await prisma.$queryRaw<Array<{ day: Date; count: bigint | number }>>`
    SELECT DATE(created_at) AS day, COUNT(*) AS count
    FROM auth_audit_logs
    WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 14 DAY)
    GROUP BY DATE(created_at)
    ORDER BY day DESC
    LIMIT 14
  `.catch(() => []);

  return NextResponse.json({
    ok: true,
    meta: {
      durationMs: Date.now() - startedAt,
      generatedAt: new Date().toISOString(),
    },
    health,
    counts: {
      users,
      videos,
      artists,
      categories,
    },
    locations: locations.map((row) => ({
      location: row.location,
      count: typeof row.count === "bigint" ? Number(row.count) : Number(row.count ?? 0),
    })),
    traffic: traffic.map((row) => ({
      day: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day),
      count: typeof row.count === "bigint" ? Number(row.count) : Number(row.count ?? 0),
    })),
  });
}
