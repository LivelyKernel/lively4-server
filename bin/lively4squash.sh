#!/bin/bash

REPOSITORY="$1"
USERNAME="$2"
PASSWORD="$3"
EMAIL="$4"
BRANCH="$5"
MSG="$6"

pushd "$REPOSITORY" > /dev/null

MSG2="SQUASHED: `git log HEAD...origin/$BRANCH --pretty=format:%f | sort | uniq | tr '\n' ', '`"

git reset --soft origin/$BRANCH && git commit -m "$MSG" -m "$MSG2"

popd > /dev/null