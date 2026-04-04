import { NextRequest } from "next/server";
import { z } from "zod";

import { requireApiAuth } from "@/lib/auth-request";
import { chatChannel, chatEvents } from "@/lib/chat-events";

const streamQuerySchema = z.object({
  mode: z.enum(["global", "video"]).default("global"),
  videoId: z.string().trim().min(1).max(32).optional(),
});

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  const parsed = streamQuerySchema.safeParse({
    mode: request.nextUrl.searchParams.get("mode") ?? undefined,
    videoId: request.nextUrl.searchParams.get("videoId") ?? undefined,
  });

  if (!parsed.success) {
    return new Response("Bad request", { status: 400 });
  }

  const { mode, videoId } = parsed.data;
  const channel = chatChannel(mode, mode === "video" ? videoId : null);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(": connected\n\n"));

      const handler = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // controller already closed
        }
      };

      chatEvents.on(channel, handler);

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 25_000);

      request.signal.addEventListener("abort", () => {
        chatEvents.off(channel, handler);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
