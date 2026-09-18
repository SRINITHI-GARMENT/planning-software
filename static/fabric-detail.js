/**
 * Fabric Requirement Details - Matrix View Logic
 * Srinithi Garments ERP
 */

// Application State
let fabricState = {
    fabricName: '',
    planName: '',
    financialYear: '',
    version: '',
    fromDate: '',
    toDate: '',
    brand: '',
    category: '',
    product: '',
    search: '',
    considerFg: true,
    considerWip: true,
    considerPending: true,

    currentMetric: 'fabric_req', // 'fabric_req' | 'fabric_stock' | 'fabric_wip' | 'inhand' | 'bal_required_fab'
    colorSearchTerm: '',

    rawRows: [],
    cellMap: {}, // key: `${color}__${dia}` -> { fabric_req, fabric_stock, fabric_wip, inhand, bal_required_fab }
    uniqueColors: [],
    sortedDias: []
};

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    initFromUrlParams();
    fetchFabricDetailData(false);
});

// Parse URL Parameters and build context badges
function initFromUrlParams() {
    const params = new URLSearchParams(window.location.search);

    fabricState.fabricName = params.get('fabric') || params.get('fabric_name') || '';
    fabricState.planName = params.get('plan_name') || '';
    fabricState.financialYear = params.get('financial_year') || '';
    fabricState.version = params.get('version') || '';
    fabricState.fromDate = params.get('from_date') || '';
    fabricState.toDate = params.get('to_date') || '';
    fabricState.brand = params.get('brand') || '';
    fabricState.category = params.get('category') || '';
    fabricState.product = params.get('product') || '';
    fabricState.search = params.get('search') || '';
    fabricState.considerFg = params.get('consider_fg') !== 'false';
    fabricState.considerWip = params.get('consider_wip') !== 'false';
    fabricState.considerPending = params.get('consider_pending') !== 'false';

    // Update Title and Display Fabric Name
    document.title = fabricState.fabricName ? `${fabricState.fabricName} - Fabric Requirement Details` : 'Fabric Requirement Details';
    const displayFabricEl = document.getElementById('display-fabric-name');
    if (displayFabricEl) {
        displayFabricEl.textContent = fabricState.fabricName || 'Unknown Fabric';
    }

    // Render Context Badges
    renderContextChips();
}

function renderContextChips() {
    const container = document.getElementById('context-chips-container');
    if (!container) return;
    container.innerHTML = '';

    const chips = [];

    if (fabricState.planName && fabricState.financialYear) {
        chips.push({ label: 'Plan & FY', value: `${fabricState.planName} (${fabricState.financialYear})`, icon: 'fa-calendar' });
    } else if (fabricState.planName) {
        chips.push({ label: 'Plan', value: fabricState.planName, icon: 'fa-calendar' });
    }

    if (fabricState.version) {
        chips.push({ label: 'Version', value: fabricState.version, icon: 'fa-code-branch' });
    }

    if (fabricState.fromDate && fabricState.toDate) {
        chips.push({ label: 'Period', value: `${fabricState.fromDate} to ${fabricState.toDate}`, icon: 'fa-clock' });
    }

    if (fabricState.brand) {
        chips.push({ label: 'Brand', value: fabricState.brand, icon: 'fa-tag' });
    }

    if (fabricState.category) {
        chips.push({ label: 'Category', value: fabricState.category, icon: 'fa-shapes' });
    }

    if (fabricState.product) {
        chips.push({ label: 'Product', value: fabricState.product, icon: 'fa-cube' });
    }

    if (fabricState.search) {
        chips.push({ label: 'Search', value: fabricState.search, icon: 'fa-magnifying-glass' });
    }

    const considerList = [];
    if (fabricState.considerFg) considerList.push('FG Stock');
    if (fabricState.considerWip) considerList.push('WIP Qty');
    if (fabricState.considerPending) considerList.push('Pending Qty');
    if (considerList.length < 3) {
        chips.push({ label: 'Consider', value: considerList.length > 0 ? considerList.join(', ') : 'None', icon: 'fa-filter' });
    }

    chips.forEach(chip => {
        const div = document.createElement('div');
        div.className = 'badge';
        div.style.background = 'rgba(255, 255, 255, 0.04)';
        div.style.border = '1px solid var(--border-color)';
        div.style.color = 'var(--text-secondary)';
        div.style.padding = '5px 10px';
        div.style.fontSize = '12px';
        div.style.borderRadius = 'var(--radius-sm)';
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.gap = '6px';
        div.innerHTML = `<i class="fa-solid ${chip.icon}" style="color: var(--accent-blue);"></i> <span style="color: var(--text-muted);">${chip.label}:</span> <strong style="color: var(--text-primary);">${chip.value}</strong>`;
        container.appendChild(div);
    });
}

