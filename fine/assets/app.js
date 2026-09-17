
    let records = [];
    let fileHandle = null;
    let writeQueue = Promise.resolve();
    let pendingFileChanges = false;
    const PENDING_KEY = 'police_fines_pending_sync';

    function countDays(issued, paid) { return Math.ceil((new Date(paid) - new Date(issued)) / 86400000) + 1; }
    function quarterStart(quarter) { return (quarter - 1) * 3; }
    function normalizeRecords(data) {
        if (!Array.isArray(data)) throw new Error('Expected a JSON array.');
        return data.map(item => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid record.');
            const result = { ...item, id: item.id || Date.now() + Math.random() };
            for (const key of ['receiptNumber', 'driverName', 'vehicleNumber', 'fineIssuedDate', 'paidDate']) {
                result[key] = String(item[key] || (key === 'driverName' ? 'Unknown' : ''));
            }
            for (const key of ['baseFineAmount', 'fineAmount', 'vote1Amount', 'vote2Amount']) {
                result[key] = Number(item[key] || 0);
                if (!Number.isFinite(result[key])) throw new Error('Invalid amount: ' + key);
            }
            return result;
        });
    }
    const FSA_SUPPORTED = 'showSaveFilePicker' in window && 'showOpenFilePicker' in window;
    const IDB_NAME = 'PoliceFinesFileDB';
    const IDB_STORE = 'handles';
    const IDB_KEY = 'fineFileHandle';

    // --- Minimal IndexedDB helpers for persisting the FileSystemFileHandle across sessions ---
    function idbGet(key) {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(IDB_NAME, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
            req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction(IDB_STORE, 'readonly');
                const getReq = tx.objectStore(IDB_STORE).get(key);
                getReq.onsuccess = () => resolve(getReq.result || null);
                getReq.onerror = () => reject(getReq.error);
            };
            req.onerror = () => reject(req.error);
        });
    }

    function idbSet(key, value) {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(IDB_NAME, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
            req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction(IDB_STORE, 'readwrite');
                tx.objectStore(IDB_STORE).put(value, key);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            };
            req.onerror = () => reject(req.error);
        });
    }

    document.addEventListener('DOMContentLoaded', async () => {
        try {
            const stored = localStorage.getItem('police_fines_data');
            if (stored) records = normalizeRecords(JSON.parse(stored));
            pendingFileChanges = localStorage.getItem(PENDING_KEY) === 'true';
        } catch (err) { alert('Stored data could not be loaded. Import a backup to recover it.'); }

        if (FSA_SUPPORTED) {
            try {
                const savedHandle = await idbGet(IDB_KEY);
                if (savedHandle) {
                    fileHandle = savedHandle;
                    const perm = await fileHandle.queryPermission({ mode: 'readwrite' });
                    if (perm === 'granted' && !pendingFileChanges) {
                        await loadRecordsFromHandle(fileHandle);
                        updateFileStatus();
                    } else {
                        // Browsers require a user gesture to re-request permission after reload
                        updateFileStatus(true);
                    }
                } else {
                    updateFileStatus();
                }
            } catch (err) {
                console.warn('No previously linked data file found.', err);
                updateFileStatus();
            }
        } else {
            updateFileStatus();
        }

        renderTable();
    });

    // --- Unified Data-Layer persistence: writes straight to the linked JSON file, no downloads ---
    async function saveToStorage() {
        const snapshot = JSON.stringify(records, null, 4);
        try {
            localStorage.setItem('police_fines_data', JSON.stringify(records));
            if (fileHandle) {
                pendingFileChanges = true;
                localStorage.setItem(PENDING_KEY, 'true');
            }
        } catch (err) {
            alert('Browser storage could not be saved. Export a backup to keep your current records.');
            return false;
        }
        if (!fileHandle) return true;
        return writeToLinkedFile(snapshot);
    }

    function writeToLinkedFile(snapshot = JSON.stringify(records, null, 4)) {
        const handle = fileHandle;
        if (handle) {
            pendingFileChanges = true;
            try { localStorage.setItem(PENDING_KEY, 'true'); } catch (err) { console.error(err); }
        }
        const operation = async () => {
            if (!handle) return false;
            try {
                let perm = await handle.queryPermission({ mode: 'readwrite' });
                if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'readwrite' });
                if (perm !== 'granted') throw new Error('Write permission required');
                const writable = await handle.createWritable();
                await writable.write(snapshot);
                await writable.close();
                if (handle === fileHandle && snapshot === JSON.stringify(records, null, 4)) {
                    pendingFileChanges = false;
                    localStorage.removeItem(PENDING_KEY);
                    updateFileStatus();
                }
                return true;
            } catch (err) {
                console.error('Failed to write to linked file:', err);
                updateFileStatus(true);
                return false;
            }
        };
        writeQueue = writeQueue.then(operation, operation);
        return writeQueue;
    }

    async function loadRecordsFromHandle(handle) {
        try {
            const file = await handle.getFile();
            const text = await file.text();
            if (text && text.trim()) {
                const parsed = JSON.parse(text);
                if (Array.isArray(parsed)) {
                    records = normalizeRecords(parsed);
                    localStorage.setItem('police_fines_data', JSON.stringify(records));
                }
            }
        } catch (err) {
            console.error('Failed to read linked file:', err);
            alert('The linked file could not be loaded. Current browser records have been retained.');
            throw err;
        }
    }

    // --- Link the working JSON file: pick or create it once, then every save writes directly to it ---
    async function linkDataFile() {
        if (!FSA_SUPPORTED) {
            alert("Direct file linking isn't supported in this browser. Please use Chrome or Edge, or continue with Export/Import Backup JSON.");
            return;
        }
        try {
            await writeQueue;
            const handle = await window.showSaveFilePicker({
                suggestedName: 'fine_records.json',
                types: [{ description: 'JSON File', accept: { 'application/json': ['.json'] } }]
            });

            let existingText = '';
            try { existingText = await (await handle.getFile()).text(); } catch (e) { /* new/empty file */ }

            fileHandle = handle;
            await idbSet(IDB_KEY, handle);

            if (existingText && existingText.trim()) {
                try {
                    const parsed = JSON.parse(existingText);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        const loadExisting = confirm("This file already contains records.\n\nPress OK to load them into the app, or Cancel to overwrite the file with the app's current data.");
                        if (loadExisting) {
                            records = normalizeRecords(parsed);
                            pendingFileChanges = false;
                            localStorage.removeItem(PENDING_KEY);
                            localStorage.setItem('police_fines_data', JSON.stringify(records));
                        } else {
                            await writeToLinkedFile();
                        }
                    } else {
                        await writeToLinkedFile();
                    }
                } catch (e) {
                    await writeToLinkedFile();
                }
            } else {
                await writeToLinkedFile();
            }

            updateFileStatus();
            renderTable();
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error(err);
                alert('Failed to link the data file.');
            }
        }
    }

    // --- Re-grant write permission after a browser reload (requires a user click) ---
    async function reconnectFile() {
        if (!fileHandle) return;
        try {
            const perm = await fileHandle.requestPermission({ mode: 'readwrite' });
            if (perm === 'granted') {
                await writeQueue;
                if (pendingFileChanges) {
                    // Keep unsynced browser edits, including an intentionally cleared database.
                    await saveToStorage();
                } else {
                    await loadRecordsFromHandle(fileHandle);
                }
                renderTable();
                updateFileStatus();
            } else {
                alert('Permission was not granted. Please use "Link Data File" to reselect the file.');
            }
        } catch (err) {
            console.error(err);
            alert('Could not reconnect. Please use "Link Data File" to reselect the file.');
        }
    }

    function updateFileStatus(needsReconnect = pendingFileChanges) {
        const badge = document.getElementById('fileStatus');
        const reconnectBtn = document.getElementById('reconnectBtn');

        if (!FSA_SUPPORTED) {
            badge.className = 'badge bg-secondary text-white border';
            badge.innerText = 'Browser Storage Only — use Export/Import Backup JSON';
            reconnectBtn.style.display = 'none';
            return;
        }

        if (fileHandle && needsReconnect) {
            badge.className = 'badge bg-warning text-dark border';
            badge.innerText = `File Linked (${fileHandle.name}) — Reconnect Required; browser changes retained`;
            reconnectBtn.style.display = 'inline-block';
        } else if (fileHandle) {
            badge.className = 'badge bg-success text-white border';
            badge.innerText = `Linked: ${fileHandle.name}`;
            reconnectBtn.style.display = 'none';
        } else {
            badge.className = 'badge bg-secondary text-white border';
            badge.innerText = 'No File Linked — using browser storage';
            reconnectBtn.style.display = 'none';
        }
    }

    // --- Manual, on-demand backup download (does NOT run automatically on every CRUD action) ---
    function saveToJsonFile() {
        if (records.length === 0) { alert('No records to export yet.'); return; }
        try {
            const today = new Date();
            const formattedDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            const filename = `fine_records_backup_${formattedDate}.json`;

            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(records, null, 4));
            const downloadAnchor = document.createElement('a');
            downloadAnchor.setAttribute("href", dataStr);
            downloadAnchor.setAttribute("download", filename);

            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
        } catch (err) {
            console.error(err);
            alert("Failed to export backup JSON.");
        }
    }

    // --- UNIVERSAL CROSS-BROWSER FILE LOAD ENGINE ---
    function loadFromJsonFile(event) {
        const file = event.target.files[0];
        if (!file) return;

        const fileReader = new FileReader();
        fileReader.onload = async function(e) {
            try {
                const parsedData = JSON.parse(e.target.result);
                if (Array.isArray(parsedData)) {
                    records = normalizeRecords(parsedData);
                    const saved = await saveToStorage();
                    renderTable();
                    event.target.value = '';
                    alert(saved ? "Database file parsed and synced seamlessly!" : "Records imported; saving is incomplete. Check the file status or export a backup.");
                } else {
                    alert("Invalid JSON data format.");
                }
            } catch (err) {
                console.error(err);
                alert("Error reading file.");
            }
        };
        fileReader.onerror = () => alert('Error reading file.');
        fileReader.readAsText(file);
    }

    function calculateAmounts() {
        const issuedDateVal = document.getElementById('fineIssuedDate').value;
        const paidDateVal = document.getElementById('paidDate').value;
        let baseAmount = parseFloat(document.getElementById('baseFineAmount').value) || 0;

        if (issuedDateVal && paidDateVal && baseAmount > 0) {
            const issued = new Date(issuedDateVal);
            const paid = new Date(paidDateVal);
            const diffTime = paid - issued;
            const diffDays = countDays(issuedDateVal, paidDateVal);

            let finalFine = baseAmount;
            if (diffDays > 14) { finalFine = baseAmount * 2; }

            const vote1 = finalFine * 0.60;
            const vote2 = finalFine * 0.40;

            document.getElementById('calcDays').innerText = diffDays >= 1 ? diffDays : 0;
            document.getElementById('calcFineAmount').innerText = finalFine.toFixed(2);
            document.getElementById('calcVote1').innerText = vote1.toFixed(2);
            document.getElementById('calcVote2').innerText = vote2.toFixed(2);

            return { finalFine, vote1, vote2, diffDays };
        }
        document.getElementById('calcDays').innerText = '0';
        ['calcFineAmount', 'calcVote1', 'calcVote2'].forEach(id => document.getElementById(id).innerText = '0.00');
        return { finalFine: 0, vote1: 0, vote2: 0, diffDays: 0 };
    }

    async function saveRecord(e) {
        e.preventDefault();
        const calcs = calculateAmounts();
        const recordId = String(document.getElementById('recordId').value);
        if (recordId && !records.some(r => String(r.id) === recordId)) { resetForm(); return; }
        const recordData = {
            id: recordId ? records.find(r => String(r.id) === recordId).id : Date.now(),
            receiptNumber: document.getElementById('receiptNumber').value.trim(),
            driverName: document.getElementById('driverName').value.trim(),
            vehicleNumber: document.getElementById('vehicleNumber').value.trim(),
            fineIssuedDate: document.getElementById('fineIssuedDate').value,
            paidDate: document.getElementById('paidDate').value,
            baseFineAmount: parseFloat(document.getElementById('baseFineAmount').value),
            fineAmount: calcs.finalFine,
            vote1Amount: calcs.vote1,
            vote2Amount: calcs.vote2
        };

        if (recordId) {
            const idx = records.findIndex(r => String(r.id) === recordId);
            if (idx !== -1) records[idx] = recordData;
        } else {
            records.push(recordData);
        }

        const saved = saveToStorage();
        resetForm();
        renderTable();
        await saved;
    }

    function editRecord(id) {
        const item = records.find(r => r.id === id);
        if (!item) return;

        document.getElementById('recordId').value = item.id;
        document.getElementById('receiptNumber').value = item.receiptNumber || '';
        document.getElementById('driverName').value = item.driverName;
        document.getElementById('vehicleNumber').value = item.vehicleNumber;
        document.getElementById('fineIssuedDate').value = item.fineIssuedDate;
        document.getElementById('paidDate').value = item.paidDate;
        document.getElementById('baseFineAmount').value = item.baseFineAmount;

        calculateAmounts();

        document.getElementById('formTitle').innerText = "Edit Fine Record";
        document.getElementById('saveBtn').innerText = "Update Record";
        document.getElementById('cancelBtn').style.display = "inline-block";
    }

    async function deleteRecord(id) {
        if (confirm("Are you sure you want to delete this fine record entry?")) {
            records = records.filter(r => r.id !== id);
            const saved = saveToStorage();
            renderTable();
            await saved;
        }
    }

    function resetForm() {
        document.getElementById('fineForm').reset();
        document.getElementById('recordId').value = "";
        document.getElementById('calcDays').innerText = "0";
        document.getElementById('calcFineAmount').innerText = "0.00";
        document.getElementById('calcVote1').innerText = "0.00";
        document.getElementById('calcVote2').innerText = "0.00";

        document.getElementById('formTitle').innerText = "Add Fine Record";
        document.getElementById('saveBtn').innerText = "Submit Record";
        document.getElementById('cancelBtn').style.display = "none";
    }

    function renderTable() {
        const fromDate = document.getElementById('filterFrom').value;
        const toDate = document.getElementById('filterTo').value;
        const tbody = document.getElementById('recordsTableBody');
        tbody.innerHTML = "";

        // Reverse a copy so equal paid dates retain newest-entry-first order.
        // Stored records and report ordering remain unchanged.
        let filtered = records.slice().reverse().sort((a, b) =>
            String(b.paidDate || '').localeCompare(String(a.paidDate || ''))
        );
        if (fromDate) { filtered = filtered.filter(r => r.paidDate >= fromDate); }
        if (toDate) { filtered = filtered.filter(r => r.paidDate <= toDate); }

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-5 fw-light">No records found. Enter items or load an existing backup file.</td></tr>`;
            return;
        }

        const fragment = document.createDocumentFragment();
        filtered.forEach(r => {
            const issued = new Date(r.fineIssuedDate);
            const paid = new Date(r.paidDate);
            const diffTime = paid - issued;
            const diffDays = countDays(r.fineIssuedDate, r.paidDate);
            const dayBadgeClass = diffDays > 14 ? "bg-danger" : "bg-dark";

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="font-mono bg-light text-secondary border px-2 py-1 rounded small fw-bold">${escapeHtml(r.receiptNumber || 'N/A')}</span></td>
                <td><div class="fw-bold text-dark">${escapeHtml(r.driverName)}</div></td>
                <td><span class="badge bg-secondary font-mono px-2 py-1">${escapeHtml(r.vehicleNumber)}</span></td>
                <td>
                    <div class="small mb-1"><span class="text-muted">Issued:</span> <strong class="font-mono text-secondary">${escapeHtml(r.fineIssuedDate)}</strong></div>
                    <div class="small mb-1"><span class="text-muted">Paid:</span> <strong class="font-mono text-secondary">${escapeHtml(r.paidDate)}</strong></div>
                    <div><span class="badge ${dayBadgeClass} font-mono">${diffDays >= 1 ? diffDays : 0} Days Counted</span></div>
                </td>
                <td>
                    <div class="fw-bold text-primary fs-6">LKR ${r.fineAmount.toFixed(2)}</div>
                    <div class="text-muted small" style="font-size:11px;">Base: LKR ${r.baseFineAmount.toFixed(2)}</div>
                </td>
                <td>
                    <div class="mb-1"><span class="badge bg-success-subtle text-success border border-success-subtle font-mono">V1 (60%): ${r.vote1Amount.toFixed(2)}</span></div>
                    <div><span class="badge bg-info-subtle text-info border border-info-subtle font-mono">V2 (40%): ${r.vote2Amount.toFixed(2)}</span></div>
                </td>
                <td class="text-end text-nowrap">
                    <button class="btn btn-sm btn-outline-primary me-1" data-action="edit" title="Edit" aria-label="Edit record"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn btn-sm btn-outline-danger" data-action="delete" title="Delete" aria-label="Delete record"><i class="fa-solid fa-trash"></i></button>
                </td>
            `;
            tr.querySelector('[data-action="edit"]').addEventListener('click', () => editRecord(r.id));
            tr.querySelector('[data-action="delete"]').addEventListener('click', () => deleteRecord(r.id));
            fragment.appendChild(tr);
        });
        tbody.appendChild(fragment);
    }

    function clearFilter() {
        document.getElementById('filterFrom').value = "";
        document.getElementById('filterTo').value = "";
        renderTable();
    }

    async function clearAllData() {
        if (confirm("Are you absolutely certain you want to wipe local data?")) {
            records = [];
            const saved = saveToStorage();
            renderTable();
            await saved;
        }
    }

    const quarterMonthMaps = {
        1: ["ජනවාරි", "පෙබරවාරි", "මාර්තු"],
        2: ["අප්‍රේල්", "මැයි", "ජූනි"],
        3: ["ජූලි", "අගෝස්තු", "සැප්තැම්බර්"],
        4: ["ඔක්තෝබර්", "නොවැම්බර්", "දෙසැම්බර්"]
    };

    function prepareReport() { generateReportStructure(); }
    function prepareBreakdownReport() { generateBreakdownStructure(); }

    function generateReportStructure() {
        const targetYear = parseInt(document.getElementById('reportYear').value) || 2026;
        const targetQuarter = parseInt(document.getElementById('reportQuarter').value) || 3;
        const dsNameValue = document.getElementById('reportDSInput').value.trim() || "....................";
        const months = quarterMonthMaps[targetQuarter];
        
        document.getElementById('lblYear').innerText = targetYear;
        document.getElementById('lblQuarter').innerText = targetQuarter;
        document.getElementById('thMonth1').innerText = `${months[0]} මාසය`;
        document.getElementById('thMonth2').innerText = `${months[1]} මාසය`;
        document.getElementById('thMonth3').innerText = `${months[2]} මාසය`;

        const startMonthIdx = quarterStart(targetQuarter); 
        let totalM1 = 0, totalM2 = 0, totalM3 = 0;

        records.forEach(r => {
            const pDate = new Date(r.paidDate);
            if (pDate.getFullYear() === targetYear) {
                const m = pDate.getMonth(); 
                if (m >= startMonthIdx && m < startMonthIdx + 3) {
                    const relativeMonthOffset = m - startMonthIdx; 
                    if (relativeMonthOffset === 0) totalM1 += r.vote2Amount;
                    if (relativeMonthOffset === 1) totalM2 += r.vote2Amount;
                    if (relativeMonthOffset === 2) totalM3 += r.vote2Amount;
                }
            }
        });

        const reportRowsContainer = document.getElementById('reportRows');
        reportRowsContainer.innerHTML = "";
        const grandTotal = totalM1 + totalM2 + totalM3;

        const splitM1 = splitRupeeCents(totalM1);
        const splitM2 = splitRupeeCents(totalM2);
        const splitM3 = splitRupeeCents(totalM3);
        const splitTotal = splitRupeeCents(grandTotal);

        const dataTr = document.createElement('tr');
        dataTr.innerHTML = `
            <td class="text-center">1</td>
            <td class="fw-bold">${escapeHtml(dsNameValue)}</td>
            <td class="text-end">${splitM1.r}</td><td class="text-center text-muted small">${splitM1.c}</td>
            <td class="text-end">${splitM2.r}</td><td class="text-center text-muted small">${splitM2.c}</td>
            <td class="text-end">${splitM3.r}</td><td class="text-center text-muted small">${splitM3.c}</td>
            <td class="text-end fw-bold">${splitTotal.r}</td><td class="text-center fw-bold small">${splitTotal.c}</td>
        `;
        reportRowsContainer.appendChild(dataTr);

        const totalTr = document.createElement('tr');
        totalTr.className = "fw-bold table-secondary";
        totalTr.innerHTML = `
            <td colspan="2" class="text-center">මුළු එකතුව </td>
            <td class="text-end">${splitM1.r}</td><td class="text-center small">${splitM1.c}</td>
            <td class="text-end">${splitM2.r}</td><td class="text-center small">${splitM2.c}</td>
            <td class="text-end">${splitM3.r}</td><td class="text-center small">${splitM3.c}</td>
            <td class="text-end">${splitTotal.r}</td><td class="text-center small">${splitTotal.c}</td>
        `;
        reportRowsContainer.appendChild(totalTr);
        document.getElementById('lblTotalText').innerText = ` ${grandTotal.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} /= `;
    }

    function generateBreakdownStructure() {
        const targetYear = parseInt(document.getElementById('breakdownYear').value) || 2026;
        const targetQuarter = parseInt(document.getElementById('breakdownQuarter').value) || 3;
        
        document.getElementById('lblBYear').innerText = targetYear;
        document.getElementById('lblBQuarter').innerText = targetQuarter;

        const breakdownRows = document.getElementById('breakdownRows');
        breakdownRows.innerHTML = "";

        const startMonthIdx = quarterStart(targetQuarter);
        let runningVote2Total = 0;
        let counter = 0;

        records.forEach(r => {
            const pDate = new Date(r.paidDate);
            if (pDate.getFullYear() === targetYear) {
                const m = pDate.getMonth();
                if (m >= startMonthIdx && m < startMonthIdx + 3) {
                    counter++;
                    runningVote2Total += r.vote2Amount;

                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td class="text-center">${counter}</td>
                        <td class="font-mono fw-bold">${escapeHtml(r.receiptNumber || 'N/A')}</td>
                        <td>${escapeHtml(r.driverName)}</td>
                        <td class="font-mono">${escapeHtml(r.paidDate)}</td>
                        <td class="text-end font-mono">LKR ${r.vote2Amount.toFixed(2)}</td>
                    `;
                    breakdownRows.appendChild(row);
                }
            }
        });

        if (counter === 0) {
            breakdownRows.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">No matching records logged for this target criteria.</td></tr>`;
        }

        document.getElementById('lblBreakdownGrandTotal').innerText = `LKR ${runningVote2Total.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    }

    function splitRupeeCents(amount) {
        if (!amount || amount === 0) return { r: "0", c: "00" };
        const parts = amount.toFixed(2).split(".");
        return { r: parseInt(parts[0]).toLocaleString('en-US'), c: parts[1] };
    }

    function escapeHtml(str) {
        return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }
