from pathlib import Path
import json,re,argparse
parser=argparse.ArgumentParser(description='Attach reviewed CET4 OCR explanations to existing reading papers.')
parser.add_argument('--ocr-dir',required=True,type=Path)
root=parser.parse_args().ocr_dir
for f in Path('data/cet').glob('cet4-*.json'):
 p=json.loads(f.read_text(encoding='utf-8'));stem=f"cet4_{p['year']}_{p['month']:02}_cet4_{p['year']}_{p['month']:02}_{p['set']}_ans";src=root/(stem+'.txt')
 if not src.exists():continue
 t=src.read_text(encoding='utf-8');start=re.search(r'(?m)^26\s*[.．、]?\s*[A-O][)）]',t)
 if not start:print('NO START',f.name);continue
 t=t[start.start():];by={};
 if p['month']==6 and p['set']==3:t=t.replace('A)他们大多是非素食者。','52. 关于购买这些产品的消费者\nA)他们大多是非素食者。')
 anchors=list(re.finditer(r'(?m)^(2[6-9]|3[0-5])\s*[.．、]?\s*([A-O0])[)）]?',t))
 for i,m in enumerate(anchors):
  text=t[m.start():anchors[i+1].start() if i+1<len(anchors) else len(t)];text=re.split(r'Section\s*[BＢ]?|·长篇阅读',text)[0];by[int(m[1])]=re.sub(r'(?m)^\d*四级\d{4}\.\d+.*$|^位$|^析$', '',text).replace('定根据','定位：根据').replace('解第一','解析：第一').replace('解第二','解析：第二').strip()
 match=list(re.finditer(r'答[案索]?解析\s*([A-Z1])[。．.、]',t));print(f.name,'matching',len(match),[m[1] for m in match[:10]])
 # Matching explanations form an ordered 36-45 run, verified against imported answer keys.
 for i,m in enumerate(match[:10]):
  q=p['sections'][1]['questions'][i]
  if m[1].replace('1','I')!=q['answer']:print('ANSWER MISMATCH',q['number'],m[1],q['answer']);continue
  text=t[m.start():match[i+1].start() if i+1<len(match) else len(t)];text=re.split(r'(?m)^\d{2}\.题干译文|Section|Passage\s*One',text)[0];by[36+i]=re.sub(r'(?m)^\d*四级\d{4}\.\d+.*$|^位$|^析$', '',text).replace('定根据','定位：根据').replace('解第一','解析：第一').replace('解第二','解析：第二').strip()
 anchors=list(re.finditer(r'(?m)^(4[6-9]|5[0-5])[.．、]',t))
 for i,m in enumerate(anchors):
  text=t[m.start():anchors[i+1].start() if i+1<len(anchors) else len(t)];text=re.split(r'Passage\s*Two|Part\s*[IⅠVⅣ]+',text)[0];by[int(m[1])]=re.sub(r'(?m)^\d*四级\d{4}\.\d+.*$|^位$|^析$', '',text).replace('定根据','定位：根据').replace('解第一','解析：第一').replace('解第二','解析：第二').strip()
 for s in p['sections']:
  for q in s['questions']:
   if q['number'] in by:q['explanation']=by[q['number']]
 f.write_text(json.dumps(p,ensure_ascii=False,indent=2),encoding='utf-8');print('IMPORTED',len(by),'MISSING',[q['number'] for sec in p['sections'] for q in sec['questions'] if not q.get('explanation')])
