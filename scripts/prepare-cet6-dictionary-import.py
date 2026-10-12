"""Offline exhaustive APKG -> account import. Does not connect to any API/database.

The generated SQL guards the exact account, takes the existing study lock,
preserves original Anki rows, and is a no-op for an already imported package.
Dictionary results are externally authored in Codex; this script never generates them.
Private outputs must stay outside Git. Run the SQL in a restored/schema-only test DB
first, then take a current account snapshot and prepare it again for production.
"""
import argparse,collections,datetime as dt,hashlib,html,json,pathlib,re,sqlite3,struct,uuid,zipfile
from urllib.parse import quote

UTC=dt.timezone.utc
SH=dt.timezone(dt.timedelta(hours=8))
def iso(value):return value.astimezone(UTC).isoformat(timespec='milliseconds').replace('+00:00','Z')
def normalize(word):
 import unicodedata
 return re.sub(r'\s+',' ',unicodedata.normalize('NFKC',word.strip())).lower()
def literal(value):return "'"+json.dumps(value,ensure_ascii=True,separators=(',',':')).replace("'","''")+"'::jsonb"
def ensure(condition,message):
 if not condition:raise ValueError(message)

def prepare(args):
 owner=str(uuid.UUID(args.user));now=dt.datetime.fromisoformat(args.as_of.replace('Z','+00:00'));ensure(now.tzinfo,'as-of needs timezone')
 output=pathlib.Path(args.output);output.mkdir(parents=True,exist_ok=True)
 source=pathlib.Path(args.apkg);digest=hashlib.sha256(source.read_bytes()).hexdigest()
 with zipfile.ZipFile(source) as archive:
  ensure('collection.anki21b' in archive.namelist(),'Expected a modern APKG with FSRS metadata')
  import zstandard
  raw=zstandard.ZstdDecompressor().decompress(archive.read('collection.anki21b'),max_output_size=100_000_000)
 ensure(raw.startswith(b'SQLite format 3\0'),'Invalid collection database')
 dbpath=(output/'collection.sqlite').resolve();dbpath.write_bytes(raw)
 db=sqlite3.connect(dbpath.as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
 db.create_collation('unicase',lambda a,b:(a.casefold()>b.casefold())-(a.casefold()<b.casefold()))
 ensure(db.execute('pragma integrity_check').fetchone()[0]=='ok','Corrupt collection')
 notes=[dict(r) for r in db.execute('select * from notes order by id')]
 cards=[dict(r) for r in db.execute('select * from cards order by id')]
 logs=[dict(r) for r in db.execute('select * from revlog order by id')]
 config={r['key']:json.loads(r['val']) for r in db.execute('select * from config')}
 ensure(config.get('creationOffset')==-480,'Source timezone needs explicit mapping')
 creation=dt.datetime.fromtimestamp(db.execute('select crt from col').fetchone()[0],SH).date()
 fields=collections.defaultdict(dict)
 for r in db.execute('select ntid,ord,name from fields not indexed'):fields[r['ntid']][r['ord']]=r['name']
 words={n['id']:{fields[n['mid']][i]:html.unescape(v) for i,v in enumerate(n['flds'].split('\x1f'))} for n in notes}
 ensure(len(notes)==len(cards)==len({c['nid'] for c in cards}),'Expected one card per note')
 ensure(len({normalize(w['Word']) for w in words.values()})==len(words),'Duplicate word identities')
 ensure(all((c['type'],c['queue']) in ((0,0),(1,1),(1,3),(2,2),(3,1),(3,3)) and not c['odid'] for c in cards),'Unsupported suspended/filtered state')
 # Source uses 15/30 minute initial steps. Validate the packed repeated floats;
 # retain the exact remaining step index, while future answers use site settings.
 configs=[dict(r) for r in db.execute('select * from deck_config')]
 ensure(len(configs)==1,'Multiple deck options need explicit per-deck mapping')
 blob=configs[0]['config'];ensure(blob[:2]==b'\x0a\x08','Unexpected source learning steps')
 source_steps=list(struct.unpack('<ff',blob[2:10]));ensure(source_steps==[15.0,30.0],'Source learning steps changed')
 by_query={};generation_hashes={}
 for file in sorted(pathlib.Path(args.generated).glob('generated-*/batch-*.jsonl')):
  generation_hashes[str(file.relative_to(args.generated))]=hashlib.sha256(file.read_bytes()).hexdigest()
  for line in file.read_text(encoding='utf8').splitlines():
   if not line.strip():continue
   r=json.loads(line);key=normalize(r['query']);ensure(key not in by_query,'Duplicate result: '+key)
   ensure(r['direction']=='en_to_cn' and r['inputStatus'] in ('valid','inflection','ambiguous'),'Invalid input result: '+key)
   ensure(r.get('lemma') and r.get('usageGuide') and len(r.get('collocations',[]))>=3,'Incomplete dictionary: '+key)
   ensure(r.get('senses') and all(s.get('headword') and s.get('partOfSpeech') and s.get('meaning') and s.get('exampleEnglish') and s.get('exampleChinese') for s in r['senses']),'Incomplete sense: '+key)
   ensure(all(c.get('phrase') and c.get('meaning') and c.get('exampleEnglish') for c in r['collocations']),'Incomplete collocation: '+key)
   ensure(all(isinstance(r.get(k),list) for k in ('wordFamily','synonyms','commonMistakes')),'Missing learning sections: '+key)
   ensure(not r.get('phonetic') or r.get('phoneticFor')==r['query'],'Phonetic identity mismatch: '+key)
   by_query[key]=r
 ensure(set(by_query)=={normalize(w['Word']) for w in words.values()},'Generated query set must exactly cover the source')
 before=json.loads(pathlib.Path(args.snapshot).read_text(encoding='utf8'))
 ensure(all(row['user_id']==owner for rows in before.values() for row in rows),'Snapshot account mismatch')
 ensure(not before['study_cards'] and not before['study_reviews'],'Target already has learning data; requires merge review')
 existing_words={normalize(o['payload'].get('word','')) for o in before['user_data_objects'] if o['kind']=='vocabulary' and not o['deleted_at']}
 ensure(not existing_words.intersection(by_query),'Existing vocabulary overlap needs explicit merge')
 card_ids={c['id']:c for c in cards};grouped=collections.defaultdict(list)
 for r in logs:
  ensure(r['cid'] in card_ids and r['type'] in(0,1,2,4),'Unsupported source event')
  ensure(dt.datetime.fromtimestamp(r['id']/1000,UTC)<now,'Future source event')
  if r['type']==4:ensure(r['ease']==0,'Unexpected manual event')
  else:ensure(1<=r['ease']<=4 and 0<=r['time']<=60000,'Invalid source review');grouped[r['cid']].append(r)
 objects=[];target_cards=[];reviews=[]
 for c in cards:
  f=words[c['nid']];word=f['Word'];r=by_query[normalize(word)];ensure(r['query']==word,'Query spelling changed')
  entry_id='anki-import-'+str(c['nid']);card_id=hashlib.sha256(entry_id.encode()).hexdigest()[:40]
  created=iso(dt.datetime.fromtimestamp(c['nid']/1000,UTC));stamp=iso(now)
  meaning='\n'.join(s['partOfSpeech']+'：'+s['meaning'] for s in r['senses']);example=r['senses'][0]
  usage=[r['usageGuide']]
  if r.get('verbForms'):usage.append('动词变形：'+ '；'.join(r['verbForms'].values()))
  usage.extend(['近义词辨析：'+'；'.join(x['word']+'（'+x['difference']+'）' for x in r['synonyms']), '词族：'+'；'.join(x['word']+'（'+x['partOfSpeech']+'，'+x['meaning']+'）' for x in r['wordFamily'])])
  usage.extend(r['commonMistakes']);usage.append(r.get('memoryTip',''))
  entry={'id':entry_id,'word':word,'lemma':r['lemma'],'phonetic':r.get('phonetic',''),'phoneticFor':r.get('phoneticFor',''),
   'partOfSpeech':'、'.join(dict.fromkeys(s['partOfSpeech'] for s in r['senses'])),'basicMeaning':meaning,'contextMeaning':meaning,
   'usageNote':'\n'.join(x for x in usage if x),'collocation':'\n'.join(x['phrase']+'（'+x['meaning']+'）：'+x['exampleEnglish'] for x in r['collocations']),
   'exampleEnglish':example['exampleEnglish'],'exampleChinese':example['exampleChinese'],'sourceSentence':'','sentenceTranslation':'','previousSentence':'','nextSentence':'',
   'createdAt':created,'updatedAt':stamp,'difficulty':'medium','shouldAddToVocabulary':True,'dictionaryResult':r,
   'anki':{'cardMode':'basic_en_to_cn','canMakeCloze':False,'clozeSentence':'','contextCue':'','basicCue':'','frontPreview':word,'backPreview':meaning,'ankiNoteId':c['nid'],'ankiImportedAt':stamp}}
  def add(kind,key,payload):objects.append({'kind':kind,'object_key':key,'payload':payload})
  add('vocabulary',entry_id,entry)
  key=normalize(word);encoded=quote(key,safe="~()*!.'-_")
  add('preferences','standalone-dictionary-cache:'+encoded,{'schemaVersion':2,'query':word,'normalizedQuery':key,'updatedAt':stamp,'result':r})
  add('preferences','standalone-dictionary-history:'+encoded,{'query':word,'normalizedQuery':key,'lastLookedUpAt':stamp})
  event_id=str(uuid.uuid5(uuid.NAMESPACE_URL,'context-reader:'+owner+':anki-dictionary:'+str(c['nid'])))
  deletes=[o['payload']['id'] for o in before['user_data_objects'] if o['kind']=='preferences' and o['object_key'].startswith('dictionary-history-event:v1:') and o['payload'].get('kind')=='delete' and o['payload'].get('normalizedQuery')==key]
  add('preferences','dictionary-history-event:v1:'+event_id,{'id':event_id,'kind':'query','query':word,'normalizedQuery':key,'at':stamp,'observedDeletes':deletes})
  data=json.loads(c['data'] or '{}');events=grouped[c['id']]
  memory={'state':c['type'],'reps':c['reps'],'lapses':c['lapses'],'learning_steps':0,'scheduled_days':c['ivl'],'elapsed_days':0,'due':stamp,'stability':0,'difficulty':0}
  if c['type']:
   ensure(events and 0<data['s']<=36500 and 1<=data['d']<=10,'Missing FSRS state: '+word)
   last=dt.datetime.fromtimestamp(data['lrt'],UTC);ensure(data['lrt']==events[-1]['id']//1000,'Last review mismatch: '+word)
   due=dt.datetime.fromtimestamp(c['due'],UTC) if c['queue']==1 else dt.datetime.combine(creation+dt.timedelta(days=c['due']),dt.time(),SH)
   ensure(due>last,'Due before last review: '+word)
   memory.update(due=iso(due),last_review=iso(last),stability=data['s'],difficulty=data['d'])
   if c['type'] in(1,3):
    remaining=c['left']%1000;ensure(0<remaining<=len(source_steps),'Unexpected remaining learning steps')
    memory['learning_steps']=len(source_steps)-remaining if c['type']==1 else 0
   if len(events)>1:memory['elapsed_days']=max(0,int((events[-1]['id']-events[-2]['id'])/86400000))
  else:ensure(not events and not c['reps'] and not c['lapses'],'New card with history needs explicit mapping')
  target_cards.append({'id':card_id,'entry_id':entry_id,'mode':'basic_en_to_cn','memory':memory,'created_at':created,'reward_key':hashlib.sha256(key.encode()).hexdigest()})
  for event in events:
   previous=0 if event['type']==0 and event['lastIvl']==0 else {0:1,1:2,2:3}[event['type']]
   nxt=2 if event['ivl']>0 else (3 if event['type'] in(1,2) else 1)
   reviews.append({'id':str(uuid.uuid5(uuid.NAMESPACE_URL,f"context-reader:{owner}:anki:{event['id']}:{event['cid']}")),'card_id':card_id,
    'answer':{1:'forgot',2:'unsure_right',3:'remembered',4:'remembered'}[event['ease']],'rating':event['ease'],'reviewed_at':iso(dt.datetime.fromtimestamp(event['id']/1000,UTC)),'active_ms':event['time'],
    'previous':{'state':previous,'anki_interval':event['lastIvl'],'history_only':True},'next':{'state':nxt,'anki_interval':event['ivl'],'history_only':True},
    'parameters':{'source':'anki-apkg','sha256':digest,'revlog':event}})
 existing={(o['kind'],o['object_key']):o for o in before['user_data_objects']}
 ensure(not any((o['kind'],o['object_key']) in existing for o in objects),'Object overlap; prepare a reviewed merge instead')
 summary={'sha256':digest,'notes':len(notes),'cards':len(cards),'sourceEvents':len(logs),'reviews':len(reviews),'manualEvents':len(logs)-len(reviews),
  'states':dict(collections.Counter(c['type'] for c in cards)),'dictionaryResults':len(by_query),'providerCalls':0,'generation':'Codex authored','files':generation_hashes,'learningStepsMinutes':source_steps}
 archived={'notes':notes,'cards':cards,'revlog':logs,'config':config,'collectionCreatedAt':db.execute('select crt from col').fetchone()[0],
  'deckConfig':[dict(c,config=c['config'].hex()) for c in configs]}
 payload={'objects':objects,'cards':target_cards,'reviews':reviews,'summary':summary,'source':archived}
 (output/'payload.json').write_text(json.dumps(payload,ensure_ascii=False),encoding='utf8')
 (output/'report.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
 ensure(re.fullmatch(r'[A-Za-z0-9_\-]{1,60}',args.nickname),'Unsafe account name')
 sql=['\\set ON_ERROR_STOP on','begin;',"set local lock_timeout='10s';","set local statement_timeout='120s';",
  f"select pg_advisory_xact_lock(hashtextextended('study:{owner}',0));",
  f"select exists(select 1 from study_import_batches where user_id='{owner}' and source_sha256='{digest}') as already_imported \\gset",
  '\\if :already_imported',"select 'already imported; no changes';",'commit;','\\quit','\\endif',
  f"do $$ begin if not exists(select 1 from account_profiles p join user_entitlements e using(user_id) where p.user_id='{owner}' and p.nickname='{args.nickname}' and p.status='active' and e.plan_id='admin' and e.starts_at<=now() and (e.ends_at is null or e.ends_at>now())) then raise exception 'target identity mismatch';end if;end $$;",
  'create temp table cet6_input(doc jsonb) on commit drop;',f'insert into cet6_input values({literal(payload)});',
  f"do $$ begin if exists(select 1 from study_cards where user_id='{owner}') or exists(select 1 from study_reviews where user_id='{owner}') then raise exception 'target acquired learning data';end if; if exists(select 1 from user_data_objects where user_id='{owner}' and kind='vocabulary' and deleted_at is null) then raise exception 'target acquired vocabulary; merge required';end if; if exists(select 1 from cet6_input i,jsonb_array_elements(i.doc->'objects') x join user_data_objects o on o.user_id='{owner}' and o.kind=x->>'kind' and o.object_key=x->>'object_key') then raise exception 'import key collision';end if;end $$;",
  f"insert into user_data_objects(user_id,kind,object_key,payload,client_updated_at) select '{owner}',x->>'kind',x->>'object_key',x->'payload',now() from cet6_input i,jsonb_array_elements(i.doc->'objects') x;",
  f"insert into study_cards(user_id,id,entry_id,mode,memory,created_at,reward_key,anki_pending) select '{owner}',x->>'id',x->>'entry_id',x->>'mode',x->'memory',(x->>'created_at')::timestamptz,x->>'reward_key',true from cet6_input i,jsonb_array_elements(i.doc->'cards') x;",
  f"insert into study_reviews(user_id,id,card_id,answer,rating,reviewed_at,active_ms,previous,next,algorithm,parameters,version) select '{owner}',(r->>'id')::uuid,r->>'card_id',r->>'answer',(r->>'rating')::int,(r->>'reviewed_at')::timestamptz,(r->>'active_ms')::int,r->'previous',r->'next','Anki/imported-history',r->'parameters',-1 from cet6_input i,jsonb_array_elements(i.doc->'reviews') r;",
  f"insert into study_settings(user_id,settings) values('{owner}','{{\"includeAnki\":true}}') on conflict(user_id) do update set settings=study_settings.settings||'{{\"includeAnki\":true}}',updated_at=now();",
  # A pre-existing empty plan must accept the imported review queue. Never replace a nonempty plan.
  f"delete from study_days where user_id='{owner}' and day=(now() at time zone 'Asia/Shanghai')::date and jsonb_array_length(card_ids)=0 and completed_at is null and reward_points=0;",
  f"insert into study_import_batches(user_id,source_sha256,source_name,summary,source_data) select '{owner}','{digest}',{literal(source.name)}#>>'{{}}',doc->'summary',doc->'source' from cet6_input;",
  f"select jsonb_build_object('vocabulary',(select count(*) from user_data_objects where user_id='{owner}' and kind='vocabulary' and deleted_at is null),'cards',(select count(*) from study_cards where user_id='{owner}'),'reviews',(select count(*) from study_reviews where user_id='{owner}'),'receipts',(select count(*) from study_import_batches where user_id='{owner}'));",
  'commit;']
 (output/'import.sql').write_text('\n'.join(sql)+'\n',encoding='utf8')
 print(json.dumps({k:v for k,v in summary.items() if k!='files'},ensure_ascii=False))

if __name__=='__main__':
 p=argparse.ArgumentParser()
 for name in ('apkg','generated','snapshot','user','nickname','as-of','output'):p.add_argument('--'+name,required=True)
 prepare(p.parse_args())
