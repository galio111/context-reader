"""Download only the reviewed, answer-paired manifest outside the website tree."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen

parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
repo = Path(__file__).resolve().parent.parent
output = args.output.resolve()
assert not output.is_relative_to(repo), 'Keep original PDFs outside the website/release checkout.'
manifest = json.loads((repo / 'data/cet/source-manifest.json').read_text(encoding='utf-8'))
catalogue = json.loads((repo / 'data/cet/catalog.json').read_text(encoding='utf-8'))
from urllib.parse import unquote
permitted = set()
for paper in catalogue:
    assert paper.get('answerSource'), 'A question paper may not be downloaded without its answer source.'
    for key in ('source', 'answerSource'):
        permitted.add(unquote(paper[key].split('/' + manifest['revision'] + '/', 1)[1]))
output.mkdir(parents=True, exist_ok=True)
for item in manifest['files']:
    if item['path'] not in permitted:
        continue
    destination = output / Path(item['file']).name
    if destination.exists() and hashlib.sha256(destination.read_bytes()).hexdigest() == item['sha256']:
        continue
    request = Request('https://api.github.com/repos/0609x/CET46-Resources/git/blobs/' + item['sha'],
                      headers={'User-Agent': 'Context-Reader-reviewed-source-import'})
    with urlopen(request, timeout=120) as response:
        blob = json.load(response)
    data = base64.b64decode(blob['content'])
    assert hashlib.sha256(data).hexdigest() == item['sha256'], 'Source checksum mismatch'
    destination.write_bytes(data)
    print(destination.name)
