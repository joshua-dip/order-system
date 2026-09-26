#!/usr/bin/env python3
"""무관한문장·어휘·어법 평가 실행을 사람 채점용으로 펼쳐 본다 — 원문과 비교해 바뀐 곳을 보여 준다.

  ml/topic/.venv/bin/python ml/eval/dump_edit.py 2026-09-25-edit-v4 vocab < /dev/null
(DB 에서 원문을 읽는다 — MONGODB_URI 는 워커 .env 에서, 출력하지 않는다)
"""
import json, re, sys, difflib
sys.path[:0] = ["ml/worker", "ml/common"]
argv, sys.argv = sys.argv, ["x"]
import local_variant_worker as w
sys.argv = argv
from pymongo import MongoClient
db = MongoClient(w.load_env()["MONGODB_URI"], serverSelectionTimeoutMS=20000)["gomijoshua"]
tb = "26년 9월 고1 영어모의고사"
label, typ = argv[1], argv[2]
cache = {}
for l in open(f"ml/eval/runs/sep26-go1/{label}.jsonl"):
    r = json.loads(l)
    if r["type"] != typ or not r["ok"]:
        continue
    num = r["num"]
    if num not in cache:
        cache[num] = db.passages.find_one({"textbook": tb, "source_key": f"{tb} {num}"})["content"]["original"]
    orig = " ".join(cache[num].split())
    b = r["blanked"]; ans = r["answer"]
    print(f"### {num} r{r['rep']} 정답 {ans}")
    if typ == "irrelevant":
        parts = re.findall(r"([①②③④⑤]) ([^①②③④⑤]*)", b)
        idx = "①②③④⑤".index(ans)
        print("  삽입:", parts[idx][1].strip())
        print("  앞:", (parts[idx - 1][1].strip() if idx > 0 else b.split("①")[0].strip())[-140:])
        print("  뒤:", (parts[idx + 1][1].strip() if idx < 4 else "(마지막)")[:140])
    else:
        plain = re.sub(r"[①②③④⑤]", "", b).replace("<u>", "").replace("</u>", "")
        marks = re.findall(r"[①②③④⑤](?:<u>([^<]*)</u>|([A-Za-z'’-]+))", b)
        print("  밑줄:", [x or y for x, y in marks])
        ow, pw = orig.split(), " ".join(plain.split()).split()
        for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=ow, b=pw, autojunk=False).get_opcodes():
            if op != "equal":
                print(f"  원래 「{' '.join(ow[i1:i2])}」 → 「{' '.join(pw[j1:j2])}」  …{' '.join(ow[max(0, i1 - 10):i2 + 8])}…")
    print("  해설:", (r["explanation"] or "")[:220])
