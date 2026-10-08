#!/bin/sh
set -e
mkdir -p /app/.cache /app/drafts
chown -R nextjs:nodejs /app/.cache /app/drafts
exec gosu nextjs "$@"
