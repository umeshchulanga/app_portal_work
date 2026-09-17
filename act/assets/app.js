'use strict';

const STORAGE_KEY = 'vehicle_transfer_data';
const FIELDS = ['vehNo', 'transferDate', 'vehType', 'ownerDetails', 'rec1', 'amt1', 'rec2', 'amt2'];
const $ = id => document.getElementById(id);
const form = $('recordForm');
let dataset = [];
let fileHandle = null;
let editingRecord = null;
let saveQueue = Promise.resolve();
let saveVersion = 0;
let importInProgress = false;

// Retain optional legacy fields and unknown category strings without coercing data.
function parseRecords(contents) {
    const records = JSON.parse(contents);
    if (!Array.isArray(records)) throw new Error('The JSON file must contain an array of records.');
    records.forEach((record, index) => {
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
            throw new Error(`Record ${index + 1} must be an object.`);
        }
        for (const field of ['vehNo', 'vehType', 'ownerDetails', 'rec1']) {
            if (typeof record[field] !== 'string') throw new Error(`Record ${index + 1}: ${field} must be text.`);
        }
        for (const field of ['transferDate', 'rec2']) {
            if (record[field] != null && typeof record[field] !== 'string') throw new Error(`Record ${index + 1}: ${field} must be text.`);
        }
        for (const field of ['amt1', 'amt2']) {
            if (record[field] != null && typeof record[field] !== 'string' && typeof record[field] !== 'number') {
                throw new Error(`Record ${index + 1}: ${field} must be text or a number.`);
            }
        }
    });
    return records;
}

function showStatus(message, state = 'saved') {
    $('storageStatus').textContent = message;
    $('storageStatus').dataset.state = state;
}

function updateLinkButton(state) {
    $('importBtn').textContent = !fileHandle ? 'Import JSON Data (Link Live)' :
        state === 'saved' ? 'Data Linked Live' : state === 'saving' ? 'Saving linked file…' : 'Linked file: save failed';
    $('importBtn').className = `btn btn-sm ${fileHandle && state === 'saved' ? 'btn-success' : 'btn-outline-light'}`;
}

function syncStateData() {
    // Snapshot each change and serialize writes so an older save cannot finish last.
    const snapshot = JSON.stringify(dataset);
    const target = fileHandle;
    const version = ++saveVersion;
    showStatus('Saving records…', 'saving');
    updateLinkButton('saving');
    let localSaved = true;
    try { localStorage.setItem(STORAGE_KEY, snapshot); }
    catch (error) { localSaved = false; }
    const operation = async () => {
        let fileSaved = !target;
        let stream;
        if (target) {
            try {
                stream = await target.createWritable();
                await stream.write(JSON.stringify(JSON.parse(snapshot), null, 4));
                await stream.close();
                fileSaved = true;
            } catch (error) {
                if (stream && stream.abort) await stream.abort().catch(() => {});
            }
        }
        if (version === saveVersion) {
            updateLinkButton(fileSaved ? 'saved' : 'error');
            if (!localSaved || !fileSaved) {
                showStatus(`${localSaved ? 'Saved in this browser.' : 'Browser storage could not be saved.'} ${target ? (fileSaved ? `Saved to ${target.name}.` : `Could not save to ${target.name}. Check file access and import it again to reconnect.`) : ''} Export a JSON backup to keep a separate copy.`, 'error');
            } else {
                showStatus(target ? `Saved in this browser and linked to ${target.name}.` : 'Saved in this browser. Export a JSON backup to keep a separate copy.');
            }
        }
        return localSaved && fileSaved;
    };
    saveQueue = saveQueue.then(operation, operation);
    return saveQueue;
}

function initData() {
    for (const type of Object.values(VEHICLE_CATEGORIES).flat()) {
        $('vehType').add(new Option(type, type));
    }
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        dataset = stored ? parseRecords(stored) : defaultDataset.map(record => ({ ...record }));
        if (!stored) syncStateData();
        else showStatus('Loaded records saved in this browser.');
    } catch (error) {
        dataset = defaultDataset.map(record => ({ ...record }));
        showStatus('Saved browser data could not be loaded. Sample records are shown; existing storage has not been replaced. Import a valid backup before editing.', 'error');
    }
    clearFormState();
    renderApp();
}

async function acceptImport(contents, handle = null) {
    const imported = parseRecords(contents);
    // Do not replace either the active data or file link until validation succeeds.
    dataset = imported;
    fileHandle = handle;
    clearFormState();
    renderApp();
    return syncStateData();
}

async function triggerJsonLiveImport() {
    if (importInProgress) return;
    if ('showOpenFilePicker' in window) {
        importInProgress = true;
        $('importBtn').disabled = true;
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{ description: 'JSON Database Document', accept: { 'application/json': ['.json'] } }],
                multiple: false
            });
            const file = await handle.getFile();
            await acceptImport(await file.text(), handle);
        } catch (error) {
            if (error.name !== 'AbortError') alert(`Import failed. Existing records and file link were kept. ${error.message}`);
        } finally {
            importInProgress = false;
            $('importBtn').disabled = false;
        }
    } else {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.addEventListener('change', async () => {
            if (!input.files.length) return;
            try {
                const saved = await acceptImport(await input.files[0].text());
                if (saved) showStatus('JSON imported and saved in this browser. Live file saving is unavailable here; use Export Backup JSON to save changes to a file.');
            } catch (error) { alert(`Import failed. Existing records were kept. ${error.message}`); }
        });
        input.click();
    }
}

form.addEventListener('submit', event => {
    event.preventDefault();
    const record = Object.fromEntries(FIELDS.map(field => [field, $(field).value.trim()]));
    if (editingRecord) {
        const index = dataset.indexOf(editingRecord);
        if (index < 0) { clearFormState(); return; }
        dataset[index] = record;
    } else dataset.push(record);
    syncStateData();
    clearFormState();
    renderApp();
});

