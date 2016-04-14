#!/bin/bash

# USERNAME=jens.lincke
# PASSWORD=f777a0fa178bc855c28f89b402786b36f8b03cc4

REPOSITORY=~/lively4/"$1"
USERNAME="$2"
PASSWORD="$3"
EMAIL="$4"

pushd $REPOSITORY > /dev/null

ORIGIN=`git config --get remote.origin.url | sed "s/https:\/\//https:\/\/$USERNAME:$PASSWORD@/"`

echo "REPO" $REPOSITORY "USERNAME "$USERNAME" PASSWORD "$PASSWORD "ORIGIN" $ORIGIN

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