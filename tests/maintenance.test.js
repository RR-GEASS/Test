import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { installHistory } from "../server/history.js";
import { installMaintenance } from "../server/maintenance.js";

test("le stockage compte les deux types de pièces et ne nettoie que les vrais orphelins du propriétaire", async()=>{
  const db=new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,state TEXT);
    CREATE TABLE attachments(id TEXT,user_id TEXT,transaction_id TEXT,name TEXT,size_bytes INTEGER,created_at TEXT);
    CREATE TABLE entity_documents(id TEXT,user_id TEXT,kind TEXT,entity_id TEXT,name TEXT,size_bytes INTEGER,created_at TEXT);`);
  const state={transactions:[{id:"active"},{id:"cancelled",cancelledAt:"2026-01-01"}],suppliers:[{id:"archived",archived:true}],tenants:[],leases:[]};
  for(const id of ["a","b"])db.prepare("INSERT INTO users VALUES(?,?)").run(id,JSON.stringify(state));
  db.exec(`INSERT INTO attachments VALUES('active','a','active','facture.pdf',10,'2026-01-01'),('old','a','missing','ancien.pdf',20,'2026-01-01'),('cancelled','a','cancelled','annule.pdf',30,'2026-01-01'),('foreign','b','missing','secret.pdf',1000,'2026-01-01');
    INSERT INTO entity_documents VALUES('archived','a','supplier','archived','contrat.pdf',40,'2026-01-01'),('old-lease','a','lease','missing','bail.pdf',50,'2026-01-01');`);
  const app=express();
  installMaintenance(app,db,(req,res,next)=>{
    const actor=req.get('x-test-user');if(!actor)return res.status(401).json({error:'auth'});
    req.actor={id:actor};req.user={id:actor==='member'?'a':actor};next();
  });
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(path,user='a',method='GET')=>{
    const r=await fetch(base+path,{method,headers:user?{'x-test-user':user}:{}});return {status:r.status,data:await r.json()};
  };
  try {
    assert.equal((await request('/api/storage','')).status,401);
    const summary=(await request('/api/storage')).data;
    assert.deepEqual(summary,{usedBytes:150,maxBytes:50*1024*1024,operationBytes:60,entityBytes:90,orphanBytes:70,orphanCount:2});
    assert.equal((await request('/api/storage','member')).status,200);
    assert.equal((await request('/api/storage/orphans','member')).status,403);
    const rows=(await request('/api/storage/orphans')).data.orphans;
    assert.deepEqual(rows.map(row=>row.id).sort(),['old','old-lease']);
    assert.equal('data' in rows[0],false);
    assert.equal((await request('/api/storage/orphans/operation/foreign','a','DELETE')).status,404);
    assert.equal((await request('/api/storage/orphans/operation/active','a','DELETE')).status,404);
    assert.equal((await request('/api/storage/orphans/entity/archived','a','DELETE')).status,404);
    assert.equal((await request('/api/storage/orphans/operation/old','member','DELETE')).status,403);
    assert.equal((await request('/api/storage/orphans/operation/old','a','DELETE')).status,200);
    const restored=JSON.parse(db.prepare("SELECT state FROM users WHERE id='a'").get().state);
    restored.leases.push({id:'missing'});db.prepare("UPDATE users SET state=? WHERE id='a'").run(JSON.stringify(restored));
    assert.equal((await request('/api/storage/orphans/entity/old-lease','a','DELETE')).status,404);
    assert.equal((await request('/api/storage')).data.orphanCount,0);
  } finally {await new Promise(resolve=>server.close(resolve));db.close();}
});


test("seule une location vide du propriétaire peut être supprimée, avec révision et historique atomiques",async()=>{
  const db=new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,state TEXT,revision INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE attachments(id TEXT,user_id TEXT,transaction_id TEXT,name TEXT,size_bytes INTEGER,created_at TEXT);
    CREATE TABLE entity_documents(id TEXT,user_id TEXT,kind TEXT,entity_id TEXT,name TEXT,size_bytes INTEGER,created_at TEXT);`);
  const original={leases:[{id:'empty',tenantId:'t',propertyId:'p'},{id:'with-doc'},{id:'with-op'},{id:'with-rule'},{id:'with-rent',rentChanges:[{effectiveDate:'2026-01-01',rentCents:50000,chargesCents:0}]}],transactions:[{id:'op',leaseId:'with-op'}],recurrences:[{id:'rule',leaseId:'with-rule'}]};
  db.prepare('INSERT INTO users(id,state) VALUES(?,?)').run('a',JSON.stringify(original));
  db.exec("INSERT INTO entity_documents VALUES('bail','a','lease','with-doc','bail.pdf',10,'2026-01-01');");
  const app=express();
  const auth=(req,res,next)=>{const id=req.get('x-test-user');if(!id)return res.status(401).json({error:'auth'});req.actor={id,email:id+'@example.test'};req.user={id:'a'};next();};
  installHistory(app,db,auth);installMaintenance(app,db,auth);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  const remove=async(id,actor='a')=>{const r=await fetch(base+'/api/leases/'+id,{method:'DELETE',headers:{'x-test-user':actor}});return {status:r.status,data:await r.json()};};
  try {
    assert.equal((await remove('empty','member')).status,403);
    for(const id of ['with-doc','with-op','with-rule','with-rent'])assert.equal((await remove(id)).status,409);
    assert.equal(db.prepare("SELECT revision FROM users WHERE id='a'").get().revision,0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM audit_events').get().n,0);
    const result=await remove('empty');assert.equal(result.status,200);assert.equal(result.data.revision,1);
    assert.equal(result.data.state.leases.some(row=>row.id==='empty'),false);
    const event=db.prepare('SELECT * FROM audit_events').get();assert.equal(event.entity_type,'leases');assert.equal(event.action,'delete');assert.equal(event.actor_email,'a@example.test');
    assert.equal(JSON.parse(event.before_json).propertyId,'p');
    assert.equal((await remove('empty')).status,404);
    assert.equal(db.prepare("SELECT revision FROM users WHERE id='a'").get().revision,1);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
