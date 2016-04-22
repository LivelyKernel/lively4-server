#!/bin/bash

REPOSITORY=~/lively4/"$1"
USERNAME="$2"
PASSWORD="$3"
EMAIL="$4"
BRANCH="$5"

pushd $REPOSITORY > /dev/null

ORIGIN=`git config --get remote.origin.url | sed "s/https:\/\//https:\/\/$USERNAME:$PASSWORD@/"`

echo "REPO" "$REPOSITORY" "USERNAME" "$USERNAME" "ORIGIN" "$ORIGIN"

git status --porcelain | grep  "??" | sed 's/^?? /git add /' | bash
git config user.name "$USERNAME"
git config user.email "$EMAIL"
STATUS=`git status --porcelain | grep -v "??" | tr "\n" ";"`
COMMIT="SYNC "$STATUS
git commit -m "$COMMIT" -a ; 
echo "PULL"
git pull --no-edit origin "$BRANCH" ; 

echo "PUSH"
git push $ORIGIN $BRANCH

echo "FETCH AGAIN"
git fetch origin "$BRANCH"

popd > /dev/null