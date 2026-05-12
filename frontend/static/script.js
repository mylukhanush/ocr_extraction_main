/* ─── State ──────────────────────────────────────── */
let currentEndpoint = '/extract_passport_details';
let currentFile     = null;
let rawData         = null;

/* ─── Elements ───────────────────────────────────── */
const tokenInput   = document.getElementById('token-input');
const tokenToggle  = document.getElementById('token-toggle');
const toggleIcon   = document.getElementById('toggle-icon');
const uploadZone   = document.getElementById('upload-zone');
const fileInput    = document.getElementById('file-input');
const browseBtn    = document.getElementById('browse-btn');
const uploadEmpty  = document.getElementById('upload-empty');
const uploadPreview= document.getElementById('upload-preview');
const previewImg   = document.getElementById('preview-img');
const pdfThumb     = document.getElementById('pdf-thumb');
const previewName  = document.getElementById('preview-name');
const previewSize  = document.getElementById('preview-size');
const btnRemove    = document.getElementById('btn-remove');
const btnExtract   = document.getElementById('btn-extract');
const stateLoading = document.getElementById('state-loading');
const stateError   = document.getElementById('state-error');
const errorText    = document.getElementById('error-text');
const resultsCard  = document.getElementById('results-card');
const resultsContent = document.getElementById('results-content');
const btnCopy      = document.getElementById('btn-copy');
const pageTitle    = document.getElementById('page-title');
const endpointBadge= document.getElementById('endpoint-badge');
const successLabel = document.getElementById('success-label');
const navItems     = document.querySelectorAll('.nav-item');

/* ─── Token — auto-load from server, persist locally ─ */
(async () => {
    const saved = localStorage.getItem('dv_ocr_token');
    if (saved) {
        tokenInput.value = saved;
    } else {
        try {
            const res = await fetch('/config');
            if (res.ok) {
                const cfg = await res.json();
                if (cfg.token) {
                    tokenInput.value = cfg.token;
                    localStorage.setItem('dv_ocr_token', cfg.token);
                }
            }
        } catch (_) { /* silent fail */ }
    }
})();

tokenInput.addEventListener('change', () => {
    localStorage.setItem('dv_ocr_token', tokenInput.value);
});

tokenToggle.addEventListener('click', () => {
    const isPwd = tokenInput.type === 'password';
    tokenInput.type = isPwd ? 'text' : 'password';
    toggleIcon.className = isPwd ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
});

/* ─── Document type selection ────────────────────── */
navItems.forEach(btn => {
    btn.addEventListener('click', () => {
        navItems.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentEndpoint = btn.dataset.endpoint;
        pageTitle.textContent = btn.dataset.label;
        endpointBadge.textContent = btn.dataset.endpoint;
        resetAll();
    });
});

/* ─── Upload zone — drag & drop ──────────────────── */
uploadZone.addEventListener('dragover', e => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
});

uploadZone.addEventListener('dragleave', e => {
    if (!uploadZone.contains(e.relatedTarget)) {
        uploadZone.classList.remove('drag-over');
    }
});

uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
});

uploadZone.addEventListener('click', e => {
    if (currentFile) return;
    if (e.target.closest('.btn-remove')) return;
    fileInput.click();
});

browseBtn.addEventListener('click', e => {
    e.stopPropagation();
    fileInput.click();
});

fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) handleFile(file);
    fileInput.value = '';
});

btnRemove.addEventListener('click', e => {
    e.stopPropagation();
    clearFile();
});

/* ─── File handling ──────────────────────────────── */
function handleFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['jpg', 'jpeg', 'png', 'pdf'].includes(ext)) {
        showError('Unsupported format. Upload JPG, PNG, or PDF.');
        return;
    }

    currentFile = file;
    previewName.textContent = file.name;
    previewSize.textContent = formatBytes(file.size);

    if (ext === 'pdf') {
        previewImg.style.display = 'none';
        pdfThumb.style.display   = 'flex';
    } else {
        pdfThumb.style.display   = 'none';
        previewImg.style.display = 'block';
        const reader = new FileReader();
        reader.onload = ev => { previewImg.src = ev.target.result; };
        reader.readAsDataURL(file);
    }

    uploadEmpty.style.display   = 'none';
    uploadPreview.style.display = 'flex';
    resetMessages();
}

function clearFile() {
    currentFile = null;
    previewImg.src = '';
    uploadPreview.style.display = 'none';
    uploadEmpty.style.display   = 'flex';
    resetMessages();
}

