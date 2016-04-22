#!/bin/bash

REPOSITORY=~/lively4/"$1"
USERNAME="$2"
PASSWORD="$3"
EMAIL="$4"
BRANCH="$5"

pushd $REPOSITORY > /dev/null

ORIGIN=`git config --get remote.origin.url | sed "s/https:\/\//https:\/\/$USERNAME:$PASSWORD@/"`

echo REPO $REPOSITORY USERNAME $USERNAME ORIGIN $ORIGIN BRANCH $BRANCH

echo git merge "$BRANCH"

popd > /dev/null