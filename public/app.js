/* QuickSave app.js v8.9.5 */
console.log("QuickSave v8.9.5 loaded");

const AD_SECONDS   = 5;
const ICON_VERSION = "2";
const $ = id => document.getElementById(id);

/* ── Elements ── */
const url            = $("url"),
      paste          = $("paste"),
      go             = $("go"),
      drop           = $("drop"),
      status         = $("status"),
      result         = $("result"),
      mediaName      = $("name"),
      meta           = $("meta"),
      downloadBtn    = $("download"),
      thumb          = $("thumb"),
      progress       = $("progress"),
      bar            = $("bar"),
      progressText   = $("progressText"),
      progressPct    = $("progressPct"),
      install        = $("install"),
      iosInstall     = $("iosInstall"),
      iosDismiss     = $("iosDismiss"),
      autoToggle     = $("autoToggle"),
      autoLabel      = $("autoLabel"),
      retryBtn       = $("retryBtn"),
      queueStatus    = $("queueStatus"),
      queueText      = $("queueText"),
      updateBanner   = $("updateBanner"),
      bgStatus       = $("bgStatus"),
      bgStatusText   = $("bgStatusText"),
      bgStatusIcon   = $("bgStatusIcon"),
      adOverlay      = $("adOverlay"),
      countdownNum   = $("countdownNum"),
      skipCountdown  = $("skipCountdown"),
      adSkipBtn      = $("adSkipBtn"),
      ringProgress   = $("ringProgress"),
      bannerAdSlot   = $("bannerAdSlot"),
      resultBannerAd = $("resultBannerAd"),
      donateUpiBtn   = $("donateUpiBtn"),
      upiModal       = $("upiModal"),
      upiModalClose  = $("upiModalClose");

let current           = null;
let installPrompt     = null;
let autoProc          = false;
let lastUrl           = "";
let swReg             = null;
let newSW             = null;
let adTimer           = null;
let adCallback        = null;
let adsInjected       = false;
let resultAdsShown    = false;
let overlayAdInjected = false;

const RING_CIRC = 94.25;

/* ════════════════════════════════════════
   SUPPORTED PLATFORMS
════════════════════════════════════════ */
const SUPPORTED = [
  "instagram.com", "facebook.com", "fb.watch",
  "twitter.com", "x.com",
  "tiktok.com", "vm.tiktok.com"
];

/* ════════════════════════════════════════
   UTILS
════════════════════════════════════════ */
function isPWA() {
  return window.matchMedia("(display-mode: standalone)").matches ||
         navigator.standalone === true ||
         document.referrer.includes("android-app://");
}
function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}
function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
         navigator.standalone === true;
}
function isSupportedUrl(u) {
  try {
    const h = new URL(u).hostname.replace(/^www\./, "");
    return SUPPORTED.some(p => h.includes(p));
  } catch { return false; }
}
function sizeStr(n) {
  if (!n) return "";
  const u = ["B","KB","MB","GB"]; let i = 0;
  while (n >= 1024 && i < 3) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}
function buildDlUrl(d) {
  return d?.id ? `/api/download?id=${encodeURIComponent(d.id)}` : "#";
}
function msg(t, c = "") {
  status.textContent = t;
  status.className   = "status " + c;
  status.classList.toggle("hide", !t);
}

/* ════════════════════════════════════════
   ICON UPDATE PROMPT
════════════════════════════════════════ */
function checkIconUpdate() {
  const stored = localStorage.getItem("qs_icon_v");
  if (!stored) {
    localStorage.setItem("qs_icon_v", ICON_VERSION);
    return;
  }
  if (stored === ICON_VERSION) return;
  localStorage.setItem("qs_icon_v", ICON_VERSION);
  if (!isStandalone()) return;
  setTimeout(() => showIconUpdatePrompt(), 2000);
}

