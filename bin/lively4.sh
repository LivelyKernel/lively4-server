#!/bin/bash

LIVELY=~/lively4
SERVER=~/lively4-server
PORT=9005
LOGFILE=$LIVELY/server.log

cd $LIVELY
killall watch.sh
$SERVER/bin/watch.sh $SERVER/httpServer.js "killall node" &
while true; do
    echo "update server code"
    pushd "$SERVER"
    git pull --no-edit
    popd
    sleep 1
    echo "restart http server"`date`  | tee $LIVELY/server.log;
    node $SERVER/httpServer.js --directory=$LIVELY4 --port=$PORT  | \
	sed -u 's/https:\/\/.*@github.com/https:\/\/SECRET@github.com/' | \
	sed -u 's/lively4sync.*/lively4sync.../' | \
	tee $LOGFILE;

done