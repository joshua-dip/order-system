#!/usr/bin/env python3
"""
엑셀의 강·페이지와 일치하는 passages 문서만 골라 number·source_key를 엑셀 「번호」 열로 맞춤.

excel_to_passages.py 는 (textbook, chapter, number) 로 upsert 하므로,
DB에 number=07번처럼 연번으로 들어간 뒤 교재가 강마다 01번부터 다시 시작하면 upsert로는 갱신되지 않는다.
이 스크립트는 Mongo의 page(예: p14) + chapter로 지문을 찾아 번호만 교체한다.
(order 필드가 비어 있는 데이터도 처리 가능)

로컬 SSL 오류 시: MONGODB_TLS_ALLOW_INVALID=1

사용법:
  MONGODB_TLS_ALLOW_INVALID=1 python3 scripts/fix-passage-numbers-from-excel.py "assets/수능특강 Light 영어독해연습(2026).xlsx"
  python3 scripts/fix-passage-numbers-from-excel.py file.xlsx --dry-run
  python3 scripts/fix-passage-numbers-from-excel.py file.xlsx --textbook "수능특강 Light 영어독해연습"
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from pymongo import MongoClient


def cell_str(v) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if float(v).is_integer():
            return str(int(v))
        return str(v)
    return str(v).strip()


def load_uri() -> str:
    root = Path(__file__).resolve().parent.parent
    load_dotenv(root / ".env.local")
    uri = (os.environ.get("MONGODB_URI") or "").strip()
    if not uri:
        print("❌ MONGODB_URI 없음 (.env.local)", file=sys.stderr)
        sys.exit(1)
    return uri


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("excel", type=str)
    parser.add_argument("--sheet", type=int, default=0)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--textbook",
        type=str,
        default="",
        help="Mongo textbook 필터(정확 일치). 비우면 엑셀 교재명 첫 행 사용",
    )
    args = parser.parse_args()

    path = Path(args.excel)
    if not path.is_file():
        print(f"❌ 파일 없음: {path}", file=sys.stderr)
        sys.exit(1)

    df = pd.read_excel(path, sheet_name=args.sheet)
    df.columns = [str(c).strip() for c in df.columns]
    for col in ("교재명", "강", "번호", "페이지"):
        if col not in df.columns:
            print(f"❌ 열 없음: {col}", file=sys.stderr)
            sys.exit(1)

    tb_filter = args.textbook.strip() or cell_str(df["교재명"].iloc[0])
    if not tb_filter:
        print("❌ 교재명을 알 수 없습니다.", file=sys.stderr)
        sys.exit(1)

    def norm_page(v) -> str:
        s = cell_str(v).strip()
        if not s:
            return ""
        m = re.match(r"^p\s*(\d+)\s*$", s, re.I)
        if m:
            return f"p{int(m.group(1))}"
        if s.isdigit():
            return f"p{int(s)}"
        return s

    rows: list[tuple[str, str, str]] = []
    for _, r in df.iterrows():
        ch = cell_str(r.get("강"))
        num = cell_str(r.get("번호"))
        pg = norm_page(r.get("페이지"))
        if not ch or not num or not pg:
            continue
        rows.append((ch, pg, num))

    print(f"📊 엑셀 {len(rows)}행 · textbook 필터: {tb_filter!r} · 매칭: 강+페이지")

    if args.dry_run:
        for ch, pg, num in rows[:8]:
            print(f"  dry-run: chapter={ch!r} page={pg!r} → number={num!r}")
        print("  … (dry-run, DB 미기록)")
        return

    uri = load_uri()
    kw: dict = {}
    if os.environ.get("MONGODB_TLS_ALLOW_INVALID", "").strip() in ("1", "true", "yes"):
        kw["tlsAllowInvalidCertificates"] = True
    client = MongoClient(uri, **kw)
    col = client["gomijoshua"]["passages"]
    now = datetime.now(timezone.utc)

    matched = 0
    missing = 0
    for ch, pg, num in rows:
        source_key = f"{ch} {num}".strip()
        filt = {"textbook": tb_filter, "chapter": ch, "page": pg}
        res = col.update_one(
            filt,
            {"$set": {"number": num, "source_key": source_key, "updated_at": now}},
        )
        if res.matched_count:
            matched += 1
        else:
            # 일부 문서는 page가 숫자만 저장됨
            m = re.match(r"^p(\d+)$", pg, re.I)
            alt = int(m.group(1)) if m else None
            res2 = None
            if alt is not None:
                res2 = col.update_one(
                    {"textbook": tb_filter, "chapter": ch, "page": alt},
                    {"$set": {"number": num, "source_key": source_key, "updated_at": now}},
                )
            if res2 and res2.matched_count:
                matched += 1
            else:
                missing += 1
                print(f"⚠️ 미매칭: chapter={ch!r} page={pg!r} number={num!r}")

    client.close()
    print(f"✅ 갱신 {matched}건 · 미매칭 {missing}건")


if __name__ == "__main__":
    main()
