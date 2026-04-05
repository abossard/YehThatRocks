CREATE TABLE `genre_cards` (
  `id`                INT          NOT NULL AUTO_INCREMENT,
  `genre`             VARCHAR(255) NOT NULL,
  `thumbnail_video_id` VARCHAR(32)  NULL,
  `updated_at`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `genre_cards_genre_key` (`genre`),
  KEY `genre_cards_thumbnail_video_id_idx` (`thumbnail_video_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
