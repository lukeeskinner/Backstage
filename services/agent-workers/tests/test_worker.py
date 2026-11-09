"""Exercise real worker control flow with deterministic storage and transport boundaries."""
import base64
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import unittest
from urllib.error import HTTPError

from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from agent_workers.worker import BRANCH, REPOSITORY, GitHubError, GitHubPublisher, Settings, Worker, WorkerError

ROOT = Path(__file__).resolve().parents[3]
CONTRACT = json.loads((ROOT / 'contracts/pivot/examples.v1.json').read_text())
SURVEY = CONTRACT['documents']['survey']
ATTENDEE = SURVEY['attendee_id']
RUN = 'run_abcdefghijkl'
NOW = datetime(2026, 11, 9, 23, 31, tzinfo=timezone.utc)
HTML = '<!doctype html><html><head><title>Your conference</title><style>body{color:#000}</style></head><body>Catalog page</body></html>'
SPEC = {'theme': {'name': 'bold-contrast', 'background': '#000'}, 'layout': 'schedule-first', 'tone': 'direct', 'featured': [{'session_id': 'sess-014', 'reason': 'Starts soon'}]}
DECISIONS = [{'name': 'layout', 'value': 'schedule-first', 'alternatives': ['topic-clusters'], 'rationale': 'The first session starts soon.'}]

class Conflict(Exception):
    status_code = 409

class Store:
    def __init__(self, source='qr', conflict=False):
        self.survey = deepcopy(SURVEY)
        self.survey['source'] = source
        self.seq = 7
        self.ledger = {}
        self.calls = []
        self.conflict = conflict
        self.force_count = None
        self.before_update = None
        self.sessions = {item['session_id']: {**CONTRACT['documents']['session'], 'session_id': item['session_id']} for item in self.survey['recommendations']}

    def count(self, **kwargs):
        self.calls.append(('count', kwargs))
        if self.force_count is not None:
            return {'count': self.force_count}
        filters = kwargs['query']['bool']['filter']
        terms = {k: v for item in filters if 'term' in item for k, v in item['term'].items()}
        return {'count': sum(all(event.get(k) == v for k, v in terms.items()) for event in self.ledger.values())}

    def search(self, **kwargs):
        self.calls.append(('search', kwargs))
        return {'hits': {'hits': [{'_id': ATTENDEE, '_source': deepcopy(self.survey), '_seq_no': self.seq, '_primary_term': 2}] if self.survey['site']['status'] == 'queued' else []}}

    def get(self, **kwargs):
        self.calls.append(('get', kwargs))
        if kwargs['index'].endswith('-agent-ledger'):
            return {'_source': deepcopy(self.ledger[kwargs['id']])}
        return {'_source': deepcopy(self.survey), '_seq_no': self.seq, '_primary_term': 2}

    def update(self, **kwargs):
        self.calls.append(('update', deepcopy(kwargs)))
        if self.before_update:
            self.before_update(self, kwargs)
        if self.conflict or kwargs['if_seq_no'] != self.seq or kwargs['if_primary_term'] != 2:
            raise Conflict()
        self.survey['site'].update(deepcopy(kwargs['doc']['site']))
        self.seq += 1
        return {'_seq_no': self.seq, '_primary_term': 2}

    def index(self, **kwargs):
        self.calls.append(('index', deepcopy(kwargs)))
        assert kwargs['op_type'] == 'create'
        if kwargs['id'] in self.ledger:
            raise Conflict()
        self.ledger[kwargs['id']] = deepcopy(kwargs['document'])
        return {'result': 'created'}

    def mget(self, **kwargs):
        self.calls.append(('mget', kwargs))
        return {'docs': [{'_id': key, 'found': key in self.sessions, '_source': self.sessions.get(key)} for key in kwargs['ids']]}

