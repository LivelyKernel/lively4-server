#!/bin/bash

# The meta-circular version of running the lively4-server

LIVELY=~/lively4
SERVER=~/lively4/lively4-server

cd $LIVELY
while true; do
    echo "just 2seconds"
    sleep 2
    cp lively4-server.log lively4-server.last.log
    echo "restart http server"`date`  | tee $LIVELY/lively4-server.log;
    node $SERVER/httpServer.js --directory=$LIVELY4 --port=9006  | \
	sed -u 's/https:\/\/.*@github.com/https:\/\/SECRET@github.com/' | \
	sed -u 's/lively4sync.*/lively4sync.../' | \
	tee $LIVELY/lively4-server.log;
done