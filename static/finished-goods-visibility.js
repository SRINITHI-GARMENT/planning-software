/**
 * Finished Goods Visibility - Main Module Controller
 * Srinithi Garments ERP
 */

let fgvState = {
    initialized: false,
    loading: false,
    
    // Filters
    brand: '',
    category: '',
    product: '',
    color: '',
    size: '',
    search: '',
    
    // Pagination
    page: 1,
    perPage: 50,
    totalCount: 0,
    
    // Consider options
    considerFg: true,
    considerWip: true,
    
    // Cache
    rows: [],
    filterOptions: {
        brands: [],
        categories: [],
        products: [],
        colors: [],
        sizes: []
    },
    
    // Expanded common groups (keyed by rowKey)
    expandedGroups: new Set()
};

async function initializeFinishedGoodsVisibilityTab() {
    if (!fgvState.initialized) {
        fgvState.initialized = true;
        await loadFgvFilterOptions();
        await loadFgvData(true);
    }
}

async function loadFgvFilterOptions() {
    try {
        const resp = await fetch('/api/finished-goods-visibility/filter-options');
        if (!resp.ok) return;
        const res = await resp.json();
        if (res.success && res.data) {
            fgvState.filterOptions = res.data;
            populateFgvDropdowns();
        }
    } catch (e) {
        console.error('Error loading FGV filter options:', e);
    }
}

function populateFgvDropdowns() {
    const brandSel = document.getElementById('fgv-filter-brand');
    const catSel = document.getElementById('fgv-filter-category');
    const prodSel = document.getElementById('fgv-filter-product');
    const colorSel = document.getElementById('fgv-filter-color');
    const sizeSel = document.getElementById('fgv-filter-size');

    if (brandSel) {
        brandSel.innerHTML = '<option value="">All Brands</option>';
        (fgvState.filterOptions.brands || []).forEach(b => {
            const opt = document.createElement('option');
            opt.value = b;
            opt.textContent = b;
            brandSel.appendChild(opt);
        });
    }

    if (catSel) {
        catSel.innerHTML = '<option value="">All Categories</option>';
        (fgvState.filterOptions.categories || []).forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            catSel.appendChild(opt);
        });
    }

    if (prodSel) {
        prodSel.innerHTML = '<option value="">All Products / Groups</option>';
        (fgvState.filterOptions.products || []).forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = p.name;
            prodSel.appendChild(opt);
        });
    }

    if (colorSel) {
        colorSel.innerHTML = '<option value="">All Colors</option>';
        (fgvState.filterOptions.colors || []).forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            colorSel.appendChild(opt);
        });
    }

    if (sizeSel) {
        sizeSel.innerHTML = '<option value="">All Sizes</option>';
        (fgvState.filterOptions.sizes || []).forEach(s => {
            const opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s;
            sizeSel.appendChild(opt);
        });
    }
}

async function loadFgvData(resetPage = false) {
    if (resetPage) fgvState.page = 1;
    fgvShowLoader(true);

    try {
        const params = new URLSearchParams({
            brand: fgvState.brand,
            category: fgvState.category,
            product: fgvState.product,
            color: fgvState.color,
            size: fgvState.size,
            search: fgvState.search,
            page: fgvState.page,
            per_page: fgvState.perPage,
            consider_fg: fgvState.considerFg,
            consider_wip: fgvState.considerWip
        });

        const resp = await fetch(`/api/finished-goods-visibility/data?${params.toString()}`);
        if (!resp.ok) {
            throw new Error(`Server returned HTTP ${resp.status}`);
        }

        const res = await resp.json();
        if (!res.success) {
            throw new Error(res.message || 'Failed to fetch stock data');
        }

        fgvState.rows = res.rows || [];
        fgvState.totalCount = res.total_count || 0;
        
        renderFgvTable();
        renderFgvPagination();
    } catch (e) {
        console.error('Error loading Finished Goods Visibility data:', e);
        fgvShowToast(e.message, 'error');
    } finally {
        fgvShowLoader(false);
    }
}

function calculateBalStock(fg, wip, pending) {
    const includedFg = fgvState.considerFg ? (fg || 0) : 0;
    const includedWip = fgvState.considerWip ? (wip || 0) : 0;
    return includedFg + includedWip - (pending || 0);
}

function onFgvConsiderChange() {
    const cbFg = document.getElementById('fgv-consider-fg');
    const cbWip = document.getElementById('fgv-consider-wip');
    
    fgvState.considerFg = cbFg ? cbFg.checked : true;
    fgvState.considerWip = cbWip ? cbWip.checked : true;

    // Immediately recalculate visible table without re-fetching
    recalculateVisibleBalStock();
}

