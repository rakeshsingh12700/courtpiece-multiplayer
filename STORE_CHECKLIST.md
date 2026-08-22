# Court Piece — App Store / Play Store Prep Checklist

Status as of 2026-08-23. This is a punch list, not a roadmap — items are
either done, blocked on you, or blocked on a decision. Nothing here is
urgent; the live game (server.js + public/ + the Cloudflare tunnel) was not
touched to produce this.

## Done (this pass)

- [x] Installed Capacitor tooling as devDependencies: `@capacitor/core@7.6.8`,
      `@capacitor/cli@7.6.8`, `@capacitor/android@7.6.8`, `@capacitor/ios@7.6.8`,
      plus `typescript@5.9.3` (required for the CLI to read a `.ts` config —
      see note below on why the version is pinned).
- [x] Ran `npx cap init` → `capacitor.config.ts` created at the project root.
      App name: **Court Piece**. Bundle ID: **com.rakeshsingh.courtpiece**
      (placeholder — see "Decisions you need to make" below).
- [x] `webDir` currently points at the local `public/` folder so the CLI had
      something to scaffold against. **This is not production-correct** — see
      the comment block at the top of `capacitor.config.ts` explaining that a
      real build needs a `server.url` pointing at a live hosted backend
      instead, since this is a real-time Socket.IO app, not a static site.
- [x] `npx cap add android` succeeded — `android/` directory scaffolded
      (Gradle project, manifest, resources). No Android Studio/SDK needed for
      this step; it's just template generation.
- [x] Drafted `privacy-policy.html` at the project root (self-contained,
      dark-green card-table aesthetic matching `public/style.css`). Content
      verified against actual app behavior by reading `public/client.js` and
      `server.js`: no accounts, `localStorage`-only player ID/name/avatar
      icon, live Socket.IO room connections, no server-side persistence
      (in-memory rooms only), no ads, no analytics, no tracking, no data
      sharing.
- [x] Committed all of the above locally (not pushed — see final `git status`
      in the task report).

## Blocked — needs your action, can't be automated here

- [ ] **Xcode (full app, not just Command Line Tools).** This machine only has
      `/Library/Developer/CommandLineTools` installed
      (`xcode-select -p` → `/Library/Developer/CommandLineTools`). No
      `Xcode.app` in `/Applications`. Installing full Xcode requires the Mac
      App Store and your Apple ID sign-in — genuinely can't be scripted
      headlessly, and it's a multi-GB download. **`npx cap add ios` failed**
      with:
      ```
      [error] CocoaPods is not installed.
              See this install guide: https://capacitorjs.com/docs/getting-started/environment-setup#homebrew
      ```
      CocoaPods itself is a small, separate install (`brew install cocoapods`)
      and wasn't installed here since it wasn't asked for and the deeper
      blocker (full Xcode) makes it moot for now — even with CocoaPods
      present, opening/building the iOS project still needs Xcode.app, not
      just the CLT. Do both when you're ready:
      1. Install Xcode from the Mac App Store (sign in with your Apple ID).
      2. `brew install cocoapods`
      3. `npx cap add ios` again.
- [ ] **Android Studio + Android SDK.** Not installed
      (`/Applications/Android Studio.app` not found, `$ANDROID_HOME` unset).
      `npx cap add android` itself succeeded (it only needed to copy Gradle
      template files), but you'll need Android Studio installed to actually
      open, build, sign, and run the project, or to get the SDK/build-tools
      for a CLI-only Gradle build.
- [ ] **Apple Developer Program enrollment** — $99/year. Requires identity
      verification that Apple says can take 1–2 days (sometimes longer).
      Needed before you can submit to the App Store or even do TestFlight
      builds signed for distribution. Start this early since it's a real
      calendar-time dependency, not just a click-through.
- [ ] **Google Play Console account** — $25 one-time registration fee. Also
      has an identity-verification step, though usually faster than Apple's.
- [ ] **Real app icon.** The web app currently only uses a 🃏 emoji in the
      page title/header (`public/index.html`: `<h1>🃏 Court Piece</h1>`) —
      there is no actual icon asset anywhere in the repo. Both stores require
      real icon files at multiple fixed sizes (iOS: up to 1024×1024
      App Store icon plus a set of in-app sizes; Android: adaptive icon
      foreground/background layers plus legacy sizes). This needs actual
      design work, not just dropping an emoji into a PNG — worth doing
      properly since it's the first thing anyone sees in either store.
- [ ] **Store listing screenshots.** Neither store submission is possible
      without device screenshots (multiple required sizes per platform).
      None exist yet. Easiest to generate once you're testing on
      a real device or a simulator/emulator, post-Xcode/Android-Studio
      install.
- [ ] **Confirm a live, stable backend URL.** I checked for one and did not
      find any evidence of a confirmed live Render deployment — `render.yaml`
      exists at the project root (a deploy config), but nothing in the repo
      references an actual `*.onrender.com` URL, and `run-tunnel.sh` shows the
      currently-running setup uses an ephemeral Cloudflare quick tunnel
      (`cloudflared tunnel --url http://localhost:3000`) rather than Render.
      A Cloudflare quick tunnel URL changes on reconnect and is not suitable
      to hardcode into a shipped app. Before building for real, confirm Render
      (or wherever you land) is actually deployed, stable, and has a URL that
      won't change out from under a published app — then update
      `capacitor.config.ts`'s `server.url` per the comment already left there.

## Decisions you need to make

- [ ] **Bundle ID.** `com.rakeshsingh.courtpiece` is a reasonable placeholder
      but is effectively permanent once you publish under it on either store.
      Confirm it (or pick something else) before your first real submission —
      changing it later means relisting as a new app, losing reviews/installs.
- [ ] **Push notifications for "it's your turn."** Not implemented, but worth
      doing seriously — and not just as a nice-to-have. A thin wrapper around
      an existing website is exactly what Apple's **App Review Guideline 4.2
      (Minimum Functionality)** targets for rejection: "your app provides a
      limited or no functionality... consider offering it as a website." A
      real-time multiplayer game already has a legitimate case for going
      native (sockets, low latency), but a genuinely useful native feature
      like turn notifications is the clearest way to make that case
      concretely to a reviewer, on top of also just being useful. This is
      real engineering work (native push via APNs/FCM, wiring server.js to
      send them, permission prompts, etc.) — not done here, flagging it as
      the single biggest risk item for iOS approval specifically.

## Notes on version choices (so future-you isn't confused)

- Capacitor 8.x is current upstream but requires **Node >=22**; this project
  currently targets **Node 20** (see `render.yaml`'s `NODE_VERSION: "20"`,
  and the installed local `node -v` → v20.20.0). Installing Capacitor 8
  produces a hard failure: `The Capacitor CLI requires NodeJS >=22.0.0`.
  Rather than bump the whole project's Node version as a side effect of
  Capacitor prep work, everything here is pinned to **Capacitor 7.6.8**,
  which fully supports Node 20 and is the latest 7.x release. Revisit this
  if/when the project moves to Node 22+.
- `typescript` is pinned to **5.9.3**, not latest. The newest available
  `typescript` package (7.0.2 in this registry) is a different, native-code
  compiler generation whose CommonJS interop shape broke Capacitor 7's
  internal `.ts` config loader (crashed with
  `TypeError: Cannot read properties of undefined (reading 'CommonJS')`).
  5.9.3 loads `capacitor.config.ts` correctly with this Capacitor version.
