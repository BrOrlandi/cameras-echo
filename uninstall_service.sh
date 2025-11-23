#!/bin/bash

SERVICE_NAME="com.brunoorlandi.camerasecho"
PLIST_PATH="$HOME/Library/LaunchAgents/$SERVICE_NAME.plist"

echo "Stopping and uninstalling service $SERVICE_NAME..."

if [ -f "$PLIST_PATH" ]; then
    launchctl unload "$PLIST_PATH"
    rm "$PLIST_PATH"
    echo "Service stopped and plist removed."
else
    echo "Service plist not found at $PLIST_PATH. Is it installed?"
fi
