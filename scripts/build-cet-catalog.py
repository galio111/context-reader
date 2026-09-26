"""Validate reviewed reading papers and emit a metadata-only catalogue.

Run after source extraction and visual review, never directly on unreviewed OCR.
PDFs, audio and answerless papers do not belong in the shipped data directory.
"""
from pathlib import Path
import json
import hashlib
import re

def identity(value):
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    return hashlib.sha256(raw).hexdigest()[:20]

def normalized_paragraphs(section):
    return [' '.join(text.split()) for text in section['paragraphs']]

directory = Path(__file__).resolve().parent.parent / 'data' / 'cet'
catalogue = []
for file in sorted(directory.glob('cet*-*.json')):
    paper = json.loads(file.read_text(encoding='utf-8'))
    assert paper['id'] == file.stem
    assert paper['source'].startswith('https://github.com/0609x/CET46-Resources/blob/')
    assert paper.get('answerSource'), f'{file.name}: missing answer source'
    assert paper.get('status') == 'ready', f'{file.name}: unreviewed source'
    assert [s['type'] for s in paper['sections']] == ['cloze', 'matching', 'detail', 'detail']
    assert [len(s['questions']) for s in paper['sections']] == [10, 10, 5, 5]
    numbers = []
    for section in paper['sections']:
        assert section['paragraphs'] and all(section['paragraphs'])
        for question in section['questions']:
            numbers.append(question['number'])
            assert question.get('answer') in [o['key'] for o in question['options']]
            assert len(question.get('explanation', '')) > 15
    # Earlier source papers use 36–65. Preserve the source numbering.
    assert numbers in [list(range(26, 56)), list(range(36, 66))], f'{file.name}: incomplete reading paper'
    cloze = paper['sections'][0]
    assert [o['key'] for o in cloze['bank']] == list('ABCDEFGHIJKLMNO')
    assert len({q['answer'] for q in cloze['questions']}) == 10
    blanks = [int(n) for n in re.findall(r'\[\[(\d+)\]\]', ' '.join(cloze['paragraphs']))]
    assert blanks == numbers[:10], f'{file.name}: cloze blanks do not match questions'
    catalogue.append({
        **{key: value for key, value in paper.items() if key != 'sections'},
        'sections': [{
            'id': section['id'], 'type': section['type'], 'title': section['title'],
            'materialId': identity({'type': section['type'], 'paragraphs': normalized_paragraphs(section)}),
            'questionSetId': identity([{'stem': q['stem'], 'options': q['options'], 'answer': q['answer']} for q in section['questions']]),
            'questions': [{'number': q['number']} for q in section['questions']],
        } for section in paper['sections']],
    })
(directory / 'catalog.json').write_bytes((json.dumps(catalogue, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
print(f'Validated {len(catalogue)} papers; catalogue contains no passages, options or answers.')
