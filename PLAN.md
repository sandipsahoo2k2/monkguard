# MonkGuard — calm focus for your Mac

One Mac, one family. No cloud, no accounts, no user base to manage. A single
background agent on the kid's Mac plus a phone-friendly admin page served on the
home wifi.

## 1. Product shape

```
┌─────────────────────────── kid's Mac ───────────────────────────┐
│  LaunchAgent (RunAtLoad + KeepAlive)                            │
│    monk background service (Node, zero dependencies)      │
│      ├── Scheduler      → is policy active right now?           │
│      ├── Sensors        → what is on screen / running           │
│      ├── Classifier     → game? shorts? educational video?      │
│      ├── Budgets        → how long today, how long in a row     │
│      ├── Enforcer       → warn → pause → close tab → quit app   │
│      └── HTTP server    → admin page + JSON API (port 8787)     │
└─────────────────────────────────────────────────────────────────┘
          ▲
          │  http://<mac-name>.local:8787   (PIN, same wifi)
      parent's phone
```

Why a LaunchAgent and not a kernel/network extension: content filters
(`NEFilterDataProvider`) and system extensions need a paid Developer ID plus user
approval of a system extension, and they still cannot see inside TLS to know a
YouTube URL is `/shorts/`. A user-session agent can read the actual tab URL and
title from the browser over Apple Events, which is strictly better signal, and it
installs with a shell script.

## 2. Time windows

The policy has one default state and a list of windows that flip it.

- `defaultState: focus` — rules apply unless a window says otherwise (recommended)
- Windows are `free` windows: inside them *nothing* is enforced. "Everything is
  allowed" means the rules literally do not run — no budget burn, no logging of
  violations, no enforcement.
- `defaultState: free` inverts it: windows become `focus` windows and the rest of
  the day is unrestricted.
- Per-weekday, HH:MM–HH:MM, windows may cross midnight.
- `mode` overrides everything: `auto` (follow schedule), `free` (allow all now),
  `lockdown` (enforce regardless of schedule).
- `Give 15 minutes` writes a `tempUnlockUntil` timestamp — free time that expires
  by itself, so the parent can't forget to turn restrictions back on.

## 3. Detection

Cheap signals run every 5 s. Expensive ones (ioreg, GPU, network lookups) run on
demand and are cached.

### 3.1 Is it a video game?

Layered, scored, and it learns. No hardcoded list can keep up with what kids
install, so unknown apps get scored by behaviour and the parent confirms once.

| Signal | Weight | How |
|---|---|---|
| `LSApplicationCategoryType` in the app's `Info.plist` starts with `public.app-category.*games*` | decisive | read the bundle's plist. Covers App Store + most commercial games |
| Known bundle ID (Steam, Epic, Battle.net, Roblox, Minecraft, GOG, itch, Riot, Crossover, TikTok…) | decisive | static list |
| Binary lives under a game library path (`…/Steam/steamapps/common`, `/Applications/Epic Games/`, `…/Roblox/`) | decisive | path prefix match |
| Parent already answered "this is a game" for this bundle ID | decisive | learned verdicts |
| App asserts `PreventUserIdleDisplaySleep` | +3 | `pmset -g assertions` — games and video players hold this; spreadsheets do not |
| Sustained CPU > 60 % while frontmost | +2 | `ps -o %cpu` sampled |
| GPU device utilisation > 40 % | +2 | `ioreg -c IOAccelerator` → `Device Utilization %` |
| A game controller is connected | +1 | `ioreg -c IOHIDDevice` |
| App is a known work/dev/browser app | veto | allowlist |

Score ≥ 5 → **candidate**. Candidates are not killed. They are queued in the
admin page as *"Unknown app behaving like a game: `Celeste` — 18 min today"*
with two buttons, Game / Not a game. One tap becomes a permanent verdict. After
that it is decisive and instant. The list of games the family actually owns
builds itself in a week and never produces a false kill of a homework app.

Browser games bypass app detection entirely, so they are matched on domain
(`poki.com`, `crazygames.com`, `now.gg`, `coolmathgames.com`,
`roblox.com/games`, `miniclip`, `addictinggames`, `y8.com` …) plus learned
domains the parent adds.

### 3.2 Is it reels / shorts?

The daemon enumerates **every open tab in every window** of Safari, Chrome,
Brave, Edge, Arc and Vivaldi over Apple Events, with the active tab flagged.

1. **Path match** — `youtube.com/shorts/`, `/feed/shorts`, `instagram.com/reel`,
   `/reels`, `/stories/`, `tiktok.com/*`, `facebook.com/reel`,
   `snapchat.com/spotlight`, `youtube.com/@*/shorts`.
2. **Behavioural scroll-feed detector** — the reliable one. A shorts feed changes
   the tab *title* every time the kid swipes. If a tab on a video domain changes
   title ≥ 4 times in 5 minutes, it is a scroll feed no matter what the URL says.
   This catches shorts embedded in the home feed, TikTok's SPA routes that don't
   change the path, and the "watch page that is really a feed".
