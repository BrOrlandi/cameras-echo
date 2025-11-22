#!/bin/bash

# Get absolute path of current directory
PROJECT_DIR=$(pwd)
USER_HOME=$HOME
SERVICE_NAME="com.brunoorlandi.camerasecho"
PLIST_PATH="$USER_HOME/Library/LaunchAgents/$SERVICE_NAME.plist"
NODE_PATH=$(which node)

if [ -z "$NODE_PATH" ]; then
    echo "Error: Node.js not found. Please make sure node is in your PATH."
    exit 1
fi

echo "Installing service $SERVICE_NAME..."
echo "Project Directory: $PROJECT_DIR"
echo "Node Path: $NODE_PATH"

# Create plist file
cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$SERVICE_NAME</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>$PROJECT_DIR/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$PROJECT_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$PROJECT_DIR/service.log</string>
    <key>StandardErrorPath</key>
    <string>$PROJECT_DIR/service.error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH</string>
    </dict>
</dict>
</plist>
EOF

echo "Created plist at $PLIST_PATH"

# Unload if already loaded
launchctl unload "$PLIST_PATH" 2>/dev/null

# Load the service
launchctl load "$PLIST_PATH"

echo "Service installed and started!"
echo "Logs are available at $PROJECT_DIR/service.log"
