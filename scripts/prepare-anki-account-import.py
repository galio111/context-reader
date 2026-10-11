"""Prepare a fail-closed, data-only import; never connects to production.

Requires zstandard for modern APKG. Inputs/outputs contain private account data:
keep them outside Git. Only exhaustive one-note/one-card FSRS New/Review imports
are supported. Other states or ambiguous identities require separate review.
"""
import argparse
import collections
import datetime as dt
import hashlib
import html
import json
import pathlib
import re
import sqlite3
import uuid
import zipfile

if not __debug__:
    raise RuntimeError("Run without -O: import safety assertions must remain enabled")

UTC = dt.timezone.utc
SH = dt.timezone(dt.timedelta(hours=8))


def normalize(value):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]*>", "", value))).strip().casefold()


def iso(value):
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def sql_json(value):
    return "'" + json.dumps(value, ensure_ascii=True, separators=(",", ":")).replace("'", "''") + "'::jsonb"


def prepare(apkg, snapshot, output, user_id, as_of):
    uuid.UUID(user_id)
    now = dt.datetime.fromisoformat(as_of.replace("Z", "+00:00"))
    assert now.tzinfo
    output.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(apkg.read_bytes()).hexdigest()
    with zipfile.ZipFile(apkg) as archive:
        name = "collection.anki21b" if "collection.anki21b" in archive.namelist() else "collection.anki21"
        assert archive.getinfo(name).file_size < 100_000_000
        raw = archive.read(name)
        if name.endswith("b"):
            import zstandard
            raw = zstandard.ZstdDecompressor().decompress(raw, max_output_size=100_000_000)
        assert raw.startswith(b"SQLite format 3\0")
        db_path = output / "collection.sqlite"
        db_path.write_bytes(raw)
    db = sqlite3.connect(db_path.as_uri() + "?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    db.create_collation("unicase", lambda a, b: (a.casefold() > b.casefold()) - (a.casefold() < b.casefold()))
    assert db.execute("pragma integrity_check").fetchone()[0] == "ok"
    notes = [dict(r) for r in db.execute("select * from notes order by id")]
    cards = [dict(r) for r in db.execute("select * from cards order by id")]
    logs = [dict(r) for r in db.execute("select * from revlog order by id")]
    config = {r["key"]: json.loads(r["val"]) for r in db.execute("select * from config")}
    assert config["creationOffset"] == -480, "Review source timezone before importing"
    creation_date = dt.datetime.fromtimestamp(db.execute("select crt from col").fetchone()[0], SH).date()
    assert len(notes) == len(cards) == len({c["nid"] for c in cards})
    assert all((c["type"], c["queue"]) in ((0, 0), (2, 2)) and not c["odid"] for c in cards)
    assert all(r["type"] in (0, 1, 2) and 1 <= r["ease"] <= 4 and 0 <= r["time"] <= 60000 for r in logs)
    assert all(dt.datetime.fromtimestamp(r["id"] / 1000, UTC) < now - dt.timedelta(minutes=15) for r in logs)
    fields = collections.defaultdict(dict)
    for r in db.execute("select ntid,ord,name from fields not indexed"):
        fields[r["ntid"]][r["ord"]] = r["name"]
    before = json.loads(snapshot.read_text(encoding="utf8"))
    assert all(row["user_id"] == user_id for rows in before.values() for row in rows)
    entries = [v["payload"] for v in before["user_data_objects"] if v["kind"] == "vocabulary" and not v["deleted_at"]]
    imported = [v for v in entries if v.get("anki", {}).get("ankiNoteId")]
    by_id = {v["id"]: v for v in imported}
    by_note = {int(v["anki"]["ankiNoteId"]): v for v in imported}
    assert len(by_note) == len(imported)
    matched, methods = {}, collections.Counter()
    for note in notes:
        f = {fields[note["mid"]][i]: html.unescape(v) for i, v in enumerate(note["flds"].split("\x1f"))}
        entry = by_id.get(f.get("ContextReaderId"))
        method = "context_id"
        if not entry:
            entry, method = by_note.get(note["id"]), "note_id"
        if not entry:
            candidates = [v for v in imported if normalize(v["word"]) == normalize(f["Word"]) and v["createdAt"] == f.get("CreatedAt")]
            assert len(candidates) == 1, f"Ambiguous note {note['id']}"
            entry, method = candidates[0], "created_at_and_word"
        if f.get("ContextReaderId"):
            assert f["ContextReaderId"] == entry["id"]
        matched[note["id"]] = entry
        methods[method] += 1
    assert len({v["id"] for v in matched.values()}) == len(imported) == len(notes), "Import must cover every excluded word"
    site_cards = {c["entry_id"]: c for c in before["study_cards"]}
    by_source_card = {c["id"]: c for c in cards}
    assert all(r["cid"] in by_source_card for r in logs)
    grouped = collections.defaultdict(list)
    for r in logs:
        grouped[r["cid"]].append(r)
    updates, history = [], []
    for c in cards:
        entry = matched[c["nid"]]
        target = site_cards[entry["id"]]
        assert target["anki_pending"] and not target["suspended"] and target["memory"]["state"] == 0 and target["version"] == 0
        assert not any(r["card_id"] == target["id"] for r in before["study_reviews"]), "Preserve native learning"
        data = json.loads(c["data"] or "{}")
        reviews = grouped[c["id"]]
        memory = dict(target["memory"])
        memory.update(state=c["type"], reps=c["reps"], lapses=c["lapses"], learning_steps=0,
                      scheduled_days=c["ivl"], elapsed_days=0)
        if c["type"] == 2:
            assert reviews and 0 < data["s"] <= 36500 and 1 <= data["d"] <= 10
            assert data["lrt"] == reviews[-1]["id"] // 1000
            # Preserve the Anki calendar due date; native study days start at Shanghai midnight.
            due = dt.datetime.combine(creation_date + dt.timedelta(days=c["due"]), dt.time(), SH)
            last = dt.datetime.fromtimestamp(data["lrt"], UTC)
            assert due > last
            memory.update(stability=data["s"], difficulty=data["d"], due=iso(due), last_review=iso(last))
            if len(reviews) > 1:
                memory["elapsed_days"] = max(0, int((reviews[-1]["id"] - reviews[-2]["id"]) / 86400000))
        else:
            assert not reviews and c["reps"] == c["lapses"] == 0
            memory.update(stability=0, difficulty=0, due=iso(now))
            memory.pop("last_review", None)
        updates.append({"id": target["id"], "entry_id": entry["id"], "memory": memory,
                        "before": target, "anki_card": c, "anki_note_id": c["nid"]})
        for r in reviews:
            # Anki does not export historical S/D snapshots. Store only known state/interval,
            # label these as history-only and keep the complete original event in parameters.
            previous_state = 0 if r["type"] == 0 and r["lastIvl"] == 0 else {0: 1, 1: 2, 2: 3}[r["type"]]
            next_state = 2 if r["ivl"] > 0 else (3 if r["type"] in (1, 2) else 1)
            history.append({"id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"context-reader:{user_id}:anki:{r['id']}:{r['cid']}")),
                            "card_id": target["id"], "answer": {1: "forgot", 2: "unsure_right", 3: "remembered", 4: "remembered"}[r["ease"]],
                            "rating": r["ease"], "reviewed_at": iso(dt.datetime.fromtimestamp(r["id"] / 1000, UTC)),
                            "active_ms": r["time"], "previous": {"state": previous_state, "anki_interval": r["lastIvl"], "history_only": True},
                            "next": {"state": next_state, "anki_interval": r["ivl"], "history_only": True},
                            "parameters": {"source": "anki-apkg", "sha256": digest, "revlog": r}, "version": -1})
    report = {"sha256": digest, "importedAt": iso(now), "notes": len(notes), "cards": len(updates), "reviews": len(history),
              "learned": sum(c["type"] == 2 for c in cards), "new": sum(c["type"] == 0 for c in cards),
              "matching": dict(methods), "unmatched": 0, "nativeReviewsPreserved": len(before["study_reviews"]),
              "due": sum(u["memory"]["state"] == 2 and u["memory"]["due"] <= iso(now) for u in updates),
              "historyActiveMs": sum(r["time"] for r in logs)}
    payload = {"report": report, "cards": updates, "reviews": history, "settingsBefore": before["study_settings"][0],
               "daysBefore": before["study_days"], "nativeCards": [c for c in before["study_cards"] if c["entry_id"] not in by_id]}
    (output / "import.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf8")
    (output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf8")
    # Receipt and transaction guards make repeat execution a no-op, including after later learning.
    sql = ["\\set ON_ERROR_STOP on", "begin;", "set local lock_timeout='10s';", "set local statement_timeout='120s';",
           f"select pg_advisory_xact_lock(hashtextextended('study:{user_id}',0));",
           f"select coalesce((select settings->'ankiImport'->>'sha256'='{digest}' from study_settings where user_id='{user_id}'),false) as already_imported \\gset",
           "\\if :already_imported", "select 'already imported; no changes' as result;", "commit;", "\\quit", "\\endif",
           "create temp table anki_input(doc jsonb) on commit drop;", f"insert into anki_input values({sql_json(payload)});",
           f"do $$ begin if not exists(select 1 from account_profiles p join user_entitlements e using(user_id) where p.user_id='{user_id}' and lower(p.nickname)='galio' and p.status='active' and e.plan_id='admin' and e.starts_at<=now() and (e.ends_at is null or e.ends_at>now())) then raise exception 'target identity mismatch'; end if; end $$;",
           f"do $$ begin perform 1 from study_cards where user_id='{user_id}' for update; perform 1 from study_settings where user_id='{user_id}' for update; end $$;",
           f"do $$ declare p jsonb; begin select doc into p from anki_input; if (select to_jsonb(s) from study_settings s where user_id='{user_id}') is distinct from p->'settingsBefore' then raise exception 'settings changed'; end if; if exists(select 1 from jsonb_array_elements(p->'cards') x left join study_cards c on c.user_id='{user_id}' and c.id=x->>'id' where to_jsonb(c) is distinct from x->'before') then raise exception 'cards changed'; end if; if (select count(*) from study_reviews where user_id='{user_id}')<>{len(before['study_reviews'])} then raise exception 'reviews changed';end if; if exists(select 1 from jsonb_array_elements(p->'daysBefore') x left join study_days d on d.user_id='{user_id}' and d.day=(x->>'day')::date where to_jsonb(d) is distinct from x) then raise exception 'plans changed';end if; end $$;",
           f"update study_cards c set memory=x->'memory',version=c.version+1,presentation_id=null,shown_at=null from anki_input i,jsonb_array_elements(i.doc->'cards') x where c.user_id='{user_id}' and c.id=x->>'id';",
           f"insert into study_reviews(user_id,id,card_id,answer,rating,reviewed_at,active_ms,previous,next,algorithm,parameters,version) select '{user_id}',(r->>'id')::uuid,r->>'card_id',r->>'answer',(r->>'rating')::int,(r->>'reviewed_at')::timestamptz,(r->>'active_ms')::int,r->'previous',r->'next','Anki/imported-history',r->'parameters',-1 from anki_input i,jsonb_array_elements(i.doc->'reviews') r;",
           f"update study_settings set settings=settings||jsonb_build_object('includeAnki',true,'ankiImport',(select doc->'report' from anki_input)),updated_at=now() where user_id='{user_id}';",
           # Existing day's native targets stay. Fill remaining review capacity with imported due cards.
           f"with extra as (select c.id from study_cards c join study_days d on d.user_id=c.user_id and d.day=(now() at time zone 'Asia/Shanghai')::date where c.user_id='{user_id}' and not c.suspended and not d.card_ids ? c.id and (c.memory->>'state')::int<>0 and (c.memory->>'due')::timestamptz<=now() order by (c.memory->>'due')::timestamptz,c.id limit (select greatest(0,coalesce((d.settings->>'reviewsPerDay')::int,100)-jsonb_array_length(d.card_ids)+jsonb_array_length(d.new_ids)) from study_days d where user_id='{user_id}' and day=(now() at time zone 'Asia/Shanghai')::date)) update study_days set card_ids=card_ids||(select coalesce(jsonb_agg(id),'[]') from extra),settings=settings||jsonb_build_object('includeAnki',true) where user_id='{user_id}' and day=(now() at time zone 'Asia/Shanghai')::date;",
           # Existing flexible-start RPC adds the imported genuinely new words on next entry.
           "select jsonb_build_object('imported',(select doc->'report' from anki_input)) as result;", "commit;", "\\q"]
    (output / "apply.sql").write_text("\n".join(sql) + "\n", encoding="utf8")
    db.close()
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("apkg", "snapshot", "output"):
        parser.add_argument("--" + key, type=pathlib.Path, required=True)
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--as-of", required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(**vars(args)), indent=2))
