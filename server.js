const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.static('public'));

// Ensure HLS directory exists
const hlsDir = path.join(__dirname, 'public', 'hls');
if (!fs.existsSync(hlsDir)) {
    fs.mkdirSync(hlsDir, { recursive: true });
}

// Clean up old files on startup
fs.readdirSync(hlsDir).forEach(f => fs.unlinkSync(path.join(hlsDir, f)));

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

function startStream(camera) {
    const outputDir = path.join(hlsDir, `cam${camera.id}`);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, 'index.m3u8');

    console.log(`Starting stream for ${camera.name}...`);

    const command = ffmpeg(camera.url)
        .addOptions([
            '-fflags nobuffer',
            '-c:v copy', // Try copying video stream first to save CPU
            '-c:a aac',  // Transcode audio to AAC for web compatibility
            '-b:a 128k',
            '-hls_time 2',
            '-hls_list_size 5',
            '-hls_flags delete_segments',
            '-start_number 0'
        ])
        .output(outputPath)
        .on('start', (cmd) => {
            console.log(`Stream ${camera.name} started with command: ${cmd}`);
        })
        .on('error', (err, stdout, stderr) => {
            console.error(`Error processing ${camera.name}:`, err.message);
            // Retry after delay
            setTimeout(() => {
                if (streams[camera.id]) {
                    console.log(`Retrying ${camera.name}...`);
                    startStream(camera);
                }
            }, 5000);
        })
        .on('end', () => {
            console.log(`Stream ${camera.name} ended.`);
        });

    command.run();
    streams[camera.id] = command;
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