function populateEditForm(index) {
    editingRecord = dataset[index];
    if (!editingRecord) return;
    $('editIndex').value = index;
    FIELDS.forEach(field => { $(field).value = editingRecord[field] ?? ''; });
    $('formActionTitle').textContent = 'Edit record';
    $('submitBtn').textContent = 'Save changes';
    $('cancelEditBtn').style.display = 'block';
    form.closest('.card').classList.add('is-editing');
    $('vehNo').focus();
}

function clearFormState() {
    form.reset();
    editingRecord = null;
    $('editIndex').value = '';
    // Preserve the original default-date behavior.
    $('transferDate').value = new Date().toISOString().substring(0, 10);
    $('formActionTitle').textContent = 'Add New Record Entry';
    $('submitBtn').textContent = 'Insert Entry';
    $('cancelEditBtn').style.display = 'none';
    form.closest('.card').classList.remove('is-editing');
}

function deleteRecord(index) {
    if (!dataset[index] || !confirm('Are you sure you want to permanently delete this entry?')) return;
    const [removed] = dataset.splice(index, 1);
    if (removed === editingRecord) clearFormState();
    else if (editingRecord) $('editIndex').value = dataset.indexOf(editingRecord);
    syncStateData();
    renderApp();
}

function clearDateFilter() {
    $('filterStartDate').value = '';
    $('filterEndDate').value = '';
    renderApp();
}

function getFilteredDataset() {
    const start = $('filterStartDate').value;
    const end = $('filterEndDate').value;
    return dataset.map((record, originalIndex) => ({ ...record, originalIndex }))
        .filter(record => record.transferDate && (!start || record.transferDate >= start) && (!end || record.transferDate <= end));
}

function renderApp() {
    const records = getFilteredDataset().sort((a, b) =>
        b.transferDate.localeCompare(a.transferDate) || a.originalIndex - b.originalIndex);
    $('recordCount').textContent = `${records.length} Entries`;
    const fragment = document.createDocumentFragment();
    records.forEach((record, index) => {
        const row = document.createElement('tr');
        const cell = (value, className = '') => {
            const td = document.createElement('td');
            td.textContent = value;
            td.className = className;
            row.append(td);
            return td;
        };
        cell(String(index + 1).padStart(2, '0'), 'text-center text-muted');
        cell(record.vehNo, 'fw-bold text-primary');
        cell(record.transferDate, 'date-cell');
        cell(record.vehType, 'type-cell');
        cell(record.ownerDetails, 'owner-cell');
        const receipts = cell(`${record.rec1} (${record.amt1})`, 'receipt-cell');
        if (record.rec2) {
            const extra = document.createElement('small');
            extra.className = 'd-block text-muted';
            extra.textContent = `${record.rec2} (${record.amt2})`;
            receipts.append(extra);
        }
        const actions = cell('', 'text-end action-cell');
        for (const [action, icon] of [['edit', 'pen'], ['delete', 'trash']]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `btn btn-sm btn-outline-${action === 'edit' ? 'primary' : 'danger'}`;
            button.dataset.action = action;
            button.dataset.index = record.originalIndex;
            button.setAttribute('aria-label', `${action === 'edit' ? 'Edit' : 'Delete'} ${record.vehNo}`);
            button.title = button.getAttribute('aria-label');
            const symbol = document.createElement('i');
            symbol.className = `fa-solid fa-${icon}`;
            symbol.setAttribute('aria-hidden', 'true');
            button.append(symbol);
            actions.append(button);
        }
        fragment.append(row);
    });
    if (!records.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 7;
        cell.className = 'empty-state';
        cell.textContent = dataset.length ? 'No records match these dates. Clear the range or check record dates.' : 'No records yet. Add an entry or import a JSON backup to begin.';
        row.append(cell);
        fragment.append(row);
    }
    $('recordsTableBody').replaceChildren(fragment);
}

function triggerJsonExport() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(dataset, null, 4)], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'vehicle_transfer_records_backup.json';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function processDocxTemplate(event) {
    const input = event.target;
    if (!input.files.length) return;
    const records = getFilteredDataset();
    $('docxBtn').disabled = true;
    try {
        if (!records.length) { alert('No records to export. Check the selected date range.'); return; }
        if (!window.PizZip || !window.docxtemplater || !window.saveAs) {
            throw new Error('Document tools could not load. Check your internet connection and reload the page.');
        }
        const zip = new PizZip(await input.files[0].arrayBuffer());
        const doc = new window.docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
        const data = buildReportData(records);
        doc.render(data);
        saveAs(doc.getZip().generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), `Vehicle_Report_${data.year}_${data.month}.docx`);
    } catch (error) {
        console.error('Document export failed:', error);
        alert(`Could not export the document. ${error.message}`);
    } finally {
        input.value = '';
        $('docxBtn').disabled = false;
    }
}

$('exportBtn').addEventListener('click', triggerJsonExport);
$('importBtn').addEventListener('click', triggerJsonLiveImport);
$('docxBtn').addEventListener('click', () => $('templateFileInput').click());
$('templateFileInput').addEventListener('change', processDocxTemplate);
$('cancelEditBtn').addEventListener('click', clearFormState);
$('clearFilterBtn').addEventListener('click', clearDateFilter);
['filterStartDate', 'filterEndDate'].forEach(id => $(id).addEventListener('change', renderApp));
$('recordsTableBody').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const index = Number(button.dataset.index);
    if (button.dataset.action === 'edit') populateEditForm(index);
    else deleteRecord(index);
});
initData();