function showIconUpdatePrompt() {
  if (document.getElementById("iconUpdatePrompt")) return;
  const isIOSDevice = isIOS();
  const prompt = document.createElement("div");
  prompt.id    = "iconUpdatePrompt";
  prompt.style.cssText = `
    position: fixed; bottom: 24px; left: 50%;
    transform: translateX(-50%); z-index: 99999;
    background: #1c2033; border: 1px solid rgba(124,108,252,0.4);
    border-radius: 16px; padding: 16px 20px;
    width: min(90vw, 360px); box-shadow: 0 8px 32px rgba(0,0,0,0.6);
    font-family: system-ui, sans-serif; animation: iconPromptUp 0.3s ease;
  `;
  prompt.innerHTML = `
    <style>
      @keyframes iconPromptUp {
        from { transform: translateX(-50%) translateY(16px); opacity: 0; }
        to   { transform: translateX(-50%) translateY(0);    opacity: 1; }
      }
    </style>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
      <div style="width:44px;height:44px;flex-shrink:0;background:linear-gradient(135deg,#7c6cfc,#e83e8c);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;color:#fff;font-weight:900;">QS</div>
      <div style="flex:1;">
        <div style="font-size:14px;font-weight:700;color:#eee;">🎨 New Icon Available!</div>
        <div style="font-size:12px;color:#888;margin-top:2px;">Reinstall to update home screen icon</div>
      </div>
      <button onclick="document.getElementById('iconUpdatePrompt').remove()" style="background:rgba(255,255,255,0.08);border:none;color:#666;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:13px;flex-shrink:0;">✕</button>
    </div>
    <div style="background:rgba(124,108,252,0.08);border:1px solid rgba(124,108,252,0.2);border-radius:10px;padding:12px;font-size:12px;color:#aaa;line-height:1.9;margin-bottom:14px;">
      ${isIOSDevice
        ? `1. Open in <b style="color:#ddd">Safari</b><br>2. Tap <b style="color:#ddd">Share ⎋</b> button<br>3. Tap <b style="color:#ddd">"Add to Home Screen"</b><br>4. Delete old icon from home screen`
        : `1. Tap Chrome menu <b style="color:#ddd">⋮</b><br>2. Tap <b style="color:#ddd">"Add to Home Screen"</b><br>3. Delete old icon from home screen`
      }
    </div>
    <button onclick="document.getElementById('iconUpdatePrompt').remove()" style="width:100%;background:linear-gradient(135deg,#7c6cfc,#9b6bfc);color:#fff;border:none;padding:11px;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;font-family:system-ui,sans-serif;">Got it! 👍</button>
  `;
  document.body.appendChild(prompt);
  setTimeout(() => {
    try {
      const el = document.getElementById("iconUpdatePrompt");
      if (el) el.remove();
    } catch {}
  }, 15000);
}

/* ════════════════════════════════════════
   RESULT CARD ADS
   - Sirf tab dikhao jab result ready ho
   - Download shuru hone se pehle hide karo
════════════════════════════════════════ */
function showResultAds() {
  if (!resultBannerAd) return;

  /* Pehli baar In-Page Push inject karo */
  if (!adsInjected) {
    adsInjected = true;
    try {
      const s        = document.createElement("script");
      s.dataset.zone = "11897091";
      s.src          = "https://nap5k.com/tag.min.js";
      s.async        = true;
      s.setAttribute("data-cfasync", "false");
      document.body.appendChild(s);
      console.log("[ad] In-Page Push injected");
    } catch(e) {
      console.log("[ad] In-Page Push error:", e.message);
    }
  }

  /* Result banner ad */
  if (!resultAdsShown) {
    resultAdsShown = true;
    resultBannerAd.classList.remove("hide");
    try {
      const ins = document.createElement("ins");
      ins.className = "monetag-ad";
      ins.setAttribute("data-zone", "287137");
      resultBannerAd.innerHTML = "";
      resultBannerAd.appendChild(ins);

      const s = document.createElement("script");
      s.src   = "https://quge5.com/88/tag.min.js";
      s.setAttribute("data-zone", "287137");
      s.setAttribute("data-cfasync", "false");
      s.async   = true;
      s.onerror = () => showResultFallbackAd();
      document.body.appendChild(s);
      console.log("[ad] Result banner injected");
    } catch(e) {
      console.log("[ad] Result banner error:", e.message);
      showResultFallbackAd();
    }
  } else {
    /* Already inject ho chuka - sirf visible karo */
    resultBannerAd.classList.remove("hide");
  }
}

function hideResultAds() {
  if (resultBannerAd) {
    resultBannerAd.classList.add("hide");
  }
}

