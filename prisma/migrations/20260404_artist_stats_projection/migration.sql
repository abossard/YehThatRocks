CREATE TABLE `artist_stats` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `normalized_artist` VARCHAR(255) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `slug` VARCHAR(255) NOT NULL,
  `first_letter` CHAR(1) NOT NULL,
  `country` VARCHAR(255) NULL,
  `genre` VARCHAR(255) NULL,
  `video_count` INT NOT NULL DEFAULT 0,
  `source` VARCHAR(50) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `artist_stats_normalized_artist_key`(`normalized_artist`),
  INDEX `artist_stats_first_letter_display_name_idx`(`first_letter`, `display_name`),
  INDEX `artist_stats_video_count_idx`(`video_count`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
