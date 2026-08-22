#!/bin/bash

# Terminate the lively4-server node whose OS-level PID is recorded in $1 (written by
# lively4server.sh each time it (re)launches node). On Windows/Git Bash that PID is the real
# Windows PID, so taskkill the whole tree (node + its node-pty children); elsewhere a POSIX kill.
# Bouncing node this way makes lively4server.sh's supervisor loop relaunch it — this is how the
# file watcher triggers a restart, without relying on SIGUSR1 delivery to a native node.exe.

pidfile="${1:?usage: kill-node.sh <pidfile>}"
pid=$(cat "$pidfile" 2>/dev/null)
[ -z "$pid" ] && exit 0

case "$OSTYPE" in
  msys*|cygwin*) MSYS_NO_PATHCONV=1 taskkill /F /T /PID "$pid" >/dev/null 2>&1 ;;
  *)             kill "$pid" 2>/dev/null ;;
esac
exit 0
