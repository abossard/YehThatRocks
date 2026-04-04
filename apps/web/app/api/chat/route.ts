import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireApiAuth } from "@/lib/auth-request";
import { chatChannel, chatEvents } from "@/lib/chat-events";
import { prisma } from "@/lib/db";
import { parseRequestJson } from "@/lib/request-json";

const chatQuerySchema = z.object({
  mode: z.enum(["global", "video", "online"]).default("global"),
  videoId: z.string().trim().min(1).max(32).optional(),
});

const createChatMessageSchema = z.object({
  mode: z.enum(["global", "video"]),
  videoId: z.string().trim().min(1).max(32).optional(),
  content: z.string().trim().min(1).max(200),
});

type ChatMessageRow = {
  id: number;
  userId: number | null;
  content: string;
  createdAt: Date | null;
  room: string | null;
  videoId: string | null;
};

type MessageColumnMap = {
  id: string;
  userId: string;
  room: string;
  videoId: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
};

type OnlineColumnMap = {
  userId: string;
  lastSeen: string;
  lastSeenType: "epoch" | "datetime";
  createdAt?: string;
  updatedAt?: string;
};

type OnlinePresenceRow = {
  userId: number | null;
  lastSeen: number | Date | null;
};

let cachedMessageColumns: MessageColumnMap | null = null;
let cachedOnlineColumns: OnlineColumnMap | null = null;

function escapeIdentifier(identifier: string) {
  return `\`${identifier.replace(/`/g, "``")}\``;
}

