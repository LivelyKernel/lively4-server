#!/bin/bash

REPOSITORY="$1"
USERNAME="$2"
PASSWORD="$3"
EMAIL="$4"
BRANCH="$5"
MSG="$6"

pushd $REPOSITORY > /dev/null

## get rid of accidental passwords.. should never be needed
PLAINORIGIN=`git config --get remote.origin.url | sed "s/https:\/\/.*@/https:\/\//" `
ORIGIN=`echo $PLAINORIGIN | sed "s/https:\/\//https:\/\/$USERNAME:$PASSWORD@/"` 

echo "REPO: " "$REPOSITORY" "USERNAME: " "$USERNAME" 

git status --porcelain | grep  "??" | sed 's/^?? /git add /' | bash
git config user.name "$USERNAME"
git config user.email "$EMAIL"
STATUS=`git status --porcelain | grep -v "??" | tr "\n" ";"`
if [ -z "$MSG" ]; then
  COMMIT="SYNC "$STATUS
else  
  COMMIT="$MSG"
fi
echo COMMIT $COMMIT

if [ -e "${REPOSITORY}/.git/MERGE_HEAD" ]; then
  echo "merge in progress - you had conflicts or a manual merge is in progress"
  exit
fi

git commit -m "$COMMIT" -a ; 
echo "PULL"
git pull --no-edit "$ORIGIN" "$BRANCH" ; 

# ALT: #Issue6
# git pull --rebase --no-edit origin "$BRANCH" ; 


echo "PUSH2"
echo git push "$ORIGIN" "$BRANCH"
git push "$ORIGIN" "$BRANCH"

echo "FETCH AGAIN"

## ALTERNATVIE: an explicit fetch is not enough, because the staus is not updated
# git fetch "$ORIGIN" "$BRANCH"

## ALTERNATVIE: a simple fetch is also not enough because it does not have credentials

# git fetch

# #HACK, temporarily set the origin to a url with credentials

git remote set-url origin  $ORIGIN
git fetch
git remote set-url origin  $PLAINORIGIN


popd > /dev/null