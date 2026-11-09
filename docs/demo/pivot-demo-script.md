# Pivot demo script: three minutes, one phone, four screens

A judge's phone has to go from QR scan to a committed site inside the first 60 seconds, or the remaining screens explain something nobody saw. Everything below is ordered around that. Source outline: [pivot kickoff](../../contracts/pivot/README.md#demo-in-three-minutes).

`HOST` is the public HTTPS hostname of the `web` Service. Driver assignments are a proposal; swap names in this file if the team decides otherwise.

## Screens

| # | Clock | Screen | URL | Driver | Say |
| --- | --- | --- | --- | --- | --- |
| 1 | 0:00 | Projector: QR, "Sites built" count, latest commit subject | `HOST/#/projector` | Kunj | "Scan this. No name, no email." |
| 2 | 0:10 | Judge's phone: five questions | `HOST/#/join` | Judge, Kunj narrates | "Role, up to three topics, level, an optional goal, a look." |
| 3 | 0:30 | Judge's phone: "Building your site", steps arrive one at a time | `HOST/#/site/<attendee_id>` | Judge | "Each line is something the agent just did: found sessions, chose a layout, wrote the page, committed it." |
| 4 | 0:45 | Judge's phone: their site, then a tap on a session | same | Judge | "That page did not exist a minute ago. The footer links the commit." |
| 5 | 1:00 | Laptop: trends | `HOST/#/trends` | Kunj | "That tap moved this bar. Click a topic and every chart filters." Click one topic chip, then "Real scans only". |
| 6 | 1:40 | Laptop: developer trail | `HOST/#/trail` | Anurup | Search "why schedule-first", open the run, open the commit on GitHub, copy the trace id into Dash0. |
| 7 | 2:20 | Radar: the agent pod, live log, events | Radar | Ahmed | "The agent is one Deployment. Here is the build we just watched." |
| 8 | 2:45 | Projector again | `HOST/#/projector` | Luke | "Every site is a commit, every decision is a document, every build is a trace." |

## Before the judges arrive

1. On the projector laptop open `HOST/#/`, choose Organizer, paste the organizer token and press "Use token". Then open `#/projector` in the same tab. The "Sites built" count reads the organizer-only trends route, and the token field is hidden on the projector view.
2. Scan the QR from a phone on cellular, not venue Wi-Fi. Submit one survey and confirm the site renders and the footer shows a commit link.
3. On `#/trends` confirm the "Includes N simulated attendees" line is visible. Say "simulated" out loud when the charts first appear.
4. Keep one finished `#/site/<attendee_id>` link open in a spare tab on the laptop.

## What is shown on screen, and what is not

- The survey collects role, interests, level, look and comfort settings. The optional goal line is used for retrieval only; the site and every public route omit it.
- The generated page renders in a frame with scripts disabled and a content policy that blocks all network loads. Taps are read by the surrounding page.
- "Your picks" under the frame is the same list in native controls. It is the keyboard and screen-reader path, and the fallback if the generated page has no session cards.
- The latest commit subject comes from GitHub's public API for the `agent/sites` branch, refreshed every 90 seconds, so it can trail the phone by up to that long.

## Fallbacks

| If | Then |
| --- | --- |
| The survey answers "a lot of sites are being built" | Press "Try again" once. If it repeats, use the spare tab from step 4. |
| The build stays on "Working on the next step" past 30 s | Narrate the steps already listed, switch to the spare tab, and show the stuck run on the trail screen as the honest example. |
| The site ends as a plain list titled "Your sessions" | The build failed and the page fell back. Say so, tap a session there; trends still move. |
| Trends show "Organizer access needed" | The token was not entered in this tab. Go to `#/`, enter it, come back. |
| The web rollout is not finished | Run `VITE_MOCK_API=false API_PROXY_TARGET=https://HOST npm run dev` from `apps/web` and demo from `http://localhost:5173`, which is an allowed origin. |
| Too few real scans | Leave "Real scans only" off and say the charts include simulated attendees. |

## Not yet rehearsed

This script has not been run end to end against the live API: at the time of writing the screens were verified against the in-browser mock only. The first rehearsal should time beats 2 to 4 on a real phone; if they take more than 50 seconds, cut the goal question from the narration rather than from the form.
