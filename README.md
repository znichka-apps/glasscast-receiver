# GlassCast Receiver

GlassCast Receiver is a tiny Cast-like video receiver for Meta Ray-Ban Display glasses. It is not a web browser, not Google Chromecast, and does not use Chromecast protocols.

The glasses display opens `index.html`, generates a short session code, and polls a simple Vercel API route every 700ms. A phone opens `/phone`, enters that code, and sends video URLs or playback commands.

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

- Direct video files ending in `.mp4`, `.webm`, `.ogg`, or `.mov`
- YouTube watch/share/shorts URLs
- Vimeo URLs in the form `vimeo.com/VIDEO_ID`
- Dailymotion URLs in the form `dailymotion.com/video/VIDEO_ID` or `dai.ly/VIDEO_ID`

YouTube links are converted to an embed URL with `enablejsapi=1`. Vimeo and Dailymotion links are converted to their player embeds.

## Limitations

Unsupported links include bare `youtube.com`, YouTube search pages, generic website homepages, DRM/protected streaming services, random streaming sites that require ad popups/cookies/referrers/JavaScript click chains, and sites that block embedding.

The API uses in-memory serverless state. That keeps the MVP simple, but it is not durable and may reset when a serverless instance restarts or when Vercel routes requests to a different instance. A future production version should use durable shared storage such as Vercel KV.

Embedded player commands are best-effort. Native video files support play/pause/seek/stop/fullscreen directly. YouTube, Vimeo, and Dailymotion may require tapping play on the display or using their embedded controls depending on browser and embed restrictions.
