ALTER TABLE `artist_stats`
  ADD COLUMN `thumbnail_video_id` VARCHAR(32) NULL;

CREATE INDEX `artist_stats_thumbnail_video_id_idx`
  ON `artist_stats`(`thumbnail_video_id`);
