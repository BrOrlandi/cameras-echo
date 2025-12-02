#!/bin/bash

SERVICE_NAME="com.brunoorlandi.camerasecho"
PLIST_PATH="$HOME/Library/LaunchAgents/$SERVICE_NAME.plist"

echo "Stopping service $SERVICE_NAME..."

if [ -f "$PLIST_PATH" ]; then
    launchctl unload "$PLIST_PATH"
    echo "Service stopped."
else
    echo "Service plist not found at $PLIST_PATH. Is it installed?"
fi
