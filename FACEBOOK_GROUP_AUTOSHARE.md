# Facebook Group Auto-Share

This project now includes a scheduler-safe script to periodically share curated videos into a Facebook group:

- Script: `scripts/facebook-group-autoshare.js`
- Default mode: dry-run (safe, no posting)

## Compliance-first guardrails

The script enforces operational limits to align with platform safety expectations:

- Minimum interval between posts (`FB_GROUP_AUTOSHARE_MIN_INTERVAL_MINUTES`)
- Daily post cap (`FB_GROUP_AUTOSHARE_MAX_POSTS_PER_DAY`)
- Recent-post dedupe window in days (`FB_GROUP_AUTOSHARE_DEDUPE_DAYS`)
- State tracking file for posted video history (`FB_GROUP_AUTOSHARE_STATE_PATH`)

## Required setup

1. Ensure Meta permissions and app review are complete for your posting flow.
2. Provide a valid group posting token and group id.
3. Set environment variables (see `.env.example`).

## Environment variables

- `FB_GROUP_AUTOSHARE_DRY_RUN` (default `1`)
- `FB_GROUP_ID`
- `FB_GROUP_ACCESS_TOKEN`
- `FB_GROUP_AUTOSHARE_MIN_INTERVAL_MINUTES` (default `180`)
- `FB_GROUP_AUTOSHARE_MAX_POSTS_PER_DAY` (default `4`)
- `FB_GROUP_AUTOSHARE_POOL_SIZE` (default `600`)
- `FB_GROUP_AUTOSHARE_DEDUPE_DAYS` (default `30`)
- `FB_GROUP_AUTOSHARE_STATE_PATH` (default `logs/facebook-group-autoshare-state.json`)

## Commands

- Dry-run check:
  - `npm run facebook:group-share:dry-run`
- Live post attempt (still bound by interval/cap rules):
  - `npm run facebook:group-share`

## Automation examples

### Linux cron (every 30 minutes)

```cron
*/30 * * * * cd /srv/yehthatrocks && /usr/bin/npm run facebook:group-share >> /var/log/ytr-facebook-share.log 2>&1
```

The script will skip automatically if posting too frequently or daily cap is reached.

### Windows Task Scheduler

- Program: `npm`
- Arguments: `run facebook:group-share`
- Start in: repo root
- Trigger cadence: every 30 to 60 minutes

## Candidate quality strategy

The script does not pick from all videos blindly. It:

- Uses playable videos only
- Pulls from a high-quality popularity-sorted pool
- Uses weighted tier randomization to keep quality high while widening variety
- Avoids recently shared tracks
