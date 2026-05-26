const http = require("http");
const fs = require("fs");
const path = require("path");
const sessionHandler = require("./api/session");

const PORT = Number(process.env.PORT || 3001);
const ROOT = __dirname;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
};

function serveFile(res, filePath) {
  const resolved = path.resolve(ROOT, filePath);
  if (!resolved.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(resolved, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(resolved)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}

function serveStatic(res, filePath) {
  const resolved = path.resolve(ROOT, filePath);
  const publicResolved = path.resolve(ROOT, "public", filePath);

  if (fs.existsSync(resolved)) {
    serveFile(res, filePath);
    return;
  }

  if (publicResolved.startsWith(path.resolve(ROOT, "public")) && fs.existsSync(publicResolved)) {
    serveFile(res, path.join("public", filePath));
    return;
  }

  serveFile(res, filePath);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/api/session" || url.pathname === "/api/session/state") {
    sessionHandler(req, res);
    return;
  }

  if (url.pathname === "/") {
    serveFile(res, "index.html");
    return;
  }

  if (url.pathname === "/phone") {
    serveFile(res, "phone.html");
    return;
  }

  const filePath = url.pathname.replace(/^\/+/, "");
  serveStatic(res, filePath);
});

server.listen(PORT, () => {
  console.log(`GlassCast Receiver dev server: http://localhost:${PORT}`);
});
