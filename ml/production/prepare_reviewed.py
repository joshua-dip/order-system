"""Build pending-save input from explicit AI reviews; preserves original raw.jsonl."""
from __future__ import annotations

import copy
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml/eval"))
from run_eval import KO


def main() -> None:
    batch = Path(sys.argv[1])
    manifest = json.loads((batch / "manifest.json").read_text())
    reviews = json.loads((batch / "review.json").read_text())["grades"]
    passages = {p["passage_id"]: p for p in manifest["passages"]}
    items, keys = [], []
    for line in (batch / "raw.jsonl").read_text().splitlines():
        row = json.loads(line)
        review = reviews.get(row["key"])
        if not review or review.get("disposition") == "hold":
            continue
        qd = copy.deepcopy(row["result"].get("question_data"))
        if not qd or review["grade"] == "F":
            continue
        if review["grade"] != "O" and not review.get("edits"):
            continue
        qd.update(review.get("edits", {}))
        options = str(qd.get("Options", ""))
        parts = re.split(r"\s*###\s*|\n+", options)
        qd["Options"] = " ### ".join(x.strip() for x in parts if x.strip())
        qd["Paragraph"] = re.sub(r"([①②③④⑤])\s*(<u>)", r"\1 \2", qd["Paragraph"])
        if row["type"] == "vocab":
            for option in parts:
                match = re.match(r"([①②③④⑤])\s+(.+)", option.strip())
                if match:
                    number, word = match.groups()
                    qd["Paragraph"] = re.sub(re.escape(number) + r"\s*" + re.escape(word) + r"\b",
                        lambda _: f"{number} <u>{word}</u>", qd["Paragraph"], count=1)
        p = passages[row["passage_id"]]
        qd.update({"NumQuestion": len(items) + 1, "Source": "", "Category": "", "OptionType": "English"})
        items.append({"passage_id": p["passage_id"], "textbook": p["textbook"], "source": p["source_key"],
            "type": KO[row["type"]], "status": "대기", "option_type": "English",
            "ai_source": "local-qwen-codex-edited" if review.get("edits") else "local-qwen-codex-reviewed",
            "question_data": qd})
        keys.append(row["key"])
    (batch / "reviewed.json").write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n")
    (batch / "reviewed-keys.json").write_text(json.dumps(keys, ensure_ascii=False, indent=2) + "\n")
    print(f"Prepared {len(items)} pending candidates; no DB writes")


if __name__ == "__main__":
    main()
