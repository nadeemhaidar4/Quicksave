# QuickSave Ultimate

Features:
- Animated download state/progress UI
- Direct image/video preview
- Drag & drop URL support
- Clipboard Paste
- PWA manifest + service worker + install button
- Local download history (browser only)
- Monetization-ready ad placement
- No login/database required
- Render health endpoint
- Rate limiting, active-download limits, timeouts, redirect limit, MIME allowlist, SSRF protections and 250 MB cap

## Render
Build: `npm ci`
Start: `npm start`
Health check: `/health`

## Important
The app is for direct/public media URLs that the user is authorized to download. It does not bypass private content, DRM, authentication or platform protections.

The "progress" shown in the current no-login UI tracks the download start state. Browser-native anchor downloads do not expose reliable byte-level progress without downloading the file through JavaScript, which would unnecessarily duplicate large media in memory. The backend itself streams the file with backpressure.

## v9.0.0 changes
- YouTube support added (watch / Shorts / youtu.be links) with anti-block layers: player-client rotation, optional YOUTUBE_PROXY, Piped API fallback, 4-hour YouTube cache.
- `YOUTUBE_ENABLED=false` env var disables YouTube instantly (Play Store safety switch).
- Closed open-proxy: /api/download now rejects non-supported platforms.
- Security: helmet headers, TLS verification on, exact hostname matching, sanitized error messages.
- cookies.txt is git-ignored; rate-limit map auto-cleans; dead code removed.

## cookies.txt (optional, improves success rate)
1. In your desktop browser, log in to YouTube/Instagram.
2. Export cookies with a "Get cookies.txt" extension, save as `cookies.txt` in the project root (Render: upload via shell or set at deploy).
3. NEVER commit cookies.txt — it is in .gitignore. Refresh it when logins expire.

## Env vars
- `YOUTUBE_PROXY` (optional): e.g. `http://user:pass@host:port` — used only for YouTube extraction.
- `YOUTUBE_ENABLED=false`: disables YouTube support without a code change.
- `YTDLP_PATH`: path to yt-dlp binary (Render sets /usr/local/bin/yt-dlp).

## yt-dlp updates
`postinstall` now updates to the latest STABLE yt-dlp (no more nightly). To update manually: `pip3 install -U yt-dlp` (then redeploy).
