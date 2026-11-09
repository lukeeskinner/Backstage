#!/usr/bin/env python3
"""Provision the attendee-site pivot indices under one prefix; never read a credential file.

Creates only missing aliases, never alters an existing index, and can seed the synthetic catalog.
Definitions live in contracts/pivot/elasticsearch so the API runtime can do the same work itself.
"""
import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'services' / 'incident-api'))

from elasticsearch import Elasticsearch  # noqa: E402
from backstage_api.pivot import Pivot  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prefix', required=True)
    parser.add_argument('--seed', action='store_true', help='index the synthetic session catalog, starting from now')
    parser.add_argument('--pipelines', action='store_true', help='also try to create the two optional ingest pipelines')
    parser.add_argument('--probe', action='store_true', help='only report version and inference endpoints')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,62}', args.prefix):
        parser.error('prefix must be a lowercase Elasticsearch index prefix')
    if not os.getenv('ELASTICSEARCH_URL') or not os.getenv('ELASTICSEARCH_API_KEY'):
        parser.error('ELASTICSEARCH_URL and ELASTICSEARCH_API_KEY must be configured in the environment')
    with Elasticsearch(os.environ['ELASTICSEARCH_URL'], api_key=os.environ['ELASTICSEARCH_API_KEY'],
                       request_timeout=10, max_retries=0) as client:
        if args.probe:
            info = client.info()
            report = {'version': info['version'].get('number'), 'flavor': info['version'].get('build_flavor')}
            try:
                endpoints = client.inference.get().get('endpoints', [])
                report['inference'] = [[item.get('inference_id'), item.get('task_type')] for item in endpoints]
            except Exception:
                report['inference'] = 'unavailable to this key'
        else:
            pivot = Pivot(client, args.prefix, None, lambda: datetime.now(timezone.utc))
            report = pivot.provision(seed=args.seed, pipelines=args.pipelines)
    print(json.dumps(report))


if __name__ == '__main__':
    main()
