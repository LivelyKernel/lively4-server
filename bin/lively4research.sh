#!/bin/bash

LIVELY=~/research
SERVER=~/lively4-server_research
PORT=9007
GITPULL=true
LOGFILE=$SERVER/server.log
AUTOCOMMIT=true
AUTHORIZE=true
ORGANIZATION=hpi-swa-lab
TEAM=lively-research
source $SERVER/bin/lively4server.sh
