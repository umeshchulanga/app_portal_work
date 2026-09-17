const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
function app(source) {
 const elements=new Map(), store=new Map();
 function element(){return {value:'',innerText:'',innerHTML:'',style:{},children:[],appendChild(x){this.children.push(x)},querySelector(){return {addEventListener(){}}},reset(){},addEventListener(){}}}
 const ctx=vm.createContext({console,Date,Math,Number,String,JSON,Promise,document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)},addEventListener(){},createElement:element,createDocumentFragment:element},window:{},localStorage:{setItem(k,v){store.set(k,v)},getItem(k){return store.get(k)},removeItem(k){store.delete(k)}},alert(){},confirm(){return true}});
 vm.runInContext(source,ctx); return {ctx,e:id=>ctx.document.getElementById(id),run:s=>vm.runInContext(s,ctx)};
}
const old=app(fs.readFileSync('tests/baseline.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1]);
const current=app(fs.readFileSync('assets/app.js','utf8'));
let count=0;
for(const paid of ['2026-01-01','2026-01-14','2026-01-15','2026-02-01'])for(const amount of ['100','123.45','0.01']) {
 for(const a of [old,current]){a.e('fineIssuedDate').value='2026-01-01';a.e('paidDate').value=paid;a.e('baseFineAmount').value=amount;}
 assert.equal(JSON.stringify(current.run('calculateAmounts()')),JSON.stringify(old.run('calculateAmounts()')));count++;
}
const records=Array.from({length:12},(_,i)=>({id:i+0.5,receiptNumber:'R<&'+i,driverName:'රියදුරු '+i,vehicleNumber:'ABC',fineIssuedDate:`2026-${String(i+1).padStart(2,'0')}-01`,paidDate:`2026-${String(i+1).padStart(2,'0')}-15`,baseFineAmount:123.45,fineAmount:246.9,vote1Amount:148.14,vote2Amount:98.76}));
for(const q of [1,2,3,4]) {
 for(const a of [old,current]){a.run('records = '+JSON.stringify(records));for(const key of ['reportYear','breakdownYear'])a.e(key).value='2026';for(const key of ['reportQuarter','breakdownQuarter'])a.e(key).value=String(q);a.e('reportDSInput').value='ගාල්ල';a.e('reportRows').children=[];a.e('breakdownRows').children=[];a.run('generateReportStructure(); generateBreakdownStructure()');}
 for(const key of ['reportRows','breakdownRows'])assert.deepEqual(current.e(key).children.map(x=>x.innerHTML),old.e(key).children.map(x=>x.innerHTML));
 assert.equal(current.e('lblBreakdownGrandTotal').innerText,old.e('lblBreakdownGrandTotal').innerText);count++;
}
(async()=>{
 current.e('baseFineAmount').value='';current.run('calculateAmounts()');assert.equal(current.e('calcFineAmount').innerText,'0.00');
 current.run('editRecord(0.5)');current.e('driverName').value='Updated';await current.run('saveRecord({preventDefault(){}})');assert.equal(current.run('records[0].driverName'),'Updated');assert.equal(current.run('records[0].id'),0.5);
 assert.equal(current.run('normalizeRecords([{fineAmount:"12.30",driverName:42}])[0].fineAmount'),12.3);
 assert.throws(()=>current.run('normalizeRecords([{fineAmount:"bad"}])'));
 current.run(`window.showSaveFilePicker=()=>{}; let writes=[]; fileHandle={name:'test.json',queryPermission:async()=> 'granted',createWritable:async()=>({write:async s=>writes.push(s),close:async()=>{}})};`);
 await current.run('Promise.all([saveToStorage(), saveToStorage()])');assert.equal(current.run('writes.length'),2);assert.equal(current.run('pendingFileChanges'),false);
 current.run(`pendingFileChanges=true; fileHandle.getFile=async()=>{throw new Error('Should not reload pending edits')};fileHandle.requestPermission=async()=> 'granted';`);
 await current.run('reconnectFile()');assert.equal(current.run('pendingFileChanges'),false);
 console.log(`PASS: ${count} baseline calculation/report comparisons; stale display, fractional IDs, imports, queued saves, pending reconnect.`);
})().catch(e=>{console.error(e);process.exitCode=1});
