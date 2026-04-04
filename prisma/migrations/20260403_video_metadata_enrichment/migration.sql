ALTER TABLE videos
  ADD COLUMN parsedArtist VARCHAR(255) NULL,
  ADD COLUMN parsedTrack VARCHAR(255) NULL,
  ADD COLUMN parsedVideoType VARCHAR(50) NULL,
  ADD COLUMN parseMethod VARCHAR(50) NULL,
  ADD COLUMN parseReason VARCHAR(500) NULL,
  ADD COLUMN parseConfidence FLOAT NULL,
  ADD COLUMN parsedAt DATETIME NULL;

CREATE INDEX idx_videos_parsedArtist ON videos (parsedArtist);
