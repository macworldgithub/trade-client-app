async(page)=>{
if(!(await page.title()).includes('[s50.'))throw Error('Expected pilot entity 50');
const ids=["99138","58132","87728","19400","63970","105647","116217","92324","5661842","35536","288808","535201","532086","032914","91913","529831","030932","567184","71711","022604","89712","038451","36658","588468","039534","116894","19963","4014","038549","538223","15209","583952","16553","3487","572889","535617","038477","26399","537336","48699","531537","533278","574627","39418","039316","3105","030709","76528","548231","039141","031570","546765","543023","032471","56292","76441","58616","76442","536508","5609082","332253","117906","5631385","520202","534040","1645","68205","8041217","22884","537946","89129","560949","93211","69216","530089","031160","93205","112743","597836","5557935","533885","101883","528950","030167","43682","74451","500125","538680","038986","528927","72242","79885","19214","30709","79185","23213","115896","032152","597806","110695","44713","583860","581018","033555","533859","531809","334023","45567","56916","534075","5670115","88320","29664","21543","560198","30499","111087","031107","033714","41331","22603","332535","501644","036077","538007","038242","935717","10552","030875","537431","50129","5201790","97124","582937","033317","98926","88598","104521","55470","554185","8612","537227","522937","033136","587442","80931","6944236","532342","331068","79476","92991","21551","70298","581407","031676","500235","032451","037215","033395","104274","537636","1646","60921","28209","037862","033217","334803","23346","76596","43583","39222","031945","80081","586326","537016","037216","77575","030230","538626","331719","101972","69939","48165","40292","038322"], results=[];
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
results.push({requested_entity_id:id,source_entity_code:'50',captured_at:new Date().toISOString(),status:'CAPTURED',fields:await f.locator('input,select').evaluateAll(es=>es.filter(e=>e.offsetWidth>0&&e.id.startsWith('entityname_')).map(e=>({field:e.id,value:e.value}))),warnings});
}catch(e){results.push({requested_entity_id:id,status:'ERROR',error:String(e),warnings});break;}
}
return results;
}
