#!/bin/bash

LIVELY4="$1"
REPOSITORY="$2"
USERNAME="$3"
PASSWORD="$4"
EMAIL="$5"
BRANCH="$6"
MSG="$7"

pushd "$LIVELY4"/"$REPOSITORY" > /dev/null

MSG2="SQUASHED: `git log HEAD...origin/$BRANCH --pretty=format:%f | sort | uniq | tr '\n' ', '`"

git reset --soft origin/$BRANCH && git commit -m "$MSG" -m "$MSG2"

popd > /dev/null