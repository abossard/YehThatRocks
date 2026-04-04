-- Speed up getVideosByArtist lookups and sorting.
-- The query filters by parsedArtist and sorts by views/id.
CREATE INDEX idx_videos_parsed_artist_views_id ON videos (parsedArtist, views, id);
