"use client";
import {getLearningStorage} from './learningStorage';
import {notifyAccountDataChanged} from './accountEvents';
import {mergeTrailEvents,type CetTrailEvent} from './cetTypeTrail';
export const CET_TRAIL_KEY='context-reader:cet-type-trail:v1';
export const CET_TRAIL_PREFIX='cet-type-trail:v1:';
export function readCetTrail(storage:Storage=getLearningStorage()):CetTrailEvent[]{
 try{return mergeTrailEvents(JSON.parse(storage.getItem(CET_TRAIL_KEY)||'[]'));}catch{return [];}
}
export function writeCetTrail(storage:Storage,events:CetTrailEvent[]){storage.setItem(CET_TRAIL_KEY,JSON.stringify(mergeTrailEvents(readCetTrail(storage),events)));}
export function saveCetTrail(event:CetTrailEvent){writeCetTrail(getLearningStorage(),[event]);notifyAccountDataChanged(['preferences']);}
