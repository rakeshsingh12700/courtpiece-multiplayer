import type { CapacitorConfig } from '@capacitor/cli';

// PREP-WORK CONFIG — not final.
//
// bundleId ("com.rakeshsingh.courtpiece") is a placeholder. Change it to your
// real reverse-DNS identifier before submitting to either store — once an app
// is published under a bundle/application ID, that ID is effectively
// permanent (Apple and Google both treat it as immutable for a listed app).
//
// webDir currently points at the local public/ folder purely so `npx cap add`
// has something to copy into the native shell for this scaffolding pass.
// This is WRONG for a real build: Court Piece is a real-time multiplayer app
// (Socket.IO) that needs a live backend connection, not a bundled static
// snapshot of the client. Before building for real:
//   1. Confirm the Render deployment is live and stable at a stable URL.
//   2. Replace the `webDir`-only config below with a `server.url` pointing at
//      that hosted URL, e.g.:
//        server: { url: 'https://your-app.onrender.com', cleartext: false }
//      This makes the native shell load the live site directly (same model
//      Socket.IO already expects) instead of bundling a stale static copy.
// TEMPORARY: pointed at the live cloudflared tunnel so this can be tested on
// a real phone tonight. The tunnel URL changes if it restarts and this is
// not a permanent backend - swap this for the real Render URL (see notes
// above) before doing anything beyond your own testing, and definitely
// before any store submission.
const config: CapacitorConfig = {
  appId: 'com.rakeshsingh.courtpiece',
  appName: 'Court Piece',
  webDir: 'public',
  server: {
    url: 'https://author-masters-particles-verified.trycloudflare.com',
    cleartext: false
  }
};

export default config;
