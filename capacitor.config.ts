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
// TEMPORARY, again: Render's auto-deploy stopped actually redeploying on
// push (confirmed - it was serving code from 2 commits back despite two
// successful `git push`es), so it can't be trusted mid-session right now.
// Pointed back at the tunnel, which is verified to match the exact latest
// local code. Switch back to the Render URL once its deploy pipeline is
// confirmed working again (check the Render dashboard for a failed/stuck
// build - that's the next thing to investigate, just not mid-game).
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
