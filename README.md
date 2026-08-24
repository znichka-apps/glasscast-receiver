# GlassCast Receiver

GlassCast Receiver is a tiny Cast-like video receiver for Meta Ray-Ban Display glasses. It is not a web browser, not Google Chromecast, and does not use Chromecast protocols.

The glasses display opens `index.html`, generates a short session code, and polls a simple Vercel API route every 700ms. A phone opens `/phone`, enters that code, and sends video URLs or playback commands.

The receiver also publishes playback state about once per second while media is loaded so a controller can show a scrubber when the active player supports timeline controls.

## Local Testing

Install dependencies:

```bash
npm install
```

Run the local dev server:

```bash
npm run dev
```

Open:

- Receiver: `http://localhost:3001`
- Phone controller: `http://localhost:3001/phone`

Keep both pages open. Enter the receiver session code into the phone page, paste a supported video URL, and press **Cast Video**.

## Deploy To Vercel

This project is designed for GitHub to Vercel deployment:

1. Push the repository to GitHub.
2. Import the GitHub repo into Vercel.
3. Use the default Vercel settings.
4. Deploy.

There is no build step. The API route lives in `api/session.js`, and `/phone` is rewritten to `/phone.html` by `vercel.json`.

## Add As A Meta Web App

After deployment, use the deployed HTTPS URL as the Meta Ray-Ban Display Web App URL. The receiver page is the root URL:

```text
https://your-project.vercel.app/
```

Use the phone controller from:

```text
https://your-project.vercel.app/phone
```

## Supported Links

GlassCast accepts:

- YouTube watch/share/shorts URLs
- YouTube live links where embeddable
- Vimeo URLs in the form `vimeo.com/VIDEO_ID`
- Dailymotion URLs in the form `dailymotion.com/video/VIDEO_ID` or `dai.ly/VIDEO_ID`
- Direct public video URLs

YouTube links are converted to an embed URL with `enablejsapi=1`. Vimeo and Dailymotion links are converted to their player embeds. Dailymotion playback is supported, but timeline controls are limited and reported as unavailable in playback state.

## Session API

Send a playback command:

```json
{
  "code": "ABC123",
  "type": "command",
  "command": "seekTo",
  "time": 123.4
}
```

Supported commands are `playPause`, `play`, `pause`, `seekBack`, `seekForward`, `seekTo`, `stop`, `fullscreen`, `captionsOn`, `captionsOff`, and `toggleCaptions`. `seekTo` uses seconds from the start of the active media. Caption commands report unavailable when the active source does not expose controllable caption tracks.

The receiver publishes playback state with:

```json
{
  "code": "ABC123",
  "type": "state",
  "state": {
    "currentTime": 123.4,
    "duration": 999,
    "playing": true,
    "mode": "youtube",
    "canSeek": true,
    "timelineAvailable": true,
    "controlsLimited": false,
    "captionsAvailable": true,
    "captionsEnabled": false,
    "title": "YouTube video",
    "url": "https://..."
  }
}
```

Controllers can read state with:

```text
GET /api/session/state?code=ABC123
```

Response:

```json
{
  "ok": true,
  "state": {
    "currentTime": 123.4,
    "duration": 999,
    "playing": true,
    "mode": "youtube",
    "canSeek": true,
    "timelineAvailable": true,
    "controlsLimited": false,
    "captionsAvailable": true,
    "captionsEnabled": false,
    "title": "YouTube video",
    "url": "https://..."
  }
}
```

For compatibility, `GET /api/session?code=ABC123` also includes `state` alongside the latest command payload.

## Limitations

Unsupported links include bare `youtube.com`, YouTube search pages, generic website homepages, DRM/protected streaming services, random streaming sites that require ad popups/cookies/referrers/JavaScript click chains, and sites that block embedding.

The API uses in-memory serverless state. That keeps the MVP simple, but it is not durable and may reset when a serverless instance restarts or when Vercel routes requests to a different instance. A future production version should use durable shared storage such as Vercel KV.

Embedded player commands are best-effort. Direct public video URLs support play/pause/seek/stop/fullscreen directly. YouTube and Vimeo may require tapping play on the display or using their embedded controls depending on browser and embed restrictions. Dailymotion playback is supported, but timeline/scrubbing controls are limited; `seekTo`, `seekBack`, and `seekForward` are acknowledged without seeking and playback state reports `canSeek: false`, `timelineAvailable: false`, and `controlsLimited: true`.

Caption controls use native HTML text tracks, YouTube's captions module, or Vimeo text tracks when the active video exposes them. Dailymotion and sources without controllable tracks report captions unavailable.
