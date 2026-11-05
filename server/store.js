import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export function createStore(dir){
  mkdirSync(dir,{recursive:true});mkdirSync(path.join(dir,'photos'),{recursive:true});
  const db=new DatabaseSync(path.join(dir,'notebook.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL)');
  return {dir,db,list(kind){return db.prepare('SELECT body FROM records WHERE kind=? ORDER BY created_at DESC, id').all(kind).map(r=>JSON.parse(r.body));},get(id){const row=db.prepare('SELECT body FROM records WHERE id=?').get(id);return row?JSON.parse(row.body):null;},create(kind,body){const item={...body,id:randomUUID(),kind,created_at:new Date().toISOString()};db.prepare('INSERT INTO records VALUES (?,?,?,?)').run(item.id,kind,item.created_at,JSON.stringify(item));return item;},save(item){db.prepare('UPDATE records SET body=? WHERE id=?').run(JSON.stringify(item),item.id);return item;},close(){db.close();}};
}
