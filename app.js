(function () {
  const POLL_MS = 700;
  const SEEK_SECONDS = 10;
  const UNSUPPORTED_MESSAGE =
    "This does not look like a playable video link. Paste a direct video URL or supported video page link.";

  const els = {
    shell: document.getElementById("receiverShell"),
    overlay: document.getElementById("receiverOverlay"),
    code: document.getElementById("sessionCode"),
    codeOverlay: document.getElementById("codeOverlay"),
    showCode: document.getElementById("showCodeButton"),
    playerHost: document.getElementById("playerHost"),
    tapToPlay: document.getElementById("tapToPlay"),
    nowPlaying: document.getElementById("nowPlaying"),
    status: document.getElementById("statusText"),
  };

  const state = {
    code: createSessionCode(),
    lastCommandId: null,
    currentMode: null,
    video: null,
    iframe: null,
    youtubePlaying: false,
    youtubeCurrentTime: null,
    lastSeekCommand: null,
    pendingPlay: false,
    overlayVisible: true,
    isPlaying: false,
    overlayHideTimer: null,
    pollTimer: null,
  };

  function createSessionCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return code;
  }

  function setStatus(message, isError) {
    els.status.textContent = message;
    els.status.classList.toggle("error", Boolean(isError));
    els.shell.classList.toggle("has-critical-status", Boolean(isError));
    if (isError) {
      showOverlay();
    } else if (state.isPlaying) {
      scheduleOverlayHide();
    }
  }

  function setNowPlaying(text) {
    els.nowPlaying.textContent = text || "Nothing yet";
  }

  function showCodeOverlay(show) {
    els.codeOverlay.classList.toggle("hidden", !show);
    els.showCode.classList.toggle("hidden", show);
  }

  function clearOverlayHideTimer() {
    if (state.overlayHideTimer) {
      window.clearTimeout(state.overlayHideTimer);
      state.overlayHideTimer = null;
    }
  }

  function shouldKeepOverlayVisible() {
    return state.pendingPlay || els.status.classList.contains("error") || !state.isPlaying;
  }

  function showOverlay() {
    state.overlayVisible = true;
    els.overlay.classList.remove("overlay-hidden");
    els.overlay.classList.add("overlay-visible");
  }

  function hideOverlay() {
    state.overlayHideTimer = null;

    if (shouldKeepOverlayVisible()) {
      showOverlay();
      return;
    }

    state.overlayVisible = false;
    els.overlay.classList.add("overlay-hidden");
    els.overlay.classList.remove("overlay-visible");
  }

  function scheduleOverlayHide() {
    clearOverlayHideTimer();
    if (shouldKeepOverlayVisible()) {
      showOverlay();
      return;
    }

    state.overlayHideTimer = window.setTimeout(hideOverlay, 3000);
  }

  function showOverlayTemporarily() {
    showOverlay();
    scheduleOverlayHide();
  }

  function setPlaybackActive(isPlaying) {
    state.isPlaying = Boolean(isPlaying);
    els.shell.classList.toggle("has-video", Boolean(state.video || state.iframe));

    if (state.isPlaying) {
      showOverlayTemporarily();
    } else {
      showOverlay();
    }
  }

  function titleFromUrl(url) {
    try {
      const parsed = new URL(url);
      const last = parsed.pathname.split("/").filter(Boolean).pop();
      return decodeURIComponent(last || parsed.hostname);
    } catch {
      return url;
    }
  }

  function resolveMediaUrl(input) {
    const originalUrl = String(input || "").trim();
    const base = {
      mode: "unsupported",
      originalUrl,
      playerUrl: "",
      titleHint: "",
      reason: UNSUPPORTED_MESSAGE,
    };

    let url;
    try {
      url = new URL(originalUrl);
    } catch {
      return base;
    }

    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname;
    const directVideoPattern = /\.(mp4|webm|ogg|mov)(?:$|[?#])/i;

    if (directVideoPattern.test(url.href)) {
      return {
        mode: "native-video",
        originalUrl,
        playerUrl: originalUrl,
        titleHint: titleFromUrl(originalUrl),
        reason: "",
      };
    }

    const youtubeId = getYoutubeId(url, host);
    if (youtubeId) {
      const params = new URLSearchParams({
        playsinline: "1",
        autoplay: "1",
        rel: "0",
        enablejsapi: "1",
        origin: window.location.origin,
      });
      return {
        mode: "youtube",
        originalUrl,
        playerUrl: `https://www.youtube.com/embed/${youtubeId}?${params.toString()}`,
        titleHint: `YouTube ${youtubeId}`,
        reason: "",
      };
    }

    const vimeoMatch = host === "vimeo.com" ? path.match(/^\/(\d+)/) : null;
    if (vimeoMatch) {
      return {
        mode: "vimeo",
        originalUrl,
        playerUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}?autoplay=1&playsinline=1&api=1`,
        titleHint: `Vimeo ${vimeoMatch[1]}`,
        reason: "",
      };
    }

    const dailyId = getDailymotionId(url, host);
    if (dailyId) {
      return {
        mode: "dailymotion",
        originalUrl,
        playerUrl: `https://www.dailymotion.com/embed/video/${dailyId}?autoplay=1&api=postMessage`,
        titleHint: `Dailymotion ${dailyId}`,
        reason: "",
      };
    }

    return base;
  }

  function getYoutubeId(url, host) {
    if (host === "youtu.be") {
      return cleanVideoId(url.pathname.slice(1));
    }

    const youtubeHosts = new Set(["youtube.com", "m.youtube.com"]);
    if (!youtubeHosts.has(host)) {
      return "";
    }

    if (url.pathname === "/watch") {
      return cleanVideoId(url.searchParams.get("v"));
    }

    const shorts = url.pathname.match(/^\/shorts\/([^/?#]+)/);
    return shorts ? cleanVideoId(shorts[1]) : "";
  }

  function getDailymotionId(url, host) {
    if (host === "dai.ly") {
      return cleanVideoId(url.pathname.slice(1));
    }

    if (host === "dailymotion.com") {
      const match = url.pathname.match(/^\/video\/([^/?#]+)/);
      return match ? cleanVideoId(match[1]) : "";
    }

    return "";
  }

  function cleanVideoId(value) {
    return String(value || "").match(/^[A-Za-z0-9_-]+/)?.[0] || "";
  }

  function clearPlayer() {
    clearOverlayHideTimer();
    els.tapToPlay.classList.add("hidden");
    els.playerHost.replaceChildren();
    state.video = null;
    state.iframe = null;
    state.currentMode = null;
    state.youtubePlaying = false;
    state.youtubeCurrentTime = null;
    state.lastSeekCommand = null;
    state.pendingPlay = false;
    state.isPlaying = false;
    els.shell.classList.remove("has-video", "has-critical-status");
    els.overlay.classList.remove("overlay-hidden");
    els.overlay.classList.add("overlay-visible");
  }

  async function castVideo(url) {
    const media = resolveMediaUrl(url);
    clearPlayer();

    if (media.mode === "unsupported") {
      renderEmpty("Unsupported link", media.reason);
      setNowPlaying("Nothing yet");
      setStatus(media.reason, true);
      return;
    }

    state.currentMode = media.mode;
    setNowPlaying(media.titleHint || media.originalUrl);
    showCodeOverlay(true);
    showOverlay();

    if (media.mode === "native-video") {
      const video = document.createElement("video");
      video.src = media.playerUrl;
      video.controls = false;
      video.playsInline = true;
      video.autoplay = true;
      video.preload = "auto";
      video.addEventListener("play", () => {
        els.tapToPlay.classList.add("hidden");
        state.pendingPlay = false;
        setPlaybackActive(true);
      });
      video.addEventListener("pause", () => {
        setPlaybackActive(false);
      });
      video.addEventListener("ended", () => {
        setPlaybackActive(false);
        setStatus("Playback ended.");
      });
      video.addEventListener("error", () => {
        setPlaybackActive(false);
        setStatus("The video could not be loaded. Try another direct file URL.", true);
      });
      els.playerHost.replaceChildren(video);
      state.video = video;
      els.shell.classList.add("has-video");
      await tryPlay();
      return;
    }

    const iframe = document.createElement("iframe");
    iframe.id = `player-${media.mode}`;
    iframe.src = media.playerUrl;
    iframe.allow = "autoplay; fullscreen; picture-in-picture";
    iframe.allowFullscreen = true;
    iframe.title = media.titleHint || "Embedded video player";
    iframe.addEventListener("load", () => {
      if (media.mode === "youtube") {
        state.iframe?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: iframe.id }), "*");
        requestYoutubeTime();
        if (state.youtubePlaying) {
          setPlaybackActive(true);
        }
      } else if (state.isPlaying) {
        scheduleOverlayHide();
      }
    });
    els.playerHost.replaceChildren(iframe);
    state.iframe = iframe;
    state.youtubePlaying = media.mode === "youtube";
    setPlaybackActive(true);

    if (media.mode === "youtube") {
      setStatus("YouTube controls may require tapping play on the display.");
    } else {
      setStatus("Embedded player controls are best-effort for this source.");
    }
  }

  function renderEmpty(title, message) {
    const wrapper = document.createElement("div");
    wrapper.className = "empty-state";
    wrapper.innerHTML = `<p></p><span></span>`;
    wrapper.querySelector("p").textContent = title;
    wrapper.querySelector("span").textContent = message;
    els.playerHost.replaceChildren(wrapper);
  }

  async function tryPlay() {
    if (!state.video) {
      return;
    }

    try {
      await state.video.play();
      els.tapToPlay.classList.add("hidden");
      state.pendingPlay = false;
      setPlaybackActive(true);
      setStatus("Playing.");
    } catch {
      state.pendingPlay = true;
      setPlaybackActive(false);
      els.tapToPlay.classList.remove("hidden");
      els.tapToPlay.focus();
      setStatus("Autoplay blocked. Select Tap to Play on the display.");
    }
  }

  function postToIframe(command) {
    if (!state.iframe || !state.iframe.contentWindow) {
      return;
    }

    if (state.currentMode === "youtube") {
      const func = command === "play" ? "playVideo" : command === "pause" ? "pauseVideo" : "";
      if (func) {
        postToYoutube(func);
      }
    } else if (state.currentMode === "vimeo") {
      const method = command === "play" || command === "pause" ? command : "";
      if (method) {
        state.iframe.contentWindow.postMessage({ method }, "*");
      }
    } else if (state.currentMode === "dailymotion") {
      const method = command === "play" ? "play" : command === "pause" ? "pause" : "";
      if (method) {
        state.iframe.contentWindow.postMessage({ command: method }, "*");
      }
    }
  }

  function getActivePlayerMode() {
    if (state.video && state.currentMode === "native-video") {
      return "native-video";
    }
    if (state.iframe && ["youtube", "vimeo", "dailymotion"].includes(state.currentMode)) {
      return state.currentMode;
    }
    return "none";
  }

  function setCommandStatus(command, result, isError) {
    setStatus(`Command: ${command} ${result}`, isError);
  }

  function postToYoutube(func, args) {
    if (!state.iframe?.contentWindow) {
      return false;
    }
    state.iframe.contentWindow.postMessage(JSON.stringify({ event: "command", func, args: args || [] }), "*");
    return true;
  }

  function requestYoutubeTime() {
    postToYoutube("getCurrentTime");
  }

  function sendYoutubeSeek(command) {
    if (typeof state.youtubeCurrentTime !== "number" || Number.isNaN(state.youtubeCurrentTime)) {
      requestYoutubeTime();
      setCommandStatus(command, "sent. YouTube seek may be limited until playback starts");
      return;
    }

    const offset = command === "seekBack" ? -SEEK_SECONDS : SEEK_SECONDS;
    const nextTime = Math.max(0, state.youtubeCurrentTime + offset);
    state.youtubeCurrentTime = nextTime;
    postToYoutube("seekTo", [nextTime, true]);
    setCommandStatus(command, "sent to YouTube");
  }

  function sendYoutubeCommand(command) {
    if (command === "playPause") {
      if (state.youtubePlaying) {
        postToYoutube("pauseVideo");
        state.youtubePlaying = false;
        setPlaybackActive(false);
      } else {
        postToYoutube("playVideo");
        state.youtubePlaying = true;
        setPlaybackActive(true);
      }
      setStatus("Sent play/pause to YouTube. Command: playPause sent");
      return;
    }

    if (command === "play") {
      postToYoutube("playVideo");
      state.youtubePlaying = true;
      setPlaybackActive(true);
      setStatus("Sent play to YouTube. Command: play sent");
      return;
    }

    if (command === "pause") {
      postToYoutube("pauseVideo");
      state.youtubePlaying = false;
      setPlaybackActive(false);
      setStatus("Sent pause to YouTube. Command: pause sent");
      return;
    }

    if (command === "stop") {
      postToYoutube("stopVideo");
      state.youtubePlaying = false;
      setPlaybackActive(false);
      setStatus("Sent stop to YouTube. Command: stop sent");
      return;
    }

    if (command === "seekBack" || command === "seekForward") {
      sendYoutubeSeek(command);
      return;
    }

    if (command === "fullscreen") {
      requestFullscreen(els.playerHost, command);
    }
  }

  function postObjectToIframe(message) {
    if (!state.iframe?.contentWindow) {
      return false;
    }
    state.iframe.contentWindow.postMessage(JSON.stringify(message), "*");
    return true;
  }

  function sendVimeoCommand(command) {
    const methodMap = {
      playPause: state.isPlaying ? "pause" : "play",
      play: "play",
      pause: "pause",
      stop: "unload",
      seekBack: "getCurrentTime",
      seekForward: "getCurrentTime",
    };
    const method = methodMap[command];

    if (command === "fullscreen") {
      requestFullscreen(els.playerHost, command);
      return;
    }

    if (command === "seekBack" || command === "seekForward") {
      state.lastSeekCommand = command;
      postObjectToIframe({ method });
      setCommandStatus(command, "sent. Controls may be limited for this player");
      return;
    }

    if (method) {
      postObjectToIframe({ method });
      if (command === "play" || (command === "playPause" && !state.isPlaying)) {
        setPlaybackActive(true);
      } else if (command === "pause" || command === "stop" || command === "playPause") {
        setPlaybackActive(false);
      }
      setCommandStatus(command, "sent. Controls may be limited for this player");
      return;
    }

    setCommandStatus(command, "not supported. Controls may be limited for this player");
  }

  function sendDailymotionCommand(command) {
    const commandMap = {
      playPause: state.isPlaying ? "pause" : "play",
      play: "play",
      pause: "pause",
      stop: "pause",
      seekBack: "seek",
      seekForward: "seek",
    };
    const playerCommand = commandMap[command];

    if (command === "fullscreen") {
      requestFullscreen(els.playerHost, command);
      return;
    }

    if (command === "seekBack" || command === "seekForward") {
      setCommandStatus(command, "sent. Controls may be limited for this player");
      postObjectToIframe({ command: playerCommand, parameters: [command === "seekBack" ? -SEEK_SECONDS : SEEK_SECONDS] });
      return;
    }

    if (playerCommand) {
      postObjectToIframe({ command: playerCommand });
      if (command === "play" || (command === "playPause" && !state.isPlaying)) {
        setPlaybackActive(true);
      } else if (command === "pause" || command === "stop" || command === "playPause") {
        setPlaybackActive(false);
      }
      setCommandStatus(command, "sent. Controls may be limited for this player");
      return;
    }

    setCommandStatus(command, "not supported. Controls may be limited for this player");
  }

  async function handleNativeVideoCommand(command) {
    const video = state.video;
    if (!video) {
      setCommandStatus(command, "ignored. No active video", true);
      return;
    }

    if (command === "playPause") {
      if (video.paused) {
        await tryPlay();
        setCommandStatus(command, "sent");
      } else {
        video.pause();
        setCommandStatus(command, "sent");
      }
    } else if (command === "play") {
      await tryPlay();
      setCommandStatus(command, "sent");
    } else if (command === "pause") {
      video.pause();
      setCommandStatus(command, "sent");
    } else if (command === "seekBack") {
      video.currentTime = Math.max(0, video.currentTime - SEEK_SECONDS);
      setCommandStatus(command, "sent");
    } else if (command === "seekForward") {
      video.currentTime = Math.min(video.duration || Infinity, video.currentTime + SEEK_SECONDS);
      setCommandStatus(command, "sent");
    } else if (command === "stop") {
      video.pause();
      video.currentTime = 0;
      setPlaybackActive(false);
      setCommandStatus(command, "sent");
    } else if (command === "fullscreen") {
      requestFullscreen(els.playerHost, command);
    }
  }

  async function handlePlaybackCommand(command) {
    showOverlayTemporarily();

    const mode = getActivePlayerMode();
    if (mode === "native-video") {
      await handleNativeVideoCommand(command);
    } else if (mode === "youtube") {
      sendYoutubeCommand(command);
    } else if (mode === "vimeo") {
      sendVimeoCommand(command);
    } else if (mode === "dailymotion") {
      sendDailymotionCommand(command);
    } else {
      setCommandStatus(command, "ignored. No active player", true);
    }
  }

  async function executeCommand(payload) {
    if (!payload || payload.commandId === state.lastCommandId) {
      return;
    }
    state.lastCommandId = payload.commandId;
    showOverlayTemporarily();

    if (payload.type === "cast") {
      await castVideo(payload.url);
      return;
    }

    await handlePlaybackCommand(payload.command);
  }

  function requestFullscreen(el, command) {
    if (el && el.requestFullscreen) {
      el
        .requestFullscreen()
        .then(() => setCommandStatus(command || "fullscreen", "sent"))
        .catch(() => setStatus("Fullscreen is not available here.", true));
    } else {
      setStatus("Fullscreen is not available here.", true);
    }
  }

  function parsePlayerMessage(data) {
    if (typeof data === "string") {
      try {
        return JSON.parse(data);
      } catch {
        return null;
      }
    }
    return data && typeof data === "object" ? data : null;
  }

  function handlePlayerMessage(event) {
    if (!state.iframe || event.source !== state.iframe.contentWindow) {
      return;
    }

    const data = parsePlayerMessage(event.data);
    if (!data) {
      return;
    }

    if (state.currentMode === "youtube" && data.event === "infoDelivery" && data.info) {
      if (typeof data.info.currentTime === "number") {
        state.youtubeCurrentTime = data.info.currentTime;
      }
      if (typeof data.info.playerState === "number") {
        const wasPlaying = state.youtubePlaying;
        state.youtubePlaying = data.info.playerState === 1;
        if ([0, 1, 2].includes(data.info.playerState) && wasPlaying !== state.youtubePlaying) {
          setPlaybackActive(data.info.playerState === 1);
        }
      }
    }

    if (state.currentMode === "youtube" && data.event === "onError") {
      state.youtubePlaying = false;
      setPlaybackActive(false);
      setStatus("YouTube player reported an error.", true);
    }

    if (state.currentMode === "vimeo") {
      if (data.event === "play") {
        setPlaybackActive(true);
      } else if (data.event === "pause" || data.event === "ended") {
        setPlaybackActive(false);
      } else if (data.method === "getCurrentTime" && typeof data.value === "number") {
        const nextTime =
          state.lastSeekCommand === "seekBack" ? Math.max(0, data.value - SEEK_SECONDS) : data.value + SEEK_SECONDS;
        postObjectToIframe({ method: "setCurrentTime", value: nextTime });
        state.lastSeekCommand = null;
      }
    }
  }

  async function pollSession() {
    try {
      const response = await fetch(`/api/session?code=${encodeURIComponent(state.code)}`, { cache: "no-store" });
      const payload = await response.json();
      if (payload && payload.ok && !payload.empty) {
        await executeCommand(payload);
      }
    } catch {
      setStatus("Waiting for connection...");
    }
  }

  function moveFocus(direction) {
    const focusables = Array.from(document.querySelectorAll(".focusable:not(.hidden)")).filter(
      (el) => !el.disabled && el.offsetParent !== null,
    );
    if (!focusables.length) {
      return;
    }

    const currentIndex = Math.max(0, focusables.indexOf(document.activeElement));
    const nextIndex =
      direction === "previous"
        ? (currentIndex - 1 + focusables.length) % focusables.length
        : (currentIndex + 1) % focusables.length;
    focusables[nextIndex].focus();
  }

  function handleKeys(event) {
    showOverlayTemporarily();

    if (["ArrowUp", "ArrowLeft"].includes(event.key)) {
      event.preventDefault();
      moveFocus("previous");
    } else if (["ArrowDown", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      moveFocus("next");
    } else if (event.key === "Enter" && document.activeElement?.classList.contains("focusable")) {
      event.preventDefault();
      document.activeElement.click();
    } else if (event.key === "Escape") {
      event.preventDefault();
      showCodeOverlay(true);
      els.showCode.classList.add("hidden");
    }
  }

  function init() {
    els.code.textContent = state.code;
    els.tapToPlay.addEventListener("click", tryPlay);
    els.showCode.addEventListener("click", () => showCodeOverlay(true));
    document.addEventListener("keydown", handleKeys);
    window.addEventListener("message", handlePlayerMessage);
    state.pollTimer = window.setInterval(pollSession, POLL_MS);
    pollSession();
  }

  window.resolveMediaUrl = resolveMediaUrl;
  window.handlePlaybackCommand = handlePlaybackCommand;
  init();
})();
