"""Repair only the paper artifacts identified in 1234.pdf.

The paragraph boundaries were checked against the linked 2022/2023 paper
transcriptions; all passage words are preserved except printed page numbers.
"""

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / "data" / "cet"
STARTS = {
    "cet6-2023-12-2": [
        ["She has spoken extensively", "Ditching the web at large", "Ms Gomez", "It goes without saying", "The UK", "Consequently", "Internet access"],
        ["Psychologically speaking", "Current work in anthropology", "Many studies have been conducted"],
    ],
    "cet6-2022-06-1": [
        ["These colleges and universities must be doing something right", "Yet, there is growing skepticism", "While these attacks", "It is often said", "Access to an education", "Ironically, the new tax"],
        ["But what do we mean", "We often mistake", "We are also highly susceptible", "One way we can check", "That does not mean", "In matters of science"],
    ],
}


def save(paper_id, paper):
    with (ROOT / f"{paper_id}.json").open("w", encoding="utf-8", newline="\n") as file:
        file.write(json.dumps(paper, ensure_ascii=False, indent=2) + "\n")


for paper_id, groups in STARTS.items():
    paper = json.loads((ROOT / f"{paper_id}.json").read_text(encoding="utf-8"))
    sections = [section for section in paper["sections"] if section["type"] == "detail"]
    assert len(sections) == len(groups)
    for section, starts in zip(sections, groups):
        source = " ".join(section["paragraphs"])
        positions = [0] + [source.index(phrase) for phrase in starts] + [len(source)]
        assert positions == sorted(set(positions))
        paragraphs = [source[positions[i]:positions[i + 1]].strip() for i in range(len(positions) - 1)]
        assert all(paragraphs)
        assert " ".join(paragraphs) == source
        section["paragraphs"] = paragraphs
    save(paper_id, paper)

paper_id = "cet6-2020-12-1"
paper = json.loads((ROOT / f"{paper_id}.json").read_text(encoding="utf-8"))
for section in paper["sections"]:
    for number in (4, 5, 7, 9, 10):
        section["paragraphs"] = [re.sub(r" {2,}", " ", text.replace(f"6\u00b7{number}", " ")).strip() for text in section["paragraphs"]]
    section["paragraphs"] = [text for text in section["paragraphs"] if text]
    if section["id"] == "cet6-2020-12-1-c2":
        if section["paragraphs"][0].endswith("But"):
            section["paragraphs"][0] += " " + section["paragraphs"].pop(1)
save(paper_id, paper)
