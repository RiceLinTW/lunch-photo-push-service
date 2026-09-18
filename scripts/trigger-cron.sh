#!/bin/bash
# Created by Rice.Lin
# Hits the Worker's cron endpoint from this Mac's residential IP, which the
# source site doesn't challenge (unlike cron-job.org/GitHub Actions/even
# Cloudflare's own native Cron Trigger - all confirmed blocked; see
# docs/platform-api-flow.md). Token lives outside the repo.
#
# This is the source of truth; the copy launchd actually runs lives at
# ~/.local/bin/lunch-notify-trigger.sh, because macOS TCC blocks /bin/bash
# (as invoked by launchd) from reading files under ~/Documents. Copy any
# changes made here over to that path too.
set -euo pipefail
TOKEN_FILE="$HOME/.lunch-notify-cron-token"
if [ ! -f "$TOKEN_FILE" ]; then
  echo "Missing $TOKEN_FILE" >&2
  exit 1
fi
curl -sf -X POST "https://lunch-photo-push-service.fzgxt5k8ff.workers.dev/api/cron/trigger" \
  -H "x-cron-token: $(cat "$TOKEN_FILE")"
