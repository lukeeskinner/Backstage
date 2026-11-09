"""python -m agent_workers [--once]; all credentials are server-side environment settings."""
import argparse
import logging
import os
import signal
from threading import Event

from elasticsearch import Elasticsearch
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider

from .worker import GitHubPublisher, Settings, Worker


def configure_telemetry():
    provider = TracerProvider(resource=Resource.create({
        "service.name": "agent-workers",
        "service.version": os.getenv("CODE_SHA", os.getenv("OTEL_SERVICE_VERSION", "development")),
    }))
    if os.getenv("OTEL_ENABLED", "true").lower() == "true" and os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"):
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        # No authentication header is placed in a resource, log or ledger entry.
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(timeout=5)))
    trace.set_tracer_provider(provider)
    return provider


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true", help="Poll and process at most one queued survey, then exit.")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    for name in ("elastic_transport", "elasticsearch", "httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.CRITICAL)
    try:
        settings = Settings.from_env()
        url, key = os.environ.get("ELASTICSEARCH_URL"), os.environ.get("ELASTICSEARCH_API_KEY")
        if not url or not key:
            raise ValueError("Missing Elasticsearch settings")
        publisher = GitHubPublisher(os.environ.get("GITHUB_TOKEN", "")) if settings.commit_mode == "github" else None
        client = Elasticsearch(url, api_key=key, request_timeout=5, max_retries=0, retry_on_timeout=False)
        provider = configure_telemetry()
    except Exception:
        parser.exit(2, "Agent configuration is incomplete or invalid. Check the server environment; values are not logged.\n")
    stop = Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda _sig, _frame: stop.set())
    worker = Worker(client, settings, publisher=publisher)
    try:
        if args.once:
            worker.run_once()
            if worker.last_outcome in {"failed", "claim_lost", "invalid_survey", "invalid_source"}:
                parser.exit(1, "Agent build did not finish. Inspect its safe ledger outcome.\n")
        else:
            worker.run_forever(stop)
    except Exception:
        parser.exit(1, "Agent poll failed. Check alias provisioning and service access; values are not logged.\n")
    finally:
        client.close()
        provider.shutdown()


if __name__ == "__main__":
    main()
