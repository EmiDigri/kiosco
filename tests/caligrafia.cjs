const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createHash,randomUUID} = require('node:crypto');
const core = require('../caligrafia-core.js');
const accounts = require('../cierre-cuentas.js');
const source = fs.readFileSync(require.resolve('../api/caligrafia.js'),'utf8')
  .replace(/^import .+;\r?\n/gm,'').replace('export default async function handler','async function handler');

function sample(n = 1, extra = {}) {
  const bytes = Buffer.alloc(220,n); bytes[0]=255;bytes[1]=216;bytes[2]=255;
  return {id:randomUUID(),writer:'Vale',date:'2026-09-01',kind:'importe',expected:'254.403',
    image:bytes.toString('base64'),sourceHash:String(n).repeat(64),...extra};
}
function fixture() {
  const objects = new Map(), modelCalls=[],requests=[];
  let publicBucket=false, failures=0;
  const context = vm.createContext({core,accounts,createHash,Buffer,AbortSignal,Intl,Date,
    process:{env:{SUPABASE_SECRET_KEY:'fixture',ANTHROPIC_API_KEY:'fixture'}},
    fetch:async(url,opts={})=>{
      requests.push({url,opts});
      if(url.endsWith('/auth/v1/user'))return Response.json({id:'test-user'});
      const base='/storage/v1/';
      if(url.includes(base)){
        const path=url.split(base)[1];
        if(path.startsWith('bucket/'))return Response.json({public:publicBucket});
        if(path.startsWith('object/list/')){
          const {prefix,limit}=JSON.parse(opts.body);
          return Response.json([...objects.keys()].filter(p=>p.startsWith(prefix+'/')).slice(-limit).reverse().map(p=>({name:p.split('/')[1]})));
        }
        if(path.startsWith('object/authenticated/')){
          const key=path.split('/').slice(3).join('/');
          return objects.has(key)?Response.json(objects.get(key)):Response.json({error:'not_found'},{status:404});
        }
        if(opts.method==='DELETE'){
          JSON.parse(opts.body).prefixes.forEach(p=>objects.delete(p));return Response.json({ok:true});
        }
        const key=path.split('/').slice(2).join('/');
        if(opts.headers['x-upsert']==='false'&&objects.has(key))return Response.json({error:'exists'},{status:409});
        objects.set(key,JSON.parse(opts.body));return Response.json({ok:true});
      }
      if(url==='https://api.anthropic.com/v1/messages'){
        const body=JSON.parse(opts.body);modelCalls.push(body);
        if(failures){failures--;return Response.json({error:{message:'overloaded'}},{status:529});}
        const images=body.messages[0].content.filter(c=>c.type==='image');
        return Response.json({content:[{type:'tool_use',name:'transcribir',input:{texto:images.length>1?'987654':'987655'}}],usage:{input_tokens:300,output_tokens:20}});
      }
      throw Error('Unexpected network: '+url);
    }});
  vm.runInContext(source,context);
  async function call(method,body,query={},auth=true){
    const res={setHeader(){},status(code){this.code=code;return this;},json(data){this.body=JSON.parse(JSON.stringify(data));return this;}};
    await context.handler({method,body,query,headers:auth?{authorization:'Bearer fixture-user'}:{}},res);return res;
  }
  return {call,objects,modelCalls,requests,setPublic:value=>publicBucket=value,fail:value=>failures=value};
}
test('amount matching ignores formatting, never different digits; names remain names',()=>{
  for(const v of ['254403','$254.403','254,403','254.403.-'])assert.equal(core.score(v,'254403','importe').correct,true);
  assert.equal(core.score('954403','254403','importe').correct,false);
  assert.equal(core.score(null,'0','importe').correct,false);
  assert.equal(core.score('---','0','importe').correct,true);
  assert.equal(core.score('ARCOR','Arcor','nombre').correct,true);
  assert.equal(core.score('Ancor','Arcor','nombre').correct,false);
});
test('memory separates authors/types and excludes the same sheet, file and crop',()=>{
  const target={writer:'Vale',kind:'importe',date:'2026-09-13',sourceHash:'file',cropHash:'crop'};
  const valid={...target,date:'2026-09-01',sourceHash:'other',cropHash:'other',id:'yes'};
  const choices=[valid,{...valid,writer:'Ani'},{...valid,kind:'nombre'},{...valid,date:target.date},
    {...valid,sourceHash:target.sourceHash},{...valid,cropHash:target.cropHash}];
  assert.deepEqual(core.selectExamples(choices,target).map(e=>e.id),['yes']);
});
test('API authenticates and rejects public storage; nonpaid operations use no model',async()=>{
  const f=fixture();assert.equal((await f.call('GET',null,{},false)).code,401);assert.equal(f.requests.length,0);
  f.setPublic(true);assert.equal((await f.call('GET')).code,503);f.setPublic(false);
  const s=sample();assert.equal((await f.call('POST',{...s,action:'save'})).code,200);
  assert.equal((await f.call('GET')).body.examples.length,1);
  assert.equal((await f.call('DELETE',{id:s.id})).code,200);
  assert.equal((await f.call('GET')).body.examples.length,0);assert.equal(f.modelCalls.length,0);
});
test('invalid samples and missing cost consent never call AI',async()=>{
  const f=fixture();
  for(const extra of [{writer:''},{date:'2026-02-30'},{date:'13/9'},{kind:'other'},{expected:''},{image:'invalid'},{image:'/9j/'+ 'a'.repeat(100000)},{sourceHash:'../other'}]){
    assert.equal((await f.call('POST',{...sample(),action:'save',...extra})).code,400);
  }
  assert.equal((await f.call('POST',{...sample(),action:'compare'})).code,400);
  assert.equal(f.modelCalls.length,0);
});
test('paired held-out test never reveals target answer; repeated ID never charges twice',async()=>{
  const f=fixture(),s=sample();await f.call('POST',{...s,action:'save'});
  await f.call('POST',{...sample(2,{writer:'Ani'}),action:'save'});
  const target=sample(3,{date:'2026-09-13',expected:'987654',action:'compare',consent:true});
  const result=await f.call('POST',target);
  assert.equal(result.code,200);assert.equal(result.body.run.state,'complete');
  assert.equal(result.body.run.baseline.correct,false);assert.equal(result.body.run.memory.correct,true);
  assert.equal(f.modelCalls.length,2);
  assert(!JSON.stringify(f.modelCalls).includes('987654'),'held-out answer leaked to the model');
  assert.equal(f.modelCalls[0].messages[0].content.filter(c=>c.type==='image').length,1);
  assert.equal(f.modelCalls[1].messages[0].content.filter(c=>c.type==='image').length,2);
  assert.deepEqual(result.body.run.exampleIds,[s.id]);
  await f.call('POST',target);await f.call('GET',null,{run:target.id});
  assert.equal(f.modelCalls.length,2);
  assert(!JSON.stringify(f.objects.get('runs/'+target.id+'.json')).includes(target.image),'target image must not be stored');
  assert.equal((await f.call('POST',{...target,id:randomUUID(),date:s.date})).code,400);
  assert.equal(f.modelCalls.length,2);
});
test('concurrent duplicate operations reserve once; failed API call does not auto-retry',async()=>{
  const f=fixture();await f.call('POST',{...sample(),action:'save'});
  const target=sample(3,{date:'2026-09-13',expected:'987654',action:'compare',consent:true});
  await Promise.all([f.call('POST',target),f.call('POST',target)]);assert.equal(f.modelCalls.length,2);
  f.fail(1);
  const failed={...target,id:randomUUID()};
  assert.equal((await f.call('POST',failed)).body.run.state,'failed');
  await f.call('POST',failed);assert.equal(f.modelCalls.length,3);
});
test('summary counts independent crops and days, not repeated successful attempts',()=>{
  const run={state:'complete',writer:'Vale',sourceHash:'one',cropHash:'one',date:'2026-09-01',baseline:{correct:false},memory:{correct:true},createdAt:'2026-09-13T01:00:00Z'};
  assert.deepEqual(core.stats([run,{...run,createdAt:'2026-09-13T02:00:00Z',memory:{correct:false}},
    {...run,writer:'Ani'},{...run,state:'failed'}],'Vale'),{total:1,baseline:0,memory:0,days:1});
});
test('daily reservations cap concurrent comparisons at eight; editing a sample avoids duplicates',async()=>{
  const f=fixture(),s=sample();await f.call('POST',{...s,action:'save'});
  const edit=await f.call('POST',{...s,id:randomUUID(),expected:'254.400',action:'save'});
  assert.equal(edit.body.example.id,s.id);assert.equal((await f.call('GET')).body.examples.length,1);
  const results=await Promise.all(Array.from({length:10},()=>f.call('POST',sample(3,{date:'2026-09-13',expected:'987654',action:'compare',consent:true}))));
  assert.equal(results.filter(r=>r.body.run.state==='complete').length,8);
  assert.equal(f.modelCalls.length,16);
});
