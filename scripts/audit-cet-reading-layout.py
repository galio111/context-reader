from pathlib import Path
import zipfile,xml.etree.ElementTree as ET,re,json,hashlib,sys
import argparse
p=argparse.ArgumentParser(description='Conservative exact-source CET paragraph audit; requires PyMuPDF')
p.add_argument('--source',type=Path,required=True)
p.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[1])
p.add_argument('--output',type=Path,required=True)
a=p.parse_args(); SOURCE=a.source.resolve(); REPO=a.repo.resolve(); ROOT=a.output.resolve(); ROOT.mkdir(parents=True,exist_ok=True)
def norm(t):return re.sub(r'\s','',t)
manifest=json.loads((SOURCE/'word-source-manifest.json').read_text(encoding='utf-8'))
files={}
for m in manifest:
 bits=m['id'].split('-');bits[2]=bits[2].zfill(2);pid='-'.join(bits)
 f=SOURCE/'files'/m['file']
 if f.suffix=='.docx' and f.exists():
  with zipfile.ZipFile(f) as z:doc=ET.fromstring(z.read('word/document.xml'))
  ps=[''.join(e.itertext()) for e in []]
  ps=[''.join(e.text or '' for e in p.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t')) for p in doc.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p')]
  files[pid]=(m,ps)
overlay={};evidence=[];findings=[]
for f in (REPO/'data/cet').glob('cet*.json'):
 d=json.loads(f.read_text(encoding='utf-8'));pid=d['id'];src=files.get(pid)
 for section in d['sections']:
  ps=section['paragraphs'];updated=[];changed=False
  for index,p in enumerate(ps):
   if len(p.split())<250 or not src or section['type']=='cloze':updated.append(p);continue
   m,sps=src;text=''.join(norm(v) for v in sps);needle=norm(p);start=text.find(needle)
   if start<0 or text.find(needle,start+1)>=0:findings.append({'paperId':pid,'sectionId':section['id'],'paragraph':index,'reason':'no unique exact source match'});updated.append(p);continue
   boundaries=[];cursor=0
   for sp in sps:
    cursor+=len(norm(sp))
    if start<cursor<start+len(needle):boundaries.append(cursor-start)
   indexmap=[i for i,c in enumerate(p) if not c.isspace()]
   cuts=[0]+[indexmap[b] for b in sorted(set(boundaries))]+[len(p)]
   parts=[p[a:b].strip() for a,b in zip(cuts,cuts[1:])]
   if len(parts)<2 or len(parts)>18 or min(len(v.split()) for v in parts)<20:updated.append(p);continue
   assert norm(''.join(parts))==norm(p)
   updated.extend(parts);changed=True;evidence.append({'paperId':pid,'sectionId':section['id'],'paragraph':index,'parts':len(parts),'source':m['path'],'sha256':m['sha256'],'proof':'complete text exact match ignoring whitespace; source Word paragraph boundaries only'})
  if changed:overlay.setdefault(pid,{})[section['id']]=updated

# These five markers were identified in the existing catalogue. Verify in the
# source PDF below the reading text; removal is allowlisted, not a generic regex.
import pymupdf
f=SOURCE/'files/cet6-2018-6-2-questions.pdf';footerproof=[]
with pymupdf.open(f) as doc:
 for n,page in enumerate(doc):
  for line in page.get_text('dict')['blocks']:
   for row in line.get('lines',[]):
    t=''.join(s['text'] for s in row['spans'])
    if re.fullmatch(r'\s*第\s*[3-7]\s*页\s*',t):footerproof.append({'text':t,'page':n+1,'y':row['bbox'][1]/page.rect.height})
if len(footerproof)==5 and all(p['y']>.85 for p in footerproof):
 d=json.loads((REPO/'data/cet/cet6-2018-06-2.json').read_text(encoding='utf-8'))
 for s in d['sections']:
  old=overlay.get(d['id'],{}).get(s['id'],s['paragraphs']);new=[]
  for i,p in enumerate(old):
   match=re.search(r'第[3-7]\s*页',p)
   if match:
    evidence.append({'paperId':d['id'],'sectionId':s['id'],'paragraph':i,'removed':match[0],'proof':'exact allowlisted footer in original PDF below 85 percent page height'})
    kept=(p[:match.start()]+p[match.end():]).strip()
    if kept:new.append(kept)
   else:new.append(p)
  if new!=old:overlay.setdefault(d['id'],{})[s['id']]=new
out=ROOT/'reading-layout-proposed.json';out.write_text(json.dumps(overlay,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(ROOT/'layout-audit-result.json').write_text(json.dumps({'papersAudited':149,'sectionsAudited':596,'sourceWordPapers':len(files),'changes':evidence,'unconfirmed':findings,'footerProof':footerproof},ensure_ascii=False,indent=2),encoding='utf-8')
print('overlay papers',len(overlay),'changes',len(evidence),'footer proof',footerproof)
