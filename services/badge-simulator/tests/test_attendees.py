"""Attendee simulator against the frozen pivot contract (contracts/pivot/examples.v1.json)."""

import json
import threading
import unittest
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from badge_sim import attendees

EXAMPLES = json.loads(
    (Path(__file__).resolve().parents[3] / "contracts" / "pivot" / "examples.v1.json").read_text(encoding="utf-8")
)
ENUMS = EXAMPLES["enums"]
SURVEY_201 = EXAMPLES["http"]["POST /api/v1/attendee/surveys"]["response_201"]


class StubApi:
    """Answers the two attendee routes the simulator uses, with the contract's example bodies."""

    def __init__(self, fail_with_429_after=None):
        self.surveys, self.interactions = [], []
        self.fail_with_429_after = fail_with_429_after
        stub = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                if self.path == "/api/v1/attendee/surveys":
                    if stub.fail_with_429_after is not None and len(stub.surveys) >= stub.fail_with_429_after:
                        return self.reply(429, {"error": {"code": "rate_limited", "message": "build cap"}})
                    stub.surveys.append(body)
                    reply = dict(SURVEY_201, attendee_id=f"att_{len(stub.surveys):012d}".replace("0", "a"))
                    return self.reply(201, reply)
                if self.path.startswith("/api/v1/attendee/") and self.path.endswith("/interactions"):
                    stub.interactions.append(body)
                    return self.reply(202, {"accepted": True})
                self.reply(404, {"error": {"code": "not_found", "message": self.path}})

            def reply(self, status, payload):
                data = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}/api/v1"

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def assert_valid_survey(test, survey):
    test.assertEqual(survey["source"], "simulator")
    test.assertIn(survey["source"], ENUMS["source"])
    answers = survey["answers"]
    test.assertLessEqual(set(answers), {"role", "interests", "level", "vibe", "accessibility", "goal"})
    test.assertIn(answers["role"], ENUMS["role"])
    test.assertTrue(1 <= len(answers["interests"]) <= 3)
    test.assertEqual(len(set(answers["interests"])), len(answers["interests"]))
    test.assertLessEqual(set(answers["interests"]), set(ENUMS["interests"]))
    test.assertIn(answers["level"], ENUMS["level"])
    test.assertIn(answers["vibe"], ENUMS["vibe"])
    test.assertLessEqual(set(answers["accessibility"]), set(ENUMS["accessibility"]))
    if "goal" in answers:
        test.assertIn(answers["goal"], attendees.GOALS)
        test.assertLessEqual(len(answers["goal"]), 140)


class AttendeeSimulatorTests(unittest.TestCase):
    def test_local_enums_match_the_frozen_contract(self):
        self.assertEqual(attendees.ROLES, tuple(ENUMS["role"]))
        self.assertEqual(attendees.INTERESTS, tuple(ENUMS["interests"]))
        self.assertEqual(attendees.LEVELS, tuple(ENUMS["level"]))
        self.assertEqual(attendees.VIBES, tuple(ENUMS["vibe"]))
        self.assertEqual(attendees.ACCESSIBILITY, tuple(ENUMS["accessibility"]))
        self.assertEqual(attendees.ACTIONS, tuple(ENUMS["interaction_action"]))

    def test_surveys_are_valid_seeded_and_carry_no_identity(self):
        import random

        first = [attendees.make_survey(random.Random(7), i / 49) for i in range(50)]
        again = [attendees.make_survey(random.Random(7), i / 49) for i in range(50)]
        self.assertEqual(first, again)
        for survey in first:
            assert_valid_survey(self, survey)
            text = json.dumps(survey).lower()
            for field in ("name", "email", "device", "phone"):
                self.assertNotIn(f'"{field}', text)

    def test_growing_topics_rise_over_the_run(self):
        import random

        rng = random.Random(11)
        early = Counter(t for _ in range(400) for t in attendees.make_survey(rng, 0.0)["answers"]["interests"])
        late = Counter(t for _ in range(400) for t in attendees.make_survey(rng, 1.0)["answers"]["interests"])
        self.assertGreater(late["ai-agents"], early["ai-agents"] * 1.3)
        self.assertGreater(late["security"], early["security"] * 1.2)

    def test_run_posts_surveys_and_interactions_to_the_contract_routes(self):
        api = StubApi()
        self.addCleanup(api.close)
        lines = []
        stats = attendees.run(api.base_url, count=50, rate=0, seed=7, out=lines.append)
        self.assertEqual(stats["created"], 50)
        self.assertEqual(len(api.surveys), 50)
        for survey in api.surveys:
            assert_valid_survey(self, survey)
        self.assertEqual(stats["interactions"], len(api.interactions))
        self.assertGreater(len(api.interactions), 10)
        known = {rec["session_id"] for rec in SURVEY_201["recommendations"]}
        for tap in api.interactions:
            self.assertEqual(set(tap), {"session_id", "action", "position"})
            self.assertIn(tap["action"], ENUMS["interaction_action"])
            self.assertIn(tap["session_id"], known)
        self.assertTrue(lines[-1].startswith("summary "))

    def test_repeated_429_stops_the_run(self):
        api = StubApi(fail_with_429_after=5)
        self.addCleanup(api.close)
        sleeps = []
        stats = attendees.run(api.base_url, count=50, rate=0, seed=7, max_429=3, out=lambda _: None,
                              sleep=sleeps.append)
        self.assertEqual(stats["created"], 5)
        self.assertEqual(stats["rate_limited"], 3)
        self.assertEqual(stats["sent"], 8)
        self.assertEqual(len(sleeps), 2)

    def test_dry_run_sends_nothing(self):
        lines = []
        stats = attendees.run("http://127.0.0.1:9/api/v1", count=3, rate=0, seed=1, dry_run=True, out=lines.append)
        self.assertEqual(stats["sent"], 3)
        self.assertEqual(stats["created"], 0)
        for line in lines[:3]:
            assert_valid_survey(self, json.loads(line))


if __name__ == "__main__":
    unittest.main()
