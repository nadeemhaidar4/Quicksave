const express = require("express");
const dns = require("dns").promises;
const net = require("net");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const { Readable, Writable } = require("stream");
const { pipeline } = require("stream/promises");
const { execFile, spawn } = require("child_process");

const app = express();

const PORT             = process.env.PORT || 10000;
const MAX_BYTES        = 200 * 1024 * 1024;
const INSPECT_TIMEOUT  = 90000;
const DOWNLOAD_TIMEOUT = 300000;
const MAX_REDIRECTS    = 6;
const RATE_WINDOW      = 60 * 1000;
const RATE_LIMIT       = 20;
const PUBLIC_DIR       = path.join(__dirname, "public");
const COOKIES_FILE     = path.join(__dirname, "cookies.txt");
const TEMP_DIR         = path.join(__dirname, "tmp");

/* Temp dir banao */
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/* ════════════════════════════════════════
   QUEUE SYSTEM
════════════════════════════════════════ */
const MAX_CONCURRENT = 2;
const MAX_QUEUE_SIZE = 15;
const QUEUE_TIMEOUT  = 120000;

class RequestQueue {
  constructor() {
    this.queue      = [];
    this.processing = 0;
  }
  getStatus() {
    return {
      processing: this.processing,
      waiting:    this.queue.length,
      available:  this.processing < MAX_CONCURRENT
    };
  }
  add(fn) {
    return new Promise((resolve, reject) => {
      if (this.queue.length >= MAX_QUEUE_SIZE) {
        return reject(new Error(
          `Server is busy. ${this.queue.length} requests waiting. Please try again.`
        ));
      }
      const item = {
        fn, resolve, reject,
        addedAt: Date.now(),
        timeoutId: setTimeout(() => {
          const idx = this.queue.indexOf(item);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
            reject(new Error("Request timed out in queue. Please try again."));
          }
        }, QUEUE_TIMEOUT)
      };
      this.queue.push(item);
      console.log(`[queue] Added. Queue: ${this.queue.length}, Processing: ${this.processing}`);
      this._process();
    });
  }
  _process() {
    if (this.processing >= MAX_CONCURRENT) return;
    if (this.queue.length === 0) return;
    const item = this.queue.shift();
    clearTimeout(item.timeoutId);
    const waitTime = Date.now() - item.addedAt;
    console.log(`[queue] Processing. Waited: ${waitTime}ms, Remaining: ${this.queue.length}`);
    this.processing++;
    Promise.resolve()
      .then(() => item.fn())
      .then(r  => item.resolve(r))
      .catch(e => item.reject(e))
      .finally(() => {
        this.processing--;
        console.log(`[queue] Done. Processing: ${this.processing}, Waiting: ${this.queue.length}`);
        this._process();
      });
  }
}

const queue = new RequestQueue();

/* ════════════════════════════════════════
   MAPS & MIDDLEWARE
════════════════════════════════════════ */
const rateMap         = new Map();
const extractionCache = new Map();

/* TikTok ke liye alag cache - direct stream info */
const tiktokStreamCache = new Map();

app.use(express.json({ limit: "100kb" }));

/* ════════════════════════════════════════
   IP HELPERS
════════════════════════════════════════ */
function cleanIp(ip) {
  if (!ip) return "unknown";
  if (ip.includes(",")) ip = ip.split(",")[0].trim();
  if (ip.startsWith("::ffff:")) ip = ip.substring(7);
  return ip;
}
function isPrivateIPv4(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(Number.isNaN)) return false;
  const [a, b] = p;
  return a===10||a===127||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||a===0;
}
function isPrivateIPv6(ip) {
  const v = ip.toLowerCase();
  return v==="::1"||v==="::"||v.startsWith("fc")||v.startsWith("fd")||v.startsWith("fe80:");
}
async function isBlockedHost(hostname) {
  const host = hostname.toLowerCase();
  if (host==="localhost"||host.endsWith(".localhost")||host==="local"||
      host==="metadata.google.internal") return true;
  const type = net.isIP(host);
  if (type===4) return isPrivateIPv4(host);
  if (type===6) return isPrivateIPv6(host);
  try {
    const records = await dns.lookup(host, { all:true, verbatim:true });
    for (const r of records) {
      if (r.family===4 && isPrivateIPv4(r.address)) return true;
      if (r.family===6 && isPrivateIPv6(r.address)) return true;
    }
    return false;
  } catch { return true; }
}
async function validateUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") throw new Error("URL is required.");
  let url;
  try { url = new URL(rawUrl.trim()); }
  catch { throw new Error("Please enter a valid URL."); }
  if (!["http:","https:"].includes(url.protocol))
    throw new Error("Only HTTP and HTTPS URLs are supported.");
  if (await isBlockedHost(url.hostname))
    throw new Error("This URL cannot be accessed safely.");
  return url;
}

