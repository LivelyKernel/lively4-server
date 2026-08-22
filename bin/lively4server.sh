#!/bin/bash

# The meta-circular version of running the lively4-server

echo "LIVELY " $LIVELY
echo "SERVER " $SERVER

OPTIONS=""

cd $LIVELY

# File holding the RUNNING node's OS-level PID so the watcher can terminate it cross-platform:
# the real Windows PID on MSYS/Git Bash (via /proc/<pid>/winpid), the native PID elsewhere.
NODEPIDFILE="$SERVER/.node.pid"

_term() {
  echo "Caught kill signal! Kill watcher and node, too!"
  kill -TERM "$WATCHERPID" 2>/dev/null
  bash "$SERVER/bin/kill-node.sh" "$NODEPIDFILE"
  rm -f "$NODEPIDFILE"
  popd
  exit
}
trap _term SIGTERM
trap _term SIGINT

pushd $LIVELY

export PATH=$SERVER/bin:$PATH

# Watch server sources; on change, terminate the running node by its recorded OS PID and let the
# supervisor loop below relaunch it. Replaces the old SIGUSR1 -> wrapper -> 'kill $NODEPID' path,
# whose SIGUSR1 delivery to the wrapper and pipeline-$! kill of node were both unreliable for a
# native node.exe under Windows/Git Bash (the server ended up dead instead of cycled).
$SERVER/bin/watch.sh $SERVER/src "bash $SERVER/bin/kill-node.sh $NODEPIDFILE" &
WATCHERPID=$!

OPTIONS=" --server="$SERVER" --myurl="$MYURL" "

if [ $AUTHORIZE ]; then
  OPTIONS=$OPTIONS" --authorize-requests=true --github-organization=$ORGANIZATION --github-team=$TEAM "
fi

# Optional shell override for the terminal service (node-pty). Needed on Windows,
# where node-pty does not resolve a bare "bash" and wants "bash.exe" (or a full
# path). Value must be space-free — $OPTIONS is used unquoted below.
if [ "$BASHBIN" ]; then
  OPTIONS=$OPTIONS" --bash-bin=$BASHBIN "
fi

while true; do
  # cheap log rotate
  cp $LOGFILE $LOGFILE.last
  echo "restart http server "`date`  | tee $LOGFILE;

  # optionally fetch new source
  if [ $GITPULL = "true" ]; then 
    pushd "$SERVER"
    git pull --no-edit | tee -a $LOGFILE
    popd
  fi
  # start server and filter secret tokens out before logging

  # remove gulp transpilation step and run node directly
  node $SERVER/src/http-server.js $OPTIONS --directory="$LIVELY4" --port="$PORT" --auto-commit="$AUTOCOMMIT" 2>&1 > >(\
  	  sed -u 's/https:\/\/.*@github.com/https:\/\/SECRET@github.com/' | \
	  sed -u 's/lively4sync.*/lively4sync.../' | \
	  tee -a $LOGFILE ) &
	NODEPID=$!
	# Record node's OS PID for the watcher: its real Windows PID on MSYS (/proc/<pid>/winpid),
	# else the native PID. bin/kill-node.sh reads this to bounce node on a source change.
	WINPID=$(cat /proc/$NODEPID/winpid 2>/dev/null)
	echo "${WINPID:-$NODEPID}" > "$NODEPIDFILE"
	wait $NODEPID
	sleep 1 # wait a bit
done
# this will not be reached
