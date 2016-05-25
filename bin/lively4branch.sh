#!/bin/bash

REPOSITORY=~/lively4/"$1"
USERNAME="$2"
PASSWORD="$3"
EMAIL="$4"
BRANCH="$5"

pushd $REPOSITORY > /dev/null

ORIGIN=`git config --get remote.origin.url | sed "s/https:\/\//https:\/\/$USERNAME:$PASSWORD@/"`

if git fetch origin "$BRANCH"; then 
    echo "Switching to existing remote branch"
    git checkout "$BRANCH"
#     git branch --set-upstream "$BRANCH" origin/"$BRANCH"
else 
    echo "creating new branch "
    git branch "$BRANCH"
    git checkout "$BRANCH"
    git push "$ORIGIN" "$BRANCH" 
    git fetch
    # git branch --set-upstream "$BRANCH" origin/"$BRANCH"
    # git checkout --track -b origin/"$BRANCH"

    # echo git pull "$ORIGIN" "$BRANCH"
fi

popd > /dev/null