function showResultFallbackAd() {
  if (!resultBannerAd) return;
  resultBannerAd.innerHTML = `
    <div class="fallback-ad">
      <span>❤️</span>
      <div>
        <strong>Enjoying QuickSave?</strong>
        <small>Support us with a small donation</small>
      </div>
      <a href="https://www.paypal.me/nadeemhaidar"
         target="_blank" rel="noopener"
         class="fallback-ad-btn">Donate 💙</a>
    </div>
  `;
}

/* ════════════════════════════════════════
   OVERLAY AD INJECT
   - Download click ke baad overlay mein
     banner ad inject karo
════════════════════════════════════════ */
function injectOverlayAd() {
  if (!bannerAdSlot) return;

  /* Sirf ek baar inject karo */
  if (overlayAdInjected) return;
  overlayAdInjected = true;

  try {
    const ins = document.createElement("ins");
    ins.className = "monetag-ad";
    ins.setAttribute("data-zone", "287137");
    bannerAdSlot.innerHTML = "";
    bannerAdSlot.appendChild(ins);

    const s = document.createElement("script");
    s.src   = "https://quge5.com/88/tag.min.js";
    s.setAttribute("data-zone", "287137");
    s.setAttribute("data-cfasync", "false");
    s.async   = true;
    s.onerror = () => showOverlayFallbackAd();
    document.body.appendChild(s);
    console.log("[ad] Overlay banner injected");
  } catch(e) {
    console.log("[ad] Overlay banner error:", e.message);
    showOverlayFallbackAd();
  }
}

function showOverlayFallbackAd() {
  if (!bannerAdSlot) return;
  bannerAdSlot.innerHTML = `
    <div class="fallback-ad">
      <span>❤️</span>
      <div>
        <strong>Enjoying QuickSave?</strong>
        <small>Support us with a donation</small>
      </div>
      <a href="https://www.paypal.me/nadeemhaidar"
         target="_blank" rel="noopener"
         class="fallback-ad-btn">Donate 💙</a>
    </div>
  `;
}

/* ════════════════════════════════════════
   AD OVERLAY - Download click ke baad
════════════════════════════════════════ */
function showAdOverlay(onComplete) {
  adCallback = onComplete || null;

  /* ✅ Overlay mein ad inject karo */
  injectOverlayAd();

  adOverlay.classList.remove("hide");
  document.body.style.overflow = "hidden";

  if (ringProgress) {
    ringProgress.style.strokeDasharray  = `${RING_CIRC} ${RING_CIRC}`;
    ringProgress.style.strokeDashoffset = "0";
  }

  adSkipBtn?.classList.add("hide");

  let secs = AD_SECONDS;
  if (countdownNum)  countdownNum.textContent  = secs;
  if (skipCountdown) skipCountdown.textContent  = secs;

  if (adTimer) clearInterval(adTimer);

  adTimer = setInterval(() => {
    secs--;
    if (countdownNum)  countdownNum.textContent  = secs;
    if (skipCountdown) skipCountdown.textContent  = secs;

    if (ringProgress) {
      const elapsed = AD_SECONDS - secs;
      const offset  = RING_CIRC - (elapsed / AD_SECONDS) * RING_CIRC;
      ringProgress.style.strokeDashoffset = offset;
    }

    if (secs <= AD_SECONDS - 2) {
      adSkipBtn?.classList.remove("hide");
    }

    if (secs <= 0) {
      clearInterval(adTimer);
      adTimer = null;
      hideAdOverlay();
      triggerAdCallback();
    }
  }, 1000);
}

function hideAdOverlay() {
  adOverlay?.classList.add("hide");
  document.body.style.overflow = "";
  if (adTimer) { clearInterval(adTimer); adTimer = null; }
}

function triggerAdCallback() {
  if (adCallback) {
    const fn = adCallback;
    adCallback = null;
    setTimeout(fn, 50);
  }
}

adSkipBtn?.addEventListener("click", () => {
  hideAdOverlay();
  triggerAdCallback();
});

/* ════════════════════════════════════════
   DONATION - UPI Modal
════════════════════════════════════════ */
donateUpiBtn?.addEventListener("click", () => {
  upiModal?.classList.remove("hide");
  document.body.style.overflow = "hidden";
});

