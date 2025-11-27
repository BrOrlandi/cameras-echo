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

    const startPlayback = () => {
      if (Hls.isSupported()) {
        if (hlsInstances[camera.id]) {
          hlsInstances[camera.id].destroy();
        }

        const hls = new Hls({
          manifestLoadingTimeOut: 5000,
          manifestLoadingMaxRetry: Infinity,
          manifestLoadingRetryDelay: 1000,
        });

        hls.loadSource(camera.streamUrl);
        hls.attachMedia(videoEl);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          videoEl.play().catch((e) => console.log('Autoplay prevented', e));
          overlayEl.classList.remove('visible');
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            overlayEl.classList.add('visible');
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                console.log(`Network error on ${camera.name}, retrying...`);
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.log(`Media error on ${camera.name}, recovering...`);
                hls.recoverMediaError();
                break;
              default:
                console.log(
                  `Fatal error on ${camera.name}, restarting player in 5s...`
                );
                hls.destroy();
                setTimeout(startPlayback, 3000);
                break;
            }
          }
        });
        hlsInstances[camera.id] = hls;
      } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS (Safari/iOS)
        videoEl.src = camera.streamUrl;

        const onLoaded = () => {
          videoEl.play().catch((e) => console.log('Autoplay prevented', e));
          overlayEl.classList.remove('visible');
        };

        const onError = () => {
          console.log(`Native HLS error on ${camera.name}, retrying in 5s...`);
          overlayEl.classList.add('visible');
          setTimeout(() => {
            videoEl.src = ''; // Clear to force reload
            videoEl.src = camera.streamUrl;
          }, 3000);
        };

        videoEl.removeEventListener('loadedmetadata', onLoaded);
        videoEl.removeEventListener('error', onError);

        videoEl.addEventListener('loadedmetadata', onLoaded);
        videoEl.addEventListener('error', onError);
      }
    };

    startPlayback();
  }

  const ICON_MUTED =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>';
  const ICON_UNMUTED =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';

  // Audio Toggle Logic
  function toggleMute(videoEl, iconEl) {
    const currentlyMuted = videoEl.muted;

    // Mute all first (optional, but good for single-stream audio focus)
    mainVideo.muted = true;
    pipVideo.muted = true;

    if (currentlyMuted) {
      // Currently muted, so UNMUTE
      videoEl.muted = false;
      videoEl.volume = 1.0;
      showIcon(iconEl, ICON_UNMUTED);
    } else {
      // Currently unmuted, so MUTE
      videoEl.muted = true;
      showIcon(iconEl, ICON_MUTED);
    }
  }

  function showIcon(iconEl, svgContent) {
    iconEl.innerHTML = svgContent;
    iconEl.classList.remove('animate');
    void iconEl.offsetWidth; // trigger reflow
    iconEl.classList.add('animate');
    setTimeout(() => {
      iconEl.classList.remove('animate');
    }, 1000);
  }

  // Click Handlers (Immediate Action + Undo for Double Click)
  let lastClickTime = 0;
  const DOUBLE_CLICK_DELAY = 300;

  function handleClick(container, videoEl, iconEl, isMain) {
    const now = Date.now();
    const timeDiff = now - lastClickTime;

    if (isMain) {
      if (timeDiff < DOUBLE_CLICK_DELAY) {
        // Double click detected on Main
        // Undo the previous toggle (toggle back)
        toggleMute(videoEl, iconEl);

        // Perform double click action (Minimize PIP)
        handleDoubleClick(isMain);

        lastClickTime = 0;
      } else {
        // Single click on Main
        toggleMute(videoEl, iconEl);
        lastClickTime = now;
      }
    } else {
      // Click on PIP - Immediate Swap
      handleDoubleClick(isMain);
      lastClickTime = 0;
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

      // Mute both cameras on swap to ensure PIP is silent
      mainVideo.muted = true;
      pipVideo.muted = true;
    }
  }

  // Attach listeners
  // Note: We attach to containers to capture clicks
  mainContainer.addEventListener('click', () =>
    handleClick(mainContainer, mainVideo, mainMuteIcon, !isSwapped)
  );
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

  // Fullscreen Logic
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch((err) => {
          console.log(`Error attempting to enable fullscreen: ${err.message}`);
        });
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        }
      }
    });
  }

  // Refresh Logic
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.location.reload();
    });
  }

  // Idle Timer Logic
  let idleTimeout;
  const IDLE_DELAY = 3000; // Hide after 3 seconds of inactivity

  function resetIdleTimer() {
    document.body.classList.add('user-active');

    if (idleTimeout) {
      clearTimeout(idleTimeout);
    }

    idleTimeout = setTimeout(() => {
      document.body.classList.remove('user-active');
    }, IDLE_DELAY);
  }

  // Track user activity
  ['mousemove', 'mousedown', 'touchstart', 'click', 'keydown'].forEach(
    (evt) => {
      document.addEventListener(evt, resetIdleTimer, { passive: true });
    }
  );

  // Initial activation
  resetIdleTimer();

  // Auto-refresh streams after 30 minutes to prevent freezing
  const STREAM_REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes in milliseconds
  let streamRefreshTimeout;

  function refreshStreams() {
    console.log('Auto-refreshing streams after 30 minutes...');

    // Destroy all HLS instances
    Object.keys(hlsInstances).forEach((cameraId) => {
      if (hlsInstances[cameraId]) {
        hlsInstances[cameraId].destroy();
        delete hlsInstances[cameraId];
      }
    });

    // Clear video sources
    mainVideo.src = '';
    pipVideo.src = '';

    // Show overlays while refreshing
    mainOverlay.classList.add('visible');
    if (cameras[1]) {
      pipOverlay.classList.add('visible');
    }

    // Reinitialize players with the same cameras
    if (cameras[0]) {
      initPlayer(cameras[0], mainVideo, mainOverlay);
    }
    if (cameras[1]) {
      initPlayer(cameras[1], pipVideo, pipOverlay);
    }

    // Schedule next refresh
    scheduleStreamRefresh();
  }

  function scheduleStreamRefresh() {
    if (streamRefreshTimeout) {
      clearTimeout(streamRefreshTimeout);
    }
    streamRefreshTimeout = setTimeout(refreshStreams, STREAM_REFRESH_INTERVAL);
  }

  // Start the auto-refresh timer
  scheduleStreamRefresh();
});
