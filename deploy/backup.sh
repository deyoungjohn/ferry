#!/usr/bin/env bash
set -euo pipefail

DB_PATH="${FERRY_DB_PATH:-/var/lib/ferry/solver.db}"
BACKUP_DIR="${FERRY_BACKUP_DIR:-/var/lib/ferry/backups}"
DAILY_HOOK="${FERRY_DAILY_BACKUP_HOOK:-/etc/ferry/daily-backup.sh}"

umask 077
if [ ! -f "$DB_PATH" ]; then
	printf 'ferry-backup: database not found at %s\n' "$DB_PATH" >&2
	exit 1
fi

install -d -m 0700 "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/solver-$stamp.db"
temporary="$BACKUP_DIR/.solver-$stamp.db.tmp"
trap 'rm -f "$temporary"' EXIT

sqlite3 "$DB_PATH" ".backup '$temporary'"
mv "$temporary" "$target"
chmod 0600 "$target"

# Keep 48 backups: remove everything older than the 48 newest files.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'solver-*.db' -printf '%T@ %p\n' \
	| sort -nr \
	| tail -n +49 \
	| cut -d' ' -f2- \
	| while IFS= read -r old; do rm -f "$old"; done

# Optional daily copy hook. It is not installed by bootstrap; the maintainer
# can place an executable script at /etc/ferry/daily-backup.sh.
if [ -x "$DAILY_HOOK" ]; then
	marker="$BACKUP_DIR/.daily-$(date -u +%Y-%m-%d)"
	if [ ! -e "$marker" ]; then
		"$DAILY_HOOK" "$target"
		: >"$marker"
	fi
fi

printf 'ferry-backup: wrote %s\n' "$target"
