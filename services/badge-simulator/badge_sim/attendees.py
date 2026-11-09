"""Simulated attendees for the pivot demo (contracts/pivot, contract v1).

Each simulated attendee posts one survey with source "simulator", then taps zero to
three of its recommendations. The crowd has a shape so trend charts have something to
show: a few personas with different topic weights, and topics that grow over the run.

    python -m badge_sim.attendees --base-url http://incident-api:8000/api/v1 --count 150 --rate 0.5 --seed 7

No names, emails or device ids. `goal` is empty or one of a short fixed list. Repeated
429s stop the run instead of retrying hard (the API caps builds per hour).
"""

import argparse
import json
import random
import sys
import time
import urllib.error
import urllib.request

ROLES = ("attendee", "speaker", "staff", "organizer")
INTERESTS = (
    "observability", "platform-engineering", "ai-agents", "security", "networking",
    "storage-data", "gitops-delivery", "finops-sustainability", "wasm-edge", "community-careers",
)
LEVELS = ("new", "practitioner", "expert")
VIBES = ("calm", "bold", "playful")
ACCESSIBILITY = ("large_text", "reduced_motion", "high_contrast")
ACTIONS = ("open", "save", "dismiss")
GOALS = (
    "Find talks on cutting alert noise",
    "Learn how teams run internal platforms",
    "See real AI agent deployments",
    "Meet people working on supply chain security",
    "Understand GitOps at scale",
)

# Persona: (weight, topic weights, level weights, vibe weights)
PERSONAS = {
    "sre": (4, {"observability": 6, "platform-engineering": 3, "gitops-delivery": 2, "networking": 1},
            {"practitioner": 5, "expert": 3, "new": 1}, {"calm": 3, "bold": 2, "playful": 1}),
    "platform": (3, {"platform-engineering": 6, "gitops-delivery": 4, "finops-sustainability": 2, "storage-data": 1},
                 {"practitioner": 4, "expert": 2, "new": 2}, {"bold": 3, "calm": 2, "playful": 1}),
    "ml": (3, {"ai-agents": 6, "storage-data": 3, "observability": 2, "wasm-edge": 1},
           {"new": 3, "practitioner": 3, "expert": 1}, {"playful": 3, "bold": 2, "calm": 1}),
    "security": (2, {"security": 6, "networking": 3, "platform-engineering": 2},
                 {"expert": 3, "practitioner": 3, "new": 1}, {"calm": 3, "bold": 1, "playful": 1}),
    "newcomer": (2, {"community-careers": 5, "observability": 2, "ai-agents": 2, "wasm-edge": 1},
                 {"new": 6, "practitioner": 1}, {"playful": 3, "calm": 2, "bold": 1}),
}
# Topics whose weight grows from x1 at the start to x(1 + boost) at the end of the run.
GROWING = {"ai-agents": 3.0, "security": 2.0}
ROLE_WEIGHTS = {"attendee": 16, "speaker": 2, "staff": 2, "organizer": 1}


def pick(rng, weights):
    keys = list(weights)
    return rng.choices(keys, weights=[weights[k] for k in keys])[0]


def make_survey(rng, progress):
    """One contract-v1 survey request. progress runs from 0.0 to 1.0 over the run."""
    persona = pick(rng, {name: p[0] for name, p in PERSONAS.items()})
    _, topics, levels, vibes = PERSONAS[persona]
    weights = {t: topics.get(t, 0.3) * (1 + GROWING.get(t, 0) * progress) for t in INTERESTS}
    interests = []
    for _ in range(rng.choice((1, 2, 2, 3))):
        choice = pick(rng, {t: w for t, w in weights.items() if t not in interests})
        interests.append(choice)
    accessibility = [a for a in ACCESSIBILITY if rng.random() < 0.12]
    answers = {
        "role": pick(rng, ROLE_WEIGHTS),
        "interests": interests,
        "level": pick(rng, levels),
        "vibe": pick(rng, vibes),
        "accessibility": accessibility,
    }
    if rng.random() < 0.35:
        answers["goal"] = rng.choice(GOALS)
    return {"source": "simulator", "answers": answers}


