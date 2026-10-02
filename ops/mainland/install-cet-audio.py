#!/usr/bin/env python3
"""Install reviewed, content-addressed CET audio without overwriting assets."""
import argparse, hashlib, json, os, re, shutil
from pathlib import Path

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--staging',type=Path,required=True)
    p.add_argument('--destination',type=Path,default=Path('/opt/context-reader-shared/cet-audio'))
    args=p.parse_args()
    staging=args.staging.resolve(); destination=args.destination.resolve()
    if destination!=Path('/opt/context-reader-shared/cet-audio'):raise SystemExit('Unexpected audio destination')
    rows=json.loads((staging/'manifest.json').read_text())
    if not isinstance(rows,list) or not 1<=len(rows)<=200:raise SystemExit('Invalid manifest')
    # Validate every file before installing any of them.
    for row in rows:
        name=row['file'];src=staging/name
        if not re.fullmatch(r'[a-f0-9]{64}\.(?:mp3|m4a)',name) or src.is_symlink() or src.parent.resolve()!=staging:raise SystemExit('Invalid asset path')
        if not 1000<=row['bytes']<=104857600 or src.stat().st_size!=row['bytes']:raise SystemExit('Invalid asset size')
        digest=hashlib.file_digest(src.open('rb'),'sha256').hexdigest()
        if digest!=row['sha256'] or not name.startswith(digest):raise SystemExit('Audio hash mismatch')
        if (destination/name).exists() and hashlib.file_digest((destination/name).open('rb'),'sha256').hexdigest()!=digest:raise SystemExit('Existing immutable asset mismatch')
    destination.mkdir(parents=True,exist_ok=True);os.chmod(destination,0o755)
    installed=0
    for row in rows:
        dest=destination/row['file']
        if dest.exists():continue
        temp=destination/(row['file']+'.upload')
        with temp.open('xb') as out, (staging/row['file']).open('rb') as source:shutil.copyfileobj(source,out)
        os.chmod(temp,0o644);os.replace(temp,dest);installed+=1
    print(json.dumps({'verified':len(rows),'installed':installed,'bytes':sum(r['bytes'] for r in rows)}))

if __name__=='__main__':main()