upiModalClose?.addEventListener("click", closeUpiModal);

upiModal?.addEventListener("click", e => {
  if (e.target === upiModal) closeUpiModal();
});

function closeUpiModal() {
  upiModal?.classList.add("hide");
  document.body.style.overflow = "";
}

document.querySelectorAll(".upi-app-btn").forEach(btn => {
  btn.addEventListener("click", () => setTimeout(closeUpiModal, 300));
});

/* ════════════════════════════════════════
   SMART FILENAME
════════════════════════════════════════ */
function getSmartFilename(filename) {
  const key       = "qs_dl_names";
  const usedNames = JSON.parse(localStorage.getItem(key) || "{}");
  const now       = Date.now();

  Object.keys(usedNames).forEach(k => {
    if (now - usedNames[k] > 24 * 60 * 60 * 1000) delete usedNames[k];
  });

  const ext     = filename.match(/\.[a-z0-9]+$/i)?.[0] || ".mp4";
  const base    = filename.replace(/\.[a-z0-9]+$/i, "");
  let finalName = filename;
  let counter   = 0;

  while (usedNames[finalName]) {
    counter++;
    finalName = `${base}_${counter}${ext}`;
  }

  usedNames[finalName] = now;
  localStorage.setItem(key, JSON.stringify(usedNames));
  return finalName;
}

/* ════════════════════════════════════════
   SAVE FILE
════════════════════════════════════════ */
async function saveFileToDevice(buffer, filename, contentType) {
  if (!buffer || buffer.byteLength < 1000)
    throw new Error("Invalid file data received");

  const smartName = getSmartFilename(filename);
  const mimeType  = contentType?.startsWith("video/") ? contentType
    : contentType?.startsWith("audio/") ? contentType
    : "video/mp4";

  const blob    = new Blob([buffer], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);

  const a         = document.createElement("a");
  a.href          = blobUrl;
  a.download      = smartName;
  a.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;";
  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    try { document.body.removeChild(a); } catch {}
    URL.revokeObjectURL(blobUrl);
  }, 5000);

  return smartName;
}

/* ════════════════════════════════════════
   BG STATUS UI
════════════════════════════════════════ */
function showBg(text, type = "processing", icon = "⏳") {
  if (!bgStatus) return;
  if (bgStatusText) bgStatusText.textContent = text;
  if (bgStatusIcon) bgStatusIcon.textContent = icon;
  bgStatus.className = `bg-status ${type}`;
  bgStatus.classList.remove("hide");
}
function hideBg(ms = 0) {
  if (ms) setTimeout(() => bgStatus?.classList.add("hide"), ms);
  else bgStatus?.classList.add("hide");
}

/* ════════════════════════════════════════
   QUEUE STATUS
════════════════════════════════════════ */
async function updateQ() {
  try {
    const d = await fetch("/api/queue").then(r => r.json());
    if (!queueStatus || !queueText) return;
    if (d.processing > 0 || d.waiting > 0) {
      queueStatus.classList.remove("hide");
      queueText.textContent = d.available
        ? "Server ready"
        : `${d.processing} processing, ${d.waiting} waiting`;
    } else {
      queueStatus.classList.add("hide");
    }
  } catch {}
}

/* ════════════════════════════════════════
   AUTO TOGGLE
════════════════════════════════════════ */
function isAutoOn() { return localStorage.getItem("qs_auto") !== "false"; }
function setAuto(v) {
  localStorage.setItem("qs_auto", v ? "true" : "false");
  autoToggle.checked    = v;
  autoLabel.textContent = v ? "Auto ON" : "Auto OFF";
}
autoToggle.addEventListener("change", () => setAuto(autoToggle.checked));

