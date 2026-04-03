<?php
include __DIR__ . '/config.php';

$db = mysqli_connect(
  $conf['db_host'],
  $conf['db_user'],
  $conf['db_pass'],
  $conf['db_name']
);

if (!$db) {
  fwrite(STDERR, "DB_CONNECT_FAIL\n");
  exit(1);
}

function table_exists_local($db, $table_name) {
  $result = mysqli_query($db, "SHOW TABLES LIKE '" . mysqli_real_escape_string($db, $table_name) . "'");
  return ($result && mysqli_num_rows($result) > 0);
}

function column_exists_local($db, $table_name, $column_name) {
  $q = "SHOW COLUMNS FROM `" . $table_name . "` LIKE '" . mysqli_real_escape_string($db, $column_name) . "'";
  $result = mysqli_query($db, $q);
  return ($result && mysqli_num_rows($result) > 0);
}

function run_sql($db, $sql) {
  $ok = mysqli_query($db, $sql);
  if (!$ok) {
    echo "WARN: " . mysqli_error($db) . " | SQL: " . $sql . PHP_EOL;
  }
}

if (!table_exists_local($db, 'searches')) {
  run_sql($db, "CREATE TABLE `searches` (`q` varchar(255) DEFAULT NULL, `result` text, `timestamp` int(11) DEFAULT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

if (!table_exists_local($db, 'site_videos')) {
  run_sql($db, "CREATE TABLE `site_videos` (`videoId` varchar(11) DEFAULT NULL, `status` varchar(20) DEFAULT 'new') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

if (table_exists_local($db, 'favourites')) {
  if (!column_exists_local($db, 'favourites', 'user')) {
    run_sql($db, "ALTER TABLE `favourites` ADD COLUMN `user` int(11) DEFAULT NULL");
  }
  if (column_exists_local($db, 'favourites', 'userid') && column_exists_local($db, 'favourites', 'user')) {
    run_sql($db, "UPDATE `favourites` SET `user`=`userid` WHERE `user` IS NULL AND `userid` IS NOT NULL");
  }
}

if (table_exists_local($db, 'related')) {
  if (!column_exists_local($db, 'related', 'timestamp')) {
    run_sql($db, "ALTER TABLE `related` ADD COLUMN `timestamp` int(11) DEFAULT NULL");
  }
  if (column_exists_local($db, 'related', 'createdAt') && column_exists_local($db, 'related', 'timestamp')) {
    run_sql($db, "UPDATE `related` SET `timestamp`=UNIX_TIMESTAMP(`createdAt`) WHERE `timestamp` IS NULL AND `createdAt` IS NOT NULL");
  }
  run_sql($db, "ALTER TABLE `related` MODIFY COLUMN `related` text");
}

if (table_exists_local($db, 'users')) {
  if (!column_exists_local($db, 'users', 'screen_name')) {
    run_sql($db, "ALTER TABLE `users` ADD COLUMN `screen_name` varchar(255) DEFAULT NULL");
  }
  if (!column_exists_local($db, 'users', 'chat_sound')) {
    run_sql($db, "ALTER TABLE `users` ADD COLUMN `chat_sound` varchar(255) DEFAULT 'guitar'");
  }
  if (!column_exists_local($db, 'users', 'chat_sound_enabled')) {
    run_sql($db, "ALTER TABLE `users` ADD COLUMN `chat_sound_enabled` int(11) DEFAULT 1");
  }
  if (!column_exists_local($db, 'users', 'chat_sound_volume')) {
    run_sql($db, "ALTER TABLE `users` ADD COLUMN `chat_sound_volume` varchar(3) DEFAULT '0.5'");
  }

  run_sql($db, "UPDATE `users` SET `screen_name`=`username` WHERE (`screen_name` IS NULL OR `screen_name`='') AND `username` IS NOT NULL");
  run_sql($db, "UPDATE `users` SET `chat_sound`='guitar' WHERE `chat_sound` IS NULL OR `chat_sound`=''");
  run_sql($db, "UPDATE `users` SET `chat_sound_enabled`=1 WHERE `chat_sound_enabled` IS NULL");
  run_sql($db, "UPDATE `users` SET `chat_sound_volume`='0.5' WHERE `chat_sound_volume` IS NULL OR `chat_sound_volume`=''");
}

if (table_exists_local($db, 'videos')) {
  if (!column_exists_local($db, 'videos', 'channelTitle')) {
    run_sql($db, "ALTER TABLE `videos` ADD COLUMN `channelTitle` varchar(255) DEFAULT NULL");
  }
  if (!column_exists_local($db, 'videos', 'thumbnail')) {
    run_sql($db, "ALTER TABLE `videos` ADD COLUMN `thumbnail` varchar(255) DEFAULT NULL");
  }
}

if (table_exists_local($db, 'site_videos') && !column_exists_local($db, 'site_videos', 'status')) {
  run_sql($db, "ALTER TABLE `site_videos` ADD COLUMN `status` varchar(20) DEFAULT 'new'");
}

$checks = array(
  'favourites.user',
  'related.timestamp',
  'searches.q',
  'site_videos.videoId',
  'site_videos.status',
  'users.screen_name',
  'users.chat_sound',
  'users.chat_sound_enabled',
  'users.chat_sound_volume',
  'videos.channelTitle',
  'videos.thumbnail'
);

foreach ($checks as $check) {
  list($table, $column) = explode('.', $check);
  echo $check . '=' . (column_exists_local($db, $table, $column) ? 'OK' : 'MISSING') . PHP_EOL;
}