def make_interactions(rng, recommendations):
    """Zero to three taps on the returned recommendations, more likely near the top."""
    taps = []
    for position, rec in enumerate(recommendations[:6]):
        if len(taps) == 3:
            break
        if rng.random() < 0.55 / (1 + position * 0.4):
            action = rng.choices(ACTIONS, weights=(6, 3, 1))[0]
            taps.append({"session_id": rec["session_id"], "action": action, "position": position})
    return taps


class Client:
    def __init__(self, base_url, timeout=15.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def post(self, path, body):
        request = urllib.request.Request(
            self.base_url + path, data=json.dumps(body).encode(), method="POST",
            headers={"Content-Type": "application/json", "User-Agent": "backstage-attendee-simulator"},
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read()
                return response.status, json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            raw = error.read()
            try:
                return error.code, json.loads(raw) if raw else {}
            except ValueError:
                return error.code, {}
        except (urllib.error.URLError, OSError) as error:
            return None, {"error": {"code": "unreachable", "message": str(error)}}


def run(base_url, count, rate, seed, max_429=3, dry_run=False, out=print, sleep=time.sleep, client=None):
    rng = random.Random(seed)
    client = client or Client(base_url)
    stats = {"sent": 0, "created": 0, "interactions": 0, "rejected": 0, "rate_limited": 0, "unreachable": 0}
    consecutive_429 = 0
    interval = 1.0 / rate if rate > 0 else 0.0
    for index in range(count):
        survey = make_survey(rng, index / max(count - 1, 1))
        stats["sent"] += 1
        if dry_run:
            out(json.dumps(survey))
            continue
        status, body = client.post("/attendee/surveys", survey)
        if status == 201:
            consecutive_429 = 0
            stats["created"] += 1
            attendee_id = body["attendee_id"]
            for tap in make_interactions(rng, body.get("recommendations") or []):
                tap_status, _ = client.post(f"/attendee/{attendee_id}/interactions", tap)
                if tap_status == 202:
                    stats["interactions"] += 1
            if stats["created"] % 10 == 0:
                out(f"created {stats['created']} attendees, {stats['interactions']} interactions")
        elif status == 429:
            stats["rate_limited"] += 1
            consecutive_429 += 1
            out(f"429 from the API ({consecutive_429} in a row)")
            if consecutive_429 >= max_429:
                out("stopping: the API is rate limiting builds")
                break
            sleep(max(interval, 5.0) * consecutive_429)
            continue
        elif status is None:
            stats["unreachable"] += 1
            out(f"API unreachable: {body['error']['message']}")
            if stats["unreachable"] >= 3:
                out("stopping: the API is unreachable")
                break
        else:
            stats["rejected"] += 1
            code = (body.get("error") or {}).get("code")
            out(f"survey rejected: {status} {code}")
        if interval and index < count - 1:
            sleep(interval)
    out("summary " + json.dumps(stats, sort_keys=True))
    return stats


def main(argv=None):
    parser = argparse.ArgumentParser(prog="badge_sim.attendees", description=__doc__.split("\n\n")[0])
    parser.add_argument("--base-url", required=True, help="incident API base, including /api/v1")
    parser.add_argument("--count", type=int, default=50)
    parser.add_argument("--rate", type=float, default=0.5, help="attendees per second")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--max-429", type=int, default=3, help="stop after this many 429s in a row")
    parser.add_argument("--dry-run", action="store_true", help="print the surveys instead of sending them")
    args = parser.parse_args(argv)
    stats = run(args.base_url, args.count, args.rate, args.seed, args.max_429, args.dry_run,
                out=lambda line: print(line, flush=True))
    return 0 if args.dry_run or stats["created"] else 1


if __name__ == "__main__":
    sys.exit(main())