/* ════════════════════════════════════════
   SW MESSAGES
════════════════════════════════════════ */
function setupSWMessages() {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.addEventListener("message", async event => {
    const d = event.data || {};

    if (d.type === "SW_UPDATED") {
      console.log("[App] SW updated");
      checkIconUpdate();
      return;
    }

    if (d.type === "BG_STATUS") {
      switch(d.status) {
        case "processing":
          showBg("Processing your video...", "processing", "⏳");
          break;
        case "downloading":
          showBg(`Downloading ${d.filename || "video"}...`, "downloading", "⬇");
          break;
        case "error":
          showBg(d.msg || "Download failed. Try again.", "err", "❌");
          hideBg(5000);
          break;
      }
      return;
    }

    if (d.type === "SAVE_FILE") {
      showBg(`Saving ${d.filename}...`, "downloading", "⬇");
      try {
        const savedName = await saveFileToDevice(
          d.buffer, d.filename, d.contentType
        );
        showBg(`✅ "${savedName}" saved!`, "ok", "✅");
        msg("✅ Video saved to Downloads!", "ok");
        hideBg(6000);
      } catch(e) {
        showBg(`Save failed: ${e.message}`, "err", "❌");
        hideBg(5000);
      }
    }
  });
}

/* ════════════════════════════════════════
   SW VISIBLE
════════════════════════════════════════ */
function notifySWVisible() {
  if (!swReg?.active) return;
  try { swReg.active.postMessage({ type: "CLIENT_VISIBLE" }); } catch {}
}

/* ════════════════════════════════════════
   BACKGROUND DOWNLOAD
════════════════════════════════════════ */
async function startBgDownload(pageUrl) {
  if (!swReg?.active) return false;
  const dlId = `dl_${Date.now()}`;
  swReg.active.postMessage({
    type: "BG_DOWNLOAD",
    data: { url: pageUrl, id: dlId }
  });
  showBg("Processing. You can go back to your app!", "processing", "⏳");
  return true;
}

/* ════════════════════════════════════════
   SHARE TARGET
════════════════════════════════════════ */
async function handleShare(sharedUrl) {
  if (!isSupportedUrl(sharedUrl)) {
    msg("Only Instagram, TikTok, Facebook, Twitter/X links supported.", "err");
    return;
  }
  url.value = sharedUrl;
  if (isPWA() && swReg?.active) {
    const ok = await startBgDownload(sharedUrl);
    if (ok) return;
  }
  await processUrl(sharedUrl, true);
}

/* ════════════════════════════════════════
   UPDATE
════════════════════════════════════════ */
function showUpdateBanner() {
  updateBanner?.classList.remove("hide");
  $("updateNowBtn")?.addEventListener("click", () => {
    newSW?.postMessage({ type: "SKIP_WAITING" });
    updateBanner?.classList.add("hide");
  }, { once: true });
}

async function checkVersion() {
  try {
    const d  = await fetch("/api/version?t=" + Date.now()).then(r => r.json());
    const sv = localStorage.getItem("qs_sv");
    if (sv && sv !== d.version) {
      localStorage.setItem("qs_sv", d.version);
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      location.reload(true);
    } else {
      localStorage.setItem("qs_sv", d.version);
    }
  } catch {}
}

/* ════════════════════════════════════════
   CLIPBOARD
════════════════════════════════════════ */
async function tryAutoPaste() {
  if (!isAutoOn()) return null;
  try {
    const t = (await navigator.clipboard.readText()).trim();
    if (t && isSupportedUrl(t)) return t;
  } catch {}
  return null;
}

/* ════════════════════════════════════════
   MAIN PROCESS
════════════════════════════════════════ */
async function processUrl(value, autoDownload = false) {
  if (!value || autoProc) return;
  if (!isSupportedUrl(value)) {
    msg("Only Instagram, TikTok, Facebook, Twitter/X links supported.", "err");
    return;
  }

  autoProc    = true;
  lastUrl     = value;
  url.value   = value;
  go.disabled = true;

  /* Naya URL - result ads reset */
  resultAdsShown = false;
  hideResultAds();
  result.classList.add("hide");
  progress.classList.add("hide");

  const btnTxt = [...go.childNodes].find(n => n.nodeType === Node.TEXT_NODE);
  if (btnTxt) btnTxt.textContent = "Checking... ";
  updateQ();

  try {
    msg("Fetching media info...");

    const r = await fetch("/api/inspect", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ url: value })
    });
    const d = await r.json();
    updateQ();

    if (r.status === 503 && d.type === "queue-full")
      throw new Error(`Server busy (${d.queueSize} waiting). Try in 30 seconds.`);
    if (r.status === 408)
      throw new Error("Request timed out. Please try again.");
    if (!r.ok || !d.ok)
      throw new Error(d.message || "Could not process this link.");
    if (!d.id)
      throw new Error("Server error. Please try again.");

    current = d;
    mediaName.textContent = d.filename || "media.mp4";

    const platformEmoji = {
      instagram: "📸 Instagram",
      tiktok:    "🎵 TikTok",
      facebook:  "👥 Facebook",
      twitter:   "🐦 Twitter/X"
    };
    meta.textContent =
      (platformEmoji[d.platform] || "📹 Video") + " • " +
      (d.contentType || "mp4").replace("video/", "").toUpperCase() +
      (d.size ? " • " + sizeStr(d.size) : "");

    showPreview(d);
    downloadBtn.href = buildDlUrl(d);
    downloadBtn.setAttribute("download", d.filename || "QuickSave_Media.mp4");
    result.classList.remove("hide");
    msg("Ready! Tap the button below to download.", "ok");

    /* ✅ Result ready - result card ads dikhao */
    showResultAds();

    if (autoDownload && isAutoOn()) {
      setTimeout(() => triggerDownload(d), 600);
    }

  } catch(e) {
    console.error(e);
    msg("❌ " + (e.message || "Something went wrong."), "err");
  } finally {
    go.disabled = false;
    autoProc    = false;
    if (btnTxt) btnTxt.textContent = "Get media ";
    updateQ();
  }
}

