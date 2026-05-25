(function () {
  const POLL_MS = 700;
  const SEEK_SECONDS = 10;
  const COMMAND_MAX_AGE_MS = 10000;
  const RECENT_COMMAND_LIMIT = 25;
  const PROCESSED_COMMANDS_KEY = "glasscast.processedCommandIds.v1";
  const UNSUPPORTED_MESSAGE =
    "This does not look like a playable video link. Paste a direct video URL or supported video page link.";
  const LOCAL_VIDEO_UNREACHABLE_MESSAGE =
    "Local video could not be reached. Make sure your phone and glasses are on the same Wi-Fi network and keep GlassCast open on your phone.";

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
    processedCommandIds: loadProcessedCommandIds(),
    processedCommandSet: null,
    processingCommandSet: new Set(),
    currentMode: null,
    video: null,
    iframe: null,
    youtubePlaying: false,
    youtubeCurrentTime: null,
    youtubeDuration: 0,
    youtubeIsLive: false,
    lastSeekCommand: null,
    mediaTitle: "",
    mediaUrl: "",
    pendingPlay: false,
    overlayVisible: true,
    isPlaying: false,
    overlayHideTimer: null,
    statePublishTimer: null,
    statePublishTimeout: null,
    lastStatePublishAt: 0,
    statePublishInFlight: false,
    pollTimer: null,
  };
  state.processedCommandSet = new Set(state.processedCommandIds);

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
    if (state.pendingPlay) {
      showOverlay();
      return;
    }

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

  function finiteSeconds(value) {
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  function isPlayableDuration(value) {
    return Number.isFinite(value) && value > 0;
  }

  function loadProcessedCommandIds() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PROCESSED_COMMANDS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string").slice(-RECENT_COMMAND_LIMIT) : [];
    } catch {
      return [];
    }
  }

  function persistProcessedCommandIds() {
    try {
      localStorage.setItem(PROCESSED_COMMANDS_KEY, JSON.stringify(state.processedCommandIds));
    } catch {
      // localStorage can be unavailable in private or restricted browser modes.
    }
  }

  function hasProcessedCommand(commandId) {
    return state.processedCommandSet.has(commandId);
  }

  function markCommandProcessed(commandId) {
    if (!commandId || state.processedCommandSet.has(commandId)) {
      return;
    }
    state.processedCommandIds.push(commandId);
    while (state.processedCommandIds.length > RECENT_COMMAND_LIMIT) {
      const removed = state.processedCommandIds.shift();
      state.processedCommandSet.delete(removed);
    }
    state.processedCommandSet.add(commandId);
    persistProcessedCommandIds();
  }

  function isStaleCommand(payload) {
    const createdAtMs = Date.parse(payload.createdAt);
    return !Number.isFinite(createdAtMs) || Date.now() - createdAtMs > COMMAND_MAX_AGE_MS;
  }

  async function acknowledgeCommand(commandId) {
    try {
      await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: state.code, type: "ack", commandId }),
      });
      console.info("[GlassCast] command acknowledged", { commandId });
    } catch (error) {
      console.warn("[GlassCast] command acknowledgement failed", { commandId, error });
    }
  }

  function getPlaybackState() {
    if (state.video && state.currentMode === "native-video") {
      return {
        currentTime: finiteSeconds(state.video.currentTime),
        duration: finiteSeconds(state.video.duration),
        playing: !state.video.paused && !state.video.ended,
        mode: "native-video",
        title: state.mediaTitle,
        url: state.mediaUrl,
      };
    }

    if (state.iframe && state.currentMode === "youtube") {
      return {
        currentTime: finiteSeconds(state.youtubeCurrentTime),
        duration: isPlayableDuration(state.youtubeDuration) ? state.youtubeDuration : 0,
        playing: state.youtubePlaying,
        mode: "youtube",
        title: state.mediaTitle,
        url: state.mediaUrl,
      };
    }

    if (state.iframe && ["vimeo", "dailymotion"].includes(state.currentMode)) {
      return {
        currentTime: 0,
        duration: 0,
        playing: state.isPlaying,
        mode: state.currentMode,
        title: state.mediaTitle,
        url: state.mediaUrl,
      };
    }

    return {
      currentTime: 0,
      duration: 0,
      playing: false,
      mode: state.currentMode === "unsupported" ? "unsupported" : "idle",
      title: state.mediaTitle,
      url: state.mediaUrl,
    };
  }

  async function publishPlaybackState(force) {
    const now = Date.now();
    const waitMs = 1000 - (now - state.lastStatePublishAt);

    if (!force && waitMs > 0) {
      return;
    }

    if (force && waitMs > 0) {
      if (!state.statePublishTimeout) {
        state.statePublishTimeout = window.setTimeout(() => {
          state.statePublishTimeout = null;
          publishPlaybackState(true);
        }, waitMs);
      }
      return;
    }

    if (state.statePublishInFlight) {
      return;
    }

    state.lastStatePublishAt = now;
    state.statePublishInFlight = true;
    try {
      await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: state.code, type: "state", state: getPlaybackState() }),
      });
    } catch {
      // State updates are advisory; command polling remains the user-visible connection signal.
    } finally {
      state.statePublishInFlight = false;
    }
  }

  function requestPlayerState() {
    if (state.currentMode === "youtube") {
      postToYoutube("getCurrentTime");
      postToYoutube("getDuration");
    }
  }

  function clearStatePublishTimer() {
    if (state.statePublishTimer) {
      window.clearInterval(state.statePublishTimer);
      state.statePublishTimer = null;
    }
    if (state.statePublishTimeout) {
      window.clearTimeout(state.statePublishTimeout);
      state.statePublishTimeout = null;
    }
  }

  function startStatePublishing() {
    clearStatePublishTimer();
    requestPlayerState();
    publishPlaybackState(true);
    state.statePublishTimer = window.setInterval(() => {
      requestPlayerState();
      publishPlaybackState(false);
    }, 1000);
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

  function isPrivateIpv4(hostname) {
    const parts = hostname.split(".");
    if (parts.length !== 4) {
      return false;
    }

    const octets = parts.map((part) => {
      if (!/^\d{1,3}$/.test(part)) {
        return -1;
      }
      return Number(part);
    });

    if (octets.some((octet) => octet < 0 || octet > 255)) {
      return false;
    }

    return (
      octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    );
  }

  function isLocalNetworkVideoUrl(url) {
    return (
      url.protocol === "http:" &&
      isPrivateIpv4(url.hostname) &&
      Boolean(url.port) &&
      url.pathname === "/video" &&
      url.searchParams.has("token")
    );
  }

  function resolveMediaUrl(input) {
    const originalUrl = String(input || "").trim();
    console.info("[GlassCast] resolveMediaUrl called", { url: originalUrl });
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
    const localNetworkVideo = isLocalNetworkVideoUrl(url);

    if (directVideoPattern.test(url.href) || localNetworkVideo) {
      return {
        mode: "native-video",
        originalUrl,
        playerUrl: originalUrl,
        titleHint: localNetworkVideo ? "Local video" : titleFromUrl(originalUrl),
        isLocalNetworkVideo: localNetworkVideo,
        reason: "",
      };
    }

    const youtube = getYoutubeVideo(url, host);
    if (youtube.id) {
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
        playerUrl: `https://www.youtube.com/embed/${youtube.id}?${params.toString()}`,
        titleHint: `YouTube ${youtube.id}`,
        isLive: youtube.isLive,
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

  function getYoutubeVideo(url, host) {
    const result = { id: "", isLive: false };

    if (host === "youtu.be") {
      result.id = cleanVideoId(url.pathname.slice(1));
      return result;
    }

    const youtubeHosts = new Set(["youtube.com", "m.youtube.com"]);
    if (!youtubeHosts.has(host)) {
      return result;
    }

    if (url.pathname === "/watch") {
      result.id = cleanVideoId(url.searchParams.get("v"));
      return result;
    }

    const live = url.pathname.match(/^\/live\/([^/?#]+)/);
    if (live) {
      result.id = cleanVideoId(live[1]);
      result.isLive = true;
      return result;
    }

    const shorts = url.pathname.match(/^\/shorts\/([^/?#]+)/);
    if (shorts) {
      result.id = cleanVideoId(shorts[1]);
    }
    return result;
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
    console.info("[GlassCast] player clear/load reset called", { mode: state.currentMode, url: state.mediaUrl });
    clearOverlayHideTimer();
    clearStatePublishTimer();
    els.tapToPlay.classList.add("hidden");
    els.playerHost.replaceChildren();
    state.video = null;
    state.iframe = null;
    state.currentMode = null;
    state.youtubePlaying = false;
    state.youtubeCurrentTime = null;
    state.youtubeDuration = 0;
    state.youtubeIsLive = false;
    state.lastSeekCommand = null;
    state.mediaTitle = "";
    state.mediaUrl = "";
    state.pendingPlay = false;
    state.isPlaying = false;
    els.shell.classList.remove("has-video", "has-critical-status");
    els.overlay.classList.remove("overlay-hidden");
    els.overlay.classList.add("overlay-visible");
    publishPlaybackState(true);
  }

  function showTapToPlay(message) {
    state.pendingPlay = true;
    setPlaybackActive(false);
    els.tapToPlay.classList.remove("hidden");
    els.tapToPlay.focus();
    setStatus(message || "Playback needs to be started on the glasses.");
    showOverlay();
  }

  function hideTapToPlay() {
    els.tapToPlay.classList.add("hidden");
    state.pendingPlay = false;
  }

  async function castVideo(url) {
    console.info("[GlassCast] player render/load called", { url });
    const media = resolveMediaUrl(url);
    console.info("[GlassCast] new cast received", { url, mode: media.mode, playerUrl: media.playerUrl });
    clearPlayer();

    if (media.mode === "unsupported") {
      state.currentMode = "unsupported";
      state.mediaTitle = "";
      state.mediaUrl = media.originalUrl;
      publishPlaybackState(true);
      renderEmpty("Unsupported link", media.reason);
      setNowPlaying("Nothing yet");
      setStatus(media.reason, true);
      return;
    }

    state.currentMode = media.mode;
    state.mediaTitle = media.titleHint || media.originalUrl;
    state.mediaUrl = media.originalUrl;
    setNowPlaying(media.titleHint || media.originalUrl);
    showCodeOverlay(true);
    showOverlay();

    if (media.mode === "native-video") {
      console.info("[GlassCast] native video element created", { url: media.playerUrl });
      const video = document.createElement("video");
      video.src = media.playerUrl;
      video.controls = false;
      video.playsInline = true;
      video.autoplay = true;
      video.preload = "auto";
      video.addEventListener("play", () => {
        hideTapToPlay();
        setPlaybackActive(true);
        setStatus("Playing.");
        publishPlaybackState(true);
      });
      video.addEventListener("pause", () => {
        setPlaybackActive(false);
        publishPlaybackState(true);
      });
      video.addEventListener("loadedmetadata", () => publishPlaybackState(true));
      video.addEventListener("seeked", () => publishPlaybackState(true));
      video.addEventListener("timeupdate", () => publishPlaybackState(false));
      video.addEventListener("ended", () => {
        setPlaybackActive(false);
        setStatus("Playback ended.");
        publishPlaybackState(true);
      });
      video.addEventListener("error", () => {
        setPlaybackActive(false);
        setStatus(
          media.isLocalNetworkVideo
            ? LOCAL_VIDEO_UNREACHABLE_MESSAGE
            : "The video could not be loaded. Try another direct file URL.",
          true,
        );
        publishPlaybackState(true);
      });
      els.playerHost.replaceChildren(video);
      state.video = video;
      els.shell.classList.add("has-video");
      startStatePublishing();
      await tryAutoplay();
      return;
    }

    const iframe = document.createElement("iframe");
    console.info("[GlassCast] iframe created", { mode: media.mode, src: media.playerUrl });
    iframe.id = `player-${media.mode}`;
    iframe.src = media.playerUrl;
    iframe.allow =
      media.mode === "youtube"
        ? "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
        : "autoplay; fullscreen; picture-in-picture";
    iframe.allowFullscreen = true;
    iframe.title = media.titleHint || "Embedded video player";
    iframe.addEventListener("load", () => {
      console.info("[GlassCast] iframe load event", { mode: media.mode, src: iframe.src });
      if (media.mode === "youtube") {
        state.iframe?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: iframe.id }), "*");
        requestPlayerState();
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
    state.youtubeIsLive = Boolean(media.isLive);
    setPlaybackActive(true);
    startStatePublishing();

    if (media.mode === "youtube") {
      setStatus("YouTube controls may require tapping play on the display.");
    } else if (media.mode === "dailymotion") {
      setStatus("Dailymotion controls and timeline are best-effort. If playback restarts, use the embedded controls.");
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

  async function tryAutoplay() {
    if (!state.video) {
      return false;
    }

    try {
      await state.video.play();
      hideTapToPlay();
      setPlaybackActive(true);
      setStatus("Playing.");
      publishPlaybackState(true);
      return true;
    } catch {
      showTapToPlay("Playback needs to be started on the glasses.");
      publishPlaybackState(true);
      return false;
    }
  }

  async function playFromTapToPlay() {
    if (!state.video) {
      return false;
    }

    try {
      await state.video.play();
      hideTapToPlay();
      setPlaybackActive(true);
      setStatus("Playing.");
      publishPlaybackState(true);
      scheduleOverlayHide();
      return true;
    } catch {
      showTapToPlay("Playback needs to be started on the glasses.");
      publishPlaybackState(true);
      return false;
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

  function youtubeTimelineUnavailable() {
    return state.youtubeIsLive;
  }

  function seekYoutubeTo(time) {
    if (youtubeTimelineUnavailable()) {
      setStatus("Timeline unavailable for this live stream.");
      publishPlaybackState(true);
      return;
    }
    const nextTime = Math.max(0, finiteSeconds(time));
    state.youtubeCurrentTime = nextTime;
    postToYoutube("seekTo", [nextTime, true]);
    publishPlaybackState(true);
  }

  function sendYoutubeSeek(command) {
    if (youtubeTimelineUnavailable()) {
      setStatus("Timeline unavailable for this live stream.");
      publishPlaybackState(true);
      return;
    }

    if (typeof state.youtubeCurrentTime !== "number" || Number.isNaN(state.youtubeCurrentTime)) {
      requestYoutubeTime();
      setCommandStatus(command, "sent. YouTube seek may be limited until playback starts");
      return;
    }

    const offset = command === "seekBack" ? -SEEK_SECONDS : SEEK_SECONDS;
    const nextTime = Math.max(0, state.youtubeCurrentTime + offset);
    seekYoutubeTo(nextTime);
    setCommandStatus(command, "sent to YouTube");
  }

  function sendYoutubeCommand(command, time) {
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
      publishPlaybackState(true);
      setStatus("Sent play/pause to YouTube. Command: playPause sent");
      return;
    }

    if (command === "play") {
      postToYoutube("playVideo");
      state.youtubePlaying = true;
      setPlaybackActive(true);
      publishPlaybackState(true);
      setStatus("Sent play to YouTube. Command: play sent");
      return;
    }

    if (command === "pause") {
      postToYoutube("pauseVideo");
      state.youtubePlaying = false;
      setPlaybackActive(false);
      publishPlaybackState(true);
      setStatus("Sent pause to YouTube. Command: pause sent");
      return;
    }

    if (command === "stop") {
      postToYoutube("stopVideo");
      state.youtubePlaying = false;
      setPlaybackActive(false);
      publishPlaybackState(true);
      setStatus("Sent stop to YouTube. Command: stop sent");
      return;
    }

    if (command === "seekBack" || command === "seekForward") {
      sendYoutubeSeek(command);
      return;
    }

    if (command === "seekTo") {
      seekYoutubeTo(time);
      setCommandStatus(command, "sent to YouTube");
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

  function sendVimeoCommand(command, time) {
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

    if (command === "seekTo") {
      postObjectToIframe({ method: "setCurrentTime", value: finiteSeconds(time) });
      setCommandStatus(command, "sent. Controls may be limited for this player");
      publishPlaybackState(true);
      return;
    }

    if (method) {
      postObjectToIframe({ method });
      if (command === "play" || (command === "playPause" && !state.isPlaying)) {
        setPlaybackActive(true);
      } else if (command === "pause" || command === "stop" || command === "playPause") {
        setPlaybackActive(false);
      }
      publishPlaybackState(true);
      setCommandStatus(command, "sent. Controls may be limited for this player");
      return;
    }

    setCommandStatus(command, "not supported. Controls may be limited for this player");
  }

  function sendDailymotionCommand(command, time) {
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

    if (command === "seekTo") {
      postObjectToIframe({ command: "seek", parameters: [finiteSeconds(time)] });
      setCommandStatus(command, "sent. Controls may be limited for this player");
      publishPlaybackState(true);
      return;
    }

    if (playerCommand) {
      postObjectToIframe({ command: playerCommand });
      if (command === "play" || (command === "playPause" && !state.isPlaying)) {
        setPlaybackActive(true);
      } else if (command === "pause" || command === "stop" || command === "playPause") {
        setPlaybackActive(false);
      }
      publishPlaybackState(true);
      setCommandStatus(command, "sent. Controls may be limited for this player");
      return;
    }

    setCommandStatus(command, "not supported. Controls may be limited for this player");
  }

  async function handleNativeVideoCommand(command, time) {
    const video = state.video;
    if (!video) {
      setCommandStatus(command, "ignored. No active video", true);
      return;
    }

    if (command === "playPause") {
      if (video.paused) {
        if (state.pendingPlay) {
          showTapToPlay("Use Tap to Play on the glasses to start this video.");
        } else {
          await tryAutoplay();
        }
      } else {
        video.pause();
        setCommandStatus(command, "sent");
      }
    } else if (command === "play") {
      if (state.pendingPlay) {
        showTapToPlay("Use Tap to Play on the glasses to start this video.");
      } else {
        await tryAutoplay();
      }
    } else if (command === "pause") {
      video.pause();
      setCommandStatus(command, "sent");
    } else if (command === "seekBack") {
      video.currentTime = Math.max(0, video.currentTime - SEEK_SECONDS);
      setCommandStatus(command, "sent");
    } else if (command === "seekForward") {
      video.currentTime = Math.min(video.duration || Infinity, video.currentTime + SEEK_SECONDS);
      setCommandStatus(command, "sent");
    } else if (command === "seekTo") {
      const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
      video.currentTime = Math.min(duration, Math.max(0, finiteSeconds(time)));
      publishPlaybackState(true);
      setCommandStatus(command, "sent");
    } else if (command === "stop") {
      video.pause();
      video.currentTime = 0;
      setPlaybackActive(false);
      publishPlaybackState(true);
      setCommandStatus(command, "sent");
    } else if (command === "fullscreen") {
      requestFullscreen(els.playerHost, command);
    }
  }

  async function handlePlaybackCommand(command, time) {
    showOverlayTemporarily();

    const mode = getActivePlayerMode();
    if (mode === "native-video") {
      await handleNativeVideoCommand(command, time);
    } else if (mode === "youtube") {
      sendYoutubeCommand(command, time);
    } else if (mode === "vimeo") {
      sendVimeoCommand(command, time);
    } else if (mode === "dailymotion") {
      sendDailymotionCommand(command, time);
    } else {
      setCommandStatus(command, "ignored. No active player", true);
    }
  }

  async function executeCommand(payload) {
    if (!payload) {
      return;
    }

    const commandId = typeof payload.commandId === "string" ? payload.commandId.trim() : "";
    const commandType = payload.type === "command" ? payload.command : payload.type;
    console.info("[GlassCast] command received", { commandId, type: commandType, createdAt: payload.createdAt });

    if (!commandId) {
      console.warn("[GlassCast] command ignored because commandId is missing", { type: commandType });
      return;
    }

    if (hasProcessedCommand(commandId) || state.processingCommandSet.has(commandId)) {
      console.info("[GlassCast] duplicate command ignored", { commandId, type: commandType });
      await acknowledgeCommand(commandId);
      return;
    }

    if (isStaleCommand(payload)) {
      console.warn("[GlassCast] stale command ignored", { commandId, type: commandType, createdAt: payload.createdAt });
      markCommandProcessed(commandId);
      await acknowledgeCommand(commandId);
      return;
    }

    state.processingCommandSet.add(commandId);
    showOverlayTemporarily();

    try {
      if (payload.type === "cast") {
        await castVideo(payload.url);
      } else if (payload.type === "command") {
        await handlePlaybackCommand(payload.command, payload.time);
      } else {
        console.warn("[GlassCast] command ignored because type is unsupported", { commandId, type: payload.type });
      }
      console.info("[GlassCast] command executed", { commandId, type: commandType });
    } finally {
      state.processingCommandSet.delete(commandId);
      markCommandProcessed(commandId);
      await acknowledgeCommand(commandId);
    }
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

  function normalizeYoutubeDuration(value) {
    return isPlayableDuration(value) ? value : 0;
  }

  function getYoutubeErrorMessage(errorInfo) {
    const rawCode =
      errorInfo && typeof errorInfo === "object" && "errorCode" in errorInfo ? errorInfo.errorCode : errorInfo;
    const numericCode = Number(rawCode);
    const debug = Number.isFinite(numericCode) ? ` Details: YouTube error ${numericCode}.` : "";
    const liveLike = state.youtubeIsLive || !isPlayableDuration(state.youtubeDuration);

    if (liveLike && [101, 150].includes(numericCode)) {
      return `This live stream may require YouTube sign-in or may not allow embeds.${debug}`;
    }

    if ([101, 150].includes(numericCode)) {
      return `This YouTube video cannot be played in an embedded player.${debug}`;
    }

    if (liveLike || [2, 5, 100].includes(numericCode)) {
      return `This live stream may be restricted or unavailable.${debug}`;
    }

    return `This YouTube video cannot be played in an embedded player.${debug}`;
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
      if (typeof data.info.duration === "number") {
        state.youtubeDuration = normalizeYoutubeDuration(data.info.duration);
      }
      if (data.info.videoData && typeof data.info.videoData.title === "string" && data.info.videoData.title.trim()) {
        state.mediaTitle = data.info.videoData.title.trim();
        setNowPlaying(state.mediaTitle);
      }
      if (typeof data.info.playerState === "number") {
        const wasPlaying = state.youtubePlaying;
        state.youtubePlaying = data.info.playerState === 1;
        if ([0, 1, 2].includes(data.info.playerState) && wasPlaying !== state.youtubePlaying) {
          setPlaybackActive(data.info.playerState === 1);
          publishPlaybackState(true);
        }
      }
      publishPlaybackState(false);
    }

    if (state.currentMode === "youtube" && data.event === "onError") {
      state.youtubePlaying = false;
      setPlaybackActive(false);
      setStatus(getYoutubeErrorMessage(data.info), true);
      publishPlaybackState(true);
    }

    if (state.currentMode === "vimeo") {
      if (data.event === "play") {
        setPlaybackActive(true);
        publishPlaybackState(true);
      } else if (data.event === "pause" || data.event === "ended") {
        setPlaybackActive(false);
        publishPlaybackState(true);
      } else if (data.method === "getCurrentTime" && typeof data.value === "number") {
        const nextTime =
          state.lastSeekCommand === "seekBack" ? Math.max(0, data.value - SEEK_SECONDS) : data.value + SEEK_SECONDS;
        postObjectToIframe({ method: "setCurrentTime", value: nextTime });
        state.lastSeekCommand = null;
        publishPlaybackState(true);
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
    els.tapToPlay.addEventListener("click", playFromTapToPlay);
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
