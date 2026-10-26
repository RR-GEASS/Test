import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from '../server/app.js';
import {entryRequirements,validateChangedEntries} from '../src/entry-rules.js';

test('les champs obligatoires dépendent du mouvement, sans exiger de fournisseur pour un loyer ou un apport',()=>{
  assert.ok(entryRequirements({type:'expense',category:'insurance'}).supplierId);
  assert.deepEqual(entryRequirements({type:'expense',category:'insurance',supplierId:'s'}),{});
  assert.ok(entryRequirements({type:'income',category:'rent'}).leaseId);
  assert.deepEqual(entryRequirements({type:'income',category:'rent',propertyId:'p',tenantId:'t',leaseId:'l'}),{});
  assert.ok(entryRequirements({type:'income',category:'contribution'}).counterparty);
  assert.deepEqual(entryRequirements({type:'income',category:'contribution',counterparty:'Associé A'}),{});
});

test('le serveur refuse les nouvelles saisies incomplètes sans altérer les données enregistrées',async()=>{
  const {app,close}=createApp({dbPath:':memory:',production:false});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  let cookie='';
  const request=async(path,body,method='POST')=>{
    const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
    if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
    return {status:r.status,data:await r.json()};
  };
  try {
    const a=(await request('/api/register',{email:'required@example.test',password:'entry-policy-password-2026',name:'SCI contrôlée'})).data;
    const state=a.state;
    const save=()=>request('/api/state',{state,revision:a.revision,accountId:a.user.id},'PUT');
    const row={id:'op',date:'2026-01-10',type:'expense',status:'pending',category:'maintenance',label:'Travaux',propertyId:'',amountCents:10000,counterparty:'Un nom libre',reference:'',notes:''};
    state.transactions=[row];
    let result=await save();assert.equal(result.status,400);assert.match(result.data.error,/fournisseur/i);
    state.transactions[0]={...row,type:'income',category:'rent',counterparty:'Locataire'};
    result=await save();assert.equal(result.status,400);assert.match(result.data.error,/location|locataire|bien/i);
    state.transactions[0]={...row,type:'income',category:'contribution',counterparty:''};
    result=await save();assert.equal(result.status,400);assert.match(result.data.error,/personne|organisme/i);
    state.transactions=[];
    state.properties=[{id:'p',name:'Bien',address:'',tenant:'',rentCents:0,chargesCents:0,archived:false}];
    result=await save();assert.equal(result.status,400);assert.match(result.data.error,/adresse/i);
    state.properties=[];
    state.suppliers=[{id:'s',name:'Prestataire',legalName:'',category:'maintenance',reference:'',address:'',email:'',phone:'',siret:'',notes:'',archived:false}];
    state.transactions=[{...row,supplierId:'s'}];
    result=await save();assert.equal(result.status,200);
    assert.equal(result.data.state.transactions[0].supplierId,'s');
    assert.equal((await request('/api/test-fixtures/state',{},'PUT')).status,404);
    const current=(await request('/api/session',null,'GET')).data;
    assert.equal(current.state.transactions.length,1);
  } finally {await new Promise(resolve=>server.close(resolve));close();}
});


test('les anciennes données restent utilisables mais leurs changements essentiels doivent être complétés',()=>{
  const previous={transactions:[{id:'old',date:'2026-01-01',type:'expense',category:'insurance',amountCents:10000,counterparty:'Ancien tiers'}],properties:[],recurrences:[],leases:[]};
  const next=structuredClone(previous);
  next.transactions[0].payments=[{id:'payment',date:'2026-01-02',amountCents:10000}];
  assert.doesNotThrow(()=>validateChangedEntries(next,previous));
  next.transactions[0].date='2026-01-03';
  assert.throws(()=>validateChangedEntries(next,previous),/fournisseur/i);
  next.transactions[0].supplierId='supplier';
  assert.doesNotThrow(()=>validateChangedEntries(next,previous));
});
