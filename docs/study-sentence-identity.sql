-- Keep older clients from stripping the kind of an explicitly collected sentence.
begin;
create or replace function public.study_sentence_payload(k text, p jsonb) returns jsonb
language sql immutable strict set search_path=pg_catalog as $$
 select case when k ~ '^sentence-[a-f0-9]{64}$' and p->>'id'=k
   and p->>'word'=p->>'sourceSentence' and length(trim(p->>'sentenceTranslation'))>0
   and k='sentence-'||encode(sha256(convert_to(normalize(p->>'sourceSentence',NFC),'UTF8')),'hex')
   then jsonb_set(p||'{"entryKind":"sentence","sentenceStudyEnabled":true}', '{anki}',
     coalesce(nullif(p->'anki','null'),'{}') || jsonb_build_object('cardMode','basic_cn_to_en','basicCue',p->>'sentenceTranslation'))
   else p end
$$;
create or replace function public.study_preserve_saved_sentence() returns trigger
language plpgsql set search_path=public as $$
begin
 if new.kind='vocabulary' and new.deleted_at is null and new.object_key like 'sentence-%' then
   if tg_op='UPDATE' and old.deleted_at is null and old.payload->>'entryKind'='sentence' then
     -- The key identifies immutable original text. A legacy summary is not a deletion.
     new.payload:=old.payload||coalesce(nullif(new.payload,'null'),'{}')||jsonb_build_object(
       'id',old.object_key,'word',old.payload->>'word','sourceSentence',old.payload->>'sourceSentence',
       'createdAt',old.payload->>'createdAt','sentenceTranslation',case when length(trim(new.payload->>'sentenceTranslation'))>0
         then new.payload->>'sentenceTranslation' else old.payload->>'sentenceTranslation' end);
   end if;
   new.payload:=study_sentence_payload(new.object_key,new.payload);
 end if;
 return new;
end $$;
create or replace trigger study_keep_sentence before insert or update of payload,deleted_at on public.user_data_objects
 for each row execute function public.study_preserve_saved_sentence();
update public.user_data_objects
 set payload=jsonb_set(study_sentence_payload(object_key,payload),'{updatedAt}',to_jsonb(now())),
     updated_at=now(),client_updated_at=now(),server_version=server_version+1
 where kind='vocabulary' and deleted_at is null and object_key like 'sentence-%'
   and payload is distinct from study_sentence_payload(object_key,payload);
update public.study_cards c set mode='basic_cn_to_en',suspended=false,version=c.version+1
 from public.user_data_objects o where o.user_id=c.user_id and o.object_key=c.entry_id and o.kind='vocabulary'
 and o.deleted_at is null and o.payload->>'entryKind'='sentence' and (c.suspended or c.mode<>'basic_cn_to_en');
-- Initialize missing cards with the same empty FSRS memory as newMemory(). Keep all previous review history.
insert into public.study_cards(user_id,id,entry_id,mode,memory,reward_key)
 select user_id,left(encode(sha256(convert_to(object_key,'UTF8')),'hex'),40),object_key,'basic_cn_to_en',
   jsonb_build_object('due',now(),'stability',0,'difficulty',0,'elapsed_days',0,'scheduled_days',0,
     'reps',0,'lapses',0,'learning_steps',0,'state',0),
   encode(sha256(convert_to(regexp_replace(lower(trim(normalize(payload->>'word',NFKC))),'[[:space:]]+',' ','g'),'UTF8')),'hex')
 from public.user_data_objects where kind='vocabulary' and deleted_at is null and payload->>'entryKind'='sentence'
 on conflict(user_id,id) do nothing;
revoke all on function public.study_sentence_payload(text,jsonb), public.study_preserve_saved_sentence() from public,anon,authenticated;
grant execute on function public.study_sentence_payload(text,jsonb), public.study_preserve_saved_sentence() to service_role;
commit;
