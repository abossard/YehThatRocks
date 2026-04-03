import { z } from "zod";

export const favouriteMutationSchema = z.object({
  videoId: z.string().min(1),
  action: z.enum(["add", "remove"])
});

export const createPlaylistSchema = z.object({
  name: z.string().min(2).max(80),
  videoIds: z.array(z.string().min(1)).max(50).optional().default([])
});

export const addPlaylistItemSchema = z.object({
  videoId: z.string().min(1)
});

export const aiVoteSchema = z.object({
  vote: z.union([z.literal(1), z.literal(-1)])
});

export const registerSchema = z.object({
  email: z.email().max(255),
  screenName: z.string().trim().min(2).max(40),
  password: z.string().min(8).max(128),
  remember: z.boolean().optional().default(false),
});

export const loginSchema = z.object({
  email: z.email().max(255),
  password: z.string().min(8).max(128),
  remember: z.boolean().optional().default(false),
});

export const forgotPasswordSchema = z.object({
  email: z.email().max(255),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(512),
  password: z.string().min(8).max(128),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(20).max(512),
});
