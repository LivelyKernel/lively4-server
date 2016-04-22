#!/bin/bash

REPOSITORY=~/lively4/"$1"
USERNAME="$2"
PASSWORD="$3"
EMAIL="$4"
BRANCH="$5"

pushd $REPOSITORY > /dev/null

git pull --no-edit origin "$BRANCH"

popd > /dev/null