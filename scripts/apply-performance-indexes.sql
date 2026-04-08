-- YehThatRocks production performance indexes
-- Safe to run multiple times on MySQL 8+.
-- Usage example:
-- mysql -h 127.0.0.1 -P 3306 -u <user> -p -D yeh < scripts/apply-performance-indexes.sql

SET @schema_name := DATABASE();
SET @videos_updated_col := (
  SELECT CASE
    WHEN SUM(column_name = 'updated_at') > 0 THEN 'updated_at'
    WHEN SUM(column_name = 'updatedAt') > 0 THEN 'updatedAt'
    ELSE NULL
  END
  FROM information_schema.columns
  WHERE table_schema = @schema_name
    AND table_name = 'videos'
    AND column_name IN ('updated_at', 'updatedAt')
);

SET @videos_views_col := (
  SELECT CASE
    WHEN SUM(column_name = 'views') > 0 THEN 'views'
    WHEN SUM(column_name = 'viewCount') > 0 THEN 'viewCount'
    ELSE NULL
  END
  FROM information_schema.columns
  WHERE table_schema = @schema_name
    AND table_name = 'videos'
    AND column_name IN ('views', 'viewCount')
);

-- videos: supports ORDER BY updated_at DESC, id DESC in newest queries.
SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @schema_name
    AND table_name = 'videos'
    AND index_name = 'idx_videos_updated_at_id'
);
SET @sql := IF(
  @idx_exists = 0 AND @videos_updated_col IS NOT NULL,
  CONCAT('CREATE INDEX idx_videos_updated_at_id ON videos (`', @videos_updated_col, '`, id)'),
  'SELECT ''idx_videos_updated_at_id already exists'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- videos: helps top ordering path (favourited, views, videoId).
SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @schema_name
    AND table_name = 'videos'
    AND index_name = 'idx_videos_favourited_views_videoId'
);
SET @sql := IF(
  @idx_exists = 0 AND @videos_views_col IS NOT NULL,
  CONCAT('CREATE INDEX idx_videos_favourited_views_videoId ON videos (favourited, `', @videos_views_col, '`, videoId)'),
  'SELECT ''idx_videos_favourited_views_videoId already exists'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- site_videos: supports joins and status filtering in availability checks.
SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @schema_name
    AND table_name = 'site_videos'
    AND index_name = 'idx_site_videos_video_id_status'
);
SET @sql := IF(
  @idx_exists = 0,
  'CREATE INDEX idx_site_videos_video_id_status ON site_videos (video_id, status)',
  'SELECT ''idx_site_videos_video_id_status already exists'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- site_videos: supports status-first lookups when optimizer chooses that path.
SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @schema_name
    AND table_name = 'site_videos'
    AND index_name = 'idx_site_videos_status_video_id'
);
SET @sql := IF(
  @idx_exists = 0,
  'CREATE INDEX idx_site_videos_status_video_id ON site_videos (status, video_id)',
  'SELECT ''idx_site_videos_status_video_id already exists'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- related: supports relationship lookups in both directions.
SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @schema_name
    AND table_name = 'related'
    AND index_name = 'idx_related_videoId_related'
);
SET @sql := IF(
  @idx_exists = 0,
  'CREATE INDEX idx_related_videoId_related ON related (videoId, related)',
  'SELECT ''idx_related_videoId_related already exists'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @schema_name
    AND table_name = 'related'
    AND index_name = 'idx_related_related_videoId'
);
SET @sql := IF(
  @idx_exists = 0,
  'CREATE INDEX idx_related_related_videoId ON related (related, videoId)',
  'SELECT ''idx_related_related_videoId already exists'' AS info'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ANALYZE TABLE videos, site_videos, related;
