/**
 * Finished Goods Visibility - Detailed Stock Matrix View
 * Srinithi Garment ERP
 */

let state = {
    entityType: 'standalone', // 'standalone' | 'common'
    entityId: '',
    entityName: '',
    considerFg: true,
    considerWip: true,
    currentMetric: 'FG Stock', // 'FG Stock' | 'WIP Qty' | 'FG+WIP Qty' | 'Pending Qty' | 'BAL STOCK'
    currentScope: 'all', // 'all' or member_product_name
    colorSearchTerm: '',
    
    // Server response data
    entityInfo: {},
    sizes: [],
    colors: [],
    cells: {}, // key: `${color}__${size}` -> { fg_stock, wip_qty, pending_qty }
    memberCells: {} // member_name -> { key: `${color}__${size}` -> { fg_stock, wip_qty, pending_qty } }
};

document.addEventListener('DOMContentLoaded', () => {
    initFromUrlParams();
    fetchMatrixData(false);
});

function initFromUrlParams() {
    const params = new URLSearchParams(window.location.search);
    state.entityType = (params.get('entity_type') || 'standalone').toLowerCase();
    state.entityId = params.get('id') || '';
    state.entityName = params.get('name') || '';
    state.considerFg = params.get('consider_fg') !== 'false';
    state.considerWip = params.get('consider_wip') !== 'false';

    // Update Checkboxes in UI
    const cbFg = document.getElementById('detail-consider-fg');
    const cbWip = document.getElementById('detail-consider-wip');
    if (cbFg) cbFg.checked = state.considerFg;
    if (cbWip) cbWip.checked = state.considerWip;

    // Update Header Badges
    const badgeEl = document.getElementById('display-entity-type-badge');
    if (badgeEl) {
        if (state.entityType === 'common') {
            badgeEl.textContent = 'Common Production Group';
            badgeEl.style.background = 'rgba(139, 92, 246, 0.2)';
            badgeEl.style.color = '#a78bfa';
            badgeEl.style.borderColor = 'rgba(139, 92, 246, 0.4)';
        } else {
            badgeEl.textContent = 'Stand Alone Product';
            badgeEl.style.background = 'rgba(59, 130, 246, 0.2)';
            badgeEl.style.color = 'var(--accent-blue)';
            badgeEl.style.borderColor = 'rgba(59, 130, 246, 0.4)';
        }
    }

    const nameEl = document.getElementById('display-entity-name');
    if (nameEl) {
        nameEl.textContent = state.entityName || 'Stock Matrix';
    }

    document.title = state.entityName 
        ? `${state.entityName} - Finished Goods Visibility Matrix` 
        : 'Finished Goods Visibility Matrix';
}

async function fetchMatrixData(forceRefresh = false) {
    showLoader(true);
    hideError();
    hideEmpty();

    try {
        const queryParams = new URLSearchParams({
            entity_type: state.entityType,
            id: state.entityId,
            name: state.entityName
        });

        const resp = await fetch(`/api/finished-goods-visibility/matrix?${queryParams.toString()}`);
        if (!resp.ok) {
            throw new Error(`HTTP error ${resp.status}`);
        }

        const res = await resp.json();
        if (!res.success) {
            throw new Error(res.message || 'Failed to fetch matrix data');
        }

        state.entityInfo = res.entity_info || {};
        state.sizes = res.sizes || [];
        state.colors = res.colors || [];
        state.cells = res.cells || {};
        state.memberCells = res.member_cells || {};

        renderContextBadges();
        renderMemberScopeTabs();
        renderMatrix();
    } catch (err) {
        console.error('Error fetching matrix data:', err);
        showError(err.message);
    } finally {
        showLoader(false);
    }
}

function renderContextBadges() {
    const container = document.getElementById('context-chips-container');
    if (!container) return;
    container.innerHTML = '';

    const chips = [];
    const info = state.entityInfo;

    if (info.brand && info.brand !== '-') {
        chips.push({ label: 'Brand', value: info.brand, icon: 'fa-tag' });
    }
    if (info.category) {
        chips.push({ label: 'Category', value: info.category, icon: 'fa-shapes' });
    }
    if (info.fabric_name) {
        chips.push({ label: 'Fabric', value: info.fabric_name, icon: 'fa-scissors' });
    }
    if (state.entityType === 'common' && info.member_products && info.member_products.length > 0) {
        chips.push({ label: 'Members', value: `${info.member_products.length} Products`, icon: 'fa-layer-group' });
    }

    chips.forEach(c => {
        const badge = document.createElement('div');
        badge.className = 'badge';
        badge.style.display = 'inline-flex';
        badge.style.alignItems = 'center';
        badge.style.gap = '6px';
        badge.style.padding = '6px 10px';
        badge.style.background = 'rgba(255, 255, 255, 0.04)';
        badge.style.border = '1px solid var(--border-color)';
        badge.style.borderRadius = 'var(--radius-sm)';
        badge.style.fontSize = '12px';
        badge.innerHTML = `
            <i class="fa-solid ${c.icon}" style="color: var(--accent-blue); font-size: 11px;"></i>
            <span style="color: var(--text-muted); font-size: 11px; text-transform: uppercase;">${c.label}:</span>
            <span style="font-weight: 700; color: var(--text-primary);">${c.value}</span>
        `;
        container.appendChild(badge);
    });
}

