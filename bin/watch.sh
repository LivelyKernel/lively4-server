#!/bin/bash
FILE="$1"
LAST=`ls -l "$FILE"`
while true; do
  sleep 1
  NEW=`ls -l "$FILE"`
  if [ "$NEW" != "$LAST" ]; then
    echo "code: $2"
    bash -c "$2" &
    LAST="$NEW"
  fi
done