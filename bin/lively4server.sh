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

export PATH=$SERVER/bin:$PATH

$SERVER/bin/watch.sh $SERVER/dist/httpServer.js 'kill -USR1 '$$ &
WATCHERPID=$!

if [ "$OS" == "Windows_NT" ]; then
    SERVER=`cygpath -wa $SERVER`
    LIVELY4=`cygpath -wa $LIVELY4`

    echo "WIN SERVER "$SERVER
    echo "WIN LIVELY "$LIVELY4
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

  pushd $SERVER; gulp babel; popd 
  node $SERVER/dist/httpServer.js --directory=$LIVELY4 --port=$PORT 2>&1 > >(\
  	  sed -u 's/https:\/\/.*@github.com/https:\/\/SECRET@github.com/' | \
	  sed -u 's/lively4sync.*/lively4sync.../' | \
	  tee -a $LOGFILE ) & 
	NODEPID=$!
	wait $NODEPID
	sleep 1 # wait a bit
done
# this will not be reached
