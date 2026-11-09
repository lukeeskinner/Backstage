"""Builder and adversarial page-validation tests; no live vendor requests."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

from agent_workers.builder import build_page, _response, _template_plan, _answers
from agent_workers.validation import ValidationError, validate_page

ROOT = Path(__file__).resolve().parents[3]
EXAMPLES = json.loads((ROOT / 'contracts/pivot/examples.v1.json').read_text())
ANSWERS = EXAMPLES['documents']['survey']['answers']
SESSIONS = EXAMPLES['http']['POST /api/v1/attendee/surveys']['response_201']['recommendations']


class BuilderTests(unittest.TestCase):
    def test_templates_honor_preferences_escape_catalog_and_never_use_goal(self):
        for vibe, theme in [('calm', 'calm-paper'), ('bold', 'bold-contrast'), ('playful', 'playful-pop')]:
            answers = {**ANSWERS, 'vibe': vibe, 'goal': 'PRIVATE_FREE_TEXT'}
            html, spec, decisions, builder = build_page(answers, SESSIONS)
            self.assertEqual(builder, 'template')
            self.assertEqual(spec['theme']['name'], theme)
            self.assertNotIn('PRIVATE_FREE_TEXT', html + json.dumps(spec) + json.dumps(decisions))
            self.assertEqual(len(decisions), 4)
            self.assertEqual(len(html.encode()), len(html.encode('utf-8')))
            validate_page(html, SESSIONS, answers['accessibility'])
        sessions = deepcopy(SESSIONS)
        sessions[0]['title'] = '<script>alert("catalog")</script> & people'
        html, *_ = build_page(ANSWERS, sessions)
        self.assertIn('&lt;script&gt;', html)
        self.assertNotIn('<script>', html)
        validate_page(html, sessions, ANSWERS['accessibility'])

    def test_accessibility_and_layout_decisions(self):
        answers = {**ANSWERS, 'accessibility': ['large_text', 'reduced_motion', 'high_contrast']}
        html, spec, _, _ = build_page(answers, SESSIONS)
        self.assertEqual(spec['theme']['name'], 'high-contrast')
        self.assertEqual(spec['theme']['motion'], 'reduced')
        self.assertEqual(spec['theme']['text_scale'], 1.25)
        self.assertIn('font-size:20px', html)
        self.assertEqual(build_page(answers, SESSIONS[:1])[1]['layout'], 'single-focus')
        sessions = deepcopy(SESSIONS)
        for session in sessions:
            session['starts_at'] = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat()
        self.assertEqual(build_page(answers, sessions)[1]['layout'], 'schedule-first')
        for session in sessions:
            session['starts_at'] = '2020-01-01T00:00:00Z'
        self.assertEqual(build_page(answers, sessions)[1]['layout'], 'topic-clusters')

    def test_model_uses_only_enums_catalog_and_server_settings(self):
        answers = {**ANSWERS, 'goal': 'PRIVATE_SECRET_GOAL', 'model': 'untrusted-model', 'role': 'attendee', 'unexpected': 'PRIVATE_UNKNOWN'}
        sessions = deepcopy(SESSIONS)
        sessions[0]['goal'] = 'PRIVATE_SESSION_GOAL'
        sessions[0]['reasons'] = [{'label': 'PRIVATE_REASON'}]
        safe_answers = _answers(answers)
        plan = _template_plan(safe_answers, sessions)
        html = build_page(answers, sessions)[0]
        with patch.dict(os.environ, {'AGENT_OPENAI_MODEL': 'configured-model', 'OPENAI_API_KEY': 'not-a-real-key', 'AGENT_PAGE_MAX_TOKENS': '999999'}), patch('agent_workers.builder._response', side_effect=[json.dumps(plan), html]) as response:
            result = build_page(answers, sessions, mode='openai')
        self.assertEqual(result[3], 'openai')
        self.assertEqual(response.call_count, 2)
        for call in response.call_args_list:
            self.assertEqual(call.args[0], 'configured-model')
            prompt = call.args[2]
            for forbidden in ['PRIVATE_SECRET_GOAL', 'PRIVATE_UNKNOWN', 'PRIVATE_SESSION_GOAL', 'PRIVATE_REASON', 'untrusted-model']:
                self.assertNotIn(forbidden, prompt)
        self.assertEqual(response.call_args_list[1].kwargs['token_cap'], 10000)
        self.assertIn('schema', response.call_args_list[0].kwargs)

    def test_model_timeout_error_incomplete_and_unsafe_html_fall_back(self):
        plan = _template_plan(_answers(ANSWERS), SESSIONS)
        valid_html = build_page(ANSWERS, SESSIONS)[0]
        variants = [TimeoutError('secret must not escape'), ValueError('secret must not escape'), [json.dumps(plan), valid_html.replace('</body>', '<script>bad()</script></body>')], ['{}']]
        for variant in variants:
            with self.subTest(variant=type(variant).__name__), patch.dict(os.environ, {'AGENT_OPENAI_MODEL': 'configured-model', 'OPENAI_API_KEY': 'not-a-real-key'}), patch('agent_workers.builder._response', side_effect=variant):
                html, spec, _, builder = build_page(ANSWERS, SESSIONS, 'openai')
            self.assertEqual(builder, 'template')
            self.assertIn(spec['fallback_reason'], {'model_timeout', 'invalid_output'})
            self.assertNotIn('secret must not escape', html + json.dumps(spec))
            validate_page(html, SESSIONS, ANSWERS['accessibility'])

    def test_network_call_is_bounded_and_strict(self):
        raw = json.dumps({'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': '{}'}]}], 'usage': {'input_tokens': 10, 'output_tokens': 2}}).encode()
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self, limit):
                self.limit = limit
                return raw
        with patch('agent_workers.builder.urlopen', return_value=Response()) as request:
            self.assertEqual(_response('configured-model', 'not-a-real-key', 'enum data', schema={'type': 'object'}, token_cap=1000), '{}')
        args, kwargs = request.call_args
        payload = json.loads(args[0].data)
        self.assertEqual(kwargs['timeout'], 20)
        self.assertEqual(payload['max_output_tokens'], 1000)
        self.assertIs(payload['store'], False)
        self.assertIs(payload['text']['format']['strict'], True)
        self.assertNotIn('tools', payload)


class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.html = build_page(ANSWERS, SESSIONS)[0]

    def reject(self, html):
        with self.assertRaises(ValidationError):
            validate_page(html, SESSIONS, ANSWERS['accessibility'])

    def test_script_resource_and_namespace_attacks(self):
        for markup in [
            '<script>alert(1)</script>', '<iframe srcdoc="bad"></iframe>', '<object></object>',
            '<form></form>', '<img src="https://evil.invalid">', '<a href="javascript:alert(1)">link</a>',
            '<div onclick="alert(1)">bad</div>', '<svg><use href="https://evil.invalid"></use></svg>',
            '<svg><foreignObject><div>bad</div></foreignObject></svg>',
            '<svg><path fill="url(https://evil.invalid)"></path></svg>',
            '<div style="background:url(https://evil.invalid)">bad</div>',
            '<base href="https://evil.invalid">', '<link rel="stylesheet" href="https://evil.invalid">',
        ]:
            with self.subTest(markup=markup): self.reject(self.html.replace('</main>', markup + '</main>'))
        self.reject(self.html.replace('<meta charset="utf-8">', '<meta http-equiv="refresh" content="0;url=https://evil.invalid">'))
        self.reject(self.html.replace('<body>', '<body ONLOAD="bad()">'))
        self.reject(self.html.replace('<body>', '<body font-family="system-ui" color="black">'))

    def test_css_escape_resources_and_hidden_content_are_rejected(self):
        for css in [
            '@import "https://evil.invalid";', 'body{background:url(https://evil.invalid)}',
            r'body{background:u\72l(https://evil.invalid)}', r'b\6fdy{color:red}',
            'body{background:image-set("https://evil.invalid" 1x)}', 'body{behavior:bad}',
            'body{display:none}', 'body{opacity:0}', 'body{visibility:hidden}',
            'body{position:fixed}', 'body{animation:spin 1s}', '*{font-size:0px}',
            '@font-face{font-family:remote;src:url(https://evil.invalid)}',
        ]:
            with self.subTest(css=css): self.reject(self.html.replace('</style>', css + '</style>'))

    def test_required_structure_cards_titles_and_size(self):
        self.reject(self.html.replace('<head>', '<head id="x">'))
        self.reject(self.html.replace('</head>', '</head><head></head>'))
        self.reject(self.html.replace('</html>', ''))
        self.reject(self.html.replace('data-session-id="sess-014"', 'data-session-id="sess-999"'))
        self.reject(self.html.replace(SESSIONS[0]['title'], 'Made up title'))
        self.reject(self.html + ' ' * 60_000)
        self.reject(self.html.replace('data-action="save"', 'data-action="delete"'))
        self.reject(self.html.replace('<head>', '<head><!--comment-->'))

    def test_safe_inline_svg_and_buttons_still_work(self):
        html = self.html.replace('</header>', '<svg viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="none" stroke="currentColor"></circle></svg></header>')
        validate_page(html, SESSIONS, ANSWERS['accessibility'])
        validate_page(self.html.replace('<section>', '<section aria-label="Session: your picks">'), SESSIONS, ANSWERS['accessibility'])
        self.reject(self.html.replace('<section>', '<section aria-label="https://evil.invalid">'))

    def test_accessibility_cannot_be_ignored(self):
        self.reject(self.html.replace('font-size:20px', 'font-size:12px'))
        self.reject(self.html.replace('@media (prefers-reduced-motion:reduce)', '@media (max-width:1px)'))
        with self.assertRaises(ValidationError):
            validate_page(self.html, SESSIONS, ['high_contrast'])


if __name__ == '__main__':
    unittest.main()
