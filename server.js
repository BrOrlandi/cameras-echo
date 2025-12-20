require('dotenv').config();
const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const winston = require('winston');
require('winston-daily-rotate-file');

const app = express();
const PORT = process.env.PORT || 3000;

// Configure rotating logs (max 50MB per file)
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`)
  ),
  transports: [
    new winston.transports.DailyRotateFile({
      filename: 'service-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '50m',
      maxFiles: '1d',
    }),
    new winston.transports.DailyRotateFile({
      filename: 'service-error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '50m',
      maxFiles: '1d',
    }),
    new winston.transports.Console()
  ]
});

app.use(cors());
app.use(express.static('public'));

// Ensure HLS directory exists
const hlsDir = path.join(__dirname, 'public', 'hls');
if (!fs.existsSync(hlsDir)) {
  fs.mkdirSync(hlsDir, { recursive: true });
}

// Clean up old files on startup
fs.readdirSync(hlsDir).forEach((f) =>
  fs.rmSync(path.join(hlsDir, f), { recursive: true, force: true })
);

const cameras = [];
const streams = {};
const streamLocks = {}; // Prevent concurrent restarts

function loadCameras() {
  try {
    const data = fs.readFileSync('cameras.txt', 'utf8');
    const lines = data.split('\n').filter((line) => line.trim() !== '');
    lines.forEach((line, index) => {
      const [name, url] = line.split(';');
      if (name && url) {
        cameras.push({
          id: index + 1,
          name: name.trim(),
          url: url.trim(),
        });
      }
    });
    logger.info(`Loaded ${cameras.length} cameras: ${cameras.map(c => c.name).join(', ')}`);;
  } catch (err) {
    logger.error(`Error reading cameras.txt: ${err.message}`);
  }
}

const watchdogs = {};
const retryTimers = {};

async function startStream(camera) {
  // Prevent concurrent starts for the same camera
  if (streamLocks[camera.id]) {
    logger.warn(`Stream for ${camera.name} already starting/stopping, skipping`);
    return;
  }
  
  streamLocks[camera.id] = true;
  
  const outputDir = path.join(hlsDir, `cam${camera.id}`);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'index.m3u8');

  // Kill existing process if it exists (prevent duplicates)
  if (streams[camera.id]) {
    try {
      logger.info(`Killing existing stream process for ${camera.name}`);
      // Remove listeners to prevent triggering 'error'/'end' handlers during intentional kill
      streams[camera.id].removeAllListeners('error');
      streams[camera.id].removeAllListeners('end');
      streams[camera.id].kill('SIGKILL');
      // Wait for process to die
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (e) {
      logger.error(`Error killing stream for ${camera.name}: ${e.message}`);
    }
    delete streams[camera.id];
  }

  logger.info(`Starting stream for ${camera.name}...`);

  const command = ffmpeg(camera.url)
    .inputOptions([
      '-timeout',
      '5000000', // 5 seconds timeout for RTSP (TCP)
      '-rtsp_transport',
      'tcp', // Force TCP for better reliability
    ])
    .addOptions([
      '-fflags nobuffer',
      '-map 0:v', // Map video
      '-map 0:a', // Map audio
      '-c:v h264_videotoolbox', // Hardware accelerated H.264
      '-b:v 2000k', // Reasonable bitrate
      '-c:a aac',
      '-b:a 128k',
      '-ac 2',
      '-af volume=15dB',
      '-hls_time 2',
      '-hls_list_size 5',
      '-hls_flags delete_segments',
      '-start_number 0',
    ])
    .output(outputPath)
    .on('start', (cmd) => {
      logger.info(`Stream ${camera.name} started.`);
      streamLocks[camera.id] = false;
      startWatchdog(camera, outputPath);
    })
    .on('error', (err) => {
      logger.error(`Error processing ${camera.name}: ${err.message}`);
      streamLocks[camera.id] = false;
      scheduleRetry(camera);
    })
    .on('end', () => {
      logger.warn(`Stream ${camera.name} ended unexpectedly.`);
      streamLocks[camera.id] = false;
      scheduleRetry(camera);
    });

  command.run();
  streams[camera.id] = command;
}

function scheduleRetry(camera) {
  // Clear any pending retry to prevent duplicates/debouncing
  if (retryTimers[camera.id]) {
    clearTimeout(retryTimers[camera.id]);
    delete retryTimers[camera.id];
  }

  if (watchdogs[camera.id]) {
    clearInterval(watchdogs[camera.id]);
    delete watchdogs[camera.id];
  }
  
  if (streams[camera.id]) {
    // If the stream object still exists, ensure listeners are removed so late events don't fire
    streams[camera.id].removeAllListeners('error');
    streams[camera.id].removeAllListeners('end');
    delete streams[camera.id];
  }

  // Avoid rapid loops
  retryTimers[camera.id] = setTimeout(() => {
    logger.info(`Retrying ${camera.name}...`);
    delete retryTimers[camera.id];
    startStream(camera);
  }, 5000); // Increased from 3s to 5s
}

function startWatchdog(camera, filePath) {
  if (watchdogs[camera.id]) clearInterval(watchdogs[camera.id]);

  watchdogs[camera.id] = setInterval(() => {
    fs.stat(filePath, (err, stats) => {
      // If file doesn't exist yet, that's fine, wait for it
      if (err) return;

      const now = Date.now();
      const mtime = new Date(stats.mtime).getTime();
      const diff = now - mtime;

      // If file hasn't updated in 10 seconds, restart
      if (diff > 10000) {
        logger.warn(
          `Watchdog: Stream ${camera.name} froze (${Math.round(diff/1000)}s since last update). Restarting...`
        );
        // Clear watchdog before restarting to prevent race
        if (watchdogs[camera.id]) {
          clearInterval(watchdogs[camera.id]);
          delete watchdogs[camera.id];
        }
        startStream(camera);
      }
    });
  }, 5000);
}

// API to get camera list
app.get('/api/cameras', (req, res) => {
  res.json(
    cameras.map((c) => ({
      id: c.id,
      name: c.name,
      streamUrl: `/hls/cam${c.id}/index.m3u8`,
    }))
  );
});

// Start server
app.listen(PORT, () => {
  logger.info(`Server running at http://localhost:${PORT}`);
  loadCameras();
  cameras.forEach(startStream);
});

// Handle exit
process.on('SIGINT', () => {
  logger.info('Stopping streams...');
  Object.values(watchdogs).forEach(clearInterval);
  Object.values(streams).forEach((command) => {
    try {
      command.kill('SIGKILL');
    } catch (e) {
      // ignore
    }
  });
  process.exit();
});
