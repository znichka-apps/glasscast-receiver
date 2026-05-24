const sessions = globalThis.__glasscastSessions || new Map();
globalThis.__glasscastSessions = sessions;

const COMMANDS = new Set(["playPause", "play", "pause", "seekBack", "seekForward", "seekTo", "stop", "fullscreen"]);
const MODES = new Set(["native-video", "youtube", "vimeo", "dailymotion", "unsupported", "idle"]);

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function cleanCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function commandId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function seconds(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function cleanState(value) {
  const input = value && typeof value === "object" ? value : {};
  const mode = MODES.has(input.mode) ? input.mode : "idle";
  const title = String(input.title || "").trim();
  const url = String(input.url || "").trim();
  const state = {
    currentTime: seconds(input.currentTime),
    duration: seconds(input.duration),
    playing: Boolean(input.playing),
    mode,
  };

  if (title) {
    state.title = title.slice(0, 300);
  }
  if (url) {
    state.url = url.slice(0, 2000);
  }

  return state;
}

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    const requestUrl = new URL(req.url, "http://localhost");
    const code = cleanCode(requestUrl.searchParams.get("code"));
    if (!code) {
      json(res, 400, { ok: false, error: "Missing session code." });
      return;
    }

    const latest = sessions.get(code);
    if (!latest) {
      json(res, 200, { ok: true, empty: true });
      return;
    }

    if (requestUrl.pathname === "/api/session/state" || requestUrl.searchParams.get("state") === "1") {
      json(res, 200, { ok: true, state: latest.state || null });
      return;
    }

    json(res, 200, { ok: true, ...(latest.command || {}), state: latest.state || null });
    return;
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      json(res, 400, { ok: false, error: error.message });
      return;
    }

    const code = cleanCode(body.code);
    if (!code) {
      json(res, 400, { ok: false, error: "Missing session code." });
      return;
    }

    if (body.type === "cast") {
      const url = String(body.url || "").trim();
      if (!url) {
        json(res, 400, { ok: false, error: "Missing video URL." });
        return;
      }
      const payload = { commandId: commandId(), type: "cast", url };
      const latest = sessions.get(code) || {};
      sessions.set(code, { ...latest, command: payload });
      json(res, 200, { ok: true, commandId: payload.commandId });
      return;
    }

    if (body.type === "command") {
      const command = String(body.command || "");
      if (!COMMANDS.has(command)) {
        json(res, 400, { ok: false, error: "Unsupported command." });
        return;
      }
      const payload = { commandId: commandId(), type: "command", command };
      if (command === "seekTo") {
        payload.time = seconds(body.time);
      }
      const latest = sessions.get(code) || {};
      sessions.set(code, { ...latest, command: payload });
      json(res, 200, { ok: true, commandId: payload.commandId });
      return;
    }

    if (body.type === "state") {
      const latest = sessions.get(code) || {};
      sessions.set(code, { ...latest, state: cleanState(body.state), stateUpdatedAt: Date.now() });
      json(res, 200, { ok: true });
      return;
    }

    json(res, 400, { ok: false, error: "Unsupported request type." });
    return;
  }

  res.setHeader("Allow", "GET, POST");
  json(res, 405, { ok: false, error: "Method not allowed." });
};
