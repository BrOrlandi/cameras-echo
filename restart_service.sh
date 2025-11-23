#!/bin/bash

SERVICE_NAME="com.brunoorlandi.camerasecho"
PLIST_PATH="$HOME/Library/LaunchAgents/$SERVICE_NAME.plist"

echo "Restarting service $SERVICE_NAME..."

if [ -f "$PLIST_PATH" ]; then
    launchctl unload "$PLIST_PATH"
    sleep 1
    launchctl load "$PLIST_PATH"
    echo "Service restarted."
else
    echo "Service plist not found. Please run ./install_service.sh first."
fi