class Publisher:
    def __init__(self, error=None):
        self.calls = []
        self.error = error
    def publish(self, *args):
        self.calls.append(args)
        if self.error:
            raise self.error
        return {'mode': 'github', 'sha': 'a'*40, 'url': f'https://github.com/{REPOSITORY}/commit/'+'a'*40, 'branch': BRANCH, 'path': f'generated/sites/{ATTENDEE}/index.html', 'message': 'safe', 'additions': 1}

class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.store = Store()
        self.exporter = InMemorySpanExporter()
        self.provider = TracerProvider()
        self.provider.add_span_processor(SimpleSpanProcessor(self.exporter))
        self.builder_calls = []
        self.validated = []

    def tearDown(self):
        self.provider.shutdown()

    def builder(self, answers, sessions, mode='template'):
        self.builder_calls.append((deepcopy(answers), deepcopy(sessions), mode))
        return HTML, deepcopy(SPEC), deepcopy(DECISIONS), mode

    def validator(self, html, sessions, accessibility=()):
        self.validated.append((html, sessions, accessibility))

    def worker(self, settings=None, **kwargs):
        return Worker(self.store, settings, builder=kwargs.pop('builder', self.builder), validator=kwargs.pop('validator', self.validator),
                      tracer=self.provider.get_tracer('test'), now=lambda: NOW, run_id_factory=lambda: RUN, **kwargs)

    def test_slow_search_refresh_does_not_fail_acknowledged_build(self):
        original_index, original_update = self.store.index, self.store.update
        def delayed_refresh(operation):
            def write(**kwargs):
                result = operation(**kwargs)
                if kwargs.get("refresh") == "wait_for":
                    raise TimeoutError("Write persisted but search refresh exceeded timeout")
                return result
            return write
        self.store.index = delayed_refresh(original_index)
        self.store.update = delayed_refresh(original_update)
        worker = self.worker()
        self.assertTrue(worker.run_once())
        self.assertEqual(self.store.survey['site']['status'], 'ready')
        self.assertEqual(list(self.store.ledger.values())[-1]['step'], 'publish')

    def test_claim_dry_run_publish_parent_trace_and_create_only_ledger(self):
        worker = self.worker()
        self.assertTrue(worker.run_once())
        site = self.store.survey['site']
        self.assertEqual(site['status'], 'ready')
        self.assertEqual(site['html'], HTML)
        self.assertEqual(site['html_sha256'], hashlib.sha256(HTML.encode()).hexdigest())
        self.assertEqual(site['commit_mode'], 'dry-run')
        self.assertIsNone(site['commit_sha'])
        self.assertNotIn('goal', self.builder_calls[0][0])
        self.assertNotIn('Find talks on cutting alert noise', json.dumps(self.store.ledger))
        events = list(self.store.ledger.values())
        self.assertEqual([event['seq'] for event in events], list(range(1, len(events)+1)))
        self.assertEqual(events[-1]['step'], 'publish')
        self.assertTrue(all(event['trace_id'] == SURVEY['trace_id'] for event in events))
        self.assertTrue(all(event['span_id'] != '0'*16 for event in events))
        spans = self.exporter.get_finished_spans()
        root = next(span for span in spans if span.name == 'agent.run')
        self.assertEqual(root.parent.span_id, int(SURVEY['traceparent'].split('-')[2], 16))
        self.assertEqual({span.name for span in spans}, {'agent.run','agent.claim','agent.retrieve','agent.plan','agent.write','agent.validate','agent.commit','agent.publish'})
        claim = next(kwargs for name, kwargs in self.store.calls if name == 'update')
        self.assertEqual(claim['if_seq_no'], 7)
        self.assertEqual(claim['if_primary_term'], 2)
        self.assertTrue(claim['require_alias'])
        self.assertFalse(worker.run_once())

    def test_real_template_and_validator_integrate_with_worker(self):
        worker = Worker(self.store, Settings(), tracer=self.provider.get_tracer('integration'), now=lambda: NOW, run_id_factory=lambda: RUN)
        worker.run_once()
        self.assertEqual(worker.last_outcome, 'ready')
        self.assertEqual(self.store.survey['site']['status'], 'ready')
        html = self.store.survey['site']['html']
        for recommendation in self.store.survey['recommendations']:
            self.assertIn('data-session-id="' + recommendation['session_id'] + '"', html)
        self.assertNotIn(SURVEY['answers']['goal'], html)
        self.assertEqual(len(self.store.ledger), 10)

    def test_concurrent_claim_loser_never_builds_or_commits(self):
        self.store.conflict = True
        publisher = Publisher()
        self.assertFalse(self.worker(Settings(commit_mode='github'), publisher=publisher).run_once())
        self.assertEqual(self.builder_calls, [])
        self.assertEqual(publisher.calls, [])
        self.assertEqual(self.store.ledger, {})

    def test_lost_lease_cannot_commit_or_overwrite_new_run(self):
        publisher = Publisher()
        def requeue(answers, sessions, mode='template'):
            result = self.builder(answers, sessions, mode)
            self.store.survey['site']['run_id'] = 'run_mnopqrstuvwx'
            self.store.seq += 1
            return result
        self.worker(Settings(commit_mode='github'), builder=requeue, publisher=publisher).run_once()
        self.assertEqual(publisher.calls, [])
        self.assertEqual(self.store.survey['site']['run_id'], 'run_mnopqrstuvwx')
        self.assertEqual(self.store.survey['site']['status'], 'building')

    def test_publish_conflict_after_commit_does_not_overwrite_new_owner(self):
        publisher = Publisher()
        def race(store, kwargs):
            if kwargs['doc']['site']['status'] == 'ready':
                store.seq += 1
                store.survey['site']['run_id'] = 'run_mnopqrstuvwx'
        self.store.before_update = race
        self.worker(Settings(commit_mode='github'), publisher=publisher).run_once()
        self.assertEqual(len(publisher.calls), 1)
        self.assertEqual(self.store.survey['site']['run_id'], 'run_mnopqrstuvwx')
        self.assertEqual(self.store.survey['site']['status'], 'building')

    def test_rejected_model_html_uses_validated_template(self):
        def build(answers, sessions, mode='template'):
            self.builder_calls.append(mode)
            return ('<script>unsafe</script>' if mode == 'openai' else HTML), deepcopy(SPEC), deepcopy(DECISIONS), mode
        def validate(html, sessions, accessibility=()):
            if '<script>' in html: raise ValueError('rejected')
        self.worker(Settings(builder='openai'), builder=build, validator=validate).run_once()
        self.assertEqual(self.builder_calls, ['openai','template'])
        self.assertEqual(self.store.survey['site']['html'], HTML)
        self.assertEqual(self.store.survey['site']['builder'], 'template')
        outcomes = [v['outcome'] for v in self.store.ledger.values()]
        self.assertIn('rejected', outcomes)
        self.assertIn('fallback', outcomes)

    def test_github_denial_falls_back_without_exposing_error_text(self):
        publisher = Publisher(GitHubError(403))
        self.worker(Settings(commit_mode='github'), publisher=publisher).run_once()
        self.assertEqual(self.store.survey['site']['status'], 'ready')
        self.assertEqual(self.store.survey['site']['commit_mode'], 'dry-run')
        self.assertTrue(any(event['outcome'] == 'fallback' for event in self.store.ledger.values()))

    def test_simulated_builds_always_template_and_only_tenth_commits(self):
        publisher = Publisher()
        worker = self.worker(Settings(builder='openai', commit_mode='github'), publisher=publisher)
        for ordinal in range(1, 21):
            self.store = Store(source='simulator')
            self.store.force_count = 0  # Search never sees any prior claim.
            worker.client = self.store
            worker.run_once()
            self.assertEqual(len(publisher.calls), ordinal // 10)
            self.assertEqual(self.store.survey['site']['status'], 'ready')
            self.assertEqual(self.builder_calls[-1][2], 'template')
        restarted = self.worker(Settings(commit_mode='github'), publisher=publisher)
        self.store.survey['site'] = deepcopy(SURVEY['site'])
        restarted.run_once()
        self.assertEqual(len(publisher.calls), 2)

    def test_hourly_cap_survives_worker_restart(self):
        self.store.force_count = 300
        self.assertFalse(self.worker().run_once())
        self.assertEqual(self.builder_calls, [])
        self.assertFalse(any(name == 'update' for name, _ in self.store.calls))

    def test_transport_exception_never_enters_ledger(self):
        def bad(*args, **kwargs): raise RuntimeError('secret-token goal-private-text')
        self.worker(builder=bad).run_once()
        self.assertEqual(self.store.survey['site']['status'], 'failed')
        serialized = json.dumps(self.store.ledger)
        self.assertNotIn('secret-token', serialized)
        self.assertNotIn('goal-private-text', serialized)

    def test_missing_catalog_session_fails_before_any_model_call(self):
        self.store.sessions = {}
        self.worker().run_once()
        self.assertEqual(self.builder_calls, [])
        self.assertEqual(self.store.survey['site']['status'], 'failed')

class Response:
    def __init__(self, value): self.value = value
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read(self, limit): return json.dumps(self.value).encode()

class GitHubTests(unittest.TestCase):
    def test_contents_write_is_constrained_preserves_bytes_and_existing_sha(self):
        calls = []
        def opener(request, timeout):
            calls.append(request)
            return Response({'type':'file','sha':'b'*40} if request.method == 'GET' else {'commit':{'sha':'a'*40,'html_url':'https://evil.invalid'}})
        result = GitHubPublisher('private-key', opener).publish(ATTENDEE, HTML, RUN, SPEC, SURVEY['trace_id'])
        self.assertTrue(calls[0].full_url.endswith('?ref=agent%2Fsites'))
        self.assertEqual(calls[1].full_url, f'https://api.github.com/repos/{REPOSITORY}/contents/generated/sites/{ATTENDEE}/index.html')
        body = json.loads(calls[1].data)
        self.assertEqual(body['branch'], BRANCH)
        self.assertEqual(body['sha'], 'b'*40)
        self.assertEqual(base64.b64decode(body['content']).decode(), HTML)
        self.assertEqual(body['author']['email'], 'site-agent@backstage.invalid')
        self.assertNotIn('goal', body['message'])
        self.assertIn('bold-contrast', body['message'])
        self.assertIn('featured: sess-014', body['message'])
        self.assertEqual(result['url'], f'https://github.com/{REPOSITORY}/commit/'+'a'*40)

    def test_path_and_branch_cannot_be_redirected(self):
        calls = []
        publisher = GitHubPublisher('private-key', lambda *args: calls.append(args))
        with self.assertRaises(WorkerError): publisher.publish('../../.github/workflows/main', HTML, RUN, SPEC, SURVEY['trace_id'])
        self.assertEqual(calls, [])
        with self.assertRaises(ValueError): Settings.from_env({'AGENT_BRANCH':'main'})
        with self.assertRaises(ValueError): Settings.from_env({'GITHUB_REPO':'other/repo'})

    def test_missing_file_creates_without_sha(self):
        calls = []
        def opener(request, timeout):
            calls.append(request)
            if request.method == 'GET': raise HTTPError(request.full_url, 404, 'missing', {}, io.BytesIO(b'private'))
            return Response({'commit':{'sha':'a'*40}})
        GitHubPublisher('private-key', opener).publish(ATTENDEE, HTML, RUN, SPEC, SURVEY['trace_id'])
        self.assertNotIn('sha', json.loads(calls[1].data))

if __name__ == '__main__':
    unittest.main()