/* ════════════════════════════════════════
   RATE LIMIT
════════════════════════════════════════ */
function checkRateLimit(ip) {
  const now = Date.now();
  let r = rateMap.get(ip);
  if (!r || now - r.start > RATE_WINDOW) {
    r = { start: now, count: 0 };
    rateMap.set(ip, r);
  }
  r.count++;
  return r.count <= RATE_LIMIT;
}

/* ════════════════════════════════════════
   MEMORY CHECK
════════════════════════════════════════ */
function getMemoryMB() {
  return process.memoryUsage().heapUsed / 1024 / 1024;
}
function isMemorySafe() {
  const used = getMemoryMB();
  console.log(`[memory] Heap: ${used.toFixed(1)}MB`);
  return used < 450;
}

/* ════════════════════════════════════════
   HELPERS
════════════════════════════════════════ */
function filenameFromUrl(url, contentType="", customTitle=null) {
  const ext = contentType.includes("video") ? ".mp4"
    : contentType.includes("audio") ? ".mp3"
    : contentType.includes("image") ? ".jpg"
    : ".mp4";
  if (customTitle) {
    let t = customTitle
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 40);
    if (!t) t = "Media";
    return `QuickSave_${t}${ext}`;
  }
  let n = "";
  try { n = decodeURIComponent(path.basename(new URL(url).pathname)); } catch {}
  n = n.replace(/[^a-zA-Z0-9._-]/g, "_");
  return (!n || n === "." || n.length < 2) ? `QuickSave_Media${ext}` : n.slice(0, 50);
}
function getRawContentType(r) {
  return (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
}
function isValidMediaType(ct) {
  if (!ct) return false;
  if (ct.includes("json") || ct.includes("html") || ct.includes("text/") || ct.includes("xml"))
    return false;
  return ct.includes("video/") || ct.includes("audio/") || ct.includes("image/") ||
         ct === "application/octet-stream";
}

/* ════════════════════════════════════════
   PLATFORM DETECTION
════════════════════════════════════════ */
function getPlatform(urlStr) {
  try {
    const h = new URL(urlStr).hostname.replace(/^www\./, "");
    if (h.includes("instagram.com"))                          return "instagram";
    if (h.includes("facebook.com") || h.includes("fb.watch")) return "facebook";
    if (h.includes("twitter.com")  || h.includes("x.com"))    return "twitter";
    if (h.includes("tiktok.com")   || h.includes("vm.tiktok.com")) return "tiktok";
    return null;
  } catch { return null; }
}

function isSupportedUrl(urlStr) {
  try {
    const h = new URL(urlStr).hostname.replace(/^www\./, "");
    if (h.includes("cdninstagram.com") || h.includes("fbcdn.net") ||
        h.includes("twimg.com")) return false;
    return [
      "instagram.com", "facebook.com", "fb.watch",
      "twitter.com", "x.com",
      "tiktok.com", "vm.tiktok.com"
    ].some(p => h.includes(p));
  } catch { return false; }
}

/* ════════════════════════════════════════
   CACHE
════════════════════════════════════════ */
function makeDownloadId() { return crypto.randomBytes(12).toString("hex"); }

function cacheExtraction(originalUrl, extractedData) {
  const downloadId = makeDownloadId();
  const payload    = { ...extractedData, originalUrl, downloadId, createdAt: Date.now() };
  extractionCache.set(originalUrl,        payload);
  extractionCache.set(extractedData.url,  payload);
  extractionCache.set(downloadId,         payload);
  setTimeout(() => {
    extractionCache.delete(originalUrl);
    extractionCache.delete(extractedData.url);
    extractionCache.delete(downloadId);
  }, 10 * 60 * 1000);
  return payload;
}

/* ════════════════════════════════════════
   yt-dlp BINARY
════════════════════════════════════════ */
function getYtdlpBinary() {
  const locations = [
    "/usr/local/bin/yt-dlp",
    "/usr/bin/yt-dlp",
    process.env.YTDLP_PATH
  ].filter(Boolean);
  for (const loc of locations) {
    try { if (fs.existsSync(loc)) return loc; } catch {}
  }
  try {
    const pkg = require("youtube-dl-exec");
    const b   = pkg.path || pkg.binaryPath;
    if (b && fs.existsSync(b)) return b;
  } catch {}
  return "yt-dlp";
}
const YTDLP_BINARY = getYtdlpBinary();
console.log(`[yt-dlp] Binary: ${YTDLP_BINARY}`);

function runYtdlp(url, extraArgs, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const args = [
      url,
      "--dump-single-json",
      "--no-check-certificates",
      "--no-warnings",
      "--no-playlist",
      "--socket-timeout", "20",
      "--retries", "2",
      "--no-cache-dir",
      ...extraArgs
    ];
    if (fs.existsSync(COOKIES_FILE)) args.push("--cookies", COOKIES_FILE);

    execFile(YTDLP_BINARY, args, {
      timeout:   timeoutMs,
      maxBuffer: 30 * 1024 * 1024,
      env:       { ...process.env, PYTHONIOENCODING: "utf-8" }
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message || "").trim()));
        return;
      }
      try { resolve(JSON.parse(stdout)); }
      catch { reject(new Error("Failed to parse yt-dlp output")); }
    });
  });
}