function renderMemberScopeTabs() {
    const container = document.getElementById('common-members-tabs-container');
    const wrapper = document.getElementById('member-buttons-wrapper');
    if (!container || !wrapper) return;

    if (state.entityType !== 'common' || !state.entityInfo.member_products || state.entityInfo.member_products.length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    wrapper.innerHTML = '';

    // "All Group Members (Aggregated)" button
    const allBtn = document.createElement('button');
    allBtn.className = `member-tab-btn ${state.currentScope === 'all' ? 'active' : ''}`;
    allBtn.textContent = 'All Group Members (Aggregated)';
    allBtn.onclick = () => {
        state.currentScope = 'all';
        renderMemberScopeTabs();
        renderMatrix();
    };
    wrapper.appendChild(allBtn);

    // Individual member buttons
    state.entityInfo.member_products.forEach(m => {
        const mBtn = document.createElement('button');
        mBtn.className = `member-tab-btn ${state.currentScope === m.product_name ? 'active' : ''}`;
        mBtn.textContent = `${m.product_name} (${m.brand || '-'})`;
        mBtn.onclick = () => {
            state.currentScope = m.product_name;
            renderMemberScopeTabs();
            renderMatrix();
        };
        wrapper.appendChild(mBtn);
    });
}

function onMetricChange(newMetric) {
    state.currentMetric = newMetric;
    renderMatrix();
}

function onConsiderChange() {
    const cbFg = document.getElementById('detail-consider-fg');
    const cbWip = document.getElementById('detail-consider-wip');
    state.considerFg = cbFg ? cbFg.checked : true;
    state.considerWip = cbWip ? cbWip.checked : true;
    renderMatrix();
}

function onColorSearch(val) {
    state.colorSearchTerm = (val || '').toLowerCase().trim();
    renderMatrix();
}

function getCellValue(cell) {
    if (!cell) return null;
    const fg = cell.fg_stock || 0;
    const wip = cell.wip_qty || 0;
    const pending = cell.pending_qty || 0;

    switch (state.currentMetric) {
        case 'FG Stock':
            return fg;
        case 'WIP Qty':
            return wip;
        case 'FG+WIP Qty':
            return fg + wip;
        case 'Pending Qty':
            return pending;
        case 'BAL STOCK':
            const includedFg = state.considerFg ? fg : 0;
            const includedWip = state.considerWip ? wip : 0;
            return includedFg + includedWip - pending;
        default:
            return fg;
    }
}

function renderMatrix() {
    const thead = document.getElementById('matrix-thead');
    const tbody = document.getElementById('matrix-tbody');
    const tfoot = document.getElementById('matrix-tfoot');
    const countEl = document.getElementById('matrix-record-count');

    if (!thead || !tbody || !tfoot) return;

    thead.innerHTML = '';
    tbody.innerHTML = '';
    tfoot.innerHTML = '';

    // Active cell map depending on scope
    const activeCellMap = (state.currentScope === 'all' || !state.memberCells[state.currentScope])
        ? state.cells
        : state.memberCells[state.currentScope];

    // Filter colors based on search
    const filteredColors = state.colors.filter(c => {
        if (!state.colorSearchTerm) return true;
        const colName = (c.display_color || c.name || '').toLowerCase();
        return colName.includes(state.colorSearchTerm);
    });

    if (countEl) {
        countEl.textContent = filteredColors.length;
    }

    if (filteredColors.length === 0 || state.sizes.length === 0) {
        showEmpty();
        return;
    }
    hideEmpty();

    // 1. Build Header Row: Color | Size 1 | Size 2 | ... | TOTAL
    const headerTr = document.createElement('tr');
    
    const thColor = document.createElement('th');
    thColor.textContent = 'Color';
    thColor.style.textAlign = 'left';
    headerTr.appendChild(thColor);

    state.sizes.forEach(sz => {
        const th = document.createElement('th');
        th.textContent = sz;
        th.style.textAlign = 'right';
        headerTr.appendChild(th);
    });

    const thTotal = document.createElement('th');
    thTotal.textContent = 'TOTAL';
    thTotal.style.textAlign = 'right';
    thTotal.style.background = '#1e293b';
    thTotal.style.color = 'var(--accent-blue)';
    headerTr.appendChild(thTotal);

    thead.appendChild(headerTr);

    // 2. Build Data Rows & Column Totals
    const colTotals = {};
    state.sizes.forEach(sz => { colTotals[sz] = 0; });
    let grandTotal = 0;

    filteredColors.forEach(colObj => {
        const colName = colObj.display_color || colObj.name || '';
        const tr = document.createElement('tr');

        // Color cell
        const tdColor = document.createElement('td');
        tdColor.style.textAlign = 'left';
        tdColor.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-weight: 600; color: var(--text-primary);">${colName}</span>
            </div>
        `;
        tr.appendChild(tdColor);

        let rowTotal = 0;

        // Size cells
        state.sizes.forEach(sz => {
            const td = document.createElement('td');
            td.style.textAlign = 'right';

            const cellKey = `${colName.toLowerCase().trim()}__${sz.toLowerCase().trim()}`;
            const cell = activeCellMap[cellKey];
            const val = getCellValue(cell);

            if (val === null || val === undefined) {
                td.textContent = '-';
                td.className = 'fgv-val-zero';
            } else {
                td.textContent = Number(val).toLocaleString();
                if (val < 0) {
                    td.className = 'fgv-val-neg';
                } else if (val === 0) {
                    td.className = 'fgv-val-zero';
                } else {
                    td.className = 'fgv-val-pos';
                }
                rowTotal += val;
                colTotals[sz] += val;
            }
            tr.appendChild(td);
        });

        // Row Total Cell
        const tdRowTotal = document.createElement('td');
        tdRowTotal.style.textAlign = 'right';
        tdRowTotal.style.fontWeight = '700';
        tdRowTotal.textContent = Number(rowTotal).toLocaleString();
        if (rowTotal < 0) {
            tdRowTotal.className = 'fgv-val-neg';
        } else if (rowTotal > 0) {
            tdRowTotal.style.color = 'var(--accent-blue)';
        } else {
            tdRowTotal.className = 'fgv-val-zero';
        }
        tr.appendChild(tdRowTotal);

        grandTotal += rowTotal;
        tbody.appendChild(tr);
    });

    // 3. Build Footer Row: TOTAL | Col 1 Total | Col 2 Total | ... | Grand Total
    const footTr = document.createElement('tr');

    const tdFootLabel = document.createElement('td');
    tdFootLabel.textContent = 'TOTAL';
    tdFootLabel.style.textAlign = 'left';
    footTr.appendChild(tdFootLabel);

    state.sizes.forEach(sz => {
        const td = document.createElement('td');
        td.style.textAlign = 'right';
        const colVal = colTotals[sz] || 0;
        td.textContent = Number(colVal).toLocaleString();
        if (colVal < 0) {
            td.className = 'fgv-val-neg';
        } else if (colVal > 0) {
            td.style.color = 'var(--accent-blue)';
        } else {
            td.className = 'fgv-val-zero';
        }
        footTr.appendChild(td);
    });

    const tdGrandTotal = document.createElement('td');
    tdGrandTotal.style.textAlign = 'right';
    tdGrandTotal.style.fontWeight = '800';
    tdGrandTotal.textContent = Number(grandTotal).toLocaleString();
    if (grandTotal < 0) {
        tdGrandTotal.className = 'fgv-val-neg';
    } else {
        tdGrandTotal.style.color = '#10b981';
    }
    footTr.appendChild(tdGrandTotal);

    tfoot.appendChild(footTr);
}

function exportMatrixExcel() {
    if (typeof XLSX === 'undefined') {
        alert('SheetJS library is loading, please try again.');
        return;
    }

    const table = document.getElementById('table-matrix');
    if (!table) return;

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.table_to_sheet(table);

    const filename = `${state.entityName}_${state.currentMetric.replace(/\s+/g, '_')}_Matrix.xlsx`;
    XLSX.utils.book_append_sheet(wb, ws, "Stock Matrix");
    XLSX.writeFile(wb, filename);
}

function showLoader(show) {
    const l = document.getElementById('matrix-loader');
    if (l) l.style.display = show ? 'flex' : 'none';
}

function showError(msg) {
    const errEl = document.getElementById('matrix-error-state');
    const msgEl = document.getElementById('matrix-error-msg');
    if (msgEl) msgEl.textContent = msg || 'An error occurred while loading matrix data.';
    if (errEl) errEl.classList.remove('hidden');
}

function hideError() {
    const errEl = document.getElementById('matrix-error-state');
    if (errEl) errEl.classList.add('hidden');
}

function showEmpty() {
    const empEl = document.getElementById('matrix-empty-state');
    if (empEl) empEl.classList.remove('hidden');
}

function hideEmpty() {
    const empEl = document.getElementById('matrix-empty-state');
    if (empEl) empEl.classList.add('hidden');
}
