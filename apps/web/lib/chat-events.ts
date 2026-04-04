import { EventEmitter } from "node:events";

declare global {
  var __yehChatEvents__: EventEmitter | undefined;
}

function makeChatEvents() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(1000);
  return emitter;
}

export const chatEvents: EventEmitter =
  global.__yehChatEvents__ ?? makeChatEvents();

if (process.env.NODE_ENV !== "production") {
  global.__yehChatEvents__ = chatEvents;
}

export function chatChannel(mode: string, videoId: string | null | undefined) {
  return `chat:${mode}:${videoId ?? "null"}`;
}
