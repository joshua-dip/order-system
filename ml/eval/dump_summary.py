#!/usr/bin/env python3
"""요약 평가를 직접 채점할 수 있게 요약문·선지·경고를 펼친다.

  python3 ml/eval/dump_summary.py <label> [--set jun11-go2]
"""
import argparse
import json
from pathlib import Path

EVAL = Path(__file__).resolve().parent


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('label')
    ap.add_argument('--set', default='sep26-go1')
    args = ap.parse_args()
    with (EVAL / 'runs' / args.set / f'{args.label}.jsonl').open(encoding='utf-8') as source:
        for line in source:
            r = json.loads(line)
            if r['type'] != 'summary':
                continue
            if not r['ok']:
                print(f"### {r['num']} r{r.get('rep', 1)} 실패: {r.get('error') or ''}")
                continue
            summary = (r.get('blanked') or '').split('\n\n→ ')[-1]
            print(f"### {r['num']} r{r.get('rep', 1)} 정답 {r['answer']} {r['sec']}s 경고 {len(r['warnings'])}")
            print('  요약:', summary)
            for option in r['options']:
                print('   ', ('★ ' if option[:1] == r['answer'] else '  ') + option)
            for warning in r['warnings']:
                print('  ⚠', warning[:150])


if __name__ == '__main__':
    main()