// Fetch Fabric Detail Data from API
async function fetchFabricDetailData(forceRecalculate = false) {
    const loader = document.getElementById('fabric-loader');
    const emptyState = document.getElementById('fabric-empty-state');
    const errorState = document.getElementById('fabric-error-state');
    const matrixWrapper = document.getElementById('fabric-matrix-wrapper');

    if (loader) loader.classList.remove('hidden');
    if (emptyState) emptyState.classList.add('hidden');
    if (errorState) errorState.classList.add('hidden');

    if (!fabricState.fabricName) {
        if (loader) loader.classList.add('hidden');
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }

    // Build URL calling the existing backend /api/fabric-req/data endpoint with all=true
    const params = new URLSearchParams();
    params.set('all', 'true');
    params.set('fabric_name', fabricState.fabricName);
    params.set('_', Date.now().toString());

    if (fabricState.planName) params.set('plan_name', fabricState.planName);
    if (fabricState.financialYear) params.set('financial_year', fabricState.financialYear);
    if (fabricState.version) params.set('version', fabricState.version);
    if (fabricState.fromDate) params.set('from_date', fabricState.fromDate);
    if (fabricState.toDate) params.set('to_date', fabricState.toDate);
    if (fabricState.brand) params.set('brand', fabricState.brand);
    if (fabricState.category) params.set('category', fabricState.category);
    if (fabricState.product) params.set('product', fabricState.product);
    if (fabricState.search) params.set('search', fabricState.search);
    params.set('consider_fg', fabricState.considerFg);
    params.set('consider_wip', fabricState.considerWip);
    params.set('consider_pending', fabricState.considerPending);
    if (forceRecalculate) params.set('recalculate', 'true');

    const url = `/api/fabric-req/data?${params.toString()}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (loader) loader.classList.add('hidden');

        if (!response.ok || !data.success) {
            console.error('API error:', data);
            if (errorState) {
                errorState.classList.remove('hidden');
                const errMsgEl = document.getElementById('fabric-error-msg');
                if (errMsgEl) errMsgEl.textContent = data.message || 'Error loading fabric details from server.';
            }
            if (matrixWrapper) matrixWrapper.style.display = 'none';
            return;
        }

        fabricState.rawRows = data.rows || [];

        if (fabricState.rawRows.length === 0) {
            if (emptyState) emptyState.classList.remove('hidden');
            if (matrixWrapper) matrixWrapper.style.display = 'none';
            updateRecordCount(0, 0);
            return;
        }

        if (matrixWrapper) matrixWrapper.style.display = 'block';

        // Process records: Direct 1:1 mapping of backend pre-aggregated values
        processRawData(fabricState.rawRows);

        // Render Matrix Table
        renderMatrix();

    } catch (err) {
        console.error('Fetch exception:', err);
        if (loader) loader.classList.add('hidden');
        if (errorState) {
            errorState.classList.remove('hidden');
            const errMsgEl = document.getElementById('fabric-error-msg');
            if (errMsgEl) errMsgEl.textContent = 'Connection error while contacting the ERP server.';
        }
        if (matrixWrapper) matrixWrapper.style.display = 'none';
    }
}

// Process raw pre-aggregated API rows into 1:1 cell lookup structure
function processRawData(rows) {
    fabricState.cellMap = {};
    const colorSet = new Set();
    const diaSet = new Set();
    const orderedColors = [];

    rows.forEach(row => {
        const color = (row.color || '-').toString().trim();
        const dia = Number(row.dia);

        if (!colorSet.has(color)) {
            colorSet.add(color);
            orderedColors.push(color);
        }

        if (!isNaN(dia)) {
            diaSet.add(dia);
        }

        const cellKey = `${color}__${dia}`;
        const fReq = Number(row.fabric_req || 0);
        const fStock = Number(row.fabric_stock || 0);
        const fWip = Number(row.fabric_wip || 0);
        const fBal = Number(row.bal_required_fab || 0);
        const fExcess = Number(row.excess_qty || 0);
        const fInhand = fStock + fWip;

        // Store direct 1:1 values from backend
        fabricState.cellMap[cellKey] = {
            fabric_req: fReq,
            fabric_stock: fStock,
            fabric_wip: fWip,
            inhand: fInhand,
            bal_required_fab: fBal,
            excess_qty: fExcess
        };
    });

    // Sort Colors alphabetically
    fabricState.uniqueColors = orderedColors.sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );

    // Sort DIAs strictly numerically ascending (e.g. 29, 31, 33, 34, 37, 38)
    fabricState.sortedDias = Array.from(diaSet).sort((a, b) => a - b);
}

// Render Excel-Style Pivot Matrix Table
function renderMatrix() {
    const thead = document.getElementById('fabric-matrix-thead');
    const tbody = document.getElementById('fabric-matrix-tbody');
    const tfoot = document.getElementById('fabric-matrix-tfoot');

    if (!thead || !tbody || !tfoot) return;

    thead.innerHTML = '';
    tbody.innerHTML = '';
    tfoot.innerHTML = '';

    const metric = fabricState.currentMetric;
    const dias = fabricState.sortedDias;
    const allColors = fabricState.uniqueColors;

    // Filter colors based on real-time client-side search
    const query = (fabricState.colorSearchTerm || '').toLowerCase().trim();
    const filteredColors = allColors.filter(color => color.toLowerCase().includes(query));

    updateRecordCount(filteredColors.length, dias.length);

    // 1. Render THEAD
    let headHtml = `<tr>
        <th class="sticky-col-fabric" style="text-align: left;">Fabric Name</th>
        <th class="sticky-col-color" style="text-align: left;">Color</th>`;

    dias.forEach(dia => {
        headHtml += `<th style="text-align: right; min-width: 85px;">${dia}"</th>`;
    });

    headHtml += `<th class="matrix-col-total" style="min-width: 100px;">Total</th></tr>`;
    thead.innerHTML = headHtml;

    // Handle empty search result
    if (filteredColors.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="${dias.length + 3}" style="text-align: center; color: var(--text-muted); padding: 32px 16px;">
                    No colors match "${fabricState.colorSearchTerm}".
                </td>
            </tr>
        `;
        return;
    }

    // 2. Render TBODY Rows
    const diaColTotals = {};
    dias.forEach(d => { diaColTotals[d] = 0; });
    let grandTotal = 0;

    filteredColors.forEach(color => {
        const tr = document.createElement('tr');
        let rowTotal = 0;

        let rowHtml = `
            <td class="sticky-col-fabric"><strong>${fabricState.fabricName}</strong></td>
            <td class="sticky-col-color">${color}</td>
        `;

        dias.forEach(dia => {
            const cellKey = `${color}__${dia}`;
            const cellData = fabricState.cellMap[cellKey];
            const val = cellData ? (cellData[metric] || 0) : 0;

            rowTotal += val;
            diaColTotals[dia] += val;

            const isZero = val === 0;
            const formattedVal = Number(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const zeroClass = isZero ? 'matrix-cell-zero' : '';

            rowHtml += `<td class="matrix-cell-num ${zeroClass}">${formattedVal}</td>`;
        });

        grandTotal += rowTotal;
        const formattedRowTotal = Number(rowTotal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        rowHtml += `<td class="matrix-col-total">${formattedRowTotal}</td>`;

        tr.innerHTML = rowHtml;
        tbody.appendChild(tr);
    });

    // 3. Render TFOOT (Bottom Total Row)
    let footHtml = `<tr>
        <td class="sticky-col-fabric" style="font-weight: 800;">TOTAL</td>
        <td class="sticky-col-color"></td>`;

    dias.forEach(dia => {
        const colTotal = diaColTotals[dia] || 0;
        const formattedColTotal = Number(colTotal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        footHtml += `<td class="matrix-cell-num" style="font-weight: 700;">${formattedColTotal}</td>`;
    });

    const formattedGrandTotal = Number(grandTotal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    footHtml += `<td class="matrix-col-total" style="font-weight: 800; font-size: 14px;">${formattedGrandTotal}</td></tr>`;

    tfoot.innerHTML = footHtml;
}

// Dropdown Metric Change Handler (instant client-side update with 0 reload)
function onMetricChange(newMetric) {
    fabricState.currentMetric = newMetric;
    renderMatrix();
}

// Client-Side Color Search Handler
function onColorSearch(term) {
    fabricState.colorSearchTerm = term;
    renderMatrix();
}

// Record and Combination Count Indicator
function updateRecordCount(colorCount, diaCount) {
    const countEl = document.getElementById('matrix-record-count');
    if (countEl) {
        countEl.textContent = `${colorCount}`;
    }
}

// Export Matrix Table to Formatted Excel Workbook
function exportMatrixExcel() {
    if (!fabricState.rawRows || fabricState.rawRows.length === 0) {
        showToast('Warning', 'No fabric matrix data to export.', 'warning');
        return;
    }

    const metric = fabricState.currentMetric;
    const dias = fabricState.sortedDias;
    const allColors = fabricState.uniqueColors;
    const query = (fabricState.colorSearchTerm || '').toLowerCase().trim();
    const filteredColors = allColors.filter(color => color.toLowerCase().includes(query));

    const metricLabels = {
        'fabric_req': 'Fabric Req',
        'fabric_stock': 'Fabric Stock',
        'fabric_wip': 'Fabric WIP',
        'inhand': 'INHAND',
        'bal_required_fab': 'Bal Required Fab'
    };
    const activeMetricLabel = metricLabels[metric] || metric;

    // 1. Build Headers Row
    const headers = ['Fabric Name', 'Color', ...dias.map(d => `${d}"`), 'Total'];
    const dataRows = [];

    const diaColTotals = {};
    dias.forEach(d => { diaColTotals[d] = 0; });
    let grandTotal = 0;

    // 2. Build Data Rows
    filteredColors.forEach(color => {
        let rowTotal = 0;
        const rowData = [fabricState.fabricName, color];

        dias.forEach(dia => {
            const cellKey = `${color}__${dia}`;
            const cellData = fabricState.cellMap[cellKey];
            const val = cellData ? (cellData[metric] || 0) : 0;

            rowTotal += val;
            diaColTotals[dia] += val;
            rowData.push(Number(val));
        });

        grandTotal += rowTotal;
        rowData.push(Number(rowTotal));
        dataRows.push(rowData);
    });

    // 3. Build TOTAL Summary Row
    const totalRow = ['TOTAL', '', ...dias.map(dia => Number(diaColTotals[dia] || 0)), Number(grandTotal)];
    dataRows.push(totalRow);

    const sheetData = [headers, ...dataRows];
    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);

    // Auto-size columns
    const colWidths = [
        { wch: Math.max(15, fabricState.fabricName.length + 2) },
        { wch: 22 },
        ...dias.map(d => ({ wch: 12 })),
        { wch: 16 }
    ];
    worksheet['!cols'] = colWidths;

    // Auto-filter
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    worksheet['!autofilter'] = { ref: XLSX.utils.encode_range(range) };

    // Freeze header row and first 2 columns
    worksheet['!views'] = [{
        state: 'frozen',
        ySplit: 1,
        xSplit: 2,
        topLeftCell: 'C2',
        activePane: 'bottomRight'
    }];

    // Create workbook
    const workbook = XLSX.utils.book_new();
    const sheetName = `${fabricState.fabricName.substring(0, 20)}_${activeMetricLabel.substring(0, 10)}`;
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

    // Filename: <FabricName>_<Metric>_<Date>.xlsx
    const todayStr = new Date().toISOString().split('T')[0];
    const safeMetric = metric.replace(/\s+/g, '_');
    const safeFabric = fabricState.fabricName.replace(/\s+/g, '_');
    const filename = `${safeFabric}_${safeMetric}_${todayStr}.xlsx`;

    XLSX.writeFile(workbook, filename);
}

// Back Navigation Handler
function handleBackNavigation() {
    if (window.history.length > 1) {
        window.history.back();
    } else {
        window.location.href = '/';
    }
}

// Toast notification helper
function showToast(title, message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `notification ${type}`;
    toast.style.background = '#202433';
    toast.style.border = '1px solid var(--border-color)';
    toast.style.borderRadius = 'var(--radius-md)';
    toast.style.padding = '12px 16px';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '10px';
    toast.style.minWidth = '280px';
    toast.style.boxShadow = '0 8px 24px rgba(0,0,0,0.5)';
    toast.style.color = 'var(--text-primary)';

    let iconClass = 'fa-circle-info';
    if (type === 'success') iconClass = 'fa-circle-check';
    if (type === 'error') iconClass = 'fa-circle-exclamation';
    if (type === 'warning') iconClass = 'fa-triangle-exclamation';

    toast.innerHTML = `
        <i class="fa-solid ${iconClass}" style="color: var(--accent-blue); font-size: 16px;"></i>
        <div>
            <div style="font-weight: 700; font-size: 13px;">${title}</div>
            <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">${message}</div>
        </div>
    `;

    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3500);
}
