#!/bin/bash

# Windows/Git Bash site config. Sibling of lively4L1.sh — same pattern: set the
# variables, then source the shared meta-circular runner, which owns the
# watch.sh + SIGUSR1 restart loop.
#
# Two things differ from lively4L1.sh, both required here:
#   SERVER / LIVELY4 are RELATIVE. The server types --server and --directory as
#   'path', and argv (rroot = /^\//) prepends process.cwd() to anything not
#   starting with / or ~/. A Windows absolute path is therefore mangled, and a
#   POSIX one breaks too (node resolves a leading / against the current drive
#   root; MSYS may auto-convert it to C:\... which then fails rroot). Relative
#   values are immune. lively4server.sh pushd's to $LIVELY first, so the same
#   relative SERVER also resolves for $SERVER/src, $SERVER/bin and $LOGFILE.
#
#   LIVELY4 is set at all. lively4server.sh:54 passes --directory="$LIVELY4",
#   but no upstream wrapper ever sets it — it silently expands empty. Setting it
#   here fixes that without forking upstream.

# Self-locate the lively4 root from this script's own path
# ($LIVELY/lively4-server/bin/lively4W1.sh → ../.. is $LIVELY). Portable across
# checkouts; override by exporting LIVELY. pwd -P gives an absolute POSIX path.
LIVELY="${LIVELY:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)}"

SERVER=lively4-server
LIVELY4=.
PORT="${PORT:-9005}"
GITPULL=false
LOGFILE=lively4-server/server.log
AUTOCOMMIT=true
MYURL="http://127.0.0.1:$PORT/"

# node-pty needs an explicit "bash.exe" on Windows (it will not resolve a bare
# "bash"). Pass it through the --bash-bin option — lively4server.sh forwards the
# BASHBIN env var. Kept space-free so it survives $OPTIONS word-splitting; PATH
# below makes bash.exe resolvable to the Windows node process.
export PATH="/c/Program Files/Git/bin:$PATH"
BASHBIN=bash.exe

# Node 22 via nvm-windows: Git Bash may not inherit the machine PATH.
if ! command -v node >/dev/null 2>&1; then
  export PATH="/c/nvm4w/nodejs:$PATH"
fi

cd "$LIVELY" || exit 1
source "$LIVELY/lively4-server/bin/lively4server.sh"