function recalculateVisibleBalStock() {
    const rows = document.querySelectorAll('#fgv-table-tbody tr[data-row-index]');
    rows.forEach(tr => {
        const idx = parseInt(tr.getAttribute('data-row-index'));
        const row = fgvState.rows[idx];
        if (!row) return;

        const balCell = tr.querySelector('.fgv-bal-stock-cell');
        if (balCell) {
            const bal = calculateBalStock(row.fg_stock, row.wip_qty, row.pending_qty);
            balCell.textContent = Number(bal).toLocaleString();
            if (bal < 0) {
                balCell.className = 'fgv-bal-stock-cell text-right font-bold text-red-500';
            } else if (bal > 0) {
                balCell.className = 'fgv-bal-stock-cell text-right font-bold text-emerald-400';
            } else {
                balCell.className = 'fgv-bal-stock-cell text-right text-muted';
            }
        }
    });

    // Also recalculate expanded member rows
    const memberRows = document.querySelectorAll('.fgv-member-row');
    memberRows.forEach(tr => {
        const fg = parseFloat(tr.getAttribute('data-fg') || 0);
        const wip = parseFloat(tr.getAttribute('data-wip') || 0);
        const po = parseFloat(tr.getAttribute('data-po') || 0);
        const balCell = tr.querySelector('.fgv-bal-stock-cell');
        if (balCell) {
            const bal = calculateBalStock(fg, wip, po);
            balCell.textContent = Number(bal).toLocaleString();
            if (bal < 0) {
                balCell.className = 'fgv-bal-stock-cell text-right font-bold text-red-500';
            } else if (bal > 0) {
                balCell.className = 'fgv-bal-stock-cell text-right font-bold text-emerald-400';
            } else {
                balCell.className = 'fgv-bal-stock-cell text-right text-muted';
            }
        }
    });
}

function renderFgvTable() {
    const tbody = document.getElementById('fgv-table-tbody');
    const emptyState = document.getElementById('fgv-empty-state');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!fgvState.rows || fgvState.rows.length === 0) {
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }
    if (emptyState) emptyState.classList.add('hidden');

    fgvState.rows.forEach((r, idx) => {
        const isCommon = r.entity_type === 'common';
        const rowKey = `${r.id}__${r.color || ''}__${r.size || ''}`;
        const isExpanded = fgvState.expandedGroups.has(rowKey);
        const bal = calculateBalStock(r.fg_stock, r.wip_qty, r.pending_qty);

        const tr = document.createElement('tr');
        tr.setAttribute('data-row-index', idx);
        tr.setAttribute('data-row-key', rowKey);
        tr.className = isCommon ? 'fgv-group-row' : 'fgv-standalone-row';
        if (isCommon) {
            tr.style.background = 'rgba(139, 92, 246, 0.04)';
        }

        // 1. Details column
        const tdDetails = document.createElement('td');
        tdDetails.className = 'text-center';
        if (isCommon) {
            tdDetails.innerHTML = `
                <button class="fgv-expand-btn btn-icon" onclick="toggleCommonGroup('${encodeURIComponent(rowKey)}', ${idx})" title="Expand / Collapse Member Products"
                    style="width: 24px; height: 24px; border-radius: 4px; background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.3); color: #c4b5fd; cursor: pointer;">
                    <i class="fa-solid ${isExpanded ? 'fa-chevron-down' : 'fa-chevron-right'}"></i>
                </button>
            `;
        } else {
            tdDetails.textContent = '-';
            tdDetails.className = 'text-center text-muted';
        }
        tr.appendChild(tdDetails);

        // 2. Brand
        const tdBrand = document.createElement('td');
        tdBrand.textContent = isCommon ? '-' : (r.brand || '-');
        if (isCommon) tdBrand.className = 'text-muted';
        tr.appendChild(tdBrand);

        // 3. Category
        const tdCategory = document.createElement('td');
        tdCategory.textContent = r.category || '-';
        tr.appendChild(tdCategory);

        // 4. Product / Common Group (CLICKABLE NEW TAB)
        const tdProduct = document.createElement('td');
        const entityName = isCommon ? r.common_production_name : r.product_name;
        const link = document.createElement('a');
        link.href = '#';
        link.className = 'fgv-product-link';
        link.style.color = isCommon ? '#a78bfa' : 'var(--accent-blue)';
        link.style.fontWeight = '600';
        link.style.textDecoration = 'none';
        link.innerHTML = `
            <span>${entityName}</span>
            <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 10px; margin-left: 5px; opacity: 0.7;"></i>
        `;
        link.onclick = (e) => {
            e.preventDefault();
            openStockMatrixNewTab(r.entity_type, r.id, entityName);
        };
        tdProduct.appendChild(link);
        tr.appendChild(tdProduct);

        // 5. Fabric Name
        const tdFabric = document.createElement('td');
        tdFabric.textContent = r.fabric_name || '-';
        tr.appendChild(tdFabric);

        // 6. Color
        const tdColor = document.createElement('td');
        tdColor.textContent = r.color || '-';
        tdColor.style.fontWeight = '500';
        tr.appendChild(tdColor);

        // 7. Size
        const tdSize = document.createElement('td');
        tdSize.textContent = r.size || '-';
        tdSize.style.fontWeight = '500';
        tr.appendChild(tdSize);

        // 8. FG Stock
        const tdFg = document.createElement('td');
        tdFg.className = 'text-right font-medium';
        tdFg.textContent = Number(r.fg_stock || 0).toLocaleString();
        tr.appendChild(tdFg);

        // 9. WIP Qty
        const tdWip = document.createElement('td');
        tdWip.className = 'text-right font-medium';
        tdWip.textContent = Number(r.wip_qty || 0).toLocaleString();
        tr.appendChild(tdWip);

        // 10. Pending Qty
        const tdPending = document.createElement('td');
        tdPending.className = 'text-right font-medium';
        tdPending.textContent = Number(r.pending_qty || 0).toLocaleString();
        tr.appendChild(tdPending);

        // 11. BAL STOCK
        const tdBal = document.createElement('td');
        tdBal.className = 'fgv-bal-stock-cell text-right font-bold';
        tdBal.textContent = Number(bal).toLocaleString();
        if (bal < 0) {
            tdBal.className += ' text-red-500';
        } else if (bal > 0) {
            tdBal.className += ' text-emerald-400';
        } else {
            tdBal.className += ' text-muted';
        }
        tr.appendChild(tdBal);

        tbody.appendChild(tr);

        // If expanded, render member rows
        if (isCommon && isExpanded && r.members) {
            renderExpandedMemberRows(tbody, r, idx);
        }
    });
}