/* ════════════════════════════════════════
   ACTUAL DOWNLOAD
════════════════════════════════════════ */
async function doActualDownload(d) {
  /* ✅ Download shuru - result ads hide karo */
  hideResultAds();

  progress.classList.remove("hide");
  progressText.textContent = "Downloading...";
  bar.style.width          = "15%";
  progressPct.textContent  = "15%";

  if (isIOS()) {
    window.location.href = buildDlUrl(d);
    setTimeout(() => {
      bar.style.width          = "100%";
      progressPct.textContent  = "100%";
      progressText.textContent = "Tap and hold the video to save to Photos.";
    }, 800);
    return;
  }

  try {
    bar.style.width         = "30%";
    progressPct.textContent = "30%";

    const response = await fetch(buildDlUrl(d));
    if (!response.ok) throw new Error(`Download failed (${response.status})`);

    bar.style.width         = "75%";
    progressPct.textContent = "75%";

    const ct     = (response.headers.get("content-type") || "video/mp4")
                     .split(";")[0].trim();
    const buffer = await response.arrayBuffer();

    const savedName = await saveFileToDevice(
      buffer, d.filename || "QuickSave_video.mp4", ct
    );

    bar.style.width          = "100%";
    progressPct.textContent  = "100%";
    progressText.textContent = `✅ "${savedName}" saved to Downloads!`;
    msg("✅ Video saved!", "ok");

  } catch(e) {
    console.error("[download]", e.message);
    progressText.textContent = "Download failed. Please try again.";
    msg("❌ " + e.message, "err");
  }
}

/* ════════════════════════════════════════
   TRIGGER DOWNLOAD
════════════════════════════════════════ */
function triggerDownload(d) {
  if (!d?.id) return;
  showAdOverlay(() => doActualDownload(d));
}

/* ════════════════════════════════════════
   PREVIEW
════════════════════════════════════════ */
function showPreview(d) {
  thumb.innerHTML = "";
  thumb.onclick   = () => window.open(
    `/api/download?id=${d.id}&inline=1`, "_blank"
  );
  if (d.thumbnail) {
    const img = new Image();
    img.src   = d.thumbnail;
    img.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:12px;";
    img.onload  = () => thumb.appendChild(img);
    img.onerror = () => { thumb.innerHTML = "<span>▶</span>"; };
  } else {
    thumb.innerHTML = "<span>▶</span>";
  }
}

/* ════════════════════════════════════════
   BUTTONS
════════════════════════════════════════ */
paste.onclick = async () => {
  try {
    const t = (await navigator.clipboard.readText()).trim();
    if (t) {
      url.value = t;
      paste.textContent = "✓ Pasted";
      setTimeout(() => (paste.textContent = "Paste"), 1500);
      if (isAutoOn() && isSupportedUrl(t)) processUrl(t, true);
    } else {
      msg("Clipboard is empty. Copy a link first.", "err");
    }
  } catch {
    msg("Clipboard unavailable. Please paste manually.", "err");
    url.focus();
  }
};

