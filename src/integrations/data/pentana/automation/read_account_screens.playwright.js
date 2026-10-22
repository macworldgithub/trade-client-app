async(page)=>{
if(!(await page.title()).includes('[s50.'))throw Error('Expected pilot entity 50');
const ids=["19400","35536","288808","567184","71711","4014","038477","574627","546765","543023","032471","58616","89129","597836","500125","23213","597806","583860","581018","033555","534075","560198","501644","036077","98926","8612","522937","80931","6944236","500235","032451","23346","76596","43583"], results=[];
const delay=()=>new Promise(resolve=>setTimeout(resolve,120));
async function reset(){
let f=page.frames().find(f=>/\/EntityMaint.htm/.test(f.url()));
if(!f)throw Error('Entity Maintenance is not open');
if(await f.locator('#entityname_entityid').isEnabled() && await f.locator('#entityname_entityid').inputValue()==='')return;
await page.frames().find(f=>/vActBar.htm/.test(f.url())).getByText('Cancel',{exact:true}).evaluate(e=>e.click());
for(let k=0;k<70;k++){try{f=page.frames().find(f=>/\/EntityMaint.htm/.test(f.url()));if(f && await f.locator('#entityname_entityid').isEnabled() && await f.locator('#entityname_entityid').inputValue()===''){await new Promise(resolve=>setTimeout(resolve,600));return;}}catch{}await delay();}
throw Error('Record reset did not complete');
}
for(const id of ids){
const warnings=[];
try{
await reset();
let f=page.frames().find(f=>/\/EntityMaint.htm/.test(f.url()));
await f.locator('#entityname_entityid').fill(id,{timeout:4000});await f.locator('#entityname_entityid').press('Tab');
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
