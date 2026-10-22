async(page)=>{
if(!(await page.title()).includes('[s50.'))throw Error('Expected pilot entity 50');
const ids=["53520","61664","35870","11241","504331","038890","504406","038975","034730","501927","013442","501570","035977","523222","39607","106138","534233","33807","10347","033156","33810","547147","039607","90995","534782","80009","32451","8023075","039218","501021","34694","582885","34442","65843","039013","546809","50928","8041777","37577","34650","2347","34523","564671","036613","98456","500917","033140","76955","39421","83146","6953904","14391","82482","80559","524712","23176"], results=[];
const delay=()=>new Promise(resolve=>setTimeout(resolve,120));
async function reset(){
 const a=page.frames().find(f=>/vActBar.htm/.test(f.url()));
 await a.locator('[action="Cancel"]').click({force:true,timeout:6000});
 let stable=0;
 for(let k=0;k<100;k++){
  const f=page.frames().find(f=>/EntityMaint.htm/.test(f.url()));
  const clear=f&&await f.locator('#entityname_entityid').evaluate(e=>e.value===''&&!e.disabled&&!document.querySelector('#entityname_eraname')?.value).catch(()=>false);
  stable=clear?stable+1:0;if(stable>=8)return;
  if(k===45)await a.locator('[action="Cancel"]').click({force:true,timeout:6000});
  await new Promise(r=>setTimeout(r,250));
 }
 throw Error('Stable blank record not confirmed');
}
for(const id of ids){
const warnings=[];
try{
await reset();
let f=page.frames().find(f=>/\/EntityMaint.htm/.test(f.url()));
await f.locator('#entityname_entityid').fill(id,{timeout:8000});await f.locator('#entityname_entityid').click({force:true,timeout:5000});await f.locator('#entityname_entityid').press('Tab',{timeout:7000});
let ready=false;
for(let k=0;k<80;k++){
const note=page.frames().find(f=>/\/NotePadWarnings.htm/.test(f.url()));
if(note){warnings.push(await note.locator('input,textarea').evaluateAll(es=>es.filter(e=>e.offsetWidth>0&&e.id).map(e=>({field:e.id,value:e.value}))));await page.frames().find(f=>/vActBar.htm/.test(f.url())).getByText('Exit',{exact:true}).click({timeout:4000,force:true});await delay();continue;}
const msg=page.frames().find(f=>/vPopupMessage.htm/.test(f.url()));
if(msg)throw Error(await msg.locator('body').innerText());
try{f=page.frames().find(f=>/\/EntityMaint.htm/.test(f.url()));if(f){ready=await f.locator('#entityname_entityid').evaluate((e,expected)=>e.value===expected&&!!document.querySelector('#entityname_entitytype')?.value&&!!document.querySelector('#entityname_eraname')?.value,id).catch(()=>false);}}
catch{}
if(ready){await new Promise(resolve=>setTimeout(resolve,500));break;}
if(k===40 && f && await f.locator('#entityname_entityid').isEnabled()){await f.locator('#entityname_entityid').fill(id);await f.locator('#entityname_entityid').press('Tab');}
await delay();
}
if(!ready)throw Error('Record read not confirmed');
const details=await f.locator('input,select').evaluateAll(es=>es.filter(e=>e.offsetWidth>0&&e.id.startsWith('entityname_')).map(e=>({field:e.id,value:e.value})));
const screens=[];
await page.frames().find(f=>/vActBar.htm/.test(f.url())).locator('[action="Customer"]').evaluate(e=>e.click());
async function nav(action,screen){
for(let k=0;k<60;k++){const ns=page.frames().filter(f=>/vNavBar.htm/.test(f.url()));let clicked=false;for(const n of ns){const b=n.locator('[action="'+action+'"]');if(await b.count()){await b.evaluate(e=>e.click());clicked=true;break;}}if(clicked)break;await delay();}
let target;
for(let k=0;k<80;k++){target=page.frames().find(f=>f.url().includes('/'+screen));if(target){try{if(await target.locator('#entityname_entityid').inputValue()===id)break;}catch{}}await delay();}
if(!target)throw Error('Screen not opened: '+screen);
await new Promise(resolve=>setTimeout(resolve,300));
screens.push({screen,captured_at:new Date().toISOString(),fields:await target.locator('input,select,textarea').evaluateAll(es=>es.filter(e=>e.offsetWidth>0&&e.id).map(e=>({field:e.id,value:e.value,checked:e.type==='checkbox'?e.checked:undefined,label:e.tagName==='SELECT'?e.options[e.selectedIndex]?.text:undefined})))});
}
await nav('Parts Details','EntityParts.htm');
await nav('Receivable Details','EntityReceivable.htm');
await nav('Value Details','EntityValueDtls.htm');
for(const n of page.frames().filter(f=>/vNavBar.htm/.test(f.url()))){const b=n.locator('[action="Entity Maint"]');if(await b.count()){await b.evaluate(e=>e.click());break;}}
await new Promise(resolve=>setTimeout(resolve,1300));
results.push({requested_entity_id:id,source_entity_code:'50',captured_at:new Date().toISOString(),status:'CAPTURED',fields:details,warnings,screens});
}catch(e){results.push({requested_entity_id:id,status:'ERROR',error:String(e),warnings});break;}
}
return results;
}
