document.addEventListener('DOMContentLoaded', async () => {
    const mainContainer = document.getElementById('main-container');
    const pipContainer = document.getElementById('pip-container');
    const mainVideo = document.getElementById('main-video');
    const pipVideo = document.getElementById('pip-video');
    const mainOverlay = document.getElementById('main-overlay');
    const pipOverlay = document.getElementById('pip-overlay');
    const mainMuteIcon = document.getElementById('main-mute-icon');
    const pipMuteIcon = document.getElementById('pip-mute-icon');

    let cameras = [];
    let hlsInstances = {};
    let isSwapped = false; // false: cam1=main, cam2=pip
    let isPipMinimized = false;

    // Fetch cameras
    try {
        const res = await fetch('/api/cameras');
        cameras = await res.json();
        if (cameras.length < 2) {
            console.warn('Need at least 2 cameras for full functionality');
        }
        initPlayer(cameras[0], mainVideo, mainOverlay);
        if (cameras[1]) {
            initPlayer(cameras[1], pipVideo, pipOverlay);
        }
    } catch (err) {
        console.error('Failed to load cameras', err);
    }

    function initPlayer(camera, videoEl, overlayEl) {
        if (!camera) return;
        
        // Set name in overlay
        overlayEl.querySelector('.camera-name').textContent = camera.name;

        if (Hls.isSupported()) {
            const hls = new Hls({
                manifestLoadingTimeOut: 5000,
                manifestLoadingMaxRetry: Infinity,
                manifestLoadingRetryDelay: 1000,
            });
            hls.loadSource(camera.streamUrl);
            hls.attachMedia(videoEl);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                videoEl.play().catch(e => console.log('Autoplay prevented', e));
                overlayEl.classList.remove('visible');
            });
            hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    overlayEl.classList.add('visible');
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            console.log('fatal network error encountered, try to recover');
                            hls.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            console.log('fatal media error encountered, try to recover');
                            hls.recoverMediaError();
                            break;
                        default:
                            hls.destroy();
                            break;
                    }
                }
            });
            hlsInstances[camera.id] = hls;
        } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
            videoEl.src = camera.streamUrl;
            videoEl.addEventListener('loadedmetadata', () => {
                videoEl.play();
                overlayEl.classList.remove('visible');
            });
            videoEl.addEventListener('error', () => {
                overlayEl.classList.add('visible');
            });
        }
    }

    // Audio Toggle Logic
    function toggleMute(videoEl, iconEl) {
        const isMuted = !videoEl.muted;
        
        // Mute all first
        mainVideo.muted = true;
        pipVideo.muted = true;

        // Unmute target if it was muted
        if (isMuted) {
            videoEl.muted = false;
            showIcon(iconEl, '🔊');
        } else {
            videoEl.muted = true;
            showIcon(iconEl, '🔇');
        }
    }

    function showIcon(iconEl, symbol) {
        iconEl.textContent = symbol;
        iconEl.classList.remove('animate');
        void iconEl.offsetWidth; // trigger reflow
        iconEl.classList.add('animate');
        setTimeout(() => {
            iconEl.classList.remove('animate');
        }, 1000);
    }

    // Click Handlers (Single vs Double)
    let clickTimeout;
    const CLICK_DELAY = 300;

    function handleClick(container, videoEl, iconEl, isMain) {
        if (clickTimeout) {
            clearTimeout(clickTimeout);
            clickTimeout = null;
            handleDoubleClick(isMain);
        } else {
            clickTimeout = setTimeout(() => {
                clickTimeout = null;
                toggleMute(videoEl, iconEl);
            }, CLICK_DELAY);
        }
    }

    function handleDoubleClick(isMain) {
        if (isMain) {
            // Toggle Minimize PIP
            isPipMinimized = !isPipMinimized;
            if (isPipMinimized) {
                // Find which container is currently PIP and hide it
                const pip = isSwapped ? mainContainer : pipContainer;
                pip.classList.add('hidden');
            } else {
                const pip = isSwapped ? mainContainer : pipContainer;
                pip.classList.remove('hidden');
            }
        } else {
            // Swap Main and PIP
            isSwapped = !isSwapped;
            if (isSwapped) {
                mainContainer.classList.remove('main');
                mainContainer.classList.add('pip');
                pipContainer.classList.remove('pip');
                pipContainer.classList.add('main');
                // Ensure z-index update implicitly by class
            } else {
                mainContainer.classList.remove('pip');
                mainContainer.classList.add('main');
                pipContainer.classList.remove('main');
                pipContainer.classList.add('pip');
            }
            // If we swap, ensure PIP is visible (un-minimize if needed)
            isPipMinimized = false;
            mainContainer.classList.remove('hidden');
            pipContainer.classList.remove('hidden');
        }
    }

    // Attach listeners
    // Note: We attach to containers to capture clicks
    mainContainer.addEventListener('click', () => handleClick(mainContainer, mainVideo, mainMuteIcon, !isSwapped));
    pipContainer.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent bubbling to main if they overlap weirdly
        handleClick(pipContainer, pipVideo, pipMuteIcon, isSwapped);
    });


    // Touch / Zoom Logic (Basic Pinch-to-Zoom)
    let scale = 1;
    let panning = false;
    let pointX = 0;
    let pointY = 0;
    let startX = 0;
    let startY = 0;

    const app = document.getElementById('app');

    app.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            // Pinch start logic could go here
        } else if (e.touches.length === 1 && scale > 1) {
            panning = true;
            startX = e.touches[0].clientX - pointX;
            startY = e.touches[0].clientY - pointY;
        }
    });

    app.addEventListener('touchmove', (e) => {
        e.preventDefault(); // Prevent default scrolling
        if (e.touches.length === 1 && panning) {
            pointX = e.touches[0].clientX - startX;
            pointY = e.touches[0].clientY - startY;
            updateTransform();
        }
    });

    app.addEventListener('touchend', () => {
        panning = false;
    });

    // Simple Zoom with Wheel for testing, Pinch is harder to implement from scratch without a lib like Hammer.js
    // But I will add a basic pinch handler
    let initialDistance = 0;
    
    app.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            initialDistance = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
        }
    });

    app.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2) {
            const currentDistance = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const diff = currentDistance - initialDistance;
            const sensitivity = 0.005;
            scale += diff * sensitivity;
            scale = Math.min(Math.max(1, scale), 4); // Limit zoom 1x to 4x
            updateTransform();
            initialDistance = currentDistance;
        }
    });

    function updateTransform() {
        // Apply to the currently MAIN video
        const target = isSwapped ? pipVideo : mainVideo;
        target.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`;
    }
});