3. **Mobile-site trick** — `m.youtube.com` and `web.whatsapp`-style PWA wrappers
   are matched on host, not path.

Enforcement for shorts is immediate and absolute during focus time: the tab's URL
is set to the daemon's own block page, which hard-stops playback (a `space`
keystroke would only pause it), and the page explains why and when it unlocks.

### 3.3 Is this video educational?

Only applies to real watch pages (`youtube.com/watch`, `youtu.be/…`). Decided in
this order, first hit wins, every answer cached on disk by video ID:

1. **Family channel allowlist / blocklist** — parent-curated, one tap from the
   activity log. `Khan Academy`, the kid's school channel, etc.
2. **Keyword model over title + channel** — two weighted lexicons (educational:
   lesson, tutorial, explained, proof, chapter, revision, documentary, experiment,
   how does, NCERT, class 8…; entertainment: gameplay, prank, reaction, vlog,
   compilation, satisfying, fortnite, mrbeast, shorts…). Title and channel are
   fetched from YouTube's **oEmbed** endpoint, which needs no API key and no
   scraping.
3. **Optional LLM pass** — if the parent pastes a Claude API key, ambiguous videos
   get one cheap classification call, cached forever. Without a key the keyword
   model decides. Nothing breaks offline.

### 3.4 Is it a song?

Songs are a third answer, not a kind of entertainment. Recognised from a
" - Topic" channel (YouTube generates those for licensed music), a VEVO or label
channel, title markers such as *Official Video*, *Lyrics*, *(Audio)*, *lofi*,
*unplugged*, or a music service domain. Allowed and unlimited by default, kept on
their own tally, and exempt from the continuous-watch break: an album playing
while somebody works is not a binge.

Educational videos burn the (generous or unlimited) *learning* budget.
Entertainment videos burn the *entertainment* budget and are subject to the
continuous-watch throttle.

### 3.4 The throttle

Two independent limits, both of which the user asked for:

- **Daily cap** — e.g. 30 min of entertainment video per day. Warning at T−2 min.
- **Continuous-watch cap** — e.g. 25 min in a row, then a forced 5 min break,
  regardless of daily budget left. This is the part that actually stops the
  three-hour autoplay hole.

## 4. Enforcement ladder

Never a surprise kill. Every step is logged and visible to the parent.

1. **Notify** — `display notification` at T−2 min: "2 minutes of video left".
2. **Hard-stop the content** — tab URL → block page. Playback cannot continue.
3. **Close the tab** — on repeat within the same minute.
4. **Quit the app** — games get a 60 s "save your game now" notification first,
   then `terminate()`, then `forceTerminate()` after a further grace.
5. Nothing is ever force-quit without a prior warning notification.

## 5. Tamper resistance (proportionate, not an arms race)

- `KeepAlive` in the LaunchAgent: killing the daemon restarts it in seconds.
- The gap is recorded. The parent's page shows "agent was down 4 min at 19:12",
  which is the real deterrent.
- Admin page needs a PIN (PBKDF2-SHA256, salted); config is only writable through
  the API; out-of-band edits to `config.json` are detected by checksum and logged.
- The service runs from its own ad-hoc signed app bundle, so the Automation
  permission belongs to MonkGuard rather than to whatever copy of `node` is on
  the machine, and survives a node upgrade.

## 6. Admin page

One page, mobile-first, no build step, no framework. Phone on the home wifi opens
`http://<mac>.local:8787`, enters the PIN once, and sees:

- A single status line: **Focus active** / **Free time until 20:00**.
- Three big buttons: `Auto`, `Allow all`, `Lock down`, plus `+15 min free`.
- Today: entertainment video, learning video, games blocked, shorts blocked.
- Pending questions ("is this a game?") — one tap each.
- Settings: free-time windows, the four numeric budgets, channel lists.

That is the whole surface. No dashboards, no multi-child org chart, no signup.

## 7. Permissions the parent grants once

| Permission | Why | Prompt |
|---|---|---|
| Automation → Safari / Chrome / … | read tab URLs, redirect to the block page, quit a browser that cannot be read | first browser check |
| (nothing else) | no Accessibility, no Screen Recording, no network extension, no admin password | |

## 8. Firefox, Tor and Opera

They expose no way to read their tabs, in any language. Watching them is not
possible, so during focus time they are closed instead, with the same warning a
game gets, and the kid is told to use Safari or Chrome. A browser nobody can see
inside is a hole wide enough for every reel on the internet.

## 9. What cannot be built, and why

- **Blocking inside other apps** (a Mac app that plays reels in its own window)
  needs a system network extension: a paid Apple Developer certificate and a
  system extension approval. On a Mac, reels and games live in the browser.
- **A kid with the admin password** can unload the service. It restarts itself,
  and every gap is logged and shown to the parent, which is deterrence rather
  than prevention. The real answer is a standard macOS account, not an admin one.
- **iPhones and iPads** are a different device and Apple Screen Time's job.

## 10. Out of scope on purpose

iOS/Android devices, router-level DNS, screenshot surveillance, keystroke logging,
multi-family SaaS, per-kid accounts beyond the macOS accounts that already exist.
