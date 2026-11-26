# MonkGuard

Switches off reels, shorts and games on a Mac during the hours you choose, and
you control it from your phone.

Works for a child's Mac, or for your own when you keep losing an hour to Shorts.
Nothing goes to the internet, there is no account to make, and nothing is
charged.

---

## Set it up

Three steps, a few minutes, on the Mac you want to guard. You need
[Node.js](https://nodejs.org) 18 or newer installed first.

**1. Install it.** Open the Terminal app and paste this:

```bash
npm install -g monkguard
monk install
```

It prints a PIN. Write it down — it is the only one you get, and it is not
stored anywhere you can read later.

**2. Say yes to one macOS question.** The first time MonkGuard looks at a
browser tab, macOS asks whether it may control Safari or Chrome. Click **OK**.
It needs this to see whether the page on screen is a Shorts feed or a maths
lesson.

Missed it? Open **System Settings → Privacy & Security → Automation** and switch
your browsers on under MonkGuard.

**3. Open it on your phone.** The install prints an address like
`http://10.0.0.42:8787`. Type it into your phone's browser, on the same wifi,
and enter the PIN. Add it to your Home Screen if you want it to feel like an app.

That is the whole setup. It starts again by itself every time the Mac is
switched on.

---

## Using it

The page has one card at the top that tells you what is happening right now:

> **Blocking now**
> Reels, games and long videos are stopped until 4:00 PM
>
> Pause blocking for  `15 min`  `1 hour`  `Until 10 PM`

A **pause** allows everything for that long, then blocking comes back by itself.
It does not change the setting below, so "Always" is still "Always" afterwards.
**Resume blocking now** ends a pause early.

Underneath, one setting decides when it blocks at all:

| | |
|---|---|
| **My schedule** | Blocks except during the free times you set. The normal choice. |
| **Always** | Blocks all day, ignoring the schedule. |
| **Never** | Blocks nothing until you change it back. |

**Free time windows** is where you say when the rules are off — after school,
weekend mornings, whatever suits. Inside a window nothing is enforced at all.
Everything outside them is focus time.

---

## What it actually does

During focus time, on that Mac:

- **Reels and shorts stop.** YouTube Shorts, Instagram Reels, TikTok, Facebook
  Reels. The page is replaced with a calm screen saying when it comes back.
- **Games stop.** Installed games get a warning first — *"closing in 60 seconds,
  save your game now"* — then close. Browser games like Poki and CrazyGames are
  blocked too.
- **Long video sessions get a break.** After 25 minutes of watching in a row,
  five minutes off, however much daily time is left.
- **Fun video has a daily limit** (30 minutes to start with). Lessons do not
  count against it.
- **Songs are free.** Listening to music is not screen time, so it is unlimited.
  A music video is watching, so that is counted. You can change which.

It can tell a maths lesson from a Fortnite montage by reading the video's title
and channel, with no AI needed.

When it sees an app it does not recognise behaving like a game, it does **not**
close it. It asks you, once, with two buttons. Your answer sticks.

---

## Questions people ask

**Two children, two Macs?**
Install it on each. They are completely separate — own PIN, own limits, own
page. Each page shows the address of the Mac it controls, and you can name them
("Anya's Mac") so your bookmarks stay apart. Nothing you do on one touches the
other.

**Can my child just quit it?**
It restarts within seconds. More usefully, you see the gap: *"MonkGuard was not
running for 6 minutes at 7:12 PM"*. If they know the Mac's admin password they
can remove anything, so the real answer is to give them a standard macOS
account, not an administrator one.

**Why does it close Firefox?**
Firefox gives no way to see which page is open, so during focus time it cannot
be checked — it is closed instead, with a note asking them to use Safari or
Chrome. You can switch this off.

**Does it work when I'm away from home?**
Your phone needs to be on the same wifi as the Mac. There is no cloud, by
design: a family tool should not need a company's servers to tell a laptop to
pause YouTube.

**What if I take the Mac to a café?**
Then only the Mac itself can open the page. MonkGuard answers other devices
only on the network you told it is home, so a laptop on a public network cannot
be poked at by strangers. You do not have to remember to switch anything off.

**I forgot the PIN.**
On the Mac itself: `monk set-pin 4821`.

**How do I remove it?**
`monk uninstall`, or `monk uninstall --purge` to delete its settings
and history too. Nothing is left behind.

---

## Is it safe to run?

- **Nothing leaves the Mac.** No accounts, no telemetry, no servers. The only
  outside request is asking YouTube for a video's title, so it can tell a lesson
  from a prank. If you choose to add a Claude API key, titles it cannot decide
  are also sent to Claude.
- **Your PIN is never sent over the wifi**, not even when you log in. The page
  proves it knows the PIN without transmitting it, so there is nothing to
  capture.
- **Only your home network** can reach the page, and only devices on it.
- **No third-party code at run time.** It runs on Node.js alone; TypeScript is
  used only to build it.

---

## For developers

```bash
git clone https://github.com/sandipsahoo2k2/monkguard.git && cd monkguard
npm install && npm test        # 87 tests, no real browser or apps needed
node dist/index.js probe       # one detection pass, printed
```

The detection logic is pure and lives in `src/domain`, behind small interfaces
in `src/domain/ports.ts`. macOS only appears in `src/platform/macos`, and the two
are joined in one place, `src/app/wiring.ts` — which is why the rules are tested
with fakes and no simulator.

The lists worth contributing to are in `src/domain/patterns.ts`: shorts
patterns, game sites, learning sites, music markers and the keyword weights.
A new rule is a file in `src/domain/rules/` plus one line in its `index.ts`.

---

## License

Created and owned by [Sandeep Sahoo](https://github.com/sandipsahoo2k2).

| You may | You may not |
|---|---|
| Use it, at home or anywhere, free | Sell it, changed or unchanged |
| Read, copy and change the code | Charge for a product, hosting or support whose value mainly comes from it |
| Share it, or your changes, for free | Remove the owner's notices or pass it off as your own |
| Contribute back ([how](CONTRIBUTING.md)) | Use the MonkGuard name for your own version |

This table is a summary. The [LICENSE](LICENSE) file is what counts: Apache 2.0
with the Commons Clause. Because it forbids selling, this is "source-available"
rather than open source in the OSI sense. For commercial permission, ask the
owner.
