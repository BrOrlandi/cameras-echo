require('dotenv').config();
const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static('public'));

// Ensure HLS directory exists
const hlsDir = path.join(__dirname, 'public', 'hls');
if (!fs.existsSync(hlsDir)) {
    fs.mkdirSync(hlsDir, { recursive: true });
}

// Clean up old files on startup
fs.readdirSync(hlsDir).forEach(f => fs.rmSync(path.join(hlsDir, f), { recursive: true, force: true }));

const cameras = [];
const streams = {};

function loadCameras() {
    try {
        const data = fs.readFileSync('// removed cameras reference', 'utf8');
        const lines = data.split('\n').filter(line => line.trim() !== '');
        lines.forEach((line, index) => {
            const [name, url] = line.split(';');
            if (name && url) {
                cameras.push({
                    id: index + 1,
                    name: name.trim(),
                    url: url.trim()
                });
            }
        });
        console.log('Loaded cameras:', cameras);
    } catch (err) {
        console.error('Error reading // removed cameras reference:', err);
    }
}

const watchdogs = {};

function startStream(camera) {
    const outputDir = path.join(hlsDir, `cam${camera.id}`);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, 'index.m3u8');

    // Kill existing process if it exists (prevent duplicates)
    if (streams[camera.id]) {
        try {
            streams[camera.id].kill('SIGKILL');
        } catch (e) { /* ignore */ }
    }

    console.log(`Starting stream for ${camera.name}...`);

    const command = ffmpeg(camera.url)
        .inputOptions([
            '-timeout', '5000000', // 5 seconds timeout for RTSP (TCP)
            '-rtsp_transport', 'tcp' // Force TCP for better reliability
        ])
        .addOptions([
            '-fflags nobuffer',
            '-c:v copy',
            '-c:a aac',
            '-b:a 128k',
            '-hls_time 2',
            '-hls_list_size 5',
            '-hls_flags delete_segments',
            '-start_number 0'
        ])
        .output(outputPath)
        .on('start', (cmd) => {
            console.log(`Stream ${camera.name} started.`);
            startWatchdog(camera, outputPath);
        })
        .on('error', (err) => {
            console.error(`Error processing ${camera.name}:`, err.message);
            scheduleRetry(camera);
        })
        .on('end', () => {
            console.log(`Stream ${camera.name} ended unexpectedly.`);
            scheduleRetry(camera);
        });

    command.run();
    streams[camera.id] = command;
}

function scheduleRetry(camera) {
    if (watchdogs[camera.id]) clearInterval(watchdogs[camera.id]);
    
    // Avoid rapid loops
    setTimeout(() => {
        console.log(`Retrying ${camera.name}...`);
        startStream(camera);
    }, 5000);
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
                console.warn(`Watchdog: Stream ${camera.name} froze (${diff}ms since last update). Restarting...`);
                startStream(camera);
            }
        });
    }, 5000);
}

// API to get camera list
app.get('/api/cameras', (req, res) => {
    res.json(cameras.map(c => ({
        id: c.id,
        name: c.name,
        streamUrl: `/hls/cam${c.id}/index.m3u8`
    })));
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    loadCameras();
    cameras.forEach(startStream);
});

// Handle exit
process.on('SIGINT', () => {
    console.log('Stopping streams...');
    Object.values(streams).forEach(command => command.kill('SIGKILL'));
    process.exit();
});
