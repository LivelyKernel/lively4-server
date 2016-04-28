#!/bin/bash

# The meta-circular version of running the lively4-server

cd $LIVELY
_term() { 
  echo "Caught kill signal! Kill watcher and node, too!" 
  kill -TERM "$WATCHERPID" 2>/dev/null
  kill -TERM "$NODEPID"
  popd
  exit
}
trap _term SIGTERM
trap _term SIGINT

_restart() { 
  echo "restart server from watcher: "$NODEPID 
  kill $NODEPID
}
trap _restart SIGUSR1

pushd $LIVELY

$SERVER/bin/watch.sh $SERVER/httpServer.js 'kill -USR1 '$$ &
WATCHERPID=$!

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
  node $SERVER/httpServer.js --directory=$LIVELY4 --port=$PORT  >(\
	  sed -u 's/https:\/\/.*@github.com/https:\/\/SECRET@github.com/' | \
	  sed -u 's/lively4sync.*/lively4sync.../' | \
	  tee -a $LOGFILE ) & 
	NODEPID=$!
	wait $NODEPID
	sleep 1 # wait a bit
done
# this will not be reached