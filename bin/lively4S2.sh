#!/bin/bash

# The meta-circular version of running the lively4-server

LIVELY=~/lively4
SERVER=~/lively4/lively4-server
PORT=9006
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
  cp lively4-server.log lively4-server.last.log
  echo "restart http server"`date`  | tee lively4-server.log;
  # start server and filter secret tokens out before logging
  node $SERVER/httpServer.js --directory=$LIVELY4 --port=$PORT  >(\
	  sed -u 's/https:\/\/.*@github.com/https:\/\/SECRET@github.com/' | \
	  sed -u 's/lively4sync.*/lively4sync.../' | \
	  tee lively4-server.log) & 
	NODEPID=$!
	wait $NODEPID
	sleep 1 # wait a bit
done
# this will not be reached