function parseYtdlpOutput(output) {
  if (!output) return null;
  let directUrl = null, headers = {};

  if (output.url && output.url.startsWith("http")) {
    directUrl = output.url;
    headers   = { ...(output.http_headers || {}) };
  }
  if (!directUrl && output.requested_formats?.length) {
    const vf = output.requested_formats.find(f => f.url && f.vcodec && f.vcodec !== "none");
    if (vf) { directUrl = vf.url; headers = { ...(vf.http_headers || {}) }; }
  }
  if (!directUrl && output.formats?.length) {
    const valid = output.formats.filter(f => f.url && f.url.startsWith("http")).reverse();
    const best  = valid.find(f => f.vcodec !== "none" && f.acodec !== "none")
               || valid.find(f => f.vcodec !== "none")
               || valid[0];
    if (best) { directUrl = best.url; headers = { ...(best.http_headers || {}) }; }
  }

  if (!directUrl) return null;
  delete headers["Host"]; delete headers["host"];
  return {
    url:       directUrl,
    title:     output.title || output.id || "Video",
    thumbnail: output.thumbnail || null,
    headers,
    /* TikTok ke liye extra info */
    extractor: output.extractor || "",
    id:        output.id || ""
  };
}

/* ════════════════════════════════════════
   TIKTOK - Special handling
   
   TikTok CDN 403 deta hai direct fetch par
   Solution: yt-dlp se pipe karke stream karo
════════════════════════════════════════ */
function isTikTokUrl(urlStr) {
  try {
    const h = new URL(urlStr).hostname.replace(/^www\./, "");
    return h.includes("tiktok.com");
  } catch { return false; }
}

