const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const baseline = fs.readFileSync(path.join(__dirname, 'baseline.html'), 'utf8');
const originalReport = baseline.slice(baseline.indexOf('                    const summary ='), baseline.indexOf('                    doc.render(templateData);')).replace('const rightNow = new Date();', '');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'assets/report.js'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'assets/defaults.js'), 'utf8'), context);
vm.runInContext(`function originalReport(activeFilteredQueue, rightNow) { ${originalReport}; return templateData; }`, context);
const parity = vm.runInContext(`(() => {
    const now = new Date(2026, 8, 17);
    const cases = [[], defaultDataset, ...Object.values(VEHICLE_CATEGORIES).flat().map(vehType =>
        ['', '0', '-10', '700.00', '900.50', 'invalid', '12suffix'].map(amt2 => ({...defaultDataset[0], vehType, amt2})))];
    cases.push(cases.slice(2).flat(), [{...defaultDataset[0], vehType: 'legacy category', amt2: '99'}]);
    return cases.map(records => [JSON.stringify(originalReport(records, now)), JSON.stringify(buildReportData(records, now))]);
})()`, context);
for (const [before, after] of parity) assert.equal(after, before);
const oldOptions = [...baseline.matchAll(/<option value="([^"]+)"/g)].map(m => m[1]);
assert.equal(JSON.stringify(oldOptions), vm.runInContext('JSON.stringify(Object.values(VEHICLE_CATEGORIES).flat())', context));
console.log(`PASS: ${parity.length} report parity datasets, every placeholder and vehicle option/order.`);

