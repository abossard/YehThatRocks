const SHARED_VIDEO_MESSAGE_PREFIX = "__YTR_SHARE_VIDEO__:";
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const SHARED_VIDEO_FIELD_SEPARATOR = "\t";

type SharedVideoPayload = {
  videoId: string;
  title?: string;
  channelTitle?: string;
};

function sanitizeField(value?: string) {
  if (!value) {
    return "";
  }

  return value
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trimToLength(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, maxLength).trimEnd();
}

export function buildSharedVideoMessage(videoId: string) {
  const normalizedVideoId = videoId.trim();
  if (!YOUTUBE_VIDEO_ID_PATTERN.test(normalizedVideoId)) {
    return "";
  }

  return `${SHARED_VIDEO_MESSAGE_PREFIX}${normalizedVideoId}`;
}

export function parseSharedVideoMessage(content: string) {
  const normalized = content.trim();
  if (!normalized.startsWith(SHARED_VIDEO_MESSAGE_PREFIX)) {
    return null;
  }

  const payload = normalized.slice(SHARED_VIDEO_MESSAGE_PREFIX.length);
  const [videoId, rawTitle = "", rawChannelTitle = ""] = payload.split(SHARED_VIDEO_FIELD_SEPARATOR);

  if (!YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
    return null;
  }

  const title = sanitizeField(rawTitle);
  const channelTitle = sanitizeField(rawChannelTitle);

  return {
    videoId,
    title: title || undefined,
    channelTitle: channelTitle || undefined,
  } as SharedVideoPayload;
}