/* TikTok ke liye yt-dlp se direct stream */
function streamTikTokViaYtdlp(pageUrl, res, filename) {
  return new Promise((resolve, reject) => {
    console.log("[tiktok] Streaming via yt-dlp pipe:", pageUrl.slice(0, 60));

    const args = [
      pageUrl,
      "-f", "best[ext=mp4]/best",
      "-o", "-",                    /* stdout par output karo */
      "--no-check-certificates",
      "--no-warnings",
      "--no-playlist",
      "--socket-timeout", "30",
      "--retries", "2",
      "--no-cache-dir",
      "--add-header", "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "--add-header", "Referer:https://www.tiktok.com/",
    ];

    if (fs.existsSync(COOKIES_FILE)) args.push("--cookies", COOKIES_FILE);

    const proc = spawn(YTDLP_BINARY, args, {
      timeout: DOWNLOAD_TIMEOUT,
      env:     { ...process.env, PYTHONIOENCODING: "utf-8" }
    });

    const safeFilename    = filename.replace(/[\r\n"']/g, "");
    const encodedFilename = encodeURIComponent(safeFilename);

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition",
      `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`
    );
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    let totalBytes = 0;
    let headersSent = false;

    proc.stdout.on("data", chunk => {
      totalBytes += chunk.length;

      /* First chunk - response already set upar */
      if (!headersSent) {
        headersSent = true;
        res.status(200);
      }

      if (!res.write(chunk)) {
        proc.stdout.pause();
        res.once("drain", () => proc.stdout.resume());
      }

      /* Size limit */
      if (totalBytes > MAX_BYTES) {
        console.log("[tiktok] Size limit exceeded, killing process");
        proc.kill();
        res.destroy();
        reject(new Error("File exceeds size limit"));
      }
    });

    proc.stdout.on("end", () => {
      if (totalBytes < 1000) {
        reject(new Error("TikTok video download failed - no data received"));
        return;
      }
      res.end();
      const mb = (totalBytes / 1024 / 1024).toFixed(1);
      console.log(`[tiktok] ✓ Streamed ${mb}MB`);
      resolve({ bytes: totalBytes });
    });

    proc.stderr.on("data", data => {
      const msg = data.toString().trim();
      if (msg && !msg.includes("WARNING") && !msg.includes("[download]")) {
        console.log("[tiktok] yt-dlp:", msg.slice(0, 100));
      }
    });

    proc.on("error", err => {
      console.error("[tiktok] spawn error:", err.message);
      reject(new Error("Failed to start download process"));
    });

    proc.on("close", code => {
      if (code !== 0 && totalBytes < 1000) {
        reject(new Error(`TikTok download failed (exit code ${code})`));
      }
    });
  });
}

/* ════════════════════════════════════════
   EXTRACTORS
════════════════════════════════════════ */
async function extractInstagram(url) {
  const strategies = [
    {
      name: "chrome",
      args: [
        "-f", "best",
        "--add-header", "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "--add-header", "Accept-Language:en-US,en;q=0.9",
        "--add-header", "Referer:https://www.instagram.com/",
      ]
    },
    {
      name: "android",
      args: ["-f", "best", "--add-header", "User-Agent:Instagram 219.0.0.12.117 Android"]
    },
    { name: "default", args: ["-f", "best"] }
  ];
  for (const s of strategies) {
    try {
      console.log(`[instagram] Trying: ${s.name}`);
      const out = await runYtdlp(url, s.args);
      const res = parseYtdlpOutput(out);
      if (res?.url) { console.log(`[instagram] ✓ ${s.name}`); return res; }
    } catch(e) { console.log(`[instagram] ✗ ${s.name}:`, e.message.slice(0, 80)); }
  }
  throw new Error("Instagram video could not be extracted. It may be private or deleted.");
}

async function extractFacebook(url) {
  const strategies = [
    {
      name: "chrome",
      args: [
        "-f", "best",
        "--add-header", "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ]
    },
    {
      name: "mobile",
      args: [
        "-f", "best",
        "--add-header", "User-Agent:Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
      ]
    },
    { name: "default", args: ["-f", "best"] }
  ];
  for (const s of strategies) {
    try {
      console.log(`[facebook] Trying: ${s.name}`);
      const out = await runYtdlp(url, s.args);
      const res = parseYtdlpOutput(out);
      if (res?.url) { console.log(`[facebook] ✓ ${s.name}`); return res; }
    } catch(e) { console.log(`[facebook] ✗ ${s.name}:`, e.message.slice(0, 80)); }
  }
  throw new Error("Facebook video could not be extracted. It may be private.");
}

async function extractTwitter(url) {
  const strategies = [
    {
      name: "chrome",
      args: [
        "-f", "best[ext=mp4]/best",
        "--add-header", "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      ]
    },
    { name: "default", args: ["-f", "best[ext=mp4]/best"] }
  ];
  for (const s of strategies) {
    try {
      console.log(`[twitter] Trying: ${s.name}`);
      const out = await runYtdlp(url, s.args);
      const res = parseYtdlpOutput(out);
      if (res?.url) { console.log(`[twitter] ✓ ${s.name}`); return res; }
    } catch(e) { console.log(`[twitter] ✗ ${s.name}:`, e.message.slice(0, 80)); }
  }
  throw new Error("Twitter/X video could not be extracted.");
}

/* ── TikTok: JSON info + direct stream flag ── */
async function extractTikTok(url) {
  const strategies = [
    {
      name: "chrome-hd",
      args: [
        "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--add-header", "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "--add-header", "Referer:https://www.tiktok.com/",
        "--add-header", "Accept-Language:en-US,en;q=0.9",
      ]
    },
    {
      name: "best",
      args: [
        "-f", "best[ext=mp4]/best",
        "--add-header", "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "--add-header", "Referer:https://www.tiktok.com/",
      ]
    },
    {
      name: "mobile",
      args: [
        "-f", "best",
        "--add-header", "User-Agent:Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
      ]
    },
    { name: "default", args: ["-f", "best"] }
  ];

  for (const s of strategies) {
    try {
      console.log(`[tiktok] Trying: ${s.name}`);
      const out = await runYtdlp(url, s.args, 70000);
      const res = parseYtdlpOutput(out);
      if (res?.url) {
        console.log(`[tiktok] ✓ ${s.name} - ${res.title?.slice(0, 40)}`);
        /* TikTok ke liye needStream flag set karo */
        res.needStream = true;
        res.originalPageUrl = url;
        return res;
      }
    } catch(e) {
      console.log(`[tiktok] ✗ ${s.name}:`, e.message.slice(0, 80));
    }
  }
  throw new Error("TikTok video could not be extracted. Link may be invalid or expired.");
}

async function extractDirectVideoUrl(pageUrl) {
  const platform = getPlatform(pageUrl);
  console.log(`[extract] Platform: ${platform} | ${pageUrl.slice(0, 60)}`);
  if (!platform) throw new Error("Only Instagram, Facebook, Twitter/X, and TikTok links are supported.");
  if (platform === "instagram") return extractInstagram(pageUrl);
  if (platform === "facebook")  return extractFacebook(pageUrl);
  if (platform === "twitter")   return extractTwitter(pageUrl);
  if (platform === "tiktok")    return extractTikTok(pageUrl);
  throw new Error("Unsupported platform.");
}

/* ════════════════════════════════════════
   FETCH HELPERS
════════════════════════════════════════ */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchCDN(targetUrl, headers, signal) {
  const h = { "User-Agent": UA, "Accept": "*/*", "Accept-Encoding": "identity", ...headers };
  delete h["Host"]; delete h["host"]; delete h["Range"]; delete h["range"];
  return fetch(targetUrl, { method: "GET", headers: h, redirect: "follow", signal });
}

/* ════════════════════════════════════════
   STREAM
════════════════════════════════════════ */
async function streamToResponse(response, res, controller, startTime) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength && contentLength > MAX_BYTES)
    throw Object.assign(new Error("File exceeds size limit."), { status: 413 });
  if (!response.body) throw new Error("Media stream unavailable.");
  if (contentLength) res.setHeader("Content-Length", String(contentLength));

  const nodeStream = Readable.fromWeb ? Readable.fromWeb(response.body) : response.body;

  let total = 0, limitExceeded = false;
  const guard = new Writable({
    highWaterMark: 512 * 1024,
    write(chunk, _enc, cb) {
      if (limitExceeded) return cb();
      total += chunk.length;
      if (total > MAX_BYTES) {
        limitExceeded = true; controller.abort(); res.destroy();
        return cb(new Error("Size limit exceeded"));
      }
      if (!res.write(chunk)) res.once("drain", cb); else cb();
    },
    final(cb) {
      if (!limitExceeded) {
        res.end();
        const secs = ((Date.now() - startTime) / 1000).toFixed(1);
        const mbps = (total / 1024 / 1024 / parseFloat(secs)).toFixed(2);
        console.log(`[dl] ✓ ${(total / 1024 / 1024).toFixed(1)}MB in ${secs}s @ ${mbps}MB/s`);
      }
      cb();
    }
  });

  try { await pipeline(nodeStream, guard); }
  catch(e) { if (!limitExceeded && e.name !== "AbortError") throw e; }
}

/* ════════════════════════════════════════
   VERSION API
════════════════════════════════════════ */
app.get("/api/version", (_req, res) => {
  res.json({ version: "8.9.1", ok: true });
});

/* ════════════════════════════════════════
   HEALTH
════════════════════════════════════════ */
app.get("/health", (_req, res) => res.json({
  ok:      true,
  service: "QuickSave",
  version: "8.9.1",
  memory:  `${getMemoryMB().toFixed(1)}MB`,
  queue: {
    processing:    queue.processing,
    waiting:       queue.queue.length,
    maxConcurrent: MAX_CONCURRENT,
    maxQueueSize:  MAX_QUEUE_SIZE
  },
  ytdlp:   YTDLP_BINARY,
  cookies: fs.existsSync(COOKIES_FILE)
}));

/* ════════════════════════════════════════
   QUEUE STATUS
════════════════════════════════════════ */
app.get("/api/queue", (_req, res) => {
  res.json({
    ok:         true,
    processing: queue.processing,
    waiting:    queue.queue.length,
    available:  queue.processing < MAX_CONCURRENT
  });
});

/* ════════════════════════════════════════
   SHARE
════════════════════════════════════════ */
app.get("/share", (req, res) => {
  const shared = (req.query.url || req.query.text || req.query.title || "").trim();
  return shared
    ? res.redirect(302, `/?url=${encodeURIComponent(shared)}`)
    : res.redirect(302, "/");
});

/* ════════════════════════════════════════
   INSPECT
════════════════════════════════════════ */
app.post("/api/inspect", async (req, res) => {
  const ip = cleanIp(req.headers["x-forwarded-for"] || req.socket.remoteAddress);

  if (!checkRateLimit(ip))
    return res.status(429).json({ ok: false, message: "Too many requests. Please wait." });

  const rawUrl = req.body?.url;
  let urlObj;
  try { urlObj = await validateUrl(rawUrl); }
  catch(e) { return res.status(400).json({ ok: false, message: e.message }); }

  const targetUrlStr = urlObj.toString();

  if (!isSupportedUrl(targetUrlStr))
    return res.status(400).json({
      ok: false, type: "unsupported",
      message: "Only Instagram, Facebook, Twitter/X, and TikTok links are supported."
    });

  /* Cache check */
  if (extractionCache.has(targetUrlStr)) {
    const c = extractionCache.get(targetUrlStr);
    console.log("[inspect] Cache hit");
    return res.json({
      ok: true, type: "media", id: c.downloadId,
      downloadUrl: `/api/download?id=${c.downloadId}`,
      directUrl: c.url, url: c.url,
      originalUrl: targetUrlStr,
      contentType: "video/mp4",
      size: null,
      filename:  filenameFromUrl(c.url, "video/mp4", c.title),
      thumbnail: c.thumbnail,
      platform:  getPlatform(targetUrlStr),
      isTikTok:  !!c.needStream
    });
  }

  if (!isMemorySafe())
    return res.status(503).json({
      ok: false,
      message: "Server memory is high. Please try again in a moment."
    });

  try {
    const result = await queue.add(async () => {
      console.log(`[inspect] Processing: ${targetUrlStr.slice(0, 60)}`);

      const data = await extractDirectVideoUrl(targetUrlStr);
      const c    = cacheExtraction(targetUrlStr, data);

      /* TikTok ke liye alag response - CDN validate nahi karte */
      if (data.needStream) {
        const filename = filenameFromUrl(c.url, "video/mp4", c.title);
        console.log(`[inspect] TikTok ✓ ${filename} (stream mode)`);
        return {
          ok: true, type: "media", id: c.downloadId,
          downloadUrl: `/api/download?id=${c.downloadId}`,
          directUrl:   c.url, url: c.url,
          originalUrl: targetUrlStr,
          contentType: "video/mp4",
          size:        null,
          filename,
          thumbnail:   c.thumbnail,
          platform:    "tiktok",
          isTikTok:    true
        };
      }

      /* Normal platforms ke liye CDN validate karo */
      const controller = new AbortController();
      const timer      = setTimeout(() => controller.abort(), INSPECT_TIMEOUT);

      try {
        let response = null;
        try {
          const h = { "User-Agent": UA, "Accept": "*/*", ...(c.headers || {}) };
          delete h["Host"]; delete h["host"]; delete h["Range"]; delete h["range"];
          response = await fetch(c.url, {
            method: "HEAD", headers: h, redirect: "follow", signal: controller.signal
          });
        } catch { response = null; }

        let contentType   = response ? getRawContentType(response) : "video/mp4";
        let contentLength = response ? Number(response.headers.get("content-length") || 0) : 0;

        if (!response || !response.ok || !isValidMediaType(contentType)) {
          response      = await fetchCDN(c.url, c.headers || {}, controller.signal);
          contentType   = getRawContentType(response);
          contentLength = Number(response.headers.get("content-length") || 0);
          try { await response.body?.cancel(); } catch {}
        }

        if (contentType === "application/octet-stream") contentType = "video/mp4";

        if (!response.ok)
          throw new Error(`Media server returned HTTP ${response.status}.`);
        if (!isValidMediaType(contentType))
          throw new Error("This URL does not contain a valid media file.");
        if (contentLength && contentLength > MAX_BYTES)
          throw new Error("File is larger than the size limit.");

        const filename = filenameFromUrl(c.url, contentType, c.title);
        console.log(`[inspect] ✓ ${filename} ${contentType} ${contentLength}`);

        return {
          ok: true, type: "media", id: c.downloadId,
          downloadUrl: `/api/download?id=${c.downloadId}`,
          directUrl:   c.url, url: c.url,
          originalUrl: targetUrlStr,
          contentType: contentType || "video/mp4",
          size:        contentLength || null,
          filename, thumbnail: c.thumbnail,
          platform:    getPlatform(targetUrlStr),
          isTikTok:    false
        };

      } finally { clearTimeout(timer); }
    });

    return res.json(result);

  } catch(e) {
    console.error("[inspect] error:", e.message);

    if (e.message.includes("busy") || e.message.includes("waiting")) {
      return res.status(503).json({
        ok: false, type: "queue-full",
        message: e.message, queueSize: queue.queue.length
      });
    }
    if (e.message.includes("timed out in queue")) {
      return res.status(408).json({
        ok: false, type: "queue-timeout",
        message: "Request timed out. Please try again."
      });
    }

    return res.status(400).json({
      ok: false, type: "error",
      message: e.message || "Unable to process this URL."
    });
  }
});

/* ════════════════════════════════════════
   DOWNLOAD
════════════════════════════════════════ */
app.get("/api/download", async (req, res) => {
  const ip = cleanIp(req.headers["x-forwarded-for"] || req.socket.remoteAddress);

  if (!checkRateLimit(ip))
    return res.status(429).json({ ok: false, message: "Too many requests." });

  const startTime = Date.now();

  try {
    let targetUrl      = null;
    let extractedTitle = null;
    let customHeaders  = {};
    let originalUrl    = null;
    let needStream     = false; /* TikTok flag */
    let isTikTok       = false;

    const idParam = req.query.id ? String(req.query.id).trim() : null;

    if (idParam) {
      const cached = extractionCache.get(idParam);
      if (!cached)
        return res.status(410).json({
          ok: false,
          message: "Link expired. Please click 'Get media' again."
        });
      targetUrl      = cached.url;
      extractedTitle = cached.title;
      customHeaders  = cached.headers || {};
      originalUrl    = cached.originalUrl;
      needStream     = !!cached.needStream;
      isTikTok       = needStream;

    } else {
      let rawUrl = req.query.url;
      if (!rawUrl) return res.status(400).json({ ok: false, message: "id or url required." });

      for (let i = 0; i < 2; i++) {
        try {
          const d = decodeURIComponent(rawUrl);
          if (d === rawUrl) break;
          rawUrl = d;
        } catch { break; }
      }

      if (extractionCache.has(rawUrl)) {
        const c        = extractionCache.get(rawUrl);
        targetUrl      = c.url;
        extractedTitle = c.title;
        customHeaders  = c.headers || {};
        originalUrl    = c.originalUrl;
        needStream     = !!c.needStream;
        isTikTok       = needStream;
      } else {
        const validated = await validateUrl(rawUrl);
        targetUrl       = validated.toString();
        if (isSupportedUrl(targetUrl)) {
          originalUrl = targetUrl;
          const data  = await queue.add(() => extractDirectVideoUrl(targetUrl));
          const c     = cacheExtraction(targetUrl, data);
          targetUrl      = c.url;
          extractedTitle = c.title;
          customHeaders  = c.headers || {};
          needStream     = !!data.needStream;
          isTikTok       = needStream;
        }
      }
    }

    if (!isMemorySafe())
      return res.status(503).json({
        ok: false, message: "Server is busy. Please try again shortly."
      });

    /* ════════════════════════════════════════
       TIKTOK - yt-dlp se direct stream karo
       CDN fetch mat karo - 403 aata hai
    ════════════════════════════════════════ */
    if (isTikTok && originalUrl) {
      console.log("[tiktok] Using yt-dlp stream for:", originalUrl.slice(0, 60));

      const filename = filenameFromUrl(
        targetUrl, "video/mp4", extractedTitle
      );

      req.on("close", () => {
        console.log("[tiktok] Client disconnected");
      });

      try {
        await streamTikTokViaYtdlp(originalUrl, res, filename);
      } catch(e) {
        console.error("[tiktok] Stream failed:", e.message);
        if (!res.headersSent) {
          res.status(502).json({
            ok: false,
            message: "TikTok download failed. Please try again."
          });
        } else {
          res.destroy();
        }
      }
      return;
    }

    /* ════════════════════════════════════════
       NORMAL PLATFORMS - CDN fetch
    ════════════════════════════════════════ */
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT);
    req.on("close", () => { controller.abort(); clearTimeout(timer); });

    try {
      let response    = await fetchCDN(targetUrl, customHeaders, controller.signal);
      let contentType = getRawContentType(response);
      if (contentType === "application/octet-stream") contentType = "video/mp4";

      /* Response not ok - re-extract karo */
      if (!response.ok || !isValidMediaType(contentType)) {
        if (originalUrl && isSupportedUrl(originalUrl)) {
          try {
            const fresh = await queue.add(() => extractDirectVideoUrl(originalUrl));
            const c     = cacheExtraction(originalUrl, fresh);
            targetUrl      = c.url;
            customHeaders  = c.headers || {};
            extractedTitle = fresh.title;
            response       = await fetchCDN(targetUrl, customHeaders, controller.signal);
            contentType    = getRawContentType(response);
            if (contentType === "application/octet-stream") contentType = "video/mp4";
          } catch {
            return res.status(502).json({
              ok: false,
              message: "Media expired. Please click 'Get media' again."
            });
          }
        }
        if (!response.ok || !isValidMediaType(contentType)) {
          return res.status(502).json({
            ok: false,
            message: `Media fetch failed (${response.status}).`
          });
        }
      }

      const filename        = filenameFromUrl(targetUrl, contentType, extractedTitle);
      const safeFilename    = filename.replace(/[\r\n"']/g, "");
      const encodedFilename = encodeURIComponent(safeFilename);
      const wantInline      = req.query.inline === "1";

      res.status(200);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition",
        wantInline
          ? `inline; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`
          : `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`
      );
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Accept-Ranges", "none");
      res.setHeader("X-Content-Type-Options", "nosniff");

      await streamToResponse(response, res, controller, startTime);

    } finally { clearTimeout(timer); }

  } catch(e) {
    console.error("[dl] error:", e.message);
    if (!res.headersSent) {
      res.status(e.status || 400).json({
        ok:      false,
        message: e.name === "AbortError" ? "Download timed out." : e.message || "Download failed."
      });
    } else {
      res.destroy();
    }
  }
});

/* ════════════════════════════════════════
   STATIC + FALLBACK
════════════════════════════════════════ */
app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));
app.use((_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));
app.use((err, _req, res, next) => {
  console.error("Server error:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, message: "Internal server error." });
});

/* ════════════════════════════════════════
   START
════════════════════════════════════════ */
const server = app.listen(PORT, "0.0.0.0", () =>
  console.log(`QuickSave v8.9.1 running on port ${PORT}`)
);
server.keepAliveTimeout = 65000;
server.headersTimeout   = 66000;

function shutdown(sig) {
  console.log(sig + " received");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM",            () => shutdown("SIGTERM"));
process.on("SIGINT",             () => shutdown("SIGINT"));
process.on("uncaughtException",  e  => console.error("Uncaught:", e));
process.on("unhandledRejection", e  => console.error("Unhandled:", e));
