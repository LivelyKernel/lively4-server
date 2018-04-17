#!/bin/bash

REPOSITORY="$1"
USERNAME="$2"
PASSWORD="$3"
EMAIL="$4"
BRANCH="$5"

pushd ~/lively4/ > /dev/null

mv -v "$REPOSITORY" .Trash/`date +"%y%m%d_%H%M_"``echo "$REPOSITORY" | sed "s/.*\///"`

popd > /dev/null