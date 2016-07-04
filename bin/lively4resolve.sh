#!/bin/bash

REPOSITORY=$1

pushd $REPOSITORY > /dev/null

git status --porcelain | egrep  "^UU" | sed 's/^UU /git add /' | bash

# git rebase --continue # required by rebase in sync


popd
