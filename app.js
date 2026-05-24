(function () {
  const POLL_MS = 700;
  const SEEK_SECONDS = 10;
  const UNSUPPORTED_MESSAGE =
    "This does not look like a playable video link. Paste a direct video URL or supported video page link.";

  const els = {
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
    pendingPlay: false,
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
  }

  function setNowPlaying(text) {
    els.nowPlaying.textContent = text || "Nothing yet";
  }

  function showCodeOverlay(show) {
    els.codeOverlay.classList.toggle("hidden", !show);
    els.showCode.classList.toggle("hidden", show);
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
      return {
        mode: "youtube",
        originalUrl,
        playerUrl: `https://www.youtube.com/embed/${youtubeId}?playsinline=1&autoplay=1&rel=0&enablejsapi=1`,
        titleHint: `YouTube ${youtubeId}`,
        reason: "",
      };
    }

    const vimeoMatch = host === "vimeo.com" ? path.match(/^\/(\d+)/) : null;
    if (vimeoMatch) {
      return {
        mode: "vimeo",
        originalUrl,
        playerUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}?autoplay=1&playsinline=1`,
        titleHint: `Vimeo ${vimeoMatch[1]}`,
        reason: "",
      };
    }

    const dailyId = getDailymotionId(url, host);
    if (dailyId) {
      return {
        mode: "dailymotion",
        originalUrl,
        playerUrl: `https://www.dailymotion.com/embed/video/${dailyId}?autoplay=1`,
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
    els.tapToPlay.classList.add("hidden");
    els.playerHost.replaceChildren();
    state.video = null;
    state.iframe = null;
    state.currentMode = null;
    state.pendingPlay = false;
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
    showCodeOverlay(false);

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
      });
      video.addEventListener("error", () => {
        setStatus("The video could not be loaded. Try another direct file URL.", true);
      });
      els.playerHost.replaceChildren(video);
      state.video = video;
      await tryPlay();
      return;
    }

    const iframe = document.createElement("iframe");
    iframe.src = media.playerUrl;
    iframe.allow = "autoplay; fullscreen; picture-in-picture";
    iframe.allowFullscreen = true;
    iframe.title = media.titleHint || "Embedded video player";
    els.playerHost.replaceChildren(iframe);
    state.iframe = iframe;

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
      setStatus("Playing.");
    } catch {
      state.pendingPlay = true;
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
        state.iframe.contentWindow.postMessage(JSON.stringify({ event: "command", func, args: [] }), "*");
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

  async function executeCommand(payload) {
    if (!payload || payload.commandId === state.lastCommandId) {
      return;
    }
    state.lastCommandId = payload.commandId;

    if (payload.type === "cast") {
      await castVideo(payload.url);
      return;
    }

    const command = payload.command;
    if (state.video) {
      if (command === "playPause") {
        if (state.video.paused) {
          await tryPlay();
        } else {
          state.video.pause();
          setStatus("Paused.");
        }
      } else if (command === "play") {
        await tryPlay();
      } else if (command === "pause") {
        state.video.pause();
        setStatus("Paused.");
      } else if (command === "seekBack") {
        state.video.currentTime = Math.max(0, state.video.currentTime - SEEK_SECONDS);
        setStatus("Skipped back 10 seconds.");
      } else if (command === "seekForward") {
        state.video.currentTime = Math.min(state.video.duration || Infinity, state.video.currentTime + SEEK_SECONDS);
        setStatus("Skipped forward 10 seconds.");
      } else if (command === "stop") {
        state.video.pause();
        state.video.currentTime = 0;
        setStatus("Stopped.");
      } else if (command === "fullscreen") {
        requestFullscreen(state.video);
      }
      return;
    }

    if (state.iframe) {
      if (command === "playPause") {
        postToIframe("play");
        setStatus("Play/Pause sent. Embedded controls may be limited.");
      } else if (command === "play" || command === "pause") {
        postToIframe(command);
        setStatus(`${command[0].toUpperCase()}${command.slice(1)} sent. Embedded controls may be limited.`);
      } else if (command === "fullscreen") {
        requestFullscreen(state.iframe);
      } else if (command === "stop") {
        clearPlayer();
        renderEmpty("Ready to receive", "Cast a supported video link from your phone.");
        setNowPlaying("Nothing yet");
        setStatus("Stopped.");
      } else {
        setStatus("This embedded player does not support that remote command.");
      }
    }
  }

  function requestFullscreen(el) {
    if (el && el.requestFullscreen) {
      el.requestFullscreen().catch(() => setStatus("Fullscreen request was blocked by the display.", true));
    } else {
      setStatus("Fullscreen is not available on this display.", true);
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
    state.pollTimer = window.setInterval(pollSession, POLL_MS);
    pollSession();
  }

  window.resolveMediaUrl = resolveMediaUrl;
  init();
})();
