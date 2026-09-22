"""Validate reviewed reading papers and emit a metadata-only catalogue.

Run after source extraction and visual review, never directly on unreviewed OCR.
PDFs, audio and answerless papers do not belong in the shipped data directory.
"""
from pathlib import Path
import json

directory = Path(__file__).resolve().parent.parent / 'data' / 'cet'
catalogue = []
for file in sorted(directory.glob('cet*-*.json')):
    paper = json.loads(file.read_text(encoding='utf-8'))
    assert paper['id'] == file.stem
    assert paper['source'].startswith('https://github.com/0609x/CET46-Resources/blob/')
    assert paper.get('answerSource'), f'{file.name}: missing answer source'
    numbers = []
    for section in paper['sections']:
        assert section['paragraphs'] and all(section['paragraphs'])
        for question in section['questions']:
            numbers.append(question['number'])
            assert question.get('answer') in [o['key'] for o in question['options']]
            assert len(question.get('explanation', '')) > 15
    assert numbers == list(range(26, 56)), f'{file.name}: incomplete reading paper'
    catalogue.append({
        **{key: value for key, value in paper.items() if key != 'sections'},
        'sections': [{
            'id': section['id'], 'type': section['type'], 'title': section['title'],
            'questions': [{'number': q['number']} for q in section['questions']],
        } for section in paper['sections']],
    })
(directory / 'catalog.json').write_text(json.dumps(catalogue, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Validated {len(catalogue)} papers; catalogue contains no passages, options or answers.')