function formatBytes(bytes) {
    if (bytes < 1024)     return bytes + ' B';
    if (bytes < 1048576)  return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

/* ─── Extract ────────────────────────────────────── */
btnExtract.addEventListener('click', performExtract);

async function performExtract() {
    const token = tokenInput.value.trim();

    if (!token) {
        showError('API token is required. Enter it in the top-right field.');
        return;
    }
    if (!currentFile) {
        showError('Please select a document file first.');
        return;
    }

    resetMessages();
    setLoading(true);

    const formData = new FormData();
    formData.append('image', currentFile);

    try {
        const res = await fetch(currentEndpoint, {
            method: 'POST',
            headers: { 'Authorization': token },
            body: formData,
        });

        const json = await res.json();

        if (res.status === 401) { showError('Invalid or missing token. Check your API token.'); return; }
        if (res.status === 403) { showError('Access denied. Wrong token.'); return; }
        if (res.status === 429) { showError('Rate limit reached (5 requests/minute). Please wait a moment.'); return; }

        if (!res.ok || json.sts === 400) {
            showError(json.msg || json.error || json.detail || 'Extraction failed. Ensure the correct document type is selected.');
            return;
        }

        rawData = json.data || json;
        const fieldCount = countFields(rawData);
        successLabel.textContent = `${fieldCount} field${fieldCount !== 1 ? 's' : ''} extracted`;
        renderResults(rawData);

    } catch (err) {
        showError('Network error: ' + err.message);
    } finally {
        setLoading(false);
    }
}

/* ─── Render results ─────────────────────────────── */
function renderResults(data) {
    resultsContent.innerHTML = '';

    const table = document.createElement('table');
    table.className = 'results-table';

    Object.entries(data).forEach(([key, value]) => {
        const tr = document.createElement('tr');

        const tdKey = document.createElement('td');
        tdKey.textContent = key.replace(/_/g, ' ');

        const tdVal = document.createElement('td');

        if (value === null || value === undefined || value === '') {
            const empty = document.createElement('span');
            empty.className = 'cell-empty';
            empty.textContent = 'N/A';
            tdVal.appendChild(empty);
        } else if (typeof value === 'object' && !Array.isArray(value)) {
            tdVal.appendChild(renderNested(value));
        } else if (Array.isArray(value)) {
            tdVal.textContent = value.join(', ') || '—';
        } else {
            tdVal.textContent = String(value);
        }

        tr.appendChild(tdKey);
        tr.appendChild(tdVal);
        table.appendChild(tr);
    });

    resultsContent.appendChild(table);
    resultsCard.style.display = 'block';
}

function renderNested(obj) {
    const table = document.createElement('table');
    table.className = 'nested-table';
    Object.entries(obj).forEach(([k, v]) => {
        const tr = document.createElement('tr');
        const tdK = document.createElement('td');
        tdK.textContent = k.replace(/_/g, ' ');
        const tdV = document.createElement('td');
        tdV.textContent = (v === null || v === undefined || v === '') ? 'N/A' : String(v);
        tr.appendChild(tdK);
        tr.appendChild(tdV);
        table.appendChild(tr);
    });
    return table;
}

function countFields(data) {
    return typeof data === 'object' && data !== null ? Object.keys(data).length : 0;
}

/* ─── Copy JSON ──────────────────────────────────── */
btnCopy.addEventListener('click', () => {
    if (!rawData) return;
    navigator.clipboard.writeText(JSON.stringify(rawData, null, 2)).then(() => {
        btnCopy.classList.add('copied');
        btnCopy.innerHTML = '<i class="fa-solid fa-check"></i><span>Copied!</span>';
        setTimeout(() => {
            btnCopy.classList.remove('copied');
            btnCopy.innerHTML = '<i class="fa-solid fa-copy"></i><span>Copy JSON</span>';
        }, 2200);
    }).catch(() => {
        /* fallback for HTTP (non-HTTPS) context */
        const ta = document.createElement('textarea');
        ta.value = JSON.stringify(rawData, null, 2);
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        btnCopy.classList.add('copied');
        btnCopy.innerHTML = '<i class="fa-solid fa-check"></i><span>Copied!</span>';
        setTimeout(() => {
            btnCopy.classList.remove('copied');
            btnCopy.innerHTML = '<i class="fa-solid fa-copy"></i><span>Copy JSON</span>';
        }, 2200);
    });
});

/* ─── Helpers ────────────────────────────────────── */
function setLoading(show) {
    stateLoading.style.display = show ? 'flex' : 'none';
    btnExtract.disabled = show;
}

function showError(msg) {
    stateError.style.display = 'flex';
    errorText.textContent = msg;
}

function resetMessages() {
    stateError.style.display   = 'none';
    resultsCard.style.display  = 'none';
    stateLoading.style.display = 'none';
    resultsContent.innerHTML   = '';
    rawData = null;
}

function resetAll() {
    clearFile();
    resetMessages();
}
