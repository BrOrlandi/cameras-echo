# Cameras Echo

A local RTSP streaming server designed to display security camera feeds on an Alexa Echo Show (or any web browser). It uses [mediamtx](https://github.com/bluenviron/mediamtx) to relay RTSP streams via WebRTC (near real-time) and HLS (fallback), and provides a responsive web interface with Picture-in-Picture (PIP) support.

## Features

- **WebRTC (WHEP)**: Primary playback via WebRTC for near real-time latency (~200ms).
- **HLS Fallback**: Low-latency HLS for browsers without WebRTC support (e.g., Echo Show's Silk browser).
- **Picture-in-Picture (PIP)**: Displays two camera feeds simultaneously. Double-click to swap streams.
- **Audio Support**: Toggle audio for the active stream.
- **Resilience**:
  - Automatic reconnection handled by mediamtx.
  - WebRTC fallback to HLS on connection failure.
  - Page auto-reload when all cameras are offline.
- **User Interface**:
  - Fullscreen mode.
  - Manual Refresh button.
  - Touch gestures: Pinch-to-zoom and pan.
- **Background Service**: Scripts included to run as a macOS `launchd` service.

## Prerequisites

- **Node.js**: Required to run the server.
- **mediamtx**: Must be installed and accessible in your system PATH.
  ```bash
  brew install mediamtx
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

- **Backend (`server.js`)**: Express server that generates a mediamtx config and manages the mediamtx process. mediamtx handles RTSP ingestion, WebRTC (WHEP) and HLS output natively.
- **Frontend (`public/`)**:
  - `index.html`: Main UI structure.
  - `app.js`: Handles WebRTC (WHEP) playback with HLS fallback (via `hls.js` or native Safari support), UI interactions, and state management.
  - `style.css`: Responsive styling for the video overlay and controls.

## Troubleshooting

- **No Audio**: Ensure your camera sends audio. Audio is passed through without server-side processing.
- **Stream Lag**: WebRTC provides near real-time playback. HLS fallback has ~1-3s delay with low-latency mode.
- **"Network Error"**: Check if the camera IP is reachable from the server machine. mediamtx handles reconnection automatically.