function getFirstAvailableColumn(available: Set<string>, candidates: string[]) {
  for (const candidate of candidates) {
    if (available.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function getMessageColumns() {
  if (cachedMessageColumns) {
    return cachedMessageColumns;
  }

  const columns = await prisma.$queryRawUnsafe<Array<{ Field: string }>>("SHOW COLUMNS FROM messages");
  const available = new Set(columns.map((column) => column.Field));

  const resolved: MessageColumnMap = {
    id: getFirstAvailableColumn(available, ["id"]) || "id",
    userId: getFirstAvailableColumn(available, ["user_id", "userid"]) || "userid",
    room: getFirstAvailableColumn(available, ["room", "type"]) || "type",
    videoId: getFirstAvailableColumn(available, ["video_id", "videoId"]) || "videoId",
    content: getFirstAvailableColumn(available, ["content", "message"]) || "message",
    createdAt: getFirstAvailableColumn(available, ["created_at", "createdAt"]) || "createdAt",
    updatedAt: getFirstAvailableColumn(available, ["updated_at", "updatedAt"]) || undefined,
  };

  cachedMessageColumns = resolved;
  return resolved;
}

async function getOnlineColumns() {
  if (cachedOnlineColumns) {
    return cachedOnlineColumns;
  }

  const columns = await prisma.$queryRawUnsafe<Array<{ Field: string; Type: string }>>("SHOW COLUMNS FROM online");
  const available = new Set(columns.map((column) => column.Field));
  const typeByField = new Map(columns.map((column) => [column.Field, column.Type.toLowerCase()]));

  const lastSeenColumn = getFirstAvailableColumn(available, ["last_seen", "lastSeen"]) || "lastSeen";
  const lastSeenTypeRaw = typeByField.get(lastSeenColumn) ?? "";
  const lastSeenType = /(date|time|timestamp)/i.test(lastSeenTypeRaw) ? "datetime" : "epoch";

  const resolved: OnlineColumnMap = {
    userId: getFirstAvailableColumn(available, ["user_id", "userid", "userId"]) || "userId",
    lastSeen: lastSeenColumn,
    lastSeenType,
    createdAt: getFirstAvailableColumn(available, ["created_at", "createdAt"]) || undefined,
    updatedAt: getFirstAvailableColumn(available, ["updated_at", "updatedAt"]) || undefined,
  };

  cachedOnlineColumns = resolved;
  return resolved;
}

async function touchOnlinePresence(userId: number) {
  const columns = await getOnlineColumns();
  const userIdCol = escapeIdentifier(columns.userId);
  const lastSeenCol = escapeIdentifier(columns.lastSeen);
  const nowExpr = columns.lastSeenType === "datetime" ? "UTC_TIMESTAMP(3)" : "UNIX_TIMESTAMP(UTC_TIMESTAMP())";

  const existing = await prisma.$queryRawUnsafe<Array<{ marker: number }>>(
    `
      SELECT 1 AS marker
      FROM online o
      WHERE o.${userIdCol} = ?
      LIMIT 1
    `,
    userId,
  );

  if (existing.length > 0) {
    const assignments = [`${lastSeenCol} = ${nowExpr}`];

    if (columns.updatedAt) {
      assignments.push(`${escapeIdentifier(columns.updatedAt)} = UTC_TIMESTAMP(3)`);
    }

    await prisma.$executeRawUnsafe(
      `
        UPDATE online
        SET ${assignments.join(", ")}
        WHERE ${userIdCol} = ?
      `,
      userId,
    );
    return;
  }

  const insertColumns = [userIdCol, lastSeenCol];
  const insertValues = ["?", nowExpr];

  if (columns.createdAt) {
    insertColumns.push(escapeIdentifier(columns.createdAt));
    insertValues.push("UTC_TIMESTAMP(3)");
  }

  if (columns.updatedAt) {
    insertColumns.push(escapeIdentifier(columns.updatedAt));
    insertValues.push("UTC_TIMESTAMP(3)");
  }

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO online (${insertColumns.join(", ")})
      VALUES (${insertValues.join(", ")})
    `,
    userId,
  );
}

function mapChatMessage(
  row: ChatMessageRow,
  userById: Map<number, { id: number; screenName: string | null; email: string | null; avatarUrl: string | null }>,
) {
  const user = row.userId ? userById.get(row.userId) : null;

  return {
    id: row.id,
    content: row.content,
    createdAt: row.createdAt?.toISOString() ?? null,
    room: row.room ?? "global",
    videoId: row.videoId,
    user: {
      id: user?.id ?? null,
      name: user?.screenName?.trim() || "Anonymous",
      avatarUrl: user?.avatarUrl ?? null,
    },
  };
}

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const parsedQuery = chatQuerySchema.safeParse({
    mode: request.nextUrl.searchParams.get("mode") ?? undefined,
    videoId: request.nextUrl.searchParams.get("videoId") ?? undefined,
  });

  if (!parsedQuery.success) {
    return NextResponse.json({ error: parsedQuery.error.flatten() }, { status: 400 });
  }

  const { mode, videoId } = parsedQuery.data;

  await touchOnlinePresence(authResult.auth.userId);

  if (mode === "online") {
    const columns = await getOnlineColumns();
    const userIdCol = escapeIdentifier(columns.userId);
    const lastSeenCol = escapeIdentifier(columns.lastSeen);
    const freshnessWindowSql =
      columns.lastSeenType === "datetime"
        ? `o.${lastSeenCol} >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 5 MINUTE)`
        : `o.${lastSeenCol} >= UNIX_TIMESTAMP(UTC_TIMESTAMP()) - 300`;

    const onlineRows = await prisma.$queryRawUnsafe<OnlinePresenceRow[]>(
      `
        SELECT
          o.${userIdCol} AS userId,
          o.${lastSeenCol} AS lastSeen
        FROM online o
        WHERE o.${userIdCol} IS NOT NULL
          AND o.${userIdCol} <> ?
          AND ${freshnessWindowSql}
        ORDER BY o.${lastSeenCol} DESC
        LIMIT 80
      `,
      authResult.auth.userId,
    );

    const userIds = Array.from(
      new Set(onlineRows.map((row) => Number(row.userId)).filter((value) => Number.isInteger(value) && value > 0)),
    );

    const users =
      userIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: {
              id: true,
              screenName: true,
              email: true,
              avatarUrl: true,
            },
          })
        : [];

    const userById = new Map(users.map((user) => [user.id, user]));

    const onlineUsers = userIds
      .map((id) => {
        const user = userById.get(id);
        if (!user) {
          return null;
        }

        const presence = onlineRows.find((row) => Number(row.userId) === id);
        const rawLastSeen = presence?.lastSeen ?? null;
        const lastSeen =
          typeof rawLastSeen === "number"
            ? new Date(rawLastSeen * 1000).toISOString()
            : rawLastSeen instanceof Date
              ? rawLastSeen.toISOString()
              : null;

        return {
          id: user.id,
          name: user.screenName?.trim() || "Anonymous",
          avatarUrl: user.avatarUrl ?? null,
          lastSeen,
        };
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value));

    return NextResponse.json({
      mode,
      videoId: null,
      messages: [],
      onlineUsers,
    });
  }

  const columns = await getMessageColumns();

  if (mode === "video" && !videoId) {
    return NextResponse.json({ error: "videoId is required for video chat" }, { status: 400 });
  }

  const idCol = escapeIdentifier(columns.id);
  const userIdCol = escapeIdentifier(columns.userId);
  const roomCol = escapeIdentifier(columns.room);
  const videoIdCol = escapeIdentifier(columns.videoId);
  const contentCol = escapeIdentifier(columns.content);
  const createdAtCol = escapeIdentifier(columns.createdAt);

  const whereSql =
    mode === "global"
      ? `((m.${roomCol} = ?) OR (m.${roomCol} IS NULL AND m.${videoIdCol} IS NULL))`
      : `(m.${roomCol} = ? AND m.${videoIdCol} = ?)`;

  const whereParams = mode === "global" ? ["global"] : ["video", videoId as string];

  const messages = await prisma.$queryRawUnsafe<ChatMessageRow[]>(
    `
      SELECT
        m.${idCol} AS id,
        m.${userIdCol} AS userId,
        m.${contentCol} AS content,
        m.${createdAtCol} AS createdAt,
        m.${roomCol} AS room,
        m.${videoIdCol} AS videoId
      FROM messages m
      WHERE ${whereSql}
      ORDER BY m.${createdAtCol} DESC, m.${idCol} DESC
      LIMIT 20
    `,
    ...whereParams,
  );

  const userIds = Array.from(
    new Set(messages.map((message) => Number(message.userId)).filter((value) => Number.isInteger(value) && value > 0)),
  );

  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true,
            screenName: true,
            email: true,
            avatarUrl: true,
          },
        })
      : [];

  const userById = new Map(users.map((user) => [user.id, user]));

  return NextResponse.json({
    mode,
    videoId: videoId ?? null,
    messages: messages.reverse().map((row) => mapChatMessage(row, userById)),
  });
}

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  await touchOnlinePresence(authResult.auth.userId);

  const bodyResult = await parseRequestJson(request);

  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsedBody = createChatMessageSchema.safeParse(bodyResult.data);

  if (!parsedBody.success) {
    return NextResponse.json({ error: parsedBody.error.flatten() }, { status: 400 });
  }

  const { content, mode, videoId } = parsedBody.data;
  const columns = await getMessageColumns();

  if (mode === "video" && !videoId) {
    return NextResponse.json({ error: "videoId is required for video chat" }, { status: 400 });
  }

  const idCol = escapeIdentifier(columns.id);
  const userIdCol = escapeIdentifier(columns.userId);
  const roomCol = escapeIdentifier(columns.room);
  const videoIdCol = escapeIdentifier(columns.videoId);
  const contentCol = escapeIdentifier(columns.content);
  const createdAtCol = escapeIdentifier(columns.createdAt);
  const updatedAtCol = columns.updatedAt ? escapeIdentifier(columns.updatedAt) : null;

  const now = new Date();
  const insertColumns = [userIdCol, roomCol, videoIdCol, contentCol, createdAtCol];
  const insertValues: Array<string | number | Date | null> = [
    authResult.auth.userId,
    mode,
    mode === "video" ? (videoId as string) : null,
    content,
    now,
  ];

  if (updatedAtCol) {
    insertColumns.push(updatedAtCol);
    insertValues.push(now);
  }

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO messages (${insertColumns.join(", ")})
      VALUES (${insertColumns.map(() => "?").join(", ")})
    `,
    ...insertValues,
  );

  const created = await prisma.$queryRawUnsafe<ChatMessageRow[]>(
    `
      SELECT
        m.${idCol} AS id,
        m.${userIdCol} AS userId,
        m.${contentCol} AS content,
        m.${createdAtCol} AS createdAt,
        m.${roomCol} AS room,
        m.${videoIdCol} AS videoId
      FROM messages m
      WHERE m.${userIdCol} = ?
        AND m.${roomCol} = ?
        AND ((? IS NULL AND m.${videoIdCol} IS NULL) OR m.${videoIdCol} = ?)
        AND m.${contentCol} = ?
      ORDER BY m.${idCol} DESC
      LIMIT 1
    `,
    authResult.auth.userId,
    mode,
    mode === "video" ? (videoId as string) : null,
    mode === "video" ? (videoId as string) : null,
    content,
  );

  const user = await prisma.user.findUnique({
    where: { id: authResult.auth.userId },
    select: {
      id: true,
      screenName: true,
      email: true,
      avatarUrl: true,
    },
  });

  const userById = new Map<number, { id: number; screenName: string | null; email: string | null; avatarUrl: string | null }>();
  if (user) {
    userById.set(user.id, user);
  }

  const message = created[0];
  if (!message) {
    return NextResponse.json({ error: "Failed to create message" }, { status: 500 });
  }

  const mapped = mapChatMessage(message, userById);
  chatEvents.emit(chatChannel(mode, mode === "video" ? (videoId ?? null) : null), mapped);
  return NextResponse.json({ ok: true, message: mapped }, { status: 201 });
}