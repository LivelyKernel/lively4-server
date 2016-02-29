#!/bin/sh

LIVELY=~/lively4-core
SERVER=~/livel4-server

while true; do
    echo "restart http server"`date`  | tee $LIVELY/server.log;
    node $SERVER/httpServer.js --directory=$LIVELY4 --port=9005 | tee $LIVELY/server.log;
done