function renderExpandedMemberRows(tbody, groupRow, groupIdx) {
    if (!groupRow.members || groupRow.members.length === 0) return;

    groupRow.members.forEach((m) => {
        const memBal = calculateBalStock(m.fg_stock, m.wip_qty, m.pending_qty);
        const memTr = document.createElement('tr');
        memTr.className = 'fgv-member-row';
        memTr.setAttribute('data-parent-key', `${groupRow.id}__${groupRow.color || ''}__${groupRow.size || ''}`);
        memTr.setAttribute('data-fg', m.fg_stock || 0);
        memTr.setAttribute('data-wip', m.wip_qty || 0);
        memTr.setAttribute('data-po', m.pending_qty || 0);
        memTr.style.background = 'rgba(255, 255, 255, 0.02)';
        memTr.style.borderLeft = '3px solid #8b5cf6';

        // 1. Details: indentation
        const tdDetails = document.createElement('td');
        tdDetails.className = 'text-center text-muted';
        tdDetails.innerHTML = '<i class="fa-solid fa-arrow-turn-up fa-rotate-90" style="color: #8b5cf6; font-size: 10px;"></i>';
        memTr.appendChild(tdDetails);

        // 2. Brand
        const tdBrand = document.createElement('td');
        tdBrand.textContent = m.brand || '-';
        tdBrand.style.fontWeight = '600';
        memTr.appendChild(tdBrand);

        // 3. Category
        const tdCat = document.createElement('td');
        tdCat.textContent = m.category || '-';
        memTr.appendChild(tdCat);

        // 4. Product Name (Clickable New Tab for Member Product)
        const tdProd = document.createElement('td');
        const link = document.createElement('a');
        link.href = '#';
        link.style.color = 'var(--text-primary)';
        link.style.textDecoration = 'none';
        link.innerHTML = `
            <span>${m.product_name}</span>
            <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 9px; margin-left: 4px; opacity: 0.6;"></i>
        `;
        link.onclick = (e) => {
            e.preventDefault();
            openStockMatrixNewTab('standalone', m.id, m.product_name);
        };
        tdProd.appendChild(link);
        memTr.appendChild(tdProd);

        // 5. Fabric Name
        const tdFab = document.createElement('td');
        tdFab.textContent = m.fabric_name || groupRow.fabric_name || '-';
        memTr.appendChild(tdFab);

        // 6. Color
        const tdCol = document.createElement('td');
        tdCol.textContent = groupRow.color || '-';
        memTr.appendChild(tdCol);

        // 7. Size
        const tdSz = document.createElement('td');
        tdSz.textContent = groupRow.size || '-';
        memTr.appendChild(tdSz);

        // 8. FG Stock
        const tdFg = document.createElement('td');
        tdFg.className = 'text-right';
        tdFg.textContent = Number(m.fg_stock || 0).toLocaleString();
        memTr.appendChild(tdFg);

        // 9. WIP Qty
        const tdWip = document.createElement('td');
        tdWip.className = 'text-right text-muted';
        tdWip.textContent = Number(m.wip_qty || 0).toLocaleString();
        memTr.appendChild(tdWip);

        // 10. Pending Qty
        const tdPo = document.createElement('td');
        tdPo.className = 'text-right';
        tdPo.textContent = Number(m.pending_qty || 0).toLocaleString();
        memTr.appendChild(tdPo);

        // 11. BAL STOCK
        const tdBal = document.createElement('td');
        tdBal.className = 'fgv-bal-stock-cell text-right font-semibold';
        tdBal.textContent = Number(memBal).toLocaleString();
        if (memBal < 0) {
            tdBal.className += ' text-red-500';
        } else if (memBal > 0) {
            tdBal.className += ' text-emerald-400';
        } else {
            tdBal.className += ' text-muted';
        }
        memTr.appendChild(tdBal);

        tbody.appendChild(memTr);
    });
}

