#!/usr/bin/env python3
"""
교재 원문 엑셀 → MongoDB gomijoshua.passages upsert

기대 열(한글 헤더, 1행):
  교재명, 강, 페이지, 순서, 번호, 원문, 해석,
  문장구분(영), 문장구분(한), Tokenized Sentences (English), Tokenized Sentences (Korean), Mixed Sentences

환경: .env.local 의 MONGODB_URI
  (로컬 Python에서 SSL 오류 시에만) MONGODB_TLS_ALLOW_INVALID=1

사용법:
  python3 scripts/excel_to_passages.py "assets/수능특강 Q 미니모의고사 영어 Start.xlsx"
  python3 scripts/excel_to_passages.py path/to/file.xlsx --sheet 0
  python3 scripts/excel_to_passages.py file.xlsx --dry-run
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


def load_mongo_uri() -> str:
    root = Path(__file__).resolve().parent.parent
    load_dotenv(root / ".env.local")
    uri = (os.environ.get("MONGODB_URI") or "").strip()
    if not uri:
        print("❌ MONGODB_URI가 없습니다. .env.local을 확인하세요.", file=sys.stderr)
        sys.exit(1)
    return uri


def cell_str(v) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if float(v).is_integer():
            return str(int(v))
        return str(v)
    return str(v).strip()


def split_lines(s: str) -> list[str]:
    if not s:
        return []
    return [line.strip() for line in s.replace("\r\n", "\n").split("\n") if line.strip()]


def parse_page_fields(page_raw: str) -> tuple[int | None, str]:
    """'p4', '4', 4 → (4, 'p4' or '')"""
    s = cell_str(page_raw)
    if not s:
        return None, ""
    m = re.match(r"^p?\s*(\d+)\s*$", s, re.I)
    if m:
        return int(m.group(1)), s
    return None, s


def row_to_doc(row: dict) -> dict | None:
    textbook = cell_str(row.get("교재명"))
    chapter = cell_str(row.get("강"))
    number = cell_str(row.get("번호"))
    if not textbook or not chapter or not number:
        return None

    order_raw = row.get("순서")
    try:
        order = int(order_raw) if order_raw is not None and str(order_raw).strip() != "" else 0
    except (TypeError, ValueError):
        order = 0

    page_num, page_label = parse_page_fields(row.get("페이지"))

    original = cell_str(row.get("원문"))
    translation = cell_str(row.get("해석"))
    sentences_en = split_lines(cell_str(row.get("문장구분(영)")))
    sentences_ko = split_lines(cell_str(row.get("문장구분(한)")))
    tokenized_en = cell_str(row.get("Tokenized Sentences (English)"))
    tokenized_ko = cell_str(row.get("Tokenized Sentences (Korean)"))
    mixed = cell_str(row.get("Mixed Sentences"))

    source_key = f"{chapter} {number}".strip()

    now = datetime.now(timezone.utc)

    doc = {
        "textbook": textbook,
        "chapter": chapter,
        "number": number,
        "source_key": source_key,
        "order": order,
        "content": {
            "original": original,
            "translation": translation,
            "sentences_en": sentences_en,
            "sentences_ko": sentences_ko,
            "tokenized_en": tokenized_en,
            "tokenized_ko": tokenized_ko,
            "mixed": mixed,
        },
        "updated_at": now,
    }
    if page_num is not None:
        doc["page"] = page_num
    if page_label:
        doc["page_label"] = page_label
    return doc


def main() -> None:
    parser = argparse.ArgumentParser(description="엑셀 → MongoDB passages upsert")
    parser.add_argument("excel", type=str, help="xlsx 경로")
    parser.add_argument("--sheet", type=int, default=0, help="시트 인덱스 (기본 0)")
    parser.add_argument("--dry-run", action="store_true", help="DB 쓰기 없이 건만 검사")
    args = parser.parse_args()

    path = Path(args.excel)
    if not path.is_file():
        print(f"❌ 파일 없음: {path}", file=sys.stderr)
        sys.exit(1)

    df = pd.read_excel(path, sheet_name=args.sheet)
    df.columns = [str(c).strip() for c in df.columns]

    required = ["교재명", "강", "번호", "원문"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        print(f"❌ 필요한 열이 없습니다: {missing}. 실제 열: {list(df.columns)}", file=sys.stderr)
        sys.exit(1)

    docs: list[dict] = []
    for _, r in df.iterrows():
        row = r.to_dict()
        d = row_to_doc(row)
        if d:
            docs.append(d)

    if not docs:
        print("❌ 유효한 행이 없습니다.")
        sys.exit(1)

    print(f"📊 {len(docs)}건 준비 (시트 인덱스 {args.sheet})")

    if args.dry_run:
        print("🔍 dry-run — DB 미기록")
        for i, d in enumerate(docs[:3]):
            print(f"  샘플 {i+1}: {d['textbook'][:40]}… / {d['chapter']} / {d['number']}")
        sys.exit(0)

    uri = load_mongo_uri()
    kw = {}
    if os.environ.get("MONGODB_TLS_ALLOW_INVALID", "").strip() in ("1", "true", "yes"):
        kw["tlsAllowInvalidCertificates"] = True
    client = MongoClient(uri, **kw)
    col = client["gomijoshua"]["passages"]

    inserted = 0
    updated = 0
    for d in docs:
        filt = {
            "textbook": d["textbook"],
            "chapter": d["chapter"],
            "number": d["number"],
        }
        existing = col.find_one(filt, projection=["_id"])
        if existing:
            col.update_one(
                {"_id": existing["_id"]},
                {"$set": d},
            )
            updated += 1
        else:
            ins = {**d, "created_at": d["updated_at"]}
            col.insert_one(ins)
            inserted += 1

    client.close()
    print(f"✅ 완료: 신규 {inserted}건 · 갱신 {updated}건 (gomijoshua.passages)")


if __name__ == "__main__":
    main()