go.onclick = () => {
  const v = url.value.trim();
  if (!v) return msg("Please paste a media URL first.", "err");
  processUrl(v, false);
};

url.onkeydown = e => {
  if (e.key === "Enter") {
    const v = url.value.trim();
    if (v) processUrl(v, isAutoOn() && isSupportedUrl(v));
  }
};

downloadBtn.addEventListener("click", e => {
  if (!current?.id) return;
  e.preventDefault();
  triggerDownload(current);
});

if (retryBtn) retryBtn.onclick = e => {
  e.preventDefault();
  if (lastUrl) processUrl(lastUrl, false);
};

/* ════════════════════════════════════════
   DRAG & DROP
════════════════════════════════════════ */
["dragenter","dragover"].forEach(ev =>
  drop.addEventListener(ev, x => {
    x.preventDefault(); drop.classList.add("drag");
  })
);
["dragleave","drop"].forEach(ev =>
  drop.addEventListener(ev, x => {
    x.preventDefault(); drop.classList.remove("drag");
  })
);
drop.addEventListener("drop", e => {
  const t = e.dataTransfer.getData("text/plain") ||
            e.dataTransfer.getData("text/uri-list");
  if (t) processUrl(t.trim(), isAutoOn() && isSupportedUrl(t.trim()));
});

/* ════════════════════════════════════════
   PWA INSTALL
════════════════════════════════════════ */
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  installPrompt = e;
  if (!isIOS()) install.classList.remove("hidden");
});

install.onclick = async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  install.classList.add("hidden");
};

if (iosDismiss) {
  iosDismiss.onclick = () => {
    iosInstall?.classList.add("hidden");
    localStorage.setItem("qs_ios_dismissed", "true");
  };
}

/* ════════════════════════════════════════
   SERVICE WORKER
════════════════════════════════════════ */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      swReg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      console.log("[SW] Registered");

      swReg.addEventListener("updatefound", () => {
        newSW = swReg.installing;
        newSW.addEventListener("statechange", () => {
          if (newSW.state === "installed" && navigator.serviceWorker.controller)
            showUpdateBanner();
        });
      });

      navigator.serviceWorker.addEventListener("controllerchange",
        () => location.reload()
      );
      setupSWMessages();
      setInterval(() => swReg.update(), 5 * 60 * 1000);

    } catch(e) { console.log("[SW] Failed:", e); }
  });
}

/* ════════════════════════════════════════
   STARTUP
════════════════════════════════════════ */
async function onStartup() {
  /* ✅ Purana ad-disable bypass clear karo - sabke liye */
  localStorage.removeItem("qs_ads_disabled");

  setAuto(isAutoOn());
  checkVersion();
  checkIconUpdate();
  updateQ();
  setInterval(updateQ, 30000);
  setTimeout(() => notifySWVisible(), 1000);

  if (isIOS() && !isStandalone() && !localStorage.getItem("qs_ios_dismissed")) {
    setTimeout(() => iosInstall?.classList.remove("hidden"), 3000);
  }

  const params = new URLSearchParams(location.search);
  const shared = (
    params.get("url") || params.get("text") || params.get("title") || ""
  ).trim();

  if (shared && isSupportedUrl(shared)) {
    history.replaceState({}, "", "/");
    await new Promise(r => setTimeout(r, 800));
    await handleShare(shared);
    return;
  }

  if (params.get("action") === "paste") {
    history.replaceState({}, "", "/");
    setTimeout(() => paste.onclick?.(), 300);
    return;
  }

  if (isAutoOn()) {
    const auto = await tryAutoPaste();
    if (auto) {
      msg("Link detected. Processing...", "ok");
      await processUrl(auto, true);
    }
  }
}

/* ════════════════════════════════════════
   VISIBILITY CHANGE
════════════════════════════════════════ */
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible") return;
  notifySWVisible();
  if (autoProc) return;
  swReg?.update();
  checkVersion();
  updateQ();
  if (!isAutoOn()) return;
  await new Promise(r => setTimeout(r, 400));
  const auto = await tryAutoPaste();
  if (auto && auto !== url.value.trim()) {
    msg("New link detected. Processing...", "ok");
    await processUrl(auto, true);
  }
});

onStartup();
