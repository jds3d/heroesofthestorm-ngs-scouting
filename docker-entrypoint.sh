#!/bin/sh
set -e
mkdir -p /app/.cache
chown -R nextjs:nodejs /app/.cache
exec su-exec nextjs "$@"
