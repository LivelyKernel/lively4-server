#!/bin/bash

REPOSITORY=~/lively4/"$1"
USERNAME="$2"
PASSWORD="$3"
EMAIL="$4"

pushd $REPOSITORY > /dev/null

ORIGIN=`git config --get remote.origin.url | sed "s/https:\/\//https:\/\/$USERNAME:$PASSWORD@/"`

echo "REPO" "$REPOSITORY" "USERNAME" "$USERNAME" "ORIGIN" "$ORIGIN"

git status --porcelain | grep  "??" | sed 's/^?? /git add /' | bash
echo -n "SYNC " > COMMIT ; 
git config user.name "$USERNAME"
git config user.email "$EMAIL"
git status --porcelain | grep -v "??" | tr "\n" ";">> COMMIT;
cat COMMIT 
git commit -F COMMIT -a ; 
git pull --no-edit; 
git push $ORIGIN

popd > /dev/null