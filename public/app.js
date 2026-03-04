document.addEventListener('DOMContentLoaded', async () => {
  const mainContainer = document.getElementById('main-container');
  const pipContainer = document.getElementById('pip-container');
  const mainVideo = document.getElementById('main-video');
  const pipVideo = document.getElementById('pip-video');
  const mainOverlay = document.getElementById('main-overlay');
  const pipOverlay = document.getElementById('pip-overlay');
  const mainMuteIcon = document.getElementById('main-mute-icon');
  const pipMuteIcon = document.getElementById('pip-mute-icon');
  const soundToggleBtn = document.getElementById('sound-toggle-btn');
  const soundIconMuted = document.getElementById('sound-icon-muted');
  const soundIconUnmuted = document.getElementById('sound-icon-unmuted');

  let cameras = [];
  let ports = { hls: 8888, webrtc: 8889 };
  let hlsInstances = {};
  let webrtcInstances = {};
  let isSwapped = false;
  let isPipMinimized = false;

  const ICON_MUTED =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>';
  const ICON_UNMUTED =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';

  // --- Sound state ---
  function getIsMutedFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const m = params.get('muted');
    return m === null ? true : m !== '0';
  }

  function setMutedInUrl(isMuted) {
    const params = new URLSearchParams(window.location.search);
    params.set('muted', isMuted ? '1' : '0');
    window.history.replaceState({}, '', window.location.pathname + '?' + params.toString());
  }

  let isGlobalMuted = getIsMutedFromUrl();

  function updateSoundIcon() {
    soundIconMuted.style.display = isGlobalMuted ? '' : 'none';
    soundIconUnmuted.style.display = isGlobalMuted ? 'none' : '';
  }

  function applyGlobalMute() {
    [mainVideo, pipVideo].forEach((v) => {
      v.muted = isGlobalMuted;
      v.volume = isGlobalMuted ? 0 : 1.0;
    });
    updateSoundIcon();
    if (mainMuteIcon) mainMuteIcon.innerHTML = isGlobalMuted ? ICON_MUTED : ICON_UNMUTED;
    if (pipMuteIcon) pipMuteIcon.innerHTML = isGlobalMuted ? ICON_MUTED : ICON_UNMUTED;
  }

  applyGlobalMute();

  soundToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    isGlobalMuted = !isGlobalMuted;
    setMutedInUrl(isGlobalMuted);
    applyGlobalMute();
  });

  // --- Camera loading ---
  try {
    const res = await fetch('/api/cameras');
    const data = await res.json();
    cameras = data.cameras;
    ports = data.ports || ports;

    if (cameras.length < 2) console.warn('Need at least 2 cameras for full functionality');

    initPlayer(cameras[0], mainVideo, mainOverlay);
    if (cameras[1]) initPlayer(cameras[1], pipVideo, pipOverlay);
  } catch (err) {
    console.error('Failed to load cameras', err);
  }

  // --- WebRTC player (WHEP protocol) ---
  async function startWebRTC(camera, videoEl, overlayEl) {
    const hostname = window.location.hostname;
    const whepUrl = `http://${hostname}:${ports.webrtc}/${camera.slug}/whep`;

    const pc = new RTCPeerConnection({
      iceServers: [], // Local network — no STUN needed
    });

    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });

    pc.ontrack = (event) => {
      if (!videoEl.srcObject) {
        videoEl.srcObject = event.streams[0];
        videoEl.muted = isGlobalMuted;
        videoEl.volume = isGlobalMuted ? 0 : 1.0;
        videoEl.play().catch((e) => console.log('Autoplay prevented:', e));
        overlayEl.classList.remove('visible');
        overlayEl.querySelector('.status').textContent = 'WebRTC';
        camera.offlineSince = null;
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[${camera.name}] WebRTC state: ${pc.connectionState}`);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        camera.offlineSince = Date.now();
        overlayEl.classList.add('visible');
        pc.close();
        // Retry after 3s
        setTimeout(() => initPlayer(camera, videoEl, overlayEl), 3000);
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Wait for ICE gathering (max 3s)
    await new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') return resolve();
      const timeout = setTimeout(resolve, 3000);
      pc.addEventListener('icegatheringstatechange', () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    const response = await fetch(whepUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: pc.localDescription.sdp,
    });

    if (!response.ok) throw new Error(`WHEP ${response.status}`);

    const answerSdp = await response.text();
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

    return pc;
  }

  // --- HLS fallback player ---
  function startHLS(camera, videoEl, overlayEl) {
    const hostname = window.location.hostname;
    const hlsUrl = `http://${hostname}:${ports.hls}/${camera.slug}/index.m3u8`;

    overlayEl.querySelector('.status').textContent = 'HLS';

    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      if (hlsInstances[camera.id]) hlsInstances[camera.id].destroy();

      const hls = new Hls({
        manifestLoadingTimeOut: 5000,
        manifestLoadingMaxRetry: Infinity,
        manifestLoadingRetryDelay: 1000,
      });

      hls.loadSource(hlsUrl);
      hls.attachMedia(videoEl);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        videoEl.play().catch((e) => console.log('Autoplay prevented', e));
        overlayEl.classList.remove('visible');
        camera.offlineSince = null;
      });

      hls.on(Hls.Events.FRAG_LOADED, () => {
        overlayEl.classList.remove('visible');
        camera.offlineSince = null;
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          camera.offlineSince = Date.now();
          overlayEl.classList.add('visible');
          fetch(`/api/restart/${camera.id}`, { method: 'POST' }).catch(console.error);
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              setTimeout(() => startHLS(camera, videoEl, overlayEl), 3000);
          }
        }
      });

      hlsInstances[camera.id] = hls;
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (Safari / Echo Show)
      videoEl.src = hlsUrl;
      videoEl.addEventListener('loadedmetadata', () => {
        videoEl.play().catch((e) => console.log('Autoplay prevented', e));
        overlayEl.classList.remove('visible');
        camera.offlineSince = null;
      });
      videoEl.addEventListener('error', () => {
        camera.offlineSince = Date.now();
        overlayEl.classList.add('visible');
        fetch(`/api/restart/${camera.id}`, { method: 'POST' }).catch(console.error);
        setTimeout(() => {
          videoEl.src = '';
          videoEl.src = hlsUrl;
        }, 3000);
      });
    }
  }

  // --- Player init: try WebRTC first, fall back to HLS ---
  async function initPlayer(camera, videoEl, overlayEl) {
    if (!camera) return;

    videoEl.muted = isGlobalMuted;
    videoEl.volume = isGlobalMuted ? 0 : 1.0;
    overlayEl.querySelector('.camera-name').textContent = camera.name;
    overlayEl.querySelector('.status').textContent = 'Conectando...';
    overlayEl.classList.add('visible');

    // Clean up existing instances
    if (webrtcInstances[camera.id]) {
      try { webrtcInstances[camera.id].close(); } catch (e) {}
      delete webrtcInstances[camera.id];
    }
    if (hlsInstances[camera.id]) {
      try { hlsInstances[camera.id].destroy(); } catch (e) {}
      delete hlsInstances[camera.id];
    }
    videoEl.srcObject = null;
    videoEl.src = '';

    // Try WebRTC (WHEP) first
    if (window.RTCPeerConnection && camera.slug) {
      try {
        console.log(`[${camera.name}] Trying WebRTC...`);
        const pc = await startWebRTC(camera, videoEl, overlayEl);
        webrtcInstances[camera.id] = pc;
        return;
      } catch (err) {
        console.warn(`[${camera.name}] WebRTC failed, falling back to HLS:`, err.message);
      }
    }

    // Fall back to HLS
    console.log(`[${camera.name}] Starting HLS...`);
    startHLS(camera, videoEl, overlayEl);
  }

  // --- All cameras offline → reload page ---
  setInterval(() => {
    const now = Date.now();
    const allOffline =
      cameras.length > 0 &&
      cameras.every((c) => c.offlineSince && now - c.offlineSince > 10000);
    if (allOffline) {
      console.log('All cameras offline > 10s, refreshing...');
      window.location.reload();
    }
  }, 1000);

  // --- Sound toggle ---
  function toggleMute(videoEl, iconEl) {
    isGlobalMuted = !isGlobalMuted;
    setMutedInUrl(isGlobalMuted);
    applyGlobalMute();
    iconEl.classList.remove('animate');
    void iconEl.offsetWidth;
    iconEl.classList.add('animate');
    setTimeout(() => iconEl.classList.remove('animate'), 1000);
  }

  // --- Click / double-click handlers ---
  let lastClickTime = 0;
  const DOUBLE_CLICK_DELAY = 300;

  function handleClick(container, videoEl, iconEl, isMain) {
    const now = Date.now();
    const timeDiff = now - lastClickTime;

    if (isMain) {
      if (timeDiff < DOUBLE_CLICK_DELAY) {
        toggleMute(videoEl, iconEl);
        handleDoubleClick(isMain);
        lastClickTime = 0;
      } else {
        toggleMute(videoEl, iconEl);
        lastClickTime = now;
      }
    } else {
      handleDoubleClick(isMain);
      lastClickTime = 0;
    }
  }

  function handleDoubleClick(isMain) {
    if (isMain) {
      isPipMinimized = !isPipMinimized;
      const pip = isSwapped ? mainContainer : pipContainer;
      pip.classList.toggle('hidden', isPipMinimized);
    } else {
      isSwapped = !isSwapped;
      mainContainer.classList.toggle('main', !isSwapped);
      mainContainer.classList.toggle('pip', isSwapped);
      pipContainer.classList.toggle('pip', !isSwapped);
      pipContainer.classList.toggle('main', isSwapped);
      isPipMinimized = false;
      mainContainer.classList.remove('hidden');
      pipContainer.classList.remove('hidden');
      applyGlobalMute();
    }
  }

  mainContainer.addEventListener('click', () =>
    handleClick(mainContainer, mainVideo, mainMuteIcon, !isSwapped),
  );
  pipContainer.addEventListener('click', (e) => {
    e.stopPropagation();
    handleClick(pipContainer, pipVideo, pipMuteIcon, isSwapped);
  });

  // --- Touch / Pinch zoom ---
  let scale = 1;
  let panning = false;
  let pointX = 0;
  let pointY = 0;
  let startX = 0;
  let startY = 0;
  let initialDistance = 0;

  const appEl = document.getElementById('app');

  appEl.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      initialDistance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
    } else if (e.touches.length === 1 && scale > 1) {
      panning = true;
      startX = e.touches[0].clientX - pointX;
      startY = e.touches[0].clientY - pointY;
    }
  });

  appEl.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 2) {
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      scale += (d - initialDistance) * 0.005;
      scale = Math.min(Math.max(1, scale), 4);
      updateTransform();
      initialDistance = d;
    } else if (e.touches.length === 1 && panning) {
      pointX = e.touches[0].clientX - startX;
      pointY = e.touches[0].clientY - startY;
      updateTransform();
    }
  });

  appEl.addEventListener('touchend', () => { panning = false; });

  function updateTransform() {
    const target = isSwapped ? pipVideo : mainVideo;
    target.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`;
  }

  // --- Fullscreen ---
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(console.error);
      } else {
        document.exitFullscreen();
      }
    });
  }

  // --- Refresh ---
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.location.reload();
    });
  }

  // --- Auto-refresh streams every 30 min ---
  setTimeout(function autoRefresh() {
    console.log('Auto-refreshing streams after 30 minutes...');
    Object.keys(webrtcInstances).forEach((id) => {
      try { webrtcInstances[id].close(); } catch (e) {}
      delete webrtcInstances[id];
    });
    Object.keys(hlsInstances).forEach((id) => {
      try { hlsInstances[id].destroy(); } catch (e) {}
      delete hlsInstances[id];
    });
    [mainVideo, pipVideo].forEach((v) => { v.srcObject = null; v.src = ''; });
    if (cameras[0]) initPlayer(cameras[0], mainVideo, mainOverlay);
    if (cameras[1]) initPlayer(cameras[1], pipVideo, pipOverlay);
    setTimeout(autoRefresh, 30 * 60 * 1000);
  }, 30 * 60 * 1000);
});