async function main() {
    const userHome = require('node:os').homedir();
    const playwright = require(process.env.PLAYWRIGHT_PACKAGE || path.join(userHome, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
    const server = http.createServer((req, res) => {
        const name = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
        const file = path.resolve(root, '.' + name);
        if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
        fs.readFile(file, (error, data) => {
            if (error) { res.writeHead(404).end(); return; }
            res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' })[path.extname(file)] || 'application/octet-stream');
            res.end(data);
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await playwright.chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || path.join(userHome, 'AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe') });
        const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
        page.setDefaultNavigationTimeout(60000);
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('dialog', dialog => dialog.accept());
        const url = `http://127.0.0.1:${server.address().port}`;
        await page.goto(url);
        await page.waitForFunction(() => document.getElementById('recordCount').textContent === '3 Entries');
        assert.equal(await page.locator('label:not([for])').count(), 0);
        assert.equal(await page.locator('#vehType option').count(), 20);
        await page.locator('#filterStartDate').fill('2026-06-15');
        await page.locator('#filterEndDate').fill('2026-06-15');
        assert.equal(await page.locator('#recordCount').innerText(), '2 Entries');
        await page.locator('#clearFilterBtn').click();
        await page.locator('#filterStartDate').fill('2099-01-01');
        assert.match(await page.locator('#recordsTableBody').innerText(), /No records match/);
        await page.locator('#clearFilterBtn').click();
        // Actual buttons exercise edit identity after deleting an earlier row.
        await page.locator('button[data-action="edit"][data-index="2"]').click();
        await page.locator('button[data-action="delete"][data-index="0"]').click();
        await page.locator('#vehNo').fill('EDITED-THIRD');
        await page.locator('#submitBtn').click();
        let records = await page.evaluate(() => JSON.parse(localStorage.getItem('vehicle_transfer_data')));
        assert.equal(records.length, 2);
        assert.equal(records[1].vehNo, 'EDITED-THIRD');
        assert.equal(records[0].vehNo, 'SP BIT - 5424');
        await page.locator('button[data-action="edit"]').first().click();
        await page.locator('#vehNo').fill('CANCELLED');
        await page.locator('#cancelEditBtn').click();
        assert.equal(await page.locator('#vehNo').inputValue(), '');
        await page.locator('#vehNo').fill('NEW-01');
        await page.locator('#vehType').selectOption('මෝටර් කාර්');
        await page.locator('#ownerDetails').fill('<img src=x onerror="window.injected=true"> සිංහල & text');
        await page.locator('#rec1').fill('R 1');
        await page.locator('#amt1').fill('450.00');
        await page.locator('#submitBtn').click();
        assert.equal(await page.locator('#recordsTableBody img').count(), 0);
        assert.equal(await page.evaluate(() => window.injected), undefined);
        assert.match(await page.locator('#recordsTableBody').innerText(), /සිංහල & text/);
        await page.reload();
        assert.equal(await page.locator('#recordCount').innerText(), '3 Entries');
        const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#exportBtn').click()]);
        assert.equal(download.suggestedFilename(), 'vehicle_transfer_records_backup.json');
        const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
        assert.deepEqual(exported, await page.evaluate(() => JSON.parse(localStorage.getItem('vehicle_transfer_data'))));
        console.log('PASS: CRUD, cancel, edit after deletion, reload, inclusive filtering, text safety, JSON export.');

        const storageResults = await page.evaluate(async () => {
            const results = [];
            const base = JSON.parse(localStorage.getItem('vehicle_transfer_data'));
            let writes = [];
            let fail = false;
            const handle = { name: 'test.json', async createWritable() {
                if (fail) throw new Error('Access denied');
                return { async write(value) { await new Promise(resolve => setTimeout(resolve, 15)); writes.push(JSON.parse(value)); }, async close() {} };
            }};
            await acceptImport(JSON.stringify(base), handle);
            results.push(document.getElementById('importBtn').textContent === 'Data Linked Live');
            let rejected = false;
            try { await acceptImport('[null]', {name: 'bad.json'}); } catch { rejected = true; }
            results.push(rejected && fileHandle === handle && dataset.length === base.length);
            await Promise.all([syncStateData(), syncStateData()]);
            results.push(writes.length === 3);
            fail = true;
            results.push(await syncStateData() === false && document.getElementById('storageStatus').dataset.state === 'error' && document.getElementById('importBtn').textContent.includes('failed'));
            fail = false;
            results.push(await syncStateData() === true);
            const originalSet = Storage.prototype.setItem;
            Storage.prototype.setItem = () => { throw new Error('Quota'); };
            results.push(await syncStateData() === false && document.getElementById('storageStatus').textContent.includes('Browser storage could not be saved'));
            Storage.prototype.setItem = originalSet;
            for (const bad of ['{}', '', '[{"vehNo": []}]']) {
                try { parseRecords(bad); results.push(false); } catch { results.push(true); }
            }
            const legacy = {...base[0], amt1: 450, amt2: 0, extra: 'retained'};
            delete legacy.transferDate;
            results.push(JSON.stringify(parseRecords(JSON.stringify([legacy]))) === JSON.stringify([legacy]));
            await acceptImport('[]');
            results.push(document.getElementById('recordsTableBody').textContent.includes('No records yet'));
            await acceptImport(JSON.stringify(base));
            return results;
        });
        assert.ok(storageResults.every(Boolean), JSON.stringify(storageResults));
        // Exercise native-picker branch, cancellation and rejected candidates.
        await page.evaluate(() => {
            window.showOpenFilePicker = async () => [{name: 'picked.json', getFile: async () => new File([JSON.stringify(dataset)], 'picked.json'), createWritable: async () => ({write: async () => {}, close: async () => {}})}];
        });
        await page.locator('#importBtn').click();
        await page.waitForFunction(() => document.getElementById('importBtn').textContent === 'Data Linked Live');
        await page.evaluate(() => { window.showOpenFilePicker = async () => [{name: 'invalid.json', getFile: async () => new File(['{}'], 'invalid.json')}]; });
        await page.locator('#importBtn').click();
        assert.equal(await page.evaluate(() => fileHandle.name), 'picked.json');
        await page.evaluate(() => { window.showOpenFilePicker = async () => { throw new DOMException('Cancelled', 'AbortError'); }; });
        await page.locator('#importBtn').click();
        assert.equal(await page.evaluate(() => fileHandle.name), 'picked.json');
        // Exercise fallback via its real file chooser.
        await page.evaluate(() => { delete window.showOpenFilePicker; });
        const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#importBtn').click()]);
        await chooser.setFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
        await page.waitForFunction(() => document.getElementById('storageStatus').textContent.includes('Live file saving is unavailable'));
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('vehicle_transfer_data'))), exported);
        console.log('PASS: live/fallback import, invalid/cancelled import, sequential saves, file failure/recovery, storage failure, legacy fields and empty state.');

        // Use the original and current production DOCX export paths with the same fixture.
        await page.waitForFunction(() => window.PizZip && window.docxtemplater && window.saveAs);
        const fixture = await page.evaluate(() => {
            const keys = Object.keys(buildReportData(dataset)).filter(key => key !== 'roles');
            const p = value => `<w:p><w:r><w:t>${value}</w:t></w:r></w:p>`;
            const zip = new PizZip();
            zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
            zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
            zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + keys.map(key => p(`${key}: {${key}}`)).join('') + p('{#roles}') + p('{idx} {vehicle_number} {vehicle_type} {ownr_name_address} {receipt_01} {receipt_02} {receipt_01_fee} {receipt_02_fee}') + p('{/roles}') + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>');
            return zip.generate({type: 'base64'});
        });
        const template = {name: 'compatibility.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(fixture, 'base64')};
        const oldPage = await browser.newPage();
        await oldPage.goto(url + '/tests/baseline.html');
        await oldPage.evaluate(data => { localStorage.setItem('vehicle_transfer_data', JSON.stringify(data)); }, exported);
        await oldPage.reload();
        // Both production exports must honor the same inclusive filtered subset.
        for (const target of [oldPage, page]) {
            await target.locator('#filterStartDate').fill('2026-06-15');
            await target.locator('#filterEndDate').fill('2026-06-15');
        }
        const [oldDoc] = await Promise.all([oldPage.waitForEvent('download'), oldPage.locator('#templateFileInput').setInputFiles(template)]);
        const [newDoc] = await Promise.all([page.waitForEvent('download'), page.locator('#templateFileInput').setInputFiles(template)]);
        assert.equal(newDoc.suggestedFilename(), oldDoc.suggestedFilename());
        const oldBytes = fs.readFileSync(await oldDoc.path()).toString('base64');
        const newBytes = fs.readFileSync(await newDoc.path()).toString('base64');
        const identical = await page.evaluate(([a,b]) => {
            const aZip = new PizZip(a, {base64:true}), bZip = new PizZip(b, {base64:true});
            return Object.keys(aZip.files).every(name => aZip.files[name].dir || aZip.file(name).asText() === bZip.file(name).asText());
        }, [oldBytes, newBytes]);
        assert.ok(identical, 'DOCX XML content and layout must remain identical');
        await oldPage.close();
        console.log('PASS: original/current DOCX export filename and all unzipped document parts match.');

        await page.evaluate(() => acceptImport(JSON.stringify(defaultDataset)));
        await page.locator('#clearFilterBtn').click();
        await page.locator('button[data-action="edit"]').first().click();
        await page.locator('button[data-action="delete"]').first().click();
        assert.equal(await page.locator('#vehNo').inputValue(), '');
        assert.equal(await page.locator('#cancelEditBtn').isVisible(), false);
        await page.evaluate(() => acceptImport(JSON.stringify(defaultDataset)));
        await page.locator('#vehNo').focus();
        fs.mkdirSync(path.join(__dirname, 'artifacts'), {recursive:true});
        await page.screenshot({path: path.join(__dirname, 'artifacts/desktop.png'), fullPage:true});
        await page.setViewportSize({width:390,height:844});
        await page.screenshot({path: path.join(__dirname, 'artifacts/mobile.png'), fullPage:true});
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal page overflow');
        assert.deepEqual(errors, []);
        console.log('PASS: responsive width and no uncaught browser errors; desktop/mobile screenshots saved.');
        const localPage = await browser.newPage();
        await localPage.goto(require('node:url').pathToFileURL(path.join(root, 'index.html')).href, {timeout:60000});
        assert.equal(await localPage.locator('#recordCount').innerText(), '3 Entries');
        await localPage.close();
        console.log('PASS: direct file opening still loads the app without a server/build step.');
    } finally {
        if (browser) await browser.close();
        server.close();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
