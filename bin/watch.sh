#!/bin/bash

# Usage: watch.sh <directory> <command>
# Watches all .js files in the specified directory and subdirectories

DIR="${1:-src}"
COMMAND="$2"

if [ -z "$COMMAND" ]; then
    echo "Usage: $0 <directory> <command>"
    echo "Example: $0 src 'kill -USR1 \$\$'"
    exit 1
fi

echo "Watching JavaScript files in $DIR for changes..."

# Get initial state of all .js files
get_js_files_state() {
    find "$DIR" -name "*.js" -type f -exec stat -c "%Y %n" {} \; 2>/dev/null | sort
}

LAST_STATE=$(get_js_files_state)

while true; do
    sleep 1
    NEW_STATE=$(get_js_files_state)
    
    if [ "$NEW_STATE" != "$LAST_STATE" ]; then
        # Find which files changed
        CHANGED=$(diff <(echo "$LAST_STATE") <(echo "$NEW_STATE") | grep "^>" | cut -d' ' -f3-)
        if [ -n "$CHANGED" ]; then
            echo "JavaScript file(s) changed: $CHANGED"
            echo "Executing: $COMMAND"
            bash -c "$COMMAND" &
            sleep 3  # debounce: let the restart settle before re-baselining, so one edit = one bounce
            NEW_STATE=$(get_js_files_state)
        fi
        LAST_STATE="$NEW_STATE"
    fi
done