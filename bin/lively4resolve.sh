#!/bin/bash

REPOSITORY=$1

pushd $REPOSITORY > /dev/null

# if [ -e "${REPOSITORY}/.git/MERGE_HEAD" ]; then
#  echo "merge in progress - you had conflicts or a manual merge is in progress"
# fi

git status --porcelain | egrep  "^UU" | sed 's/^UU /git add /' | bash

# git rebase --continue # required by rebase in sync


popd
