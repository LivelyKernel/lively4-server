#!/bin/bash

REPOSITORY="$1"
USERNAME="$2"
PASSWORD="$3"
EMAIL="$4"
BRANCH="$5"

pushd $REPOSITORY > /dev/null

if [ -e "${REPOSITORY}/.git/MERGE_HEAD" ]; then
  echo "merge in progress - you had conflicts or a manual merge is in progress"
  exit
fi

git pull --no-edit origin "$BRANCH"

popd > /dev/null