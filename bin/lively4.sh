#!/bin/bash

LIVELY=~/lively4
SERVER=~/lively4-server

cd $LIVELY
killall watch.sh
$SERVER/bin/watch.sh $SERVER/httpServer.js "killall node" &
while true; do
    echo "update server code"
    pushd "$SERVER"
    git pull --no-edit
    popd
    echo "restart http server"`date`  | tee $LIVELY/server.log;
    node $SERVER/httpServer.js --directory=$LIVELY4 --port=9005 | tee $LIVELY/server.log;
done