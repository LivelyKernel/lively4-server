#!/bin/bash

# The meta-circular version of running the lively4-server

LIVELY=~/lively4
SERVER=~/lively4/lively4-server
PORT=9006
cd $LIVELY

$SERVER/bin/watch.sh $SERVER/httpServer.js 'kill `ps a | grep port='$PORT' | grep -v watch | grep -v grep | sed "s/pts.*//"`' &

while true; do
    echo "just a second"
    sleep 1
    cp lively4-server.log lively4-server.last.log
    echo "restart http server"`date`  | tee $LIVELY/lively4-server.log;
    node $SERVER/httpServer.js --directory=$LIVELY4 --port=$PORT  | \
	sed -u 's/https:\/\/.*@github.com/https:\/\/SECRET@github.com/' | \
	sed -u 's/lively4sync.*/lively4sync.../' | \
	tee $LIVELY/lively4-server.log;
done