async function toggleCommonGroup(rawRowKey, rowIdx) {
    const rowKey = decodeURIComponent(rawRowKey);
    if (fgvState.expandedGroups.has(rowKey)) {
        fgvState.expandedGroups.delete(rowKey);
        renderFgvTable();
        return;
    }

    const row = fgvState.rows[rowIdx];
    if (!row) return;

    // Fetch members if not already attached
    if (!row.members) {
        try {
            const params = new URLSearchParams({
                common_production_id: row.id,
                name: row.common_production_name,
                color: row.color || '',
                size: row.size || ''
            });
            const resp = await fetch(`/api/finished-goods-visibility/members?${params.toString()}`);
            if (resp.ok) {
                const res = await resp.json();
                if (res.success) {
                    row.members = res.members || [];
                }
            }
        } catch (e) {
            console.error('Error fetching common group members:', e);
        }
    }

    fgvState.expandedGroups.add(rowKey);
    renderFgvTable();
}

function openStockMatrixNewTab(entityType, id, name) {
    const url = `/finished-goods-visibility-detail?entity_type=${encodeURIComponent(entityType)}&id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}&consider_fg=${fgvState.considerFg}&consider_wip=${fgvState.considerWip}`;
    window.open(url, '_blank');
}

function onFgvFilterChange() {
    fgvState.brand = document.getElementById('fgv-filter-brand')?.value || '';
    fgvState.category = document.getElementById('fgv-filter-category')?.value || '';
    fgvState.product = document.getElementById('fgv-filter-product')?.value || '';
    fgvState.color = document.getElementById('fgv-filter-color')?.value || '';
    fgvState.size = document.getElementById('fgv-filter-size')?.value || '';
    loadFgvData(true);
}

function onFgvSearchInput(val) {
    fgvState.search = (val || '').trim();
    loadFgvData(true);
}

function renderFgvPagination() {
    const infoEl = document.getElementById('fgv-pagination-info');
    const prevBtn = document.getElementById('fgv-btn-prev');
    const nextBtn = document.getElementById('fgv-btn-next');

    const totalPages = Math.ceil(fgvState.totalCount / fgvState.perPage) || 1;
    const start = fgvState.totalCount === 0 ? 0 : (fgvState.page - 1) * fgvState.perPage + 1;
    const end = Math.min(fgvState.page * fgvState.perPage, fgvState.totalCount);

    if (infoEl) {
        infoEl.textContent = `Showing ${start} - ${end} of ${fgvState.totalCount.toLocaleString()} items (Page ${fgvState.page} of ${totalPages})`;
    }

    if (prevBtn) prevBtn.disabled = fgvState.page <= 1;
    if (nextBtn) nextBtn.disabled = fgvState.page >= totalPages;
}

function fgvChangePage(delta) {
    const totalPages = Math.ceil(fgvState.totalCount / fgvState.perPage) || 1;
    const newPage = fgvState.page + delta;
    if (newPage >= 1 && newPage <= totalPages) {
        fgvState.page = newPage;
        loadFgvData(false);
    }
}

function exportFgvExcel() {
    if (typeof XLSX === 'undefined') {
        alert('SheetJS library is loading, please try again.');
        return;
    }

    const table = document.getElementById('fgv-table');
    if (!table) return;

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.table_to_sheet(table);

    XLSX.utils.book_append_sheet(wb, ws, "Finished Goods Visibility");
    XLSX.writeFile(wb, "Finished_Goods_Visibility.xlsx");
}

function fgvShowLoader(show) {
    const l = document.getElementById('fgv-loader');
    if (l) l.style.display = show ? 'flex' : 'none';
}

function fgvShowToast(msg, type = 'info') {
    if (typeof showToast === 'function') {
        showToast(msg, type);
    } else {
        alert(msg);
    }
}
