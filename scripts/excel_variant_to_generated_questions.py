#!/usr/bin/env python3
"""
변형문제 엑셀(관리자 JSON과 유사한 열) → MongoDB passages(지문) upsert + generated_questions 삽입

엑셀 열: Source, NumQuestion, Category, Question, Paragraph, Options, OptionType, CorrectAnswer, Explanation

Source 예: "25년 3월 고2 영어모의고사 18번" → 교재명 + " 18번" 번호로 passages 매칭·신규 생성

환경: .env.local 의 MONGODB_URI

사용법:
  python3 scripts/excel_variant_to_generated_questions.py "assets/25년 3월 고2 영어모의고사_변형문제.xlsx" --dry-run
  python3 scripts/excel_variant_to_generated_questions.py "assets/....xlsx" --replace
  python3 scripts/excel_variant_to_generated_questions.py "assets/....xlsx"
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from bson import ObjectId
from dotenv import load_dotenv
from pymongo import MongoClient

GRAMMAR_OPTIONS_FIXED = "①###②###③###④###⑤"


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


def parse_source_label(raw: str) -> tuple[str, str] | None:
    s = cell_str(raw)
    if not s:
        return None
    m = re.match(r"^(.+?)\s+(\d+번|\d+~\d+번)$", s)
    if not m:
        return None
    return m.group(1).strip(), m.group(2).strip()


def parse_num_question(raw) -> int:
    s = cell_str(raw)
    m = re.match(r"^(\d+)번$", s)
    if m:
        return int(m.group(1))
    m2 = re.search(r"(\d+)", s)
    return int(m2.group(1)) if m2 else 1


def normalize_options(s: str) -> str:
    s = cell_str(s)
    if not s:
        return ""
    if "###" in s:
        parts = [p.strip() for p in s.split("###") if p.strip()]
        return " ### ".join(parts)
    parts = [p.strip() for p in re.split(r"[\r\n]+", s) if p.strip()]
    return " ### ".join(parts)


def build_question_data(row: dict, category: str) -> dict:
    nq = parse_num_question(row.get("NumQuestion"))
    opts = normalize_options(cell_str(row.get("Options")))
    if category == "어법":
        opts = GRAMMAR_OPTIONS_FIXED
    return {
        "순서": nq,
        "Source": cell_str(row.get("Source")),
        "NumQuestion": nq,
        "Category": category,
        "Question": cell_str(row.get("Question")),
        "Paragraph": cell_str(row.get("Paragraph")),
        "Options": opts,
        "OptionType": cell_str(row.get("OptionType")) or "English",
        "CorrectAnswer": cell_str(row.get("CorrectAnswer")),
        "Explanation": cell_str(row.get("Explanation")),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="변형문제 xlsx → passages + generated_questions")
    parser.add_argument("excel", type=str, help="xlsx 경로")
    parser.add_argument("--sheet", type=int, default=0)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--replace",
        action="store_true",
        help="삽입 전 해당 교재명(textbook)의 기존 generated_questions 전부 삭제",
    )
    args = parser.parse_args()

    path = Path(args.excel)
    if not path.is_file():
        print(f"❌ 파일 없음: {path}", file=sys.stderr)
        sys.exit(1)

    df = pd.read_excel(path, sheet_name=args.sheet)
    df.columns = [str(c).strip() for c in df.columns]
    required = [
        "Source",
        "NumQuestion",
        "Category",
        "Question",
        "Paragraph",
        "Options",
        "OptionType",
        "CorrectAnswer",
        "Explanation",
    ]
    missing = [c for c in required if c not in df.columns]
    if missing:
        print(f"❌ 필요한 열 없음: {missing}. 실제: {list(df.columns)}", file=sys.stderr)
        sys.exit(1)

    # (textbook, number) -> paragraph (첫 행)
    passage_paragraph: dict[tuple[str, str], str] = {}
    source_full_by_key: dict[tuple[str, str], str] = {}
    for _, r in df.iterrows():
        row = r.to_dict()
        src = parse_source_label(cell_str(row.get("Source")))
        if not src:
            print(f"⚠️ Source 파싱 실패(건너뜀): {row.get('Source')!r}", file=sys.stderr)
            continue
        tb, num = src
        key = (tb, num)
        para = cell_str(row.get("Paragraph"))
        if key not in passage_paragraph and para:
            passage_paragraph[key] = para
        sf = cell_str(row.get("Source"))
        if sf:
            source_full_by_key[key] = sf

    if not passage_paragraph:
        print("❌ 유효한 Source·Paragraph 행이 없습니다.", file=sys.stderr)
        sys.exit(1)

    textbooks = {k[0] for k in passage_paragraph}
    if len(textbooks) != 1:
        print(f"❌ 교재명이 한 종류여야 합니다. 발견: {textbooks}", file=sys.stderr)
        sys.exit(1)
    textbook = next(iter(textbooks))

    now = datetime.now(timezone.utc)
    passage_docs: list[dict] = []
    for (tb, num), original in sorted(passage_paragraph.items()):
        sk = f"{tb} {num}".strip()
        passage_docs.append(
            {
                "textbook": tb,
                "chapter": tb,
                "number": num,
                "source_key": sk,
                "order": 0,
                "content": {
                    "original": original,
                    "translation": "",
                    "sentences_en": [],
                    "sentences_ko": [],
                    "tokenized_en": "",
                    "tokenized_ko": "",
                    "mixed": "",
                },
                "updated_at": now,
            }
        )

    gq_docs: list[dict] = []
    for _, r in df.iterrows():
        row = r.to_dict()
        src = parse_source_label(cell_str(row.get("Source")))
        if not src:
            continue
        tb, num = src
        category = cell_str(row.get("Category"))
        if not category:
            continue
        key = (tb, num)
        source_for_db = source_full_by_key.get(key) or f"{tb} {num}"
        gq_docs.append(
            {
                "_key": key,
                "textbook": tb,
                "number": num,
                "source": source_for_db,
                "type": category,
                "option_type": cell_str(row.get("OptionType")) or "English",
                "question_data": build_question_data(row, category),
                "status": "완료",
                "error_msg": None,
                "created_at": now,
                "updated_at": now,
            }
        )

    print(f"📊 passages 후보 {len(passage_docs)}건 · generated_questions {len(gq_docs)}건 (교재: {textbook})")

    if args.dry_run:
        print("🔍 dry-run — DB 미기록")
        for i, d in enumerate(passage_docs[:2]):
            print(f"  passage 샘플: {d['textbook'][:50]} / {d['number']} / 원문 {len(d['content']['original'])}자")
        for i, d in enumerate(gq_docs[:2]):
            print(f"  gq 샘플: {d['source'][:50]} / {d['type']} / NumQuestion {d['question_data']['NumQuestion']}")
        sys.exit(0)

    uri = load_mongo_uri()
    kw = {}
    if os.environ.get("MONGODB_TLS_ALLOW_INVALID", "").strip() in ("1", "true", "yes"):
        kw["tlsAllowInvalidCertificates"] = True
    client = MongoClient(uri, **kw)
    db = client["gomijoshua"]
    pcol = db["passages"]
    gcol = db["generated_questions"]

    if args.replace:
        dr = gcol.delete_many({"textbook": textbook})
        print(f"🗑️ 기존 변형문제 삭제: {dr.deleted_count}건 (textbook={textbook!r})")

    pid_by_key: dict[tuple[str, str], ObjectId] = {}
    pins = 0
    pup = 0
    for d in passage_docs:
        filt = {"textbook": d["textbook"], "chapter": d["chapter"], "number": d["number"]}
        existing = pcol.find_one(filt, projection=["_id"])
        if existing:
            pcol.update_one({"_id": existing["_id"]}, {"$set": d})
            pid_by_key[(d["textbook"], d["number"])] = existing["_id"]
            pup += 1
        else:
            ins = {**d, "created_at": now}
            r = pcol.insert_one(ins)
            pid_by_key[(d["textbook"], d["number"])] = r.inserted_id
            pins += 1

    to_insert: list[dict] = []
    skipped = 0
    for d in gq_docs:
        key = d.pop("_key")
        pid = pid_by_key.get(key)
        if not pid:
            skipped += 1
            continue
        d["passage_id"] = pid
        to_insert.append(d)

    if skipped:
        print(f"⚠️ passage_id 없어 제외: {skipped}건", file=sys.stderr)

    batch = 200
    total_ins = 0
    for i in range(0, len(to_insert), batch):
        chunk = to_insert[i : i + batch]
        if chunk:
            gcol.insert_many(chunk)
            total_ins += len(chunk)

    client.close()
    print(f"✅ passages: 신규 {pins} · 갱신 {pup}")
    print(f"✅ generated_questions: 삽입 {total_ins}건")


if __name__ == "__main__":
    main()
