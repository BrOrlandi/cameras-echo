# Cameras Echo

A local RTSP streaming server designed to display security camera feeds on an Alexa Echo Show (or any web browser). It transcodes RTSP streams to HLS using `ffmpeg` and provides a responsive web interface with Picture-in-Picture (PIP) support.

## Features

- **RTSP to HLS Transcoding**: Uses `ffmpeg` with hardware acceleration (`h264_videotoolbox` on macOS) for efficient streaming.
- **Picture-in-Picture (PIP)**: Displays two camera feeds simultaneously. Double-click to swap streams.
- **Audio Support**:
  - Toggle audio for the active stream.
  - Volume boost (15dB) for better audibility.
  - Automatic transcoding to AAC for browser compatibility.
- **Resilience**:
  - Automatic reconnection if camera goes offline.
  - Watchdog to restart frozen streams.
- **User Interface**:
  - Fullscreen mode.
  - Manual Refresh button.
  - Auto-hide controls after 3 seconds of inactivity.
  - Touch gestures: Pinch-to-zoom and pan.
- **Background Service**: Scripts included to run as a macOS `launchd` service.

## Prerequisites

- **Node.js**: Required to run the server.
- **ffmpeg**: Must be installed and accessible in your system PATH.
  ```bash
  brew install ffmpeg
  ```

## Installation

1.  Clone the repository:
    ```bash
    git clone <repository-url>
    cd cameras-echo
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```

## Configuration

1.  **Cameras**: Create a `cameras.txt` file in the root directory. Add your RTSP URLs, one per line, in the format `Name|RTSP_URL`:
    ```text
    Garage|rtsp://admin:password@192.168.1.100:554/stream
    Backyard|rtsp://admin:password@192.168.1.101:554/stream
    ```
    *Note: The first camera listed will be the initial Main view, and the second will be PIP.*

2.  **Port**: (Optional) Create a `.env` file to specify the port (default is 3000):
    ```env
    PORT=3000
    ```

## Usage

### Running Manually
Start the server directly:
```bash
npm start
# or
node server.js
```
Access the interface at `http://localhost:3000`.

### Running as a Service (macOS)
To ensure the server starts automatically on login and runs in the background:

1.  **Install**:
    ```bash
    ./install_service.sh
    ```
2.  **Stop/Uninstall**:
    ```bash
    ./uninstall_service.sh
    ```
3.  **Restart** (after config changes):
    ```bash
    ./restart_service.sh
    ```
4.  **Logs**: Check `service.log` and `service.error.log` in the project directory for output.

## Architecture

- **Backend (`server.js`)**: Express server that manages `ffmpeg` processes. It handles stream lifecycle, error recovery, and serves the HLS segments.
- **Frontend (`public/`)**:
  - `index.html`: Main UI structure.
  - `app.js`: Handles HLS playback (using `hls.js` or native Safari support), UI interactions, and state management.
  - `style.css`: Responsive styling for the video overlay and controls.

## Troubleshooting

- **No Audio**: Ensure your camera sends audio. The server attempts to boost volume, but if the source is silent, the stream will be too.
- **Stream Lag**: HLS introduces a 5-10 second delay by design for stability.
- **"Network Error"**: Check if the camera IP is reachable from the server machine. The server will auto-retry every 5 seconds.
