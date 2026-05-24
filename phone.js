(function () {
  const form = document.getElementById("castForm");
  const codeInput = document.getElementById("codeInput");
  const urlInput = document.getElementById("urlInput");
  const status = document.getElementById("phoneStatus");
  const controlButtons = document.querySelectorAll("[data-command]");
  const UNSUPPORTED_MESSAGE =
    "This does not look like a playable video link. Paste a direct video URL or supported video page link.";

  function normalizeCode() {
    const code = codeInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    codeInput.value = code;
    return code;
  }

  function setStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle("error", Boolean(isError));
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

    if (/\.(mp4|webm|ogg|mov)(?:$|[?#])/i.test(url.href)) {
      return { mode: "native-video", originalUrl, playerUrl: originalUrl, titleHint: originalUrl, reason: "" };
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
    if ((host === "youtube.com" || host === "m.youtube.com") && url.pathname === "/watch") {
      return cleanVideoId(url.searchParams.get("v"));
    }
    const shorts = host === "youtube.com" || host === "m.youtube.com" ? url.pathname.match(/^\/shorts\/([^/?#]+)/) : null;
    return shorts ? cleanVideoId(shorts[1]) : "";
  }

  function getDailymotionId(url, host) {
    if (host === "dai.ly") {
      return cleanVideoId(url.pathname.slice(1));
    }
    const match = host === "dailymotion.com" ? url.pathname.match(/^\/video\/([^/?#]+)/) : null;
    return match ? cleanVideoId(match[1]) : "";
  }

  function cleanVideoId(value) {
    return String(value || "").match(/^[A-Za-z0-9_-]+/)?.[0] || "";
  }

  async function sendPayload(payload) {
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Command failed.");
    }
    return data;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = normalizeCode();
    const url = urlInput.value.trim();
    const media = resolveMediaUrl(url);

    if (!code) {
      setStatus("Enter the session code from the display.", true);
      return;
    }

    if (media.mode === "unsupported") {
      setStatus(media.reason, true);
      return;
    }

    try {
      setStatus("Sending video...");
      await sendPayload({ code, type: "cast", url });
      setStatus("Video sent.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  codeInput.addEventListener("input", normalizeCode);

  controlButtons.forEach((button) => {
    button.addEventListener("click", async () => {
      const code = normalizeCode();
      if (!code) {
        setStatus("Enter the session code from the display.", true);
        return;
      }

      try {
        await sendPayload({ code, type: "command", command: button.dataset.command });
        setStatus(`${button.textContent.trim()} sent.`);
      } catch (error) {
        setStatus(error.message, true);
      }
    });
  });

  window.resolveMediaUrl = resolveMediaUrl;
})();
