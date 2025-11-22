#!/bin/bash

# Scan for RTSP devices (port 554) on 192.168.15.2-200

echo "Scanning network 192.168.15.2 to 192.168.15.200 for RTSP (port 554)..."

for i in {2..200}; do
    ip="192.168.15.$i"
    # nc -z -w 1 checks for open port with 1 second timeout
    # 2>&1 redirects stderr to stdout to suppress errors for closed ports if any
		echo "Scanning $ip..."
    # Use python for reliable port checking
    # connect_ex returns 0 on success, error code otherwise
    python3 -c "import socket, sys; s = socket.socket(socket.AF_INET, socket.SOCK_STREAM); s.settimeout(1); sys.exit(s.connect_ex(('$ip', 554)))" 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo "Found RTSP device at: $ip"
    fi
done

echo "Scan complete."
