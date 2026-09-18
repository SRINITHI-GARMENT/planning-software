function showToast(title, message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `notification ${type}`;
    toast.style.pointerEvents = 'auto';
    toast.style.minWidth = '300px';
    toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
    toast.style.margin = '0';
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-20px)';

    let iconClass = 'fa-circle-info';
    if (type === 'success') iconClass = 'fa-circle-check';
    if (type === 'error') iconClass = 'fa-circle-exclamation';
    if (type === 'warning') iconClass = 'fa-triangle-exclamation';

    toast.innerHTML = `
        <div class="icon"><i class="fa-solid ${iconClass}"></i></div>
        <div style="flex-grow: 1;">
            <div style="font-weight: 700; font-size: 13px; text-align: left;">${title}</div>
            <div class="message" style="font-size: 12px; margin-top: 2px; text-align: left; opacity: 0.9;">${message}</div>
        </div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    }, 10);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 4000);
}

// App State
let appState = {
    isAuthenticated: false,
    username: '',
    currentPage: 1,
    pageSize: 20,
    sortBy: 'MONTH',
    sortDir: 'DESC',
    filters: {
        search: '',
        brand: '',
        status: '',
        size: ''
    },
    loadedRecords: {}, // Memory map to cache current page's records

    // Quantity Planning State
    plans: [],
    currentPlan: null,
    currentPlanDetails: [],
    originalPlanDetails: [], // Reference for cell change highlighting
    selectedScenarios: [], // Plan IDs selected for comparison
    selectedPlanningMethod: 1,

    // Sales Contribution state
    contribGroupBy: 'product',
    selectedContribProducts: [],
    selectedContribColors: [],
    selectedContribBrands: [],
    selectedContribBrand: null,
    selectedContribDescriptions: [],
    selectedContribDescription: null,
    selectedContribTypes: [],
    selectedContribType: null,
    contribFilters: {
        months: [],
        brands: [],
        descriptions: [],
        types: [],
        statuses: [],
        sizes: []
    }
};

// Global Chart Instances
let trendChart = null;
let brandChart = null;
let statusChart = null;
let comparisonChart = null;

// Debounce timer for search
let searchDebounceTimer = null;

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    initAIAssistant();
});

// Check Session on Start
async function checkSession() {
    showLoader(true, "Connecting to Cloud DB...");
    try {
        const response = await fetch('/api/auth/session');
        const data = await response.json();

        if (data.authenticated) {
            appState.isAuthenticated = true;
            appState.username = data.username;
            document.getElementById('display-username').textContent = data.username;
            showView('dashboard');
            await loadDashboardData();
        } else {
            appState.isAuthenticated = false;
            showView('auth');
        }
    } catch (error) {
        console.error("Session check failed:", error);
        showView('auth');
        showAuthNotification("Could not connect to server. Please ensure backend is running.", "error");
    } finally {
        showLoader(false);
    }
}

// Show/Hide loader overlay
function showLoader(show, text = "") {
    const loader = document.getElementById('global-loader');
    const appEl = document.getElementById('app');
    if (show) {
        loader.classList.remove('hidden');
        if (text) {
            loader.querySelector('p').textContent = text;
        }
        appEl.classList.add('loading');
    } else {
        loader.classList.add('hidden');
        appEl.classList.remove('loading');
    }
}

// Switch between views
function showView(viewName) {
    const authView = document.getElementById('auth-view');
    const dashboardView = document.getElementById('dashboard-view');

    if (viewName === 'auth') {
        authView.classList.remove('hidden');
        dashboardView.classList.add('hidden');
    } else if (viewName === 'dashboard') {
        authView.classList.add('hidden');
        dashboardView.classList.remove('hidden');
    }
}

// Toggle Login / Register Tabs
function switchAuthTab(tab) {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');

    hideAuthNotification();

    if (tab === 'login') {
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
        tabLogin.classList.add('active');
        tabRegister.classList.remove('active');
    } else {
        loginForm.classList.add('hidden');
        registerForm.classList.remove('hidden');
        tabLogin.classList.remove('active');
        tabRegister.classList.add('active');
    }
}

// Show Auth Alert Notifications
function showAuthNotification(message, type) {
    const notification = document.getElementById('auth-notification');
    const msgSpan = notification.querySelector('.message');
    const icon = notification.querySelector('.icon');

    msgSpan.textContent = message;
    notification.className = `notification ${type}`;

    if (type === 'success') {
        icon.className = "fa-solid fa-circle-check icon";
    } else {
        icon.className = "fa-solid fa-circle-exclamation icon";
    }
}

function hideAuthNotification() {
    document.getElementById('auth-notification').classList.add('hidden');
}

// Handle Login Form Submit
async function handleLogin(e) {
    e.preventDefault();
    hideAuthNotification();

    const usernameInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
        showAuthNotification("All fields are required.", "error");
        return;
    }

    showLoader(true, "Logging in...");

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            appState.isAuthenticated = true;
            appState.username = username;
            document.getElementById('display-username').textContent = username;

            // Clear inputs
            usernameInput.value = '';
            passwordInput.value = '';

            showView('dashboard');
            await loadDashboardData();
        } else {
            showAuthNotification(data.message || "Invalid credentials.", "error");
        }
    } catch (error) {
        showAuthNotification("Connection lost. Try again.", "error");
    } finally {
        showLoader(false);
    }
}

// Handle Register Form Submit
async function handleRegister(e) {
    e.preventDefault();
    hideAuthNotification();

    const usernameInput = document.getElementById('register-username');
    const passwordInput = document.getElementById('register-password');
    const confirmInput = document.getElementById('register-confirm-password');

    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    const confirmPassword = confirmInput.value;

    if (!username || !password || !confirmPassword) {
        showAuthNotification("All fields are required.", "error");
        return;
    }

    if (password !== confirmPassword) {
        showAuthNotification("Passwords do not match.", "error");
        return;
    }

    showLoader(true, "Registering...");

    try {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showAuthNotification("Account created! Please log in above.", "success");
            switchAuthTab('login');
            // Populate login field with username
            document.getElementById('login-username').value = username;

            // Clear inputs
            usernameInput.value = '';
            passwordInput.value = '';
            confirmInput.value = '';
        } else {
            showAuthNotification(data.message || "Registration failed.", "error");
        }
    } catch (error) {
        showAuthNotification("Connection lost. Try again.", "error");
    } finally {
        showLoader(false);
    }
}

// Handle Logout
async function handleLogout() {
    showLoader(true, "Logging out...");
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
        appState.isAuthenticated = false;
        appState.username = '';
        showView('auth');
    } catch (error) {
        console.error("Logout failed:", error);
    } finally {
        showLoader(false);
    }
}

// Load All Dashboard Data (KPIs, Charts, Table Dropdowns)
async function loadDashboardData() {
    try {
        const response = await fetch('/api/sales/summary');
        const data = await response.json();

        if (response.ok && data.success) {
            // 1. Populate KPI stats
            document.getElementById('kpi-total-qty').textContent = data.summary.total_qty.toLocaleString();
            document.getElementById('kpi-total-brands').textContent = data.summary.total_brands;
            document.getElementById('kpi-running-products').textContent = data.summary.running_products;
            document.getElementById('kpi-total-products').textContent = data.summary.total_products;

            // 2. Populate filters lists
            populateFilterOptions('filter-brand', data.filters.brands, "All Brands");
            populateFilterOptions('filter-size', data.filters.sizes, "All Sizes");

            // 3. Render charts
            renderCharts(data.charts);

            // 4. Load table records
            await fetchTableData();
        } else if (response.status === 401) {
            handleLogout();
        } else {
            console.error("Failed to load summary stats:", data.message);
        }
    } catch (error) {
        console.error("Error loading dashboard data:", error);
    }
}

// Populate Dropdown Options
function populateFilterOptions(elementId, items, defaultLabel) {
    const dropdown = document.getElementById(elementId);
    const currentValue = dropdown.value;

    dropdown.innerHTML = `<option value="">${defaultLabel}</option>`;
    items.forEach(item => {
        const option = document.createElement('option');
        option.value = item;
        option.textContent = item;
        dropdown.appendChild(option);
    });

    // Restore value if still present in options
    if (items.includes(currentValue)) {
        dropdown.value = currentValue;
    }
}

// Render Dashboard Analytics Charts
function renderCharts(chartsData) {
    Chart.defaults.color = '#9ca3af';
    Chart.defaults.font.family = 'Plus Jakarta Sans';

    // 1. Line Chart: Monthly Trend
    const trendCtx = document.getElementById('trendChart').getContext('2d');
    if (trendChart) trendChart.destroy();

    const gradient = trendCtx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.4)');
    gradient.addColorStop(1, 'rgba(139, 92, 246, 0.02)');

    trendChart = new Chart(trendCtx, {
        type: 'line',
        data: {
            labels: chartsData.monthly_trend.map(item => item.label),
            datasets: [{
                label: 'Qty Sold',
                data: chartsData.monthly_trend.map(item => item.value),
                borderColor: '#3b82f6',
                borderWidth: 3,
                fill: true,
                backgroundColor: gradient,
                tension: 0.4,
                pointBackgroundColor: '#8b5cf6',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { callback: val => val.toLocaleString() }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });

    // 2. Doughnut Chart: Brand Distribution
    const brandCtx = document.getElementById('brandChart').getContext('2d');
    if (brandChart) brandChart.destroy();

    const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#6366f1', '#14b8a6', '#f43f5e', '#a855f7'];

    brandChart = new Chart(brandCtx, {
        type: 'doughnut',
        data: {
            labels: chartsData.brand_distribution.map(item => item.brand),
            datasets: [{
                data: chartsData.brand_distribution.map(item => item.value),
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: '#111827'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { boxWidth: 12, padding: 12 }
                }
            },
            cutout: '65%'
        }
    });

    // 3. Bar Chart: Status Distribution
    const statusCtx = document.getElementById('statusChart').getContext('2d');
    if (statusChart) statusChart.destroy();

    statusChart = new Chart(statusCtx, {
        type: 'bar',
        data: {
            labels: chartsData.status_distribution.map(item => item.status),
            datasets: [{
                data: chartsData.status_distribution.map(item => item.value),
                backgroundColor: chartsData.status_distribution.map(item =>
                    item.status.trim() === 'RUNNING' ? 'rgba(16, 185, 129, 0.75)' : 'rgba(239, 68, 68, 0.75)'
                ),
                borderColor: chartsData.status_distribution.map(item =>
                    item.status.trim() === 'RUNNING' ? '#10b981' : '#ef4444'
                ),
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { callback: val => val.toLocaleString() }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });

    // Populate Status pill list
    const summaryCards = document.getElementById('status-summary-cards');
    summaryCards.innerHTML = '';

    chartsData.status_distribution.forEach(item => {
        const isRunning = item.status.trim() === 'RUNNING';
        const indicatorClass = isRunning ? 'status-running' : 'status-stopped';

        const card = document.createElement('div');
        card.className = 'status-pill';
        card.innerHTML = `
            <div class="status-pill-info">
                <span class="status-indicator ${indicatorClass}"></span>
                <span class="status-pill-name">${item.status}</span>
            </div>
            <span class="status-pill-value">${item.value.toLocaleString()} Qty</span>
        `;
        summaryCards.appendChild(card);
    });
}

// Fetch Paginated & Filtered Table Data
async function fetchTableData() {
    showTableLoader(true);

    // Build query params
    const params = new URLSearchParams({
        page: appState.currentPage,
        per_page: appState.pageSize,
        sort_by: appState.sortBy,
        sort_dir: appState.sortDir
    });

    if (appState.filters.search) params.append('search', appState.filters.search);
    if (appState.filters.brand) params.append('brand', appState.filters.brand);
    if (appState.filters.status) params.append('status', appState.filters.status);
    if (appState.filters.size) params.append('size', appState.filters.size);

    try {
        const response = await fetch(`/api/sales?${params.toString()}`);
        const data = await response.json();

        if (response.ok && data.success) {
            // Cache records by id for fast edit lookup
            appState.loadedRecords = {};
            data.data.forEach(rec => {
                appState.loadedRecords[rec.id] = rec;
            });

            renderTableRows(data.data);
            renderPagination(data.pagination);
        } else {
            console.error("Error loading table data:", data.message);
        }
    } catch (error) {
        console.error("Table fetch failed:", error);
    } finally {
        showTableLoader(false);
    }
}

// Show/Hide table loadings
function showTableLoader(show) {
    const loader = document.getElementById('table-loader');
    if (show) {
        loader.classList.remove('hidden');
    } else {
        loader.classList.add('hidden');
    }
}

// Render Table Rows
function renderTableRows(records) {
    const tbody = document.getElementById('sales-table-body');
    const emptyOverlay = document.getElementById('table-empty');

    tbody.innerHTML = '';

    if (records.length === 0) {
        emptyOverlay.classList.remove('hidden');
        return;
    }

    emptyOverlay.classList.add('hidden');

    records.forEach(row => {
        // Format Month
        let formattedDate = row.MONTH;
        if (formattedDate) {
            try {
                const dateObj = new Date(formattedDate);
                formattedDate = dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
            } catch (err) {
                // keep iso format if fails
            }
        }

        const isRunning = row.PRODUCT_STATUS && row.PRODUCT_STATUS.trim() === 'RUNNING';
        const badgeClass = isRunning ? 'running' : 'stopped';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${formattedDate || 'N/A'}</td>
            <td><strong>${row.BRAND || 'N/A'}</strong></td>
            <td><code>${row.product || 'N/A'}</code></td>
            <td>${row.PRODUCT_DES || 'N/A'}</td>
            <td>${row.Color || 'N/A'}</td>
            <td>${row.Size || 'N/A'}</td>
            <td><span class="table-badge ${badgeClass}">${row.PRODUCT_STATUS || 'N/A'}</span></td>
            <td class="text-right"><strong>${row.Qty.toLocaleString()}</strong></td>
            <td>
                <div class="actions-cell">
                    <button class="btn-action btn-edit" onclick="openEditModal(${row.id})" title="Edit Record">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button class="btn-action btn-delete" onclick="deleteRecord(${row.id})" title="Delete Record">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Render Pagination Controls
function renderPagination(pageInfo) {
    const controls = document.getElementById('pagination-controls');
    controls.innerHTML = '';

    const rangeSpan = document.getElementById('records-range');
    const totalSpan = document.getElementById('records-total');

    const startRecord = pageInfo.total_records === 0 ? 0 : (pageInfo.page - 1) * pageInfo.per_page + 1;
    const endRecord = Math.min(pageInfo.page * pageInfo.per_page, pageInfo.total_records);

    rangeSpan.textContent = `${startRecord}-${endRecord}`;
    totalSpan.textContent = pageInfo.total_records;

    if (pageInfo.total_pages <= 1) return;

    // Previous button
    const prevBtn = document.createElement('button');
    prevBtn.className = 'page-btn';
    prevBtn.innerHTML = '<i class="fa-solid fa-angle-left"></i>';
    prevBtn.disabled = pageInfo.page === 1;
    prevBtn.onclick = () => {
        appState.currentPage--;
        fetchTableData();
    };
    controls.appendChild(prevBtn);

    // Page buttons (smart pagination, max 5 visible)
    let startPage = Math.max(1, pageInfo.page - 2);
    let endPage = Math.min(pageInfo.total_pages, startPage + 4);

    if (endPage - startPage < 4) {
        startPage = Math.max(1, endPage - 4);
    }

    for (let i = startPage; i <= endPage; i++) {
        const btn = document.createElement('button');
        btn.className = `page-btn ${i === pageInfo.page ? 'active' : ''}`;
        btn.textContent = i;
        btn.onclick = () => {
            appState.currentPage = i;
            fetchTableData();
        };
        controls.appendChild(btn);
    }

    // Next button
    const nextBtn = document.createElement('button');
    nextBtn.className = 'page-btn';
    nextBtn.innerHTML = '<i class="fa-solid fa-angle-right"></i>';
    nextBtn.disabled = pageInfo.page === pageInfo.total_pages;
    nextBtn.onclick = () => {
        appState.currentPage++;
        fetchTableData();
    };
    controls.appendChild(nextBtn);
}

// Table Sorting Handlers
function handleSort(colName) {
    const indicators = document.querySelectorAll('.sort-indicator');
    indicators.forEach(ind => {
        ind.className = 'fa-solid fa-sort sort-indicator';
    });

    if (appState.sortBy === colName) {
        // Toggle direction
        appState.sortDir = appState.sortDir === 'ASC' ? 'DESC' : 'ASC';
    } else {
        appState.sortBy = colName;
        appState.sortDir = 'DESC'; // default to DESC for new column
    }

    // Update visual direction icon on clicked header
    const headers = document.querySelectorAll('th.sortable');
    headers.forEach(h => {
        const onclickAttr = h.getAttribute('onclick');
        if (onclickAttr && onclickAttr.includes(colName)) {
            const icon = h.querySelector('i');
            if (appState.sortDir === 'ASC') {
                icon.className = 'fa-solid fa-sort-up sort-indicator';
                icon.style.color = '#3b82f6';
            } else {
                icon.className = 'fa-solid fa-sort-down sort-indicator';
                icon.style.color = '#3b82f6';
            }
        }
    });

    appState.currentPage = 1;
    fetchTableData();
}

// Filter Event Handlers
function applyFilters() {
    appState.filters.brand = document.getElementById('filter-brand').value;
    appState.filters.status = document.getElementById('filter-status').value;
    appState.filters.size = document.getElementById('filter-size').value;
    appState.currentPage = 1;
    fetchTableData();
}

// Debounced filter for search input to prevent database spamming
function debounceFilter() {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        appState.filters.search = document.getElementById('filter-search').value.trim();
        appState.currentPage = 1;
        fetchTableData();
    }, 300);
}

// Reset Filters
function resetFilters() {
    document.getElementById('filter-search').value = '';
    document.getElementById('filter-brand').value = '';
    document.getElementById('filter-status').value = '';
    document.getElementById('filter-size').value = '';

    appState.filters = { search: '', brand: '', status: '', size: '' };
    appState.currentPage = 1;
    fetchTableData();
}

// Change Items Per Page Size
function changePageSize() {
    appState.pageSize = parseInt(document.getElementById('page-size-select').value);
    appState.currentPage = 1;
    fetchTableData();
}

// Export Filtered data to CSV File
async function exportCSV() {
    showLoader(true, "Generating CSV Export...");

    const params = new URLSearchParams();
    if (appState.filters.search) params.append('search', appState.filters.search);
    if (appState.filters.brand) params.append('brand', appState.filters.brand);
    if (appState.filters.status) params.append('status', appState.filters.status);
    if (appState.filters.size) params.append('size', appState.filters.size);

    try {
        const response = await fetch(`/api/sales/export?${params.toString()}`);
        const data = await response.json();

        if (response.ok && data.success) {
            const records = data.data;
            if (records.length === 0) {
                alert("No records to export.");
                return;
            }

            // Format CSV header and rows
            const csvRows = [];
            const headers = ['Date', 'Brand', 'Product Code', 'Description', 'Product Type', 'Color', 'Size', 'Product Status', 'Qty'];
            csvRows.push(headers.join(','));

            records.forEach(row => {
                const values = [
                    row.MONTH ? row.MONTH.split('T')[0] : '',
                    escapeCSVValue(row.BRAND),
                    escapeCSVValue(row.product),
                    escapeCSVValue(row.PRODUCT_DES),
                    escapeCSVValue(row.PRODUCT_TYPE),
                    escapeCSVValue(row.Color),
                    escapeCSVValue(row.Size),
                    escapeCSVValue(row.PRODUCT_STATUS),
                    row.Qty
                ];
                csvRows.push(values.join(','));
            });

            const csvString = csvRows.join('\n');
            const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');

            link.setAttribute('href', url);

            // Generate filename with current filter info
            let filterName = 'all';
            if (appState.filters.brand) filterName = appState.filters.brand.replace(/\s+/g, '_').toLowerCase();
            const timestamp = new Date().toISOString().split('T')[0];

            link.setAttribute('download', `srinithi_sales_${filterName}_${timestamp}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } else {
            alert("Error fetching export data: " + (data.message || 'Unknown error'));
        }
    } catch (error) {
        console.error("Export failed:", error);
        alert("Failed to export sales data.");
    } finally {
        showLoader(false);
    }
}

// Utility to escape CSV fields
function escapeCSVValue(val) {
    if (val === undefined || val === null) return '""';
    let str = String(val).trim();
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        str = str.replace(/"/g, '""');
        return `"${str}"`;
    }
    return str;
}

// Open Edit Record Modal
function openEditModal(recordId) {
    const record = appState.loadedRecords[recordId];
    if (!record) {
        alert("Record data not found.");
        return;
    }

    // Fill the form inputs
    document.getElementById('edit-record-id').value = recordId;

    // Date formatting (expects YYYY-MM-DD for input type="date")
    let rawDate = record.MONTH;
    if (rawDate && rawDate.includes('T')) {
        rawDate = rawDate.split('T')[0];
    }
    document.getElementById('edit-date').value = rawDate || '';

    document.getElementById('edit-brand').value = record.BRAND || '';
    document.getElementById('edit-product-code').value = record.product || '';
    document.getElementById('edit-description').value = record.PRODUCT_DES || '';
    document.getElementById('edit-product-type').value = record.PRODUCT_TYPE || '';
    document.getElementById('edit-color').value = record.Color || '';
    document.getElementById('edit-size').value = record.Size || '';
    document.getElementById('edit-status').value = (record.PRODUCT_STATUS || '').trim() || 'RUNNING';
    document.getElementById('edit-qty').value = record.Qty || 0;

    // Clear notification and show modal
    hideModalNotification();
    document.getElementById('edit-modal').classList.remove('hidden');
}

// Close Edit Modal
function closeEditModal() {
    document.getElementById('edit-modal').classList.add('hidden');
    document.getElementById('edit-record-form').reset();
    hideModalNotification();
}

// Show/Hide Modal Toast alerts
function showModalNotification(message, type) {
    const notification = document.getElementById('modal-notification');
    const msgSpan = notification.querySelector('.message');
    const icon = notification.querySelector('.icon');

    msgSpan.textContent = message;
    notification.className = `notification ${type}`;

    if (type === 'success') {
        icon.className = "fa-solid fa-circle-check icon";
    } else {
        icon.className = "fa-solid fa-circle-exclamation icon";
    }
    notification.classList.remove('hidden');
}

function hideModalNotification() {
    document.getElementById('modal-notification').classList.add('hidden');
}

// Save Changes via PUT API
async function saveRecordEdit(e) {
    e.preventDefault();
    hideModalNotification();

    const recordId = document.getElementById('edit-record-id').value;
    const qtyVal = document.getElementById('edit-qty').value;

    const updatedData = {
        MONTH: document.getElementById('edit-date').value,
        BRAND: document.getElementById('edit-brand').value.trim(),
        product: document.getElementById('edit-product-code').value.trim(),
        PRODUCT_DES: document.getElementById('edit-description').value.trim(),
        PRODUCT_TYPE: document.getElementById('edit-product-type').value.trim(),
        Color: document.getElementById('edit-color').value.trim(),
        Size: document.getElementById('edit-size').value.trim(),
        PRODUCT_STATUS: document.getElementById('edit-status').value,
        Qty: parseInt(qtyVal)
    };

    if (!updatedData.BRAND || !updatedData.product) {
        showModalNotification("Brand and Product Code are required.", "error");
        return;
    }

    if (isNaN(updatedData.Qty) || updatedData.Qty < 0) {
        showModalNotification("Quantity must be a positive number.", "error");
        return;
    }

    const submitBtn = document.querySelector('#edit-record-form button[type="submit"]');
    const origText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

    try {
        const response = await fetch(`/api/sales/${recordId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedData)
        });

        const data = await response.json();

        if (response.ok && data.success) {
            closeEditModal();
            // Refresh dashboard KPIs & charts, and load updated table records
            await loadDashboardData();
        } else {
            showModalNotification(data.message || "Failed to update record.", "error");
        }
    } catch (error) {
        showModalNotification("Connection lost. Try again.", "error");
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = origText;
    }
}

// Delete Record via DELETE API
async function deleteRecord(recordId) {
    const record = appState.loadedRecords[recordId];
    const brand = record ? record.BRAND : 'this';
    const code = record ? record.product : '';

    if (!confirm(`Are you sure you want to delete the sales record for ${brand} (${code})?`)) {
        return;
    }

    showLoader(true, "Deleting record...");

    try {
        const response = await fetch(`/api/sales/${recordId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (response.ok && data.success) {
            // Refresh metrics and table data
            await loadDashboardData();
        } else {
            alert(data.message || "Failed to delete record.");
        }
    } catch (error) {
        console.error("Delete failed:", error);
        alert("Failed to delete record due to network error.");
    } finally {
        showLoader(false);
    }
}

// Tab Navigation switching logic
function switchTab(tabId) {
    const tabOverview = document.getElementById('tab-overview');
    const tabContribution = document.getElementById('tab-contribution');
    const tabPlanning = document.getElementById('tab-planning');
    const tabPlanningContribution = document.getElementById('tab-planning-contribution');
    const tabPlanningQtyDerivation = document.getElementById('tab-planning-qty-derivation');
    const tabColorMaster = document.getElementById('tab-color-master');
    const tabSizeMaster = document.getElementById('tab-size-master');
    const tabFabricMaster = document.getElementById('tab-fabric-master');
    const tabBrandMaster = document.getElementById('tab-brand-master');
    const tabProductDescriptionMaster = document.getElementById('tab-product-description-master');
    const tabProductMaster = document.getElementById('tab-product-master');
    const tabCommonProductionMaster = document.getElementById('tab-common-production-master');
    const tabStockWip = document.getElementById('tab-stock-wip');
    const tabBalanceQty = document.getElementById('tab-balance-qty');
    const tabPendingQtyPlanning = document.getElementById('tab-pending-qty-planning');
    const tabLeadDaysMaster = document.getElementById('tab-lead-days-master');

    const panelOverview = document.getElementById('overview-panel');
    const panelContribution = document.getElementById('contribution-panel');
    const panelPlanning = document.getElementById('planning-panel');
    const panelPlanningContribution = document.getElementById('planning-contribution-panel');
    const panelPlanningQtyDerivation = document.getElementById('planning-qty-derivation-panel');
    const panelColorMaster = document.getElementById('color-master-panel');
    const panelSizeMaster = document.getElementById('size-master-panel');
    const panelFabricMaster = document.getElementById('fabric-master-panel');
    const panelBrandMaster = document.getElementById('brand-master-panel');
    const panelProductDescriptionMaster = document.getElementById('product-description-master-panel');
    const panelProductMaster = document.getElementById('product-master-panel');
    const panelCommonProductionMaster = document.getElementById('common-production-master-panel');
    const panelStockWip = document.getElementById('stock-wip-panel');
    const panelBalanceQty = document.getElementById('balance-qty-panel');
    const panelPendingQtyPlanning = document.getElementById('pending-qty-planning-panel');
    const panelLeadDaysMaster = document.getElementById('lead-days-master-panel');

    // Reset tabs
    tabOverview.classList.remove('active');
    tabContribution.classList.remove('active');
    if (tabPlanning) tabPlanning.classList.remove('active');
    if (tabPlanningContribution) tabPlanningContribution.classList.remove('active');
    if (tabPlanningQtyDerivation) tabPlanningQtyDerivation.classList.remove('active');
    if (tabColorMaster) tabColorMaster.classList.remove('active');
    if (tabSizeMaster) tabSizeMaster.classList.remove('active');
    if (tabFabricMaster) tabFabricMaster.classList.remove('active');
    if (tabBrandMaster) tabBrandMaster.classList.remove('active');
    if (tabProductDescriptionMaster) tabProductDescriptionMaster.classList.remove('active');
    if (tabProductMaster) tabProductMaster.classList.remove('active');
    if (tabCommonProductionMaster) tabCommonProductionMaster.classList.remove('active');
    if (tabStockWip) tabStockWip.classList.remove('active');
    if (tabBalanceQty) tabBalanceQty.classList.remove('active');
    if (tabPendingQtyPlanning) tabPendingQtyPlanning.classList.remove('active');
    if (tabLeadDaysMaster) tabLeadDaysMaster.classList.remove('active');

    panelOverview.classList.add('hidden');
    panelContribution.classList.add('hidden');
    panelPlanning.classList.add('hidden');
    if (panelPlanningContribution) panelPlanningContribution.classList.add('hidden');
    if (panelPlanningQtyDerivation) panelPlanningQtyDerivation.classList.add('hidden');
    if (panelColorMaster) panelColorMaster.classList.add('hidden');
    if (panelSizeMaster) panelSizeMaster.classList.add('hidden');
    if (panelFabricMaster) panelFabricMaster.classList.add('hidden');
    if (panelBrandMaster) panelBrandMaster.classList.add('hidden');
    if (panelProductDescriptionMaster) panelProductDescriptionMaster.classList.add('hidden');
    if (panelProductMaster) panelProductMaster.classList.add('hidden');
    if (panelCommonProductionMaster) panelCommonProductionMaster.classList.add('hidden');
    if (panelStockWip) panelStockWip.classList.add('hidden');
    if (panelBalanceQty) panelBalanceQty.classList.add('hidden');
    if (panelPendingQtyPlanning) panelPendingQtyPlanning.classList.add('hidden');
    if (panelLeadDaysMaster) panelLeadDaysMaster.classList.add('hidden');

    if (tabId === 'overview') {
        tabOverview.classList.add('active');
        panelOverview.classList.remove('hidden');
    } else if (tabId === 'contribution') {
        tabContribution.classList.add('active');
        panelContribution.classList.remove('hidden');
        initializeContributionTab();
    } else if (tabId === 'planning') {
        if (tabPlanning) tabPlanning.classList.add('active');
        panelPlanning.classList.remove('hidden');
        initializePlanningTab();
    } else if (tabId === 'planning-contribution') {
        if (tabPlanningContribution) tabPlanningContribution.classList.add('active');
        if (panelPlanningContribution) panelPlanningContribution.classList.remove('hidden');
        initializePlanningContributionTab();
    } else if (tabId === 'planning-qty-derivation') {
        if (tabPlanningQtyDerivation) tabPlanningQtyDerivation.classList.add('active');
        if (panelPlanningQtyDerivation) panelPlanningQtyDerivation.classList.remove('hidden');
        initializePlanningQtyDerivationTab();
    } else if (tabId === 'pending-qty-planning') {
        if (tabPendingQtyPlanning) tabPendingQtyPlanning.classList.add('active');
        if (panelPendingQtyPlanning) panelPendingQtyPlanning.classList.remove('hidden');
        initializePendingQtyPlanningTab();
    } else if (tabId === 'color-master') {
        if (tabColorMaster) tabColorMaster.classList.add('active');
        if (panelColorMaster) panelColorMaster.classList.remove('hidden');
        initializeColorMasterTab();
    } else if (tabId === 'size-master') {
        if (tabSizeMaster) tabSizeMaster.classList.add('active');
        if (panelSizeMaster) panelSizeMaster.classList.remove('hidden');
        initializeSizeMasterTab();
    } else if (tabId === 'fabric-master') {
        if (tabFabricMaster) tabFabricMaster.classList.add('active');
        if (panelFabricMaster) panelFabricMaster.classList.remove('hidden');
        initializeFabricMasterTab();
    } else if (tabId === 'brand-master') {
        if (tabBrandMaster) tabBrandMaster.classList.add('active');
        if (panelBrandMaster) panelBrandMaster.classList.remove('hidden');
        initializeBrandMasterTab();
    } else if (tabId === 'product-description-master') {
        if (tabProductDescriptionMaster) tabProductDescriptionMaster.classList.add('active');
        if (panelProductDescriptionMaster) panelProductDescriptionMaster.classList.remove('hidden');
        initializeProductDescriptionMasterTab();
    } else if (tabId === 'product-master') {
        if (tabProductMaster) tabProductMaster.classList.add('active');
        if (panelProductMaster) panelProductMaster.classList.remove('hidden');
        initializeProductMasterTab();
    } else if (tabId === 'common-production-master') {
        if (tabCommonProductionMaster) tabCommonProductionMaster.classList.add('active');
        if (panelCommonProductionMaster) panelCommonProductionMaster.classList.remove('hidden');
        initializeCommonProductionMasterTab();
    } else if (tabId === 'stock-wip') {
        if (tabStockWip) tabStockWip.classList.add('active');
        if (panelStockWip) panelStockWip.classList.remove('hidden');
        initializeStockWipTab();
    } else if (tabId === 'balance-qty') {
        if (tabBalanceQty) tabBalanceQty.classList.add('active');
        if (panelBalanceQty) panelBalanceQty.classList.remove('hidden');
        initializeBalanceQtyTab();
    } else if (tabId === 'lead-days-master') {
        if (tabLeadDaysMaster) tabLeadDaysMaster.classList.add('active');
        if (panelLeadDaysMaster) panelLeadDaysMaster.classList.remove('hidden');
        initLeadDaysMaster();
    }
}

// Initialize Contribution Tab Dropdowns (if not loaded already)
// Initialize Contribution Tab Dropdowns (if not loaded already)
let contributionFiltersInitialized = false;
window.contribFilterComponents = {};

async function initializeContributionTab() {
    if (contributionFiltersInitialized) return;

    const startSelect = document.getElementById('contrib-start-month');
    const endSelect = document.getElementById('contrib-end-month');
    const filtersContainer = document.getElementById('sidebar-filters-container');

    startSelect.innerHTML = '<option value="">Loading...</option>';
    endSelect.innerHTML = '<option value="">Loading...</option>';
    filtersContainer.innerHTML = '<div style="padding: 10px; font-size: 12px; color: var(--text-secondary);">Loading advanced filters...</div>';

    try {
        const response = await fetch('/api/contribution/filter-options');
        const data = await response.json();

        if (response.ok && data.success) {
            // 1. Populate month dropdown selectors
            const months = data.months;
            const formatMonthLabel = (dateStr) => {
                try {
                    const d = new Date(dateStr);
                    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                } catch (e) {
                    return dateStr;
                }
            };

            startSelect.innerHTML = '';
            endSelect.innerHTML = '';
            months.forEach(m => {
                const label = formatMonthLabel(m);
                const optStart = document.createElement('option');
                optStart.value = m;
                optStart.textContent = label;
                startSelect.appendChild(optStart);

                const optEnd = document.createElement('option');
                optEnd.value = m;
                optEnd.textContent = label;
                endSelect.appendChild(optEnd);
            });

            if (months.length > 0) {
                startSelect.value = months[0];
                endSelect.value = months[months.length - 1];
            }

            // 2. Clear loader text & initialize advanced filter accordions
            filtersContainer.innerHTML = '';

            const handleFilterChange = () => {
                appState.contribFilters.brands = window.contribFilterComponents.brand.getSelections();
                appState.contribFilters.types = window.contribFilterComponents.type.getSelections();
                appState.contribFilters.statuses = window.contribFilterComponents.status.getSelections();
                appState.contribFilters.sizes = window.contribFilterComponents.size.getSelections();
                appState.contribFilters.descriptions = window.contribFilterComponents.description.getSelections();
                appState.contribFilters.products = window.contribFilterComponents.product.getSelections();
                appState.contribFilters.months = window.contribFilterComponents.month.getSelections();
                appState.contribFilters.colors = window.contribFilterComponents.color.getSelections();

                // Sync sidebar selections to checkboxes and summary
                appState.selectedContribProducts = [...appState.contribFilters.products];
                appState.selectedContribColors = [...appState.contribFilters.colors];

                syncCheckboxStates();
                updateSelectionSummary();
            };

            // Reusable wrapper to map month labels back to ISO dates
            window.contribFilterComponents.month = new MultiSelectFilter('sidebar-filters-container', 'month', 'Month', months.map(m => formatMonthLabel(m)), (labels) => {
                const selectedDates = months.filter(m => labels.includes(formatMonthLabel(m)));
                appState.contribFilters.months = selectedDates;
                updateSelectionSummary();
            });

            window.contribFilterComponents.brand = new MultiSelectFilter('sidebar-filters-container', 'brand', 'Brand', data.brands, handleFilterChange);
            window.contribFilterComponents.description = new MultiSelectFilter('sidebar-filters-container', 'description', 'Product Description', data.descriptions, handleFilterChange);
            window.contribFilterComponents.type = new MultiSelectFilter('sidebar-filters-container', 'type', 'Product Type', data.types, handleFilterChange);
            window.contribFilterComponents.status = new MultiSelectFilter('sidebar-filters-container', 'status', 'Product Status', data.statuses, handleFilterChange);

            window.contribFilterComponents.product = new MultiSelectFilter('sidebar-filters-container', 'product', 'Product', data.products, (selectedProds) => {
                appState.selectedContribProducts = [...selectedProds];
                appState.contribFilters.products = [...selectedProds];
                syncCheckboxStates();
                updateSelectionSummary();
            });

            window.contribFilterComponents.color = new MultiSelectFilter('sidebar-filters-container', 'color', 'Color', data.colors, (selectedColors) => {
                appState.selectedContribColors = [...selectedColors];
                appState.contribFilters.colors = [...selectedColors];
                syncCheckboxStates();
                updateSelectionSummary();
            });

            window.contribFilterComponents.size = new MultiSelectFilter('sidebar-filters-container', 'size', 'Size', data.sizes, handleFilterChange);

            contributionFiltersInitialized = true;

            // Auto-load calculations
            await loadContributionData();
        } else {
            console.error("Failed to load filter options:", data.message);
        }
    } catch (err) {
        console.error("Error initializing contribution advanced filters:", err);
    }
}

// Sidebar Toggle
function toggleFilterSidebar() {
    const sidebar = document.getElementById('contrib-filter-sidebar');
    sidebar.classList.toggle('collapsed');
}

// Clear all selections across all groups
function clearAllSelections() {
    appState.selectedContribProducts = [];
    appState.selectedContribColors = [];
    appState.selectedContribBrands = [];
    appState.selectedContribDescriptions = [];
    appState.selectedContribTypes = [];
    appState.selectedContribProduct = null;
    appState.selectedContribColor = null;
    appState.selectedContribBrand = null;
    appState.selectedContribDescription = null;
    appState.selectedContribType = null;

    // Clear sidebar components
    if (window.contribFilterComponents) {
        Object.values(window.contribFilterComponents).forEach(comp => comp.clear());
    }
    appState.contribFilters = {
        months: [],
        brands: [],
        descriptions: [],
        types: [],
        statuses: [],
        sizes: []
    };

    // Clear searches
    document.getElementById('prod-search').value = '';
    document.getElementById('color-search').value = '';

    // Reset lists
    resetColorContribution();
    resetSizeContribution();

    // Sync UI
    syncCheckboxStates();
    updateSelectionSummary();

    // Reload Product/Category Column
    loadContributionData();
}

// Update the metrics selection summary bar dynamically based on active grouping category
function updateSelectionSummary(totalQty = null, contribBase = null) {
    let selectedCount = 0;
    let label = 'Selected Products';

    if (appState.contribGroupBy === 'brand') {
        selectedCount = appState.selectedContribBrands.length;
        label = 'Selected Brands';
    } else if (appState.contribGroupBy === 'description') {
        selectedCount = appState.selectedContribDescriptions.length;
        label = 'Selected Descriptions';
    } else if (appState.contribGroupBy === 'type') {
        selectedCount = appState.selectedContribTypes.length;
        label = 'Selected Types';
    } else {
        selectedCount = appState.selectedContribProducts.length;
        label = 'Selected Products';
    }

    const labelEl = document.querySelector('.contrib-summary-bar .summary-stat:first-of-type .stat-label');
    if (labelEl) labelEl.textContent = label;

    document.getElementById('summary-products-count').textContent = selectedCount;
    document.getElementById('summary-colors-count').textContent = appState.selectedContribColors.length;

    if (totalQty !== null) {
        document.getElementById('summary-total-qty').textContent = totalQty.toLocaleString();
    }
    if (contribBase !== null) {
        document.getElementById('summary-contrib-base').textContent = `${contribBase}%`;
    }
}

// Change the dynamic grouping category (Product, Brand, Description, Product Type)
function changeContribGroupBy(value) {
    appState.contribGroupBy = value;

    // Update headers and placeholders
    const headerTitle = document.getElementById('contrib-card-1-header');
    const searchInput = document.getElementById('prod-search');

    if (value === 'brand') {
        headerTitle.textContent = '1. Brand Contribution';
        searchInput.placeholder = 'Search brands...';
    } else if (value === 'description') {
        headerTitle.textContent = '1. Description Contribution';
        searchInput.placeholder = 'Search descriptions...';
    } else if (value === 'type') {
        headerTitle.textContent = '1. Product Type Contribution';
        searchInput.placeholder = 'Search product types...';
    } else {
        headerTitle.textContent = '1. Product Contribution';
        searchInput.placeholder = 'Search products...';
    }

    // Clear selection states for the first column
    appState.selectedContribProducts = [];
    appState.selectedContribProduct = null;
    appState.selectedContribBrands = [];
    appState.selectedContribBrand = null;
    appState.selectedContribDescriptions = [];
    appState.selectedContribDescription = null;
    appState.selectedContribTypes = [];
    appState.selectedContribType = null;

    searchInput.value = '';

    // Reset columns 2 and 3
    resetColorContribution();
    resetSizeContribution();

    updateSelectionSummary();
    loadContributionData();
}

// Filter the Column 1 list view client-side
function filterProductList() {
    const query = document.getElementById('prod-search').value.toLowerCase().trim();
    const items = document.querySelectorAll('#prod-contrib-list .contrib-item');

    items.forEach(item => {
        const title = item.querySelector('.contrib-item-title').textContent.toLowerCase();
        const desc = item.querySelector('.contrib-item-desc').textContent.toLowerCase();
        if (title.includes(query) || desc.includes(query)) {
            item.classList.remove('hidden');
        } else {
            item.classList.add('hidden');
        }
    });
}

// Filter the Color list view client-side
function filterColorList() {
    const query = document.getElementById('color-search').value.toLowerCase().trim();
    const items = document.querySelectorAll('#color-contrib-list .contrib-item');

    items.forEach(item => {
        const text = item.querySelector('.contrib-item-title').textContent.toLowerCase();
        if (text.includes(query)) {
            item.classList.remove('hidden');
        } else {
            item.classList.add('hidden');
        }
    });
}

// Select All / Unselect All visible items in Column 1 (Product/Brand/Desc/Type)
function selectVisibleProducts(select) {
    const items = document.querySelectorAll('#prod-contrib-list .contrib-item:not(.hidden)');
    items.forEach(item => {
        const cb = item.querySelector('.contrib-item-checkbox');
        if (!cb) return;
        cb.checked = select;

        if (appState.contribGroupBy === 'brand') {
            const brand = item.dataset.brand;
            if (select) {
                if (!appState.selectedContribBrands.includes(brand)) appState.selectedContribBrands.push(brand);
            } else {
                appState.selectedContribBrands = appState.selectedContribBrands.filter(b => b !== brand);
            }
        } else if (appState.contribGroupBy === 'description') {
            const desc = item.dataset.description;
            if (select) {
                if (!appState.selectedContribDescriptions.includes(desc)) appState.selectedContribDescriptions.push(desc);
            } else {
                appState.selectedContribDescriptions = appState.selectedContribDescriptions.filter(d => d !== desc);
            }
        } else if (appState.contribGroupBy === 'type') {
            const type = item.dataset.type;
            if (select) {
                if (!appState.selectedContribTypes.includes(type)) appState.selectedContribTypes.push(type);
            } else {
                appState.selectedContribTypes = appState.selectedContribTypes.filter(t => t !== type);
            }
        } else {
            const pCode = item.dataset.product;
            if (select) {
                if (!appState.selectedContribProducts.includes(pCode)) appState.selectedContribProducts.push(pCode);
            } else {
                appState.selectedContribProducts = appState.selectedContribProducts.filter(p => p !== pCode);
            }
        }
    });

    // Sync with sidebar components if they exist
    if (window.contribFilterComponents) {
        if (appState.contribGroupBy === 'brand' && window.contribFilterComponents.brand) {
            window.contribFilterComponents.brand.setSelections(appState.selectedContribBrands);
        } else if (appState.contribGroupBy === 'description' && window.contribFilterComponents.description) {
            window.contribFilterComponents.description.setSelections(appState.selectedContribDescriptions);
        } else if (appState.contribGroupBy === 'type' && window.contribFilterComponents.type) {
            window.contribFilterComponents.type.setSelections(appState.selectedContribTypes);
        } else if (appState.contribGroupBy === 'product' && window.contribFilterComponents.product) {
            window.contribFilterComponents.product.setSelections(appState.selectedContribProducts);
        }
    }

    updateSelectionSummary();
}

// Select All / Unselect All visible colors in Column 2
function selectVisibleColors(select) {
    const items = document.querySelectorAll('#color-contrib-list .contrib-item:not(.hidden)');
    items.forEach(item => {
        const color = item.dataset.color;
        const cb = item.querySelector('.contrib-item-checkbox');
        if (cb) {
            cb.checked = select;
            if (select) {
                if (!appState.selectedContribColors.includes(color)) {
                    appState.selectedContribColors.push(color);
                }
            } else {
                appState.selectedContribColors = appState.selectedContribColors.filter(c => c !== color);
            }
        }
    });

    if (window.contribFilterComponents && window.contribFilterComponents.color) {
        window.contribFilterComponents.color.setSelections(appState.selectedContribColors);
    }

    updateSelectionSummary();
}

function addVisibleProductsToSelection() {
    selectVisibleProducts(true);
}

function addVisibleColorsToSelection() {
    selectVisibleColors(true);
}

function clearProductSelection() {
    if (appState.contribGroupBy === 'brand') {
        appState.selectedContribBrands = [];
        if (window.contribFilterComponents && window.contribFilterComponents.brand) window.contribFilterComponents.brand.clear();
    } else if (appState.contribGroupBy === 'description') {
        appState.selectedContribDescriptions = [];
        if (window.contribFilterComponents && window.contribFilterComponents.description) window.contribFilterComponents.description.clear();
    } else if (appState.contribGroupBy === 'type') {
        appState.selectedContribTypes = [];
        if (window.contribFilterComponents && window.contribFilterComponents.type) window.contribFilterComponents.type.clear();
    } else {
        appState.selectedContribProducts = [];
        if (window.contribFilterComponents && window.contribFilterComponents.product) window.contribFilterComponents.product.clear();
    }
    syncCheckboxStates();
    updateSelectionSummary();
}

function clearColorSelection() {
    appState.selectedContribColors = [];
    syncCheckboxStates();
    if (window.contribFilterComponents && window.contribFilterComponents.color) {
        window.contribFilterComponents.color.clear();
    }
    updateSelectionSummary();
}

// Sync checkboxes visual state with state arrays
function syncCheckboxStates() {
    const prodCheckboxes = document.querySelectorAll('#prod-contrib-list .contrib-item-checkbox');
    prodCheckboxes.forEach(cb => {
        const row = cb.closest('.contrib-item');
        if (appState.contribGroupBy === 'brand') {
            cb.checked = appState.selectedContribBrands.includes(row.dataset.brand);
        } else if (appState.contribGroupBy === 'description') {
            cb.checked = appState.selectedContribDescriptions.includes(row.dataset.description);
        } else if (appState.contribGroupBy === 'type') {
            cb.checked = appState.selectedContribTypes.includes(row.dataset.type);
        } else {
            cb.checked = appState.selectedContribProducts.includes(row.dataset.product);
        }
    });

    const colorCheckboxes = document.querySelectorAll('#color-contrib-list .contrib-item-checkbox');
    colorCheckboxes.forEach(cb => {
        const color = cb.closest('.contrib-item').dataset.color;
        cb.checked = appState.selectedContribColors.includes(color);
    });
}

const escapeJSString = (str) => String(str || '').replace(/'/g, "\\'");

// Toggle selections of specific items
function toggleProductSelect(checkbox, productCode) {
    if (checkbox.checked) {
        if (!appState.selectedContribProducts.includes(productCode)) appState.selectedContribProducts.push(productCode);
    } else {
        appState.selectedContribProducts = appState.selectedContribProducts.filter(p => p !== productCode);
    }
    if (window.contribFilterComponents && window.contribFilterComponents.product) {
        window.contribFilterComponents.product.setSelections(appState.selectedContribProducts);
    }
    updateSelectionSummary();
}

function toggleBrandSelect(checkbox, brandName) {
    if (checkbox.checked) {
        if (!appState.selectedContribBrands.includes(brandName)) appState.selectedContribBrands.push(brandName);
    } else {
        appState.selectedContribBrands = appState.selectedContribBrands.filter(b => b !== brandName);
    }
    if (window.contribFilterComponents && window.contribFilterComponents.brand) {
        window.contribFilterComponents.brand.setSelections(appState.selectedContribBrands);
    }
    updateSelectionSummary();
}

function toggleDescriptionSelect(checkbox, descText) {
    if (checkbox.checked) {
        if (!appState.selectedContribDescriptions.includes(descText)) appState.selectedContribDescriptions.push(descText);
    } else {
        appState.selectedContribDescriptions = appState.selectedContribDescriptions.filter(d => d !== descText);
    }
    if (window.contribFilterComponents && window.contribFilterComponents.description) {
        window.contribFilterComponents.description.setSelections(appState.selectedContribDescriptions);
    }
    updateSelectionSummary();
}

function toggleTypeSelect(checkbox, typeName) {
    if (checkbox.checked) {
        if (!appState.selectedContribTypes.includes(typeName)) appState.selectedContribTypes.push(typeName);
    } else {
        appState.selectedContribTypes = appState.selectedContribTypes.filter(t => t !== typeName);
    }
    if (window.contribFilterComponents && window.contribFilterComponents.type) {
        window.contribFilterComponents.type.setSelections(appState.selectedContribTypes);
    }
    updateSelectionSummary();
}

function toggleColorSelect(checkbox, colorName) {
    if (checkbox.checked) {
        if (!appState.selectedContribColors.includes(colorName)) appState.selectedContribColors.push(colorName);
    } else {
        appState.selectedContribColors = appState.selectedContribColors.filter(c => c !== colorName);
    }
    if (window.contribFilterComponents && window.contribFilterComponents.color) {
        window.contribFilterComponents.color.setSelections(appState.selectedContribColors);
    }
    updateSelectionSummary();
}

// Load tier 1: Product/Category Contribution
async function loadContributionData() {
    const startMonth = document.getElementById('contrib-start-month').value;
    const endMonth = document.getElementById('contrib-end-month').value;

    const loader = document.getElementById('prod-contrib-loader');
    const listContainer = document.getElementById('prod-contrib-list');

    loader.classList.remove('hidden');
    listContainer.innerHTML = '';

    // Clear sub-tiers (Colors & Sizes)
    resetColorContribution();
    resetSizeContribution();

    // Compile Payload
    const payload = {
        start_month: startMonth,
        end_month: endMonth,
        group_by: appState.contribGroupBy,
        ...appState.contribFilters
    };

    // Ensure we do NOT filter the grouping column by itself
    if (appState.contribGroupBy === 'brand') {
        delete payload.brands;
    } else if (appState.contribGroupBy === 'description') {
        delete payload.descriptions;
    } else if (appState.contribGroupBy === 'type') {
        delete payload.types;
    } else {
        delete payload.products;
    }

    try {
        const response = await fetch('/api/contribution/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();

        if (response.ok && data.success) {
            document.getElementById('prod-contrib-title').innerHTML = `Overall period sales: <strong>${data.total_qty.toLocaleString()}</strong> Qty`;

            // Update metrics selection bar
            updateSelectionSummary(data.total_qty, data.contrib_base);

            if (data.products.length === 0) {
                listContainer.innerHTML = '<div class="contrib-placeholder"><p>No sales records found for this selection.</p></div>';
                return;
            }

            data.products.forEach(item => {
                const row = document.createElement('div');
                row.className = 'contrib-item';

                let itemValue = '';
                let itemTitle = '';
                let itemDesc = '';
                let isChecked = false;
                let toggleFnStr = '';
                let selectFn = null;

                if (appState.contribGroupBy === 'brand') {
                    itemValue = item.brand;
                    itemTitle = item.brand;
                    itemDesc = 'Brand';
                    isChecked = appState.selectedContribBrands.includes(item.brand);
                    toggleFnStr = `toggleBrandSelect(this, '${escapeJSString(item.brand)}')`;
                    row.dataset.brand = item.brand;
                    selectFn = () => selectContribBrand(row, item.brand, item.qty);
                } else if (appState.contribGroupBy === 'description') {
                    itemValue = item.description;
                    itemTitle = item.description;
                    itemDesc = 'Product Description';
                    isChecked = appState.selectedContribDescriptions.includes(item.description);
                    toggleFnStr = `toggleDescriptionSelect(this, '${escapeJSString(item.description)}')`;
                    row.dataset.description = item.description;
                    selectFn = () => selectContribDescription(row, item.description, item.qty);
                } else if (appState.contribGroupBy === 'type') {
                    itemValue = item.type;
                    itemTitle = item.type;
                    itemDesc = 'Product Type';
                    isChecked = appState.selectedContribTypes.includes(item.type);
                    toggleFnStr = `toggleTypeSelect(this, '${escapeJSString(item.type)}')`;
                    row.dataset.type = item.type;
                    selectFn = () => selectContribType(row, item.type, item.qty);
                } else {
                    itemValue = item.product;
                    itemTitle = item.product;
                    itemDesc = item.description || 'Product';
                    isChecked = appState.selectedContribProducts.includes(item.product);
                    toggleFnStr = `toggleProductSelect(this, '${escapeJSString(item.product)}')`;
                    row.dataset.product = item.product;
                    selectFn = () => selectContribProduct(row, item.product, item.qty);
                }

                row.onclick = (e) => {
                    if (e.target.type === 'checkbox') return;
                    if (selectFn) selectFn();
                };

                row.innerHTML = `
                    <div class="contrib-item-checkbox-wrapper">
                        <input type="checkbox" class="contrib-item-checkbox" ${isChecked ? 'checked' : ''} onclick="event.stopPropagation(); ${toggleFnStr}">
                    </div>
                    <div class="contrib-item-meta">
                        <div class="contrib-item-info">
                            <span class="contrib-item-title">${itemTitle}</span>
                            <span class="contrib-item-desc" title="${itemDesc}">${itemDesc}</span>
                        </div>
                        <div class="contrib-item-values">
                            <span class="contrib-item-qty">Qty: <strong>${item.qty.toLocaleString()}</strong></span>
                            <span class="contrib-item-pct">${item.percentage}%</span>
                        </div>
                    </div>
                    <div class="contrib-progress-container" style="left: 37px; width: calc(100% - 37px);">
                        <div class="contrib-progress-bar" style="width: ${item.percentage}%"></div>
                    </div>
                `;
                listContainer.appendChild(row);
            });

            // Restore search queries
            filterProductList();
        } else {
            listContainer.innerHTML = `<div class="contrib-placeholder"><p>Error: ${data.message}</p></div>`;
        }
    } catch (err) {
        console.error("Data fetch failed:", err);
        listContainer.innerHTML = '<div class="contrib-placeholder"><p>Failed to retrieve data.</p></div>';
    } finally {
        loader.classList.add('hidden');
    }
}

// Select Item Row click handlers
function selectContribProduct(element, productCode, totalQty) {
    const siblings = document.querySelectorAll('#prod-contrib-list .contrib-item');
    siblings.forEach(s => s.classList.remove('active'));
    element.classList.add('active');

    appState.selectedContribProduct = productCode;
    appState.selectedContribProductQty = totalQty;

    document.getElementById('color-contrib-title').innerHTML = `Product Total: <strong>${totalQty.toLocaleString()}</strong> Qty`;

    loadColorContribution();
}

function selectContribBrand(element, brandName, totalQty) {
    const siblings = document.querySelectorAll('#prod-contrib-list .contrib-item');
    siblings.forEach(s => s.classList.remove('active'));
    element.classList.add('active');

    appState.selectedContribBrand = brandName;
    document.getElementById('color-contrib-title').innerHTML = `Brand Total: <strong>${totalQty.toLocaleString()}</strong> Qty`;
    loadColorContribution();
}

function selectContribDescription(element, descText, totalQty) {
    const siblings = document.querySelectorAll('#prod-contrib-list .contrib-item');
    siblings.forEach(s => s.classList.remove('active'));
    element.classList.add('active');

    appState.selectedContribDescription = descText;
    document.getElementById('color-contrib-title').innerHTML = `Description Total: <strong>${totalQty.toLocaleString()}</strong> Qty`;
    loadColorContribution();
}

function selectContribType(element, typeName, totalQty) {
    const siblings = document.querySelectorAll('#prod-contrib-list .contrib-item');
    siblings.forEach(s => s.classList.remove('active'));
    element.classList.add('active');

    appState.selectedContribType = typeName;
    document.getElementById('color-contrib-title').innerHTML = `Type Total: <strong>${totalQty.toLocaleString()}</strong> Qty`;
    loadColorContribution();
}

// Reset Color tier UI
function resetColorContribution() {
    appState.selectedContribProduct = null;
    appState.selectedContribBrand = null;
    appState.selectedContribDescription = null;
    appState.selectedContribType = null;

    document.getElementById('color-contrib-title').textContent = 'Click an item above to analyze colors';
    document.getElementById('color-contrib-placeholder').classList.remove('hidden');
    document.getElementById('color-contrib-list').classList.add('hidden');
    document.getElementById('color-contrib-list').innerHTML = '';
}

// Load tier 2: Color Contribution
async function loadColorContribution() {
    const startMonth = document.getElementById('contrib-start-month').value;
    const endMonth = document.getElementById('contrib-end-month').value;

    const loader = document.getElementById('color-contrib-loader');
    const placeholder = document.getElementById('color-contrib-placeholder');
    const listContainer = document.getElementById('color-contrib-list');

    loader.classList.remove('hidden');
    placeholder.classList.add('hidden');
    listContainer.classList.add('hidden');
    listContainer.innerHTML = '';

    // Clear tier 3 (Sizes)
    resetSizeContribution();

    // Compile Payload
    const payload = {
        start_month: startMonth,
        end_month: endMonth,
        ...appState.contribFilters
    };

    // Inject Column 1 filters depending on dynamic group_by Category
    if (appState.contribGroupBy === 'brand') {
        if (appState.selectedContribBrands.length > 0) {
            payload.brands = appState.selectedContribBrands;
        } else if (appState.selectedContribBrand) {
            payload.brands = [appState.selectedContribBrand];
        }
    } else if (appState.contribGroupBy === 'description') {
        if (appState.selectedContribDescriptions.length > 0) {
            payload.descriptions = appState.selectedContribDescriptions;
        } else if (appState.selectedContribDescription) {
            payload.descriptions = [appState.selectedContribDescription];
        }
    } else if (appState.contribGroupBy === 'type') {
        if (appState.selectedContribTypes.length > 0) {
            payload.types = appState.selectedContribTypes;
        } else if (appState.selectedContribType) {
            payload.types = [appState.selectedContribType];
        }
    } else {
        if (appState.selectedContribProducts.length > 0) {
            payload.products = appState.selectedContribProducts;
        } else if (appState.selectedContribProduct) {
            payload.products = [appState.selectedContribProduct];
        }
    }

    // Ensure we do NOT filter colors list by selected colors
    delete payload.colors;

    try {
        const response = await fetch('/api/contribution/colors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();

        if (response.ok && data.success) {
            if (data.colors.length === 0) {
                listContainer.innerHTML = '<div class="contrib-placeholder"><p>No colors found for this selection.</p></div>';
                listContainer.classList.remove('hidden');
                return;
            }

            data.colors.forEach(item => {
                const row = document.createElement('div');
                row.className = 'contrib-item';
                row.dataset.color = item.color;
                row.onclick = (e) => {
                    if (e.target.type === 'checkbox') return;
                    selectContribColor(row, item.color, item.qty);
                };

                const isChecked = appState.selectedContribColors.includes(item.color);

                row.innerHTML = `
                    <div class="contrib-item-checkbox-wrapper">
                        <input type="checkbox" class="contrib-item-checkbox" ${isChecked ? 'checked' : ''} onclick="event.stopPropagation(); toggleColorSelect(this, '${item.color}')">
                    </div>
                    <div class="contrib-item-meta">
                        <div class="contrib-item-info">
                            <span class="contrib-item-title">${item.color}</span>
                            <span class="contrib-item-desc">Selection share</span>
                        </div>
                        <div class="contrib-item-values">
                            <span class="contrib-item-qty">Qty: <strong>${item.qty.toLocaleString()}</strong></span>
                            <span class="contrib-item-pct">${item.percentage}%</span>
                        </div>
                    </div>
                    <div class="contrib-progress-container" style="left: 37px; width: calc(100% - 37px);">
                        <div class="contrib-progress-bar" style="width: ${item.percentage}%"></div>
                    </div>
                `;
                listContainer.appendChild(row);
            });
            listContainer.classList.remove('hidden');

            // Restore client side search query
            filterColorList();
        } else {
            listContainer.innerHTML = `<div class="contrib-placeholder"><p>Error: ${data.message}</p></div>`;
            listContainer.classList.remove('hidden');
        }
    } catch (err) {
        console.error("Color contrib fetch failed:", err);
        listContainer.innerHTML = '<div class="contrib-placeholder"><p>Failed to retrieve data.</p></div>';
        listContainer.classList.remove('hidden');
    } finally {
        loader.classList.add('hidden');
    }
}

// Select Color Row click handler
function selectContribColor(element, colorName, totalQty) {
    const siblings = document.querySelectorAll('#color-contrib-list .contrib-item');
    siblings.forEach(s => s.classList.remove('active'));
    element.classList.add('active');

    appState.selectedContribColor = colorName;
    appState.selectedContribColorQty = totalQty;

    document.getElementById('size-contrib-title').innerHTML = `Product+Color Total: <strong>${totalQty.toLocaleString()}</strong> Qty`;

    // Load sizes matching selection
    loadSizeContribution();
}

// Reset Size tier UI
function resetSizeContribution() {
    appState.selectedContribColor = null;
    appState.selectedContribColorQty = 0;

    document.getElementById('size-contrib-title').textContent = 'Click a color to analyze sizes';
    document.getElementById('size-contrib-placeholder').classList.remove('hidden');
    document.getElementById('size-contrib-list').classList.add('hidden');
    document.getElementById('size-contrib-list').innerHTML = '';
}

// Load tier 3: Size Contribution
async function loadSizeContribution() {
    const startMonth = document.getElementById('contrib-start-month').value;
    const endMonth = document.getElementById('contrib-end-month').value;

    const loader = document.getElementById('size-contrib-loader');
    const placeholder = document.getElementById('size-contrib-placeholder');
    const listContainer = document.getElementById('size-contrib-list');

    loader.classList.remove('hidden');
    placeholder.classList.add('hidden');
    listContainer.classList.add('hidden');
    listContainer.innerHTML = '';

    // Compile Payload
    const payload = {
        start_month: startMonth,
        end_month: endMonth,
        ...appState.contribFilters
    };

    // Inject Column 1 filters depending on dynamic group_by Category
    if (appState.contribGroupBy === 'brand') {
        if (appState.selectedContribBrands.length > 0) {
            payload.brands = appState.selectedContribBrands;
        } else if (appState.selectedContribBrand) {
            payload.brands = [appState.selectedContribBrand];
        }
    } else if (appState.contribGroupBy === 'description') {
        if (appState.selectedContribDescriptions.length > 0) {
            payload.descriptions = appState.selectedContribDescriptions;
        } else if (appState.selectedContribDescription) {
            payload.descriptions = [appState.selectedContribDescription];
        }
    } else if (appState.contribGroupBy === 'type') {
        if (appState.selectedContribTypes.length > 0) {
            payload.types = appState.selectedContribTypes;
        } else if (appState.selectedContribType) {
            payload.types = [appState.selectedContribType];
        }
    } else {
        if (appState.selectedContribProducts.length > 0) {
            payload.products = appState.selectedContribProducts;
        } else if (appState.selectedContribProduct) {
            payload.products = [appState.selectedContribProduct];
        }
    }

    // Override colors selection
    if (appState.selectedContribColors.length > 0) {
        payload.colors = appState.selectedContribColors;
    } else if (appState.selectedContribColor) {
        payload.colors = [appState.selectedContribColor];
    }

    try {
        const response = await fetch('/api/contribution/sizes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();

        if (response.ok && data.success) {
            if (data.sizes.length === 0) {
                listContainer.innerHTML = '<div class="contrib-placeholder"><p>No sizes found for this selection.</p></div>';
                listContainer.classList.remove('hidden');
                return;
            }

            data.sizes.forEach(item => {
                const row = document.createElement('div');
                row.className = 'contrib-item no-hover';

                row.innerHTML = `
                    <div class="contrib-item-meta" style="padding-left: 0;">
                        <div class="contrib-item-info">
                            <span class="contrib-item-title">${item.size}</span>
                            <span class="contrib-item-desc">Selection share</span>
                        </div>
                        <div class="contrib-item-values">
                            <span class="contrib-item-qty">Qty: <strong>${item.qty.toLocaleString()}</strong></span>
                            <span class="contrib-item-pct">${item.percentage}%</span>
                        </div>
                    </div>
                    <div class="contrib-progress-container" style="left: 0; width: 100%;">
                        <div class="contrib-progress-bar" style="width: ${item.percentage}%"></div>
                    </div>
                `;
                listContainer.appendChild(row);
            });
            listContainer.classList.remove('hidden');
        } else {
            listContainer.innerHTML = `<div class="contrib-placeholder"><p>Error: ${data.message}</p></div>`;
            listContainer.classList.remove('hidden');
        }
    } catch (err) {
        console.error("Size contrib fetch failed:", err);
        listContainer.innerHTML = '<div class="contrib-placeholder"><p>Failed to retrieve data.</p></div>';
        listContainer.classList.remove('hidden');
    } finally {
        loader.classList.add('hidden');
    }
}

// =====================================================================
// OVERALL FUTURE QUANTITY PLANNING FRONT-END CODE
// =====================================================================

let autoSaveTimer = null;
let editorUndoStack = [];
let editorRedoStack = [];

const MONTH_ORDER = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'];

// Prefilled seasonality percentages (Method 7) summing to 100%
const DEFAULT_SEASONALITY = {
    'April': 7.00, 'May': 8.00, 'June': 9.00, 'July': 7.00, 'August': 8.00, 'September': 9.00,
    'October': 10.00, 'November': 9.00, 'December': 8.00, 'January': 8.00, 'February': 8.00, 'March': 9.00
};

// Initialize Planning workspace
async function initializePlanningTab() {
    // Sync UI selectors with default state
    const fySelect = document.getElementById('planning-fy-select');
    if (fySelect) fySelect.value = appState.selectedPlanningFY;
    const editorSelect = document.getElementById('editor-fy-select');
    if (editorSelect) editorSelect.value = appState.selectedPlanningFY;

    exitPlanEditor(false);
    exitPlanComparison(false);
    await fetchPlanningScenarios();
}

async function fetchPlanningScenarios() {
    const listTableBody = document.getElementById('planning-scenarios-body');
    const emptyOverlay = document.getElementById('planning-empty-overlay');
    const loaderOverlay = document.getElementById('planning-loader-overlay');
    const compareBtn = document.getElementById('btn-compare-plans');
    const allCheckbox = document.getElementById('compare-all-checkbox');

    loaderOverlay.classList.remove('hidden');
    emptyOverlay.classList.add('hidden');
    if (listTableBody) listTableBody.innerHTML = '';
    if (compareBtn) compareBtn.disabled = true;
    if (allCheckbox) allCheckbox.checked = false;

    try {
        const response = await fetch('/api/planning/plans');
        const data = await response.json();

        if (response.ok && data.success) {
            appState.plans = data.plans;

            if (data.plans.length === 0) {
                emptyOverlay.classList.remove('hidden');
                return;
            }

            data.plans.forEach(plan => {
                const tr = document.createElement('tr');

                // Format dates
                const createdDate = plan.created_date ? new Date(plan.created_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' }) : 'N/A';
                const modifiedDate = plan.modified_date ? new Date(plan.modified_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' }) : 'N/A';

                const isFinal = plan.status === 'Final';
                const statusBadge = isFinal ? '<span class="table-badge running">Final</span>' : '<span class="table-badge stopped">Draft</span>';

                tr.innerHTML = `
                    <td style="text-align: center;">
                        <input type="checkbox" class="scenario-compare-checkbox" value="${plan.id}" onchange="updateCompareButtonState()">
                    </td>
                    <td><strong>${plan.plan_name}</strong> <span class="badge" style="font-size: 10px;">v${plan.version}</span></td>
                    <td><code>${plan.financial_year}</code></td>
                    <td><span style="font-size:12px; color:var(--text-secondary);">${plan.planning_method}</span></td>
                    <td>${createdDate}</td>
                    <td>${plan.created_by}</td>
                    <td>${statusBadge}</td>
                    <td>${modifiedDate}</td>
                    <td style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${plan.remarks || ''}">${plan.remarks || ''}</td>
                    <td>
                        <div class="actions-cell">
                            <button class="btn-action btn-edit" onclick="openPlanEditor(${plan.id})" title="Edit Plan">
                                <i class="fa-solid fa-pen-to-square"></i>
                            </button>
                            <button class="btn-action" style="color: var(--accent-purple);" onclick="copyPlanScenario(${plan.id})" title="Copy Plan (Version Iteration)">
                                <i class="fa-solid fa-copy"></i>
                            </button>
                            <button class="btn-action" style="color: var(--accent-blue);" onclick="showVersionHistory(${plan.id})" title="Version History">
                                <i class="fa-solid fa-clock-rotate-left"></i>
                            </button>
                            <button class="btn-action" style="color: var(--accent-green);" onclick="setPlanAsFinal(${plan.id})" title="Set as Final Plan" ${isFinal ? 'disabled' : ''}>
                                <i class="fa-solid fa-circle-check"></i>
                            </button>
                            <button class="btn-action btn-delete" onclick="deletePlanScenario(${plan.id})" title="Delete Scenario">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </td>
                `;
                listTableBody.appendChild(tr);
            });
        } else {
            console.error("Failed to load planning scenarios:", data.message);
        }
    } catch (err) {
        console.error("Error loading plans:", err);
    } finally {
        loaderOverlay.classList.add('hidden');
    }
}

// Update Compare button status based on selections
function updateCompareButtonState() {
    const checkboxes = document.querySelectorAll('.scenario-compare-checkbox:checked');
    const compareBtn = document.getElementById('btn-compare-plans');
    compareBtn.disabled = checkboxes.length < 2; // minimum 2 plans needed to compare
}

// Select all checkboxes
function toggleSelectAllScenarios(master) {
    const checkboxes = document.querySelectorAll('.scenario-compare-checkbox');
    checkboxes.forEach(cb => cb.checked = master.checked);
    updateCompareButtonState();
}

// Exit editor
function exitPlanEditor(reload = true) {
    document.getElementById('planning-editor-view').classList.add('hidden');
    document.getElementById('planning-dashboard-view').classList.remove('hidden');
    if (reload) fetchPlanningScenarios();
}

// Exit comparison
function exitPlanComparison(reload = true) {
    document.getElementById('planning-compare-view').classList.add('hidden');
    document.getElementById('planning-dashboard-view').classList.remove('hidden');
    if (reload) fetchPlanningScenarios();
}

// Open Wizard Modal
function openNewPlanWizard() {
    document.getElementById('new-plan-form').reset();
    document.getElementById('wizard-notification').classList.add('hidden');

    // Reset cards selection
    const cards = document.querySelectorAll('.methods-grid .method-card');
    cards.forEach(c => c.classList.remove('active'));
    cards[0].classList.add('active'); // default method 1
    appState.selectedPlanningMethod = 1;

    showMethodParameters(1);

    // Load plans dropdown for copy plan method
    const copySelect = document.getElementById('m5-source-plan');
    copySelect.innerHTML = '<option value="">Select Plan to Copy...</option>';
    appState.plans.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.plan_name} (${p.financial_year} v${p.version})`;
        copySelect.appendChild(opt);
    });

    document.getElementById('new-plan-wizard-modal').classList.remove('hidden');
}

function closeNewPlanWizard() {
    document.getElementById('new-plan-wizard-modal').classList.add('hidden');
}

// Method selection
function selectPlanningMethod(methodNum, cardEl) {
    const cards = document.querySelectorAll('.methods-grid .method-card');
    cards.forEach(c => c.classList.remove('active'));
    cardEl.classList.add('active');

    appState.selectedPlanningMethod = methodNum;
    showMethodParameters(methodNum);
}

// Toggle method parameters fields
function showMethodParameters(methodNum) {
    const groups = document.querySelectorAll('.method-param-group');
    groups.forEach(g => g.classList.add('hidden'));

    const targetGroup = document.getElementById(`params-method-${methodNum}`);
    if (targetGroup) {
        targetGroup.classList.remove('hidden');
    } else {
        document.getElementById('params-none-required').classList.remove('hidden');
    }
}

// Form wizard submit
async function handleWizardSubmit(e) {
    e.preventDefault();
    document.getElementById('wizard-notification').classList.add('hidden');

    const planName = document.getElementById('wizard-plan-name').value.trim();
    const financialYear = document.getElementById('wizard-financial-year').value;
    const remarks = document.getElementById('wizard-remarks').value.trim();
    const planningMethodNum = appState.selectedPlanningMethod;

    const methodNames = [
        'Last Year Month-wise Quantity',
        'Manual Monthly Sales Value Target',
        'Last Year Qty + Growth %',
        'Manual Quantity Entry',
        'Copy Existing Plan',
        'Average of Previous Years',
        'Seasonality Planning',
        'Contribution Based Planning',
        'Custom Formula'
    ];

    const methodName = `Method ${planningMethodNum}: ${methodNames[planningMethodNum - 1]}`;

    // Check parameters before submit
    let methodParams = {};
    if (planningMethodNum === 2) {
        methodParams.asp = parseFloat(document.getElementById('m2-default-asp').value);
        if (isNaN(methodParams.asp) || methodParams.asp <= 0) {
            showWizardError("Average Selling Price must be greater than 0.");
            return;
        }
    } else if (planningMethodNum === 3) {
        methodParams.growth = parseFloat(document.getElementById('m3-default-growth').value);
        if (isNaN(methodParams.growth)) {
            showWizardError("Please enter a valid growth %.");
            return;
        }
    } else if (planningMethodNum === 5) {
        methodParams.sourcePlanId = parseInt(document.getElementById('m5-source-plan').value);
        if (isNaN(methodParams.sourcePlanId)) {
            showWizardError("Please select a plan to copy.");
            return;
        }
    } else if (planningMethodNum === 7) {
        methodParams.annualQty = parseInt(document.getElementById('m7-annual-qty').value);
        if (isNaN(methodParams.annualQty) || methodParams.annualQty <= 0) {
            showWizardError("Annual planned quantity must be greater than 0.");
            return;
        }
    } else if (planningMethodNum === 8) {
        methodParams.annualQty = parseInt(document.getElementById('m8-annual-qty').value);
        if (isNaN(methodParams.annualQty) || methodParams.annualQty <= 0) {
            showWizardError("Total planned quantity must be greater than 0.");
            return;
        }
    }

    showLoader(true, "Creating planning scenario...");

    try {
        const response = await fetch('/api/planning/plans', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                plan_name: planName,
                financial_year: financialYear,
                planning_method: methodName,
                remarks: remarks
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            closeNewPlanWizard();
            await openPlanEditor(data.plan_id, methodParams);
        } else {
            showWizardError(data.message || "Failed to create planning scenario.");
        }
    } catch (err) {
        console.error("Wizard creation error:", err);
        showWizardError("Network connection error. Try again.");
    } finally {
        showLoader(false);
    }
}

function showWizardError(msg) {
    const notif = document.getElementById('wizard-notification');
    notif.querySelector('.message').textContent = msg;
    notif.classList.remove('hidden');
}

// Financial year change
function onFinancialYearChange() {
    // optional logic
}

// Trigger Excel Import Click
function triggerExcelImport() {
    document.getElementById('excel-import-file').click();
}

// Load specific plan into spreadsheet editor
async function openPlanEditor(planId, wizardParams = null) {
    showLoader(true, "Loading planning workspace...");

    editorUndoStack = [];
    editorRedoStack = [];
    updateUndoRedoButtons();

    try {
        const response = await fetch(`/api/planning/plans/${planId}`);
        const data = await response.json();

        if (response.ok && data.success) {
            appState.currentPlan = data.plan;

            // Format details rows
            appState.currentPlanDetails = data.details.map(d => ({
                month: d.month,
                last_year_qty: parseInt(d.last_year_qty || 0),
                growth_percent: parseFloat(d.growth_percent || 0),
                sales_target: parseFloat(d.sales_target || 0),
                average_sale_value: parseFloat(d.average_sale_value || 0),
                calculated_qty: parseInt(d.calculated_qty || 0),
                manual_adjustment: parseInt(d.manual_adjustment || 0),
                festival_qty: parseInt(d.festival_qty || 0),
                new_store_qty: parseInt(d.new_store_qty || 0),
                final_qty: parseInt(d.final_qty || 0),
                remarks: d.remarks || '',
                locked: d.locked === true || d.locked === 'true' // persistent lock state
            }));

            // Check if there are method parameters to apply for initial creation
            if (wizardParams) {
                const methodNum = appState.selectedPlanningMethod;

                if (methodNum === 2) {
                    // Manual Sales Value Target: prefill ASP
                    appState.currentPlanDetails.forEach(d => {
                        d.average_sale_value = wizardParams.asp;
                        recalculateRowQty(d, 2);
                    });
                } else if (methodNum === 3) {
                    // Growth % bulk fill
                    appState.currentPlanDetails.forEach(d => {
                        d.growth_percent = wizardParams.growth;
                        recalculateRowQty(d, 3);
                    });
                } else if (methodNum === 4) {
                    // Manual quantity entry: prefill with 0
                    appState.currentPlanDetails.forEach(d => {
                        d.last_year_qty = 0;
                        d.growth_percent = 0;
                        d.manual_adjustment = 0;
                        d.final_qty = 0;
                    });
                } else if (methodNum === 5) {
                    // Copy existing plan: copy details from chosen plan
                    showLoader(true, "Cloning scenario quantities...");
                    const cloneResponse = await fetch(`/api/planning/plans/${wizardParams.sourcePlanId}`);
                    const cloneData = await cloneResponse.json();
                    if (cloneResponse.ok && cloneData.success) {
                        appState.currentPlanDetails.forEach(d => {
                            const cloneRow = cloneData.details.find(cd => cd.month === d.month);
                            if (cloneRow) {
                                d.last_year_qty = parseInt(cloneRow.last_year_qty || 0);
                                d.growth_percent = parseFloat(cloneRow.growth_percent || 0);
                                d.sales_target = parseFloat(cloneRow.sales_target || 0);
                                d.average_sale_value = parseFloat(cloneRow.average_sale_value || 0);
                                d.calculated_qty = parseInt(cloneRow.calculated_qty || 0);
                                d.manual_adjustment = parseInt(cloneRow.manual_adjustment || 0);
                                d.festival_qty = parseInt(cloneRow.festival_qty || 0);
                                d.new_store_qty = parseInt(cloneRow.new_store_qty || 0);
                                d.final_qty = parseInt(cloneRow.final_qty || 0);
                                d.remarks = cloneRow.remarks || '';
                            }
                        });
                    }
                } else if (methodNum === 6) {
                    // Average of previous years
                    showLoader(true, "Calculating past years averages...");
                    const avgResponse = await fetch(`/api/planning/historical?fy=${appState.currentPlan.financial_year}&method=average`);
                    const avgData = await avgResponse.json();
                    if (avgResponse.ok && avgData.success) {
                        appState.currentPlanDetails.forEach(d => {
                            d.last_year_qty = avgData.quantities[d.month] || 0;
                            d.final_qty = d.last_year_qty;
                        });
                    }
                } else if (methodNum === 7) {
                    // Seasonality Planning
                    const totalQty = wizardParams.annualQty;
                    appState.currentPlanDetails.forEach(d => {
                        const pct = DEFAULT_SEASONALITY[d.month] || 8.33;
                        d.manual_adjustment = Math.round(totalQty * (pct / 100));
                        recalculateRowQty(d, 7);
                    });
                } else if (methodNum === 8) {
                    // Contribution based monthly share planning
                    let totalLYQty = appState.currentPlanDetails.reduce((sum, d) => sum + d.last_year_qty, 0);
                    if (totalLYQty === 0) totalLYQty = 1; // avoid division by zero

                    const totalPlanned = wizardParams.annualQty;
                    appState.currentPlanDetails.forEach(d => {
                        const pct = d.last_year_qty / totalLYQty;
                        d.manual_adjustment = Math.round(totalPlanned * pct);
                        recalculateRowQty(d, 8);
                    });
                }
            }

            // Cache original loaded copy for cells highlight checks
            appState.originalPlanDetails = JSON.parse(JSON.stringify(appState.currentPlanDetails));

            // Set header labels
            document.getElementById('editor-plan-title').textContent = `${appState.currentPlan.plan_name}`;
            document.getElementById('editor-plan-subtitle').textContent = `Method: ${appState.currentPlan.planning_method} | Version: v${appState.currentPlan.version} | Status: ${appState.currentPlan.status}`;

            // Toggle method 9 columns visibility
            const isMethod9 = appState.currentPlan.planning_method.includes("Method 9");
            const m9cols = document.querySelectorAll('.method9-col');
            m9cols.forEach(el => {
                if (isMethod9) {
                    el.classList.remove('hidden');
                } else {
                    el.classList.add('hidden');
                }
            });

            renderPlanningEditorRows();

            document.getElementById('planning-dashboard-view').classList.add('hidden');
            document.getElementById('planning-editor-view').classList.remove('hidden');
        } else {
            alert("Error loading plan details: " + data.message);
        }
    } catch (err) {
        console.error("Open plan editor failed:", err);
        alert("Failed to retrieve plan details.");
    } finally {
        showLoader(false);
    }
}

// Recalculate cell row quantities
function recalculateRowQty(row, methodNum = null) {
    // 1. Calculated Qty = Sales Target / average selling price
    if (row.average_sale_value > 0) {
        row.calculated_qty = Math.round(row.sales_target / row.average_sale_value);
    } else {
        row.calculated_qty = 0;
    }

    // Unified Formula: Final Qty = Calculated Qty + Last Year Qty * (1 + Growth%/100) + Manual Adj + Festival Qty + New Store Qty
    // However, if it's Method 2 (Sales Target), the calculated quantity represents the target final volume,
    // so we set Final Qty = Calculated Qty + Manual Adjustment.
    // If it's other methods, Sales Target is usually 0, so Calculated Qty is 0.

    let baseQty = 0;
    const isMethod2 = appState.currentPlan && appState.currentPlan.planning_method.includes("Method 2");

    if (isMethod2 || methodNum === 2) {
        baseQty = row.calculated_qty;
    } else {
        baseQty = Math.round(row.last_year_qty * (1 + row.growth_percent / 100));
    }

    row.final_qty = baseQty + row.manual_adjustment + row.festival_qty + row.new_store_qty;

    // Validation: no negative quantity
    if (row.final_qty < 0) {
        row.final_qty = 0;
    }
}

// Render Monthly editor table spreadsheet rows
function renderPlanningEditorRows() {
    const tbody = document.getElementById('planning-editor-body');
    tbody.innerHTML = '';

    const isMethod9 = appState.currentPlan.planning_method.includes("Method 9");
    const isMethod2 = appState.currentPlan.planning_method.includes("Method 2");

    appState.currentPlanDetails.forEach((row, index) => {
        const tr = document.createElement('tr');
        if (row.locked) {
            tr.className = 'row-locked';
        }

        // Find if cell was edited relative to database original state
        const origRow = appState.originalPlanDetails[index] || {};

        const isGrowthEdited = row.growth_percent !== origRow.growth_percent;
        const isSalesTargetEdited = row.sales_target !== origRow.sales_target;
        const isAspEdited = row.average_sale_value !== origRow.average_sale_value;
        const isManualEdited = row.manual_adjustment !== origRow.manual_adjustment;
        const isFestivalEdited = row.festival_qty !== origRow.festival_qty;
        const isNewStoreEdited = row.new_store_qty !== origRow.new_store_qty;
        const isRemarksEdited = row.remarks !== origRow.remarks;

        tr.innerHTML = `
            <td><strong>${row.month}</strong></td>
            
            <td class="text-right"><strong>${row.last_year_qty.toLocaleString()}</strong></td>
            
            <td class="${isGrowthEdited ? 'cell-edited' : ''}">
                <input type="number" step="any" class="spreadsheet-cell-input text-right" 
                    value="${row.growth_percent}" 
                    onchange="onEditorCellChange('${row.month}', 'growth_percent', this.value)"
                    ${row.locked ? 'disabled' : ''} ${isMethod2 ? 'disabled' : ''}>
            </td>
            
            <td class="${isSalesTargetEdited ? 'cell-edited' : ''}">
                <input type="number" step="any" class="spreadsheet-cell-input text-right" 
                    value="${row.sales_target}" 
                    onchange="onEditorCellChange('${row.month}', 'sales_target', this.value)"
                    ${row.locked ? 'disabled' : ''}>
            </td>
            
            <td class="${isAspEdited ? 'cell-edited' : ''}">
                <input type="number" step="any" class="spreadsheet-cell-input text-right" 
                    value="${row.average_sale_value}" 
                    onchange="onEditorCellChange('${row.month}', 'average_sale_value', this.value)"
                    ${row.locked ? 'disabled' : ''}>
            </td>
            
            <td class="text-right"><code>${row.calculated_qty.toLocaleString()}</code></td>
            
            <td class="${isManualEdited ? 'cell-edited' : ''}">
                <input type="number" class="spreadsheet-cell-input text-right" 
                    value="${row.manual_adjustment}" 
                    onchange="onEditorCellChange('${row.month}', 'manual_adjustment', this.value)"
                    ${row.locked ? 'disabled' : ''}>
            </td>
            
            <td class="method9-col ${isMethod9 ? '' : 'hidden'} ${isFestivalEdited ? 'cell-edited' : ''}">
                <input type="number" class="spreadsheet-cell-input text-right" 
                    value="${row.festival_qty}" 
                    onchange="onEditorCellChange('${row.month}', 'festival_qty', this.value)"
                    ${row.locked ? 'disabled' : ''}>
            </td>
            
            <td class="method9-col ${isMethod9 ? '' : 'hidden'} ${isNewStoreEdited ? 'cell-edited' : ''}">
                <input type="number" class="spreadsheet-cell-input text-right" 
                    value="${row.new_store_qty}" 
                    onchange="onEditorCellChange('${row.month}', 'new_store_qty', this.value)"
                    ${row.locked ? 'disabled' : ''}>
            </td>
            
            <td class="text-right" style="font-weight:700;">${row.final_qty.toLocaleString()}</td>
            
            <td class="${isRemarksEdited ? 'cell-edited' : ''}">
                <input type="text" class="spreadsheet-cell-input" 
                    value="${row.remarks}" 
                    onchange="onEditorCellChange('${row.month}', 'remarks', this.value)"
                    ${row.locked ? 'disabled' : ''}>
            </td>
            
            <td style="text-align: center;">
                <button class="cell-lock-btn ${row.locked ? 'locked' : ''}" onclick="toggleMonthLock('${row.month}')" title="${row.locked ? 'Unlock Month' : 'Lock Month'}">
                    <i class="fa-solid ${row.locked ? 'fa-lock' : 'fa-lock-open'}"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    recalculateTotals();
}

// Recalculate columns sum and average
function recalculateTotals() {
    let lastYearQtySum = 0;
    let growthPctSum = 0;
    let growthCount = 0;
    let salesTargetSum = 0;
    let averageSaleValueSum = 0;
    let averageSaleValueCount = 0;
    let calculatedQtySum = 0;
    let manualAdjSum = 0;
    let festivalQtySum = 0;
    let newStoreQtySum = 0;
    let finalQtySum = 0;

    appState.currentPlanDetails.forEach(row => {
        lastYearQtySum += row.last_year_qty;

        if (row.last_year_qty > 0) {
            growthPctSum += row.growth_percent;
            growthCount++;
        }

        salesTargetSum += row.sales_target;

        if (row.average_sale_value > 0) {
            averageSaleValueSum += row.average_sale_value;
            averageSaleValueCount++;
        }

        calculatedQtySum += row.calculated_qty;
        manualAdjSum += row.manual_adjustment;
        festivalQtySum += row.festival_qty;
        newStoreQtySum += row.new_store_qty;
        finalQtySum += row.final_qty;
    });

    const avgGrowth = growthCount > 0 ? (growthPctSum / growthCount) : 0;
    const avgSaleValue = averageSaleValueCount > 0 ? (averageSaleValueSum / averageSaleValueCount) : 0;

    document.getElementById('total-last-year-qty').textContent = lastYearQtySum.toLocaleString();
    document.getElementById('avg-growth-pct').textContent = `${avgGrowth.toFixed(1)}%`;
    document.getElementById('total-sales-target').textContent = `₹${salesTargetSum.toLocaleString()}`;
    document.getElementById('avg-avg-sale-value').textContent = `₹${avgSaleValue.toFixed(2)}`;
    document.getElementById('total-calculated-qty').textContent = calculatedQtySum.toLocaleString();
    document.getElementById('total-manual-adjustment').textContent = manualAdjSum.toLocaleString();
    document.getElementById('total-festival-qty').textContent = festivalQtySum.toLocaleString();
    document.getElementById('total-new-store-qty').textContent = newStoreQtySum.toLocaleString();

    const totalFinalEl = document.getElementById('total-final-qty');
    totalFinalEl.textContent = finalQtySum.toLocaleString();
}

// Month cell lock toggle
function toggleMonthLock(monthName) {
    const row = appState.currentPlanDetails.find(d => d.month === monthName);
    if (row) {
        row.locked = !row.locked;
        renderPlanningEditorRows();
    }
}

// cell edited event handler
function onEditorCellChange(monthName, fieldName, rawValue) {
    const row = appState.currentPlanDetails.find(d => d.month === monthName);
    if (!row) return;

    // Save state for undo
    pushUndoState();

    // Validate inputs
    let value = rawValue;
    if (fieldName === 'growth_percent' || fieldName === 'sales_target' || fieldName === 'average_sale_value' || fieldName === 'manual_adjustment' || fieldName === 'festival_qty' || fieldName === 'new_store_qty') {
        value = parseFloat(rawValue);
        if (isNaN(value)) {
            value = 0;
        }

        // Logical validations
        if (fieldName === 'sales_target' && value < 0) {
            alert("Sales Target cannot be negative.");
            value = 0;
        }
        if (fieldName === 'average_sale_value' && value < 0) {
            alert("Average Selling Price must be greater than 0.");
            value = 0;
        }
    }

    row[fieldName] = value;

    // Recalculate row quantity
    recalculateRowQty(row);

    // Re-render rows
    renderPlanningEditorRows();

    // Trigger background debounced auto-save
    triggerAutoSave();
}

// Push current state to undo stack
function pushUndoState() {
    const snapshot = JSON.parse(JSON.stringify(appState.currentPlanDetails));
    editorUndoStack.push(snapshot);
    editorRedoStack = []; // clear redo
    updateUndoRedoButtons();
}

// Undo action
function handleUndo() {
    if (editorUndoStack.length === 0) return;
    const current = JSON.parse(JSON.stringify(appState.currentPlanDetails));
    editorRedoStack.push(current);

    appState.currentPlanDetails = editorUndoStack.pop();
    renderPlanningEditorRows();
    updateUndoRedoButtons();
    triggerAutoSave();
}

// Redo action
function handleRedo() {
    if (editorRedoStack.length === 0) return;
    const current = JSON.parse(JSON.stringify(appState.currentPlanDetails));
    editorUndoStack.push(current);

    appState.currentPlanDetails = editorRedoStack.pop();
    renderPlanningEditorRows();
    updateUndoRedoButtons();
    triggerAutoSave();
}

// Update toolbar Undo/Redo visual state
function updateUndoRedoButtons() {
    document.getElementById('btn-undo').disabled = editorUndoStack.length === 0;
    document.getElementById('btn-redo').disabled = editorRedoStack.length === 0;
}

// Debounced auto save
function triggerAutoSave() {
    const statusEl = document.getElementById('editor-auto-save-status');
    statusEl.textContent = "Typing...";
    statusEl.style.color = "var(--accent-orange)";

    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(async () => {
        statusEl.textContent = "Saving draft...";
        statusEl.style.color = "var(--accent-blue)";
        const success = await savePlanScenarioDraftSilent();
        if (success) {
            statusEl.textContent = "Draft Auto-saved";
            statusEl.style.color = "var(--accent-green)";
        } else {
            statusEl.textContent = "Save failed";
            statusEl.style.color = "var(--accent-red)";
        }
    }, 1500); // 1.5 seconds delay after user stops typing
}

// Save draft silently (does not exit nor show screen loaders)
async function savePlanScenarioDraftSilent() {
    if (!appState.currentPlan) return false;

    try {
        const response = await fetch(`/api/planning/plans/${appState.currentPlan.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                header: {
                    remarks: appState.currentPlan.remarks,
                    status: 'Draft',
                    planning_method: appState.currentPlan.planning_method
                },
                details: appState.currentPlanDetails
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            // Important: update current header ID since every save creates a new version ID
            appState.currentPlan.id = data.plan_id;
            appState.currentPlan.version = data.version;

            // Update subtitle version number
            document.getElementById('editor-plan-subtitle').textContent = `Method: ${appState.currentPlan.planning_method} | Version: v${data.version} | Status: Draft`;
            return true;
        }
        return false;
    } catch (err) {
        console.error("Auto save failed:", err);
        return false;
    }
}

// Manual Save Draft (button click)
async function savePlanScenarioDraft() {
    showLoader(true, "Saving draft scenario...");
    const success = await savePlanScenarioDraftSilent();
    showLoader(false);
    if (success) {
        alert("Scenario draft saved successfully as version v" + appState.currentPlan.version + "!");
        // Refresh details list and version highlights
        await openPlanEditor(appState.currentPlan.id);
    } else {
        alert("Failed to save scenario draft.");
    }
}

// Set plan as Final from editor screen
async function setPlanAsFinalFromEditor() {
    if (!appState.currentPlan) return;

    // First save current edits
    showLoader(true, "Saving current changes...");
    const success = await savePlanScenarioDraftSilent();
    if (!success) {
        showLoader(false);
        alert("Could not set as Final because saving failed.");
        return;
    }

    showLoader(true, "Setting plan to Final...");
    try {
        const response = await fetch(`/api/planning/plans/${appState.currentPlan.id}/final`, {
            method: 'PUT'
        });
        const data = await response.json();

        if (response.ok && data.success) {
            showLoader(false);
            alert(data.message);
            await openPlanEditor(appState.currentPlan.id);
        } else {
            showLoader(false);
            alert("Error setting plan as Final: " + data.message);
        }
    } catch (err) {
        showLoader(false);
        console.error(err);
        alert("Network error.");
    }
}

// Set plan as Final directly from dashboard list
async function setPlanAsFinal(planId) {
    showLoader(true, "Activating scenario as Final Plan...");
    try {
        const response = await fetch(`/api/planning/plans/${planId}/final`, {
            method: 'PUT'
        });
        const data = await response.json();

        if (response.ok && data.success) {
            showLoader(false);
            alert(data.message);
            await fetchPlanningScenarios();
        } else {
            showLoader(false);
            alert("Failed to set final: " + data.message);
        }
    } catch (err) {
        showLoader(false);
        console.error(err);
        alert("Network error.");
    }
}

// Copy plan scenario (Version iterations)
async function copyPlanScenario(planId) {
    const newName = prompt("Enter a name for the new cloned planning scenario:");
    if (!newName || !newName.trim()) return;

    showLoader(true, "Copying planning scenario...");
    try {
        const response = await fetch(`/api/planning/plans/${planId}/copy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                plan_name: newName.trim()
            })
        });
        const data = await response.json();

        if (response.ok && data.success) {
            showLoader(false);
            alert("Scenario cloned successfully!");
            await fetchPlanningScenarios();
        } else {
            showLoader(false);
            alert("Failed to clone: " + data.message);
        }
    } catch (err) {
        showLoader(false);
        console.error(err);
        alert("Network error.");
    }
}

// Delete scenario
async function deletePlanScenario(planId) {
    if (!confirm("Are you sure you want to delete this scenario? This will delete ALL versions of this plan.")) {
        return;
    }

    showLoader(true, "Deleting planning scenario...");
    try {
        const response = await fetch(`/api/planning/plans/${planId}`, {
            method: 'DELETE'
        });
        const data = await response.json();

        if (response.ok && data.success) {
            showLoader(false);
            alert(data.message);
            await fetchPlanningScenarios();
        } else {
            showLoader(false);
            alert("Failed to delete scenario: " + data.message);
        }
    } catch (err) {
        showLoader(false);
        console.error(err);
        alert("Network error.");
    }
}

// Bulk Action: Copy values from previous month
function bulkActionCopyPrevious() {
    pushUndoState();

    // Run month-by-month copying starting from May (index 1)
    for (let i = 1; i < MONTH_ORDER.length; i++) {
        const currentMonth = MONTH_ORDER[i];
        const prevMonth = MONTH_ORDER[i - 1];

        const currentRow = appState.currentPlanDetails.find(d => d.month === currentMonth);
        const prevRow = appState.currentPlanDetails.find(d => d.month === prevMonth);

        // Copy only if current month is unlocked
        if (currentRow && prevRow && !currentRow.locked) {
            currentRow.growth_percent = prevRow.growth_percent;
            currentRow.sales_target = prevRow.sales_target;
            currentRow.average_sale_value = prevRow.average_sale_value;
            currentRow.manual_adjustment = prevRow.manual_adjustment;
            currentRow.festival_qty = prevRow.festival_qty;
            currentRow.new_store_qty = prevRow.new_store_qty;
            currentRow.remarks = prevRow.remarks;

            recalculateRowQty(currentRow);
        }
    }

    renderPlanningEditorRows();
    triggerAutoSave();
    alert("Copied values from preceding months for all unlocked columns.");
}

// Open bulk fill popup
function openBulkFillModal() {
    document.getElementById('bulk-fill-value').value = '';
    document.getElementById('bulk-fill-modal').classList.remove('hidden');
}

function closeBulkFillModal() {
    document.getElementById('bulk-fill-modal').classList.add('hidden');
}

// Apply bulk fill value to unlocked months
function applyBulkFill() {
    const col = document.getElementById('bulk-fill-column').value;
    const val = parseFloat(document.getElementById('bulk-fill-value').value);

    if (isNaN(val)) {
        alert("Please enter a valid numeric value.");
        return;
    }

    if (col === 'sales_target' && val < 0) {
        alert("Sales Target cannot be negative.");
        return;
    }
    if (col === 'average_sale_value' && val <= 0) {
        alert("Average Sale Value must be greater than 0.");
        return;
    }

    pushUndoState();

    appState.currentPlanDetails.forEach(row => {
        if (!row.locked) {
            row[col] = val;
            recalculateRowQty(row);
        }
    });

    closeBulkFillModal();
    renderPlanningEditorRows();
    triggerAutoSave();
}

// Show Version History List
async function showVersionHistory(planId) {
    showLoader(true, "Loading version logs...");
    try {
        const response = await fetch(`/api/planning/plans/${planId}`);
        const data = await response.json();

        if (response.ok && data.success) {
            document.getElementById('version-history-plan-name').textContent = `Plan Scenario: ${data.plan.plan_name} (${data.plan.financial_year})`;

            const tbody = document.getElementById('version-history-body');
            tbody.innerHTML = '';

            data.versions.forEach(v => {
                const tr = document.createElement('tr');
                const mDate = v.modified_date ? new Date(v.modified_date).toLocaleString() : 'N/A';

                tr.innerHTML = `
                    <td><strong>v${v.version}</strong></td>
                    <td><span class="table-badge ${v.status === 'Final' ? 'running' : 'stopped'}">${v.status}</span></td>
                    <td>${mDate}</td>
                    <td>${v.created_by}</td>
                    <td style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${v.remarks || ''}</td>
                    <td class="text-right">
                        <button class="btn btn-outline btn-xs" onclick="restorePlanVersion(${v.id})" ${data.plan.version === v.version ? 'disabled' : ''}>
                            <i class="fa-solid fa-clock-rotate-left"></i> Restore
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            document.getElementById('version-history-modal').classList.remove('hidden');
        } else {
            alert("Failed to load versions: " + data.message);
        }
    } catch (err) {
        console.error(err);
    } finally {
        showLoader(false);
    }
}

function closeVersionHistoryModal() {
    document.getElementById('version-history-modal').classList.add('hidden');
}

// Restore a historical version
async function restorePlanVersion(versionId) {
    if (!confirm("Are you sure you want to restore this historical version? This will clone this state into a new version.")) {
        return;
    }

    showLoader(true, "Restoring planning version...");
    try {
        // Fetch target version data
        const getRes = await fetch(`/api/planning/plans/${versionId}`);
        const getData = await getRes.json();

        if (getRes.ok && getData.success) {
            // Save as a new version
            const putRes = await fetch(`/api/planning/plans/${appState.currentPlan ? appState.currentPlan.id : versionId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    header: {
                        remarks: `Restored Version v${getData.plan.version} state. Original remarks: ${getData.plan.remarks}`,
                        status: 'Draft',
                        planning_method: getData.plan.planning_method
                    },
                    details: getData.details
                })
            });
            const putData = await putRes.json();

            if (putRes.ok && putData.success) {
                closeVersionHistoryModal();
                showLoader(false);
                alert("Version restored successfully! Loaded restored state in editor.");
                await openPlanEditor(putData.plan_id);
            } else {
                showLoader(false);
                alert("Failed to restore version: " + putData.message);
            }
        } else {
            showLoader(false);
            alert("Error loading version data.");
        }
    } catch (err) {
        showLoader(false);
        console.error(err);
        alert("Network error.");
    }
}

// Scenario comparison page
async function compareSelectedPlans() {
    const checkedBoxes = document.querySelectorAll('.scenario-compare-checkbox:checked');
    const ids = Array.from(checkedBoxes).map(cb => parseInt(cb.value));

    showLoader(true, "Compiling comparison reports...");

    try {
        // Fetch details of all selected plans
        const fetches = ids.map(id => fetch(`/api/planning/plans/${id}`).then(r => r.json()));
        const results = await Promise.all(fetches);

        const validResults = results.filter(r => r.success);
        if (validResults.length < 2) {
            showLoader(false);
            alert("Failed to load details for comparison.");
            return;
        }

        // Populate Comparison Subtitle (Financial Year should match, otherwise show both)
        const fySet = new Set(validResults.map(r => r.plan.financial_year));
        document.getElementById('comparison-subtitle').textContent = `Financial Year: ${Array.from(fySet).join(', ')}`;

        // Matrix Header
        const headRow = document.getElementById('comparison-matrix-head');
        headRow.innerHTML = '';
        const trHead = document.createElement('tr');
        trHead.innerHTML = '<th>Month</th>';

        validResults.forEach(r => {
            trHead.innerHTML += `<th class="text-right">${r.plan.plan_name} <span class="badge" style="font-size:9px;">v${r.plan.version}</span></th>`;
        });

        // Add Difference, Variance columns if exactly 2 plans
        const isTwoPlans = validResults.length === 2;
        if (isTwoPlans) {
            trHead.innerHTML += '<th class="text-right" style="color:var(--accent-orange);">Difference (Qty)</th>';
            trHead.innerHTML += '<th class="text-right" style="color:var(--accent-purple);">Variance (%)</th>';
        }

        headRow.appendChild(trHead);

        // Matrix Rows
        const tbody = document.getElementById('comparison-matrix-body');
        tbody.innerHTML = '';

        MONTH_ORDER.forEach(m => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td><strong>${m}</strong></td>`;

            let vals = [];
            validResults.forEach(r => {
                const monthRow = r.details.find(d => d.month === m);
                const finalQty = monthRow ? parseInt(monthRow.final_qty || 0) : 0;
                vals.push(finalQty);
                tr.innerHTML += `<td class="text-right">${finalQty.toLocaleString()}</td>`;
            });

            if (isTwoPlans) {
                const diff = vals[0] - vals[1];
                const base = vals[1] === 0 ? 1 : vals[1]; // avoid zero division
                const pct = (diff / base) * 100;

                const growthClass = diff >= 0 ? 'comparison-growth-positive' : 'comparison-growth-negative';
                const sign = diff >= 0 ? '+' : '';

                tr.innerHTML += `<td class="text-right ${growthClass}">${sign}${diff.toLocaleString()}</td>`;
                tr.innerHTML += `<td class="text-right ${growthClass}">${sign}${pct.toFixed(1)}%</td>`;
            }

            tbody.appendChild(tr);
        });

        // Totals Footer Row
        const tfoot = document.getElementById('comparison-matrix-foot');
        tfoot.innerHTML = '';
        const trFoot = document.createElement('tr');
        trFoot.className = 'totals-row';
        trFoot.innerHTML = '<td><strong>Total Quantity</strong></td>';

        let totals = [];
        validResults.forEach(r => {
            const sum = r.details.reduce((s, d) => s + parseInt(d.final_qty || 0), 0);
            totals.push(sum);
            trFoot.innerHTML += `<td class="text-right" style="font-weight: 800;">${sum.toLocaleString()}</td>`;
        });

        if (isTwoPlans) {
            const totalDiff = totals[0] - totals[1];
            const base = totals[1] === 0 ? 1 : totals[1];
            const totalPct = (totalDiff / base) * 100;

            const growthClass = totalDiff >= 0 ? 'comparison-growth-positive' : 'comparison-growth-negative';
            const sign = totalDiff >= 0 ? '+' : '';

            trFoot.innerHTML += `<td class="text-right ${growthClass}" style="font-weight: 800;">${sign}${totalDiff.toLocaleString()}</td>`;
            trFoot.innerHTML += `<td class="text-right ${growthClass}" style="font-weight: 800;">${sign}${totalPct.toFixed(1)}%</td>`;
        }
        tfoot.appendChild(trFoot);

        // Render comparison line chart
        renderComparisonChart(validResults);

        document.getElementById('planning-dashboard-view').classList.add('hidden');
        document.getElementById('planning-compare-view').classList.remove('hidden');
    } catch (err) {
        console.error("Comparison compiling error:", err);
    } finally {
        showLoader(false);
    }
}

// Chart.js render comparison chart
function renderComparisonChart(plansData) {
    const ctx = document.getElementById('comparisonChart').getContext('2d');
    if (comparisonChart) {
        comparisonChart.destroy();
    }

    const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899'];
    const datasets = plansData.map((p, idx) => {
        // Quantities array ordered by MONTH_ORDER
        const qtys = MONTH_ORDER.map(m => {
            const monthRow = p.details.find(d => d.month === m);
            return monthRow ? parseInt(monthRow.final_qty || 0) : 0;
        });

        return {
            label: `${p.plan.plan_name} (v${p.plan.version})`,
            data: qtys,
            borderColor: colors[idx % colors.length],
            borderWidth: 3,
            fill: false,
            tension: 0.3,
            pointRadius: 4
        };
    });

    comparisonChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: MONTH_ORDER,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { boxWidth: 15 }
                }
            },
            scales: {
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { callback: val => val.toLocaleString() }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
}

// Export specific plan to Excel file client-side using SheetJS
function exportPlanExcel() {
    if (!appState.currentPlan) return;

    // Prepare data structure
    const data = appState.currentPlanDetails.map(d => ({
        'Month': d.month,
        'Last Year Qty': d.last_year_qty,
        'Growth %': d.growth_percent,
        'Sales Target (INR)': d.sales_target,
        'Avg Sale Value (INR)': d.average_sale_value,
        'Calculated Qty': d.calculated_qty,
        'Manual Adjustment': d.manual_adjustment,
        'Festival Qty': d.festival_qty,
        'New Store Qty': d.new_store_qty,
        'Final Qty': d.final_qty,
        'Remarks': d.remarks
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Quantity Plan");

    // Fit columns width
    const wscols = [
        { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 18 }, { wch: 20 }, { wch: 14 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 25 }
    ];
    worksheet['!cols'] = wscols;

    // Filename
    const sanitizedName = appState.currentPlan.plan_name.replace(/\s+/g, '_').toLowerCase();
    const filename = `${sanitizedName}_v${appState.currentPlan.version}_export.xlsx`;

    XLSX.writeFile(workbook, filename);
}

// Parse Imported Excel and load into editor using SheetJS client-side
function handleExcelImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const dataBytes = new Uint8Array(e.target.result);
            const workbook = XLSX.read(dataBytes, { type: 'array' });

            // Assume first sheet
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            const rows = XLSX.utils.sheet_to_json(worksheet);

            if (rows.length < 12) {
                alert("Invalid Excel structure. The file must contain at least 12 monthly rows.");
                return;
            }

            // Check plan name in Excel file if exists or create a new plan
            const planName = file.name.split('.')[0] + " Import";

            // Create a new manual plan and load values
            showLoader(true, "Creating imported planning scenario...");
            const response = await fetch('/api/planning/plans', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    plan_name: planName,
                    financial_year: 'FY 2027-28', // default
                    planning_method: 'Method 4: Manual Quantity Entry',
                    remarks: `Imported from Excel file ${file.name}`
                })
            });

            const createData = await response.json();
            showLoader(false);

            if (response.ok && createData.success) {
                // Open newly created plan
                await openPlanEditor(createData.plan_id);

                // Overwrite loaded values with Excel values
                pushUndoState();

                appState.currentPlanDetails.forEach(d => {
                    // find matching row in excel by month
                    const excelRow = rows.find(r => String(r.Month || r.month || '').trim().toLowerCase() === d.month.toLowerCase());
                    if (excelRow) {
                        d.last_year_qty = parseInt(excelRow['Last Year Qty'] || excelRow['last_year_qty'] || d.last_year_qty || 0);
                        d.growth_percent = parseFloat(excelRow['Growth %'] || excelRow['growth_percent'] || 0);
                        d.sales_target = parseFloat(excelRow['Sales Target (INR)'] || excelRow['sales_target'] || 0);
                        d.average_sale_value = parseFloat(excelRow['Avg Sale Value (INR)'] || excelRow['average_sale_value'] || 0);
                        d.manual_adjustment = parseInt(excelRow['Manual Adjustment'] || excelRow['manual_adjustment'] || 0);
                        d.festival_qty = parseInt(excelRow['Festival Qty'] || excelRow['festival_qty'] || 0);
                        d.new_store_qty = parseInt(excelRow['New Store Qty'] || excelRow['new_store_qty'] || 0);
                        d.remarks = String(excelRow['Remarks'] || excelRow['remarks'] || '');

                        recalculateRowQty(d);
                    }
                });

                renderPlanningEditorRows();
                triggerAutoSave();
                alert("Excel data successfully imported and calculated in spreadsheet editor!");
            } else {
                alert("Failed to initialize import plan: " + createData.message);
            }
        } catch (err) {
            console.error("Excel import failed:", err);
            alert("Error reading Excel file. Check format and try again.");
        }
    };
    reader.readAsArrayBuffer(file);

    // Reset file input value
    event.target.value = '';
}

// Export plan editor page as PDF
function exportPlanPDF() {
    if (!appState.currentPlan) return;

    const editorEl = document.getElementById('planning-editor-view');

    // Configuration for html2pdf
    const opt = {
        margin: 10,
        filename: `${appState.currentPlan.plan_name.replace(/\s+/g, '_').toLowerCase()}_report.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, backgroundColor: '#0a0f1d' }, // match dashboard background color
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    };

    showLoader(true, "Generating PDF Scenario Report...");

    // Temporarily hide buttons and locks columns for print view
    const lockBtns = document.querySelectorAll('.cell-lock-btn');
    lockBtns.forEach(b => b.style.display = 'none');

    html2pdf().set(opt).from(editorEl).save().then(() => {
        showLoader(false);
        // restore buttons visible
        lockBtns.forEach(b => b.style.display = 'inline-block');
    }).catch(err => {
        showLoader(false);
        console.error(err);
        lockBtns.forEach(b => b.style.display = 'inline-block');
    });
}

// Export Comparison Page matrix to Excel
function exportComparisonExcel() {
    const table = document.getElementById('comparison-matrix-table');
    const worksheet = XLSX.utils.table_to_sheet(table);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Plan Comparison");

    XLSX.writeFile(workbook, "scenario_comparison_report.xlsx");
}

// Export Comparison Page matrix & chart to PDF
function exportComparisonPDF() {
    const viewEl = document.getElementById('planning-compare-view');

    const opt = {
        margin: 10,
        filename: `scenario_comparison_report.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, backgroundColor: '#0a0f1d' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    };

    showLoader(true, "Generating PDF Comparison Report...");

    html2pdf().set(opt).from(viewEl).save().then(() => {
        showLoader(false);
    }).catch(err => {
        showLoader(false);
        console.error(err);
    });
}


// =====================================================================
// COLOR & SIZE MASTER CONTROLLERS
// =====================================================================

// Masters Cache
let loadedColors = [];
let loadedSizes = [];

async function initializeColorMasterTab() {
    document.getElementById('color-master-search').value = '';
    if (document.getElementById('color-filter-category')) {
        document.getElementById('color-filter-category').value = '';
    }
    if (document.getElementById('color-filter-status')) {
        document.getElementById('color-filter-status').value = '';
    }
    await fetchColorsMaster();
}

async function fetchColorsMaster() {
    const loader = document.getElementById('color-master-loader');
    const empty = document.getElementById('color-master-empty');
    const tbody = document.getElementById('color-master-table-body');

    if (loader) loader.classList.remove('hidden');
    if (empty) empty.classList.add('hidden');
    tbody.innerHTML = '';

    // Get filter values
    const categoryFilter = document.getElementById('color-filter-category')?.value || '';
    const statusFilter = document.getElementById('color-filter-status')?.value || '';
    const searchVal = document.getElementById('color-master-search')?.value.trim() || '';

    try {
        const queryParams = new URLSearchParams({
            search: searchVal,
            category: categoryFilter,
            status: statusFilter
        });
        const response = await fetch(`/api/masters/colors?${queryParams.toString()}`);
        const data = await response.json();
        if (response.ok && data.success) {
            loadedColors = data.colors || [];
            renderColorsList(loadedColors);
        } else {
            console.error("Failed to load color master list:", data.message);
        }
    } catch (err) {
        console.error("Colors master fetch error:", err);
    } finally {
        if (loader) loader.classList.add('hidden');
    }
}

function renderColorsList(colors) {
    const tbody = document.getElementById('color-master-table-body');
    const empty = document.getElementById('color-master-empty');
    tbody.innerHTML = '';

    if (colors.length === 0) {
        if (empty) empty.classList.remove('hidden');
        return;
    }
    if (empty) empty.classList.add('hidden');

    colors.forEach(item => {
        const tr = document.createElement('tr');
        const statusClass = item.status === 'Active' ? 'running' : 'stopped';
        const categoryClass = item.category === 'Primary' ? 'running' : 'badge-outline';

        tr.innerHTML = `
            <td><strong>${item.global_color_code}</strong></td>
            <td>${item.display_color}</td>
            <td><span class="table-badge ${categoryClass}">${item.category}</span></td>
            <td><span class="table-badge ${statusClass}">${item.status}</span></td>
            <td class="text-right">
                <div class="actions-cell">
                    <button class="btn-action btn-edit" onclick="openEditColorModal(${item.id}, '${item.global_color_code}', '${item.display_color.replace(/'/g, "\\'")}', '${item.category}', '${item.status}')" title="Edit Color">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button class="btn-action btn-delete" onclick="deleteColorMaster(${item.id})" title="Delete Color">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function filterColorsList() {
    const searchVal = document.getElementById('color-master-search').value.toLowerCase().trim();
    if (!searchVal) {
        renderColorsList(loadedColors);
        return;
    }
    const filtered = loadedColors.filter(c =>
        c.global_color_code.toLowerCase().includes(searchVal) ||
        c.display_color.toLowerCase().includes(searchVal)
    );
    renderColorsList(filtered);
}

function openAddColorModal() {
    document.getElementById('color-modal-title').innerHTML = '<i class="fa-solid fa-palette"></i> Add New Color';
    document.getElementById('color-entry-id').value = '';
    document.getElementById('global-color-code-input').value = '';
    document.getElementById('global-color-code-input').disabled = false;
    document.getElementById('display-color-input').value = '';
    document.getElementById('color-category-select').value = 'Primary';
    document.getElementById('color-status-select').value = 'Active';
    document.getElementById('color-master-modal').classList.remove('hidden');
}

function openEditColorModal(id, global_code, display_color, category, status) {
    document.getElementById('color-modal-title').innerHTML = '<i class="fa-solid fa-palette"></i> Edit Color';
    document.getElementById('color-entry-id').value = id;
    document.getElementById('global-color-code-input').value = global_code;
    document.getElementById('global-color-code-input').disabled = false;
    document.getElementById('display-color-input').value = display_color;
    document.getElementById('color-category-select').value = category;
    document.getElementById('color-status-select').value = status;
    document.getElementById('color-master-modal').classList.remove('hidden');
}

function closeColorModal() {
    document.getElementById('color-master-modal').classList.add('hidden');
}

async function saveColorMaster(event) {
    event.preventDefault();
    const id = document.getElementById('color-entry-id').value;
    const global_code = document.getElementById('global-color-code-input').value.trim();
    const display_color = document.getElementById('display-color-input').value.trim();
    const category = document.getElementById('color-category-select').value;
    const status = document.getElementById('color-status-select').value;

    const payload = { global_color_code: global_code, display_color: display_color, category: category, status: status };
    const url = id ? `/api/masters/colors/${id}` : '/api/masters/colors';
    const method = id ? 'PUT' : 'POST';

    showLoader(true, "Saving color master entry...");
    try {
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (response.ok && data.success) {
            closeColorModal();
            await fetchColorsMaster();
        } else {
            alert(data.message || "Failed to save color entry.");
        }
    } catch (err) {
        console.error("Error saving color:", err);
        alert("Network error. Failed to save color master.");
    } finally {
        showLoader(false);
    }
}

async function deleteColorMaster(id) {
    if (!confirm("Are you sure you want to delete this color master entry?")) return;

    showLoader(true, "Deleting color master entry...");
    try {
        const response = await fetch(`/api/masters/colors/${id}`, { method: 'DELETE' });
        const data = await response.json();
        if (response.ok && data.success) {
            await fetchColorsMaster();
        } else {
            alert(data.message || "Failed to delete color entry.");
        }
    } catch (err) {
        console.error("Error deleting color:", err);
        alert("Network error. Failed to delete color.");
    } finally {
        showLoader(false);
    }
}

function triggerColorImport() {
    document.getElementById('color-import-file').click();
}

function importColorsExcel(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const dataBytes = new Uint8Array(e.target.result);
            const workbook = XLSX.read(dataBytes, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(worksheet);

            const colors = [];
            rows.forEach(r => {
                const global_code = r['Global Color Code'] || r['global_color_code'] || r['Global Code'] || r['global_code'];
                const display = r['Display Color'] || r['display_color'] || r['Display'] || r['display'];
                const category = r['Category'] || r['category'] || 'Primary';
                const status = r['Status'] || r['status'] || 'Active';
                if (global_code && display) {
                    colors.push({ global_color_code: String(global_code), display_color: String(display), category: String(category), status: String(status) });
                }
            });

            if (colors.length === 0) {
                alert("No valid color rows found. Excel file must contain 'Global Color Code', 'Display Color', and 'Category' columns.");
                return;
            }

            showLoader(true, "Uploading Excel color data...");
            const response = await fetch('/api/masters/colors/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ colors: colors })
            });
            const data = await response.json();
            if (response.ok && data.success) {
                alert(`Successfully imported ${colors.length} color master records!`);
                await fetchColorsMaster();
            } else {
                alert(data.message || "Failed to import colors.");
            }
        } catch (err) {
            console.error("Error parsing Excel colors:", err);
            alert("Invalid Excel formatting or parse failure.");
        } finally {
            showLoader(false);
            document.getElementById('color-import-file').value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

function exportColorsExcel() {
    if (loadedColors.length === 0) {
        alert("No color records available for export.");
        return;
    }
    const data = loadedColors.map(c => ({
        'Global Color Code': c.global_color_code,
        'Display Color': c.display_color,
        'Category': c.category,
        'Status': c.status
    }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Colors Master");
    XLSX.writeFile(workbook, "colors_master_records.xlsx");
}

function formatColorDisplay(globalColorCode, displayColor) {
    const g = (globalColorCode || '').trim();
    const d = (displayColor || '').trim();
    if (g && d && g.toUpperCase() !== d.toUpperCase()) {
        return `${g} — ${d}`;
    }
    return d || g || '';
}

async function initializeSizeMasterTab() {
    document.getElementById('size-master-search').value = '';
    await fetchSizesMaster();
}

async function fetchSizesMaster() {
    const loader = document.getElementById('size-master-loader');
    const empty = document.getElementById('size-master-empty');
    const tbody = document.getElementById('size-master-table-body');

    if (loader) loader.classList.remove('hidden');
    if (empty) empty.classList.add('hidden');
    tbody.innerHTML = '';

    try {
        const response = await fetch('/api/masters/sizes');
        const data = await response.json();
        if (response.ok && data.success) {
            loadedSizes = data.sizes || [];
            renderSizesList(loadedSizes);
        } else {
            console.error("Failed to load size master list:", data.message);
        }
    } catch (err) {
        console.error("Sizes master fetch error:", err);
    } finally {
        if (loader) loader.classList.add('hidden');
    }
}

function renderSizesList(sizes) {
    const tbody = document.getElementById('size-master-table-body');
    const empty = document.getElementById('size-master-empty');
    tbody.innerHTML = '';

    if (sizes.length === 0) {
        if (empty) empty.classList.remove('hidden');
        return;
    }
    if (empty) empty.classList.add('hidden');

    sizes.forEach(item => {
        const tr = document.createElement('tr');
        const statusClass = item.status === 'Active' ? 'running' : 'stopped';

        tr.innerHTML = `
            <td><strong>${item.size_code}</strong></td>
            <td>${item.size}</td>
            <td><span class="table-badge ${statusClass}">${item.status}</span></td>
            <td class="text-right">
                <div class="actions-cell">
                    <button class="btn-action btn-edit" onclick="openEditSizeModal(${item.id}, '${item.size_code}', '${item.size.replace(/'/g, "\\'")}', '${item.status}')" title="Edit Size">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button class="btn-action btn-delete" onclick="deleteSizeMaster(${item.id})" title="Delete Size">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function filterSizesList() {
    const searchVal = document.getElementById('size-master-search').value.toLowerCase().trim();
    if (!searchVal) {
        renderSizesList(loadedSizes);
        return;
    }
    const filtered = loadedSizes.filter(s =>
        s.size_code.toLowerCase().includes(searchVal)
    );
    renderSizesList(filtered);
}

function openAddSizeModal() {
    document.getElementById('size-modal-title').innerHTML = '<i class="fa-solid fa-maximize"></i> Add New Size';
    document.getElementById('size-entry-id').value = '';
    document.getElementById('size-code-input').value = '';
    document.getElementById('size-code-input').disabled = false;
    document.getElementById('size-input').value = '';
    document.getElementById('size-status-select').value = 'Active';
    document.getElementById('size-master-modal').classList.remove('hidden');
}

function openEditSizeModal(id, code, size, status) {
    document.getElementById('size-modal-title').innerHTML = '<i class="fa-solid fa-maximize"></i> Edit Size';
    document.getElementById('size-entry-id').value = id;
    document.getElementById('size-code-input').value = code;
    document.getElementById('size-code-input').disabled = true;
    document.getElementById('size-input').value = size;
    document.getElementById('size-status-select').value = status;
    document.getElementById('size-master-modal').classList.remove('hidden');
}

function closeSizeModal() {
    document.getElementById('size-master-modal').classList.add('hidden');
}

async function saveSizeMaster(event) {
    event.preventDefault();
    const id = document.getElementById('size-entry-id').value;
    const code = document.getElementById('size-code-input').value.trim();
    const size = document.getElementById('size-input').value.trim();
    const status = document.getElementById('size-status-select').value;

    const payload = { size_code: code, size: size, status: status };
    const url = id ? `/api/masters/sizes/${id}` : '/api/masters/sizes';
    const method = id ? 'PUT' : 'POST';

    showLoader(true, "Saving size master entry...");
    try {
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (response.ok && data.success) {
            closeSizeModal();
            await fetchSizesMaster();
        } else {
            alert(data.message || "Failed to save size entry.");
        }
    } catch (err) {
        console.error("Error saving size:", err);
        alert("Network error. Failed to save size master.");
    } finally {
        showLoader(false);
    }
}

async function deleteSizeMaster(id) {
    if (!confirm("Are you sure you want to delete this size master entry?")) return;

    showLoader(true, "Deleting size master entry...");
    try {
        const response = await fetch(`/api/masters/sizes/${id}`, { method: 'DELETE' });
        const data = await response.json();
        if (response.ok && data.success) {
            await fetchSizesMaster();
        } else {
            alert(data.message || "Failed to delete size entry.");
        }
    } catch (err) {
        console.error("Error deleting size:", err);
        alert("Network error. Failed to delete size.");
    } finally {
        showLoader(false);
    }
}

function triggerSizeImport() {
    document.getElementById('size-import-file').click();
}

function importSizesExcel(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const dataBytes = new Uint8Array(e.target.result);
            const workbook = XLSX.read(dataBytes, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(worksheet);

            const sizes = [];
            rows.forEach(r => {
                const code = r['Size Code'] || r['size_code'] || r['Code'] || r['code'];
                const sizeVal = r['Size'] || r['size'] || '';
                const status = r['Status'] || r['status'] || 'Active';
                if (code && sizeVal) {
                    sizes.push({ size_code: String(code), size: String(sizeVal), status: String(status) });
                }
            });

            if (sizes.length === 0) {
                alert("No valid size rows found. Excel file must contain 'Size Code' and 'Size' columns.");
                return;
            }

            showLoader(true, "Uploading Excel size data...");
            const response = await fetch('/api/masters/sizes/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sizes: sizes })
            });
            const data = await response.json();
            if (response.ok && data.success) {
                alert(`Successfully imported ${sizes.length} size master records!`);
                await fetchSizesMaster();
            } else {
                alert(data.message || "Failed to import sizes.");
            }
        } catch (err) {
            console.error("Error parsing Excel sizes:", err);
            alert("Invalid Excel formatting or parse failure.");
        } finally {
            showLoader(false);
            document.getElementById('size-import-file').value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

function exportSizesExcel() {
    const data = loadedSizes.map(s => ({
        'Size Code': s.size_code,
        'Size': s.size,
        'Status': s.status
    }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sizes Master");
    XLSX.writeFile(workbook, "sizes_master_records.xlsx");
}


// =========================================================================
// FABRIC MASTER CONTROLLERS & DATA MANAGEMENT
// =========================================================================

let loadedFabrics = [];
let fabricSortColumn = 'id';
let fabricSortDirection = 'desc';
let fabricCurrentPage = 1;
const fabricPageSize = 10;
let activePrimaryColorsList = []; // Cache of active primary colors
let selectedFabricColors = [];   // Selected display colors for the form
let availableFabricDias = [36, 38, 40, 42, 44]; // Dynamic list of available DIAs
let selectedFabricDias = [];     // Selected DIA values for the form

async function initializeFabricMasterTab() {
    // Reset filters
    if (document.getElementById('fabric-master-search')) document.getElementById('fabric-master-search').value = '';
    if (document.getElementById('fabric-filter-uom')) document.getElementById('fabric-filter-uom').value = '';
    if (document.getElementById('fabric-filter-gsm')) document.getElementById('fabric-filter-gsm').value = '';
    if (document.getElementById('fabric-filter-dia')) document.getElementById('fabric-filter-dia').value = '';
    if (document.getElementById('fabric-filter-status')) document.getElementById('fabric-filter-status').value = '';

    fabricCurrentPage = 1;
    fabricSortColumn = 'id';
    fabricSortDirection = 'desc';
    availableFabricDias = [36, 38, 40, 42, 44];

    // Load and build options list
    await loadPrimaryColorsForDropdown();
    await fetchFabricsMaster();
}

async function loadPrimaryColorsForDropdown() {
    try {
        const response = await fetch('/api/masters/colors?category=Primary&status=Active');
        const data = await response.json();
        if (response.ok && data.success) {
            activePrimaryColorsList = data.colors || [];
            buildFabricColorsDropdownOptions();
        } else {
            console.error("Failed to load primary colors for dropdown:", data.message);
        }
    } catch (err) {
        console.error("Error loading primary colors:", err);
    }
}

function buildFabricColorsDropdownOptions() {
    const container = document.getElementById('fabric-colors-options-container');
    if (!container) return;
    container.innerHTML = '';

    if (activePrimaryColorsList.length === 0) {
        container.innerHTML = '<div style="padding: 8px; color: var(--text-secondary); font-size: 13px;">No active primary colors found.</div>';
        return;
    }

    activePrimaryColorsList.forEach(color => {
        const optionDiv = document.createElement('div');
        optionDiv.className = 'multiselect-option';
        const globalCode = (color.global_color_code || '').trim();
        const dispColor = (color.display_color || '').trim();
        optionDiv.setAttribute('data-color-name', (globalCode + ' ' + dispColor).toLowerCase());

        const displayText = formatColorDisplay(globalCode, dispColor);
        const isChecked = selectedFabricColors.includes(globalCode);

        optionDiv.innerHTML = `
            <input type="checkbox" id="chk-fabric-color-${color.id}" value="${escapeHTML(globalCode)}" ${isChecked ? 'checked' : ''} onchange="handleFabricColorCheckboxChange(event)">
            <span>${escapeHTML(displayText)}</span>
        `;
        optionDiv.onclick = function (e) {
            if (e.target.tagName !== 'INPUT') {
                const chk = optionDiv.querySelector('input[type="checkbox"]');
                chk.checked = !chk.checked;
                chk.dispatchEvent(new Event('change'));
            }
        };
        container.appendChild(optionDiv);
    });
}

function toggleFabricColorsDropdown(event) {
    event.stopPropagation();
    const multiselect = document.getElementById('fabric-colors-multiselect');
    const dropdown = document.getElementById('fabric-colors-dropdown-list');
    if (!dropdown) return;

    const isOpen = !dropdown.classList.contains('hidden');
    if (isOpen) {
        dropdown.classList.add('hidden');
        multiselect.classList.remove('open');
    } else {
        dropdown.classList.remove('hidden');
        multiselect.classList.add('open');
        const searchInput = dropdown.querySelector('input');
        if (searchInput) {
            searchInput.value = '';
            filterFabricColorsDropdown({ target: searchInput });
        }
        // Close other dropdowns
        document.getElementById('fabric-dias-dropdown-list')?.classList.add('hidden');
        document.getElementById('fabric-dias-multiselect')?.classList.remove('open');
    }
}

function filterFabricColorsDropdown(event) {
    const searchVal = event.target.value.toLowerCase().trim();
    const options = document.querySelectorAll('#fabric-colors-options-container .multiselect-option');
    options.forEach(opt => {
        const colName = opt.getAttribute('data-color-name') || '';
        if (colName.includes(searchVal)) {
            opt.classList.remove('hidden');
        } else {
            opt.classList.add('hidden');
        }
    });
}

function handleFabricColorCheckboxChange(event) {
    const val = event.target.value;
    const checked = event.target.checked;

    if (checked) {
        if (!selectedFabricColors.includes(val)) {
            selectedFabricColors.push(val);
        }
    } else {
        selectedFabricColors = selectedFabricColors.filter(c => c !== val);
    }
    updateFabricSelectedColorsChips();
}

function updateFabricSelectedColorsChips() {
    const container = document.getElementById('fabric-selected-colors-container');
    if (!container) return;
    container.innerHTML = '';

    if (selectedFabricColors.length === 0) {
        container.innerHTML = '<span class="placeholder">Select Primary Colors...</span>';
        return;
    }

    selectedFabricColors.forEach(code => {
        const match = activePrimaryColorsList.find(c => c.global_color_code === code);
        const displayText = match ? formatColorDisplay(match.global_color_code, match.display_color) : code;

        const tag = document.createElement('div');
        tag.className = 'multiselect-tag';
        tag.innerHTML = `
            <span>${escapeHTML(displayText)}</span>
            <i class="fa-solid fa-xmark remove-btn" onclick="removeFabricColorChip(event, '${escapeHTML(code)}')"></i>
        `;
        container.appendChild(tag);
    });
}

function removeFabricColorChip(event, colorCode) {
    event.stopPropagation();
    selectedFabricColors = selectedFabricColors.filter(c => c !== colorCode);
    updateFabricSelectedColorsChips();

    const chk = document.querySelector(`#fabric-colors-options-container input[value="${colorCode}"]`);
    if (chk) {
        chk.checked = false;
    }
}

// =========================================================================
// DIA SEARCHABLE MULTISELECT & DYNAMIC ADD HANDLERS
// =========================================================================

function buildFabricDiasDropdownOptions() {
    const container = document.getElementById('fabric-dias-options-container');
    const searchInput = document.getElementById('fabric-dia-search-input');
    if (!container) return;
    container.innerHTML = '';

    const searchVal = searchInput ? searchInput.value.trim() : '';

    // If search term is a valid DIA and not in available list, offer "+ Add option"
    if (searchVal) {
        const parsedDia = parseFloat(searchVal);
        if (!isNaN(parsedDia) && parsedDia > 0) {
            const exists = availableFabricDias.some(d => parseFloat(d) === parsedDia);
            if (!exists) {
                const addDiv = document.createElement('div');
                addDiv.className = 'multiselect-option';
                addDiv.style.color = 'var(--accent-purple)';
                addDiv.style.fontWeight = 'bold';
                addDiv.innerHTML = `<i class="fa-solid fa-plus-circle"></i> Add "${parsedDia}" as new DIA`;
                addDiv.onclick = function (e) {
                    e.stopPropagation();
                    availableFabricDias.push(parsedDia);
                    availableFabricDias.sort((a, b) => a - b);
                    selectedFabricDias.push(parsedDia);
                    searchInput.value = '';
                    buildFabricDiasDropdownOptions();
                    updateFabricSelectedDiasChips();
                };
                container.appendChild(addDiv);
            }
        }
    }

    const filteredDias = availableFabricDias.filter(dia => {
        if (!searchVal) return true;
        return String(dia).includes(searchVal);
    });

    if (filteredDias.length === 0 && container.children.length === 0) {
        container.innerHTML = '<div style="padding: 8px; color: var(--text-secondary); font-size: 13px;">No DIA values found. Type a number to add.</div>';
        return;
    }

    filteredDias.forEach(dia => {
        const optionDiv = document.createElement('div');
        optionDiv.className = 'multiselect-option';

        optionDiv.innerHTML = `
            <input type="checkbox" id="chk-fabric-dia-${dia}" value="${dia}" ${selectedFabricDias.includes(dia) ? 'checked' : ''} onchange="handleFabricDiaCheckboxChange(event)">
            <span>${dia}</span>
        `;
        optionDiv.onclick = function (e) {
            if (e.target.tagName !== 'INPUT') {
                const chk = optionDiv.querySelector('input[type="checkbox"]');
                chk.checked = !chk.checked;
                chk.dispatchEvent(new Event('change'));
            }
        };
        container.appendChild(optionDiv);
    });
}

function toggleFabricDiasDropdown(event) {
    event.stopPropagation();
    const multiselect = document.getElementById('fabric-dias-multiselect');
    const dropdown = document.getElementById('fabric-dias-dropdown-list');
    if (!dropdown) return;

    const isOpen = !dropdown.classList.contains('hidden');
    if (isOpen) {
        dropdown.classList.add('hidden');
        multiselect.classList.remove('open');
    } else {
        dropdown.classList.remove('hidden');
        multiselect.classList.add('open');
        const searchInput = document.getElementById('fabric-dia-search-input');
        if (searchInput) {
            searchInput.value = '';
            buildFabricDiasDropdownOptions();
        }
        // Close color dropdown
        document.getElementById('fabric-colors-dropdown-list')?.classList.add('hidden');
        document.getElementById('fabric-colors-multiselect')?.classList.remove('open');
    }
}

function filterFabricDiasDropdown(event) {
    buildFabricDiasDropdownOptions();
}

function handleFabricDiaCheckboxChange(event) {
    const val = parseFloat(event.target.value);
    const checked = event.target.checked;

    if (checked) {
        if (!selectedFabricDias.includes(val)) {
            selectedFabricDias.push(val);
        }
    } else {
        selectedFabricDias = selectedFabricDias.filter(d => d !== val);
    }
    selectedFabricDias.sort((a, b) => a - b);
    updateFabricSelectedDiasChips();
}

function updateFabricSelectedDiasChips() {
    const container = document.getElementById('fabric-selected-dias-container');
    if (!container) return;
    container.innerHTML = '';

    if (selectedFabricDias.length === 0) {
        container.innerHTML = '<span class="placeholder">Select DIA values...</span>';
        return;
    }

    selectedFabricDias.forEach(dia => {
        const tag = document.createElement('div');
        tag.className = 'multiselect-tag';
        tag.innerHTML = `
            <span>${dia}</span>
            <i class="fa-solid fa-xmark remove-btn" onclick="removeFabricDiaChip(event, ${dia})"></i>
        `;
        container.appendChild(tag);
    });
}

function removeFabricDiaChip(event, diaVal) {
    event.stopPropagation();
    selectedFabricDias = selectedFabricDias.filter(d => d !== diaVal);
    updateFabricSelectedDiasChips();

    const chk = document.querySelector(`#fabric-dias-options-container input[value="${diaVal}"]`);
    if (chk) {
        chk.checked = false;
    }
}

// Close multiselect dropdowns when clicking outside
document.addEventListener('click', function (e) {
    const multiselectColor = document.getElementById('fabric-colors-multiselect');
    if (multiselectColor && !multiselectColor.contains(e.target)) {
        document.getElementById('fabric-colors-dropdown-list')?.classList.add('hidden');
        multiselectColor.classList.remove('open');
    }
    const multiselectDia = document.getElementById('fabric-dias-multiselect');
    if (multiselectDia && !multiselectDia.contains(e.target)) {
        document.getElementById('fabric-dias-dropdown-list')?.classList.add('hidden');
        multiselectDia.classList.remove('open');
    }
    const multiselectDerivMonths = document.getElementById('deriv-months-multiselect');
    if (multiselectDerivMonths && !multiselectDerivMonths.contains(e.target)) {
        document.getElementById('deriv-months-dropdown')?.classList.add('hidden');
    }
});

async function fetchFabricsMaster() {
    const loader = document.getElementById('fabric-master-loader');
    const empty = document.getElementById('fabric-master-empty');
    const tbody = document.getElementById('fabric-master-table-body');

    if (loader) loader.classList.remove('hidden');
    if (empty) empty.classList.add('hidden');
    if (tbody) tbody.innerHTML = '';

    const searchVal = document.getElementById('fabric-master-search')?.value.trim() || '';
    const uomVal = document.getElementById('fabric-filter-uom')?.value || '';
    const gsmVal = document.getElementById('fabric-filter-gsm')?.value || '';
    const diaVal = document.getElementById('fabric-filter-dia')?.value || '';
    const statusVal = document.getElementById('fabric-filter-status')?.value || '';

    try {
        const queryParams = new URLSearchParams({
            search: searchVal,
            uom: uomVal,
            gsm: gsmVal,
            dia: diaVal,
            status: statusVal
        });
        const response = await fetch(`/api/masters/fabrics?${queryParams.toString()}`);
        const data = await response.json();
        if (response.ok && data.success) {
            loadedFabrics = data.fabrics || [];

            // Sync all unique DIAs back to availableFabricDias array
            loadedFabrics.forEach(f => {
                if (f.dias) {
                    f.dias.forEach(d => {
                        const num = parseFloat(d);
                        if (!availableFabricDias.includes(num)) {
                            availableFabricDias.push(num);
                        }
                    });
                }
            });
            availableFabricDias.sort((a, b) => a - b);

            renderFabricsList();
        } else {
            console.error("Failed to load fabrics master:", data.message);
        }
    } catch (err) {
        console.error("Fabric fetch error:", err);
    } finally {
        if (loader) loader.classList.add('hidden');
    }
}

function renderFabricsList() {
    const tbody = document.getElementById('fabric-master-table-body');
    const empty = document.getElementById('fabric-master-empty');
    const infoSpan = document.getElementById('fabric-pagination-info');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Sort fabrics array
    const fabrics = [...loadedFabrics];
    fabrics.sort((a, b) => {
        let valA = a[fabricSortColumn];
        let valB = b[fabricSortColumn];

        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = b[fabricSortColumn].toLowerCase();

        if (valA < valB) return fabricSortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return fabricSortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    // Paginate fabrics array
    const totalEntries = fabrics.length;
    if (totalEntries === 0) {
        if (empty) empty.classList.remove('hidden');
        if (infoSpan) infoSpan.innerText = 'Showing 0-0 of 0 entries';
        return;
    }
    if (empty) empty.classList.add('hidden');

    const startIndex = (fabricCurrentPage - 1) * fabricPageSize;
    const endIndex = Math.min(startIndex + fabricPageSize, totalEntries);
    const paginated = fabrics.slice(startIndex, endIndex);

    if (infoSpan) {
        infoSpan.innerText = `Showing ${startIndex + 1}-${endIndex} of ${totalEntries} entries`;
    }

    paginated.forEach(item => {
        const tr = document.createElement('tr');
        const statusClass = item.status === 'Active' ? 'running' : 'stopped';

        // Colors rendered as badges/chips list
        const colorsHtml = item.colors && item.colors.length > 0
            ? item.colors.map(c => `<span class="table-badge badge-outline" style="margin: 2px;">${escapeHTML(formatColorDisplay(c.global_color_code, c.display_color))}</span>`).join('')
            : '<span style="color: var(--text-secondary); font-style: italic;">None</span>';

        // Multiple DIAs comma-separated
        const diasStr = item.dias && item.dias.length > 0 ? item.dias.join(', ') : 'None';

        const colorsJSON = JSON.stringify(item.colors).replace(/'/g, "\\'");
        const diasJSON = JSON.stringify(item.dias);

        tr.innerHTML = `
            <td><strong>${item.fabric_name}</strong></td>
            <td><span class="table-badge" style="background: rgba(255,255,255,0.03); color: var(--text-primary); border: 1px solid var(--border-color);">${item.uom}</span></td>
            <td>${item.gsm}</td>
            <td><strong>${diasStr}</strong></td>
            <td>
                <div style="display: flex; flex-wrap: wrap; max-width: 320px;">
                    ${colorsHtml}
                </div>
            </td>
            <td><span class="table-badge ${statusClass}">${item.status}</span></td>
            <td class="text-right">
                <div class="actions-cell">
                    <button class="btn-action btn-edit" onclick="editFabricById(${item.id})" title="Edit Fabric">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button class="btn-action btn-delete" onclick="deleteFabricMaster(${item.id})" title="Delete Fabric">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function prevFabricPage() {
    if (fabricCurrentPage > 1) {
        fabricCurrentPage--;
        renderFabricsList();
    }
}

function nextFabricPage() {
    const maxPages = Math.ceil(loadedFabrics.length / fabricPageSize);
    if (fabricCurrentPage < maxPages) {
        fabricCurrentPage++;
        renderFabricsList();
    }
}

function sortFabrics(column) {
    if (fabricSortColumn === column) {
        fabricSortDirection = fabricSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        fabricSortColumn = column;
        fabricSortDirection = 'asc';
    }

    // Update sort icons in headers
    document.querySelectorAll('#fabric-master-panel th i.sort-indicator-icon').forEach(icon => {
        icon.className = 'fa-solid fa-sort';
    });

    // Set appropriate sort direction icon in clicked header
    const headers = document.querySelectorAll('#fabric-master-panel th');
    headers.forEach(h => {
        if (h.getAttribute('onclick')?.includes(column)) {
            const icon = h.querySelector('i.sort-indicator-icon');
            if (icon) {
                icon.className = fabricSortDirection === 'asc' ? 'fa-solid fa-sort-up' : 'fa-solid fa-sort-down';
            }
        }
    });

    renderFabricsList();
}

function openAddFabricModal() {
    document.getElementById('fabric-modal-title').innerHTML = '<i class="fa-solid fa-scissors"></i> Add New Fabric';
    document.getElementById('fabric-entry-id').value = '';
    document.getElementById('fabric-name-input').value = '';
    document.getElementById('fabric-uom-select').value = 'KGS';
    document.getElementById('fabric-gsm-input').value = '';
    document.getElementById('fabric-status-select').value = 'Active';

    // Reset selected lists
    selectedFabricColors = [];
    selectedFabricDias = [];

    updateFabricSelectedColorsChips();
    updateFabricSelectedDiasChips();

    buildFabricColorsDropdownOptions();
    buildFabricDiasDropdownOptions();

    document.getElementById('fabric-master-modal').classList.remove('hidden');
}

function editFabricById(id) {
    const item = loadedFabrics.find(f => f.id === id);
    if (!item) return;
    const diasJSON = JSON.stringify(item.dias);
    const colorsJSON = JSON.stringify(item.colors);
    openEditFabricModal(item.id, item.fabric_name, item.uom, item.gsm, diasJSON, item.status, colorsJSON);
}

function openEditFabricModal(id, name, uom, gsm, diasJSON, status, colorsJSON) {
    document.getElementById('fabric-modal-title').innerHTML = '<i class="fa-solid fa-scissors"></i> Edit Fabric';
    document.getElementById('fabric-entry-id').value = id;
    document.getElementById('fabric-name-input').value = name;
    document.getElementById('fabric-uom-select').value = uom;
    document.getElementById('fabric-gsm-input').value = gsm;
    document.getElementById('fabric-status-select').value = status;

    // Bind Colors
    let assignedColors = [];
    try {
        const parsed = JSON.parse(colorsJSON);
        assignedColors = parsed.map(c => c.global_color_code || c.display_color);
    } catch (e) {
        console.error("Error parsing assigned colors JSON:", e);
    }
    selectedFabricColors = [...assignedColors];
    updateFabricSelectedColorsChips();
    buildFabricColorsDropdownOptions();

    // Bind DIAs
    let assignedDias = [];
    try {
        assignedDias = JSON.parse(diasJSON).map(d => parseFloat(d));
    } catch (e) {
        console.error("Error parsing assigned dias JSON:", e);
    }

    selectedFabricDias = [...assignedDias];

    // Sync any non-existing DIAs to availableFabricDias list
    selectedFabricDias.forEach(d => {
        if (!availableFabricDias.includes(d)) {
            availableFabricDias.push(d);
        }
    });
    availableFabricDias.sort((a, b) => a - b);

    updateFabricSelectedDiasChips();
    buildFabricDiasDropdownOptions();

    document.getElementById('fabric-master-modal').classList.remove('hidden');
}

function closeFabricModal() {
    document.getElementById('fabric-master-modal').classList.add('hidden');
}

async function saveFabricMaster(event) {
    event.preventDefault();
    const id = document.getElementById('fabric-entry-id').value;
    const name = document.getElementById('fabric-name-input').value.trim();
    const uom = document.getElementById('fabric-uom-select').value;
    const gsmVal = parseFloat(document.getElementById('fabric-gsm-input').value);
    const status = document.getElementById('fabric-status-select').value;

    // Frontend validations
    if (!name) {
        alert("Fabric Name is required.");
        return;
    }
    if (isNaN(gsmVal) || gsmVal <= 0) {
        alert("GSM must be greater than zero.");
        return;
    }
    if (selectedFabricDias.length === 0) {
        alert("At least one DIA value must be selected.");
        return;
    }
    if (selectedFabricColors.length === 0) {
        alert("At least one Primary Color must be assigned.");
        return;
    }

    const payload = {
        fabric_name: name,
        uom: uom,
        gsm: gsmVal,
        dias: selectedFabricDias,     // Array of floats
        colors: selectedFabricColors, // Array of strings
        status: status
    };

    const url = id ? `/api/masters/fabrics/${id}` : '/api/masters/fabrics';
    const method = id ? 'PUT' : 'POST';

    showLoader(true, "Saving fabric master record...");
    try {
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (response.ok && data.success) {
            closeFabricModal();
            await fetchFabricsMaster();
        } else {
            alert(data.message || "Failed to save fabric entry.");
        }
    } catch (err) {
        console.error("Error saving fabric:", err);
        alert("Network error. Failed to save fabric.");
    } finally {
        showLoader(false);
    }
}

async function deleteFabricMaster(id) {
    if (!confirm("Are you sure you want to delete this Fabric record? This is a soft delete (status will be set to Inactive).")) {
        return;
    }

    showLoader(true, "Soft deleting fabric...");
    try {
        const response = await fetch(`/api/masters/fabrics/${id}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        if (response.ok && data.success) {
            await fetchFabricsMaster();
        } else {
            alert(data.message || "Failed to delete fabric.");
        }
    } catch (err) {
        console.error("Error soft deleting fabric:", err);
        alert("Network error. Failed to delete fabric.");
    } finally {
        showLoader(false);
    }
}

function triggerFabricImport() {
    document.getElementById('fabric-import-file').click();
}

function importFabricsExcel(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const dataBytes = new Uint8Array(e.target.result);
            const workbook = XLSX.read(dataBytes, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(worksheet);

            const fabrics = [];
            rows.forEach(r => {
                const name = r['Fabric Name'] || r['fabric_name'] || r['Fabric'] || r['fabric'];
                const uom = r['UOM'] || r['uom'] || 'KGS';
                const gsm = r['GSM'] || r['gsm'];
                const dia = r['DIA'] || r['dia'];
                const colors = r['Colors'] || r['colors'] || '';
                const status = r['Status'] || r['status'] || 'Active';

                if (name && gsm && dia) {
                    fabrics.push({
                        fabric_name: String(name),
                        uom: String(uom),
                        gsm: Number(gsm),
                        dia: String(dia), // comma separated list
                        colors: String(colors), // Comma separated list of display colors
                        status: String(status)
                    });
                }
            });

            if (fabrics.length === 0) {
                alert("No valid fabric rows found. Excel file must contain 'Fabric Name', 'UOM', 'GSM', 'DIA', and 'Colors' columns.");
                return;
            }

            showLoader(true, "Uploading Excel fabric data...");
            const response = await fetch('/api/masters/fabrics/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fabrics: fabrics })
            });
            const data = await response.json();
            if (response.ok && data.success) {
                alert(`Successfully imported/updated ${fabrics.length} fabric records!`);
                await fetchFabricsMaster();
            } else {
                alert(data.message || "Failed to import fabrics. Please verify color and numeric validation.");
            }
        } catch (err) {
            console.error("Error parsing Excel fabrics:", err);
            alert("Invalid Excel formatting or parse failure.");
        } finally {
            showLoader(false);
            document.getElementById('fabric-import-file').value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

function exportFabricsExcel() {
    if (loadedFabrics.length === 0) {
        alert("No fabric records available for export.");
        return;
    }

    const data = loadedFabrics.map(f => {
        const colorsList = f.colors ? f.colors.map(c => formatColorDisplay(c.global_color_code, c.display_color)).join(', ') : '';
        const diasList = f.dias ? f.dias.join(', ') : '';
        return {
            'Fabric Name': f.fabric_name,
            'UOM': f.uom,
            'GSM': f.gsm,
            'DIA': diasList,
            'Colors': colorsList,
            'Status': f.status
        };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Fabrics Master");
    XLSX.writeFile(workbook, "fabrics_master_records.xlsx");
}

// =========================================================================
// BRAND MASTER CONTROLLERS & DATA MANAGEMENT
// =========================================================================

let loadedBrands = [];
let brandSortColumn = 'id';
let brandSortDirection = 'desc';
let brandCurrentPage = 1;
const brandPageSize = 10;

async function initializeBrandMasterTab() {
    if (document.getElementById('brand-master-search')) document.getElementById('brand-master-search').value = '';
    if (document.getElementById('brand-filter-status')) document.getElementById('brand-filter-status').value = '';

    brandCurrentPage = 1;
    brandSortColumn = 'id';
    brandSortDirection = 'desc';

    await fetchBrandsMaster();
}

async function fetchBrandsMaster() {
    const loader = document.getElementById('brand-master-loader');
    const empty = document.getElementById('brand-master-empty');
    const tbody = document.getElementById('brand-master-table-body');

    if (loader) loader.classList.remove('hidden');
    if (empty) empty.classList.add('hidden');
    if (tbody) tbody.innerHTML = '';

    const searchVal = document.getElementById('brand-master-search')?.value.trim() || '';
    const statusVal = document.getElementById('brand-filter-status')?.value || '';

    try {
        const queryParams = new URLSearchParams({
            search: searchVal,
            status: statusVal
        });
        const response = await fetch(`/api/masters/brands?${queryParams.toString()}`);
        const data = await response.json();
        if (response.ok && data.success) {
            loadedBrands = data.brands || [];
            renderBrandsList();
        } else {
            console.error("Failed to load brands:", data.message);
        }
    } catch (err) {
        console.error("Brand fetch error:", err);
    } finally {
        if (loader) loader.classList.add('hidden');
    }
}

function renderBrandsList() {
    const tbody = document.getElementById('brand-master-table-body');
    const empty = document.getElementById('brand-master-empty');
    const infoSpan = document.getElementById('brand-pagination-info');
    if (!tbody) return;
    tbody.innerHTML = '';

    const brands = [...loadedBrands];
    brands.sort((a, b) => {
        let valA = a[brandSortColumn];
        let valB = b[brandSortColumn];

        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();

        if (valA < valB) return brandSortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return brandSortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    const totalEntries = brands.length;
    if (totalEntries === 0) {
        if (empty) empty.classList.remove('hidden');
        if (infoSpan) infoSpan.innerText = 'Showing 0-0 of 0 entries';
        return;
    }
    if (empty) empty.classList.add('hidden');

    const startIndex = (brandCurrentPage - 1) * brandPageSize;
    const endIndex = Math.min(startIndex + brandPageSize, totalEntries);
    const paginated = brands.slice(startIndex, endIndex);

    if (infoSpan) {
        infoSpan.innerText = `Showing ${startIndex + 1}-${endIndex} of ${totalEntries} entries`;
    }

    paginated.forEach(item => {
        const tr = document.createElement('tr');
        const statusClass = item.status === 'Active' ? 'running' : 'stopped';

        const createdDate = item.created_at ? new Date(item.created_at).toLocaleDateString() : '';
        const updatedDate = item.updated_at ? new Date(item.updated_at).toLocaleDateString() : '';

        tr.innerHTML = `
            <td><strong>${item.brand_name}</strong></td>
            <td><span class="table-badge" style="background: rgba(255,255,255,0.03); color: var(--text-primary); border: 1px solid var(--border-color);">${item.brand_code}</span></td>
            <td><span class="table-badge ${statusClass}">${item.status}</span></td>
            <td>${createdDate}</td>
            <td>${updatedDate}</td>
            <td class="text-right">
                <div class="actions-cell">
                    <button class="btn-action btn-edit" onclick="editBrandById(${item.id})" title="Edit Brand">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button class="btn-action btn-delete" onclick="deleteBrandMaster(${item.id})" title="Delete Brand">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function prevBrandPage() {
    if (brandCurrentPage > 1) {
        brandCurrentPage--;
        renderBrandsList();
    }
}

function nextBrandPage() {
    const maxPages = Math.ceil(loadedBrands.length / brandPageSize);
    if (brandCurrentPage < maxPages) {
        brandCurrentPage++;
        renderBrandsList();
    }
}

function sortBrands(column) {
    if (brandSortColumn === column) {
        brandSortDirection = brandSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        brandSortColumn = column;
        brandSortDirection = 'asc';
    }

    document.querySelectorAll('#brand-master-panel th i.sort-indicator-icon').forEach(icon => {
        icon.className = 'fa-solid fa-sort';
    });

    const headers = document.querySelectorAll('#brand-master-panel th');
    headers.forEach(h => {
        if (h.getAttribute('onclick')?.includes(column)) {
            const icon = h.querySelector('i.sort-indicator-icon');
            if (icon) {
                icon.className = brandSortDirection === 'asc' ? 'fa-solid fa-sort-up' : 'fa-solid fa-sort-down';
            }
        }
    });

    renderBrandsList();
}

function openAddBrandModal() {
    document.getElementById('brand-modal-title').innerHTML = '<i class="fa-solid fa-tags"></i> Add New Brand';
    document.getElementById('brand-entry-id').value = '';
    document.getElementById('brand-name-input').value = '';
    document.getElementById('brand-code-input').value = '';
    document.getElementById('brand-status-select').value = 'Active';

    document.getElementById('brand-master-modal').classList.remove('hidden');
}

function editBrandById(id) {
    const item = loadedBrands.find(b => b.id === id);
    if (!item) return;

    document.getElementById('brand-modal-title').innerHTML = '<i class="fa-solid fa-tags"></i> Edit Brand';
    document.getElementById('brand-entry-id').value = item.id;
    document.getElementById('brand-name-input').value = item.brand_name;
    document.getElementById('brand-code-input').value = item.brand_code;
    document.getElementById('brand-status-select').value = item.status;

    document.getElementById('brand-master-modal').classList.remove('hidden');
}

function closeBrandModal() {
    document.getElementById('brand-master-modal').classList.add('hidden');
}

async function saveBrandMaster(event) {
    event.preventDefault();
    const id = document.getElementById('brand-entry-id').value;
    const name = document.getElementById('brand-name-input').value.trim();
    const code = document.getElementById('brand-code-input').value.trim().toUpperCase();
    const status = document.getElementById('brand-status-select').value;

    if (!name || !code) {
        alert("Brand Name and Brand Code are required.");
        return;
    }

    const payload = {
        brand_name: name,
        brand_code: code,
        status: status
    };

    const url = id ? `/api/masters/brands/${id}` : '/api/masters/brands';
    const method = id ? 'PUT' : 'POST';

    showLoader(true, "Saving brand master record...");
    try {
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (response.ok && data.success) {
            closeBrandModal();
            await fetchBrandsMaster();
        } else {
            alert(data.message || "Failed to save brand entry.");
        }
    } catch (err) {
        console.error("Error saving brand:", err);
        alert("Network error. Failed to save brand.");
    } finally {
        showLoader(false);
    }
}

async function deleteBrandMaster(id) {
    if (!confirm("Are you sure you want to delete this Brand record? This is a soft delete (status will be set to Inactive).")) {
        return;
    }

    showLoader(true, "Soft deleting brand...");
    try {
        const response = await fetch(`/api/masters/brands/${id}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        if (response.ok && data.success) {
            await fetchBrandsMaster();
        } else {
            alert(data.message || "Failed to delete brand.");
        }
    } catch (err) {
        console.error("Error soft deleting brand:", err);
        alert("Network error. Failed to delete brand.");
    } finally {
        showLoader(false);
    }
}

function triggerBrandImport() {
    document.getElementById('brand-import-file').click();
}

function importBrandsExcel(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const dataBytes = new Uint8Array(e.target.result);
            const workbook = XLSX.read(dataBytes, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(worksheet);

            const brands = [];
            rows.forEach(r => {
                const name = r['Brand Name'] || r['brand_name'] || r['Brand'] || r['brand'];
                const code = r['Brand Code'] || r['brand_code'] || r['Code'] || r['code'];
                const status = r['Status'] || r['status'] || 'Active';

                if (name && code) {
                    brands.push({
                        brand_name: String(name),
                        brand_code: String(code),
                        status: String(status)
                    });
                }
            });

            if (brands.length === 0) {
                alert("No valid brand rows found. Excel file must contain 'Brand Name' and 'Brand Code' columns.");
                return;
            }

            showLoader(true, "Uploading Excel brand data...");
            const response = await fetch('/api/masters/brands/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ brands: brands })
            });
            const data = await response.json();
            if (response.ok && data.success) {
                alert(`Successfully imported/updated ${brands.length} brand records!`);
                await fetchBrandsMaster();
            } else {
                alert(data.message || "Failed to import brands.");
            }
        } catch (err) {
            console.error("Error parsing Excel brands:", err);
            alert("Invalid Excel formatting or parse failure.");
        } finally {
            showLoader(false);
            document.getElementById('brand-import-file').value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

function exportBrandsExcel() {
    if (loadedBrands.length === 0) {
        alert("No brand records available for export.");
        return;
    }

    const data = loadedBrands.map(b => ({
        'Brand Name': b.brand_name,
        'Brand Code': b.brand_code,
        'Status': b.status
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Brands Master");
    XLSX.writeFile(workbook, "brands_master_records.xlsx");
}

// =========================================================================
// COMMON PRODUCTION MASTER CONTROLLERS & DATA MANAGEMENT
// =========================================================================

let loadedCommonProductions = [];
let commonProductionSortColumn = 'id';
let commonProductionSortDirection = 'desc';
let commonProductionCurrentPage = 1;
const commonProductionPageSize = 25;

async function initializeCommonProductionMasterTab() {
    if (document.getElementById('common-production-master-search')) document.getElementById('common-production-master-search').value = '';
    if (document.getElementById('common-production-filter-status')) document.getElementById('common-production-filter-status').value = '';

    commonProductionCurrentPage = 1;
    commonProductionSortColumn = 'id';
    commonProductionSortDirection = 'desc';

    await fetchCommonProductionsMaster();
}

async function fetchCommonProductionsMaster() {
    const loader = document.getElementById('common-production-master-loader');
    const empty = document.getElementById('common-production-master-empty');
    const tbody = document.getElementById('common-production-master-table-body');

    if (loader) loader.classList.remove('hidden');
    if (empty) empty.classList.add('hidden');
    if (tbody) tbody.innerHTML = '';

    const searchVal = document.getElementById('common-production-master-search')?.value.trim() || '';
    const statusVal = document.getElementById('common-production-filter-status')?.value || '';

    try {
        const queryParams = new URLSearchParams({
            search: searchVal,
            status: statusVal
        });
        const response = await fetch(`/api/masters/common-production?${queryParams.toString()}`);
        const data = await response.json();
        if (response.ok && data.success) {
            loadedCommonProductions = data.common_productions || [];
            renderCommonProductionsList();
        } else {
            console.error("Failed to load common productions:", data.message);
        }
    } catch (err) {
        console.error("Common production fetch error:", err);
    } finally {
        if (loader) loader.classList.add('hidden');
    }
}

function renderCommonProductionsList() {
    const tbody = document.getElementById('common-production-master-table-body');
    const empty = document.getElementById('common-production-master-empty');
    const infoSpan = document.getElementById('common-production-pagination-info');
    if (!tbody) return;
    tbody.innerHTML = '';

    const commonProductions = [...loadedCommonProductions];
    commonProductions.sort((a, b) => {
        let valA = a[commonProductionSortColumn];
        let valB = b[commonProductionSortColumn];

        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();

        if (valA < valB) return commonProductionSortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return commonProductionSortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    const totalEntries = commonProductions.length;
    if (totalEntries === 0) {
        if (empty) empty.classList.remove('hidden');
        if (infoSpan) infoSpan.innerText = 'Showing 0-0 of 0 entries';
        return;
    }
    if (empty) empty.classList.add('hidden');

    const startIndex = (commonProductionCurrentPage - 1) * commonProductionPageSize;
    const endIndex = Math.min(startIndex + commonProductionPageSize, totalEntries);
    const paginated = commonProductions.slice(startIndex, endIndex);

    if (infoSpan) {
        infoSpan.innerText = `Showing ${startIndex + 1}-${endIndex} of ${totalEntries} entries`;
    }

    paginated.forEach(item => {
        const tr = document.createElement('tr');
        const statusClass = item.status === 'Active' ? 'running' : 'stopped';

        const createdDate = item.created_at ? new Date(item.created_at).toLocaleDateString() : '';
        const updatedDate = item.updated_at ? new Date(item.updated_at).toLocaleDateString() : '';

        tr.innerHTML = `
            <td><strong>${item.common_production_name}</strong></td>
            <td><span class="table-badge" style="background: rgba(255,255,255,0.03); color: var(--text-primary); border: 1px solid var(--border-color);">${item.common_production_code}</span></td>
            <td>${item.fabric_name || '-'}</td>
            <td>${item.fabric_consumption !== null && item.fabric_consumption !== undefined ? item.fabric_consumption : '-'}</td>
            <td><span class="table-badge ${statusClass}">${item.status}</span></td>
            <td>${createdDate}</td>
            <td>${updatedDate}</td>
            <td class="text-right">
                <div class="actions-cell">
                    <button class="btn-action btn-edit" onclick="editCommonProductionById(${item.id})" title="Edit Common Production">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button class="btn-action btn-delete" onclick="deleteCommonProductionMaster(${item.id})" title="Delete Common Production">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function prevCommonProductionPage() {
    if (commonProductionCurrentPage > 1) {
        commonProductionCurrentPage--;
        renderCommonProductionsList();
    }
}

function nextCommonProductionPage() {
    const maxPages = Math.ceil(loadedCommonProductions.length / commonProductionPageSize);
    if (commonProductionCurrentPage < maxPages) {
        commonProductionCurrentPage++;
        renderCommonProductionsList();
    }
}

function sortCommonProductions(column) {
    if (commonProductionSortColumn === column) {
        commonProductionSortDirection = commonProductionSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        commonProductionSortColumn = column;
        commonProductionSortDirection = 'asc';
    }

    document.querySelectorAll('#common-production-master-panel th i.sort-indicator-icon').forEach(icon => {
        icon.className = 'fa-solid fa-sort';
    });

    const headers = document.querySelectorAll('#common-production-master-panel th');
    headers.forEach(h => {
        if (h.getAttribute('onclick')?.includes(column)) {
            const icon = h.querySelector('i.sort-indicator-icon');
            if (icon) {
                icon.className = commonProductionSortDirection === 'asc' ? 'fa-solid fa-sort-up' : 'fa-solid fa-sort-down';
            }
        }
    });

    renderCommonProductionsList();
}

let loadedCommonProductionFabrics = [];
let availableCommonProductionSizesList = [];
let selectedCommonProductionSizes = [];
let commonProductionAvailableDias = [];

function toggleCommonProductionSizesDropdown(event) {
    event.stopPropagation();
    const list = document.getElementById('common-production-sizes-dropdown-list');
    list.classList.toggle('hidden');
}

function filterCommonProductionSizesDropdown(event) {
    buildCommonProductionSizesDropdownOptions(event.target.value);
}

function buildCommonProductionSizesDropdownOptions(filterTerm = '') {
    const container = document.getElementById('common-production-sizes-options-container');
    if (!container) return;
    container.innerHTML = '';

    const filtered = availableCommonProductionSizesList.filter(s =>
        s.size.toLowerCase().includes(filterTerm.toLowerCase())
    );

    if (filtered.length === 0) {
        container.innerHTML = '<span style="color: var(--text-muted); font-style: italic; padding: 12px; display: block;">No matching sizes found...</span>';
        return;
    }

    filtered.forEach(s => {
        const label = document.createElement('label');
        label.className = 'multiselect-option';

        const isChecked = selectedCommonProductionSizes.includes(String(s.id));

        label.innerHTML = `
            <label class="checkbox-container" style="margin: 0;">
                <input type="checkbox" value="${s.id}" ${isChecked ? 'checked' : ''} onchange="toggleCommonProductionSizeSelection(event, '${s.id}')">
                <span class="checkmark"></span>
                <span>${s.size}</span>
            </label>
        `;
        container.appendChild(label);
    });
}

function toggleCommonProductionSizeSelection(event, sizeId) {
    const sIdStr = String(sizeId);
    if (event.target.checked) {
        if (!selectedCommonProductionSizes.includes(sIdStr)) {
            selectedCommonProductionSizes.push(sIdStr);
        }
    } else {
        selectedCommonProductionSizes = selectedCommonProductionSizes.filter(id => id !== sIdStr);
    }
    updateCommonProductionSelectedSizesChips();
    regenerateCommonProductionSizeDIATable();
}

function removeCommonProductionSizeChip(sizeId) {
    const sIdStr = String(sizeId);
    selectedCommonProductionSizes = selectedCommonProductionSizes.filter(id => id !== sIdStr);
    updateCommonProductionSelectedSizesChips();
    document.querySelectorAll(`#common-production-sizes-options-container input[value="${sizeId}"]`).forEach(cb => cb.checked = false);
    regenerateCommonProductionSizeDIATable();
}

function updateCommonProductionSelectedSizesChips() {
    const container = document.getElementById('common-production-selected-sizes-container');
    if (!container) return;
    container.innerHTML = '';

    if (selectedCommonProductionSizes.length === 0) {
        container.innerHTML = '<span class="placeholder">Select Sizes...</span>';
        return;
    }

    selectedCommonProductionSizes.forEach(sizeId => {
        const match = availableCommonProductionSizesList.find(s => String(s.id) === String(sizeId));
        if (match) {
            const chip = document.createElement('span');
            chip.className = 'selected-tag';
            chip.innerHTML = `
                ${match.size}
                <span class="remove-tag" onclick="event.stopPropagation(); removeCommonProductionSizeChip('${sizeId}')">&times;</span>
            `;
            container.appendChild(chip);
        }
    });
}

function regenerateCommonProductionSizeDIATable() {
    const tbody = document.getElementById('common-production-sizewise-dia-tbody');
    if (!tbody) return;

    const currentVals = {};
    tbody.querySelectorAll('tr').forEach(tr => {
        const sId = tr.dataset.sizeId;
        const sel = tr.querySelector('select');
        if (sId && sel) {
            currentVals[sId] = sel.value;
        }
    });

    tbody.innerHTML = '';

    if (selectedCommonProductionSizes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="2" style="text-align: center; color: var(--text-muted); font-style: italic; padding: 12px;">No sizes selected...</td></tr>';
        return;
    }

    selectedCommonProductionSizes.forEach(sizeId => {
        const match = availableCommonProductionSizesList.find(s => String(s.id) === String(sizeId));
        if (!match) return;

        const tr = document.createElement('tr');
        tr.dataset.sizeId = sizeId;

        let optionsHtml = '<option value="">Select DIA...</option>';
        commonProductionAvailableDias.forEach(d => {
            optionsHtml += `<option value="${d}">${d}</option>`;
        });

        tr.innerHTML = `
            <td style="padding: 8px 12px; font-size: 13px;">${match.size}</td>
            <td style="padding: 8px 12px;">
                <select class="table-select" style="padding: 4px 8px; font-size: 13px;" required>
                    ${optionsHtml}
                </select>
            </td>
        `;
        tbody.appendChild(tr);

        if (currentVals[sizeId]) {
            const sel = tr.querySelector('select');
            if (sel) sel.value = currentVals[sizeId];
        }
    });

    onCommonProductionDIAModeChange();
}

function onCommonProductionDIAModeChange() {
    const isCommon = document.querySelector('input[name="common-production-dia-mode-radio"]:checked')?.value === 'Common DIA for All Sizes';
    const commonWrapper = document.getElementById('common-production-common-dia-wrapper');
    const sizewiseWrapper = document.getElementById('common-production-sizewise-dia-wrapper');

    if (isCommon) {
        commonWrapper.classList.remove('hidden');
        document.getElementById('common-production-common-dia-select').setAttribute('required', 'true');

        sizewiseWrapper.classList.add('hidden');
        document.querySelectorAll('#common-production-sizewise-dia-tbody select').forEach(s => s.removeAttribute('required'));
    } else {
        commonWrapper.classList.add('hidden');
        document.getElementById('common-production-common-dia-select').removeAttribute('required');

        sizewiseWrapper.classList.remove('hidden');
        document.querySelectorAll('#common-production-sizewise-dia-tbody select').forEach(s => s.setAttribute('required', 'true'));
    }
}

async function onCommonProductionFabricChange() {
    const fabricId = document.getElementById('common-production-fabric-select').value;
    const commonDiaSelect = document.getElementById('common-production-common-dia-select');
    const sizeWiseTbody = document.getElementById('common-production-sizewise-dia-tbody');

    if (!commonDiaSelect || !sizeWiseTbody) return;

    commonDiaSelect.innerHTML = '<option value="">Select DIA...</option>';
    sizeWiseTbody.innerHTML = '';
    commonProductionAvailableDias = [];

    if (!fabricId) return;

    showLoader(true, "Loading fabric DIAs...");
    try {
        const fabricResp = await fetch(`/api/masters/fabrics`);
        const fabricData = await fabricResp.json();
        const fabricMatch = fabricData.success ? fabricData.fabrics.find(f => f.id == fabricId) : null;

        if (fabricMatch) {
            commonProductionAvailableDias = fabricMatch.dias || [];
            commonProductionAvailableDias.forEach(d => {
                commonDiaSelect.innerHTML += `<option value="${d}">${d}</option>`;
            });
            regenerateCommonProductionSizeDIATable();
        }
    } catch (err) {
        console.error("Error fetching fabric details for common production:", err);
    } finally {
        showLoader(false);
    }
}

async function initializeCommonProductionModalData(item = null) {
    showLoader(true, "Initializing modal data...");
    try {
        const fabricResp = await fetch('/api/masters/fabrics?status=Active');
        const fabricData = await fabricResp.json();

        const fabricSelect = document.getElementById('common-production-fabric-select');
        if (fabricSelect) {
            fabricSelect.innerHTML = '<option value="">Select Fabric...</option>';
            if (fabricData.success && fabricData.fabrics) {
                let fabrics = fabricData.fabrics;
                if (item && item.fabric_id && !fabrics.some(f => f.id == item.fabric_id)) {
                    const fullFabricResp = await fetch('/api/masters/fabrics');
                    const fullFabricData = await fullFabricResp.json();
                    if (fullFabricData.success && fullFabricData.fabrics) {
                        const oldFabric = fullFabricData.fabrics.find(f => f.id == item.fabric_id);
                        if (oldFabric) fabrics.push(oldFabric);
                    }
                }

                fabrics.forEach(f => {
                    fabricSelect.innerHTML += `<option value="${f.id}">${f.fabric_name}</option>`;
                });
            }
        }

        const sizeResp = await fetch('/api/masters/sizes?status=Active');
        const sizeData = await sizeResp.json();
        if (sizeData.success && sizeData.sizes) {
            availableCommonProductionSizesList = sizeData.sizes;
        } else {
            availableCommonProductionSizesList = [];
        }

        selectedCommonProductionSizes = [];
        commonProductionAvailableDias = [];

        if (item) {
            if (fabricSelect) fabricSelect.value = item.fabric_id || '';

            const consumptionInput = document.getElementById('common-production-fabric-consumption-input');
            if (consumptionInput) {
                consumptionInput.value = item.fabric_consumption !== null && item.fabric_consumption !== undefined ? item.fabric_consumption : '';
            }

            const diaMode = item.dia_mode || 'Common DIA for All Sizes';
            document.querySelectorAll('input[name="common-production-dia-mode-radio"]').forEach(radio => {
                radio.checked = (radio.value === diaMode);
            });

            if (item.fabric_id) {
                const fullFabricResp = await fetch('/api/masters/fabrics');
                const fullFabricData = await fullFabricResp.json();
                const fabricMatch = fullFabricData.success ? fullFabricData.fabrics.find(f => f.id == item.fabric_id) : null;
                if (fabricMatch) {
                    commonProductionAvailableDias = fabricMatch.dias || [];
                    const commonDiaSelect = document.getElementById('common-production-common-dia-select');
                    if (commonDiaSelect) {
                        commonDiaSelect.innerHTML = '<option value="">Select DIA...</option>';
                        commonProductionAvailableDias.forEach(d => {
                            commonDiaSelect.innerHTML += `<option value="${d}">${d}</option>`;
                        });
                        commonDiaSelect.value = item.common_dia || '';
                    }
                }
            }

            if (item.dias && item.dias.length > 0) {
                selectedCommonProductionSizes = item.dias.map(d => String(d.size_id));
            }

            buildCommonProductionSizesDropdownOptions();
            updateCommonProductionSelectedSizesChips();
            regenerateCommonProductionSizeDIATable();

            if (diaMode === 'Size-wise DIA' && item.dias) {
                item.dias.forEach(d => {
                    const row = document.querySelector(`#common-production-sizewise-dia-tbody tr[data-size-id="${d.size_id}"]`);
                    if (row) {
                        const sel = row.querySelector('select');
                        if (sel) sel.value = d.dia || '';
                    }
                });
            }
        } else {
            if (fabricSelect) fabricSelect.value = '';

            const consumptionInput = document.getElementById('common-production-fabric-consumption-input');
            if (consumptionInput) consumptionInput.value = '';

            document.querySelectorAll('input[name="common-production-dia-mode-radio"]').forEach(radio => {
                radio.checked = (radio.value === 'Common DIA for All Sizes');
            });
            const commonDiaSelect = document.getElementById('common-production-common-dia-select');
            if (commonDiaSelect) commonDiaSelect.innerHTML = '<option value="">Select DIA...</option>';

            buildCommonProductionSizesDropdownOptions();
            updateCommonProductionSelectedSizesChips();
            regenerateCommonProductionSizeDIATable();
        }

        onCommonProductionDIAModeChange();
    } catch (err) {
        console.error("Error initializing common production modal:", err);
    } finally {
        showLoader(false);
    }
}

async function openAddCommonProductionModal() {
    document.getElementById('common-production-modal-title').innerHTML = '<i class="fa-solid fa-layer-group"></i> Add New Common Production';
    document.getElementById('common-production-entry-id').value = '';
    document.getElementById('common-production-name-input').value = '';
    document.getElementById('common-production-status-select').value = 'Active';

    document.getElementById('common-production-master-modal').classList.remove('hidden');
    await initializeCommonProductionModalData(null);
}

async function editCommonProductionById(id) {
    const item = loadedCommonProductions.find(b => b.id === id);
    if (!item) return;

    document.getElementById('common-production-modal-title').innerHTML = '<i class="fa-solid fa-layer-group"></i> Edit Common Production';
    document.getElementById('common-production-entry-id').value = item.id;
    document.getElementById('common-production-name-input').value = item.common_production_name;
    document.getElementById('common-production-status-select').value = item.status;

    document.getElementById('common-production-master-modal').classList.remove('hidden');
    await initializeCommonProductionModalData(item);
}

function closeCommonProductionModal() {
    document.getElementById('common-production-master-modal').classList.add('hidden');
}

async function saveCommonProductionMaster(event) {
    event.preventDefault();
    const id = document.getElementById('common-production-entry-id').value;
    const name = document.getElementById('common-production-name-input').value.trim();
    const status = document.getElementById('common-production-status-select').value;

    if (!name) {
        alert("Common Production Name is required.");
        return;
    }

    const fabricId = document.getElementById('common-production-fabric-select').value;
    const fabricConsumption = parseFloat(document.getElementById('common-production-fabric-consumption-input').value) || 0;
    const diaMode = document.querySelector('input[name="common-production-dia-mode-radio"]:checked')?.value;
    const commonDia = document.getElementById('common-production-common-dia-select').value;

    if (!fabricId) {
        alert("Fabric selection is required.");
        return;
    }
    if (fabricConsumption <= 0 || isNaN(fabricConsumption)) {
        alert("Fabric Consumption must be greater than 0.");
        return;
    }
    if (!selectedCommonProductionSizes || selectedCommonProductionSizes.length === 0) {
        alert("At least one Size must be selected.");
        return;
    }

    const dias = [];
    if (diaMode === 'Common DIA for All Sizes') {
        if (!commonDia) {
            alert("Common DIA selection is required.");
            return;
        }
        selectedCommonProductionSizes.forEach(sizeId => {
            dias.push({
                size_id: parseInt(sizeId),
                dia: null
            });
        });
    } else {
        let hasError = false;
        selectedCommonProductionSizes.forEach(sizeId => {
            const row = document.querySelector(`#common-production-sizewise-dia-tbody tr[data-size-id="${sizeId}"]`);
            const val = row ? row.querySelector('select').value : '';
            if (!val) {
                hasError = true;
            }
            dias.push({
                size_id: parseInt(sizeId),
                dia: val ? parseInt(val) : null
            });
        });
        if (hasError) {
            alert("Please assign a DIA for each selected size.");
            return;
        }
    }

    const payload = {
        common_production_name: name,
        status: status,
        fabric_id: parseInt(fabricId),
        fabric_consumption: fabricConsumption,
        dia_mode: diaMode,
        common_dia: diaMode === 'Common DIA for All Sizes' ? parseInt(commonDia) : null,
        dias: dias
    };

    const url = id ? `/api/masters/common-production/${id}` : '/api/masters/common-production';
    const method = id ? 'PUT' : 'POST';

    showLoader(true, "Saving common production master record...");
    try {
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (response.ok && data.success) {
            closeCommonProductionModal();
            await fetchCommonProductionsMaster();
        } else {
            alert(data.message || "Failed to save common production entry.");
        }
    } catch (err) {
        console.error("Error saving common production:", err);
        alert("Network error. Failed to save common production.");
    } finally {
        showLoader(false);
    }
}

async function deleteCommonProductionMaster(id) {
    if (!confirm("Are you sure you want to delete this Common Production record? This is a soft delete (status will be set to Inactive).")) {
        return;
    }

    showLoader(true, "Soft deleting common production...");
    try {
        const response = await fetch(`/api/masters/common-production/${id}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        if (response.ok && data.success) {
            await fetchCommonProductionsMaster();
        } else {
            alert(data.message || "Failed to delete common production.");
        }
    } catch (err) {
        console.error("Error soft deleting common production:", err);
        alert("Network error. Failed to delete common production.");
    } finally {
        showLoader(false);
    }
}

async function fetchActiveCommonProductionsForSelect() {
    try {
        const response = await fetch('/api/masters/common-production?status=Active');
        const data = await response.json();
        if (response.ok && data.success) {
            const select = document.getElementById('product-common-name-select');
            if (select) {
                select.innerHTML = '<option value="">Select Common Group...</option>';
                data.common_productions.forEach(item => {
                    const opt = document.createElement('option');
                    opt.value = item.id;
                    opt.innerText = item.common_production_name;
                    select.appendChild(opt);
                });
            }
        }
    } catch (err) {
        console.error("Error fetching active common productions for select:", err);
    }
}

let lastLoadedCommonProductionDetail = null;

async function onProductProductionTypeChange() {
    const prodType = document.getElementById('product-production-type-select').value;
    const groupEl = document.getElementById('product-common-name-group');
    const selectEl = document.getElementById('product-common-name-select');
    const fabricSelect = document.getElementById('product-fabric-select');
    const radios = document.getElementsByName('product-dia-mode-radio');
    const commonDiaSelect = document.getElementById('product-common-dia-select');

    if (prodType === 'Common') {
        if (groupEl) groupEl.classList.remove('hidden');
        if (selectEl) selectEl.required = true;

        await onProductCommonProductionChange();
    } else {
        if (groupEl) groupEl.classList.add('hidden');
        if (selectEl) {
            selectEl.required = false;
            selectEl.value = '';
        }

        if (fabricSelect) fabricSelect.disabled = false;
        const consInput = document.getElementById('product-fabric-consumption-input');
        if (consInput) consInput.disabled = false;
        radios.forEach(r => r.disabled = false);
        if (commonDiaSelect) {
            commonDiaSelect.disabled = false;
            commonDiaSelect.removeAttribute('disabled');
        }

        showLoader(true, "Restoring size options...");
        try {
            const sizeResp = await fetch(`/api/masters/sizes?status=Active`);
            const sizeData = await sizeResp.json();
            if (sizeData.success && sizeData.sizes) {
                availableProductSizesList = sizeData.sizes;
            }
            buildProductSizesDropdownOptions();
            updateProductSelectedSizesChips();
            regenerateProductSizeDIATable();
        } catch (err) {
            console.error("Error restoring sizes:", err);
        } finally {
            showLoader(false);
        }
    }
}

async function onProductCommonProductionChange() {
    const cpId = document.getElementById('product-common-name-select').value;
    const fabricSelect = document.getElementById('product-fabric-select');
    const prodType = document.getElementById('product-production-type-select').value;
    const radios = document.getElementsByName('product-dia-mode-radio');
    const commonDiaSelect = document.getElementById('product-common-dia-select');

    const consInput = document.getElementById('product-fabric-consumption-input');

    if (prodType !== 'Common') {
        if (fabricSelect) fabricSelect.disabled = false;
        if (consInput) consInput.disabled = false;
        radios.forEach(r => r.disabled = false);
        if (commonDiaSelect) commonDiaSelect.disabled = false;
        return;
    }

    if (!cpId) {
        if (fabricSelect) fabricSelect.disabled = false;
        if (consInput) consInput.disabled = false;
        radios.forEach(r => r.disabled = false);
        if (commonDiaSelect) commonDiaSelect.disabled = false;

        const sizeResp = await fetch(`/api/masters/sizes?status=Active`);
        const sizeData = await sizeResp.json();
        if (sizeData.success && sizeData.sizes) {
            availableProductSizesList = sizeData.sizes;
        }
        buildProductSizesDropdownOptions();
        updateProductSelectedSizesChips();
        regenerateProductSizeDIATable();
        return;
    }

    let cpItem = lastLoadedCommonProductionDetail;
    if (!cpItem || String(cpItem.id) !== String(cpId)) {
        showLoader(true, "Loading Common Production configurations...");
        try {
            const response = await fetch('/api/masters/common-production');
            const data = await response.json();
            if (!response.ok || !data.success) {
                alert("Failed to load Common Production details.");
                return;
            }

            cpItem = data.common_productions.find(c => String(c.id) === String(cpId));
            if (!cpItem) {
                alert("Selected Common Production not found.");
                return;
            }
            lastLoadedCommonProductionDetail = cpItem;
        } catch (err) {
            console.error("Error loading common production details:", err);
            return;
        } finally {
            showLoader(false);
        }
    }

    if (fabricSelect) {
        fabricSelect.value = cpItem.fabric_id || '';
        fabricSelect.disabled = true;
    }

    if (consInput) {
        consInput.value = cpItem.fabric_consumption !== null && cpItem.fabric_consumption !== undefined ? cpItem.fabric_consumption : '';
        consInput.disabled = true;
    }

    if (document.getElementById('product-fabric-select').getAttribute('data-last-val') !== String(cpItem.fabric_id)) {
        document.getElementById('product-fabric-select').setAttribute('data-last-val', String(cpItem.fabric_id));
        await onProductFabricOrCategoryChange();
    }

    const cpSizesMap = {};
    if (cpItem.dias) {
        cpItem.dias.forEach(d => {
            cpSizesMap[d.size_id] = d.dia;
        });
    }

    const sizeResp = await fetch(`/api/masters/sizes?status=Active`);
    const sizeData = await sizeResp.json();
    if (sizeData.success && sizeData.sizes) {
        availableProductSizesList = sizeData.sizes.filter(s => String(s.id) in cpSizesMap);
    }

    selectedProductSizes = selectedProductSizes.filter(sId => sId in cpSizesMap);

    buildProductSizesDropdownOptions();
    updateProductSelectedSizesChips();

    regenerateProductSizeDIATable(true);

    radios.forEach(r => {
        r.checked = (r.value === cpItem.dia_mode);
        r.disabled = true;
    });

    if (cpItem.dia_mode === 'Common DIA for All Sizes') {
        if (commonDiaSelect) {
            commonDiaSelect.value = cpItem.common_dia || '';
            commonDiaSelect.disabled = true;
        }
    } else {
        selectedProductSizes.forEach(sizeId => {
            const selectEl = document.getElementById(`product-sizewise-dia-size-${sizeId}`);
            if (selectEl) {
                selectEl.value = cpSizesMap[sizeId] || '';
                selectEl.disabled = true;
            }
        });
    }

    onProductDIAModeChange();

    document.querySelectorAll('#product-sizewise-dia-tbody select').forEach(sel => {
        sel.disabled = true;
    });
}

// =========================================================================
// PRODUCT DESCRIPTION MASTER CONTROLLERS & DATA MANAGEMENT
// =========================================================================

let loadedProductDescriptions = [];
let productDescriptionSortColumn = 'id';
let productDescriptionSortDirection = 'desc';
let productDescriptionCurrentPage = 1;
const productDescriptionPageSize = 10;

async function initializeProductDescriptionMasterTab() {
    if (document.getElementById('product-description-master-search')) document.getElementById('product-description-master-search').value = '';
    if (document.getElementById('product-description-filter-status')) document.getElementById('product-description-filter-status').value = '';

    productDescriptionCurrentPage = 1;
    productDescriptionSortColumn = 'id';
    productDescriptionSortDirection = 'desc';

    await fetchProductDescriptionsMaster();
}

async function fetchProductDescriptionsMaster() {
    const loader = document.getElementById('product-description-master-loader');
    const empty = document.getElementById('product-description-master-empty');
    const tbody = document.getElementById('product-description-master-table-body');

    if (loader) loader.classList.remove('hidden');
    if (empty) empty.classList.add('hidden');
    if (tbody) tbody.innerHTML = '';

    const searchVal = document.getElementById('product-description-master-search')?.value.trim() || '';
    const statusVal = document.getElementById('product-description-filter-status')?.value || '';

    try {
        const queryParams = new URLSearchParams({
            search: searchVal,
            status: statusVal
        });
        const response = await fetch(`/api/masters/product-descriptions?${queryParams.toString()}`);
        const data = await response.json();
        if (response.ok && data.success) {
            loadedProductDescriptions = data.descriptions || [];
            renderProductDescriptionsList();
        } else {
            console.error("Failed to load product descriptions:", data.message);
        }
    } catch (err) {
        console.error("Product description fetch error:", err);
    } finally {
        if (loader) loader.classList.add('hidden');
    }
}

function renderProductDescriptionsList() {
    const tbody = document.getElementById('product-description-master-table-body');
    const empty = document.getElementById('product-description-master-empty');
    const infoSpan = document.getElementById('product-description-pagination-info');
    if (!tbody) return;
    tbody.innerHTML = '';

    const list = [...loadedProductDescriptions];
    list.sort((a, b) => {
        let valA = a[productDescriptionSortColumn];
        let valB = b[productDescriptionSortColumn];

        if (valA === null) valA = '';
        if (valB === null) valB = '';

        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();

        if (valA < valB) return productDescriptionSortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return productDescriptionSortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    const totalEntries = list.length;
    if (totalEntries === 0) {
        if (empty) empty.classList.remove('hidden');
        if (infoSpan) infoSpan.innerText = 'Showing 0-0 of 0 entries';
        return;
    }
    if (empty) empty.classList.add('hidden');

    const startIndex = (productDescriptionCurrentPage - 1) * productDescriptionPageSize;
    const endIndex = Math.min(startIndex + productDescriptionPageSize, totalEntries);
    const paginated = list.slice(startIndex, endIndex);

    if (infoSpan) {
        infoSpan.innerText = `Showing ${startIndex + 1}-${endIndex} of ${totalEntries} entries`;
    }

    paginated.forEach(item => {
        const tr = document.createElement('tr');
        const statusClass = item.status === 'Active' ? 'running' : 'stopped';

        const createdDate = item.created_at ? new Date(item.created_at).toLocaleDateString() : '';
        const updatedDate = item.updated_at ? new Date(item.updated_at).toLocaleDateString() : '';
        const codeDisplay = item.description_code ? item.description_code : '<span style="color: var(--text-secondary); font-style: italic;">None</span>';

        tr.innerHTML = `
            <td><strong>${item.product_description}</strong></td>
            <td><span class="table-badge" style="background: rgba(255,255,255,0.03); color: var(--text-primary); border: 1px solid var(--border-color);">${codeDisplay}</span></td>
            <td><span class="table-badge ${statusClass}">${item.status}</span></td>
            <td>${createdDate}</td>
            <td>${updatedDate}</td>
            <td class="text-right">
                <div class="actions-cell">
                    <button class="btn-action btn-edit" onclick="editProductDescriptionById(${item.id})" title="Edit Product Description">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button class="btn-action btn-delete" onclick="deleteProductDescriptionMaster(${item.id})" title="Delete Product Description">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function prevProductDescriptionPage() {
    if (productDescriptionCurrentPage > 1) {
        productDescriptionCurrentPage--;
        renderProductDescriptionsList();
    }
}

function nextProductDescriptionPage() {
    const maxPages = Math.ceil(loadedProductDescriptions.length / productDescriptionPageSize);
    if (productDescriptionCurrentPage < maxPages) {
        productDescriptionCurrentPage++;
        renderProductDescriptionsList();
    }
}

function sortProductDescriptions(column) {
    if (productDescriptionSortColumn === column) {
        productDescriptionSortDirection = productDescriptionSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        productDescriptionSortColumn = column;
        productDescriptionSortDirection = 'asc';
    }

    document.querySelectorAll('#product-description-master-panel th i.sort-indicator-icon').forEach(icon => {
        icon.className = 'fa-solid fa-sort';
    });

    const headers = document.querySelectorAll('#product-description-master-panel th');
    headers.forEach(h => {
        if (h.getAttribute('onclick')?.includes(column)) {
            const icon = h.querySelector('i.sort-indicator-icon');
            if (icon) {
                icon.className = productDescriptionSortDirection === 'asc' ? 'fa-solid fa-sort-up' : 'fa-solid fa-sort-down';
            }
        }
    });

    renderProductDescriptionsList();
}

function openAddProductDescriptionModal() {
    document.getElementById('product-description-modal-title').innerHTML = '<i class="fa-solid fa-align-left"></i> Add Product Description';
    document.getElementById('product-description-entry-id').value = '';
    document.getElementById('product-description-input').value = '';
    document.getElementById('product-description-code-input').value = '';
    document.getElementById('product-description-status-select').value = 'Active';

    document.getElementById('product-description-master-modal').classList.remove('hidden');
}

function editProductDescriptionById(id) {
    const item = loadedProductDescriptions.find(d => d.id === id);
    if (!item) return;

    document.getElementById('product-description-modal-title').innerHTML = '<i class="fa-solid fa-align-left"></i> Edit Product Description';
    document.getElementById('product-description-entry-id').value = item.id;
    document.getElementById('product-description-input').value = item.product_description;
    document.getElementById('product-description-code-input').value = item.description_code || '';
    document.getElementById('product-description-status-select').value = item.status;

    document.getElementById('product-description-master-modal').classList.remove('hidden');
}

function closeProductDescriptionModal() {
    document.getElementById('product-description-master-modal').classList.add('hidden');
}

async function saveProductDescriptionMaster(event) {
    event.preventDefault();
    const id = document.getElementById('product-description-entry-id').value;
    const desc = document.getElementById('product-description-input').value.trim();
    const code = document.getElementById('product-description-code-input').value.trim().toUpperCase();
    const status = document.getElementById('product-description-status-select').value;

    if (!desc) {
        alert("Product Description is required.");
        return;
    }

    const payload = {
        product_description: desc,
        description_code: code,
        status: status
    };

    const url = id ? `/api/masters/product-descriptions/${id}` : '/api/masters/product-descriptions';
    const method = id ? 'PUT' : 'POST';

    showLoader(true, "Saving product description master record...");
    try {
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (response.ok && data.success) {
            closeProductDescriptionModal();
            await fetchProductDescriptionsMaster();
        } else {
            alert(data.message || "Failed to save product description entry.");
        }
    } catch (err) {
        console.error("Error saving product description:", err);
        alert("Network error. Failed to save product description.");
    } finally {
        showLoader(false);
    }
}

async function deleteProductDescriptionMaster(id) {
    if (!confirm("Are you sure you want to delete this Product Description record? This is a soft delete (status will be set to Inactive).")) {
        return;
    }

    showLoader(true, "Soft deleting product description...");
    try {
        const response = await fetch(`/api/masters/product-descriptions/${id}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        if (response.ok && data.success) {
            await fetchProductDescriptionsMaster();
        } else {
            alert(data.message || "Failed to delete product description.");
        }
    } catch (err) {
        console.error("Error soft deleting product description:", err);
        alert("Network error. Failed to delete product description.");
    } finally {
        showLoader(false);
    }
}

function triggerProductDescriptionImport() {
    document.getElementById('product-description-import-file').click();
}

function importProductDescriptionsExcel(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const dataBytes = new Uint8Array(e.target.result);
            const workbook = XLSX.read(dataBytes, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(worksheet);

            const descriptions = [];
            rows.forEach(r => {
                const desc = r['Product Description'] || r['product_description'] || r['Description'] || r['description'];
                const code = r['Description Code'] || r['description_code'] || r['Code'] || r['code'];
                const status = r['Status'] || r['status'] || 'Active';

                if (desc) {
                    descriptions.push({
                        product_description: String(desc),
                        description_code: code ? String(code) : '',
                        status: String(status)
                    });
                }
            });

            if (descriptions.length === 0) {
                alert("No valid product description rows found. Excel file must contain a 'Product Description' column.");
                return;
            }

            showLoader(true, "Uploading Excel product description data...");
            const response = await fetch('/api/masters/product-descriptions/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ descriptions: descriptions })
            });
            const data = await response.json();
            if (response.ok && data.success) {
                alert(`Successfully imported/updated ${descriptions.length} product description records!`);
                await fetchProductDescriptionsMaster();
            } else {
                alert(data.message || "Failed to import product descriptions.");
            }
        } catch (err) {
            console.error("Error parsing Excel product descriptions:", err);
            alert("Invalid Excel formatting or parse failure.");
        } finally {
            showLoader(false);
            document.getElementById('product-description-import-file').value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

function exportProductDescriptionsExcel() {
    if (loadedProductDescriptions.length === 0) {
        alert("No product description records available for export.");
        return;
    }

    const data = loadedProductDescriptions.map(d => ({
        'Product Description': d.product_description,
        'Description Code': d.description_code || '',
        'Status': d.status
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Product Descriptions Master");
    XLSX.writeFile(workbook, "product_descriptions_master_records.xlsx");
}

// =========================================================================
// PRODUCT MASTER CONTROLLERS & DATA MANAGEMENT
// =========================================================================

let loadedProducts = [];
let productSortColumn = 'id';
let productSortDirection = 'desc';
let productCurrentPage = 1;
const productPageSize = 10;

let selectedProductColors = [];
let availableProductColorsList = []; // Cached colors for currently selected Fabric & Category

let selectedProductSalesProducts = [];
let availableSalesProductsList = [];

function buildProductSalesProductsDropdownOptions(filterTerm = '') {
    const container = document.getElementById('product-sales-products-options-container');
    if (!container) return;
    container.innerHTML = '';

    const filtered = availableSalesProductsList.filter(name =>
        name.toLowerCase().includes(filterTerm.toLowerCase())
    );

    if (filtered.length === 0) {
        container.innerHTML = '<span style="color: var(--text-muted); font-style: italic; padding: 12px; display: block;">No matching sales products found...</span>';
        return;
    }

    filtered.forEach(name => {
        const label = document.createElement('label');
        label.className = 'multiselect-option';

        const isChecked = selectedProductSalesProducts.includes(name);

        label.innerHTML = `
            <label class="checkbox-container" style="margin: 0;">
                <input type="checkbox" value="${name}" ${isChecked ? 'checked' : ''} onchange="toggleProductSalesProductSelection(event, '${name.replace(/'/g, "\\'")}')">
                <span class="checkmark"></span>
                <span>${name}</span>
            </label>
        `;
        container.appendChild(label);
    });
}

function toggleProductSalesProductsDropdown(event) {
    event.stopPropagation();
    const list = document.getElementById('product-sales-products-dropdown-list');
    list.classList.toggle('hidden');
}

function filterProductSalesProductsDropdown(event) {
    buildProductSalesProductsDropdownOptions(event.target.value);
}

function toggleProductSalesProductSelection(event, name) {
    if (event.target.checked) {
        if (!selectedProductSalesProducts.includes(name)) {
            selectedProductSalesProducts.push(name);
        }
    } else {
        selectedProductSalesProducts = selectedProductSalesProducts.filter(n => n !== name);
    }
    updateProductSelectedSalesProductsChips();
}

function removeProductSalesProductChip(name) {
    selectedProductSalesProducts = selectedProductSalesProducts.filter(n => n !== name);
    updateProductSelectedSalesProductsChips();
    document.querySelectorAll(`#product-sales-products-options-container input[value="${name}"]`).forEach(cb => cb.checked = false);
}

function updateProductSelectedSalesProductsChips() {
    const container = document.getElementById('product-selected-sales-products-container');
    if (!container) return;
    container.innerHTML = '';

    if (selectedProductSalesProducts.length === 0) {
        container.innerHTML = '<span class="placeholder">Select Sales Products...</span>';
        return;
    }

    selectedProductSalesProducts.forEach(name => {
        const chip = document.createElement('span');
        chip.className = 'selected-tag';
        chip.innerHTML = `${name} <span class="remove" onclick="event.stopPropagation(); removeProductSalesProductChip('${name.replace(/'/g, "\\'")}')">&times;</span>`;
        container.appendChild(chip);
    });
}

async function initializeProductMasterTab() {
    if (document.getElementById('product-master-search')) document.getElementById('product-master-search').value = '';
    if (document.getElementById('product-filter-brand')) document.getElementById('product-filter-brand').value = '';
    if (document.getElementById('product-filter-fabric')) document.getElementById('product-filter-fabric').value = '';
    if (document.getElementById('product-filter-type')) document.getElementById('product-filter-type').value = '';
    if (document.getElementById('product-filter-description')) document.getElementById('product-filter-description').value = '';
    if (document.getElementById('product-filter-status')) document.getElementById('product-filter-status').value = '';
    if (document.getElementById('product-filter-production-type')) document.getElementById('product-filter-production-type').value = '';

    productCurrentPage = 1;
    productSortColumn = 'id';
    productSortDirection = 'desc';

    await populateProductMasterDropdowns();
    await fetchProductsMaster();
}

async function populateProductMasterDropdowns() {
    try {
        const brandResp = await fetch('/api/masters/brands?status=Active');
        const brandData = await brandResp.json();
        const brandSelects = [
            document.getElementById('product-filter-brand'),
            document.getElementById('product-brand-select')
        ];
        brandSelects.forEach(sel => {
            if (sel) {
                const optVal = sel.id.includes('filter') ? 'All Brands' : 'Select Brand...';
                sel.innerHTML = `<option value="">${optVal}</option>`;
                if (brandData.success && brandData.brands) {
                    brandData.brands.forEach(b => {
                        sel.innerHTML += `<option value="${b.id}">${b.brand_name}</option>`;
                    });
                }
            }
        });

        const fabricResp = await fetch('/api/masters/fabrics?status=Active');
        const fabricData = await fabricResp.json();
        const fabricSelects = [
            document.getElementById('product-filter-fabric'),
            document.getElementById('product-fabric-select')
        ];
        fabricSelects.forEach(sel => {
            if (sel) {
                const optVal = sel.id.includes('filter') ? 'All Fabrics' : 'Select Fabric...';
                sel.innerHTML = `<option value="">${optVal}</option>`;
                if (fabricData.success && fabricData.fabrics) {
                    fabricData.fabrics.forEach(f => {
                        sel.innerHTML += `<option value="${f.id}">${f.fabric_name}</option>`;
                    });
                }
            }
        });

        const descResp = await fetch('/api/masters/product-descriptions?status=Active');
        const descData = await descResp.json();
        const descSelects = [
            document.getElementById('product-filter-description'),
            document.getElementById('product-description-select')
        ];
        descSelects.forEach(sel => {
            if (sel) {
                const optVal = sel.id.includes('filter') ? 'All Descs' : 'Select Description...';
                sel.innerHTML = `<option value="">${optVal}</option>`;
                if (descData.success && descData.descriptions) {
                    descData.descriptions.forEach(d => {
                        sel.innerHTML += `<option value="${d.id}">${d.product_description}</option>`;
                    });
                }
            }
        });

        const salesProdResp = await fetch('/api/masters/sales-products');
        const salesProdData = await salesProdResp.json();
        if (salesProdData.success && salesProdData.products) {
            availableSalesProductsList = salesProdData.products;
        } else {
            availableSalesProductsList = [];
        }
        buildProductSalesProductsDropdownOptions();
    } catch (err) {
        console.error("Error populating product master options:", err);
    }
}

async function fetchProductsMaster() {
    const loader = document.getElementById('product-master-loader');
    const empty = document.getElementById('product-master-empty');
    const tbody = document.getElementById('product-master-table-body');

    if (loader) loader.classList.remove('hidden');
    if (empty) empty.classList.add('hidden');
    if (tbody) tbody.innerHTML = '';

    const searchVal = document.getElementById('product-master-search')?.value.trim() || '';
    const brandVal = document.getElementById('product-filter-brand')?.value || '';
    const fabricVal = document.getElementById('product-filter-fabric')?.value || '';
    const typeVal = document.getElementById('product-filter-type')?.value || '';
    const descVal = document.getElementById('product-filter-description')?.value || '';
    const statusVal = document.getElementById('product-filter-status')?.value || '';
    const prodTypeVal = document.getElementById('product-filter-production-type')?.value || '';

    try {
        const queryParams = new URLSearchParams({
            search: searchVal,
            brand_id: brandVal,
            fabric_id: fabricVal,
            product_type: typeVal,
            product_description_id: descVal,
            production_type: prodTypeVal,
            status: statusVal
        });
        const response = await fetch(`/api/masters/products?${queryParams.toString()}`);
        const data = await response.json();
        if (response.ok && data.success) {
            loadedProducts = data.products || [];
            renderProductsList();
        } else {
            console.error("Failed to load products master:", data.message);
        }
    } catch (err) {
        console.error("Product master fetch error:", err);
    } finally {
        if (loader) loader.classList.add('hidden');
    }
}

function renderProductsList() {
    const tbody = document.getElementById('product-master-table-body');
    const empty = document.getElementById('product-master-empty');
    const infoSpan = document.getElementById('product-pagination-info');
    if (!tbody) return;
    tbody.innerHTML = '';

    const list = [...loadedProducts];
    list.sort((a, b) => {
        let valA = a[productSortColumn];
        let valB = b[productSortColumn];

        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();

        if (valA < valB) return productSortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return productSortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    const totalEntries = list.length;
    if (totalEntries === 0) {
        if (empty) empty.classList.remove('hidden');
        if (infoSpan) infoSpan.innerText = 'Showing 0-0 of 0 entries';
        return;
    }
    if (empty) empty.classList.add('hidden');

    const startIndex = (productCurrentPage - 1) * productPageSize;
    const endIndex = Math.min(startIndex + productPageSize, totalEntries);
    const paginated = list.slice(startIndex, endIndex);

    if (infoSpan) {
        infoSpan.innerText = `Showing ${startIndex + 1}-${endIndex} of ${totalEntries} entries`;
    }

    paginated.forEach(item => {
        const tr = document.createElement('tr');
        const statusClass = item.status === 'Active' ? 'running' : 'stopped';

        const colorsCount = item.colors ? item.colors.length : 0;

        const salesDataProductsText = item.sales_data_products && item.sales_data_products.length > 0
            ? item.sales_data_products.map(p => `<span class="table-badge badge-outline" style="margin: 2px; font-size: 11px;">${p}</span>`).join(' ')
            : `<span style="color: var(--text-muted); font-style: italic; font-size: 12px;">None</span>`;

        tr.innerHTML = `
            <td><strong>${item.product_name}</strong></td>
            <td>${item.brand_name}</td>
            <td>${item.fabric_name}</td>
            <td><strong>${item.fabric_consumption !== undefined && item.fabric_consumption !== null ? item.fabric_consumption : 0}</strong></td>
            <td>${item.product_description}</td>
            <td><span class="table-badge badge-outline">${item.product_type}</span></td>
            <td><span class="table-badge" style="background: rgba(255,255,255,0.03);">${item.color_category}</span></td>
            <td><strong>${colorsCount} Colors</strong></td>
            <td style="max-width: 250px; overflow-wrap: break-word;">${salesDataProductsText}</td>
            <td><span style="font-size: 13px; color: var(--text-muted);">${item.dia_mode}</span></td>
            <td><span class="table-badge badge-outline">${item.production_type || 'Common'}</span></td>
            <td><span class="table-badge ${statusClass}">${item.status}</span></td>
            <td class="text-right">
                <div class="actions-cell">
                    <button class="btn-action btn-edit" onclick="editProductById(${item.id})" title="Edit Product">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button class="btn-action btn-delete" onclick="deleteProductMaster(${item.id})" title="Delete Product">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function prevProductPage() {
    if (productCurrentPage > 1) {
        productCurrentPage--;
        renderProductsList();
    }
}

function nextProductPage() {
    const maxPages = Math.ceil(loadedProducts.length / productPageSize);
    if (productCurrentPage < maxPages) {
        productCurrentPage++;
        renderProductsList();
    }
}

function sortProducts(column) {
    if (productSortColumn === column) {
        productSortDirection = productSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        productSortColumn = column;
        productSortDirection = 'asc';
    }

    document.querySelectorAll('#product-master-panel th i.sort-indicator-icon').forEach(icon => {
        icon.className = 'fa-solid fa-sort';
    });

    const headers = document.querySelectorAll('#product-master-panel th');
    headers.forEach(h => {
        if (h.getAttribute('onclick')?.includes(column)) {
            const icon = h.querySelector('i.sort-indicator-icon');
            if (icon) {
                icon.className = productSortDirection === 'asc' ? 'fa-solid fa-sort-up' : 'fa-solid fa-sort-down';
            }
        }
    });

    renderProductsList();
}

async function openAddProductModal() {
    document.getElementById('product-modal-title').innerHTML = '<i class="fa-solid fa-shirt"></i> Add New Product';
    document.getElementById('product-entry-id').value = '';
    document.getElementById('product-name-input').value = '';
    document.getElementById('product-brand-select').value = '';
    document.getElementById('product-fabric-select').value = '';
    if (document.getElementById('product-fabric-consumption-input')) document.getElementById('product-fabric-consumption-input').value = '';
    document.getElementById('product-description-select').value = '';
    document.getElementById('product-type-select').value = 'Core Product';
    document.getElementById('product-color-category-select').value = 'Primary';
    document.getElementById('product-production-type-select').value = 'Common';
    document.getElementById('product-status-select').value = 'Active';

    await fetchActiveCommonProductionsForSelect();
    document.getElementById('product-common-name-select').value = '';
    onProductProductionTypeChange();

    const radios = document.getElementsByName('product-dia-mode-radio');
    radios.forEach(r => {
        if (r.value === 'Common DIA for All Sizes') r.checked = true;
    });

    selectedProductColors = [];
    availableProductColorsList = [];
    const colorSearchInput = document.getElementById('product-colors-search-input');
    if (colorSearchInput) colorSearchInput.value = '';

    selectedProductSalesProducts = [];
    updateProductSelectedSalesProductsChips();
    buildProductSalesProductsDropdownOptions();

    selectedProductSizes = [];
    availableProductSizesList = [];
    fabricAvailableDias = [];

    updateProductSelectedColorsChips();
    buildProductColorsDropdownOptions();

    updateProductSelectedSizesChips();
    buildProductSizesDropdownOptions();
    regenerateProductSizeDIATable();

    onProductDIAModeChange();

    document.getElementById('product-master-modal').classList.remove('hidden');
}

async function editProductById(id) {
    const item = loadedProducts.find(p => p.id === id);
    if (!item) return;

    document.getElementById('product-modal-title').innerHTML = '<i class="fa-solid fa-shirt"></i> Edit Product';
    document.getElementById('product-entry-id').value = item.id;
    document.getElementById('product-name-input').value = item.product_name;
    document.getElementById('product-brand-select').value = item.brand_id;
    document.getElementById('product-fabric-select').value = item.fabric_id;
    if (document.getElementById('product-fabric-consumption-input')) {
        document.getElementById('product-fabric-consumption-input').value = item.fabric_consumption !== undefined && item.fabric_consumption !== null ? item.fabric_consumption : 0;
    }
    document.getElementById('product-description-select').value = item.product_description_id;
    document.getElementById('product-type-select').value = item.product_type;
    document.getElementById('product-color-category-select').value = item.color_category;
    document.getElementById('product-production-type-select').value = item.production_type || 'Common';
    document.getElementById('product-status-select').value = item.status;

    await fetchActiveCommonProductionsForSelect();
    document.getElementById('product-common-name-select').value = item.common_production_id || '';
    onProductProductionTypeChange();

    const radios = document.getElementsByName('product-dia-mode-radio');
    radios.forEach(r => {
        if (r.value === item.dia_mode) r.checked = true;
    });

    const colorSearchInput = document.getElementById('product-colors-search-input');
    if (colorSearchInput) colorSearchInput.value = '';

    await onProductFabricOrCategoryChange();

    selectedProductColors = item.colors ? item.colors.map(c => c.global_color_code) : [];
    updateProductSelectedColorsChips();
    buildProductColorsDropdownOptions();

    selectedProductSalesProducts = item.sales_data_products ? [...item.sales_data_products] : [];
    updateProductSelectedSalesProductsChips();
    buildProductSalesProductsDropdownOptions();
    document.querySelectorAll('#product-sales-products-options-container .checkbox-container input').forEach(input => {
        input.checked = selectedProductSalesProducts.includes(input.value);
    });

    const hasNullSizeId = item.dias && item.dias.some(d => !d.size_id || String(d.size_id) === 'null' || d.size_name === 'Common');
    if (hasNullSizeId) {
        selectedProductSizes = [];
    } else {
        selectedProductSizes = item.dias ? item.dias.map(d => String(d.size_id)) : [];
    }

    updateProductSelectedSizesChips();
    buildProductSizesDropdownOptions();
    document.querySelectorAll('#product-sizes-options-container .checkbox-container input').forEach(input => {
        input.checked = selectedProductSizes.includes(input.value);
    });
    regenerateProductSizeDIATable();

    if (item.dia_mode === 'Common DIA for All Sizes') {
        const firstDiaObj = item.dias && item.dias.length > 0 ? item.dias[0] : null;
        document.getElementById('product-common-dia-select').value = firstDiaObj ? firstDiaObj.dia : '';
    } else {
        item.dias.forEach(d => {
            const selectEl = document.getElementById(`product-sizewise-dia-size-${d.size_id}`);
            if (selectEl) selectEl.value = d.dia;
        });
    }

    onProductDIAModeChange();
    if (item.production_type === 'Common') {
        await onProductCommonProductionChange();
    }
    document.getElementById('product-master-modal').classList.remove('hidden');
}

function closeProductModal() {
    document.getElementById('product-master-modal').classList.add('hidden');
}

async function onProductFabricOrCategoryChange() {
    const fabricId = document.getElementById('product-fabric-select').value;
    const category = document.getElementById('product-color-category-select').value;

    const colorsContainer = document.getElementById('product-colors-options-container');
    const commonDiaSelect = document.getElementById('product-common-dia-select');
    const sizeWiseTbody = document.getElementById('product-sizewise-dia-tbody');

    if (!colorsContainer || !commonDiaSelect || !sizeWiseTbody) return;

    colorsContainer.innerHTML = '<span style="color: var(--text-muted); font-style: italic; padding: 12px; display: block;">No colors matching category...</span>';
    commonDiaSelect.innerHTML = '<option value="">Select DIA...</option>';
    sizeWiseTbody.innerHTML = '';

    const colorSearchInput = document.getElementById('product-colors-search-input');
    if (colorSearchInput) colorSearchInput.value = '';

    if (!fabricId) {
        availableProductColorsList = [];
        updateProductColorsSelectAllState([]);
        return;
    }

    showLoader(true, "Loading fabric colors & DIAs...");
    try {
        const fabricResp = await fetch(`/api/masters/fabrics`);
        const fabricData = await fabricResp.json();
        const fabricMatch = fabricData.success ? fabricData.fabrics.find(f => f.id == fabricId) : null;

        if (fabricMatch) {
            const fabricDias = fabricMatch.dias || [];
            fabricDias.forEach(d => {
                commonDiaSelect.innerHTML += `<option value="${d}">${d}</option>`;
            });

            const colorResp = await fetch(`/api/masters/colors?category=${category}&status=Active`);
            const colorData = await colorResp.json();

            const globalPrimaryCodes = fabricMatch.colors ? fabricMatch.colors.map(c => c.global_color_code) : [];

            let matchingColors = [];
            if (colorData.success && colorData.colors) {
                matchingColors = colorData.colors.filter(c => globalPrimaryCodes.includes(c.global_color_code));
            }

            availableProductColorsList = matchingColors;
            buildProductColorsDropdownOptions();

            fabricAvailableDias = fabricDias;

            const sizeResp = await fetch(`/api/masters/sizes?status=Active`);
            const sizeData = await sizeResp.json();
            if (sizeData.success && sizeData.sizes) {
                availableProductSizesList = sizeData.sizes;
            }

            buildProductSizesDropdownOptions();
            updateProductSelectedSizesChips();
            regenerateProductSizeDIATable();
        }
    } catch (err) {
        console.error("Error fetching fabric details:", err);
    } finally {
        showLoader(false);
    }
}

function onProductDIAModeChange() {
    const isCommon = document.querySelector('input[name="product-dia-mode-radio"]:checked')?.value === 'Common DIA for All Sizes';
    const commonWrapper = document.getElementById('product-common-dia-wrapper');
    const sizewiseWrapper = document.getElementById('product-sizewise-dia-wrapper');

    if (isCommon) {
        commonWrapper.classList.remove('hidden');
        document.getElementById('product-common-dia-select').setAttribute('required', 'true');

        sizewiseWrapper.classList.add('hidden');
        document.querySelectorAll('#product-sizewise-dia-tbody select').forEach(s => s.removeAttribute('required'));
    } else {
        commonWrapper.classList.add('hidden');
        document.getElementById('product-common-dia-select').removeAttribute('required');

        sizewiseWrapper.classList.remove('hidden');
        document.querySelectorAll('#product-sizewise-dia-tbody select').forEach(s => s.setAttribute('required', 'true'));
    }
}

function getCurrentFilteredProductColors(filterTerm) {
    const searchInput = document.getElementById('product-colors-search-input');
    const term = (typeof filterTerm === 'string' ? filterTerm : (searchInput ? searchInput.value : '')).trim().toLowerCase();

    if (!term) {
        return availableProductColorsList || [];
    }

    return (availableProductColorsList || []).filter(c => {
        const globalCode = (c.global_color_code || '').trim().toLowerCase();
        const displayColor = (c.display_color || '').trim().toLowerCase();
        return globalCode.includes(term) || displayColor.includes(term);
    });
}

function buildProductColorsDropdownOptions(filterTerm = '') {
    const container = document.getElementById('product-colors-options-container');
    if (!container) return;
    container.innerHTML = '';

    const filtered = getCurrentFilteredProductColors(filterTerm);

    if (filtered.length === 0) {
        container.innerHTML = '<span style="color: var(--text-muted); font-style: italic; padding: 12px; display: block;">No colors found</span>';
        updateProductColorsSelectAllState(filtered);
        return;
    }

    filtered.forEach(c => {
        const label = document.createElement('label');
        label.className = 'multiselect-option';

        const isChecked = selectedProductColors.includes(c.global_color_code);
        const displayText = (c.global_color_code && c.display_color && c.global_color_code !== c.display_color)
            ? `${c.global_color_code} — ${c.display_color}`
            : (c.display_color || c.global_color_code);

        label.innerHTML = `
            <label class="checkbox-container" style="margin: 0; display: flex; align-items: center; gap: 8px; width: 100%; cursor: pointer;">
                <input type="checkbox" value="${c.global_color_code}" ${isChecked ? 'checked' : ''} onchange="toggleProductColorSelection(event, '${c.global_color_code}')">
                <span class="checkmark"></span>
                <span class="color-option-text" style="font-size: 13px;">${escapeHTML(displayText)}</span>
            </label>
        `;
        container.appendChild(label);
    });

    updateProductColorsSelectAllState(filtered);
}

function updateProductColorsSelectAllState(filteredColors) {
    const selectAllCheckbox = document.getElementById('product-colors-select-all-checkbox');
    const selectAllLabel = document.getElementById('product-colors-select-all-label');
    const countBadge = document.getElementById('product-colors-count-badge');
    if (!selectAllCheckbox || !selectAllLabel) return;

    const filtered = filteredColors !== undefined ? filteredColors : getCurrentFilteredProductColors();
    const totalFiltered = filtered.length;
    const selectedFilteredCount = filtered.filter(c => selectedProductColors.includes(c.global_color_code)).length;
    const totalSelected = selectedProductColors.length;
    const totalAvailable = (availableProductColorsList || []).length;

    if (countBadge) {
        countBadge.textContent = `${totalSelected} / ${totalAvailable} selected`;
    }

    if (totalFiltered === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
        selectAllCheckbox.disabled = true;
        selectAllLabel.textContent = `Select All (0)`;
        return;
    }

    selectAllCheckbox.disabled = false;
    if (selectedFilteredCount === totalFiltered) {
        selectAllLabel.textContent = `Select All (${totalFiltered})`;
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
    } else if (selectedFilteredCount > 0) {
        selectAllLabel.textContent = `Select All (${totalFiltered}) • ${selectedFilteredCount} selected`;
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true;
    } else {
        selectAllLabel.textContent = `Select All (${totalFiltered})`;
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    }
}

function toggleProductColorsSelectAll(event) {
    const filtered = getCurrentFilteredProductColors();
    if (filtered.length === 0) return;

    const allFilteredSelected = filtered.every(c => selectedProductColors.includes(c.global_color_code));

    if (allFilteredSelected) {
        // Deselect only currently filtered colors (preserves other selections)
        const filteredCodes = new Set(filtered.map(c => c.global_color_code));
        selectedProductColors = selectedProductColors.filter(code => !filteredCodes.has(code));
    } else {
        // Select all currently filtered colors (preserves other selections)
        filtered.forEach(c => {
            if (!selectedProductColors.includes(c.global_color_code)) {
                selectedProductColors.push(c.global_color_code);
            }
        });
    }

    const searchInput = document.getElementById('product-colors-search-input');
    buildProductColorsDropdownOptions(searchInput ? searchInput.value : '');
    updateProductSelectedColorsChips();
}

function toggleProductColorsDropdown(event) {
    event.stopPropagation();
    const list = document.getElementById('product-colors-dropdown-list');
    list.classList.toggle('hidden');
}

function filterProductColorsDropdown(event) {
    buildProductColorsDropdownOptions(event.target.value);
}

function toggleProductColorSelection(event, code) {
    if (event.target.checked) {
        if (!selectedProductColors.includes(code)) {
            selectedProductColors.push(code);
        }
    } else {
        selectedProductColors = selectedProductColors.filter(c => c !== code);
    }
    updateProductSelectedColorsChips();
    updateProductColorsSelectAllState();
}

function removeProductColorChip(code) {
    selectedProductColors = selectedProductColors.filter(c => c !== code);
    updateProductSelectedColorsChips();
    const cb = document.querySelector(`#product-colors-options-container input[value="${code}"]`);
    if (cb) cb.checked = false;
    updateProductColorsSelectAllState();
}

function updateProductSelectedColorsChips() {
    const container = document.getElementById('product-selected-colors-container');
    if (!container) return;
    container.innerHTML = '';

    if (selectedProductColors.length === 0) {
        container.innerHTML = '<span class="placeholder">Select Colors (Choose Fabric First)...</span>';
        return;
    }

    selectedProductColors.forEach(code => {
        const match = availableProductColorsList.find(c => c.global_color_code === code);
        const displayText = match ? (
            (match.global_color_code && match.display_color && match.global_color_code !== match.display_color)
                ? `${match.global_color_code} — ${match.display_color}`
                : (match.display_color || match.global_color_code)
        ) : code;

        const chip = document.createElement('span');
        chip.className = 'selected-tag';
        chip.innerHTML = `${escapeHTML(displayText)} <span class="remove" onclick="event.stopPropagation(); removeProductColorChip('${code}')">&times;</span>`;
        container.appendChild(chip);
    });
}

async function saveProductMaster(event) {
    event.preventDefault();
    const id = document.getElementById('product-entry-id').value;
    const name = document.getElementById('product-name-input').value.trim();
    const brand_id = document.getElementById('product-brand-select').value;
    const fabric_id = document.getElementById('product-fabric-select').value;
    const fabric_consumption = parseFloat(document.getElementById('product-fabric-consumption-input')?.value) || 0;
    const desc_id = document.getElementById('product-description-select').value;
    const prod_type = document.getElementById('product-type-select').value;
    const color_cat = document.getElementById('product-color-category-select').value;
    const production_type = document.getElementById('product-production-type-select').value;
    const status = document.getElementById('product-status-select').value;
    const dia_mode = document.querySelector('input[name="product-dia-mode-radio"]:checked')?.value;

    if (!name || !brand_id || !fabric_id || !desc_id || !prod_type || !color_cat || !dia_mode || !production_type) {
        alert("Please complete all required product fields.");
        return;
    }

    const common_production_id = document.getElementById('product-common-name-select').value;
    if (production_type === 'Common' && !common_production_id) {
        alert("Common Production Name is required when Production Type is Common.");
        return;
    }

    if (selectedProductColors.length === 0) {
        alert("Please select at least one Color.");
        return;
    }

    const dias = [];
    if (dia_mode === 'Common DIA for All Sizes') {
        const commonDia = document.getElementById('product-common-dia-select').value;
        if (!commonDia) {
            alert("Common DIA is mandatory.");
            return;
        }
        if (selectedProductSizes.length === 0) {
            alert("Please select at least one Size.");
            return;
        }
        selectedProductSizes.forEach(sizeId => {
            dias.push({ size_id: parseInt(sizeId), dia: parseFloat(commonDia) });
        });
    } else {
        if (selectedProductSizes.length === 0) {
            alert("Please select at least one Size for Size-wise DIA mode.");
            return;
        }
        const selects = document.querySelectorAll('#product-sizewise-dia-tbody select');
        let allAssigned = true;
        selects.forEach(sel => {
            const sizeId = sel.getAttribute('data-size-id');
            const diaVal = sel.value;
            if (!diaVal) allAssigned = false;
            dias.push({ size_id: parseInt(sizeId), dia: parseFloat(diaVal) });
        });
        if (!allAssigned) {
            alert("Every selected Size must have one DIA assigned.");
            return;
        }
    }

    const payload = {
        product_name: name,
        brand_id: parseInt(brand_id),
        fabric_id: parseInt(fabric_id),
        fabric_consumption: fabric_consumption,
        product_description_id: parseInt(desc_id),
        product_type: prod_type,
        color_category: color_cat,
        dia_mode: dia_mode,
        production_type: production_type,
        status: status,
        colors: selectedProductColors,
        dias: dias,
        sales_data_products: selectedProductSalesProducts,
        common_production_id: production_type === 'Common' && common_production_id ? parseInt(common_production_id) : null
    };

    const url = id ? `/api/masters/products/${id}` : '/api/masters/products';
    const method = id ? 'PUT' : 'POST';

    showLoader(true, "Saving product master record...");
    try {
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (response.ok && data.success) {
            planningContribMeta = null;
            closeProductModal();
            await fetchProductsMaster();
        } else {
            alert(data.message || "Failed to save product entry.");
        }
    } catch (err) {
        console.error("Error saving product:", err);
        alert("Network error. Failed to save product.");
    } finally {
        showLoader(false);
    }
}

async function deleteProductMaster(id) {
    if (!confirm("Are you sure you want to delete this Product record? This is a soft delete (status will be set to Inactive).")) {
        return;
    }

    showLoader(true, "Soft deleting product...");
    try {
        const response = await fetch(`/api/masters/products/${id}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        if (response.ok && data.success) {
            planningContribMeta = null;
            await fetchProductsMaster();
        } else {
            alert(data.message || "Failed to delete product.");
        }
    } catch (err) {
        console.error("Error soft deleting product:", err);
        alert("Network error. Failed to delete product.");
    } finally {
        showLoader(false);
    }
}

function triggerProductImport() {
    document.getElementById('product-import-file').click();
}

function importProductsExcel(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const dataBytes = new Uint8Array(e.target.result);
            const workbook = XLSX.read(dataBytes, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(worksheet);

            const products = [];
            rows.forEach(r => {
                const name = r['Product Name'] || r['product_name'] || r['Product'] || r['product'];
                const brand = r['Brand'] || r['brand_name'] || r['brand'];
                const fabric = r['Fabric'] || r['fabric_name'] || r['fabric'];
                const desc = r['Product Description'] || r['product_description'] || r['description'];
                const type = r['Product Type'] || r['product_type'] || 'Core Product';
                const colorCat = r['Color Category'] || r['color_category'] || 'Primary';
                const diaMode = r['DIA Mode'] || r['dia_mode'] || 'Common DIA for All Sizes';
                const status = r['Status'] || r['status'] || 'Active';
                const prodType = r['Production Type'] || r['production_type'] || 'Common';
                const colors = r['Colors'] || r['colors'] || '';
                const commonDia = r['Common DIA'] || r['common_dia'] || r['dia'];
                const fabCons = r['Fabric Consumption'] || r['fabric_consumption'] || r['Fabric Cons'] || r['consumption'] || 0;

                if (name && brand && fabric && desc) {
                    products.push({
                        product_name: String(name),
                        brand_name: String(brand),
                        fabric_name: String(fabric),
                        fabric_consumption: parseFloat(fabCons) || 0,
                        product_description: String(desc),
                        product_type: String(type),
                        color_category: String(colorCat),
                        dia_mode: String(diaMode),
                        production_type: String(prodType),
                        status: String(status),
                        colors: String(colors),
                        common_dia: commonDia ? parseFloat(commonDia) : null
                    });
                }
            });

            if (products.length === 0) {
                alert("No valid product rows found. Excel file must contain 'Product Name', 'Brand', 'Fabric', and 'Product Description' columns.");
                return;
            }

            showLoader(true, "Uploading Excel product data...");
            const response = await fetch('/api/masters/products/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ products: products })
            });
            const data = await response.json();
            if (response.ok && data.success) {
                planningContribMeta = null;
                alert(`Successfully imported/updated ${products.length} product records!`);
                await fetchProductsMaster();
            } else {
                alert(data.message || "Failed to import products.");
            }
        } catch (err) {
            console.error("Error parsing Excel products:", err);
            alert("Invalid Excel formatting or parse failure.");
        } finally {
            showLoader(false);
            document.getElementById('product-import-file').value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

function exportProductsExcel() {
    if (loadedProducts.length === 0) {
        alert("No product records available for export.");
        return;
    }

    const data = loadedProducts.map(p => {
        const colorsList = p.colors ? p.colors.map(c => c.display_color).join(', ') : '';
        const commonDiaObj = p.dias ? p.dias.find(d => d.size_name === 'Common') : null;
        return {
            'Product Name': p.product_name,
            'Brand': p.brand_name,
            'Fabric': p.fabric_name,
            'Fabric Consumption': p.fabric_consumption !== undefined && p.fabric_consumption !== null ? p.fabric_consumption : 0,
            'Product Description': p.product_description,
            'Product Type': p.product_type,
            'Color Category': p.color_category,
            'Colors': colorsList,
            'DIA Mode': p.dia_mode,
            'Common DIA': commonDiaObj ? commonDiaObj.dia : '',
            'Production Type': p.production_type || 'Common',
            'Status': p.status
        };
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Products Master");
    XLSX.writeFile(workbook, "products_master_records.xlsx");
}

let selectedProductSizes = [];
let availableProductSizesList = [];
let fabricAvailableDias = [];

function toggleProductSizesDropdown(event) {
    event.stopPropagation();
    const list = document.getElementById('product-sizes-dropdown-list');
    list.classList.toggle('hidden');
}

function filterProductSizesDropdown(event) {
    buildProductSizesDropdownOptions(event.target.value);
}

function buildProductSizesDropdownOptions(filterTerm = '') {
    const container = document.getElementById('product-sizes-options-container');
    if (!container) return;
    container.innerHTML = '';

    const filtered = availableProductSizesList.filter(s =>
        s.size.toLowerCase().includes(filterTerm.toLowerCase())
    );

    if (filtered.length === 0) {
        container.innerHTML = '<span style="color: var(--text-muted); font-style: italic; padding: 12px; display: block;">No matching sizes found...</span>';
        return;
    }

    filtered.forEach(s => {
        const label = document.createElement('label');
        label.className = 'multiselect-option';

        const isChecked = selectedProductSizes.includes(String(s.id));

        label.innerHTML = `
            <label class="checkbox-container" style="margin: 0;">
                <input type="checkbox" value="${s.id}" ${isChecked ? 'checked' : ''} onchange="toggleProductSizeSelection(event, '${s.id}')">
                <span class="checkmark"></span>
                <span>${s.size}</span>
            </label>
        `;
        container.appendChild(label);
    });
}

function toggleProductSizeSelection(event, sizeId) {
    const sIdStr = String(sizeId);
    if (event.target.checked) {
        if (!selectedProductSizes.includes(sIdStr)) {
            selectedProductSizes.push(sIdStr);
        }
    } else {
        selectedProductSizes = selectedProductSizes.filter(id => id !== sIdStr);
    }
    updateProductSelectedSizesChips();
    regenerateProductSizeDIATable();
}

function removeProductSizeChip(sizeId) {
    const sIdStr = String(sizeId);
    selectedProductSizes = selectedProductSizes.filter(id => id !== sIdStr);
    updateProductSelectedSizesChips();
    document.querySelectorAll(`#product-sizes-options-container input[value="${sizeId}"]`).forEach(cb => cb.checked = false);
    regenerateProductSizeDIATable();
}

function updateProductSelectedSizesChips() {
    const container = document.getElementById('product-selected-sizes-container');
    if (!container) return;
    container.innerHTML = '';

    if (selectedProductSizes.length === 0) {
        container.innerHTML = '<span class="placeholder">Select Sizes (Choose Fabric First)...</span>';
        return;
    }

    selectedProductSizes.forEach(sizeId => {
        const match = availableProductSizesList.find(s => String(s.id) === String(sizeId));
        const name = match ? match.size : sizeId;

        const chip = document.createElement('span');
        chip.className = 'selected-tag';
        chip.innerHTML = `${name} <span class="remove" onclick="event.stopPropagation(); removeProductSizeChip('${sizeId}')">&times;</span>`;
        container.appendChild(chip);
    });
}

function regenerateProductSizeDIATable(skipLockSync = false) {
    const tbody = document.getElementById('product-sizewise-dia-tbody');
    if (!tbody) return;

    const previousMappings = {};
    tbody.querySelectorAll('select').forEach(sel => {
        const sizeId = sel.getAttribute('data-size-id');
        if (sizeId && sel.value) {
            previousMappings[sizeId] = sel.value;
        }
    });

    tbody.innerHTML = '';

    if (selectedProductSizes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="2" style="text-align: center; color: var(--text-muted); font-style: italic; padding: 12px;">No sizes selected yet.</td></tr>';
        return;
    }

    selectedProductSizes.forEach(sizeId => {
        const match = availableProductSizesList.find(s => String(s.id) === String(sizeId));
        if (!match) return;

        let optionsHtml = `<option value="">Select DIA...</option>`;
        fabricAvailableDias.forEach(d => {
            optionsHtml += `<option value="${d}">${d}</option>`;
        });

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="padding: 8px 12px; font-weight: 500;">${match.size}</td>
            <td style="padding: 4px 12px;">
                <select id="product-sizewise-dia-size-${match.id}" class="modal-select" data-size-id="${match.id}" style="width: 100%; margin: 0; padding: 4px 8px; height: 32px;">
                    ${optionsHtml}
                </select>
            </td>
        `;
        tbody.appendChild(tr);

        const prevValue = previousMappings[match.id];
        if (prevValue && fabricAvailableDias.includes(parseFloat(prevValue))) {
            document.getElementById(`product-sizewise-dia-size-${match.id}`).value = prevValue;
        }
    });

    onProductDIAModeChange();

    if (!skipLockSync) {
        const prodType = document.getElementById('product-production-type-select')?.value;
        const cpId = document.getElementById('product-common-name-select')?.value;
        if (prodType === 'Common' && cpId) {
            onProductCommonProductionChange();
        }
    }
}

document.addEventListener('click', () => {
    document.getElementById('product-colors-dropdown-list')?.classList.add('hidden');
    document.getElementById('product-sizes-dropdown-list')?.classList.add('hidden');
    document.getElementById('product-sales-products-dropdown-list')?.classList.add('hidden');
});

// PLANNING SHEET FRONTEND STATE & INTERACTION LOGIC
let planningSheetData = null;
let selectedProductId = null;
let planningSearchTerm = '';

// Toggle Collapse section
function toggleSectionCollapse(sectionId) {
    const section = document.getElementById(sectionId);
    const arrow = document.getElementById(`arrow-${sectionId}`);
    if (section && arrow) {
        section.classList.toggle('hidden');
        arrow.classList.toggle('collapsed');
    }
}

// Initialise the planning tab
function initializePlanningSheetTab() {
    // Set default month & year to current month & year
    const now = new Date();
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    const mSelect = document.getElementById('planning-sheet-month');
    const ySelect = document.getElementById('planning-sheet-year');

    if (mSelect && !mSelect.value) {
        mSelect.value = months[now.getMonth()];
    }
    if (ySelect && !ySelect.value) {
        ySelect.value = now.getFullYear().toString();
    }

    // Clear search input
    const searchInput = document.getElementById('planning-product-search');
    if (searchInput) searchInput.value = '';
    planningSearchTerm = '';

    // Load contributions
    loadPlanningSheetData();
}

// Fetch planning sheet records and compute suggested contributions
async function loadPlanningSheetData() {
    const month = document.getElementById('planning-sheet-month').value;
    const year = document.getElementById('planning-sheet-year').value;

    const loader = document.getElementById('planning-sheet-loader');
    if (loader) loader.classList.remove('hidden');

    try {
        const response = await fetch(`/api/planning-sheet/data?month=${month}&year=${year}`);
        const data = await response.json();

        if (response.ok && data.success) {
            planningSheetData = data;
            selectedProductId = null;

            // Set UI headers & KPIs
            document.getElementById('planning-sheet-total-sales-qty').textContent = data.total_sales_qty.toLocaleString();
            document.getElementById('planning-sheet-total-planned-qty').textContent = data.total_planned_qty.toLocaleString();

            // Set status & locks
            document.getElementById('planning-sheet-status-badge').textContent = data.status;
            document.getElementById('planning-sheet-status-badge').className = `table-badge badge-outline ${data.status === 'Approved' ? 'running' : 'stopped'}`;

            const lockToggle = document.getElementById('planning-sheet-lock-toggle');
            const lockLabel = document.getElementById('planning-sheet-lock-label');
            if (lockToggle && lockLabel) {
                lockToggle.checked = data.is_locked;
                lockLabel.textContent = data.is_locked ? 'Locked' : 'Unlocked';
            }

            // Render Tables
            renderPlanningProducts();

            // Reset Color and Size sub workspaces
            document.getElementById('color-contrib-placeholder').classList.remove('hidden');
            document.getElementById('color-contrib-workspace').classList.add('hidden');
            document.getElementById('size-contrib-placeholder').classList.remove('hidden');
            document.getElementById('size-contrib-workspace').classList.add('hidden');

            // Check overall status locked to disable inputs
            toggleUIInputState(data.is_locked);
        } else {
            alert(data.message || "Failed to load planning sheet data.");
        }
    } catch (err) {
        console.error("Error loading planning sheet:", err);
        alert("Network error. Failed to load planning sheet.");
    } finally {
        if (loader) loader.classList.add('hidden');
    }
}

// Toggle disable state of form inputs if period is locked
function toggleUIInputState(isLocked) {
    const saveBtn = document.getElementById('btn-save-planning-sheet');
    const approveBtn = document.getElementById('btn-approve-sheet');

    if (saveBtn) saveBtn.disabled = isLocked;
    if (approveBtn) approveBtn.disabled = isLocked;

    document.querySelectorAll('#planning-sheet-panel input').forEach(input => {
        if (input.id !== 'planning-product-search' && input.id !== 'planning-sheet-lock-toggle') {
            input.disabled = isLocked;
        }
    });
}

// Render product table
function renderPlanningProducts() {
    const tbody = document.getElementById('product-contribution-tbody');
    if (!tbody || !planningSheetData) return;
    tbody.innerHTML = '';

    let totalSalesQty = 0;
    let totalPlannedQty = 0;
    let totalSuggested = 0;
    let totalManual = 0;

    let index = 1;

    planningSheetData.products.forEach(p => {
        // Search filter
        if (planningSearchTerm && !p.product_name.toLowerCase().includes(planningSearchTerm.toLowerCase())) {
            return;
        }

        totalSalesQty += p.sales_qty;

        // Calculate Planned Qty for this product
        const prodPlannedQty = Math.round((p.manual_contribution / 100.0) * planningSheetData.total_planned_qty);
        totalPlannedQty += prodPlannedQty;

        totalSuggested += p.suggested_contribution;
        totalManual += p.manual_contribution;

        const isSelected = selectedProductId === p.product_id;
        const tr = document.createElement('tr');
        tr.className = isSelected ? 'row-selected' : '';
        tr.style.cursor = 'pointer';
        tr.onclick = () => selectProductRow(p.product_id);

        const mappedProductsText = p.sales_products && p.sales_products.length > 0
            ? p.sales_products.map(sp => `<span class="table-badge badge-outline" style="margin: 1px; font-size: 11px;">${sp}</span>`).join(' ')
            : `<span style="color: var(--text-muted); font-style: italic; font-size: 12px;">None</span>`;

        const growthText = p.growth_percent !== null
            ? `<span style="color: ${p.growth_percent >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'}; font-weight: 600;">${p.growth_percent >= 0 ? '+' : ''}${p.growth_percent.toFixed(2)}%</span>`
            : `<span style="color: var(--text-muted);">N/A</span>`;

        // Variance color highlighting
        let varianceStyle = '';
        if (p.variance > 0.001) varianceStyle = 'color: var(--accent-green); font-weight:600;';
        else if (p.variance < -0.001) varianceStyle = 'color: var(--accent-red); font-weight:600;';

        tr.innerHTML = `
            <td>${index++}</td>
            <td><strong>${p.product_name}</strong></td>
            <td style="max-width: 200px; overflow-wrap: break-word;">${mappedProductsText}</td>
            <td class="text-right">${p.last_month_contribution.toFixed(2)}%</td>
            <td class="text-right">${p.last_year_contribution.toFixed(2)}%</td>
            <td class="text-right">${p.sales_qty.toLocaleString()}</td>
            <td class="text-right">${growthText}</td>
            <td class="text-right"><strong>${prodPlannedQty.toLocaleString()}</strong></td>
            <td class="text-right" style="background: rgba(255,255,255,0.01); color: var(--text-secondary);">${p.suggested_contribution.toFixed(2)}%</td>
            <td style="border-left: 2px solid var(--border-color); padding: 2px 4px; background: rgba(58,110,165,0.03);">
                <input type="number" class="spreadsheet-input-pct" step="0.01" min="0" max="100" 
                    value="${p.manual_contribution.toFixed(2)}" 
                    onchange="onProductManualChange(${p.product_id}, this.value, this)" 
                    onclick="event.stopPropagation()">
            </td>
            <td class="text-right" style="${varianceStyle}">${p.variance.toFixed(2)}%</td>
            <td style="padding: 2px 4px;">
                <input type="text" class="spreadsheet-input-remarks" 
                    value="${p.remarks || ''}" 
                    placeholder="Enter notes..." 
                    onchange="onProductRemarksChange(${p.product_id}, this.value)" 
                    onclick="event.stopPropagation()">
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Update Totals row in Product Contribution Table
    document.getElementById('total-product-sales-qty').textContent = totalSalesQty.toLocaleString();
    document.getElementById('total-product-planned-qty').textContent = totalPlannedQty.toLocaleString();
    document.getElementById('total-product-suggested').textContent = `${totalSuggested.toFixed(2)}%`;

    const manualTotalCell = document.getElementById('total-product-manual');
    manualTotalCell.textContent = `${totalManual.toFixed(2)}%`;

    // Highlight manual total cell
    const isSumValid = Math.abs(totalManual - 100.0) < 0.01;
    if (isSumValid) {
        manualTotalCell.className = 'text-right cell-valid';
    } else {
        manualTotalCell.className = 'text-right cell-invalid';
    }

    // Calculate variance sum
    const varianceSum = totalManual - totalSuggested;
    const varCell = document.getElementById('total-product-variance');
    varCell.textContent = `${varianceSum.toFixed(2)}%`;
    if (Math.abs(varianceSum) < 0.01) {
        varCell.style.color = '';
    } else {
        varCell.style.color = varianceSum > 0 ? 'var(--accent-green)' : 'var(--accent-red)';
    }

    // Update validation widget & banner
    const valText = document.getElementById('product-validation-status-text');
    const valIcon = document.getElementById('product-validation-status-icon');
    const valSubText = document.getElementById('product-validation-sub-text');
    const valWarning = document.getElementById('planning-sheet-validation-warning');
    const valWarningMsg = document.getElementById('validation-warning-message');

    if (valText && valIcon && valSubText) {
        valText.textContent = `${totalManual.toFixed(2)}%`;
        if (isSumValid) {
            valText.style.color = 'var(--accent-green)';
            valIcon.style.color = 'var(--accent-green)';
            valIcon.style.backgroundColor = 'rgba(34, 197, 94, 0.1)';
            valSubText.textContent = 'Ratios balanced successfully.';
            if (valWarning) valWarning.classList.add('hidden');
        } else {
            valText.style.color = 'var(--accent-red)';
            valIcon.style.color = 'var(--accent-red)';
            valIcon.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
            valSubText.textContent = 'Ratios must sum to 100%';

            if (valWarning && valWarningMsg) {
                valWarning.classList.remove('hidden');
                valWarningMsg.textContent = `Product Manual Contribution Sum is ${totalManual.toFixed(2)}%. It must equal exactly 100%!`;
            }
        }
    }
}

// Click listener to select product row
function selectProductRow(productId) {
    selectedProductId = productId;

    // Re-render product list to update highlight class
    renderPlanningProducts();

    // Load breakdown tables
    renderColorBreakdown();
    renderSizeBreakdown();
}

// Search filter keyup/input
function filterPlanningProducts() {
    planningSearchTerm = document.getElementById('planning-product-search').value.trim();
    renderPlanningProducts();
}

// Product manual percentage change
function onProductManualChange(productId, val, inputEl) {
    const num = parseFloat(val);
    if (isNaN(num) || num < 0 || num > 100) {
        alert("Please enter a valid percentage between 0 and 100.");
        return;
    }

    const prod = planningSheetData.products.find(p => p.product_id === productId);
    if (prod) {
        prod.manual_contribution = num;
        prod.variance = num - prod.suggested_contribution;

        // Add cell-edited highlighting
        if (inputEl) {
            inputEl.parentElement.classList.add('cell-edited');
        }

        // Recompute products table totals, recalculate KPIs
        renderPlanningProducts();
    }
}

// Product remarks change
function onProductRemarksChange(productId, val) {
    const prod = planningSheetData.products.find(p => p.product_id === productId);
    if (prod) {
        prod.remarks = val;
    }
}

// Collapsible color breakdown list
function renderColorBreakdown() {
    const workspace = document.getElementById('color-contrib-workspace');
    const placeholder = document.getElementById('color-contrib-placeholder');
    const headerTitle = document.getElementById('color-section-header-title');
    const tbody = document.getElementById('color-contribution-tbody');

    if (!tbody || !planningSheetData) return;
    tbody.innerHTML = '';

    const prod = planningSheetData.products.find(p => p.product_id === selectedProductId);
    if (!prod) {
        placeholder.classList.remove('hidden');
        workspace.classList.add('hidden');
        headerTitle.textContent = "SECTION 2: Color Contribution";
        return;
    }

    placeholder.classList.add('hidden');
    workspace.classList.remove('hidden');
    headerTitle.innerHTML = `<i class="fa-solid fa-palette"></i> Color Contribution for <strong style="color: var(--accent-blue);">${prod.product_name}</strong>`;

    let totalSalesQty = 0;
    let totalSuggested = 0;
    let totalManual = 0;

    prod.colors.forEach(c => {
        totalSalesQty += c.sales_qty;
        totalSuggested += c.suggested_percent;
        totalManual += c.manual_percent;

        const tr = document.createElement('tr');

        let varianceStyle = '';
        if (c.variance > 0.001) varianceStyle = 'color: var(--accent-green); font-weight:600;';
        else if (c.variance < -0.001) varianceStyle = 'color: var(--accent-red); font-weight:600;';

        tr.innerHTML = `
            <td><strong>${c.color_name}</strong> <span style="font-size: 11px; color: var(--text-muted);">(${c.color_code})</span></td>
            <td class="text-right">${c.sales_qty.toLocaleString()}</td>
            <td class="text-right">${c.suggested_percent.toFixed(2)}%</td>
            <td style="border-left: 2px solid var(--border-color); padding: 2px 4px; background: rgba(58,110,165,0.03);">
                <input type="number" class="spreadsheet-input-pct" step="0.01" min="0" max="100" 
                    value="${c.manual_percent.toFixed(2)}" 
                    onchange="onColorManualChange(${c.color_id}, this.value, this)">
            </td>
            <td class="text-right" style="${varianceStyle}">${c.variance.toFixed(2)}%</td>
        `;
        tbody.appendChild(tr);
    });

    // Totals
    document.getElementById('total-color-sales-qty').textContent = totalSalesQty.toLocaleString();
    document.getElementById('total-color-suggested').textContent = `${totalSuggested.toFixed(2)}%`;

    const manualTotalCell = document.getElementById('total-color-manual');
    manualTotalCell.textContent = `${totalManual.toFixed(2)}%`;

    const isSumValid = Math.abs(totalManual - 100.0) < 0.01;
    if (isSumValid) {
        manualTotalCell.className = 'text-right cell-valid';
        document.getElementById('color-validation-warning').classList.add('hidden');
    } else {
        manualTotalCell.className = 'text-right cell-invalid';
        document.getElementById('color-validation-warning').classList.remove('hidden');
        document.getElementById('color-validation-warning-msg').textContent = `Ratios sum to ${totalManual.toFixed(2)}%, must be exactly 100%!`;
    }

    const varianceSum = totalManual - totalSuggested;
    document.getElementById('total-color-variance').textContent = `${varianceSum.toFixed(2)}%`;
}

// Color manual percent change
function onColorManualChange(colorId, val, inputEl) {
    const num = parseFloat(val);
    if (isNaN(num) || num < 0 || num > 100) {
        alert("Please enter a valid percentage between 0 and 100.");
        return;
    }

    const prod = planningSheetData.products.find(p => p.product_id === selectedProductId);
    if (prod) {
        const col = prod.colors.find(c => c.color_id === colorId);
        if (col) {
            col.manual_percent = num;
            col.variance = num - col.suggested_percent;

            if (inputEl) {
                inputEl.parentElement.classList.add('cell-edited');
            }
            renderColorBreakdown();
        }
    }
}

// Collapsible size breakdown list
function renderSizeBreakdown() {
    const workspace = document.getElementById('size-contrib-workspace');
    const placeholder = document.getElementById('size-contrib-placeholder');
    const headerTitle = document.getElementById('size-section-header-title');
    const tbody = document.getElementById('size-contribution-tbody');

    if (!tbody || !planningSheetData) return;
    tbody.innerHTML = '';

    const prod = planningSheetData.products.find(p => p.product_id === selectedProductId);
    if (!prod) {
        placeholder.classList.remove('hidden');
        workspace.classList.add('hidden');
        headerTitle.textContent = "SECTION 3: Size Contribution";
        return;
    }

    placeholder.classList.add('hidden');
    workspace.classList.remove('hidden');
    headerTitle.innerHTML = `<i class="fa-solid fa-maximize"></i> Size Contribution for <strong style="color: var(--accent-blue);">${prod.product_name}</strong>`;

    let totalSalesQty = 0;
    let totalSuggested = 0;
    let totalManual = 0;

    prod.sizes.forEach(s => {
        totalSalesQty += s.sales_qty;
        totalSuggested += s.suggested_percent;
        totalManual += s.manual_percent;

        const tr = document.createElement('tr');

        let varianceStyle = '';
        if (s.variance > 0.001) varianceStyle = 'color: var(--accent-green); font-weight:600;';
        else if (s.variance < -0.001) varianceStyle = 'color: var(--accent-red); font-weight:600;';

        tr.innerHTML = `
            <td><strong>${s.size_name}</strong> <span style="font-size: 11px; color: var(--text-muted);">(${s.size_code})</span></td>
            <td class="text-right">${s.sales_qty.toLocaleString()}</td>
            <td class="text-right">${s.suggested_percent.toFixed(2)}%</td>
            <td style="border-left: 2px solid var(--border-color); padding: 2px 4px; background: rgba(58,110,165,0.03);">
                <input type="number" class="spreadsheet-input-pct" step="0.01" min="0" max="100" 
                    value="${s.manual_percent.toFixed(2)}" 
                    onchange="onSizeManualChange(${s.size_id}, this.value, this)">
            </td>
            <td class="text-right" style="${varianceStyle}">${s.variance.toFixed(2)}%</td>
        `;
        tbody.appendChild(tr);
    });

    // Totals
    document.getElementById('total-size-sales-qty').textContent = totalSalesQty.toLocaleString();
    document.getElementById('total-size-suggested').textContent = `${totalSuggested.toFixed(2)}%`;

    const manualTotalCell = document.getElementById('total-size-manual');
    manualTotalCell.textContent = `${totalManual.toFixed(2)}%`;

    const isSumValid = Math.abs(totalManual - 100.0) < 0.01;
    if (isSumValid) {
        manualTotalCell.className = 'text-right cell-valid';
        document.getElementById('size-validation-warning').classList.add('hidden');
    } else {
        manualTotalCell.className = 'text-right cell-invalid';
        document.getElementById('size-validation-warning').classList.remove('hidden');
        document.getElementById('size-validation-warning-msg').textContent = `Ratios sum to ${totalManual.toFixed(2)}%, must be exactly 100%!`;
    }

    const varianceSum = totalManual - totalSuggested;
    document.getElementById('total-size-variance').textContent = `${varianceSum.toFixed(2)}%`;
}

// Size manual percent change
function onSizeManualChange(sizeId, val, inputEl) {
    const num = parseFloat(val);
    if (isNaN(num) || num < 0 || num > 100) {
        alert("Please enter a valid percentage between 0 and 100.");
        return;
    }

    const prod = planningSheetData.products.find(p => p.product_id === selectedProductId);
    if (prod) {
        const sz = prod.sizes.find(s => s.size_id === sizeId);
        if (sz) {
            sz.manual_percent = num;
            sz.variance = num - sz.suggested_percent;

            if (inputEl) {
                inputEl.parentElement.classList.add('cell-edited');
            }
            renderSizeBreakdown();
        }
    }
}

// Reset changes to suggested values
function resetPlanningSheetChanges() {
    if (!planningSheetData) return;
    if (!confirm("Are you sure you want to reset all manual changes to suggested values?")) return;

    planningSheetData.products.forEach(p => {
        p.manual_contribution = p.suggested_contribution;
        p.variance = 0.0;

        p.colors.forEach(c => {
            c.manual_percent = c.suggested_percent;
            c.variance = 0.0;
        });

        p.sizes.forEach(s => {
            s.manual_percent = s.suggested_percent;
            s.variance = 0.0;
        });
    });

    // Remove all .cell-edited highlightings
    document.querySelectorAll('#planning-sheet-panel td.cell-edited').forEach(td => {
        td.classList.remove('cell-edited');
    });

    renderPlanningProducts();
    if (selectedProductId) {
        renderColorBreakdown();
        renderSizeBreakdown();
    }
}

// Copy manual contributions from previous month
async function copyPreviousMonthPlanning() {
    if (!planningSheetData) return;
    const month = document.getElementById('planning-sheet-month').value;
    const year = document.getElementById('planning-sheet-year').value;

    const loader = document.getElementById('planning-sheet-loader');
    if (loader) loader.classList.remove('hidden');

    try {
        const response = await fetch(`/api/planning-sheet/copy-previous?planning_period=${month} ${year}`);
        const res = await response.json();

        if (response.ok && res.success) {
            const copied = res.data;
            let matchCount = 0;

            planningSheetData.products.forEach(p => {
                const prev = copied[p.product_id];
                if (prev) {
                    p.manual_contribution = prev.manual_contribution;
                    p.variance = p.manual_contribution - p.suggested_contribution;
                    matchCount++;

                    // Mark as edited
                    document.querySelectorAll(`#product-contribution-tbody tr`).forEach(row => {
                        const firstCell = row.cells[1];
                        if (firstCell && firstCell.textContent.includes(p.product_name)) {
                            row.cells[9].classList.add('cell-edited');
                        }
                    });

                    // Copy colors
                    p.colors.forEach(c => {
                        if (prev.colors[c.color_id] !== undefined) {
                            c.manual_percent = prev.colors[c.color_id];
                            c.variance = c.manual_percent - c.suggested_percent;
                        }
                    });

                    // Copy sizes
                    p.sizes.forEach(s => {
                        if (prev.sizes[s.size_id] !== undefined) {
                            s.manual_percent = prev.sizes[s.size_id];
                            s.variance = s.manual_percent - s.suggested_percent;
                        }
                    });
                }
            });

            renderPlanningProducts();
            if (selectedProductId) {
                renderColorBreakdown();
                renderSizeBreakdown();
            }

            alert(`Planning ratios copied successfully from previous month (${res.copied_period}) for ${matchCount} products. Verify and save changes.`);
        } else {
            alert(res.message || "Failed to copy planning ratios from previous month.");
        }
    } catch (err) {
        console.error("Error copying previous month:", err);
        alert("Network error. Failed to copy ratios.");
    } finally {
        if (loader) loader.classList.add('hidden');
    }
}

// Approve the planning sheet
async function approvePlanningSheet() {
    if (!planningSheetData) return;
    const period = planningSheetData.planning_period;

    if (!confirm("Are you sure you want to Approve this Planning Sheet? Once approved, it will freeze this configuration.")) return;

    const loader = document.getElementById('planning-sheet-loader');
    if (loader) loader.classList.remove('hidden');

    try {
        const response = await fetch('/api/planning-sheet/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                planning_period: period,
                status: 'Approved'
            })
        });
        const res = await response.json();
        if (response.ok && res.success) {
            alert("Planning Sheet approved successfully!");
            await loadPlanningSheetData();
        } else {
            alert(res.message || "Failed to approve planning sheet.");
        }
    } catch (err) {
        console.error("Error approving sheet:", err);
        alert("Network error.");
    } finally {
        if (loader) loader.classList.add('hidden');
    }
}

// Lock/unlock planning period
async function togglePlanningSheetLock(isLocked) {
    if (!planningSheetData) return;
    const period = planningSheetData.planning_period;

    const action = isLocked ? 'Lock' : 'Unlock';
    if (!confirm(`Are you sure you want to ${action} this planning period?`)) {
        document.getElementById('planning-sheet-lock-toggle').checked = !isLocked;
        return;
    }

    const loader = document.getElementById('planning-sheet-loader');
    if (loader) loader.classList.remove('hidden');

    try {
        const response = await fetch('/api/planning-sheet/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                planning_period: period,
                is_locked: isLocked
            })
        });
        const res = await response.json();
        if (response.ok && res.success) {
            alert(`Planning period ${isLocked ? 'locked' : 'unlocked'} successfully.`);
            await loadPlanningSheetData();
        } else {
            alert(res.message || "Failed to toggle lock state.");
            document.getElementById('planning-sheet-lock-toggle').checked = !isLocked;
        }
    } catch (err) {
        console.error("Error locking sheet:", err);
        alert("Network error.");
        document.getElementById('planning-sheet-lock-toggle').checked = !isLocked;
    } finally {
        if (loader) loader.classList.add('hidden');
    }
}

// Validate all constraints before saving
function validateAllPlanningConstraints() {
    if (!planningSheetData) return { valid: false, reason: "No data loaded." };

    // 1. Verify Product manual contribution sums to 100%
    let prodManualSum = 0;
    planningSheetData.products.forEach(p => {
        prodManualSum += p.manual_contribution;
    });
    if (Math.abs(prodManualSum - 100.0) >= 0.01) {
        return {
            valid: false,
            reason: `Product Contribution Manual sum is ${prodManualSum.toFixed(2)}%. It must equal exactly 100%!`
        };
    }

    // 2. Verify Color manual contribution sums to 100% for each product
    for (let p of planningSheetData.products) {
        if (p.colors && p.colors.length > 0) {
            let colSum = 0;
            p.colors.forEach(c => colSum += c.manual_percent);
            if (Math.abs(colSum - 100.0) >= 0.01) {
                return {
                    valid: false,
                    reason: `Color Contribution sum for product "${p.product_name}" is ${colSum.toFixed(2)}%. It must equal exactly 100%!`
                };
            }
        }
    }

    // 3. Verify Size manual contribution sums to 100% for each product
    for (let p of planningSheetData.products) {
        if (p.sizes && p.sizes.length > 0) {
            let szSum = 0;
            p.sizes.forEach(s => szSum += s.manual_percent);
            if (Math.abs(szSum - 100.0) >= 0.01) {
                return {
                    valid: false,
                    reason: `Size Contribution sum for product "${p.product_name}" is ${szSum.toFixed(2)}%. It must equal exactly 100%!`
                };
            }
        }
    }

    return { valid: true };
}

// Save Planning Sheet
async function savePlanningSheetData() {
    if (!planningSheetData) return;

    // Check validation constraints
    const validation = validateAllPlanningConstraints();
    if (!validation.valid) {
        alert(`Warning: ${validation.reason}\n\nSaving planning sheet ratios with partial contribution values.`);
    }

    const period = planningSheetData.planning_period;
    const loader = document.getElementById('planning-sheet-loader');
    if (loader) loader.classList.remove('hidden');

    const payload = {
        planning_period: period,
        products: planningSheetData.products
    };

    try {
        const response = await fetch('/api/planning-sheet/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const res = await response.json();

        if (response.ok && res.success) {
            let targetStatus = planningSheetData.status;
            if (planningSheetData.status === 'Approved') {
                targetStatus = 'Revised'; // Save on approved becomes revised
            }

            // Auto update status if revised
            if (targetStatus !== planningSheetData.status) {
                await fetch('/api/planning-sheet/status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ planning_period: period, status: targetStatus })
                });
            }

            alert("Planning sheet ratios saved successfully!");
            // Re-fetch to clear highlight states
            await loadPlanningSheetData();
        } else {
            alert(res.message || "Failed to save planning sheet.");
        }
    } catch (err) {
        console.error("Error saving planning sheet:", err);
        alert("Network error. Failed to save ratios.");
    } finally {
        if (loader) loader.classList.add('hidden');
    }
}

// Excel CSV Export
function exportPlanningSheetToExcel() {
    if (!planningSheetData) return;

    const headers = [
        "Product Master",
        "Mapped Sales Products",
        "Last Month %",
        "LY Same Month %",
        "Current Sales Qty",
        "Growth %",
        "Planned Qty",
        "Product Suggested %",
        "Product Manual %",
        "Product Variance %",
        "Remarks",
        "Color Name",
        "Color Suggested %",
        "Color Manual %",
        "Color Variance %",
        "Size Name",
        "Size Suggested %",
        "Size Manual %",
        "Size Variance %"
    ];

    let csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n";

    planningSheetData.products.forEach(p => {
        const maxLines = Math.max(p.colors.length, p.sizes.length, 1);

        for (let i = 0; i < maxLines; i++) {
            const col = p.colors[i];
            const sz = p.sizes[i];

            const prodPlannedQty = Math.round((p.manual_contribution / 100.0) * planningSheetData.total_planned_qty);

            const line = [
                i === 0 ? `"${p.product_name}"` : '""',
                i === 0 ? `"${p.sales_products.join('; ')}"` : '""',
                i === 0 ? `"${p.last_month_contribution.toFixed(2)}%"` : '""',
                i === 0 ? `"${p.last_year_contribution.toFixed(2)}%"` : '""',
                i === 0 ? `"${p.sales_qty}"` : '""',
                i === 0 ? `"${p.growth_percent !== null ? p.growth_percent.toFixed(2) + '%' : 'N/A'}"` : '""',
                i === 0 ? `"${prodPlannedQty}"` : '""',
                i === 0 ? `"${p.suggested_contribution.toFixed(2)}%"` : '""',
                i === 0 ? `"${p.manual_contribution.toFixed(2)}%"` : '""',
                i === 0 ? `"${p.variance.toFixed(2)}%"` : '""',
                i === 0 ? `"${(p.remarks || '').replace(/"/g, '""')}"` : '""',

                col ? `"${col.color_name} (${col.color_code})"` : '""',
                col ? `"${col.suggested_percent.toFixed(2)}%"` : '""',
                col ? `"${col.manual_percent.toFixed(2)}%"` : '""',
                col ? `"${col.variance.toFixed(2)}%"` : '""',

                sz ? `"${sz.size_name}"` : '""',
                sz ? `"${sz.suggested_percent.toFixed(2)}%"` : '""',
                sz ? `"${sz.manual_percent.toFixed(2)}%"` : '""',
                sz ? `"${sz.variance.toFixed(2)}%"` : '""'
            ];
            csvContent += line.join(",") + "\n";
        }
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().slice(0, 10);

    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Production_Planning_Sheet_${planningSheetData.planning_period.replace(/ /g, '_')}_${timestamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// --- REDESIGNED PLANNING CONTRIBUTION FIXING ENGINE (CONTRIBUTION MASTER) ---
let planningContribMeta = null;
let planningContribData = null;
let planningContribSearchTerm = '';
let planningContribUndoStack = [];
let selectedPlanningContribRows = new Set();
let originalPlanningContribRows = {};

let selectedMasterProducts = new Set();
let selectedSalesProducts = new Set();
let selectedMasterColors = new Set();

// Pagination State
let planningContribCurrentPage = 1;
let planningContribPerPage = 10;
let planningContribTotalCount = 0;

// Drilldown Navigation State
let planningContribDrilldownProduct = null;
let planningContribDrilldownColor = null;

const MONTHS_LIST = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const YEARS_LIST = ['2024', '2025', '2026', '2027', '2028', '2029', '2030'];

// Load list of versions on startup
async function loadPlanningContribVersions() {
    try {
        const response = await fetch('/api/planning-contribution/versions');
        const data = await response.json();
        if (response.ok && data.success) {
            const selectEl = document.getElementById('planning-contrib-version-select');
            if (selectEl) {
                selectEl.innerHTML = '';
                data.versions.forEach(ver => {
                    selectEl.innerHTML += `<option value="${ver}">${ver}</option>`;
                });
            }
        }
    } catch (err) {
        console.error("Error loading versions list:", err);
    }
}

// Version Selection change triggers reloading data
function onPlanningContribVersionSelectChange() {
    const val = document.getElementById('planning-contrib-version-select').value;
    document.getElementById('planning-contrib-version-new').value = '';
    loadPlanningContributionData();
}

// Copy version helpers
function openCopyVersionModal() {
    const selectEl = document.getElementById('planning-contrib-version-select');
    const sourceSelect = document.getElementById('copy-version-source');

    // Copy options from main select to copy select
    if (selectEl && sourceSelect) {
        sourceSelect.innerHTML = selectEl.innerHTML;
    }

    document.getElementById('copy-version-target').value = '';
    document.getElementById('copy-version-modal').classList.remove('hidden');
}

function closeCopyVersionModal() {
    document.getElementById('copy-version-modal').classList.add('hidden');
}

async function submitCopyVersion() {
    const sourceVer = document.getElementById('copy-version-source').value;
    const targetVer = document.getElementById('copy-version-target').value.trim();
    const cType = document.getElementById('planning-contrib-type').value;

    if (!targetVer) {
        alert("Please enter a valid target version name.");
        return;
    }

    const loader = document.getElementById('planning-contrib-loader');
    if (loader) loader.classList.remove('hidden');

    try {
        const response = await fetch('/api/planning-contribution/copy-version', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contribution_type: cType,
                source_version: sourceVer,
                target_version: targetVer
            })
        });
        const res = await response.json();

        if (response.ok && res.success) {
            alert(res.message);
            closeCopyVersionModal();
            await loadPlanningContribVersions();
            // Select the newly copied target version
            document.getElementById('planning-contrib-version-select').value = targetVer;
            loadPlanningContributionData();
        } else {
            alert(res.message || "Failed to copy version.");
        }
    } catch (err) {
        console.error("Error copying version:", err);
        alert("Network error.");
    } finally {
        if (loader) loader.classList.add('hidden');
    }
}

// Undo stack push helper
function pushContribUndoState() {
    if (!planningContribData || !planningContribData.rows) return;
    const state = JSON.parse(JSON.stringify(planningContribData.rows));
    planningContribUndoStack.push(state);
    if (planningContribUndoStack.length > 20) {
        planningContribUndoStack.shift();
    }
}

// Undo action
function undoContributionChanges() {
    if (planningContribUndoStack.length === 0) {
        alert("No actions to undo.");
        return;
    }
    const prevState = planningContribUndoStack.pop();
    planningContribData.rows = prevState;
    renderPlanningContribTableBodyOnly();
}

// Reset values to dynamic suggested values
function resetSuggestedValues() {
    if (!planningContribData || !planningContribData.rows) return;
    pushContribUndoState();
    planningContribData.rows.forEach(r => {
        r.manual_pct = r.suggested_pct;
        r.is_manually_edited = false;
        r.variance = 0.0;
    });
    renderPlanningContribTableBodyOnly();
}

// Apply bulk manual fix percentage to all visible rows
function applyBulkPlanningContribAll() {
    if (!planningContribData || !planningContribData.rows) return;
    const bulkPctInput = document.getElementById('planning-contrib-bulk-pct');
    const bulkVal = parseFloat(bulkPctInput.value);
    if (isNaN(bulkVal) || bulkVal < 0 || bulkVal > 100) {
        alert("Please enter a valid manual percentage between 0 and 100.");
        return;
    }
    pushContribUndoState();
    planningContribData.rows.forEach(r => {
        r.manual_pct = bulkVal;
        r.is_manually_edited = true;
        r.variance = bulkVal - r.suggested_pct;
    });
    renderPlanningContribTableBodyOnly();
}

// Apply bulk manual fix percentage to selected checked rows only
function applyBulkPlanningContribPercentage() {
    if (!planningContribData || !planningContribData.rows) return;
    const bulkPctInput = document.getElementById('planning-contrib-bulk-pct');
    const bulkVal = parseFloat(bulkPctInput.value);
    if (isNaN(bulkVal) || bulkVal < 0 || bulkVal > 100) {
        alert("Please enter a valid manual percentage between 0 and 100.");
        return;
    }
    if (selectedPlanningContribRows.size === 0) {
        alert("Please select (checkbox) at least one row to apply the common contribution percentage.");
        return;
    }
    pushContribUndoState();
    planningContribData.rows.forEach((r, idx) => {
        const id = getPlanningContribRowId(r, idx);
        if (selectedPlanningContribRows.has(id)) {
            r.manual_pct = bulkVal;
            r.is_manually_edited = true;
            r.variance = bulkVal - r.suggested_pct;
        }
    });
    renderPlanningContribTableBodyOnly();
}

function getPlanningContribRowId(row, idx) {
    const cType = document.getElementById('planning-contrib-type').value;
    if (cType === 'Product') return `product_${row.product_id}`;
    if (cType === 'Color') return `color_${row.product_id}_${row.color_code}`;
    if (cType === 'Size') return `size_${row.product_id}_${row.color_code || 'null'}_${row.size_id}`;
    return `row_${idx}`;
}

function isRowModified(row, idx) {
    const id = getPlanningContribRowId(row, idx);
    const orig = originalPlanningContribRows[id];
    if (!orig) return false;
    return (
        Math.abs((row.manual_pct || 0) - (orig.manual_pct || 0)) > 0.0001
    );
}

function toggleRowSelection(rowId, checked) {
    if (checked) {
        selectedPlanningContribRows.add(rowId);
    } else {
        selectedPlanningContribRows.delete(rowId);
    }
}

function toggleSelectAllPlanningContrib(headerCb) {
    const rowCheckboxes = document.querySelectorAll('.planning-row-cb');
    rowCheckboxes.forEach(cb => {
        cb.checked = headerCb.checked;
        const id = cb.getAttribute('data-id');
        toggleRowSelection(id, headerCb.checked);
    });
}

// Type change handles dynamic filters layouts
function onPlanningContribTypeChange() {
    const cType = document.getElementById('planning-contrib-type').value;
    const thItem = document.getElementById('planning-contrib-th-item');
    const matrixTitle = document.getElementById('planning-contrib-matrix-title');
    const methodWrapper = document.getElementById('planning-contrib-size-method-wrapper');
    const colorsWrapper = document.getElementById('planning-contrib-colors-multiselect-wrapper');
    const banner = document.getElementById('planning-contrib-method-banner');

    if (cType === 'Product') {
        thItem.textContent = "Product Master";
        matrixTitle.textContent = "Product Contribution Matrix";
        if (methodWrapper) methodWrapper.classList.add('hidden');
        if (colorsWrapper) colorsWrapper.classList.add('hidden');
        if (banner) banner.classList.add('hidden');
    } else if (cType === 'Color') {
        thItem.textContent = "Product - Color Combination";
        matrixTitle.textContent = "Color Contribution Matrix";
        if (methodWrapper) methodWrapper.classList.add('hidden');
        if (colorsWrapper) colorsWrapper.classList.add('hidden');
        if (banner) banner.classList.add('hidden');
    } else if (cType === 'Size') {
        thItem.textContent = "Product - Size Combination";
        if (methodWrapper) methodWrapper.classList.remove('hidden');
        if (banner) banner.classList.remove('hidden');

        // Sync layout based on current selector value
        const methodSelect = document.getElementById('planning-contrib-size-method');
        const method = methodSelect ? methodSelect.value : '1';
        const bannerText = document.getElementById('planning-contrib-method-banner-text');

        if (method === '2') {
            if (bannerText) bannerText.textContent = "One common size curve will be applied to selected colors.";
            if (matrixTitle) matrixTitle.textContent = "Overall Product Size Curve";
            if (colorsWrapper) colorsWrapper.classList.remove('hidden');
            loadSizeMethodColors();
        } else {
            if (bannerText) bannerText.textContent = "Each color can have its own size curve.";
            if (matrixTitle) {
                if (planningContribDrilldownColor) {
                    matrixTitle.textContent = "Color-wise Size Contribution Matrix";
                } else {
                    matrixTitle.textContent = "Overall Product Size Contribution Matrix";
                }
            }
            if (colorsWrapper) colorsWrapper.classList.add('hidden');
        }
    }

    const applyBtn = document.getElementById('btn-planning-contrib-common-apply');
    if (applyBtn) {
        if (cType === 'Product') {
            applyBtn.innerHTML = '<i class="fa-solid fa-check-double"></i> Apply to All';
        } else if (cType === 'Color') {
            applyBtn.innerHTML = '<i class="fa-solid fa-check-double"></i> Apply to All Colors';
        } else if (cType === 'Size') {
            applyBtn.innerHTML = '<i class="fa-solid fa-check-double"></i> Apply to All Sizes';
        }
    }

    selectedMasterProducts.clear();
    selectedMasterColors.clear();

    refreshSelectedTags();
    updateSalesProductAndColorOptions();

    const tbody = document.getElementById('planning-contrib-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; color: var(--text-muted); padding: 24px;">Please click Load Data to fetch results.</td></tr>';
}

// --- SIZE CONTRIBUTION FIXED METHODS LOGIC ---
let selectedSizeMethodColors = new Set();

function onPlanningContribSizeMethodChange() {
    const method = document.getElementById('planning-contrib-size-method').value;
    const bannerText = document.getElementById('planning-contrib-method-banner-text');
    const matrixTitle = document.getElementById('planning-contrib-matrix-title');
    const colorsWrapper = document.getElementById('planning-contrib-colors-multiselect-wrapper');

    if (method === '2') {
        if (bannerText) bannerText.textContent = "One common size curve will be applied to selected colors.";
        if (matrixTitle) matrixTitle.textContent = "Overall Product Size Curve";
        if (colorsWrapper) colorsWrapper.classList.remove('hidden');
        loadSizeMethodColors();
    } else {
        if (bannerText) bannerText.textContent = "Each color can have its own size curve.";
        if (matrixTitle) {
            if (planningContribDrilldownColor) {
                matrixTitle.textContent = "Color-wise Size Contribution Matrix";
            } else {
                matrixTitle.textContent = "Overall Product Size Contribution Matrix";
            }
        }
        if (colorsWrapper) colorsWrapper.classList.add('hidden');
    }

    loadPlanningContributionData();
}

async function loadSizeMethodColors() {
    if (!planningContribDrilldownProduct) return;
    try {
        const resp = await fetch(`/api/planning-contribution/product-colors?product_id=${planningContribDrilldownProduct.id}`);
        const data = await resp.json();
        if (resp.ok && data.success) {
            populateSizeMethodColorsDropdown(data.colors);
        }
    } catch (err) {
        console.error("Error loading size method colors:", err);
    }
}

function togglePlanningContribColorsDropdown(e) {
    if (e) e.stopPropagation();
    const dropdown = document.getElementById('planning-contrib-colors-dropdown-list');
    if (dropdown) {
        dropdown.classList.toggle('hidden');
    }
}

// Close custom colors dropdown when clicking outside
document.addEventListener('click', function (e) {
    const dropdown = document.getElementById('planning-contrib-colors-dropdown-list');
    const trigger = document.querySelector('#planning-contrib-colors-multiselect .multiselect-trigger');
    if (dropdown && !dropdown.classList.contains('hidden') && trigger && !trigger.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.add('hidden');
    }
});

function populateSizeMethodColorsDropdown(colors) {
    const container = document.getElementById('planning-contrib-colors-options-container');
    if (!container) return;

    container.innerHTML = '';
    selectedSizeMethodColors.clear();

    if (!colors || colors.length === 0) {
        container.innerHTML = '<div style="padding: 8px 12px; color: var(--text-muted); font-size:12px;">No active colors mapped.</div>';
        updateSizeMethodColorsTags();
        return;
    }

    colors.forEach(c => {
        const optionDiv = document.createElement('div');
        optionDiv.style.display = 'flex';
        optionDiv.style.alignItems = 'center';
        optionDiv.style.gap = '8px';
        optionDiv.style.padding = '6px 12px';
        optionDiv.style.cursor = 'pointer';
        optionDiv.className = 'multiselect-option-row';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = c.color_code;
        cb.style.cursor = 'pointer';
        cb.id = `size-method-color-cb-${c.color_code}`;

        // Handle checkbox click
        cb.addEventListener('change', function (e) {
            if (cb.checked) {
                selectedSizeMethodColors.add(c.color_code);
            } else {
                selectedSizeMethodColors.delete(c.color_code);
            }
            updateSizeMethodColorsTags();
        });

        // Row click triggers checkbox toggle
        optionDiv.addEventListener('click', function (e) {
            if (e.target !== cb) {
                cb.checked = !cb.checked;
                cb.dispatchEvent(new Event('change'));
            }
        });

        const label = document.createElement('label');
        label.textContent = c.color_name;
        label.style.cursor = 'pointer';
        label.style.fontSize = '13px';
        label.style.margin = '0';
        label.style.color = 'var(--text-primary)';

        optionDiv.appendChild(cb);
        optionDiv.appendChild(label);
        container.appendChild(optionDiv);
    });

    updateSizeMethodColorsTags();
}

function updateSizeMethodColorsTags() {
    const container = document.getElementById('planning-contrib-selected-colors-container');
    if (!container) return;

    if (selectedSizeMethodColors.size === 0) {
        container.innerHTML = '<span class="placeholder">Select Colors...</span>';
        return;
    }

    container.innerHTML = '';
    selectedSizeMethodColors.forEach(code => {
        // Find color name
        let name = code;
        const cb = document.getElementById(`size-method-color-cb-${code}`);
        if (cb && cb.nextSibling) {
            name = cb.nextSibling.textContent;
        }

        const tag = document.createElement('span');
        tag.className = 'selected-tag';
        tag.style.background = 'var(--accent-blue)';
        tag.style.color = '#fff';
        tag.style.padding = '2px 6px';
        tag.style.borderRadius = '3px';
        tag.style.fontSize = '11px';
        tag.style.margin = '2px';
        tag.style.display = 'inline-flex';
        tag.style.alignItems = 'center';
        tag.style.gap = '4px';
        tag.textContent = name;

        const removeBtn = document.createElement('span');
        removeBtn.style.cursor = 'pointer';
        removeBtn.style.fontWeight = 'bold';
        removeBtn.textContent = '×';
        removeBtn.onclick = function (e) {
            e.stopPropagation();
            if (cb) {
                cb.checked = false;
                cb.dispatchEvent(new Event('change'));
            }
        };
        tag.appendChild(removeBtn);
        container.appendChild(tag);
    });
}

function selectAllColorsForSizeMethod(e) {
    if (e) e.stopPropagation();
    const checkboxes = document.querySelectorAll('#planning-contrib-colors-options-container input[type="checkbox"]');
    checkboxes.forEach(cb => {
        if (!cb.checked) {
            cb.checked = true;
            cb.dispatchEvent(new Event('change'));
        }
    });
}

function clearAllColorsForSizeMethod(e) {
    if (e) e.stopPropagation();
    const checkboxes = document.querySelectorAll('#planning-contrib-colors-options-container input[type="checkbox"]');
    checkboxes.forEach(cb => {
        if (cb.checked) {
            cb.checked = false;
            cb.dispatchEvent(new Event('change'));
        }
    });
}

function onPlanningContribBrandChange() {
    selectedMasterProducts.clear();
    selectedMasterColors.clear();
    refreshSelectedTags();
    updateSalesProductAndColorOptions();
}

function onPlanningContribRuleChange() {
    loadPlanningContributionData();
}

// --- DRILL DOWN NAVIGATION FLOW HELPERS ---
function resetPlanningContribDrilldown() {
    planningContribDrilldownProduct = null;
    planningContribDrilldownColor = null;

    const typeSelect = document.getElementById('planning-contrib-type');
    if (typeSelect) {
        typeSelect.value = 'Product';
        typeSelect.disabled = false;
    }
    onPlanningContribTypeChange();
    loadPlanningContributionData();
}

function drilldownToColorOnly() {
    planningContribDrilldownColor = null;
    const typeSelect = document.getElementById('planning-contrib-type');
    if (typeSelect) {
        typeSelect.value = 'Color';
        typeSelect.disabled = true;
    }
    onPlanningContribTypeChange();
    loadPlanningContributionData();
}

function navigatePlanningContribBack() {
    const cType = document.getElementById('planning-contrib-type').value;
    if (cType === 'Color') {
        resetPlanningContribDrilldown();
    } else if (cType === 'Size') {
        if (planningContribDrilldownColor) {
            drilldownToColorOnly();
        } else {
            resetPlanningContribDrilldown();
        }
    }
}

function drilldownToColor(productId, productName, brandId) {
    planningContribDrilldownProduct = { id: productId, name: productName, brand_id: brandId };
    planningContribDrilldownColor = null;

    const typeSelect = document.getElementById('planning-contrib-type');
    if (typeSelect) {
        typeSelect.value = 'Color';
        typeSelect.disabled = true;
    }

    onPlanningContribTypeChange();
    loadPlanningContributionData();
}

function drilldownToSizeFromProduct(productId, productName, brandId) {
    planningContribDrilldownProduct = { id: productId, name: productName, brand_id: brandId };
    planningContribDrilldownColor = null;

    const typeSelect = document.getElementById('planning-contrib-type');
    if (typeSelect) {
        typeSelect.value = 'Size';
        typeSelect.disabled = true;
    }

    onPlanningContribTypeChange();
    loadPlanningContributionData();
}

function drilldownToSizeFromColor(productId, productName, brandId, colorCode, colorName) {
    planningContribDrilldownProduct = { id: productId, name: productName, brand_id: brandId };
    planningContribDrilldownColor = { code: colorCode, name: colorName };

    const typeSelect = document.getElementById('planning-contrib-type');
    if (typeSelect) {
        typeSelect.value = 'Size';
        typeSelect.disabled = true;
    }

    onPlanningContribTypeChange();
    loadPlanningContributionData();
}

// Main initial function
async function initializePlanningContributionTab() {
    document.getElementById('planning-contrib-type').value = 'Product';
    document.getElementById('planning-contrib-filter-brand').value = '';
    const searchInput = document.getElementById('planning-contrib-search');
    if (searchInput) searchInput.value = '';
    planningContribSearchTerm = '';
    selectedPlanningContribRows.clear();
    planningContribUndoStack = [];

    // Populate Common Period Dropdowns
    const fromMonthSel = document.getElementById('planning-contrib-common-from-month');
    const fromYearSel = document.getElementById('planning-contrib-common-from-year');
    const toMonthSel = document.getElementById('planning-contrib-common-to-month');
    const toYearSel = document.getElementById('planning-contrib-common-to-year');

    if (fromMonthSel) {
        fromMonthSel.innerHTML = MONTHS_LIST.map(m => `<option value="${m}" ${m === 'April' ? 'selected' : ''}>${m}</option>`).join('');
    }
    if (fromYearSel) {
        fromYearSel.innerHTML = YEARS_LIST.map(y => `<option value="${y}" ${y === '2026' ? 'selected' : ''}>${y}</option>`).join('');
    }
    if (toMonthSel) {
        toMonthSel.innerHTML = MONTHS_LIST.map(m => `<option value="${m}" ${m === 'December' ? 'selected' : ''}>${m}</option>`).join('');
    }
    if (toYearSel) {
        toYearSel.innerHTML = YEARS_LIST.map(y => `<option value="${y}" ${y === '2026' ? 'selected' : ''}>${y}</option>`).join('');
    }

    onPlanningContribTypeChange();
    await loadPlanningContribVersions();

    const loader = document.getElementById('planning-contrib-loader');
    if (loader) loader.classList.remove('hidden');

    try {
        const brandResp = await fetch('/api/masters/brands?status=Active');
        const brandData = await brandResp.json();
        const brandFilter = document.getElementById('planning-contrib-filter-brand');
        if (brandFilter) {
            brandFilter.innerHTML = '<option value="">All Brands</option>';
            if (brandData.success && brandData.brands) {
                brandData.brands.forEach(b => {
                    brandFilter.innerHTML += `<option value="${b.id}">${b.brand_name}</option>`;
                });
            }
        }

        const metaResp = await fetch('/api/planning-contribution/meta');
        const metaData = await metaResp.json();
        if (metaResp.ok && metaData.success) {
            planningContribMeta = metaData;
            updateSalesProductAndColorOptions();
            loadPlanningContributionData();
        } else {
            alert("Failed to load metadata filters.");
        }
    } catch (err) {
        console.error("Error initializing Contribution Master:", err);
    } finally {
        if (loader) loader.classList.add('hidden');
    }
}

// Update filter options dynamic lists
function updateSalesProductAndColorOptions() {
    if (!planningContribMeta) return;

    const brandId = document.getElementById('planning-contrib-filter-brand').value;
    let prodList = planningContribMeta.products;
    if (brandId) {
        prodList = prodList.filter(p => p.brand_id === parseInt(brandId));
    }

    // Product masters multiselect
    const prodContainer = document.getElementById('planning-contrib-products-options-container');
    if (prodContainer) {
        prodContainer.innerHTML = '';
        prodList.forEach(p => {
            const isChecked = selectedMasterProducts.has(p.id.toString());
            prodContainer.innerHTML += `
                <label class="dropdown-option" onclick="event.stopPropagation()">
                    <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="onContribCheckboxChange('product', '${p.id}', this.checked)">
                    <span>${p.product_name}</span>
                </label>
            `;
        });
    }

    // Sales data products
    let salesProdList = [];
    if (selectedMasterProducts.size > 0) {
        const selectedProdIds = Array.from(selectedMasterProducts).map(id => parseInt(id));
        const activeMappings = planningContribMeta.sales_mappings.filter(m => selectedProdIds.includes(m.product_id));
        salesProdList = Array.from(new Set(activeMappings.map(m => m.sales_product_name))).sort();
    } else {
        const brandProdIds = prodList.map(p => p.id);
        const activeMappings = planningContribMeta.sales_mappings.filter(m => brandProdIds.includes(m.product_id));
        salesProdList = Array.from(new Set(activeMappings.map(m => m.sales_product_name))).sort();
    }

    const salesContainer = document.getElementById('planning-contrib-sales-prods-options-container');
    if (salesContainer) {
        salesContainer.innerHTML = '';
        salesProdList.forEach(sp => {
            const isChecked = selectedSalesProducts.has(sp);
            salesContainer.innerHTML += `
                <label class="dropdown-option" onclick="event.stopPropagation()">
                    <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="onContribCheckboxChange('sales_prod', '${sp}', this.checked)">
                    <span>${sp}</span>
                </label>
            `;
        });
    }

    // Color selector for Size Mode
    const colorContainer = document.getElementById('planning-contrib-colors-options-container');
    if (colorContainer) {
        colorContainer.innerHTML = '';
        if (planningContribMeta.colors) {
            planningContribMeta.colors.forEach(c => {
                const isChecked = selectedMasterColors.has(c.global_color_code);
                const dispText = formatColorDisplay(c.global_color_code, c.display_color);
                colorContainer.innerHTML += `
                    <label class="dropdown-option" onclick="event.stopPropagation()">
                        <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="onContribCheckboxChange('color', '${c.global_color_code}', this.checked)">
                        <span>${escapeHTML(dispText)}</span>
                    </label>
                `;
            });
        }
    }

    refreshSelectedTags();
}

function refreshSelectedTags() {
    const prodTags = Array.from(selectedMasterProducts).map(id => {
        const p = planningContribMeta.products.find(x => x.id.toString() === id);
        return { value: id, label: p ? p.product_name : id };
    });
    renderSelectedTags('planning-contrib-selected-products-container', prodTags, 'Select Products...');

    const salesTags = Array.from(selectedSalesProducts).map(sp => ({ value: sp, label: sp }));
    renderSelectedTags('planning-contrib-selected-sales-prods-container', salesTags, 'Select Sales Products...');

    const colorTags = Array.from(selectedMasterColors).map(cc => {
        const c = planningContribMeta.colors.find(x => x.global_color_code === cc);
        return { value: cc, label: c ? formatColorDisplay(c.global_color_code, c.display_color) : cc };
    });
    renderSelectedTags('planning-contrib-selected-colors-container', colorTags, 'Select Colors...');
}

function removeContribTag(containerId, value) {
    if (containerId === 'planning-contrib-selected-products-container') {
        selectedMasterProducts.delete(value);
        updateSalesProductAndColorOptions();
    } else if (containerId === 'planning-contrib-selected-sales-prods-container') {
        selectedSalesProducts.delete(value);
        updateSalesProductAndColorOptions();
    } else if (containerId === 'planning-contrib-selected-colors-container') {
        selectedMasterColors.delete(value);
        updateSalesProductAndColorOptions();
    }
}

function renderSelectedTags(containerId, list, placeholder) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    if (list.length === 0) {
        container.innerHTML = `<span class="placeholder">${placeholder}</span>`;
    } else {
        list.forEach(item => {
            container.innerHTML += `
                <span class="tag" style="background: rgba(255,255,255,0.08); border: 1px solid var(--border-color); color: var(--text-primary); padding: 2px 6px; border-radius: var(--radius-sm); font-size: 11px; margin: 1px; display:inline-flex; align-items:center; gap: 4px;">
                    ${item.label}
                    <span onclick="event.stopPropagation(); removeContribTag('${containerId}', '${item.value}')" style="cursor:pointer; color: var(--accent-red); font-weight:bold;">&times;</span>
                </span>
            `;
        });
    }
}

// Dropdown search filters
function filterPlanningContribProductsDropdown(e) {
    const term = e.target.value.toLowerCase();
    const container = document.getElementById('planning-contrib-products-options-container');
    if (container) {
        Array.from(container.children).forEach(label => {
            const text = label.textContent.toLowerCase();
            if (text.includes(term)) label.classList.remove('hidden');
            else label.classList.add('hidden');
        });
    }
}

function filterPlanningContribSalesProdsDropdown(e) {
    const term = e.target.value.toLowerCase();
    const container = document.getElementById('planning-contrib-sales-prods-options-container');
    if (container) {
        Array.from(container.children).forEach(label => {
            const text = label.textContent.toLowerCase();
            if (text.includes(term)) label.classList.remove('hidden');
            else label.classList.add('hidden');
        });
    }
}

function filterPlanningContribColorsDropdown(e) {
    const term = e.target.value.toLowerCase();
    const container = document.getElementById('planning-contrib-colors-options-container');
    if (container) {
        Array.from(container.children).forEach(label => {
            const text = label.textContent.toLowerCase();
            if (text.includes(term)) label.classList.remove('hidden');
            else label.classList.add('hidden');
        });
    }
}

function togglePlanningContribProductsDropdown(e) {
    e.stopPropagation();
    closeAllContribDropdowns();
    document.getElementById('planning-contrib-products-dropdown-list').classList.toggle('hidden');
}

function togglePlanningContribSalesProdsDropdown(e) {
    e.stopPropagation();
    closeAllContribDropdowns();
    document.getElementById('planning-contrib-sales-prods-dropdown-list').classList.toggle('hidden');
}

function togglePlanningContribColorsDropdown(e) {
    e.stopPropagation();
    closeAllContribDropdowns();
    document.getElementById('planning-contrib-colors-dropdown-list').classList.toggle('hidden');
}

function closeAllContribDropdowns() {
    const lists = [
        'planning-contrib-products-dropdown-list',
        'planning-contrib-sales-prods-dropdown-list',
        'planning-contrib-colors-dropdown-list'
    ];
    lists.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
}
document.addEventListener('click', closeAllContribDropdowns);

// Load data page trigger
function loadPlanningContributionData() {
    planningContribCurrentPage = 1;
    fetchPlanningContribPage();
}

let planningContribRequestId = 0;

// Fetch current page data from backend REST API
async function fetchPlanningContribPage() {
    const currentReqId = ++planningContribRequestId;
    const cType = document.getElementById('planning-contrib-type').value;
    const brandId = document.getElementById('planning-contrib-filter-brand').value;
    const prodIds = Array.from(selectedMasterProducts).join(',');
    const salesProds = Array.from(selectedSalesProducts).join(',');
    const colorIds = Array.from(selectedMasterColors).join(',');

    // Version name
    const newVer = document.getElementById('planning-contrib-version-new').value.trim();
    const selectVer = document.getElementById('planning-contrib-version-select').value;
    const version = newVer || selectVer || 'Standard';

    const loader = document.getElementById('planning-contrib-loader');
    if (loader) loader.classList.remove('hidden');

    // Handle Drilldown Header UI and Parameters Carry-over
    let finalBrandId = brandId;
    let finalProdIds = prodIds;
    let colorCodeParam = '';

    const drilldownBar = document.getElementById('planning-contrib-drilldown-bar');
    const breadcrumbs = document.getElementById('planning-contrib-breadcrumbs');

    if (planningContribDrilldownProduct) {
        finalBrandId = planningContribDrilldownProduct.brand_id;
        finalProdIds = planningContribDrilldownProduct.id.toString();

        const sizeMethodSelect = document.getElementById('planning-contrib-size-method');
        const sizeMethod = sizeMethodSelect ? sizeMethodSelect.value : '1';
        if (planningContribDrilldownColor && (cType !== 'Size' || sizeMethod !== '2')) {
            colorCodeParam = `&color_code=${encodeURIComponent(planningContribDrilldownColor.code)}`;
        }

        if (drilldownBar) drilldownBar.classList.remove('hidden');
        if (breadcrumbs) {
            let html = `<span style="color:var(--text-muted); font-size: 13px;">Contribution Master</span> <i class="fa-solid fa-chevron-right" style="font-size:10px; color: var(--text-muted);"></i>`;
            html += `<a href="#" onclick="resetPlanningContribDrilldown(); return false;" style="color:var(--accent-blue); text-decoration:underline; font-size: 13px; font-weight: 500;">Product Contribution</a>`;
            html += ` <i class="fa-solid fa-chevron-right" style="font-size:10px; color: var(--text-muted);"></i> <span style="color:var(--text-primary); font-weight:600; font-size: 13px;">${planningContribDrilldownProduct.name}</span>`;

            if (cType === 'Color') {
                html += ` <i class="fa-solid fa-chevron-right" style="font-size:10px; color: var(--text-muted);"></i> <span style="color:var(--text-secondary); font-size: 13px; font-weight: 500;">Color Contribution</span>`;
                const backBtnText = document.getElementById('planning-contrib-back-btn-text');
                if (backBtnText) backBtnText.textContent = "Back to Product";
            } else if (cType === 'Size') {
                if (planningContribDrilldownColor) {
                    html += ` <i class="fa-solid fa-chevron-right" style="font-size:10px; color: var(--text-muted);"></i> `;
                    html += `<a href="#" onclick="drilldownToColorOnly(); return false;" style="color:var(--accent-blue); text-decoration:underline; font-size: 13px; font-weight: 500;">Color Contribution</a>`;
                    html += ` <i class="fa-solid fa-chevron-right" style="font-size:10px; color: var(--text-muted);"></i> <span style="color:var(--text-primary); font-weight:600; font-size: 13px;">${planningContribDrilldownColor.name}</span>`;
                    html += ` <i class="fa-solid fa-chevron-right" style="font-size:10px; color: var(--text-muted);"></i> <span style="color:var(--text-secondary); font-size: 13px; font-weight: 500;">Size Contribution</span>`;
                    const backBtnText = document.getElementById('planning-contrib-back-btn-text');
                    if (backBtnText) backBtnText.textContent = "Back to Color";
                } else {
                    html += ` <i class="fa-solid fa-chevron-right" style="font-size:10px; color: var(--text-muted);"></i> <span style="color:var(--text-secondary); font-size: 13px; font-weight: 500;">Size Contribution</span>`;
                    const backBtnText = document.getElementById('planning-contrib-back-btn-text');
                    if (backBtnText) backBtnText.textContent = "Back to Product";
                }
            }
            breadcrumbs.innerHTML = html;
        }

        // Lock top selection fields
        const typeSelect = document.getElementById('planning-contrib-type');
        if (typeSelect) typeSelect.disabled = true;
        const brandSelect = document.getElementById('planning-contrib-filter-brand');
        if (brandSelect) brandSelect.disabled = true;
        const prodSelectTrigger = document.querySelector('#planning-contrib-products-multiselect .multiselect-trigger');
        if (prodSelectTrigger) prodSelectTrigger.style.pointerEvents = 'none';
        if (prodSelectTrigger) prodSelectTrigger.style.opacity = '0.5';
    } else {
        if (drilldownBar) drilldownBar.classList.add('hidden');

        const typeSelect = document.getElementById('planning-contrib-type');
        if (typeSelect) typeSelect.disabled = false;
        const brandSelect = document.getElementById('planning-contrib-filter-brand');
        if (brandSelect) brandSelect.disabled = false;
        const prodSelectTrigger = document.querySelector('#planning-contrib-products-multiselect .multiselect-trigger');
        if (prodSelectTrigger) prodSelectTrigger.style.pointerEvents = 'auto';
        if (prodSelectTrigger) prodSelectTrigger.style.opacity = '1';
    }

    selectedPlanningContribRows.clear();
    const selectAllCb = document.getElementById('planning-contrib-select-all');
    if (selectAllCb) selectAllCb.checked = false;

    try {
        const rule = document.getElementById('planning-contrib-rule').value;
        let sizeParam = '';
        if (typeof planningContribDrilldownSize !== 'undefined' && planningContribDrilldownSize) {
            sizeParam = `&size_id=${encodeURIComponent(planningContribDrilldownSize)}`;
        }

        const fromMonth = document.getElementById('planning-contrib-common-from-month').value;
        const fromYear = document.getElementById('planning-contrib-common-from-year').value;
        const toMonth = document.getElementById('planning-contrib-common-to-month').value;
        const toYear = document.getElementById('planning-contrib-common-to-year').value;
        const periodParams = `&from_month=${encodeURIComponent(fromMonth)}&from_year=${encodeURIComponent(fromYear)}&to_month=${encodeURIComponent(toMonth)}&to_year=${encodeURIComponent(toYear)}`;

        const url = `/api/planning-contribution/data?contribution_type=${cType}&brand_id=${finalBrandId}&product_ids=${encodeURIComponent(finalProdIds)}&sales_products=${encodeURIComponent(salesProds)}&color_ids=${encodeURIComponent(colorIds)}&version=${encodeURIComponent(version)}&page=${planningContribCurrentPage}&per_page=${planningContribPerPage}${colorCodeParam}${sizeParam}&suggestion_rule=${encodeURIComponent(rule)}${periodParams}`;
        const response = await fetch(url);
        const data = await response.json();

        // Discard stale out-of-order responses
        if (currentReqId !== planningContribRequestId) {
            return;
        }

        if (response.ok && data.success) {
            planningContribData = data;
            planningContribTotalCount = data.total_count || 0;

            originalPlanningContribRows = {};
            if (data.rows) {
                data.rows.forEach((r, idx) => {
                    const id = getPlanningContribRowId(r, idx);
                    let baseManualPct = r.manual_pct;
                    if (r.fixed_percentage !== null && r.fixed_percentage !== undefined) {
                        baseManualPct = r.fixed_percentage;
                    } else if (baseManualPct === null || baseManualPct === undefined) {
                        baseManualPct = r.suggested_pct;
                    }
                    originalPlanningContribRows[id] = {
                        manual_pct: baseManualPct
                    };
                    r.is_manually_edited = false;
                });
            }

            renderPlanningContribTableBodyOnly();
            updatePaginationLayout();
            const infoMsg = document.getElementById('planning-contrib-info-msg');
            if (infoMsg) {
                if (data.message) {
                    infoMsg.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${data.message}`;
                } else {
                    infoMsg.innerHTML = '';
                }
            }
        } else {
            alert(data.message || "Failed to load contribution data.");
        }
    } catch (err) {
        console.error("Error loading contributions:", err);
        alert("Network error.");
    } finally {
        if (loader && currentReqId === planningContribRequestId) loader.classList.add('hidden');
    }
}

// Render paginated rows in fixing engine spreadsheet
function renderPlanningContribTableBodyOnly() {
    const tbody = document.getElementById('planning-contrib-tbody');
    if (!tbody || !planningContribData) return;
    tbody.innerHTML = '';

    const cType = planningContribData.contribution_type;

    // Hide/Show dynamic action headers
    const thColor = document.getElementById('planning-contrib-th-color-action');
    const thSize = document.getElementById('planning-contrib-th-size-action');
    if (cType === 'Product') {
        if (thColor) thColor.classList.remove('hidden');
        if (thSize) thSize.classList.remove('hidden');
    } else if (cType === 'Color') {
        if (thColor) thColor.classList.add('hidden');
        if (thSize) thSize.classList.remove('hidden');
    } else if (cType === 'Size') {
        if (thColor) thColor.classList.add('hidden');
        if (thSize) thSize.classList.add('hidden');
    }

    // Apply search filter and popup selection filters on client side
    const activeRows = planningContribData.rows.filter(p => {
        if (typeof isModalOpen !== 'undefined' && isModalOpen) {
            // Check product
            const targetProd = Array.from(selectedMasterProducts)[0];
            if (targetProd && p.product_id.toString() !== targetProd) {
                return false;
            }
            // Check color
            if (planningContribDrilldownColor && p.color_code !== planningContribDrilldownColor.code) {
                return false;
            }
            // Check size
            if (planningContribDrilldownSize && p.size_id !== planningContribDrilldownSize) {
                return false;
            }
        }

        let itemName = '';
        if (cType === 'Product') itemName = p.product_name;
        else if (cType === 'Color') itemName = `${p.product_name} - ${p.color_name}`;
        else if (cType === 'Size') {
            if (planningContribDrilldownColor) {
                itemName = `${p.product_name} - ${planningContribDrilldownColor.name} - ${p.size_name}`;
            } else {
                itemName = `${p.product_name} - ${p.size_name}`;
            }
        }

        if (planningContribSearchTerm && !itemName.toLowerCase().includes(planningContribSearchTerm.toLowerCase())) {
            return false;
        }
        return true;
    });

    // Perform dynamic client-side calculations safely
    activeRows.forEach(p => {
        const safeAvg = Number.isFinite(Number(p.selected_period_avg_pct)) ? Number(p.selected_period_avg_pct) : 0.0;
        const safeLy = Number.isFinite(Number(p.last_year_same_period_pct)) ? Number(p.last_year_same_period_pct) : 0.0;
        let safeSug = Number.isFinite(Number(p.suggested_pct)) ? Number(p.suggested_pct) : safeAvg;

        p.selected_period_avg_pct = safeAvg;
        p.last_year_same_period_pct = safeLy;
        p.suggested_pct = safeSug;

        if (p.is_manually_edited === true) {
            p.manual_pct = Number.isFinite(Number(p.manual_pct)) ? Number(p.manual_pct) : safeSug;
        } else if (p.fixed_percentage !== null && p.fixed_percentage !== undefined && Number.isFinite(Number(p.fixed_percentage))) {
            p.manual_pct = Number(p.fixed_percentage);
            p.fixed_percentage = Number(p.fixed_percentage);
        } else if (p.manual_pct !== null && p.manual_pct !== undefined && Number.isFinite(Number(p.manual_pct))) {
            p.manual_pct = Number(p.manual_pct);
        } else {
            p.manual_pct = safeSug;
        }
        p.variance = Number.isFinite(p.manual_pct - p.suggested_pct) ? (p.manual_pct - p.suggested_pct) : 0.0;
    });

    let totalAvg = 0;
    let totalLy = 0;
    let totalSuggested = 0;
    let totalManual = 0;

    let index = (planningContribCurrentPage - 1) * planningContribPerPage + 1;

    activeRows.forEach((p, idx) => {
        totalAvg += Number.isFinite(p.selected_period_avg_pct) ? p.selected_period_avg_pct : 0.0;
        totalLy += Number.isFinite(p.last_year_same_period_pct) ? p.last_year_same_period_pct : 0.0;
        totalSuggested += Number.isFinite(p.suggested_pct) ? p.suggested_pct : 0.0;
        totalManual += Number.isFinite(p.manual_pct) ? p.manual_pct : 0.0;

        const rowId = getPlanningContribRowId(p, idx);
        const isChecked = selectedPlanningContribRows.has(rowId);

        const actualRowIdx = planningContribData.rows.indexOf(p);
        const rowIdxForEvents = actualRowIdx !== -1 ? actualRowIdx : idx;

        const curFromMonth = p.from_month || document.getElementById('planning-contrib-common-from-month')?.value || 'April';
        const curFromYear = p.from_year || parseInt(document.getElementById('planning-contrib-common-from-year')?.value) || 2026;
        const curToMonth = p.to_month || document.getElementById('planning-contrib-common-to-month')?.value || 'December';
        const curToYear = p.to_year || parseInt(document.getElementById('planning-contrib-common-to-year')?.value) || 2026;
        p.from_month = curFromMonth;
        p.from_year = curFromYear;
        p.to_month = curToMonth;
        p.to_year = curToYear;

        const fromMonthOpts = MONTHS_LIST.map(m => `<option value="${m}" ${m === p.from_month ? 'selected' : ''}>${m.substring(0, 3)}</option>`).join('');
        const fromYearOpts = YEARS_LIST.map(y => `<option value="${y}" ${parseInt(y) === parseInt(p.from_year) ? 'selected' : ''}>${y}</option>`).join('');
        const toMonthOpts = MONTHS_LIST.map(m => `<option value="${m}" ${m === p.to_month ? 'selected' : ''}>${m.substring(0, 3)}</option>`).join('');
        const toYearOpts = YEARS_LIST.map(y => `<option value="${y}" ${parseInt(y) === parseInt(p.to_year) ? 'selected' : ''}>${y}</option>`).join('');

        const periodSelectorHtml = `
            <div style="display: inline-flex; align-items: center; gap: 4px; justify-content: center;">
                <select class="spreadsheet-select"
                    onchange="onRowPeriodChange(${rowIdxForEvents}, this.value, 'from_month', this)">
                    ${fromMonthOpts}
                </select>
                <select class="spreadsheet-select"
                    onchange="onRowPeriodChange(${rowIdxForEvents}, this.value, 'from_year', this)">
                    ${fromYearOpts}
                </select>
                <span style="font-size: 11px; color: var(--text-muted);">-</span>
                <select class="spreadsheet-select"
                    onchange="onRowPeriodChange(${rowIdxForEvents}, this.value, 'to_month', this)">
                    ${toMonthOpts}
                </select>
                <select class="spreadsheet-select"
                    onchange="onRowPeriodChange(${rowIdxForEvents}, this.value, 'to_year', this)">
                    ${toYearOpts}
                </select>
            </div>
        `;

        // Clickable Products Count link
        const salesProdsList = Array.isArray(p.sales_products) ? p.sales_products : [];
        const salesProductsHtml = `
            <a href="#" onclick="openSalesProductsModalForIndex(${rowIdxForEvents}); return false;" style="color: var(--accent-blue); text-decoration: underline; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
                <i class="fa-solid fa-tags" style="font-size: 11px;"></i>
                <span>${salesProdsList.length} ${salesProdsList.length === 1 ? 'Product' : 'Products'}</span>
            </a>
        `;

        let varianceStyle = '';
        if (p.variance > 0.001) varianceStyle = 'color: var(--accent-green); font-weight:600;';
        else if (p.variance < -0.001) varianceStyle = 'color: var(--accent-red); font-weight:600;';

        let headerName = '';
        if (cType === 'Product') {
            headerName = `<strong>${p.product_name || ''}</strong> <span style="font-size: 11px; color: var(--text-muted);">(${p.product_type || ''})</span>`;
        } else if (cType === 'Color') {
            headerName = `<strong>${p.product_name || ''} - ${p.color_name || ''}</strong> <span style="font-size: 11px; color: var(--text-muted);">(${p.color_code || ''})</span>`;
        } else if (cType === 'Size') {
            if (planningContribDrilldownColor) {
                headerName = `<strong>${p.product_name || ''} - ${planningContribDrilldownColor.name || ''} - ${p.size_name || ''}</strong> <span style="font-size: 11px; color: var(--text-muted);">(${p.size_code || ''})</span>`;
            } else {
                headerName = `<strong>${p.product_name || ''} - ${p.size_name || ''}</strong> <span style="font-size: 11px; color: var(--text-muted);">(${p.size_code || ''})</span>`;
            }
        }

        let actionCellsHtml = '';
        if (cType === 'Product') {
            actionCellsHtml += `
                <td style="text-align: center; vertical-align: middle;">
                    <a href="#" onclick="drilldownToColor(${p.product_id}, '${p.product_name}', ${p.brand_id}); return false;" style="color: var(--accent-blue); text-decoration: underline; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
                        <span>🎨 Color Contribution</span>
                    </a>
                </td>
                <td style="text-align: center; vertical-align: middle;">
                    <a href="#" onclick="drilldownToSizeFromProduct(${p.product_id}, '${p.product_name}', ${p.brand_id}); return false;" style="color: var(--accent-blue); text-decoration: underline; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
                        <span>📏 Size Contribution</span>
                    </a>
                </td>
            `;
        } else if (cType === 'Color') {
            actionCellsHtml += `
                <td style="text-align: center; vertical-align: middle;">
                    <a href="#" onclick="drilldownToSizeFromColor(${p.product_id}, '${p.product_name}', ${p.brand_id}, '${p.color_code}', '${p.color_name}'); return false;" style="color: var(--accent-blue); text-decoration: underline; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
                        <span>📏 Size Contribution</span>
                    </a>
                </td>
            `;
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align: center;">
                <input type="checkbox" class="planning-row-cb" data-id="${rowId}" ${isChecked ? 'checked' : ''} onchange="toggleRowSelection('${rowId}', this.checked)">
            </td>
            <td>${index++}</td>
            <td>${headerName}</td>
            <td style="max-width: 280px; overflow-wrap: break-word;">${salesProductsHtml}</td>
            <td style="text-align: center; white-space: nowrap; padding: 4px 6px;">${periodSelectorHtml}</td>
            <td class="text-right">${p.selected_period_avg_pct.toFixed(2)}%</td>
            <td class="text-right">${p.last_year_same_period_pct.toFixed(2)}%</td>
            <td class="text-right" style="background: rgba(255,255,255,0.01);">${p.suggested_pct.toFixed(2)}%</td>
            <td style="border-left: 2px solid var(--border-color); padding: 2px 4px; background: rgba(58,110,165,0.03);">
                <input type="number" class="spreadsheet-input-pct" step="0.01" min="0" max="100" 
                    value="${p.manual_pct.toFixed(2)}" 
                    onchange="onPlanningContribManualPercentChange(${rowIdxForEvents}, this.value, this)">
            </td>
            <td class="text-right" style="font-size: 11px; color: var(--text-secondary);">${p.fixed_percentage !== null && p.fixed_percentage !== undefined ? p.fixed_percentage.toFixed(2) + '%' : '<span style="font-size:10px; color:var(--text-muted); font-style:italic;" title="Uncommitted / Draft">Draft / Not Fixed</span>'}</td>
            <td style="text-align: center; font-size: 11px; color: var(--text-secondary);">${p.last_updated ? p.last_updated : '-'}</td>
            <td style="text-align: center; font-size: 11px; color: var(--text-secondary);">${p.updated_by ? p.updated_by : '-'}</td>
            <td class="text-right" style="${varianceStyle}">${p.variance.toFixed(2)}%</td>
            ${actionCellsHtml}
        `;
        tbody.appendChild(tr);
    });

    document.getElementById('total-contrib-avg').textContent = `${Number.isFinite(totalAvg) ? totalAvg.toFixed(2) : '0.00'}%`;
    document.getElementById('total-contrib-ly').textContent = `${Number.isFinite(totalLy) ? totalLy.toFixed(2) : '0.00'}%`;
    document.getElementById('total-contrib-suggested').textContent = `${Number.isFinite(totalSuggested) ? totalSuggested.toFixed(2) : '0.00'}%`;

    const manualTotalCell = document.getElementById('total-contrib-manual');
    manualTotalCell.textContent = `${Number.isFinite(totalManual) ? totalManual.toFixed(2) : '0.00'}%`;

    const varianceSum = totalManual - totalSuggested;
    const varCell = document.getElementById('total-contrib-variance');
    varCell.textContent = `${Number.isFinite(varianceSum) ? varianceSum.toFixed(2) : '0.00'}%`;
    if (Math.abs(varianceSum) < 0.01) {
        varCell.style.color = '';
    } else {
        varCell.style.color = varianceSum > 0 ? 'var(--accent-green)' : 'var(--accent-red)';
    }

    // Balance dynamic totals row cells
    const tfootRow = document.getElementById('planning-contrib-tfoot-row');
    if (tfootRow) {
        const extraTds = tfootRow.querySelectorAll('.extra-total-cell');
        extraTds.forEach(td => td.remove());

        if (cType === 'Product') {
            const td1 = document.createElement('td');
            td1.className = 'extra-total-cell';
            const td2 = document.createElement('td');
            td2.className = 'extra-total-cell';
            tfootRow.appendChild(td1);
            tfootRow.appendChild(td2);
        } else if (cType === 'Color') {
            const td = document.createElement('td');
            td.className = 'extra-total-cell';
            tfootRow.appendChild(td);
        }
    }
}

// Pagination Event and Layout Handlers
function updatePaginationLayout() {
    const prevBtn = document.getElementById('planning-contrib-prev-btn');
    const nextBtn = document.getElementById('planning-contrib-next-btn');
    const currentPageLabel = document.getElementById('planning-contrib-current-page');
    const infoLabel = document.getElementById('planning-contrib-pagination-info');

    const maxPages = Math.ceil(planningContribTotalCount / planningContribPerPage) || 1;

    if (prevBtn) prevBtn.disabled = (planningContribCurrentPage === 1);
    if (nextBtn) nextBtn.disabled = (planningContribCurrentPage >= maxPages);
    if (currentPageLabel) currentPageLabel.textContent = `Page ${planningContribCurrentPage} of ${maxPages}`;

    const startEntry = planningContribTotalCount === 0 ? 0 : (planningContribCurrentPage - 1) * planningContribPerPage + 1;
    const endEntry = Math.min(planningContribCurrentPage * planningContribPerPage, planningContribTotalCount);
    if (infoLabel) {
        infoLabel.textContent = `Showing ${startEntry} to ${endEntry} of ${planningContribTotalCount} entries`;
    }
}

function onPlanningContribPerPageChange() {
    planningContribPerPage = parseInt(document.getElementById('planning-contrib-per-page').value) || 10;
    planningContribCurrentPage = 1;
    fetchPlanningContribPage();
}

function planningContribPrevPage() {
    if (planningContribCurrentPage > 1) {
        planningContribCurrentPage--;
        fetchPlanningContribPage();
    }
}

function planningContribNextPage() {
    const maxPages = Math.ceil(planningContribTotalCount / planningContribPerPage) || 1;
    if (planningContribCurrentPage < maxPages) {
        planningContribCurrentPage++;
        fetchPlanningContribPage();
    }
}

function filterPlanningContributionProducts() {
    planningContribSearchTerm = document.getElementById('planning-contrib-search').value.trim();
    renderPlanningContribTableBodyOnly();
}

let currentSalesProductsEditRowIndex = null;

function openSalesProductsModalForIndex(rowIndex) {
    const row = planningContribData.rows[rowIndex];
    if (!row) return;

    currentSalesProductsEditRowIndex = rowIndex;

    const subtitle = document.getElementById('sales-products-modal-subtitle');
    if (subtitle) {
        subtitle.textContent = `Configure enabled sales products for ${row.product_name || 'selected item'}`;
    }

    const container = document.getElementById('sales-products-modal-options');
    if (container) {
        container.innerHTML = '';
        row.sales_products.forEach(sp => {
            const isChecked = row.active_sales_products.includes(sp);
            container.innerHTML += `
                <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; padding: 6px 12px; border-radius: var(--radius-sm); background: rgba(255,255,255,0.02); border: 1px solid var(--border-color); margin-bottom: 2px;">
                    <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleRowSalesProductFromModal('${sp}', this.checked)">
                    <span style="color: var(--text-primary); font-weight: 500;">${sp}</span>
                </label>
            `;
        });
    }

    const modal = document.getElementById('sales-products-modal');
    if (modal) modal.classList.remove('hidden');
}

function closeSalesProductsModal() {
    const modal = document.getElementById('sales-products-modal');
    if (modal) modal.classList.add('hidden');
    currentSalesProductsEditRowIndex = null;
}

async function toggleRowSalesProductFromModal(salesProductName, checked) {
    if (currentSalesProductsEditRowIndex === null) return;
    const rowIndex = currentSalesProductsEditRowIndex;
    const row = planningContribData.rows[rowIndex];
    if (!row) return;

    pushContribUndoState();

    if (checked) {
        if (!row.active_sales_products.includes(salesProductName)) {
            row.active_sales_products.push(salesProductName);
        }
    } else {
        row.active_sales_products = row.active_sales_products.filter(x => x !== salesProductName);
    }

    await triggerRowRecalculation(rowIndex);
}

// Inline Row Period Select Range Change
async function onRowPeriodChange(rowIndex, val, field, selectEl) {
    const row = planningContribData.rows[rowIndex];
    if (!row) return;

    pushContribUndoState();

    if (field === 'from_month') row.from_month = val;
    else if (field === 'from_year') row.from_year = parseInt(val);
    else if (field === 'to_month') row.to_month = val;
    else if (field === 'to_year') row.to_year = parseInt(val);

    await triggerRowRecalculation(rowIndex);
}

// Recalculates metrics for a single row after configuration changes
async function triggerRowRecalculation(rowIndex) {
    const row = planningContribData.rows[rowIndex];
    if (!row) return;

    const loader = document.getElementById('planning-contrib-loader');
    if (loader) loader.classList.remove('hidden');

    try {
        const rule = document.getElementById('planning-contrib-rule').value;

        const payload = {
            contribution_type: planningContribData.contribution_type,
            from_month: row.from_month,
            from_year: row.from_year,
            to_month: row.to_month,
            to_year: row.to_year,
            sales_products: row.active_sales_products || [],
            product_id: row.product_id,
            color_code: row.color_code,
            size_id: row.size_id,
            suggestion_rule: rule
        };

        const response = await fetch('/api/planning-contribution/calculate-row', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const res = await response.json();

        if (response.ok && res.success) {
            row.selected_period_avg_pct = res.selected_period_avg_pct;
            row.last_year_same_period_pct = res.last_year_same_period_pct;
            row.suggested_pct = res.suggested_pct;
            if (row.fixed_percentage !== null && row.fixed_percentage !== undefined && !row.is_manually_edited) {
                row.manual_pct = row.fixed_percentage;
                row.is_manually_edited = false;
            } else if (row.is_manually_edited === true) {
                // Keep user's unsaved manual edit and keep is_manually_edited = true
            } else {
                row.manual_pct = res.suggested_pct;
                row.is_manually_edited = false;
            }
            row.variance = row.manual_pct - row.suggested_pct;

            renderPlanningContribTableBodyOnly();
        } else {
            alert(res.message || "Failed to calculate contribution ratios for this row.");
        }
    } catch (err) {
        console.error("Error recalculating row:", err);
    } finally {
        if (loader) loader.classList.add('hidden');
    }
}

// Applies the selected common period to all rows and performs a bulk recalculation
async function applyCommonPeriodToAllRows() {
    if (!planningContribData || !planningContribData.rows || planningContribData.rows.length === 0) {
        alert("No rows available to apply period.");
        return;
    }

    const fromMonth = document.getElementById('planning-contrib-common-from-month').value;
    const fromYear = parseInt(document.getElementById('planning-contrib-common-from-year').value);
    const toMonth = document.getElementById('planning-contrib-common-to-month').value;
    const toYear = parseInt(document.getElementById('planning-contrib-common-to-year').value);

    pushContribUndoState();

    // Update local period for all rows immediately
    planningContribData.rows.forEach(row => {
        row.from_month = fromMonth;
        row.from_year = fromYear;
        row.to_month = toMonth;
        row.to_year = toYear;
    });

    const loader = document.getElementById('planning-contrib-loader');
    if (loader) loader.classList.remove('hidden');

    try {
        const rule = document.getElementById('planning-contrib-rule').value;

        // Prepare bulk rows payload
        const rowsPayload = planningContribData.rows.map(row => {
            return {
                product_id: row.product_id,
                color_code: row.color_code,
                size_id: row.size_id,
                active_sales_products: row.active_sales_products || row.sales_products || []
            };
        });

        const payload = {
            contribution_type: planningContribData.contribution_type,
            from_month: fromMonth,
            from_year: fromYear,
            to_month: toMonth,
            to_year: toYear,
            suggestion_rule: rule,
            rows: rowsPayload
        };

        const response = await fetch('/api/planning-contribution/calculate-rows-bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const res = await response.json();

        if (response.ok && res.success) {
            // Match the calculated percentages back to the rows
            res.results.forEach((calcResult, idx) => {
                const row = planningContribData.rows[idx];
                if (row) {
                    row.selected_period_avg_pct = calcResult.selected_period_avg_pct;
                    row.last_year_same_period_pct = calcResult.last_year_same_period_pct;
                    row.suggested_pct = calcResult.suggested_pct;
                    if (row.fixed_percentage !== null && row.fixed_percentage !== undefined && !row.is_manually_edited) {
                        row.manual_pct = row.fixed_percentage;
                        row.is_manually_edited = false;
                    } else if (row.is_manually_edited === true) {
                        // Keep user's unsaved manual edit and keep is_manually_edited = true
                    } else {
                        row.manual_pct = calcResult.suggested_pct;
                        row.is_manually_edited = false;
                    }
                    row.variance = row.manual_pct - row.suggested_pct;
                }
            });

            renderPlanningContribTableBodyOnly();
        } else {
            alert(res.message || "Failed to calculate bulk contributions.");
        }
    } catch (err) {
        console.error("Error applying common period:", err);
        alert("An error occurred during recalculation.");
    } finally {
        if (loader) loader.classList.add('hidden');
    }
}

function onPlanningContribManualPercentChange(rowIndex, val, inputEl) {
    const num = parseFloat(val);
    if (isNaN(num) || num < 0 || num > 100) {
        alert("Please enter a valid percentage between 0 and 100.");
        inputEl.value = planningContribData.rows[rowIndex].manual_pct.toFixed(2);
        return;
    }
    pushContribUndoState();
    const row = planningContribData.rows[rowIndex];
    row.manual_pct = num;
    row.is_manually_edited = true;
    row.variance = num - row.suggested_pct;
    renderPlanningContribTableBodyOnly();
}

// POST Save contributions
async function savePlanningContributionData() {
    if (!planningContribData || !planningContribData.rows) return;

    // Version name selection or input
    const newVer = document.getElementById('planning-contrib-version-new').value.trim();
    const selectVer = document.getElementById('planning-contrib-version-select').value;
    const version = newVer || selectVer || 'Standard';

    // Identify rows to save
    let rowsToSend = [];
    const hasSelection = selectedPlanningContribRows.size > 0;

    if (hasSelection) {
        planningContribData.rows.forEach((r, idx) => {
            const id = getPlanningContribRowId(r, idx);
            if (selectedPlanningContribRows.has(id)) {
                rowsToSend.push(r);
            }
        });
    } else {
        // Save all modified rows
        planningContribData.rows.forEach((r, idx) => {
            if (isRowModified(r, idx)) {
                rowsToSend.push(r);
            }
        });
    }

    if (rowsToSend.length === 0) {
        alert("No modified or selected rows found to save.");
        return;
    }

    const loader = document.getElementById('planning-contrib-loader');
    if (loader) loader.classList.remove('hidden');

    try {
        const payload = {
            contribution_type: planningContribData.contribution_type,
            version: version,
            rows: rowsToSend
        };

        if (planningContribData.contribution_type === 'Size') {
            const sizeMethod = document.getElementById('planning-contrib-size-method').value;
            payload.size_method = parseInt(sizeMethod);
            if (sizeMethod === '2') {
                if (selectedSizeMethodColors.size === 0) {
                    alert("Please select at least one color in 'Apply To Colors' to save under Method 2.");
                    if (loader) loader.classList.add('hidden');
                    return;
                }
                payload.selected_colors = Array.from(selectedSizeMethodColors);
            } else {
                payload.selected_colors = [];
            }
        }

        const response = await fetch('/api/planning-contribution/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const res = await response.json();

        if (response.ok && res.success) {
            if (res.log_info) {
                console.log("---- Debug Contribution Popup Save ----");
                console.log("Product ID:", res.log_info.product_id);
                console.log("Product Name:", res.log_info.product_name);
                console.log("Color ID:", res.log_info.color_id);
                console.log("Color Name:", res.log_info.color_name);
                console.log("Version:", res.log_info.version);
                console.log("Contribution Type:", res.log_info.contribution_type);
                console.log("Rows Submitted:", res.log_info.rows_submitted);
                console.log("Rows Saved:", res.log_info.rows_saved);
                console.log("Rows Updated:", res.log_info.rows_updated);
                console.log("Database Total %:", res.log_info.database_total_pct);
                console.log("Status:", res.log_info.status);
            }

            // Update local rows with saved metadata and update base cache
            if (res.saved_records) {
                res.saved_records.forEach(savedRec => {
                    const row = planningContribData.rows.find(r =>
                        r.product_id === savedRec.product_id &&
                        r.color_code === savedRec.color_code &&
                        r.size_id === savedRec.size_id
                    );
                    if (row) {
                        row.manual_pct = savedRec.manual_pct;
                        row.fixed_percentage = savedRec.fixed_percentage;
                        row.last_updated = savedRec.last_updated;
                        row.updated_by = savedRec.updated_by;
                        row.is_manually_edited = false;

                        // Update baseline cache so this row is no longer dirty
                        const idx = planningContribData.rows.indexOf(row);
                        const id = getPlanningContribRowId(row, idx);
                        originalPlanningContribRows[id] = {
                            manual_pct: savedRec.manual_pct
                        };
                    }
                });
            }

            // Clear selection states
            selectedPlanningContribRows.clear();
            const selectAllCb = document.getElementById('planning-contrib-select-all');
            if (selectAllCb) selectAllCb.checked = false;

            // Reload the table from the database to reflect committed values
            await fetchPlanningContribPage();

            // If saved from modal popup, close modal and reload parent page derivations
            if (typeof isModalOpen !== 'undefined' && isModalOpen) {
                closeAIContribModal();
                if (typeof loadDerivationPage === 'function') {
                    await loadDerivationPage(true);
                }
            }

            // Load and update version selector list if a new version was defined
            if (newVer) {
                await loadPlanningContribVersions();
                document.getElementById('planning-contrib-version-select').value = version;
                document.getElementById('planning-contrib-version-new').value = '';
            }

            // Show result details if any rows failed validation
            if (res.failed_count > 0) {
                let errMsg = `${res.success_count} rows saved successfully.\n${res.failed_count} rows failed validation:\n`;
                errMsg += res.details.join('\n');
                alert(errMsg);
            } else {
                alert(res.message || "Contributions saved successfully.");
            }
        } else {
            if (res.details && res.details.length > 0) {
                alert(res.message + "\n\nValidation failures:\n" + res.details.join('\n'));
            } else {
                alert(res.message || "Failed to save contributions.");
            }
        }
    } catch (err) {
        console.error("Error saving contributions:", err);
        alert("Network error.");
    } finally {
        if (loader) loader.classList.add('hidden');
    }
}

// Export CSV Excel
function exportPlanningContributionToExcel() {
    if (!planningContribData || !planningContribData.rows) return;

    const cType = planningContribData.contribution_type;

    const headers = [
        "Item Name",
        "Selected Sales Products",
        "Average Sales %",
        "Last Year %",
        "Suggested %",
        "Manual %",
        "Fixed %",
        "Variance %"
    ];

    let csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n";

    planningContribData.rows.forEach(r => {
        let name = '';
        if (cType === 'Product') name = r.product_name;
        else if (cType === 'Color') name = `${r.product_name} - ${r.color_name} (${r.color_code})`;
        else if (cType === 'Size') name = `${r.product_name} - ${r.size_name} (${r.size_code})`;

        const fixedPctText = r.fixed_percentage !== null && r.fixed_percentage !== undefined ? `${r.fixed_percentage.toFixed(2)}%` : '-';

        const line = [
            `"${name}"`,
            `"${r.active_sales_products.join('; ')}"`,
            `"${r.selected_period_avg_pct.toFixed(2)}%"`,
            `"${r.last_year_same_period_pct.toFixed(2)}%"`,
            `"${r.suggested_pct.toFixed(2)}%"`,
            `"${r.manual_pct.toFixed(2)}%"`,
            `"${fixedPctText}"`,
            `"${r.variance.toFixed(2)}%"`
        ];
        csvContent += line.join(",") + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Contribution_Master_${cType}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);

    link.click();
    document.body.removeChild(link);
}

// Toggle Quick-Fill Dropdown in header using fixed positioning to prevent clipping
function toggleManualFillDropdown(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('manual-fill-dropdown-menu');
    const btn = document.getElementById('manual-fill-header-btn');
    const wrapper = btn ? btn.parentElement : null;
    if (menu && wrapper) {
        const isHidden = menu.classList.contains('hidden');
        if (isHidden) {
            // Close Final Qty menu if open
            const otherMenu = document.getElementById('final-qty-bulk-dropdown-menu');
            if (otherMenu) otherMenu.classList.remove('show');

            menu.classList.remove('hidden');
            const rect = wrapper.getBoundingClientRect();
            menu.style.position = 'fixed';
            menu.style.top = `${rect.bottom + 4}px`;
            menu.style.left = `${rect.right - 170}px`;
            menu.style.right = 'auto';
            menu.style.width = '170px';
            menu.style.zIndex = '9999';
        } else {
            menu.classList.add('hidden');
        }
    }
}

function handleManualFillDropdownKey(e) {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleManualFillDropdown(e);
    }
}

// Global click handler to close header menu when clicking outside
document.addEventListener('click', function (e) {
    const menu = document.getElementById('manual-fill-dropdown-menu');
    const btn = document.getElementById('manual-fill-header-btn');
    const wrapper = btn ? btn.parentElement : null;
    if (menu && !menu.classList.contains('hidden')) {
        if (!menu.contains(e.target) && (!btn || !btn.contains(e.target)) && (!wrapper || !wrapper.contains(e.target))) {
            menu.classList.add('hidden');
        }
    }
});

// Auto-close overlay dropdowns on page or table container scroll
document.addEventListener('scroll', function (e) {
    const menu = document.getElementById('manual-fill-dropdown-menu');
    if (menu) menu.classList.add('hidden');
    const otherMenu = document.getElementById('final-qty-bulk-dropdown-menu');
    if (otherMenu) otherMenu.classList.remove('show');
}, true);

// Apply Quick-Fill to Manual % column from average, last year, or suggested
function applyManualQuickFill(sourceType, event) {
    if (event) event.stopPropagation();

    // Hide the dropdown menu immediately
    const menu = document.getElementById('manual-fill-dropdown-menu');
    if (menu) menu.classList.add('hidden');

    if (!planningContribData || !planningContribData.rows) return;

    let sourceLabel = '';
    let getValFn = null;

    if (sourceType === 'avg') {
        sourceLabel = 'Average Sales %';
        getValFn = (r) => r.selected_period_avg_pct;
    } else if (sourceType === 'ly') {
        sourceLabel = 'Last Year %';
        getValFn = (r) => r.last_year_same_period_pct;
    } else if (sourceType === 'suggested') {
        sourceLabel = 'Suggested %';
        getValFn = (r) => r.suggested_pct;
    } else if (sourceType === 'clear') {
        sourceLabel = 'Clear All (0.00%)';
        getValFn = (r) => 0.00;
    } else {
        return;
    }

    // Determine the target rows
    const hasSelection = selectedPlanningContribRows.size > 0;
    let targets = [];

    if (hasSelection) {
        planningContribData.rows.forEach((r, idx) => {
            const id = getPlanningContribRowId(r, idx);
            if (selectedPlanningContribRows.has(id)) {
                targets.push(r);
            }
        });
    } else {
        targets = planningContribData.rows;
    }

    if (targets.length === 0) {
        alert("No target rows found to update.");
        return;
    }

    // Prompt confirmation
    const targetDesc = hasSelection ? `${targets.length} selected row(s)` : 'all visible rows';
    const conf = confirm(`Fill Manual % for ${targetDesc} using ${sourceLabel}?`);
    if (!conf) return;

    // Push undo state before editing
    pushContribUndoState();

    // Apply changes in-memory
    targets.forEach(r => {
        const val = getValFn(r);
        r.manual_pct = val;
        r.is_manually_edited = true;
        r.variance = val - r.suggested_pct;
    });

    // Render changes
    renderPlanningContribTableBodyOnly();
}

// Dropdown check checkbox changes handler
function onContribCheckboxChange(type, val, checked) {
    if (type === 'product') {
        if (checked) selectedMasterProducts.add(val);
        else selectedMasterProducts.delete(val);
        updateSalesProductAndColorOptions();
    } else if (type === 'sales_prod') {
        if (checked) selectedSalesProducts.add(val);
        else selectedSalesProducts.delete(val);
    } else if (type === 'color') {
        if (checked) selectedMasterColors.add(val);
        else selectedMasterColors.delete(val);
    }
    refreshSelectedTags();
}

// --- NEXT QTY DERIVATION MODULE ---
// --- NEXT QTY DERIVATION MODULE (Interactive Tree Grid) ---
let derivProductsData = [];
let derivPlanQty = 0;
let collapsedProducts = new Set();
let collapsedColors = new Set();
let selectedDerivMonths = [];
let derivPlanMonthQtys = {};
let selectedDerivRow = null;
const derivMonthList = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'];

async function initializePlanningQtyDerivationTab() {
    collapsedProducts.clear();
    collapsedColors.clear();
    derivProductsData = [];
    derivPlanQty = 0;
    selectedDerivMonths = [];
    derivPlanMonthQtys = {};
    selectedDerivRow = null;

    initDerivMonthsDropdown();
    resetDerivCalculatorUI();

    const showColorChkbx = document.getElementById('deriv-show-color');
    if (showColorChkbx) showColorChkbx.checked = true;
    const showSizeChkbx = document.getElementById('deriv-show-size');
    if (showSizeChkbx) showSizeChkbx.checked = true;


    const loader = document.getElementById('planning-deriv-loader');
    if (loader) loader.classList.remove('hidden');

    try {
        const response = await fetch('/api/planning-qty-derivation/meta');
        const res = await response.json();

        if (response.ok && res.success) {
            // Populate Plan selector
            const planSelect = document.getElementById('deriv-filter-plan');
            planSelect.innerHTML = '<option value="">-- Select Plan --</option>' +
                res.plans.map(p => `<option value="${p.plan_name}|${p.financial_year}">${p.plan_name} (${p.financial_year})</option>`).join('');

            // Populate Contribution Version selector
            const contribSelect = document.getElementById('deriv-filter-contrib-version');
            contribSelect.innerHTML = res.contribution_versions.map(v => `<option value="${v}">${v}</option>`).join('');

            // Populate Brand selector
            const brandSelect = document.getElementById('deriv-filter-brand');
            brandSelect.innerHTML = '<option value="">All Brands</option>' + res.brands.map(b => `<option value="${b.brand_name}">${b.brand_name}</option>`).join('');

            // Populate Category selector
            const catSelect = document.getElementById('deriv-filter-category');
            catSelect.innerHTML = '<option value="">All Categories</option>' + res.categories.map(c => `<option value="${c}">${c}</option>`).join('');

            // Populate Product selector
            const prodSelect = document.getElementById('deriv-filter-product');
            prodSelect.innerHTML = '<option value="">All Products</option>' + res.products.map(p => `<option value="${p.product_name}">${p.product_name}</option>`).join('');

            // Render empty state
            document.getElementById('planning-deriv-tbody').innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 32px 16px;">Please select Plan and Contribution Version, then click Load Data.</td></tr>';

            // Reset summary
            resetSummaryPanel();
        } else {
            alert(res.message || "Failed to load metadata.");
        }
    } catch (err) {
        console.error(err);
        alert("Error loading derivation metadata.");
    } finally {
        if (loader) loader.classList.add('hidden');
    }
}

function resetSummaryPanel() {
    document.getElementById('deriv-kpi-total-products').textContent = '0';
    document.getElementById('deriv-kpi-completed-products').textContent = '0';
    document.getElementById('deriv-kpi-partial-products').textContent = '0';
    document.getElementById('deriv-kpi-missing-products').textContent = '0';
    document.getElementById('deriv-validation-messages').style.display = 'none';
}

function onDerivFilterChange() {
    // Reload only if Plan or Contrib Version changed
    // In our case, we can filter client-side for Brand/Category/Product, but Plan/Contrib Version require reloading
    // Let's call calculateAndRenderDerivationGrid() if Brand/Category/Product changed to filter client-side, 
    // and loadDerivationPage() if Plan/Version changed.
}

// Bind event listeners for dropdowns
document.addEventListener('change', function (e) {
    if (e.target && (e.target.id === 'deriv-filter-plan' || e.target.id === 'deriv-filter-contrib-version')) {
        loadDerivationPage();
    } else if (e.target && (e.target.id === 'deriv-filter-brand' || e.target.id === 'deriv-filter-category' || e.target.id === 'deriv-filter-product')) {
        calculateAndRenderDerivationGrid();
    }
});

async function loadDerivationPage(keepCollapseStates = false) {
    const planVal = document.getElementById('deriv-filter-plan').value;
    const contribVer = document.getElementById('deriv-filter-contrib-version').value;

    if (!contribVer) {
        alert("Contribution Version is required.");
        return;
    }

    const savedCollapsedProducts = keepCollapseStates ? new Set(collapsedProducts) : null;
    const savedCollapsedColors = keepCollapseStates ? new Set(collapsedColors) : null;

    const loader = document.getElementById('planning-deriv-loader');
    if (loader) loader.classList.remove('hidden');

    try {
        const url = `/api/planning-qty-derivation/load-data?contribution_version=${encodeURIComponent(contribVer)}&plan_id=${encodeURIComponent(planVal)}&_t=${new Date().getTime()}`;
        const response = await fetch(url);
        const res = await response.json();

        if (response.ok && res.success) {
            derivProductsData = res.products;
            derivPlanQty = res.plan_qty;
            derivPlanMonthQtys = res.month_qtys || {};

            applyDisplayOptionsToCollapseStates();
            if (keepCollapseStates) {
                collapsedProducts = savedCollapsedProducts;
                collapsedColors = savedCollapsedColors;
            }

            calculateAndRenderDerivationGrid();
        } else {
            alert(res.message || "Failed to load derivation data.");
        }
    } catch (err) {
        console.error(err);
        alert("Error fetching derivation data.");
    } finally {
        if (loader) loader.classList.add('hidden');
    }
}

function getStatusBadgeHtml(pct) {
    const val = parseFloat(pct || 0);
    if (val >= 99.99) {
        return `<span class="status-badge status-completed">COMPLETED (100%)</span>`;
    } else if (val > 0) {
        return `<span class="status-badge status-pending">PARTIAL (${val.toFixed(2)}%)</span>`;
    } else {
        return `<span class="status-badge status-missing">MISSING (0%)</span>`;
    }
}

function calculateAndRenderDerivationGrid() {
    const tbody = document.getElementById('planning-deriv-tbody');
    const brandFilter = document.getElementById('deriv-filter-brand').value;
    const categoryFilter = document.getElementById('deriv-filter-category').value;
    const productFilter = document.getElementById('deriv-filter-product').value;

    if (!derivProductsData || derivProductsData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 32px 16px;">No products loaded.</td></tr>';
        resetSummaryPanel();
        return;
    }

    // Determine displayed month columns
    const displayedMonths = selectedDerivMonths.length === 0 ? derivMonthList : selectedDerivMonths;
    const showSelectedTotal = selectedDerivMonths.length > 1;

    // Dynamic Table Headers
    let headHtml = `
        <tr>
            <th style="width: 25%;">Product / Color / Size</th>
            <th class="text-right" style="width: 10%;">Contribution %</th>
            <th class="text-right" style="width: 10%;">Total Qty</th>
    `;
    displayedMonths.forEach(m => {
        headHtml += `<th class="text-right" style="min-width: 60px;">${m.substring(0, 3)}</th>`;
    });
    if (showSelectedTotal) {
        headHtml += `<th class="text-right" style="min-width: 85px; font-weight: bold; color: var(--accent-blue);">Selected Total</th>`;
    }
    headHtml += `
            <th style="width: 15%; text-align: center;">Status</th>
        </tr>
    `;
    const thead = document.querySelector('#table-planning-deriv thead');
    if (thead) thead.innerHTML = headHtml;

    let html = '';

    // Summary metrics variables
    let totalProducts = 0;
    let completedProducts = 0;
    let partialProducts = 0;
    let missingProducts = 0;

    const validationErrors = [];

    // Calculate global product contribution sum
    const globalProductSum = (derivProductsData || []).reduce((s, p) => s + parseFloat(p.product_contribution_pct || 0), 0);
    const isGlobalProduct100 = Math.abs(globalProductSum - 100.0) < 0.01;

    if (globalProductSum > 0 && !isGlobalProduct100) {
        const diff = 100.0 - globalProductSum;
        const derivedQty = Math.round(derivPlanQty * (globalProductSum / 100.0));
        const unallocatedQty = Math.round(derivPlanQty * (diff / 100.0));
        validationErrors.push({
            type: 'Product',
            name: 'Product Contribution',
            contribution: globalProductSum,
            diff: diff,
            derivedQty: derivedQty,
            unallocatedQty: unallocatedQty
        });
    }

    // Filter and Process Products
    const filteredProducts = derivProductsData.filter(product => {
        totalProducts++;

        const colors = product.colors || [];
        const colorSum = colors.reduce((s, c) => s + parseFloat(c.contribution_pct || 0), 0);

        let allSizesCompleted = true;
        let isSizeLevelPartial = false;
        let isSizeLevelMissing = false;

        colors.forEach(col => {
            const sizes = col.sizes || [];
            const sizeSum = sizes.reduce((s, sz) => s + parseFloat(sz.contribution_pct || 0), 0);
            const isSize100 = Math.abs(sizeSum - 100.0) < 0.01;
            if (!isSize100) {
                allSizesCompleted = false;
            }
            if (sizeSum > 0 && sizeSum < 99.99) {
                isSizeLevelPartial = true;
            }
            if (sizeSum === 0) {
                isSizeLevelMissing = true;
            }
        });

        // Status Rules:
        const isProductCompleted = isGlobalProduct100 && (Math.abs(colorSum - 100.0) < 0.01) && allSizesCompleted;
        const isProductMissing = (globalProductSum === 0) || (colorSum === 0);

        if (isProductCompleted) {
            completedProducts++;
        } else if (isProductMissing) {
            missingProducts++;
        } else {
            partialProducts++;
        }

        if (brandFilter && product.brand_name !== brandFilter) return false;
        if (categoryFilter && product.product_type !== categoryFilter) return false;
        if (productFilter && product.product_name !== productFilter) return false;

        // Only prevent loading if product contribution is exactly 0%
        if (product.product_contribution_pct === 0) return false;

        return true;
    });

    document.getElementById('deriv-kpi-total-products').textContent = totalProducts;
    document.getElementById('deriv-kpi-completed-products').textContent = completedProducts;
    document.getElementById('deriv-kpi-partial-products').textContent = partialProducts;
    document.getElementById('deriv-kpi-missing-products').textContent = missingProducts;

    if (filteredProducts.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${displayedMonths.length + (showSelectedTotal ? 5 : 4)}" style="text-align: center; color: var(--text-muted); padding: 32px 16px;">No products match the selected filters.</td></tr>`;
        document.getElementById('deriv-validation-messages').style.display = 'none';
        return;
    }

    filteredProducts.forEach(product => {
        const colors = product.colors || [];
        const colorSum = colors.reduce((s, c) => s + parseFloat(c.contribution_pct || 0), 0);

        if (colorSum > 0 && Math.abs(colorSum - 100.0) >= 0.01) {
            const diff = 100.0 - colorSum;
            const pQty = Math.round(derivPlanQty * (product.product_contribution_pct / 100.0));
            const derivedQty = Math.round(pQty * (colorSum / 100.0));
            const unallocatedQty = Math.round(pQty * (diff / 100.0));
            validationErrors.push({
                type: 'Color',
                name: `Color Contribution for "${product.product_name}"`,
                contribution: colorSum,
                diff: diff,
                derivedQty: derivedQty,
                unallocatedQty: unallocatedQty
            });
        }

        const pRowData = getMonthlyQtysForRow(product);
        const isProdCollapsed = collapsedProducts.has(product.product_id);

        const prodStatusBadgeHtml = getStatusBadgeHtml(globalProductSum);

        const isSelected = selectedDerivRow &&
            selectedDerivRow.type === 'product' &&
            selectedDerivRow.productId === product.product_id;
        const selectedClass = isSelected ? 'row-selected' : '';

        let productMonthsHtml = '';
        let selectedTotalSum = 0;
        displayedMonths.forEach(m => {
            const mVal = pRowData.months[m] || 0;
            productMonthsHtml += `<td class="text-right" style="color: var(--text-secondary);">${mVal.toLocaleString()}</td>`;
            selectedTotalSum += mVal;
        });
        if (showSelectedTotal) {
            productMonthsHtml += `<td class="text-right" style="font-weight: bold; color: var(--accent-blue);">${selectedTotalSum.toLocaleString()}</td>`;
        }

        html += `
            <tr class="tree-row row-product ${selectedClass}" onclick="selectDerivRow(this, 'product', ${product.product_id}, '', null)" style="cursor: pointer;">
                <td>
                    <i class="fa-solid fa-chevron-down toggle-icon ${isProdCollapsed ? 'collapsed' : ''}" onclick="event.stopPropagation(); toggleProductRow(${product.product_id})"></i>
                    <i class="fa-solid fa-shirt" style="margin-right:6px; color:var(--accent-blue);"></i>
                    <span class="contrib-hyperlink" onclick="openAIContribModal('Product', ${product.product_id}, null, null, event)" title="Click to Fix Product Contribution">${product.product_name}</span>
                </td>
                <td class="text-right" onclick="event.stopPropagation()">
                    <input type="number" class="tree-grid-input text-right" style="width: 80px;" value="${product.product_contribution_pct.toFixed(2)}" step="0.01" min="0" max="100" onchange="onProductPctChange(${product.product_id}, this.value)">
                </td>
                <td class="text-right" onclick="event.stopPropagation()">
                    <input type="number" class="tree-grid-input text-right" style="width: 100px;" value="${Math.round(pRowData.total)}" ${derivPlanQty > 0 ? '' : 'disabled'} onchange="onProductQtyChange(${product.product_id}, this.value)">
                </td>
                ${productMonthsHtml}
                <td style="text-align:center;">
                    ${prodStatusBadgeHtml}
                </td>
            </tr>
        `;

        if (isProdCollapsed) return;

        colors.forEach(col => {
            const sizes = col.sizes || [];
            const sizeSum = sizes.reduce((s, sz) => s + parseFloat(sz.contribution_pct || 0), 0);

            if (sizeSum > 0 && Math.abs(sizeSum - 100.0) >= 0.01) {
                const diff = 100.0 - sizeSum;
                const pQty = Math.round(derivPlanQty * (product.product_contribution_pct / 100.0));
                const colQty = Math.round(pQty * (col.contribution_pct / 100.0));
                const derivedQty = Math.round(colQty * (sizeSum / 100.0));
                const unallocatedQty = Math.round(colQty * (diff / 100.0));
                validationErrors.push({
                    type: 'Size',
                    name: `Size Contribution for "${product.product_name}" - "${col.color_name}"`,
                    contribution: sizeSum,
                    diff: diff,
                    derivedQty: derivedQty,
                    unallocatedQty: unallocatedQty
                });
            }

            const colRowData = getMonthlyQtysForRow(product, col);
            const isColCollapsed = collapsedColors.has(`${product.product_id}|${col.color_code}`);

            const colStatusBadgeHtml = getStatusBadgeHtml(colorSum);

            const isColSelected = selectedDerivRow &&
                selectedDerivRow.type === 'color' &&
                selectedDerivRow.productId === product.product_id &&
                selectedDerivRow.colorCode === col.color_code;
            const colSelectedClass = isColSelected ? 'row-selected' : '';

            let colorMonthsHtml = '';
            let colSelectedTotalSum = 0;
            displayedMonths.forEach(m => {
                const mVal = colRowData.months[m] || 0;
                colorMonthsHtml += `<td class="text-right" style="color: var(--text-secondary);">${mVal.toLocaleString()}</td>`;
                colSelectedTotalSum += mVal;
            });
            if (showSelectedTotal) {
                colorMonthsHtml += `<td class="text-right" style="font-weight: bold; color: var(--accent-blue);">${colSelectedTotalSum.toLocaleString()}</td>`;
            }

            html += `
                <tr class="tree-row row-color ${colSelectedClass}" onclick="selectDerivRow(this, 'color', ${product.product_id}, '${col.color_code}', null)" style="cursor: pointer;">
                    <td class="indent-color">
                        <i class="fa-solid fa-chevron-down toggle-icon ${isColCollapsed ? 'collapsed' : ''}" onclick="event.stopPropagation(); toggleColorRow(${product.product_id}, '${col.color_code}')"></i>
                        <i class="fa-solid fa-palette" style="margin-right:6px; color:#ffb703;"></i>
                        <span class="contrib-hyperlink" onclick="openAIContribModal('Color', ${product.product_id}, '${col.color_code}', null, event)" title="Click to Fix Color Contribution">${col.color_name}</span>
                    </td>
                    <td class="text-right" onclick="event.stopPropagation()">
                        <input type="number" class="tree-grid-input text-right" style="width: 80px;" value="${col.contribution_pct.toFixed(2)}" step="0.01" min="0" max="100" onchange="onColorPctChange(${product.product_id}, '${col.color_code}', this.value)">
                    </td>
                    <td class="text-right" style="font-weight:bold; color:#ffb703;">${Math.round(colRowData.total).toLocaleString()}</td>
                    ${colorMonthsHtml}
                    <td style="text-align:center;">
                        ${colStatusBadgeHtml}
                    </td>
                </tr>
            `;

            if (isColCollapsed) return;

            sizes.forEach(sz => {
                const szRowData = getMonthlyQtysForRow(product, col, sz);

                const szStatusBadgeHtml = getStatusBadgeHtml(sizeSum);

                const isSzSelected = selectedDerivRow &&
                    selectedDerivRow.type === 'size' &&
                    selectedDerivRow.productId === product.product_id &&
                    selectedDerivRow.colorCode === col.color_code &&
                    selectedDerivRow.sizeId === sz.size_id;
                const szSelectedClass = isSzSelected ? 'row-selected' : '';

                let sizeMonthsHtml = '';
                let szSelectedTotalSum = 0;
                displayedMonths.forEach(m => {
                    const mVal = szRowData.months[m] || 0;
                    sizeMonthsHtml += `<td class="text-right" style="color: var(--text-secondary);">${mVal.toLocaleString()}</td>`;
                    szSelectedTotalSum += mVal;
                });
                if (showSelectedTotal) {
                    sizeMonthsHtml += `<td class="text-right" style="font-weight: bold; color: var(--accent-blue);">${szSelectedTotalSum.toLocaleString()}</td>`;
                }

                html += `
                    <tr class="tree-row row-size ${szSelectedClass}" onclick="selectDerivRow(this, 'size', ${product.product_id}, '${col.color_code}', ${sz.size_id})" style="cursor: pointer;">
                        <td class="indent-size">
                            <i class="fa-solid fa-ruler-horizontal" style="margin-right:6px; color:var(--text-muted); font-size:12px;"></i>
                            <span class="contrib-hyperlink" onclick="openAIContribModal('Size', ${product.product_id}, '${col.color_code}', ${sz.size_id}, event)" title="Click to Fix Size Contribution">${sz.size_name}</span>
                        </td>
                        <td class="text-right" onclick="event.stopPropagation()">
                            <input type="number" class="tree-grid-input text-right" style="width: 80px;" value="${sz.contribution_pct.toFixed(2)}" step="0.01" min="0" max="100" onchange="onSizePctChange(${product.product_id}, '${col.color_code}', ${sz.size_id}, this.value)">
                        </td>
                        <td class="text-right" style="font-weight:bold; color:var(--text-secondary);">${Math.round(szRowData.total).toLocaleString()}</td>
                        ${sizeMonthsHtml}
                        <td style="text-align:center;">
                            ${szStatusBadgeHtml}
                        </td>
                    </tr>
                `;
            });
        });
    });

    tbody.innerHTML = html;
    renderValidationAlerts(validationErrors);
}

function renderValidationAlerts(errors) {
    const container = document.getElementById('deriv-validation-messages');
    if (container) {
        container.style.display = 'none';
    }
}

// Tree toggle functions
function toggleProductRow(prodId) {
    if (collapsedProducts.has(prodId)) {
        collapsedProducts.delete(prodId);
    } else {
        collapsedProducts.add(prodId);
    }
    calculateAndRenderDerivationGrid();
}

function toggleColorRow(prodId, colorCode) {
    const key = `${prodId}|${colorCode}`;
    if (collapsedColors.has(key)) {
        collapsedColors.delete(key);
    } else {
        collapsedColors.add(key);
    }
    calculateAndRenderDerivationGrid();
}

// Inline edit handlers
function onProductPctChange(prodId, val) {
    const pct = parseFloat(val);
    if (isNaN(pct) || pct < 0 || pct > 100) return;
    const p = derivProductsData.find(x => x.product_id === prodId);
    if (p) {
        p.product_contribution_pct = pct;
        calculateAndRenderDerivationGrid();
    }
}

function onProductQtyChange(prodId, val) {
    const qty = parseInt(val);
    if (isNaN(qty) || qty < 0 || derivPlanQty <= 0) return;
    const p = derivProductsData.find(x => x.product_id === prodId);
    if (p) {
        p.product_contribution_pct = (qty / derivPlanQty) * 100.0;
        calculateAndRenderDerivationGrid();
    }
}

function onColorPctChange(prodId, colorCode, val) {
    const pct = parseFloat(val);
    if (isNaN(pct) || pct < 0 || pct > 100) return;
    const p = derivProductsData.find(x => x.product_id === prodId);
    if (p) {
        const col = p.colors.find(c => c.color_code === colorCode);
        if (col) {
            col.contribution_pct = pct;
            calculateAndRenderDerivationGrid();
        }
    }
}

function onSizePctChange(prodId, colorCode, sizeId, val) {
    const pct = parseFloat(val);
    if (isNaN(pct) || pct < 0 || pct > 100) return;
    const p = derivProductsData.find(x => x.product_id === prodId);
    if (p) {
        const col = p.colors.find(c => c.color_code === colorCode);
        if (col) {
            const sz = col.sizes.find(s => s.size_id === sizeId);
            if (sz) {
                sz.contribution_pct = pct;
                calculateAndRenderDerivationGrid();
            }
        }
    }
}

// Save overrides
async function saveDerivationOverrides() {
    const contribVer = document.getElementById('deriv-filter-contrib-version').value;
    if (!contribVer) {
        alert("Contribution Version is required to save.");
        return;
    }

    const loader = document.getElementById('planning-deriv-loader');
    if (loader) loader.classList.remove('hidden');

    // Collect and sanitize contributions
    const product_contribs = [];
    const color_contribs = [];
    const size_contribs = [];

    const parseNumberOrZero = (v) => {
        if (v === null || v === undefined || v === '') return 0.0;
        const num = parseFloat(v);
        return (!isNaN(num) && isFinite(num)) ? num : 0.0;
    };

    derivProductsData.forEach(p => {
        if (!p || p.product_id === undefined || p.product_id === null) return;
        product_contribs.push({
            product_id: p.product_id,
            manual_pct: parseNumberOrZero(p.product_contribution_pct)
        });

        (p.colors || []).forEach(c => {
            if (!c || !c.color_code) return;
            color_contribs.push({
                product_id: p.product_id,
                color_code: c.color_code,
                manual_pct: parseNumberOrZero(c.contribution_pct)
            });

            (c.sizes || []).forEach(s => {
                if (!s) return;
                size_contribs.push({
                    product_id: p.product_id,
                    color_code: c.color_code,
                    size_id: s.size_id !== undefined ? s.size_id : null,
                    manual_pct: parseNumberOrZero(s.contribution_pct)
                });
            });
        });
    });

    try {
        const response = await fetch('/api/planning-qty-derivation/save-contributions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                version: contribVer,
                product_contributions: product_contribs,
                color_contributions: color_contribs,
                size_contributions: size_contribs,
                size_contribs: size_contribs
            })
        });

        let res = null;
        try {
            res = await response.json();
        } catch (jsonErr) {
            console.warn("Response is not JSON:", jsonErr);
        }

        if (!response.ok) {
            let errorMsg = (res && res.message) ? res.message : `Server error (${response.status})`;
            if (response.status === 401) errorMsg = "Session expired. Please log in again.";
            else if (response.status === 403) errorMsg = "Permission denied.";

            if (typeof showToast !== 'undefined') {
                showToast('Error', errorMsg, 'error');
            } else {
                alert(errorMsg);
            }
            return;
        }

        if (res && res.success) {
            // Automatically trigger quantity derivation generation
            const planVal = document.getElementById('deriv-filter-plan').value;
            let planName = '';
            let finYear = '';
            if (planVal && planVal.includes('|')) {
                const parts = planVal.split('|');
                planName = parts[0].trim();
                finYear = parts[1].trim();
            }

            if (planName && finYear) {
                const genRes = await fetch('/api/planning-qty-derivation/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        plan_name: planName,
                        financial_year: finYear,
                        contribution_version: contribVer,
                        derivation_version: 'v1',
                        overwrite: true
                    })
                });

                let genData = null;
                try {
                    genData = await genRes.json();
                } catch (e) {
                    console.warn("Gen response is not JSON:", e);
                }

                if (genRes.ok && genData && genData.success) {
                    if (typeof showToast !== 'undefined') {
                        showToast('Success', "Quantity derivation saved and generated successfully!", 'success');
                    } else {
                        alert("Quantity derivation saved and generated successfully!");
                    }
                    loadDerivationPage();
                } else {
                    const failMsg = (genData && genData.message) ? genData.message : `Generation failed (${genRes.status})`;
                    if (typeof showToast !== 'undefined') {
                        showToast('Warning', "Contributions saved, but generation failed: " + failMsg, 'warning');
                    } else {
                        alert("Contributions saved, but generation failed: " + failMsg);
                    }
                }
            } else {
                if (typeof showToast !== 'undefined') {
                    showToast('Success', "Quantity derivation contributions saved successfully.", 'success');
                } else {
                    alert("Quantity derivation contributions saved successfully.");
                }
                loadDerivationPage();
            }
        } else {
            const errText = (res && res.message) ? res.message : "Failed to save contributions.";
            if (typeof showToast !== 'undefined') {
                showToast('Error', errText, 'error');
            } else {
                alert(errText);
            }
        }
    } catch (err) {
        console.error("Save contributions error:", err);
        const netErr = err && err.message ? err.message : "Network error saving contributions.";
        if (typeof showToast !== 'undefined') {
            showToast('Error', netErr, 'error');
        } else {
            alert(netErr);
        }
    } finally {
        if (loader) loader.classList.add('hidden');
    }
}

// Export Excel using SheetJS (XLSX)
function exportDerivationCSV() {
    const planVal = document.getElementById('deriv-filter-plan').value;
    const contribVer = document.getElementById('deriv-filter-contrib-version').value;

    if (!planVal || !contribVer) {
        alert("Plan Name and Contribution Version are required.");
        return;
    }

    const [planName, financialYear] = planVal.split('|');

    const brand = document.getElementById('deriv-filter-brand').value;
    const category = document.getElementById('deriv-filter-category').value;
    const product = document.getElementById('deriv-filter-product').value;

    const showColor = document.getElementById('deriv-show-color') ? document.getElementById('deriv-show-color').checked : true;
    const showSize = document.getElementById('deriv-show-size') ? document.getElementById('deriv-show-size').checked : true;

    // Build list of all rows in the tree following hierarchy
    const rows = [];

    let startYear = new Date().getFullYear();
    if (financialYear && financialYear.startsWith('FY ')) {
        const yrParts = financialYear.substring(3).split('-');
        if (yrParts[0]) {
            const parsed = parseInt(yrParts[0]);
            if (!isNaN(parsed)) startYear = parsed;
        }
    }
    const monthRanges = getMonthDateRanges(startYear);

    // Period calculation date range if selected
    const fromStr = document.getElementById('deriv-calc-from-date').value;
    const toStr = document.getElementById('deriv-calc-to-date').value;
    let userFrom = null;
    let userTo = null;
    if (fromStr && toStr) {
        userFrom = new Date(fromStr);
        userFrom.setHours(0, 0, 0, 0);
        userTo = new Date(toStr);
        userTo.setHours(0, 0, 0, 0);
    }

    // Let's filter products using the active grid filters
    const filteredProducts = (derivProductsData || []).filter(p => {
        const colors = p.colors || [];
        const colorSum = colors.reduce((s, c) => s + parseFloat(c.contribution_pct || 0), 0);
        const colorConfigured = p.has_contributions || colorSum > 0;

        if (brand && p.brand_name !== brand) return false;
        if (category && p.product_type !== category) return false;
        if (product && p.product_name !== product) return false;
        if (!colorConfigured) return false;
        return true;
    });

    filteredProducts.forEach(p => {
        // Add Product Row
        const pData = getMonthlyQtysForRow(p);
        addRowData('Product', p.product_name, p.product_contribution_pct, pData);

        if (!showColor) return;

        p.colors.forEach(col => {
            // Add Color Row
            const colData = getMonthlyQtysForRow(p, col);
            addRowData('Color', `${p.product_name} - ${col.color_name}`, col.contribution_pct, colData);

            if (!showSize) return;

            col.sizes.forEach(sz => {
                // Add Size Row
                const szData = getMonthlyQtysForRow(p, col, sz);
                addRowData('Size', `${p.product_name} - ${col.color_name} - ${sz.size_name}`, sz.contribution_pct, szData);
            });
        });
    });

    function addRowData(type, name, contribPct, data) {
        const row = {
            'Hierarchy Level': type,
            'Product / Color / Size': name,
            'Contribution %': contribPct.toFixed(2) + '%',
            'Overall Total Qty': data.total
        };

        // Month columns Qty and Per Day Qty
        derivMonthList.forEach(m => {
            const mQty = data.months[m] || 0;
            const daysInMonth = monthRanges.find(mr => mr.name === m).days;
            const perDayRate = daysInMonth > 0 ? (mQty / daysInMonth) : 0;

            row[`${m} Qty`] = mQty;
            row[`${m} Per Day`] = parseFloat(perDayRate.toFixed(4));
        });

        // Period wise calculation columns
        if (userFrom && userTo && userFrom <= userTo) {
            row['Selected Period'] = `${formatDateShort(userFrom)} to ${formatDateShort(userTo)}`;

            let totalPeriodQty = 0;
            let calcBreakdown = [];

            monthRanges.forEach(mr => {
                const mStart = new Date(mr.start);
                mStart.setHours(0, 0, 0, 0);
                const mEnd = new Date(mr.end);
                mEnd.setHours(0, 0, 0, 0);

                const overlapStart = userFrom > mStart ? userFrom : mStart;
                const overlapEnd = userTo < mEnd ? userTo : mEnd;

                let usedDays = 0;
                if (overlapStart <= overlapEnd) {
                    usedDays = Math.round((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)) + 1;
                }

                if (usedDays > 0) {
                    const mQty = data.months[mr.name] || 0;
                    const perDayQty = mr.days > 0 ? (mQty / mr.days) : 0;
                    const usedQty = Math.round(usedDays * perDayQty);
                    totalPeriodQty += usedQty;
                    calcBreakdown.push(`${mr.name}: ${usedDays} days * ${perDayQty.toFixed(2)} = ${usedQty}`);
                }
            });

            row['Calculation Breakdown'] = calcBreakdown.join('; ');
            row['Final Period Qty'] = totalPeriodQty;
        } else {
            row['Selected Period'] = 'N/A';
            row['Calculation Breakdown'] = 'N/A';
            row['Final Period Qty'] = 'N/A';
        }

        rows.push(row);
    }

    // Generate spreadsheet workbook
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Qty Derivation Report");

    // Trigger download
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `qty_derivation_${planName.replace(/\s+/g, '_').toLowerCase()}_${timestamp}.xlsx`;
    XLSX.writeFile(workbook, filename);
}

function applyDisplayOptionsToCollapseStates() {
    const showColor = document.getElementById('deriv-show-color') ? document.getElementById('deriv-show-color').checked : true;
    const showSize = document.getElementById('deriv-show-size') ? document.getElementById('deriv-show-size').checked : true;

    collapsedProducts.clear();
    if (!showColor && derivProductsData) {
        derivProductsData.forEach(p => {
            collapsedProducts.add(p.product_id);
        });
    }

    collapsedColors.clear();
    if (!showSize && derivProductsData) {
        derivProductsData.forEach(p => {
            if (p.colors) {
                p.colors.forEach(c => {
                    collapsedColors.add(`${p.product_id}|${c.color_code}`);
                });
            }
        });
    }
}

// Display Options handler
function handleDisplayOptionsChange(optionType) {
    const showColor = document.getElementById('deriv-show-color') ? document.getElementById('deriv-show-color').checked : true;
    const showSize = document.getElementById('deriv-show-size') ? document.getElementById('deriv-show-size').checked : true;

    if (optionType === 'color') {
        if (!showColor) {
            // Collapse all products
            collapsedProducts.clear();
            if (derivProductsData) {
                derivProductsData.forEach(p => {
                    collapsedProducts.add(p.product_id);
                });
            }
        } else {
            // Expand all products
            collapsedProducts.clear();
        }
    } else if (optionType === 'size') {
        if (!showSize) {
            // Collapse all colors
            collapsedColors.clear();
            if (derivProductsData) {
                derivProductsData.forEach(p => {
                    if (p.colors) {
                        p.colors.forEach(c => {
                            collapsedColors.add(`${p.product_id}|${c.color_code}`);
                        });
                    }
                });
            }
        } else {
            // Expand all colors
            collapsedColors.clear();
        }
    }

    calculateAndRenderDerivationGrid();
}

// MONTH FILTER MULTISELECT & GENERAL CALCULATOR HELPERS
function initDerivMonthsDropdown() {
    const container = document.getElementById('deriv-months-options-container');
    if (!container) return;
    container.innerHTML = '';

    derivMonthList.forEach(m => {
        const option = document.createElement('div');
        option.className = 'multiselect-option';
        option.style.display = 'flex';
        option.style.alignItems = 'center';
        option.style.gap = '8px';
        option.style.cursor = 'pointer';
        option.style.padding = '6px';
        option.onclick = (e) => {
            e.stopPropagation();
            const chk = option.querySelector('input');
            chk.checked = !chk.checked;
            toggleDerivMonth(m, chk.checked);
        };

        option.innerHTML = `
            <input type="checkbox" value="${m}" style="cursor: pointer;" onclick="event.stopPropagation(); toggleDerivMonth('${m}', this.checked)">
            <span style="color: var(--text-primary); font-size: 13.0px;">${m}</span>
        `;
        container.appendChild(option);
    });

    updateDerivMonthsTrigger();
}

function toggleDerivMonth(month, checked) {
    if (checked) {
        if (!selectedDerivMonths.includes(month)) {
            selectedDerivMonths.push(month);
        }
    } else {
        selectedDerivMonths = selectedDerivMonths.filter(m => m !== month);
    }

    selectedDerivMonths.sort((a, b) => derivMonthList.indexOf(a) - derivMonthList.indexOf(b));
    updateDerivMonthsTrigger();
    calculateAndRenderDerivationGrid();
}

function updateDerivMonthsTrigger() {
    const trigger = document.getElementById('deriv-selected-months-container');
    if (!trigger) return;

    if (selectedDerivMonths.length === 0) {
        trigger.innerHTML = '<span class="placeholder">All Months</span>';
    } else {
        const displayMonths = selectedDerivMonths.map(m => m.substring(0, 3));
        trigger.innerHTML = `<span style="font-size: 12px; font-weight: 600; color: var(--accent-blue);">${displayMonths.join(', ')}</span>`;
    }

    derivMonthList.forEach(m => {
        const chk = document.querySelector(`#deriv-months-options-container input[value="${m}"]`);
        if (chk) {
            chk.checked = selectedDerivMonths.includes(m);
        }
    });
}

function toggleDerivMonthsDropdown(event) {
    event.stopPropagation();
    const dropdown = document.getElementById('deriv-months-dropdown');
    if (dropdown) {
        dropdown.classList.toggle('hidden');
    }

    // Close other dropdowns
    const multiselectColor = document.getElementById('fabric-colors-dropdown-list');
    if (multiselectColor) multiselectColor.classList.add('hidden');
    const multiselectDia = document.getElementById('fabric-dias-dropdown-list');
    if (multiselectDia) multiselectDia.classList.add('hidden');
}

function resetDerivCalculatorUI() {
    const label = document.getElementById('deriv-selected-row-label');
    if (label) label.textContent = 'Target: Select a row in the table below to calculate';
    const fromDate = document.getElementById('deriv-calc-from-date');
    if (fromDate) fromDate.value = '';
    const toDate = document.getElementById('deriv-calc-to-date');
    if (toDate) toDate.value = '';
    const result = document.getElementById('deriv-calc-result-panel');
    if (result) result.innerHTML = 'Calculation summary will be shown here...';
    const viewBtn = document.getElementById('btn-view-deriv-per-day');
    if (viewBtn) viewBtn.disabled = true;
}

function selectDerivRow(element, type, productId, colorCode, sizeId) {
    document.querySelectorAll('#table-planning-deriv tr').forEach(tr => {
        tr.classList.remove('row-selected');
    });

    element.classList.add('row-selected');

    const product = derivProductsData.find(p => p.product_id === productId);
    let labelText = '';
    let rowData = null;

    if (product) {
        if (type === 'product') {
            labelText = `Target: ${product.product_name}`;
            rowData = getMonthlyQtysForRow(product);
        } else if (type === 'color') {
            const col = product.colors.find(c => c.color_code === colorCode);
            labelText = `Target: ${product.product_name} - ${col ? col.color_name : colorCode}`;
            rowData = getMonthlyQtysForRow(product, col);
        } else if (type === 'size') {
            const col = product.colors.find(c => c.color_code === colorCode);
            const sz = col ? col.sizes.find(s => s.size_id === sizeId) : null;
            labelText = `Target: ${product.product_name} - ${col ? col.color_name : colorCode} - ${sz ? sz.size_name : sizeId}`;
            rowData = getMonthlyQtysForRow(product, col, sz);
        }
    }

    selectedDerivRow = {
        type: type,
        productId: productId,
        colorCode: colorCode,
        sizeId: sizeId,
        labelText: labelText,
        rowData: rowData
    };

    const labelEl = document.getElementById('deriv-selected-row-label');
    if (labelEl) labelEl.textContent = labelText;

    const viewBtn = document.getElementById('btn-view-deriv-per-day');
    if (viewBtn) viewBtn.disabled = false;

    const fromDate = document.getElementById('deriv-calc-from-date').value;
    const toDate = document.getElementById('deriv-calc-to-date').value;
    if (fromDate && toDate) {
        calculatePeriodWiseQty();
    }
}

function getMonthlyQtysForRow(product, col = null, sz = null) {
    const qtys = {};
    let sum = 0;

    derivMonthList.forEach(m => {
        const mPlanQty = derivPlanMonthQtys[m] || 0;

        // 1. Product Qty for month m
        const pPct = product.product_contribution_pct || 0;
        const pQtyM = pPct > 0 ? Math.round(mPlanQty * (pPct / 100.0)) : 0;

        if (!col) {
            // Product level
            qtys[m] = pQtyM;
            sum += pQtyM;
        } else {
            // 2. Color Qty for month m
            const colPct = col.contribution_pct || 0;
            const colQtyM = colPct > 0 ? Math.round(pQtyM * (colPct / 100.0)) : 0;

            if (!sz) {
                // Color level
                qtys[m] = colQtyM;
                sum += colQtyM;
            } else {
                // 3. Size level
                const szPct = sz.contribution_pct || 0;
                const szQtyM = szPct > 0 ? Math.round(colQtyM * (szPct / 100.0)) : 0;
                qtys[m] = szQtyM;
                sum += szQtyM;
            }
        }
    });

    return {
        total: sum,
        months: qtys
    };
}

function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

function getMonthDateRanges(startYear) {
    const isNextLeap = isLeapYear(startYear + 1);

    return [
        { name: 'April', start: new Date(startYear, 3, 1), end: new Date(startYear, 3, 30), days: 30 },
        { name: 'May', start: new Date(startYear, 4, 1), end: new Date(startYear, 4, 31), days: 31 },
        { name: 'June', start: new Date(startYear, 5, 1), end: new Date(startYear, 5, 30), days: 30 },
        { name: 'July', start: new Date(startYear, 6, 1), end: new Date(startYear, 6, 31), days: 31 },
        { name: 'August', start: new Date(startYear, 7, 1), end: new Date(startYear, 7, 31), days: 31 },
        { name: 'September', start: new Date(startYear, 8, 1), end: new Date(startYear, 8, 30), days: 30 },
        { name: 'October', start: new Date(startYear, 9, 1), end: new Date(startYear, 9, 31), days: 31 },
        { name: 'November', start: new Date(startYear, 10, 1), end: new Date(startYear, 10, 30), days: 30 },
        { name: 'December', start: new Date(startYear, 11, 1), end: new Date(startYear, 11, 31), days: 31 },
        { name: 'January', start: new Date(startYear + 1, 0, 1), end: new Date(startYear + 1, 0, 31), days: 31 },
        { name: 'February', start: new Date(startYear + 1, 1, 1), end: new Date(startYear + 1, 1, isNextLeap ? 29 : 28), days: isNextLeap ? 29 : 28 },
        { name: 'March', start: new Date(startYear + 1, 2, 1), end: new Date(startYear + 1, 2, 31), days: 31 }
    ];
}

function calculatePeriodWiseQty() {
    if (!selectedDerivRow) {
        alert("Please select a row in the table first.");
        return;
    }

    const fromStr = document.getElementById('deriv-calc-from-date').value;
    const toStr = document.getElementById('deriv-calc-to-date').value;

    if (!fromStr || !toStr) {
        alert("Please select both From Date and To Date.");
        return;
    }

    const userFrom = new Date(fromStr);
    userFrom.setHours(0, 0, 0, 0);
    const userTo = new Date(toStr);
    userTo.setHours(0, 0, 0, 0);

    if (userFrom > userTo) {
        alert("From Date cannot be after To Date.");
        return;
    }

    let startYear = new Date().getFullYear();
    const planSelect = document.getElementById('deriv-filter-plan');
    if (planSelect && planSelect.value) {
        const parts = planSelect.value.split('|');
        if (parts[1] && parts[1].startsWith('FY ')) {
            const yrParts = parts[1].substring(3).split('-');
            if (yrParts[0]) {
                const parsed = parseInt(yrParts[0]);
                if (!isNaN(parsed)) startYear = parsed;
            }
        }
    }

    const monthRanges = getMonthDateRanges(startYear);
    const rowMonths = selectedDerivRow.rowData.months;

    let totalPeriodQty = 0;
    let summaryHtml = '';

    summaryHtml += `Selected Period: ${formatDateShort(userFrom)} to ${formatDateShort(userTo)}\n`;
    summaryHtml += `----------------------------------------------------\n`;

    monthRanges.forEach(mr => {
        const mStart = new Date(mr.start);
        mStart.setHours(0, 0, 0, 0);
        const mEnd = new Date(mr.end);
        mEnd.setHours(0, 0, 0, 0);

        const overlapStart = userFrom > mStart ? userFrom : mStart;
        const overlapEnd = userTo < mEnd ? userTo : mEnd;

        let usedDays = 0;
        if (overlapStart <= overlapEnd) {
            usedDays = Math.round((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)) + 1;
        }

        if (usedDays > 0) {
            const monthQty = rowMonths[mr.name] || 0;
            const perDayQty = mr.days > 0 ? (monthQty / mr.days) : 0;
            const usedQty = Math.round(usedDays * perDayQty);

            totalPeriodQty += usedQty;

            summaryHtml += `${mr.name}:\n`;
            summaryHtml += `  Qty = ${monthQty}\n`;
            summaryHtml += `  Days = ${mr.days}\n`;
            summaryHtml += `  Per Day = ${perDayQty.toFixed(4)}\n`;
            summaryHtml += `  Used Days = ${usedDays}\n`;
            summaryHtml += `  Qty Used = ${usedQty}\n`;
            summaryHtml += `----------------------------------------------------\n`;
        }
    });

    summaryHtml += `TOTAL: ${totalPeriodQty} Qty\n`;
    summaryHtml += `----------------------------------------------------\n`;

    const resultPanel = document.getElementById('deriv-calc-result-panel');
    if (resultPanel) {
        resultPanel.innerHTML = `<pre style="margin:0; font-family:inherit; color:inherit; white-space:pre-wrap;">${summaryHtml}</pre>`;
    }
}

function formatDateShort(dateObj) {
    const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${dateObj.getDate()}-${monthsShort[dateObj.getMonth()]}`;
}

function openDerivPerDayModal() {
    if (!selectedDerivRow) return;

    const titleEl = document.getElementById('deriv-per-day-modal-title');
    if (titleEl) titleEl.textContent = selectedDerivRow.labelText;

    let startYear = new Date().getFullYear();
    const planSelect = document.getElementById('deriv-filter-plan');
    if (planSelect && planSelect.value) {
        const parts = planSelect.value.split('|');
        if (parts[1] && parts[1].startsWith('FY ')) {
            const yrParts = parts[1].substring(3).split('-');
            if (yrParts[0]) {
                const parsed = parseInt(yrParts[0]);
                if (!isNaN(parsed)) startYear = parsed;
            }
        }
    }

    const monthRanges = getMonthDateRanges(startYear);
    const rowMonths = selectedDerivRow.rowData.months;
    const tbody = document.getElementById('deriv-per-day-modal-tbody');
    if (tbody) {
        tbody.innerHTML = '';
        monthRanges.forEach(mr => {
            const monthQty = rowMonths[mr.name] || 0;
            const perDayQty = mr.days > 0 ? (monthQty / mr.days) : 0;

            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid rgba(255,255,255,0.03)';
            tr.innerHTML = `
                <td style="padding: 8px; text-align: left; color: var(--text-primary);">${mr.name}</td>
                <td style="padding: 8px; text-align: right; color: var(--text-primary);">${mr.days}</td>
                <td style="padding: 8px; text-align: right; color: var(--text-primary);">${monthQty.toLocaleString()}</td>
                <td style="padding: 8px; text-align: right; font-weight: 600; color: var(--accent-blue);">${perDayQty.toFixed(4)}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    document.getElementById('deriv-per-day-modal').classList.remove('hidden');
}

function closeDerivPerDayModal() {
    document.getElementById('deriv-per-day-modal').classList.add('hidden');
}

// ==========================================================================
// AI PLANNING ASSISTANT CLIENT INTEGRATION
// ==========================================================================

let aiAssistantState = {
    isChatOpen: false,
    apiKey: '',
    model: 'google/gemini-2.5-flash',
    hasServerKey: false
};

// Initialize AI Assistant
async function initAIAssistant() {
    // 1. Load settings from localStorage
    aiAssistantState.apiKey = localStorage.getItem('openrouter_api_key') || '';
    aiAssistantState.model = localStorage.getItem('openrouter_model') || 'google/gemini-2.5-flash';

    // 2. Populate inputs
    const keyInput = document.getElementById('ai-api-key');
    const modelSelect = document.getElementById('ai-model-select');

    if (keyInput) keyInput.value = aiAssistantState.apiKey;
    if (modelSelect) modelSelect.value = aiAssistantState.model;

    // 3. Check if server-side key exists
    try {
        const response = await fetch('/api/ai/check-key');
        const data = await response.json();
        if (data.success && data.has_key) {
            aiAssistantState.hasServerKey = true;
        }
    } catch (e) {
        console.error("Error checking server AI key configuration:", e);
    }

    // 4. Update status display
    updateAIStatusDisplay();
}

function updateAIStatusDisplay() {
    const statusText = document.getElementById('ai-status-text');
    const pulseDot = document.querySelector('.ai-pulse-dot');

    if (aiAssistantState.apiKey || aiAssistantState.hasServerKey) {
        if (statusText) statusText.textContent = "AI Active";
        if (statusText) statusText.style.color = "var(--accent-green)";
        if (pulseDot) pulseDot.style.backgroundColor = "var(--accent-green)";
    } else {
        if (statusText) statusText.textContent = "Setup API Key";
        if (statusText) statusText.style.color = "var(--accent-orange)";
        if (pulseDot) pulseDot.style.backgroundColor = "var(--accent-orange)";
    }
}

// Toggle Chat View
function toggleAIChat() {
    const container = document.getElementById('ai-chat-container');
    const inputField = document.getElementById('ai-chat-input');

    aiAssistantState.isChatOpen = !aiAssistantState.isChatOpen;

    if (aiAssistantState.isChatOpen) {
        container.classList.remove('hidden');
        if (inputField) inputField.focus();
        scrollToBottomAI();
        // Hide pulse dot after opening first time
        const pulseDot = document.querySelector('.ai-pulse-dot');
        if (pulseDot) pulseDot.style.display = 'none';
    } else {
        container.classList.add('hidden');
    }
}

// Toggle Settings Card
function toggleAISettings() {
    const settingsPanel = document.getElementById('ai-settings-panel');
    settingsPanel.classList.toggle('hidden');
}

// Save Settings
function saveAISettings() {
    const keyInput = document.getElementById('ai-api-key');
    const modelSelect = document.getElementById('ai-model-select');

    if (keyInput) {
        aiAssistantState.apiKey = keyInput.value.trim();
        localStorage.setItem('openrouter_api_key', aiAssistantState.apiKey);
    }
    if (modelSelect) {
        aiAssistantState.model = modelSelect.value;
        localStorage.setItem('openrouter_model', aiAssistantState.model);
    }

    toggleAISettings();
    updateAIStatusDisplay();

    appendSystemMessage("Settings saved successfully.");
}

// Scroll Messages to Bottom
function scrollToBottomAI() {
    const chatBody = document.getElementById('ai-chat-messages');
    if (chatBody) {
        chatBody.scrollTop = chatBody.scrollHeight;
    }
}

// Handle Enter to send
function handleAIInputKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendAIMessage();
    }
}

// Append System notification to chat
function appendSystemMessage(text) {
    const messagesBody = document.getElementById('ai-chat-messages');
    if (!messagesBody) return;

    const div = document.createElement('div');
    div.className = 'ai-message system';
    div.innerHTML = `<div class="message-content" style="color: var(--text-secondary); font-size: 11px; padding: 4px 8px; text-align: center;">${text}</div>`;
    messagesBody.appendChild(div);
    scrollToBottomAI();
}

// Handle quick prompts click
function sendQuickPrompt(promptText) {
    const inputField = document.getElementById('ai-chat-input');
    if (inputField) {
        inputField.value = promptText;
        sendAIMessage();
    }
}

// Send Chat message
async function sendAIMessage() {
    const inputField = document.getElementById('ai-chat-input');
    const messagesBody = document.getElementById('ai-chat-messages');
    const sendBtn = document.getElementById('ai-send-btn');

    if (!inputField || !messagesBody || !sendBtn) return;

    const text = inputField.value.trim();
    if (!text) return;

    // Append User message
    const userDiv = document.createElement('div');
    userDiv.className = 'ai-message user';
    userDiv.innerHTML = `<div class="message-content">${escapeHTML(text)}</div>`;
    messagesBody.appendChild(userDiv);

    // Clear Input
    inputField.value = '';
    scrollToBottomAI();

    // Append Typing Indicator
    const typingDiv = document.createElement('div');
    typingDiv.className = 'ai-message ai';
    typingDiv.id = 'ai-typing-indicator';
    typingDiv.innerHTML = `
        <div class="message-content">
            <div class="ai-typing">
                <span></span>
                <span></span>
                <span></span>
            </div>
        </div>
    `;
    messagesBody.appendChild(typingDiv);
    scrollToBottomAI();

    // Disable inputs
    inputField.disabled = true;
    sendBtn.disabled = true;

    // Extract context parameters
    const activeTabEl = document.querySelector('.nav-tab-btn.active');
    const activeTabName = activeTabEl ? activeTabEl.querySelector('span').textContent.trim() : 'Overview';

    const payload = {
        message: text,
        active_tab: activeTabName,
        apiKey: aiAssistantState.apiKey,
        model: aiAssistantState.model
    };

    try {
        const response = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-OpenRouter-Key': aiAssistantState.apiKey
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        // Remove typing indicator
        const indicator = document.getElementById('ai-typing-indicator');
        if (indicator) indicator.remove();

        if (data.success) {
            const aiDiv = document.createElement('div');
            aiDiv.className = 'ai-message ai';
            aiDiv.innerHTML = `<div class="message-content">${formatMarkdown(data.reply)}</div>`;
            messagesBody.appendChild(aiDiv);
        } else {
            const errDiv = document.createElement('div');
            errDiv.className = 'ai-message ai';
            errDiv.innerHTML = `<div class="message-content" style="color: var(--accent-red); border-color: rgba(239, 68, 68, 0.2);"><strong>Error:</strong> ${data.message}</div>`;
            messagesBody.appendChild(errDiv);
        }
    } catch (err) {
        console.error("AI Request failed:", err);
        const indicator = document.getElementById('ai-typing-indicator');
        if (indicator) indicator.remove();

        const errDiv = document.createElement('div');
        errDiv.className = 'ai-message ai';
        errDiv.innerHTML = `<div class="message-content" style="color: var(--accent-red); border-color: rgba(239, 68, 68, 0.2);"><strong>Request failed:</strong> Could not connect to server. Ensure server is running.</div>`;
        messagesBody.appendChild(errDiv);
    } finally {
        inputField.disabled = false;
        sendBtn.disabled = false;
        inputField.focus();
        scrollToBottomAI();
    }
}

function escapeHTML(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function formatMarkdown(text) {
    if (!text) return '';

    let lines = text.split('\n');
    let html = [];
    let inList = false;
    let inTable = false;
    let tableHeaders = [];
    let tableRows = [];

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();

        // Handle Table
        if (line.startsWith('|')) {
            if (!inTable) {
                inTable = true;
                tableHeaders = line.split('|').map(c => c.trim()).filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);
            } else if (line.includes('---')) {
                // skip separator
                continue;
            } else {
                let cells = line.split('|').map(c => c.trim()).filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);
                tableRows.push(cells);
            }
            continue;
        } else if (inTable) {
            inTable = false;
            let tableHtml = '<table><thead><tr>';
            tableHeaders.forEach(h => {
                tableHtml += `<th>${inlineFormat(h)}</th>`;
            });
            tableHtml += '</tr></thead><tbody>';
            tableRows.forEach(row => {
                tableHtml += '<tr>';
                row.forEach(c => {
                    tableHtml += `<td>${inlineFormat(c)}</td>`;
                });
                tableHtml += '</tr>';
            });
            tableHtml += '</tbody></table>';
            html.push(tableHtml);
            tableHeaders = [];
            tableRows = [];
        }

        // Handle Lists
        if (line.startsWith('- ') || line.startsWith('* ') || line.startsWith('• ')) {
            if (!inList) {
                inList = true;
                html.push('<ul>');
            }
            let content = line.substring(2);
            html.push(`<li>${inlineFormat(content)}</li>`);
            continue;
        } else if (inList) {
            inList = false;
            html.push('</ul>');
        }

        // Handle Headings
        if (line.startsWith('#')) {
            let level = 0;
            while (line.startsWith('#')) {
                level++;
                line = line.substring(1);
            }
            html.push(`<h${level} style="margin: 12px 0 6px 0; font-size: ${17 - level}px; font-weight: 600; color: var(--accent-blue);">${inlineFormat(line.trim())}</h${level}>`);
            continue;
        }

        // Regular Paragraphs
        if (line === '') {
            html.push('<br>');
        } else {
            html.push(`<p style="margin-bottom: 6px;">${inlineFormat(line)}</p>`);
        }
    }

    // Close remaining structures
    if (inTable) {
        let tableHtml = '<table><thead><tr>';
        tableHeaders.forEach(h => {
            tableHtml += `<th>${inlineFormat(h)}</th>`;
        });
        tableHtml += '</tr></thead><tbody>';
        tableRows.forEach(row => {
            tableHtml += '<tr>';
            row.forEach(c => {
                tableHtml += `<td>${inlineFormat(c)}</td>`;
            });
            tableHtml += '</tr>';
        });
        tableHtml += '</tbody></table>';
        html.push(tableHtml);
    }
    if (inList) {
        html.push('</ul>');
    }

    return html.join('\n');
}

function inlineFormat(text) {
    let escaped = escapeHTML(text);

    // Bold
    escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    escaped = escaped.replace(/__(.*?)__/g, '<strong>$1</strong>');

    // Italic
    escaped = escaped.replace(/\*(.*?)\*/g, '<em>$1</em>');
    escaped = escaped.replace(/_(.*?)_/g, '<em>$1</em>');

    // Backticks Code
    escaped = escaped.replace(/`(.*?)`/g, '<code>$1</code>');

    return escaped;
}

// ==========================================================================
// FINAL QTY BULK ACTIONS DROPDOWN & OPERATIONS
// ==========================================================================

function toggleFinalQtyBulkDropdown(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('final-qty-bulk-dropdown-menu');
    const btn = document.getElementById('final-qty-bulk-btn');
    const wrapper = btn ? btn.parentElement : null;
    if (menu && wrapper) {
        const isShown = menu.classList.contains('show');
        if (!isShown) {
            // Close Manual % menu if open
            const otherMenu = document.getElementById('manual-fill-dropdown-menu');
            if (otherMenu) otherMenu.classList.add('hidden');

            menu.classList.add('show');
            const rect = wrapper.getBoundingClientRect();
            menu.style.position = 'fixed';
            menu.style.top = `${rect.bottom + 4}px`;
            menu.style.left = `${rect.right - 220}px`;
            menu.style.right = 'auto';
            menu.style.width = '220px';
            menu.style.zIndex = '9999';
        } else {
            menu.classList.remove('show');
        }
    }
}

function handleFinalQtyDropdownKey(e) {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleFinalQtyBulkDropdown(e);
    }
}

// Global click handler to close menu when clicking outside
document.addEventListener('click', function (e) {
    const menu = document.getElementById('final-qty-bulk-dropdown-menu');
    const trigger = document.getElementById('final-qty-bulk-btn');
    const wrapper = trigger ? trigger.parentElement : null;
    if (menu && menu.classList.contains('show')) {
        if (!menu.contains(e.target) && (!trigger || !trigger.contains(e.target)) && (!wrapper || !wrapper.contains(e.target))) {
            menu.classList.remove('show');
        }
    }
});

// ESC key listener to close menu
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        const menu = document.getElementById('final-qty-bulk-dropdown-menu');
        if (menu && menu.classList.contains('show')) {
            menu.classList.remove('show');
            const trigger = document.getElementById('final-qty-bulk-btn');
            if (trigger) trigger.focus();
        }
    }
});

// Apply Bulk Actions to Final Qty column
function applyFinalQtyBulkAction(action, event) {
    if (event) event.stopPropagation();

    // Close dropdown
    const menu = document.getElementById('final-qty-bulk-dropdown-menu');
    if (menu) {
        menu.classList.remove('show');
    }

    let confirmMsg = "";
    if (action === 'ly') {
        confirmMsg = "Are you sure you want to replace Final Qty values using Last Year Qty?";
    } else if (action === 'calc') {
        confirmMsg = "Are you sure you want to replace Final Qty values using Calculated Qty?";
    } else if (action === 'manual') {
        confirmMsg = "Are you sure you want to replace Final Qty values using Manual Adjustment Qty?";
    } else if (action === 'clear') {
        confirmMsg = "Are you sure you want to clear every Final Qty value?";
    } else if (action === 'copy_prev') {
        confirmMsg = "Are you sure you want to replace Final Qty values by copying the previous month's Final Qty?";
    }

    // 1. Confirm dialog (except for 'round')
    if (action !== 'round') {
        const conf = confirm(confirmMsg);
        if (!conf) return;
    }

    // 2. Save current state for undo
    pushUndoState();

    // 3. Perform the bulk action
    if (action === 'ly') {
        appState.currentPlanDetails.forEach(row => {
            if (!row.locked) {
                row.final_qty = row.last_year_qty;
            }
        });
    } else if (action === 'calc') {
        appState.currentPlanDetails.forEach(row => {
            if (!row.locked) {
                row.final_qty = row.calculated_qty;
            }
        });
    } else if (action === 'manual') {
        appState.currentPlanDetails.forEach(row => {
            if (!row.locked) {
                row.final_qty = row.manual_adjustment;
            }
        });
    } else if (action === 'clear') {
        appState.currentPlanDetails.forEach(row => {
            if (!row.locked) {
                row.final_qty = 0;
            }
        });
    } else if (action === 'round') {
        appState.currentPlanDetails.forEach(row => {
            if (!row.locked) {
                row.final_qty = Math.round(row.final_qty);
            }
        });
    } else if (action === 'copy_prev') {
        const originalDetails = JSON.parse(JSON.stringify(appState.currentPlanDetails));
        for (let i = 1; i < appState.currentPlanDetails.length; i++) {
            const row = appState.currentPlanDetails[i];
            if (!row.locked) {
                row.final_qty = originalDetails[i - 1].final_qty;
            }
        }
    }

    // 4. Re-render and recalculate
    renderPlanningEditorRows();

    // 5. Mark page as modified without saving automatically
    const statusEl = document.getElementById('editor-auto-save-status');
    if (statusEl) {
        statusEl.textContent = "Modified (Unsaved)";
        statusEl.style.color = "var(--accent-orange)";
    }
}


// ==========================================================================
// FIX CONTRIBUTION POPUP MODAL & INTEGRATION
// ==========================================================================

let originalTabParent = null;
let isModalOpen = false;
let planningContribDrilldownSize = null;

function checkUserHasWritePermission() {
    if (appState.currentPlan && appState.currentPlan.status === 'Approved') {
        return false;
    }
    if (window.userHasReadOnlyPermission === true || appState.userReadOnly === true) {
        return false;
    }
    return true;
}

function setModalReadOnlyMode(isReadOnly) {
    const modalBody = document.getElementById('ai-contrib-modal-body');
    if (!modalBody) return;

    // Disable/enable all inputs, selects inside the modal
    const inputs = modalBody.querySelectorAll('input, select, textarea');
    inputs.forEach(el => {
        el.disabled = isReadOnly;
        if (isReadOnly) {
            el.style.opacity = '0.7';
            el.style.pointerEvents = 'none';
        } else {
            el.style.opacity = '';
            el.style.pointerEvents = '';
        }
    });

    // Disable/enable action buttons in the modal
    const buttons = modalBody.querySelectorAll('button, .btn');
    buttons.forEach(btn => {
        const onclickAttr = btn.getAttribute('onclick') || '';
        const isNav = onclickAttr.includes('navigatePlanningContribBack') ||
            onclickAttr.includes('closeAIContribModal') ||
            onclickAttr.includes('openSalesProductsModalForIndex') ||
            onclickAttr.includes('exportPlanningContributionToExcel');
        if (!isNav) {
            btn.disabled = isReadOnly;
            if (isReadOnly) {
                btn.style.opacity = '0.5';
                btn.style.pointerEvents = 'none';
            } else {
                btn.style.opacity = '';
                btn.style.pointerEvents = '';
            }
        }
    });
}

async function openAIContribModal(type, productId, colorCode, sizeId, event) {
    if (event) event.stopPropagation();

    const panel = document.getElementById('planning-contribution-panel');
    const modal = document.getElementById('ai-contrib-modal');
    const modalBody = document.getElementById('ai-contrib-modal-body');
    const modalTitle = document.getElementById('ai-contrib-modal-title');
    const modalSubtitle = document.getElementById('ai-contrib-modal-subtitle');

    if (!panel || !modal || !modalBody) return;

    // Save original parent
    if (!originalTabParent) {
        originalTabParent = panel.parentElement;
    }

    // Move the panel into the modal
    modalBody.appendChild(panel);
    panel.classList.remove('hidden');

    // Show modal
    modal.classList.remove('hidden');
    isModalOpen = true;

    // Show modal loader overlay
    const loader = document.getElementById('planning-contrib-loader');
    if (loader) loader.classList.remove('hidden');

    // Wait until metadata and dropdowns finish loading if they haven't been loaded yet
    if (!planningContribMeta) {
        // Fetch brands
        try {
            const brandResp = await fetch('/api/masters/brands?status=Active');
            const brandData = await brandResp.json();
            const brandFilter = document.getElementById('planning-contrib-filter-brand');
            if (brandFilter) {
                brandFilter.innerHTML = '<option value="">All Brands</option>';
                if (brandData.success && brandData.brands) {
                    brandData.brands.forEach(b => {
                        brandFilter.innerHTML += `<option value="${b.id}">${b.brand_name}</option>`;
                    });
                }
            }
        } catch (err) {
            console.error("Error fetching brands for modal:", err);
        }

        // Fetch versions
        await loadPlanningContribVersions();

        // Fetch meta
        try {
            const metaResp = await fetch('/api/planning-contribution/meta');
            const metaData = await metaResp.json();
            if (metaResp.ok && metaData.success) {
                planningContribMeta = metaData;
            }
        } catch (err) {
            console.error("Error fetching meta for modal:", err);
        }
    }

    // Lookup names from derivProductsData
    const product = derivProductsData.find(p => p.product_id === productId);
    const color = product ? product.colors.find(c => c.color_code === colorCode) : null;
    const size = color ? color.sizes.find(s => s.size_id === sizeId) : null;

    const prodName = product ? product.product_name : '';
    const colName = color ? color.color_name : '';
    const szName = size ? size.size_name : '';
    const brandId = product ? product.brand_id : '';

    // Set Modal Header Titles
    if (type === 'Product') {
        modalTitle.innerHTML = `<i class="fa-solid fa-chart-pie" style="color: var(--accent-blue);"></i> Fix Product Contribution`;
        modalSubtitle.textContent = `Product: ${prodName}`;
    } else if (type === 'Color') {
        modalTitle.innerHTML = `<i class="fa-solid fa-chart-pie" style="color: var(--accent-blue);"></i> Fix Color Contribution`;
        modalSubtitle.textContent = `Product: ${prodName} | Color: ${colName}`;
    } else if (type === 'Size') {
        modalTitle.innerHTML = `<i class="fa-solid fa-chart-pie" style="color: var(--accent-blue);"></i> Fix Size Contribution`;
        modalSubtitle.textContent = `Product: ${prodName} | Color: ${colName} | Size: ${szName}`;
    }

    // 1. Populate filters using the values from Next Qty Derivation
    // Type Select
    const typeSelect = document.getElementById('planning-contrib-type');
    if (typeSelect) {
        typeSelect.value = type;
        typeSelect.disabled = true;
    }

    // Brand Filter
    const brandSelect = document.getElementById('planning-contrib-filter-brand');
    if (brandSelect) {
        brandSelect.value = brandId;
        brandSelect.disabled = true;
    }

    // Version Select (using Next Qty Derivation's contribution version)
    const derivContribVer = document.getElementById('deriv-filter-contrib-version').value;
    const versionSelect = document.getElementById('planning-contrib-version-select');
    if (versionSelect && derivContribVer) {
        versionSelect.value = derivContribVer;
    }

    // Sync common period selectors with the active plan year in Next Qty Derivation
    let targetYear = 2026;
    const planVal = document.getElementById('deriv-filter-plan') ? document.getElementById('deriv-filter-plan').value : '';
    if (planVal && planVal.includes('|')) {
        const parts = planVal.split('|');
        const fy = parts[1].trim();
        const digits = fy.replace(/\D/g, '');
        if (digits.length >= 4) {
            targetYear = parseInt(digits.substring(0, 4));
        }
    }
    const commonFromM = document.getElementById('planning-contrib-common-from-month');
    const commonFromY = document.getElementById('planning-contrib-common-from-year');
    const commonToM = document.getElementById('planning-contrib-common-to-month');
    const commonToY = document.getElementById('planning-contrib-common-to-year');

    if (commonFromM) commonFromM.value = 'April';
    if (commonFromY) commonFromY.value = targetYear.toString();
    if (commonToM) commonToM.value = 'December';
    if (commonToY) commonToY.value = targetYear.toString();

    // Reset and show/hide Size Method Selector
    const sizeMethodSelect = document.getElementById('planning-contrib-size-method');
    if (sizeMethodSelect) {
        sizeMethodSelect.value = '1';
    }
    const methodWrapper = document.getElementById('planning-contrib-size-method-wrapper');
    const colorsWrapper = document.getElementById('planning-contrib-colors-multiselect-wrapper');
    const banner = document.getElementById('planning-contrib-method-banner');

    if (type === 'Size') {
        if (methodWrapper) methodWrapper.classList.remove('hidden');
        if (banner) {
            banner.classList.remove('hidden');
            const bannerText = document.getElementById('planning-contrib-method-banner-text');
            if (bannerText) bannerText.textContent = "Each color can have its own size curve.";
        }
        const matrixTitle = document.getElementById('planning-contrib-matrix-title');
        if (matrixTitle) matrixTitle.textContent = "Color-wise Size Curve";
    } else {
        if (methodWrapper) methodWrapper.classList.add('hidden');
        if (colorsWrapper) colorsWrapper.classList.add('hidden');
        if (banner) banner.classList.add('hidden');
    }

    // Product Filter Selection
    selectedMasterProducts.clear();
    selectedMasterProducts.add(productId.toString());

    // Clear other selections so they don't block
    selectedMasterColors.clear();
    selectedSalesProducts.clear();

    refreshSelectedTags();

    const prodSelectTrigger = document.querySelector('#planning-contrib-products-multiselect .multiselect-trigger');
    if (prodSelectTrigger) {
        prodSelectTrigger.style.pointerEvents = 'none';
        prodSelectTrigger.style.opacity = '0.5';
    }

    // 2. Set Drilldown/Filter states based on clicked hierarchy
    if (type === 'Product') {
        planningContribDrilldownProduct = null;
        planningContribDrilldownColor = null;
        planningContribDrilldownSize = null;
    } else if (type === 'Color') {
        planningContribDrilldownProduct = { id: productId, name: prodName, brand_id: brandId };
        planningContribDrilldownColor = { code: colorCode, name: colName };
        planningContribDrilldownSize = null;
    } else if (type === 'Size') {
        planningContribDrilldownProduct = { id: productId, name: prodName, brand_id: brandId };
        planningContribDrilldownColor = { code: colorCode, name: colName };
        planningContribDrilldownSize = sizeId;
    }

    // 3. Automatically execute Load Data logic
    const rule = document.getElementById('planning-contrib-rule').value;
    const version = versionSelect ? versionSelect.value : 'Standard';

    // Console log for debugging as requested
    console.log("---- Debug Contribution Popup Load ----");
    console.log("Selected Type:", type);
    console.log("Selected Product:", prodName, `(ID: ${productId})`);
    console.log("Selected Color:", colName, `(Code: ${colorCode})`);
    console.log("Selected Size:", szName, `(ID: ${sizeId})`);

    const prodIds = Array.from(selectedMasterProducts).join(',');
    const colorCodeParamStr = colorCode ? `&color_code=${encodeURIComponent(colorCode)}` : '';
    const sizeParamStr = sizeId ? `&size_id=${encodeURIComponent(sizeId)}` : '';
    const testUrl = `/api/planning-contribution/data?contribution_type=${type}&brand_id=${brandId}&product_ids=${encodeURIComponent(prodIds)}&sales_products=&color_ids=&version=${encodeURIComponent(version)}&page=1&per_page=10${colorCodeParamStr}${sizeParamStr}&suggestion_rule=${encodeURIComponent(rule)}`;
    console.log("Generated API request:", testUrl);

    try {
        await new Promise((resolve) => {
            const origRender = renderPlanningContribTableBodyOnly;
            renderPlanningContribTableBodyOnly = function () {
                origRender();
                // Restore original render
                renderPlanningContribTableBodyOnly = origRender;

                const returnedCount = planningContribData && planningContribData.rows ? planningContribData.rows.length : 0;
                console.log("Returned row count:", returnedCount);

                // Hide loader in all cases
                const loaderEl = document.getElementById('planning-contrib-loader');
                if (loaderEl) loaderEl.classList.add('hidden');

                resolve();
            };

            // Execute the load
            loadPlanningContributionData();
        });
    } catch (err) {
        console.error("Error auto-loading popup data:", err);
    }

    // 4. Respect permissions and enforce read-only if needed
    const isReadOnly = !checkUserHasWritePermission();
    setModalReadOnlyMode(isReadOnly);
}

function closeAIContribModal() {
    const modal = document.getElementById('ai-contrib-modal');
    const panel = document.getElementById('planning-contribution-panel');

    if (!modal || !panel) return;

    modal.classList.add('hidden');
    isModalOpen = false;

    setModalReadOnlyMode(false);

    // Re-enable filters
    const typeSelect = document.getElementById('planning-contrib-type');
    if (typeSelect) typeSelect.disabled = false;
    const brandSelect = document.getElementById('planning-contrib-filter-brand');
    if (brandSelect) brandSelect.disabled = false;
    const prodSelectTrigger = document.querySelector('#planning-contrib-products-multiselect .multiselect-trigger');
    if (prodSelectTrigger) {
        prodSelectTrigger.style.pointerEvents = '';
        prodSelectTrigger.style.opacity = '';
    }

    // Move the panel back to its original parent container
    if (originalTabParent) {
        originalTabParent.appendChild(panel);
    }

    // Check if the current visible tab is indeed planning-contribution
    const activeTab = document.querySelector('.sidebar-menu-item.active, .tab-item.active');
    const isActiveTabContrib = activeTab && activeTab.getAttribute('id') === 'tab-planning-contribution';
    if (!isActiveTabContrib) {
        panel.classList.add('hidden');
    }

    planningContribDrilldownSize = null;
}

// ESC listener to close modal
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        const modal = document.getElementById('ai-contrib-modal');
        if (modal && !modal.classList.contains('hidden')) {
            closeAIContribModal();
        }
    }
});

// =====================================================================
// PLANNING STOCK / WIP / PENDING ORDER MODULE CONTROLLER
// =====================================================================

let stockWipActiveTab = 'fabric-stock';
let stockWipAllData = [];
let stockWipMode = 'saved'; // 'saved' or 'preview'
let stockWipCurrentPage = 1;
let stockWipPageSize = 25;
let stockWipSortColumn = '';
let stockWipSortOrder = 'asc';
let stockWipActivePopupCol = null;

// Isolated per-tab state with explicit dataLoaded tracking
const stockWipTabState = {
    'fabric-stock': { dataLoaded: false, allRecords: [], filters: {}, distinctValues: {}, page: 1, pageSize: 25 },
    'fabric-wip': { dataLoaded: false, allRecords: [], filters: {}, distinctValues: {}, page: 1, pageSize: 25 },
    'production-wip': { dataLoaded: false, allRecords: [], filters: {}, distinctValues: {}, page: 1, pageSize: 25 },
    'pending-orders': { dataLoaded: false, allRecords: [], filters: {}, distinctValues: {}, page: 1, pageSize: 25 },
    'finished-goods': { dataLoaded: false, allRecords: [], filters: {}, distinctValues: {}, page: 1, pageSize: 25 }
};

// Global click handler to close filter popup when clicking outside
document.addEventListener('click', function (e) {
    const popup = document.getElementById('stock-wip-filter-popup');
    if (!popup || popup.classList.contains('hidden')) return;
    if (popup.contains(e.target)) return;
    if (e.target.closest('.stock-wip-col-filter-btn')) return;
    closeStockWipFilterPopup();
});

// Null/undefined-safe zero-value field accessor
function getStockWipCellValue(row, col) {
    const primaryVal = row[col.key];
    if (primaryVal !== undefined && primaryVal !== null) {
        return primaryVal;
    }
    if (col.label && row[col.label] !== undefined && row[col.label] !== null) {
        return row[col.label];
    }
    return '';
}

function isStockWipNumericCol(colKey) {
    return ['gsm', 'dia', 'weight_mtr', 'qty', 'weight'].includes(String(colKey).toLowerCase());
}

function getStockWipColumns(tabName, mode) {
    let columns = [];
    if (tabName === 'fabric-stock' || tabName === 'fabric-wip') {
        columns = [
            { key: 'fabric_name', label: 'Fabric Name' },
            { key: 'gsm', label: 'GSM' },
            { key: 'dia', label: 'DIA' },
            { key: 'color', label: 'Color' },
            { key: 'weight_mtr', label: 'Weight' }
        ];
    } else if (tabName === 'production-wip') {
        columns = [
            { key: 'product_name', label: 'Product Name' },
            { key: 'color', label: 'Color' },
            { key: 'size', label: 'Size' },
            { key: 'production_type', label: 'Production Type' },
            { key: 'production_group', label: 'Production Group' },
            { key: 'qty', label: 'Qty' }
        ];
    } else { // pending-orders, finished-goods
        columns = [
            { key: 'product_name', label: 'Product Name' },
            { key: 'color', label: 'Color' },
            { key: 'size', label: 'Size' },
            { key: 'qty', label: 'Qty' }
        ];
    }

    columns.push({ key: 'validation_status', label: 'Validation Status' });
    columns.push({ key: 'validation_message', label: 'Validation Message' });

    if (mode === 'saved') {
        columns.push({ key: 'created_by', label: 'Created By' });
        columns.push({ key: 'created_at', label: 'Created Date' });
    }
    return columns;
}

function populateStockWipDistinctValues(tabName) {
    const state = stockWipTabState[tabName];
    if (!state || !state.allRecords) return;
    state.distinctValues = {};

    const columns = getStockWipColumns(tabName, stockWipMode);
    columns.forEach(col => {
        if (!isStockWipNumericCol(col.key)) {
            const valSet = new Set();
            state.allRecords.forEach(row => {
                let val = getStockWipCellValue(row, col);
                if (col.key === 'created_at' && val) {
                    try {
                        const d = new Date(val);
                        val = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    } catch (e) { }
                }
                if (val !== undefined && val !== null && String(val).trim() !== '') {
                    valSet.add(String(val));
                }
            });
            state.distinctValues[col.key] = Array.from(valSet).sort((a, b) => a.localeCompare(b));
        }
    });
}

async function initializeStockWipTab() {
    stockWipActiveTab = 'fabric-stock';
    stockWipSortColumn = '';
    stockWipSortOrder = 'asc';
    stockWipMode = 'saved';

    updateStockWipSubTabButtons();
    await fetchStockWipSavedData();
}

async function switchStockWipSubTab(tabName) {
    stockWipActiveTab = tabName;
    stockWipSortColumn = '';
    stockWipSortOrder = 'asc';
    stockWipMode = 'saved';

    updateStockWipSubTabButtons();
    const state = stockWipTabState[tabName];
    if (state && state.dataLoaded) {
        stockWipAllData = state.allRecords;
        stockWipCurrentPage = state.page || 1;
        stockWipPageSize = state.pageSize || 25;
        updateStockWipModeBadge();
        renderStockWipGrid();
    } else {
        await fetchStockWipSavedData();
    }
}

function updateStockWipSubTabButtons() {
    const tabNames = ['fabric-stock', 'fabric-wip', 'production-wip', 'pending-orders', 'finished-goods'];
    tabNames.forEach(name => {
        const btn = document.getElementById(`sub-tab-${name}`);
        if (btn) {
            if (name === stockWipActiveTab) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    });

    const titleEl = document.getElementById('stock-wip-grid-title');
    if (titleEl) {
        const titles = {
            'fabric-stock': 'Fabric Stock Grid',
            'fabric-wip': 'Fabric WIP Grid',
            'production-wip': 'Production WIP Grid',
            'pending-orders': 'Pending Orders Grid',
            'finished-goods': 'Finished Goods Grid'
        };
        titleEl.textContent = titles[stockWipActiveTab] || 'Grid';
    }
}

async function fetchStockWipSavedData() {
    showLoader(true, `Loading saved records for ${stockWipActiveTab.replace('-', ' ')}...`);
    try {
        const response = await fetch(`/api/planning-stock/data?tab=${stockWipActiveTab}`);
        const result = await response.json();
        if (response.ok && result.success) {
            stockWipAllData = result.data || [];
            stockWipMode = 'saved';

            const state = stockWipTabState[stockWipActiveTab];
            if (state) {
                state.allRecords = stockWipAllData;
                state.dataLoaded = true;
                state.page = 1;
                populateStockWipDistinctValues(stockWipActiveTab);
            }

            updateStockWipModeBadge();
            renderStockWipGrid();
        } else {
            alert(result.message || 'Failed to load saved data.');
        }
    } catch (err) {
        console.error("Error fetching stock WIP data:", err);
        alert('Network error while loading data.');
    } finally {
        showLoader(false);
    }
}

function updateStockWipModeBadge() {
    const badge = document.getElementById('stock-wip-mode-badge');
    if (badge) {
        if (stockWipMode === 'saved') {
            badge.textContent = 'Saved Data Mode';
            badge.style.color = 'var(--accent-blue)';
            badge.style.borderColor = 'var(--accent-blue)';
            badge.style.background = 'rgba(59, 130, 246, 0.08)';
        } else {
            badge.textContent = 'Import Preview Mode';
            badge.style.color = 'var(--accent-orange)';
            badge.style.borderColor = 'var(--accent-orange)';
            badge.style.background = 'rgba(245, 158, 11, 0.08)';
        }
    }
}

async function downloadStockWipTemplate() {
    let exampleProduct = 'Product A';
    let exampleFabric = 'LYCRA_JERSY';
    let exampleColor = '02-RED';
    let exampleSize = 'L';
    let exampleGsm = 185;
    let exampleDia = 30;

    try {
        const fabResp = await fetch('/api/masters/fabrics?status=Active');
        const fabData = await fabResp.json();
        if (fabData.success && fabData.data && fabData.data.length > 0) {
            exampleFabric = fabData.data[0].fabric_name || exampleFabric;
            exampleGsm = fabData.data[0].gsm || exampleGsm;
        }
    } catch (e) { }

    try {
        const prodResp = await fetch('/api/masters/products?status=Active');
        const prodData = await prodResp.json();
        if (prodData.success && prodData.data && prodData.data.length > 0) {
            exampleProduct = prodData.data[0].product_name || exampleProduct;
        }
    } catch (e) { }

    try {
        const colResp = await fetch('/api/masters/colors?status=Active');
        const colData = await colResp.json();
        if (colData.success && colData.data && colData.data.length > 0) {
            exampleColor = colData.data[0].display_color || exampleColor;
        }
    } catch (e) { }

    try {
        const szResp = await fetch('/api/masters/sizes?status=Active');
        const szData = await szResp.json();
        if (szData.success && szData.data && szData.data.length > 0) {
            exampleSize = szData.data[0].size || exampleSize;
        }
    } catch (e) { }

    let headers = [];
    let exampleRow = {};

    if (stockWipActiveTab === 'fabric-stock' || stockWipActiveTab === 'fabric-wip') {
        headers = ['Fabric Name', 'GSM', 'DIA', 'Color', 'Weight'];
        exampleRow = {
            'Fabric Name': exampleFabric,
            'GSM': exampleGsm,
            'DIA': exampleDia,
            'Color': exampleColor,
            'Weight': 150.5
        };
    } else if (stockWipActiveTab === 'production-wip') {
        headers = ['Product Name', 'Color', 'Size', 'Production Type', 'Production Group', 'Qty'];
        exampleRow = {
            'Product Name': exampleProduct,
            'Color': exampleColor,
            'Size': exampleSize,
            'Production Type': 'Common',
            'Production Group': 'Group A',
            'Qty': 500
        };
    } else {
        headers = ['Product Name', 'Color', 'Size', 'Qty'];
        exampleRow = {
            'Product Name': exampleProduct,
            'Color': exampleColor,
            'Size': exampleSize,
            'Qty': 1000
        };
    }

    const worksheet = XLSX.utils.json_to_sheet([exampleRow], { header: headers });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Template');
    XLSX.writeFile(workbook, `${stockWipActiveTab}_template.xlsx`);
}

function triggerStockWipImport() {
    document.getElementById('stock-wip-import-file').click();
}

function importStockWipExcel(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const dataBytes = new Uint8Array(e.target.result);
            const workbook = XLSX.read(dataBytes, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(worksheet);

            if (rows.length === 0) {
                alert("Excel sheet is empty.");
                return;
            }

            stockWipAllData = rows;
            stockWipMode = 'preview';

            const state = stockWipTabState[stockWipActiveTab];
            if (state) {
                state.allRecords = rows;
                state.dataLoaded = true;
                state.page = 1;
                populateStockWipDistinctValues(stockWipActiveTab);
            }

            stockWipCurrentPage = 1;
            updateStockWipModeBadge();
            renderStockWipGrid();
            alert(`Loaded ${rows.length} rows for preview. Please click 'Validate' to check data.`);
        } catch (err) {
            console.error("Error parsing Excel:", err);
            alert("Failed to parse Excel file. Please ensure it matches the template format.");
        } finally {
            document.getElementById('stock-wip-import-file').value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

async function validateStockWipData() {
    if (stockWipAllData.length === 0) {
        alert("No rows available to validate. Please import an Excel file.");
        return;
    }

    showLoader(true, "Validating records against database master tables...");
    try {
        const response = await fetch('/api/planning-stock/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tab: stockWipActiveTab,
                rows: stockWipAllData
            })
        });

        const result = await response.json();
        if (response.ok && result.success) {
            stockWipAllData = result.rows || [];
            const state = stockWipTabState[stockWipActiveTab];
            if (state) {
                state.allRecords = stockWipAllData;
                populateStockWipDistinctValues(stockWipActiveTab);
            }
            renderStockWipGrid();

            const invalidCount = stockWipAllData.filter(r => r.validation_status === 'INVALID' || r['Validation Status'] === 'INVALID').length;
            if (invalidCount === 0) {
                alert("Validation complete! All rows are VALID.");
            } else {
                alert(`Validation complete! Found ${invalidCount} invalid rows. Highlighted in red.`);
            }
        } else {
            alert(result.message || 'Validation failed.');
        }
    } catch (err) {
        console.error("Error validating stock/wip data:", err);
        alert('Network error while validating.');
    } finally {
        showLoader(false);
    }
}

async function saveStockWipData() {
    if (stockWipAllData.length === 0) {
        alert("No data to save.");
        return;
    }

    const unvalidated = stockWipAllData.some(r => !r.validation_status && !r['Validation Status']);
    if (unvalidated) {
        alert("Please validate the records before saving.");
        return;
    }

    const validRows = stockWipAllData.filter(r => r.validation_status === 'VALID' || r['Validation Status'] === 'VALID');
    if (validRows.length === 0) {
        alert("No valid rows found to save. All rows are invalid or duplicate.");
        return;
    }

    showLoader(true, "Saving valid rows to database...");
    try {
        const response = await fetch('/api/planning-stock/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tab: stockWipActiveTab,
                rows: stockWipAllData
            })
        });

        const result = await response.json();
        if (response.ok && result.success) {
            const savedCount = result.saved_count || 0;
            stockWipAllData = result.remaining_rows || [];

            const state = stockWipTabState[stockWipActiveTab];
            if (state) {
                state.allRecords = stockWipAllData;
                populateStockWipDistinctValues(stockWipActiveTab);
            }

            if (stockWipAllData.length === 0) {
                alert(`Successfully saved all ${savedCount} records!`);
                stockWipMode = 'saved';
                await fetchStockWipSavedData();
            } else {
                alert(`Only valid records were saved (${savedCount} saved). ${stockWipAllData.length} invalid/duplicate records remain on screen.`);
                stockWipCurrentPage = 1;
                renderStockWipGrid();
            }
        } else {
            alert(result.message || 'Failed to save records.');
        }
    } catch (err) {
        console.error("Error saving stock/wip data:", err);
        alert('Network error while saving.');
    } finally {
        showLoader(false);
    }
}

function exportStockWipData(type) {
    if (stockWipAllData.length === 0) {
        alert("No data available to export.");
        return;
    }

    let filtered = [];
    if (type === 'all') {
        filtered = stockWipAllData;
    } else if (type === 'valid') {
        filtered = stockWipAllData.filter(r => r.validation_status === 'VALID' || r['Validation Status'] === 'VALID');
    } else if (type === 'invalid') {
        filtered = stockWipAllData.filter(r => r.validation_status === 'INVALID' || r['Validation Status'] === 'INVALID');
    }

    if (filtered.length === 0) {
        alert(`No ${type} records to export.`);
        return;
    }

    const exportRows = filtered.map(r => {
        let rowData = {};
        if (stockWipActiveTab === 'fabric-stock' || stockWipActiveTab === 'fabric-wip') {
            rowData = {
                'Fabric Name': r['Fabric Name'] || r['fabric_name'] || '',
                'GSM': r['GSM'] || r['gsm'] || '',
                'DIA': r['DIA'] || r['dia'] || '',
                'Color': r['Color'] || r['color'] || '',
                'Weight': r['Weight'] || r['weight_mtr'] || ''
            };
        } else if (stockWipActiveTab === 'production-wip') {
            rowData = {
                'Product Name': r['Product Name'] || r['product_name'] || '',
                'Color': r['Color'] || r['color'] || '',
                'Size': r['Size'] || r['size'] || '',
                'Production Type': r['Production Type'] || r['production_type'] || '',
                'Production Group': r['Production Group'] || r['production_group'] || '',
                'Qty': r['Qty'] || r['qty'] || ''
            };
        } else {
            rowData = {
                'Product Name': r['Product Name'] || r['product_name'] || '',
                'Color': r['Color'] || r['color'] || '',
                'Size': r['Size'] || r['size'] || '',
                'Qty': r['Qty'] || r['qty'] || ''
            };
        }

        rowData['Validation Status'] = r.validation_status || r['Validation Status'] || 'UNVALIDATED';
        rowData['Validation Message'] = r.validation_message || r['Validation Message'] || '';
        return rowData;
    });

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Export');
    XLSX.writeFile(workbook, `${stockWipActiveTab}_export_${type}.xlsx`);
}

function clearStockWipPreview() {
    stockWipAllData = [];
    stockWipMode = 'preview';
    stockWipCurrentPage = 1;

    const state = stockWipTabState[stockWipActiveTab];
    if (state) {
        state.allRecords = [];
        state.filters = {};
        state.page = 1;
    }

    updateStockWipModeBadge();
    renderStockWipGrid();
    alert("Preview grid cleared.");
}

function onStockWipPageSizeChange() {
    const sizeSelect = document.getElementById('stock-wip-page-size');
    if (sizeSelect) {
        stockWipPageSize = parseInt(sizeSelect.value);
        stockWipCurrentPage = 1;
        const state = stockWipTabState[stockWipActiveTab];
        if (state) {
            state.pageSize = stockWipPageSize;
            state.page = 1;
        }
        renderStockWipGrid();
    }
}

function toggleStockWipSort(column) {
    if (stockWipSortColumn === column) {
        stockWipSortOrder = stockWipSortOrder === 'asc' ? 'desc' : 'asc';
    } else {
        stockWipSortColumn = column;
        stockWipSortOrder = 'asc';
    }
    renderStockWipGrid();
}

function openStockWipFilter(colKey, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    stockWipActivePopupCol = colKey;

    const popup = document.getElementById('stock-wip-filter-popup');
    const titleSpan = document.getElementById('stock-wip-popup-col-title');
    const catSection = document.getElementById('stock-wip-popup-categorical-section');
    const numSection = document.getElementById('stock-wip-popup-numeric-section');
    const btn = event ? event.currentTarget : document.getElementById(`stock-wip-filter-btn-${colKey}`);

    const columns = getStockWipColumns(stockWipActiveTab, stockWipMode);
    const colDef = columns.find(c => c.key === colKey) || { label: colKey };

    if (titleSpan) titleSpan.textContent = `${colDef.label} Filter`;

    if (isStockWipNumericCol(colKey)) {
        if (catSection) catSection.classList.add('hidden');
        if (numSection) numSection.classList.remove('hidden');
        renderStockWipNumericFilterUI(colKey);
    } else {
        if (numSection) numSection.classList.add('hidden');
        if (catSection) catSection.classList.remove('hidden');
        const searchInput = document.getElementById('stock-wip-popup-search');
        if (searchInput) searchInput.value = '';
        renderStockWipFilterCheckboxes(colKey, '');
    }

    if (popup && btn) {
        popup.classList.remove('hidden');
        const rect = btn.getBoundingClientRect();
        popup.style.position = 'fixed';
        popup.style.zIndex = '99999';
        popup.style.top = `${rect.bottom + 4}px`;
        let leftPos = rect.left - 100;
        if (leftPos < 10) leftPos = 10;
        if (leftPos + 250 > window.innerWidth) leftPos = window.innerWidth - 260;
        popup.style.left = `${leftPos}px`;
        if (!isStockWipNumericCol(colKey)) {
            const searchInput = document.getElementById('stock-wip-popup-search');
            if (searchInput) setTimeout(() => searchInput.focus(), 50);
        }
    }
}

function closeStockWipFilterPopup() {
    const popup = document.getElementById('stock-wip-filter-popup');
    if (popup) popup.classList.add('hidden');
    stockWipActivePopupCol = null;
}

function renderStockWipFilterCheckboxes(colKey, searchFilter) {
    const listContainer = document.getElementById('stock-wip-popup-checkbox-list');
    if (!listContainer) return;

    const state = stockWipTabState[stockWipActiveTab];
    const values = (state && state.distinctValues && state.distinctValues[colKey]) || [];
    const activeSet = state && state.filters && state.filters[colKey];
    const term = (searchFilter || '').toLowerCase().trim();

    let html = '';
    let matchCount = 0;

    values.forEach((val, idx) => {
        if (term && !String(val).toLowerCase().includes(term)) return;
        matchCount++;
        const isChecked = (!activeSet || activeSet.size === 0) || activeSet.has(val);
        const itemId = `stock-wip-chk-${colKey}-${idx}`;
        html += `
            <label class="stock-wip-filter-checkbox-item" for="${itemId}">
                <input type="checkbox" id="${itemId}" value="${escapeHtml(val)}" ${isChecked ? 'checked' : ''}>
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(val)}</span>
            </label>
        `;
    });

    if (matchCount === 0) {
        html = `<div style="font-size: 11px; color: var(--text-muted); text-align: center; padding: 12px 0;">No matching options</div>`;
    }

    listContainer.innerHTML = html;
}

function onStockWipFilterSearchInput(val) {
    if (!stockWipActivePopupCol) return;
    renderStockWipFilterCheckboxes(stockWipActivePopupCol, val);
}

function stockWipFilterSelectAll(selectAll) {
    const checkboxes = document.querySelectorAll('#stock-wip-popup-checkbox-list input[type="checkbox"]');
    checkboxes.forEach(chk => { chk.checked = selectAll; });
}

function renderStockWipNumericFilterUI(colKey) {
    const state = stockWipTabState[stockWipActiveTab];
    const numFilter = (state && state.filters && state.filters[colKey]) || {};
    const opSelect = document.getElementById('stock-wip-popup-num-operator');
    const val1Input = document.getElementById('stock-wip-popup-num-val1');
    const val2Input = document.getElementById('stock-wip-popup-num-val2');
    const val2Wrap = document.getElementById('stock-wip-popup-num-val2-wrap');

    const op = numFilter.operator || 'gte';
    if (opSelect) opSelect.value = op;
    if (val1Input) val1Input.value = numFilter.val1 !== undefined && numFilter.val1 !== null ? numFilter.val1 : '';
    if (val2Input) val2Input.value = numFilter.val2 !== undefined && numFilter.val2 !== null ? numFilter.val2 : '';

    if (val2Wrap) {
        if (op === 'between') val2Wrap.classList.remove('hidden');
        else val2Wrap.classList.add('hidden');
    }
}

function onStockWipNumericOperatorChange(val) {
    const val2Wrap = document.getElementById('stock-wip-popup-num-val2-wrap');
    if (val2Wrap) {
        if (val === 'between') val2Wrap.classList.remove('hidden');
        else val2Wrap.classList.add('hidden');
    }
}

function applyStockWipFilterCurrent() {
    const colKey = stockWipActivePopupCol;
    if (!colKey) return;
    const state = stockWipTabState[stockWipActiveTab];
    if (!state) return;

    if (isStockWipNumericCol(colKey)) {
        const op = document.getElementById('stock-wip-popup-num-operator')?.value || 'gte';
        const v1Raw = document.getElementById('stock-wip-popup-num-val1')?.value;
        const v2Raw = document.getElementById('stock-wip-popup-num-val2')?.value;

        if (v1Raw === '' || v1Raw === undefined || v1Raw === null) {
            delete state.filters[colKey];
        } else {
            state.filters[colKey] = {
                operator: op,
                val1: Number(v1Raw),
                val2: (op === 'between' && v2Raw !== '') ? Number(v2Raw) : null
            };
        }
    } else {
        const checkboxes = document.querySelectorAll('#stock-wip-popup-checkbox-list input[type="checkbox"]');
        const checkedValues = new Set();
        checkboxes.forEach(chk => {
            if (chk.checked) checkedValues.add(chk.value);
        });

        const totalValues = (state.distinctValues && state.distinctValues[colKey]) || [];
        if (checkedValues.size === totalValues.length || checkedValues.size === 0) {
            delete state.filters[colKey];
        } else {
            state.filters[colKey] = checkedValues;
        }
    }

    updateStockWipFilterBtnVisualState(colKey);
    closeStockWipFilterPopup();
    state.page = 1;
    stockWipCurrentPage = 1;
    renderStockWipGrid();
}

function clearStockWipFilterCurrent() {
    const colKey = stockWipActivePopupCol;
    if (!colKey) return;
    const state = stockWipTabState[stockWipActiveTab];
    if (!state) return;

    delete state.filters[colKey];
    updateStockWipFilterBtnVisualState(colKey);
    closeStockWipFilterPopup();
    state.page = 1;
    stockWipCurrentPage = 1;
    renderStockWipGrid();
}

function clearAllStockWipFilters() {
    const state = stockWipTabState[stockWipActiveTab];
    if (!state) return;

    state.filters = {};
    const columns = getStockWipColumns(stockWipActiveTab, stockWipMode);
    columns.forEach(c => updateStockWipFilterBtnVisualState(c.key));

    closeStockWipFilterPopup();
    state.page = 1;
    stockWipCurrentPage = 1;
    renderStockWipGrid();
}

function updateStockWipFilterBtnVisualState(colKey) {
    const btn = document.getElementById(`stock-wip-filter-btn-${colKey}`);
    const state = stockWipTabState[stockWipActiveTab];
    const filter = state && state.filters && state.filters[colKey];

    let isFiltered = false;
    if (filter) {
        if (isStockWipNumericCol(colKey)) {
            isFiltered = filter.val1 !== undefined && filter.val1 !== null;
        } else if (filter instanceof Set) {
            isFiltered = filter.size > 0;
        }
    }

    if (btn) {
        if (isFiltered) {
            btn.classList.add('active');
            btn.innerHTML = `<i class="fa-solid fa-filter-circle-xmark"></i>`;
        } else {
            btn.classList.remove('active');
            btn.innerHTML = `<i class="fa-solid fa-filter"></i>`;
        }
    }

    let anyActive = false;
    if (state && state.filters) {
        Object.keys(state.filters).forEach(k => {
            const f = state.filters[k];
            if (f) {
                if (isStockWipNumericCol(k) && f.val1 !== undefined && f.val1 !== null) anyActive = true;
                else if (f instanceof Set && f.size > 0) anyActive = true;
            }
        });
    }

    const clearAllBtn = document.getElementById('stock-wip-clear-all-filters-btn');
    if (clearAllBtn) {
        if (anyActive) clearAllBtn.classList.remove('hidden');
        else clearAllBtn.classList.add('hidden');
    }
}

function getFilteredStockWipData() {
    const state = stockWipTabState[stockWipActiveTab];
    if (!state || !state.allRecords) return stockWipAllData || [];

    const activeFilters = state.filters || {};
    const columns = getStockWipColumns(stockWipActiveTab, stockWipMode);

    return state.allRecords.filter(row => {
        for (const col of columns) {
            const filter = activeFilters[col.key];
            if (!filter) continue;

            const rawVal = getStockWipCellValue(row, col);

            if (isStockWipNumericCol(col.key)) {
                const num = Number(rawVal);
                if (isNaN(num) || rawVal === '' || rawVal === null || rawVal === undefined) return false;
                const op = filter.operator;
                const v1 = filter.val1;
                const v2 = filter.val2;

                if (op === 'eq' && num !== v1) return false;
                if (op === 'neq' && num === v1) return false;
                if (op === 'gt' && num <= v1) return false;
                if (op === 'gte' && num < v1) return false;
                if (op === 'lt' && num >= v1) return false;
                if (op === 'lte' && num > v1) return false;
                if (op === 'between') {
                    if (v1 !== null && v1 !== undefined && num < v1) return false;
                    if (v2 !== null && v2 !== undefined && num > v2) return false;
                }
            } else {
                if (filter instanceof Set && filter.size > 0) {
                    let displayVal = rawVal;
                    if (col.key === 'created_at' && displayVal) {
                        try {
                            const d = new Date(displayVal);
                            displayVal = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        } catch (e) { }
                    }
                    if (!filter.has(String(displayVal))) return false;
                }
            }
        }
        return true;
    });
}

function renderStockWipGrid() {
    const state = stockWipTabState[stockWipActiveTab] || {
        allRecords: stockWipAllData,
        filters: {},
        distinctValues: {},
        page: stockWipCurrentPage,
        pageSize: stockWipPageSize
    };

    let filteredData = getFilteredStockWipData();

    if (stockWipSortColumn) {
        const columns = getStockWipColumns(stockWipActiveTab, stockWipMode);
        const colDef = columns.find(c => c.key === stockWipSortColumn) || { key: stockWipSortColumn };

        filteredData.sort((a, b) => {
            let valA = getStockWipCellValue(a, colDef);
            let valB = getStockWipCellValue(b, colDef);

            if (isStockWipNumericCol(stockWipSortColumn)) {
                valA = Number(valA) || 0;
                valB = Number(valB) || 0;
                return stockWipSortOrder === 'asc' ? valA - valB : valB - valA;
            } else {
                valA = String(valA || '').toLowerCase();
                valB = String(valB || '').toLowerCase();
                if (valA < valB) return stockWipSortOrder === 'asc' ? -1 : 1;
                if (valA > valB) return stockWipSortOrder === 'asc' ? 1 : -1;
                return 0;
            }
        });
    }

    const allRecords = state.allRecords || stockWipAllData;
    document.getElementById('stock-wip-kpi-total').textContent = allRecords.length;
    document.getElementById('stock-wip-kpi-valid').textContent = allRecords.filter(r => r.validation_status === 'VALID' || r['Validation Status'] === 'VALID').length;
    document.getElementById('stock-wip-kpi-invalid').textContent = allRecords.filter(r => r.validation_status === 'INVALID' || r['Validation Status'] === 'INVALID').length;
    document.getElementById('stock-wip-kpi-duplicate').textContent = allRecords.filter(r => r.validation_message === 'Duplicate Row' || r['Validation Message'] === 'Duplicate Row').length;

    const totalItems = filteredData.length;
    document.getElementById('stock-wip-total-items').textContent = totalItems;

    const pageSize = state.pageSize || stockWipPageSize;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (stockWipCurrentPage > totalPages) stockWipCurrentPage = totalPages;
    state.page = stockWipCurrentPage;

    const pageStart = totalItems === 0 ? 0 : (stockWipCurrentPage - 1) * pageSize + 1;
    const pageEnd = Math.min(stockWipCurrentPage * pageSize, totalItems);

    document.getElementById('stock-wip-page-start').textContent = pageStart;
    document.getElementById('stock-wip-page-end').textContent = pageEnd;

    const pageData = filteredData.slice(pageStart - 1, pageEnd);

    const thead = document.getElementById('stock-wip-thead');
    const tbody = document.getElementById('stock-wip-tbody');

    thead.innerHTML = '';
    tbody.innerHTML = '';

    const columns = getStockWipColumns(stockWipActiveTab, stockWipMode);

    const headerRow = document.createElement('tr');
    const indexTh = document.createElement('th');
    indexTh.style.width = '50px';
    indexTh.style.textAlign = 'center';
    indexTh.textContent = '#';
    headerRow.appendChild(indexTh);

    columns.forEach(col => {
        const th = document.createElement('th');
        th.style.cursor = 'pointer';

        const isSorted = stockWipSortColumn === col.key;
        const iconClass = isSorted ? (stockWipSortOrder === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort';

        const filter = state.filters && state.filters[col.key];
        let isFiltered = false;
        if (filter) {
            if (isStockWipNumericCol(col.key)) {
                isFiltered = filter.val1 !== undefined && filter.val1 !== null;
            } else if (filter instanceof Set) {
                isFiltered = filter.size > 0;
            }
        }

        th.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px;">
                <span class="stock-wip-th-label" style="display: inline-flex; align-items: center; gap: 4px; flex-grow: 1;">
                    ${col.label}
                    <i class="fa-solid ${iconClass}" style="font-size: 10px; opacity: ${isSorted ? 1 : 0.35};"></i>
                </span>
                <button id="stock-wip-filter-btn-${col.key}" class="stock-wip-col-filter-btn ${isFiltered ? 'active' : ''}" onclick="openStockWipFilter('${col.key}', event)" title="Filter by ${col.label}">
                    <i class="fa-solid ${isFiltered ? 'fa-filter-circle-xmark' : 'fa-filter'}"></i>
                </button>
            </div>
        `;

        th.querySelector('.stock-wip-th-label')?.addEventListener('click', (e) => {
            toggleStockWipSort(col.key);
        });

        const resizer = document.createElement('div');
        resizer.className = 'resizer';
        th.appendChild(resizer);

        headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);

    if (pageData.length === 0) {
        const emptyRow = document.createElement('tr');
        const emptyTd = document.createElement('td');
        emptyTd.colSpan = columns.length + 1;
        emptyTd.style.textAlign = 'center';
        emptyTd.style.padding = '32px 16px';
        emptyTd.style.color = 'var(--text-muted)';
        emptyTd.textContent = totalItems === 0 && allRecords.length > 0 ? 'No records match the active filter criteria.' : 'No records found.';
        emptyRow.appendChild(emptyTd);
        tbody.appendChild(emptyRow);
    } else {
        pageData.forEach((row, rowIndex) => {
            const tr = document.createElement('tr');

            const indexTd = document.createElement('td');
            indexTd.style.textAlign = 'center';
            indexTd.style.color = 'var(--text-secondary)';
            indexTd.textContent = pageStart + rowIndex;
            tr.appendChild(indexTd);

            const status = row.validation_status || row['Validation Status'] || '';
            const msg = row.validation_message || row['Validation Message'] || '';

            columns.forEach(col => {
                const td = document.createElement('td');
                let cellVal = getStockWipCellValue(row, col);

                if (col.key === 'created_at' && cellVal) {
                    try {
                        const d = new Date(cellVal);
                        cellVal = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    } catch (e) { }
                }

                if (status === 'INVALID' || status === 'Duplicate Row' || msg === 'Duplicate Row') {
                    let cellIsInvalid = false;

                    if (msg === 'Duplicate Row' || status === 'Duplicate Row') {
                        cellIsInvalid = true;
                    } else if (col.key === 'fabric_name' && (msg.includes('Fabric Not Found') || msg.includes('Fabric Name'))) {
                        cellIsInvalid = true;
                    } else if (col.key === 'product_name' && (msg.includes('Product Not Found') || msg.includes('Product Name'))) {
                        cellIsInvalid = true;
                    } else if (col.key === 'gsm' && (msg.includes('GSM') || msg.includes('Gsm') || msg.includes('Invalid GSM'))) {
                        cellIsInvalid = true;
                    } else if (col.key === 'dia' && (msg.includes('DIA') || msg.includes('Dia') || msg.includes('Invalid DIA'))) {
                        cellIsInvalid = true;
                    } else if (col.key === 'color' && (msg.includes('Color') || msg.includes('color'))) {
                        cellIsInvalid = true;
                    } else if (col.key === 'size' && (msg.includes('Size') || msg.includes('size'))) {
                        cellIsInvalid = true;
                    } else if (col.key === 'production_type' && (msg.includes('Production Type') || msg.includes('production_type'))) {
                        cellIsInvalid = true;
                    } else if (col.key === 'production_group' && (msg.includes('Production Group') || msg.includes('production_group'))) {
                        cellIsInvalid = true;
                    } else if ((col.key === 'qty' || col.key === 'weight_mtr') && (msg.includes('Qty') || msg.includes('qty') || msg.includes('greater than zero') || msg.includes('Weight'))) {
                        cellIsInvalid = true;
                    }

                    if (cellIsInvalid) {
                        td.className = 'cell-invalid';
                        td.setAttribute('data-error', msg);
                    }
                }

                if (col.key === 'validation_status') {
                    const badge = document.createElement('span');
                    badge.className = 'table-badge';
                    if (cellVal === 'VALID') {
                        badge.classList.add('badge-valid');
                        badge.textContent = 'VALID';
                    } else if (cellVal === 'INVALID') {
                        badge.classList.add('badge-invalid');
                        badge.textContent = 'INVALID';
                    } else {
                        badge.classList.add('badge-outline');
                        badge.textContent = 'UNVALIDATED';
                    }
                    td.appendChild(badge);
                } else if (col.key === 'validation_message') {
                    td.textContent = cellVal;
                    if (status === 'INVALID') {
                        td.style.color = 'var(--accent-red)';
                        td.style.fontWeight = '600';
                    } else if (status === 'VALID') {
                        td.style.color = 'var(--accent-green)';
                        td.style.fontWeight = '600';
                    }
                } else {
                    td.textContent = cellVal;
                }

                tr.appendChild(td);
            });

            tbody.appendChild(tr);
        });
    }

    let anyActive = false;
    if (state && state.filters) {
        Object.keys(state.filters).forEach(k => {
            const f = state.filters[k];
            if (f) {
                if (isStockWipNumericCol(k) && f.val1 !== undefined && f.val1 !== null) anyActive = true;
                else if (f instanceof Set && f.size > 0) anyActive = true;
            }
        });
    }
    const clearAllBtn = document.getElementById('stock-wip-clear-all-filters-btn');
    if (clearAllBtn) {
        if (anyActive) clearAllBtn.classList.remove('hidden');
        else clearAllBtn.classList.add('hidden');
    }

    renderStockWipPagination(totalPages);
    makeColumnsResizable();
}

function renderStockWipPagination(totalPages) {
    const container = document.getElementById('stock-wip-pagination-controls');
    if (!container) return;
    container.innerHTML = '';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'btn btn-outline btn-xs';
    prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
    prevBtn.disabled = stockWipCurrentPage === 1;
    prevBtn.addEventListener('click', () => {
        if (stockWipCurrentPage > 1) {
            stockWipCurrentPage--;
            renderStockWipGrid();
        }
    });
    container.appendChild(prevBtn);

    const range = 2;
    let startPage = Math.max(1, stockWipCurrentPage - range);
    let endPage = Math.min(totalPages, stockWipCurrentPage + range);

    if (startPage === 1) {
        endPage = Math.min(totalPages, 5);
    }
    if (endPage === totalPages) {
        startPage = Math.max(1, totalPages - 4);
    }
    for (let i = startPage; i <= endPage; i++) {
        const pageBtn = document.createElement('button');
        pageBtn.className = `btn btn-xs ${i === stockWipCurrentPage ? 'btn-primary' : 'btn-outline'}`;
        pageBtn.style.minWidth = '30px';
        pageBtn.textContent = i;
        pageBtn.addEventListener('click', () => {
            stockWipCurrentPage = i;
            renderStockWipGrid();
        });
        container.appendChild(pageBtn);
    }

    const nextBtn = document.createElement('button');
    nextBtn.className = 'btn btn-outline btn-xs';
    nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
    nextBtn.disabled = stockWipCurrentPage === totalPages;
    nextBtn.addEventListener('click', () => {
        if (stockWipCurrentPage < totalPages) {
            stockWipCurrentPage++;
            renderStockWipGrid();
        }
    });
    container.appendChild(nextBtn);
}

function makeColumnsResizable() {
    const table = document.getElementById('stock-wip-table');
    if (!table) return;
    const cols = table.querySelectorAll('thead th');
    cols.forEach(col => {
        const resizer = col.querySelector('.resizer');
        if (!resizer) return;

        let startX, startWidth;
        resizer.addEventListener('mousedown', function (e) {
            startX = e.pageX;
            startWidth = col.offsetWidth;
            col.classList.add('resizing');

            function onMouseMove(e) {
                const width = startWidth + (e.pageX - startX);
                col.style.width = width + 'px';
            }

            function onMouseUp() {
                col.classList.remove('resizing');
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            }

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    });
}

// =====================================================================
// BALANCE REQUIRED QUANTITY MODULE CLIENT HANDLERS
// =====================================================================

let balanceQtyMetadata = null;
let balanceQtyCurrentPage = 1;
let balanceQtyActiveTab = 'standalone';
let expandedCommonRows = {};
let balanceQtyColumnFilters = {};
let balanceQtyAllData = [];
let balanceQtyFilteredData = [];
let balanceQtyFabricAllData = [];
let balanceQtyFabricFilteredData = [];
let balanceQtyFabricTotals = { fabric_req: 0, fabric_stock: 0, fabric_wip: 0, bal_required_fab: 0 };
let balanceQtyConsider = { fg: true, wip: true, pending: true };

function toggleBalanceQtyConsiderDropdown(event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById('balance-qty-consider-dropdown');
    if (dropdown) {
        dropdown.classList.toggle('hidden');
    }
}

function onBalanceQtyConsiderChange() {
    const fgCheck = document.getElementById('consider-fg-stock');
    const wipCheck = document.getElementById('consider-wip-qty');
    const pendingCheck = document.getElementById('consider-pending-qty');

    balanceQtyConsider.fg = fgCheck ? fgCheck.checked : true;
    balanceQtyConsider.wip = wipCheck ? wipCheck.checked : true;
    balanceQtyConsider.pending = pendingCheck ? pendingCheck.checked : true;

    updateBalanceQtyConsiderSummary();
    loadBalanceQtyData(1);
}

function updateBalanceQtyConsiderSummary() {
    const summaryEl = document.getElementById('balance-qty-consider-summary');
    if (!summaryEl) return;

    const selected = [];
    if (balanceQtyConsider.fg) selected.push('FG');
    if (balanceQtyConsider.wip) selected.push('WIP');
    if (balanceQtyConsider.pending) selected.push('Pending');

    if (selected.length === 3) {
        summaryEl.textContent = 'All Selected (3)';
    } else if (selected.length === 0) {
        summaryEl.textContent = 'None Selected (0)';
    } else {
        summaryEl.textContent = selected.join(', ');
    }
}

function getBalanceQtyConsiderParams() {
    return `&consider_fg=${balanceQtyConsider.fg}&consider_wip=${balanceQtyConsider.wip}&consider_pending=${balanceQtyConsider.pending}`;
}

// Close consider dropdown when clicking outside
document.addEventListener('click', function (e) {
    const dropdown = document.getElementById('balance-qty-consider-dropdown');
    const btn = document.getElementById('balance-qty-consider-btn');
    if (dropdown && !dropdown.classList.contains('hidden')) {
        if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    }
});

async function initializeBalanceQtyTab() {
    const planSelect = document.getElementById('balance-qty-plan-select');
    const versionSelect = document.getElementById('balance-qty-version-select');

    planSelect.innerHTML = '<option value="">Loading Plans...</option>';
    versionSelect.innerHTML = '<option value="">Loading Versions...</option>';

    // Initialize date inputs if empty
    const fromDateInput = document.getElementById('balance-qty-from-date');
    const toDateInput = document.getElementById('balance-qty-to-date');
    if (fromDateInput && !fromDateInput.value) {
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);

        const formatDate = (d) => {
            const month = '' + (d.getMonth() + 1);
            const day = '' + d.getDate();
            const year = d.getFullYear();
            return [year, month.padStart(2, '0'), day.padStart(2, '0')].join('-');
        };
        fromDateInput.value = formatDate(firstDay);
        toDateInput.value = formatDate(lastDay);
    }

    try {
        const response = await fetch('/api/balance-qty/meta');
        const data = await response.json();

        if (!data.success) {
            showToast('Error', data.message || 'Failed to load metadata', 'error');
            return;
        }

        balanceQtyMetadata = data.plans;

        if (balanceQtyMetadata.length === 0) {
            planSelect.innerHTML = '<option value="">No Plans Found</option>';
            versionSelect.innerHTML = '<option value="">No Versions Found</option>';
            return;
        }

        planSelect.innerHTML = '';
        balanceQtyMetadata.forEach(p => {
            const opt = document.createElement('option');
            opt.value = `${p.plan_name}|${p.financial_year}`;
            opt.textContent = `${p.plan_name} (${p.financial_year})`;
            planSelect.appendChild(opt);
        });

        onBalanceQtyPlanChange();
    } catch (err) {
        showToast('Error', 'Failed to connect to API', 'error');
        console.error(err);
    }
}

function switchBalanceQtySubTab(tab) {
    balanceQtyActiveTab = tab;
    balanceQtyColumnFilters = {};

    // Update active tab button classes
    const standaloneBtn = document.getElementById('balance-qty-tab-standalone');
    const commonBtn = document.getElementById('balance-qty-tab-common');
    const fabricBtn = document.getElementById('balance-qty-tab-fabric');

    if (standaloneBtn) standaloneBtn.classList.remove('active');
    if (commonBtn) commonBtn.classList.remove('active');
    if (fabricBtn) fabricBtn.classList.remove('active');

    if (tab === 'common' && commonBtn) {
        commonBtn.classList.add('active');
    } else if (tab === 'fabric' && fabricBtn) {
        fabricBtn.classList.add('active');
    } else if (standaloneBtn) {
        standaloneBtn.classList.add('active');
    }

    // Update filter placeholder and table header
    const productFilterInput = document.getElementById('balance-qty-product-filter');
    const productFilterSelect = document.getElementById('balance-qty-product-select-filter');
    const productHeader = document.getElementById('balance-qty-product-th');

    if (tab === 'common') {
        if (productFilterInput) {
            productFilterInput.classList.add('hidden');
            productFilterInput.value = '';
        }
        if (productFilterSelect) {
            productFilterSelect.classList.remove('hidden');
            fetchCommonProductionsForFilter();
        }
    } else if (tab === 'fabric') {
        if (productFilterInput) {
            productFilterInput.classList.remove('hidden');
            productFilterInput.value = '';
            productFilterInput.placeholder = 'Filter Product/Common Group...';
        }
        if (productFilterSelect) {
            productFilterSelect.classList.add('hidden');
            productFilterSelect.value = '';
        }
    } else {
        if (productFilterInput) {
            productFilterInput.classList.remove('hidden');
            productFilterInput.value = '';
            productFilterInput.placeholder = 'Filter Product...';
        }
        if (productFilterSelect) {
            productFilterSelect.classList.add('hidden');
            productFilterSelect.value = '';
        }
    }

    if (productHeader && tab !== 'fabric') {
        if (tab === 'common') {
            productHeader.textContent = 'Product / Common Group';
        } else {
            productHeader.textContent = 'Product';
        }
    }

    // Reload data for page 1
    loadBalanceQtyData(1);
}

async function fetchCommonProductionsForFilter() {
    try {
        const response = await fetch('/api/masters/common-production?status=Active');
        const data = await response.json();
        if (response.ok && data.success) {
            const select = document.getElementById('balance-qty-product-select-filter');
            if (select) {
                const currentVal = select.value;
                select.innerHTML = '<option value="">All Groups</option>';
                data.common_productions.forEach(item => {
                    const opt = document.createElement('option');
                    opt.value = item.common_production_name;
                    opt.innerText = item.common_production_name;
                    select.appendChild(opt);
                });
                select.value = currentVal;
            }
        }
    } catch (err) {
        console.error("Error fetching common productions for filter select:", err);
    }
}

function onBalanceQtyPlanChange() {
    const planSelect = document.getElementById('balance-qty-plan-select');
    const versionSelect = document.getElementById('balance-qty-version-select');

    const val = planSelect.value;
    if (!val) {
        versionSelect.innerHTML = '<option value="">Select Plan First</option>';
        return;
    }

    const [plan_name, fy] = val.split('|');
    const planMeta = balanceQtyMetadata.find(p => p.plan_name === plan_name && p.financial_year === fy);

    versionSelect.innerHTML = '';
    if (planMeta && planMeta.versions) {
        planMeta.versions.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = v;
            versionSelect.appendChild(opt);
        });
    }

    loadBalanceQtyData(1);
}

async function loadBalanceQtyData(page = 1, forceRecalculate = false) {
    const loader = document.getElementById('balance-qty-loader');
    if (loader) loader.classList.remove('hidden');

    // Reset page and clear column filters because a top level filter parameter has changed
    balanceQtyCurrentPage = 1;
    balanceQtyColumnFilters = {};

    const planVal = document.getElementById('balance-qty-plan-select').value;
    if (!planVal) {
        if (loader) loader.classList.add('hidden');
        return;
    }

    const [plan_name, financial_year] = planVal.split('|');
    const version = document.getElementById('balance-qty-version-select').value;
    const fromDate = document.getElementById('balance-qty-from-date').value;
    const toDate = document.getElementById('balance-qty-to-date').value;
    const brand = document.getElementById('balance-qty-brand-filter').value;
    const category = document.getElementById('balance-qty-category-filter').value;
    const product = balanceQtyActiveTab === 'common'
        ? document.getElementById('balance-qty-product-select-filter').value
        : document.getElementById('balance-qty-product-filter').value;
    const search = document.getElementById('balance-qty-search').value;

    if (!fromDate || !toDate) {
        if (loader) loader.classList.add('hidden');
        showToast('Warning', 'Both From Date and To Date are mandatory.', 'warning');
        return;
    }

    if (new Date(fromDate) > new Date(toDate)) {
        if (loader) loader.classList.add('hidden');
        showToast('Warning', 'From Date cannot be greater than To Date.', 'warning');
        return;
    }

    // Always fetch ALL matching rows for the current top level filter set using all=true
    const isFabric = balanceQtyActiveTab === 'fabric';
    const endpoint = isFabric ? '/api/fabric-req/data' : '/api/balance-qty/data';
    let url = `${endpoint}?plan_name=${encodeURIComponent(plan_name)}&financial_year=${encodeURIComponent(financial_year)}&version=${encodeURIComponent(version)}&all=true&from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}&consider_fg=${balanceQtyConsider.fg}&consider_wip=${balanceQtyConsider.wip}&consider_pending=${balanceQtyConsider.pending}&_=${Date.now()}`;

    if (!isFabric) {
        url += `&tab=${balanceQtyActiveTab}`;
    }

    if (brand) url += `&brand=${encodeURIComponent(brand)}`;
    if (category) url += `&category=${encodeURIComponent(category)}`;
    if (product) url += `&product=${encodeURIComponent(product)}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (forceRecalculate) url += `&recalculate=true`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (loader) loader.classList.add('hidden');

        if (!data.success) {
            showToast('Error', data.message || 'Failed to load balance qty details', 'error');
            return;
        }

        if (isFabric) {
            balanceQtyFabricAllData = data.rows || [];
            balanceQtyFabricTotals = data.totals || { fabric_req: 0, fabric_stock: 0, fabric_wip: 0, bal_required_fab: 0 };
            processFabricReqFiltersAndRender();
        } else {
            balanceQtyAllData = data.rows || [];
            processBalanceQtyFiltersAndRender();
        }
    } catch (err) {
        if (loader) loader.classList.add('hidden');
        showToast('Error', 'Connection error loading data', 'error');
        console.error(err);
    }
}

function getFabricDetailUrl(fabricName) {
    const planVal = document.getElementById('balance-qty-plan-select')?.value || '';
    const [plan_name, financial_year] = planVal.split('|');
    const version = document.getElementById('balance-qty-version-select')?.value || '';
    const fromDate = document.getElementById('balance-qty-from-date')?.value || '';
    const toDate = document.getElementById('balance-qty-to-date')?.value || '';
    const brand = document.getElementById('balance-qty-brand-filter')?.value || '';
    const category = document.getElementById('balance-qty-category-filter')?.value || '';
    const product = (balanceQtyActiveTab === 'common'
        ? document.getElementById('balance-qty-product-select-filter')?.value
        : document.getElementById('balance-qty-product-filter')?.value) || '';
    const search = document.getElementById('balance-qty-search')?.value || '';

    const params = new URLSearchParams();
    if (fabricName) params.set('fabric', fabricName);
    if (plan_name) params.set('plan_name', plan_name);
    if (financial_year) params.set('financial_year', financial_year);
    if (version) params.set('version', version);
    if (fromDate) params.set('from_date', fromDate);
    if (toDate) params.set('to_date', toDate);
    if (brand) params.set('brand', brand);
    if (category) params.set('category', category);
    if (product) params.set('product', product);
    if (search) params.set('search', search);
    params.set('consider_fg', balanceQtyConsider.fg);
    params.set('consider_wip', balanceQtyConsider.wip);
    params.set('consider_pending', balanceQtyConsider.pending);

    return `/fabric-requirement-detail?${params.toString()}`;
}

function renderBalanceQtyGrid(rows) {
    const tbody = document.getElementById('balance-qty-tbody');
    tbody.innerHTML = '';

    if (rows.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="14" style="text-align: center; color: var(--text-muted); padding: 32px 16px;">
                    No planning records match the selected criteria.
                </td>
            </tr>
        `;
        return;
    }

    rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.id = `balance-row-${r.id}`;

        const pathBadge = balanceQtyActiveTab === 'common'
            ? `<span class="badge" style="background: rgba(16, 185, 129, 0.1); color: var(--accent-green); border: 1px solid rgba(16, 185, 129, 0.2);">Common Path</span>`
            : `<span class="badge" style="background: rgba(107, 114, 128, 0.1); color: var(--text-secondary); border: 1px solid rgba(107, 114, 128, 0.2);">Standalone</span>`;

        const detailsBtn = balanceQtyActiveTab === 'common'
            ? `<button class="btn btn-sm btn-outline btn-toggle-expand" style="padding: 2px 6px; font-size: 11px;" onclick="toggleCommonGroupMembers('${r.from_date}', '${r.to_date}', '${r.common_production_name}', '${r.size}', '${r.color}', this, '${r.global_color_code || ''}')">
                   <i class="fa-solid fa-chevron-right"></i>
               </button>`
            : `<span style="color: var(--text-muted); font-size: 12px;">-</span>`;

        const fabricDisplay = r.fabric_name
            ? `<a class="fabric-link-btn" href="${getFabricDetailUrl(r.fabric_name)}" target="_blank" rel="noopener noreferrer" title="View Fabric Details for ${r.fabric_name}">${r.fabric_name}</a>`
            : '-';

        tr.innerHTML = `
            <td style="text-align: center; vertical-align: middle;">${detailsBtn}</td>
            <td>${r.from_date} to ${r.to_date}</td>
            <td>${r.brand || '-'}</td>
            <td>${r.category || '-'}</td>
            <td><strong>${r.product}</strong></td>
            <td>${fabricDisplay}</td>
            <td>${r.color || '-'}</td>
            <td><span class="badge badge-outline">${r.size}</span></td>
            <td class="text-right">${Number(r.calculated_qty).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
            <td class="text-right">${Number(r.finished_goods_qty).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
            <td class="text-right">${Number(r.production_wip_qty).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
            <td class="text-right">${Number(r.pending_production_qty).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
            <td class="text-right" style="background: rgba(59, 130, 246, 0.05); font-weight: 700; color: var(--accent-blue);">${Number(r.bal_required_qty).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
            <td style="text-align: center; vertical-align: middle;">${pathBadge}</td>
        `;

        tbody.appendChild(tr);
    });
}

let currentBalanceFilterColumn = null;

function renderBalanceQtyHeaders() {
    const thead = document.querySelector('#table-balance-qty thead');
    if (!thead) return;

    if (balanceQtyActiveTab === 'fabric') {
        renderFabricReqHeaders();
        return;
    }

    const productTitle = balanceQtyActiveTab === 'common' ? 'Product / Common Group' : 'Product';

    thead.innerHTML = `
        <tr style="position: sticky; top:0; background: var(--bg-card); z-index:2; box-shadow: inset 0 -1px 0 var(--border-color);">
            <th style="width: 50px; text-align: center;">Details</th>
            ${getBalanceThHtml('Period', 'period')}
            ${getBalanceThHtml('Brand', 'brand')}
            ${getBalanceThHtml('Category', 'category')}
            ${getBalanceThHtml(productTitle, 'product')}
            ${getBalanceThHtml('Fabric Name', 'fabric_name')}
            ${getBalanceThHtml('Color', 'color')}
            ${getBalanceThHtml('Size', 'size')}
            ${getBalanceThHtml('Req Qty', 'calculated_qty', true)}
            ${getBalanceThHtml('FG Stock', 'finished_goods_qty', true)}
            ${getBalanceThHtml('WIP Qty', 'production_wip_qty', true)}
            ${getBalanceThHtml('Pending Qty', 'pending_production_qty', true)}
            ${getBalanceThHtml('Bal Req Qty', 'bal_required_qty', true, 'background: rgba(59, 130, 246, 0.1); color: var(--accent-blue); font-weight: 700;')}
            ${getBalanceThHtml('Path Type', 'production_type', false, 'width: 120px; text-align: center;')}
        </tr>
    `;
}

function getBalanceThHtml(title, colKey, isRightAligned = false, customStyle = '') {
    const active = isBalanceFilterActive(colKey);
    const alignClass = isRightAligned ? 'text-right' : '';
    const justifyStyle = isRightAligned ? 'justify-content: flex-end;' : 'justify-content: space-between;';
    const styleAttr = customStyle ? `style="${customStyle}"` : '';

    return `
        <th ${styleAttr} class="${alignClass}" style="position: relative;">
            <div style="display: flex; align-items: center; ${justifyStyle} gap: 4px; width: 100%;">
                <span>${title}</span>
                <i class="fa-solid fa-filter" id="balance-filter-btn-${colKey}" onclick="toggleBalanceFilterPopup(event, '${colKey}')" 
                   style="cursor: pointer; font-size: 11px; margin-left: 4px; transition: color 0.2s; color: ${active ? 'var(--accent-blue)' : 'var(--text-secondary)'}; opacity: ${active ? '1' : '0.6'};"
                   title="Filter ${title}"></i>
            </div>
        </th>
    `;
}

function isBalanceFilterActive(colKey) {
    const filter = balanceQtyColumnFilters[colKey];
    if (!filter) return false;
    return filter.selectedSet && filter.selectedSet.size > 0;
}

function toggleBalanceFilterPopup(event, colKey) {
    event.stopPropagation();

    const existing = document.getElementById('balance-filter-popup');
    if (existing) {
        existing.remove();
        if (currentBalanceFilterColumn === colKey) {
            currentBalanceFilterColumn = null;
            return;
        }
    }

    currentBalanceFilterColumn = colKey;

    const rect = event.target.getBoundingClientRect();
    const top = rect.bottom + window.scrollY + 6;
    const left = Math.max(10, rect.left + window.scrollX - 160);

    const popup = document.createElement('div');
    popup.id = 'balance-filter-popup';
    popup.style.position = 'absolute';
    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
    popup.style.zIndex = '9999';
    popup.style.background = '#202433';
    popup.style.border = '1px solid rgba(255,255,255,0.12)';
    popup.style.borderRadius = '8px';
    popup.style.boxShadow = '0 8px 24px rgba(0,0,0,0.5)';
    popup.style.width = '240px';
    popup.style.padding = '12px';
    popup.style.display = 'flex';
    popup.style.flexDirection = 'column';
    popup.style.gap = '10px';
    popup.onclick = (e) => e.stopPropagation();

    const colFilter = balanceQtyColumnFilters[colKey] || { selectedList: [] };

    // Gather unique values for this column from active tab data
    const uniqueValuesSet = new Set();
    const targetData = balanceQtyActiveTab === 'fabric' ? balanceQtyFabricAllData : balanceQtyAllData;
    targetData.forEach(row => {
        uniqueValuesSet.add(getBalanceRowValueFormatted(row, colKey));
    });

    const sortedUniqueValues = Array.from(uniqueValuesSet).sort((a, b) => {
        const na = parseFloat(a);
        const nb = parseFloat(b);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });

    const selSet = new Set(colFilter.selectedList || []);
    const isFilteredChecklist = selSet.size > 0;

    let checklistHtml = sortedUniqueValues.map(val => {
        const isChecked = isFilteredChecklist ? selSet.has(val) : true;
        const displayVal = val === '' ? '(Blank)' : val;
        return `
            <label class="checkbox-container balance-checklist-item" style="display: flex; align-items: center; gap: 8px; margin: 4px 0; font-size: 12px; font-weight: normal; cursor: pointer; color: var(--text-primary);">
                <input type="checkbox" class="balance-filter-checklist-checkbox" value="${val}" ${isChecked ? 'checked' : ''} onchange="onBalanceChecklistItemChange()">
                <span class="checkmark"></span>
                <span>${displayVal}</span>
            </label>
        `;
    }).join('');

    let html = `
        <div style="font-weight: 700; font-size: 11px; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 2px;">
            Checklist Filter
        </div>
        <input type="text" id="balance-checklist-search" placeholder="Search values..." oninput="onBalanceChecklistSearch(this.value)"
            style="width: 100%; padding: 6px; border: 1px solid var(--border-color); background: rgba(0,0,0,0.3); color: var(--text-primary); border-radius: 4px; outline: none; font-size: 12px;">
        <div style="max-height: 140px; overflow-y: auto; padding: 4px; background: rgba(0,0,0,0.15); border: 1px solid var(--border-color); border-radius: 4px;" id="balance-checklist-container">
            <label class="checkbox-container" style="display: flex; align-items: center; gap: 8px; margin: 4px 0; font-size: 12px; font-weight: bold; cursor: pointer;">
                <input type="checkbox" id="balance-filter-select-all" ${!isFilteredChecklist ? 'checked' : ''} onchange="onBalanceFilterToggleSelectAll(this)">
                <span class="checkmark"></span>
                <span>(Select All)</span>
            </label>
            <div id="balance-checklist-items-wrapper">
                ${checklistHtml}
            </div>
        </div>
        
        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px;">
            <button class="btn btn-outline btn-xs" onclick="closeBalanceFilterPopup()" style="padding: 4px 8px; font-size: 11px;">Cancel</button>
            <button class="btn btn-outline btn-xs" onclick="clearBalanceFilter('${colKey}')" style="padding: 4px 8px; font-size: 11px; color: var(--accent-red);">Clear Filter</button>
            <button class="btn btn-primary btn-xs" onclick="applyBalanceFilter('${colKey}')" style="padding: 4px 8px; font-size: 11px;">Apply</button>
        </div>
    `;

    popup.innerHTML = html;
    document.body.appendChild(popup);

    if (!window.balanceFilterOutsideClickRegistered) {
        document.addEventListener('click', (e) => {
            const pop = document.getElementById('balance-filter-popup');
            if (pop && !pop.contains(e.target) && !e.target.classList.contains('fa-filter')) {
                pop.remove();
                currentBalanceFilterColumn = null;
            }
        });
        window.balanceFilterOutsideClickRegistered = true;
    }
}

function onBalanceChecklistSearch(term) {
    const query = term.toLowerCase().trim();
    const items = document.querySelectorAll('.balance-checklist-item');
    items.forEach(item => {
        const valText = item.querySelector('span:last-child').textContent.toLowerCase();
        if (valText.includes(query)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

function onBalanceFilterToggleSelectAll(selectAllCheckbox) {
    const checkboxes = document.querySelectorAll('.balance-filter-checklist-checkbox');
    checkboxes.forEach(cb => {
        const parent = cb.closest('.balance-checklist-item');
        if (parent && parent.style.display !== 'none') {
            cb.checked = selectAllCheckbox.checked;
        }
    });
}

function onBalanceChecklistItemChange() {
    const selectAllCheckbox = document.getElementById('balance-filter-select-all');
    if (!selectAllCheckbox) return;

    const checkboxes = Array.from(document.querySelectorAll('.balance-filter-checklist-checkbox'));
    const allChecked = checkboxes.every(cb => cb.checked);
    const noneChecked = checkboxes.every(cb => !cb.checked);

    if (allChecked) {
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
    } else if (noneChecked) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    } else {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true;
    }
}

function closeBalanceFilterPopup() {
    const pop = document.getElementById('balance-filter-popup');
    if (pop) pop.remove();
    currentBalanceFilterColumn = null;
}

function clearBalanceFilter(colKey) {
    delete balanceQtyColumnFilters[colKey];
    closeBalanceFilterPopup();
    if (balanceQtyActiveTab === 'fabric') {
        processFabricReqFiltersAndRender();
    } else {
        processBalanceQtyFiltersAndRender();
    }
}

function applyBalanceFilter(colKey) {
    const selectAllCheckbox = document.getElementById('balance-filter-select-all');
    let selectedList = [];

    if (selectAllCheckbox && (!selectAllCheckbox.checked || selectAllCheckbox.indeterminate)) {
        const checkboxes = document.querySelectorAll('.balance-filter-checklist-checkbox');
        checkboxes.forEach(cb => {
            if (cb.checked) {
                selectedList.push(cb.value);
            }
        });
    }

    balanceQtyColumnFilters[colKey] = {
        selectedList: selectedList,
        selectedSet: new Set(selectedList)
    };

    closeBalanceFilterPopup();
    if (balanceQtyActiveTab === 'fabric') {
        processFabricReqFiltersAndRender();
    } else {
        processBalanceQtyFiltersAndRender();
    }
}

function getBalanceRowValue(row, colKey) {
    if (colKey === 'period') {
        return `${row.from_date} to ${row.to_date}`;
    }
    if (colKey === 'production_type') {
        return balanceQtyActiveTab === 'common' ? 'Common Path' : 'Standalone';
    }
    return row[colKey];
}

function getBalanceRowValueFormatted(row, colKey) {
    const val = getBalanceRowValue(row, colKey);
    if (val === null || val === undefined) return '';
    return val.toString().trim();
}

function applyBalanceQtyColumnFilters(dataList) {
    let result = [...dataList];

    for (const [colKey, filterState] of Object.entries(balanceQtyColumnFilters)) {
        if (!filterState) continue;

        const { selectedSet } = filterState;

        // Apply checklist selections rule
        if (selectedSet && selectedSet.size > 0) {
            result = result.filter(row => {
                const val = getBalanceRowValueFormatted(row, colKey);
                return selectedSet.has(val);
            });
        }
    }

    return result;
}

function processBalanceQtyFiltersAndRender() {
    balanceQtyFilteredData = applyBalanceQtyColumnFilters(balanceQtyAllData);

    // Update headers to refresh filter active colors
    renderBalanceQtyHeaders();

    const perPage = parseInt(document.getElementById('balance-qty-per-page').value) || 50;

    // Calculate total pages
    const totalCount = balanceQtyFilteredData.length;
    const totalPages = Math.ceil(totalCount / perPage) || 1;
    if (balanceQtyCurrentPage > totalPages) {
        balanceQtyCurrentPage = totalPages;
    }

    // Get visible page subset
    const startIndex = (balanceQtyCurrentPage - 1) * perPage;
    const pageSubset = balanceQtyFilteredData.slice(startIndex, startIndex + perPage);

    // Render
    renderBalanceQtyGrid(pageSubset);
    renderBalanceQtyPagination(totalCount, perPage, balanceQtyCurrentPage);
    document.getElementById('balance-qty-total-count').textContent = totalCount;
}

function renderBalanceQtyPagination(totalCount, perPage, currentPage) {
    const container = document.getElementById('balance-qty-pagination');
    container.innerHTML = '';

    const totalPages = Math.ceil(totalCount / perPage);
    if (totalPages <= 1) return;

    const maxVisible = 5;
    let startPage = Math.max(1, currentPage - 2);
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);

    if (endPage - startPage < maxVisible - 1) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }

    if (currentPage > 1) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm btn-outline';
        btn.innerHTML = '<i class="fa-solid fa-angles-left"></i>';
        btn.onclick = () => changeBalanceQtyPage(1);
        container.appendChild(btn);
    }

    for (let i = startPage; i <= endPage; i++) {
        const btn = document.createElement('button');
        btn.className = `btn btn-sm ${i === currentPage ? 'btn-primary' : 'btn-outline'}`;
        btn.textContent = i;
        btn.onclick = () => changeBalanceQtyPage(i);
        container.appendChild(btn);
    }

    if (currentPage < totalPages) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm btn-outline';
        btn.innerHTML = '<i class="fa-solid fa-angles-right"></i>';
        btn.onclick = () => changeBalanceQtyPage(totalPages);
        container.appendChild(btn);
    }
}

function changeBalanceQtyPage(page) {
    balanceQtyCurrentPage = page;
    processBalanceQtyFiltersAndRender();
}

function recalculateBalanceQty() {
    loadBalanceQtyData(1, true);
}

function exportBalanceQtyExcel() {
    if (balanceQtyActiveTab === 'fabric') {
        exportFabricReqExcel();
        return;
    }

    const planVal = document.getElementById('balance-qty-plan-select').value;
    if (!planVal) {
        showToast('Warning', 'Please select a valid Plan first.', 'warning');
        return;
    }

    if (!balanceQtyFilteredData || balanceQtyFilteredData.length === 0) {
        showToast('Warning', 'No filtered data to export.', 'warning');
        return;
    }

    const headers = [
        'Period',
        'Brand',
        'Category',
        balanceQtyActiveTab === 'common' ? 'Product / Common Group' : 'Product',
        'Fabric Name',
        'Color',
        'Size',
        'Req Qty',
        'FG Stock',
        'WIP Qty',
        'Pending Qty',
        'Bal Req Qty',
        'Path Type'
    ];

    const dataRows = balanceQtyFilteredData.map(r => [
        `${r.from_date} to ${r.to_date}`,
        r.brand || '',
        r.category || '',
        r.product || '',
        r.fabric_name || '',
        r.color || '',
        r.size || '',
        Number(r.calculated_qty || 0),
        Number(r.finished_goods_qty || 0),
        Number(r.production_wip_qty || 0),
        Number(r.pending_production_qty || 0),
        Number(r.bal_required_qty || 0),
        balanceQtyActiveTab === 'common' ? 'Common Path' : 'Standalone'
    ]);

    const sheetData = [headers, ...dataRows];
    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);

    // Auto-size columns where practical
    const max_cols = headers.length;
    const colWidths = [];
    for (let c = 0; c < max_cols; c++) {
        let max_len = headers[c].length;
        for (let r = 0; r < sheetData.length; r++) {
            const cellVal = sheetData[r][c];
            if (cellVal !== null && cellVal !== undefined) {
                const len = cellVal.toString().length;
                if (len > max_len) max_len = len;
            }
        }
        colWidths.push({ wch: Math.min(50, Math.max(10, max_len + 2)) });
    }
    worksheet['!cols'] = colWidths;

    // Excel autofilter
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    worksheet['!autofilter'] = { ref: XLSX.utils.encode_range(range) };

    // Freeze header row
    worksheet['!views'] = [{
        state: 'frozen',
        ySplit: 1,
        xSplit: 0,
        topLeftCell: 'A2',
        activePane: 'bottomLeft'
    }];

    // Workbook
    const workbook = XLSX.utils.book_new();
    const sheetName = balanceQtyActiveTab === 'common' ? 'Common Production' : 'Standalone';
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

    // Filename: Balance_Required_Qty_Standalone_2026-08-21.xlsx
    const todayStr = new Date().toISOString().split('T')[0];
    const typeLabel = balanceQtyActiveTab === 'common' ? 'Common' : 'Standalone';
    const filename = `Balance_Required_Qty_${typeLabel}_${todayStr}.xlsx`;

    XLSX.writeFile(workbook, filename);
}

function processFabricReqFiltersAndRender() {
    balanceQtyFabricFilteredData = applyBalanceQtyColumnFilters(balanceQtyFabricAllData);

    // Render header column filter icons state
    renderFabricReqHeaders();

    const perPage = parseInt(document.getElementById('balance-qty-per-page').value) || 50;

    // Calculate total pages
    const totalCount = balanceQtyFabricFilteredData.length;
    const totalPages = Math.ceil(totalCount / perPage) || 1;
    if (balanceQtyCurrentPage > totalPages) {
        balanceQtyCurrentPage = totalPages;
    }

    // Get visible page subset
    const startIndex = (balanceQtyCurrentPage - 1) * perPage;
    const pageSubset = balanceQtyFabricFilteredData.slice(startIndex, startIndex + perPage);

    // Render Summary Table
    renderFabricReqGrid(pageSubset);
    renderBalanceQtyPagination(totalCount, perPage, balanceQtyCurrentPage);
    document.getElementById('balance-qty-total-count').textContent = totalCount;
}

function renderFabricReqHeaders() {
    const thead = document.querySelector('#table-balance-qty thead');
    if (!thead) return;

    thead.innerHTML = `
        <tr style="position: sticky; top:0; background: var(--bg-card); z-index:2; box-shadow: inset 0 -1px 0 var(--border-color);">
            <th style="width: 50px; text-align: center;">Details</th>
            ${getBalanceThHtml('Fabric Name', 'fabric_name')}
            ${getBalanceThHtml('Color', 'color')}
            ${getBalanceThHtml('Dia', 'dia')}
            ${getBalanceThHtml('Fabric Req', 'fabric_req', true)}
            ${getBalanceThHtml('Fabric Stock', 'fabric_stock', true)}
            ${getBalanceThHtml('Fabric WIP', 'fabric_wip', true)}
            ${getBalanceThHtml('Bal Required Fab', 'bal_required_fab', true, 'background: rgba(59, 130, 246, 0.1); color: var(--accent-blue); font-weight: 700;')}
            ${getBalanceThHtml('Excess Qty', 'excess_qty', true, 'background: rgba(16, 185, 129, 0.1); color: var(--accent-green); font-weight: 700;')}
        </tr>
    `;
}

function renderFabricReqGrid(rows) {
    const tbody = document.getElementById('balance-qty-tbody');
    tbody.innerHTML = '';

    if (rows.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; color: var(--text-muted); padding: 32px 16px;">
                    No fabric requirements match the selected criteria.
                </td>
            </tr>
        `;
        return;
    }

    rows.forEach(r => {
        const tr = document.createElement('tr');
        // Safety ID escape
        const rowId = `fabric-row-${r.fabric_name.replace(/\s+/g, '_')}-${(r.color || '').replace(/\s+/g, '_')}-${r.dia}`;
        tr.id = rowId;

        const detailsBtn = `<button class="btn btn-sm btn-outline btn-toggle-expand" style="padding: 2px 6px; font-size: 11px;" 
            onclick="toggleFabricReqDetails('${r.fabric_name.replace(/'/g, "\\'")}', '${(r.color || '').replace(/'/g, "\\'")}', ${r.dia}, this)">
               <i class="fa-solid fa-chevron-right"></i>
           </button>`;

        // Format Dia with a double quote sign " (e.g. 60")
        const diaText = r.dia ? `${r.dia}"` : '-';

        const fabricLink = `<a class="fabric-link-btn" href="${getFabricDetailUrl(r.fabric_name)}" target="_blank" rel="noopener noreferrer" title="View Fabric Details for ${r.fabric_name}"><strong>${r.fabric_name}</strong></a>`;

        tr.innerHTML = `
            <td style="text-align: center; vertical-align: middle;">${detailsBtn}</td>
            <td>${fabricLink}</td>
            <td>${r.color || '-'}</td>
            <td><span class="badge badge-outline">${diaText}</span></td>
            <td class="text-right">${Number(r.fabric_req).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td class="text-right">${Number(r.fabric_stock).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td class="text-right">${Number(r.fabric_wip).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td class="text-right" style="background: rgba(59, 130, 246, 0.05); font-weight: 700; color: var(--accent-blue);">${Number(r.bal_required_fab).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td class="text-right" style="background: rgba(16, 185, 129, 0.05); font-weight: 700; color: var(--accent-green);">${Number(r.excess_qty || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        `;

        tbody.appendChild(tr);
    });

    // Render total row
    const totals = balanceQtyFabricTotals || { fabric_req: 0, fabric_stock: 0, fabric_wip: 0, bal_required_fab: 0, excess_qty: 0 };

    // Recalculate totals of currently filtered summary dataset if client-side column filters are active
    let shownTotals = { ...totals };
    if (Object.keys(balanceQtyColumnFilters).length > 0) {
        shownTotals.fabric_req = balanceQtyFabricFilteredData.reduce((sum, r) => sum + r.fabric_req, 0);
        shownTotals.fabric_stock = balanceQtyFabricFilteredData.reduce((sum, r) => sum + r.fabric_stock, 0);
        shownTotals.fabric_wip = balanceQtyFabricFilteredData.reduce((sum, r) => sum + r.fabric_wip, 0);
        shownTotals.bal_required_fab = balanceQtyFabricFilteredData.reduce((sum, r) => sum + r.bal_required_fab, 0);
        shownTotals.excess_qty = balanceQtyFabricFilteredData.reduce((sum, r) => sum + (r.excess_qty || 0), 0);
    }

    const totalTr = document.createElement('tr');
    totalTr.style.fontWeight = 'bold';
    totalTr.style.background = 'rgba(255, 255, 255, 0.03)';
    totalTr.style.borderTop = '2px solid var(--border-color)';
    totalTr.innerHTML = `
        <td></td>
        <td colspan="3">TOTAL</td>
        <td class="text-right">${Number(shownTotals.fabric_req).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="text-right">${Number(shownTotals.fabric_stock).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="text-right">${Number(shownTotals.fabric_wip).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="text-right" style="background: rgba(59, 130, 246, 0.1); color: var(--accent-blue);">${Number(shownTotals.bal_required_fab).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="text-right" style="background: rgba(16, 185, 129, 0.1); color: var(--accent-green);">${Number(shownTotals.excess_qty || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
    `;
    tbody.appendChild(totalTr);
}

async function toggleFabricReqDetails(fabricName, color, dia, triggerBtn) {
    const parentRow = triggerBtn.closest('tr');
    const childRowId = `child-fabric-breakdown-${fabricName.replace(/\s+/g, '_')}-${color.replace(/\s+/g, '_')}-${dia}`;
    const existingChild = document.getElementById(childRowId);

    if (existingChild) {
        const icon = triggerBtn.querySelector('i');
        if (existingChild.classList.contains('hidden')) {
            existingChild.classList.remove('hidden');
            if (icon) icon.className = 'fa-solid fa-chevron-down';
        } else {
            existingChild.classList.add('hidden');
            if (icon) icon.className = 'fa-solid fa-chevron-right';
        }
        return;
    }

    triggerBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    const planVal = document.getElementById('balance-qty-plan-select').value;
    const [plan_name, financial_year] = planVal.split('|');
    const version = document.getElementById('balance-qty-version-select').value;
    const fromDate = document.getElementById('balance-qty-from-date').value;
    const toDate = document.getElementById('balance-qty-to-date').value;

    const brand = document.getElementById('balance-qty-brand-filter').value;
    const category = document.getElementById('balance-qty-category-filter').value;
    const product = document.getElementById('balance-qty-product-filter').value;
    const search = document.getElementById('balance-qty-search').value;

    let url = `/api/fabric-req/details?plan_name=${encodeURIComponent(plan_name)}&financial_year=${encodeURIComponent(financial_year)}&version=${encodeURIComponent(version)}&from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}&target_fabric_name=${encodeURIComponent(fabricName)}&target_color=${encodeURIComponent(color)}&target_dia=${encodeURIComponent(dia)}&consider_fg=${balanceQtyConsider.fg}&consider_wip=${balanceQtyConsider.wip}&consider_pending=${balanceQtyConsider.pending}`;

    if (brand) url += `&brand=${encodeURIComponent(brand)}`;
    if (category) url += `&category=${encodeURIComponent(category)}`;
    if (product) url += `&product=${encodeURIComponent(product)}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (!data.success) {
            showToast('Error', data.message || 'Failed to load breakdown details', 'error');
            triggerBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
            return;
        }

        triggerBtn.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';

        const subTr = document.createElement('tr');
        subTr.id = childRowId;
        subTr.style.background = 'rgba(255, 255, 255, 0.01)';

        const standaloneList = data.details.filter(d => d.source_type === 'Stand Alone Product');
        const commonList = data.details.filter(d => d.source_type === 'Common Production Product');

        let standaloneHtml = '';
        if (standaloneList.length > 0) {
            standaloneHtml = `
                <div style="margin-bottom: 12px;">
                    <div style="font-size: 12px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px;">Stand Alone Product</div>
                    <table class="spreadsheet-table" style="width: 100%; border-collapse: collapse; margin: 0; border: none;">
                        <thead style="background: rgba(255,255,255,0.01);">
                            <tr>
                                <th>Product Name</th>
                                <th>Brand</th>
                                <th>Category</th>
                                <th>Color</th>
                                <th>Size</th>
                                <th class="text-right">Bal Req Qty</th>
                                <th>Fabric Name</th>
                                <th>Dia</th>
                                <th class="text-right">Fabric Consumption</th>
                                <th class="text-right">Fabric Req</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${standaloneList.map(item => `
                                <tr>
                                    <td>${item.name}</td>
                                    <td>${item.brand || '-'}</td>
                                    <td>${item.category || '-'}</td>
                                    <td>${item.color || '-'}</td>
                                    <td><span class="badge badge-outline">${item.size}</span></td>
                                    <td class="text-right">${Number(item.bal_req_qty).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                    <td>${item.fabric_name}</td>
                                    <td>${item.dia ? item.dia + '"' : '-'}</td>
                                    <td class="text-right">${Number(item.fabric_consumption).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</td>
                                    <td class="text-right" style="font-weight:600; color: var(--accent-green);">${Number(item.fabric_requirement).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        let commonHtml = '';
        if (commonList.length > 0) {
            commonHtml = `
                <div>
                    <div style="font-size: 12px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px;">Common Production Product</div>
                    <table class="spreadsheet-table" style="width: 100%; border-collapse: collapse; margin: 0; border: none;">
                        <thead style="background: rgba(255,255,255,0.01);">
                            <tr>
                                <th>Common Production Name</th>
                                <th>Brand</th>
                                <th>Category</th>
                                <th>Color</th>
                                <th>Size</th>
                                <th class="text-right">Bal Req Qty</th>
                                <th>Fabric Name</th>
                                <th>Dia</th>
                                <th class="text-right">Fabric Consumption</th>
                                <th class="text-right">Fabric Req</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${commonList.map(item => `
                                <tr>
                                    <td>${item.name}</td>
                                    <td>${item.brand || '-'}</td>
                                    <td>${item.category || '-'}</td>
                                    <td>${item.color || '-'}</td>
                                    <td><span class="badge badge-outline">${item.size}</span></td>
                                    <td class="text-right">${Number(item.bal_req_qty).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                    <td>${item.fabric_name}</td>
                                    <td>${item.dia ? item.dia + '"' : '-'}</td>
                                    <td class="text-right">${Number(item.fabric_consumption).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</td>
                                    <td class="text-right" style="font-weight:600; color: var(--accent-green);">${Number(item.fabric_requirement).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        const totalRequirement = data.details.reduce((sum, item) => sum + item.fabric_requirement, 0);

        subTr.innerHTML = `
            <td></td>
            <td colspan="8" style="padding: 12px 20px 20px 20px;">
                <div style="border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow: hidden; background: var(--bg-card); box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
                    <div style="padding: 8px 12px; background: rgba(255,255,255,0.02); border-bottom: 1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size: 12px; font-weight: 700; color: var(--accent-blue); display:flex; align-items:center; gap: 6px;">
                            <i class="fa-solid fa-scissors"></i> CONTRIBUTORS: ${fabricName} | Color: ${color} | Dia: ${dia}"
                        </span>
                        <span style="font-size: 12px; font-weight: 700; color: var(--accent-green);">
                            TOTAL FABRIC REQUIREMENT = ${Number(totalRequirement).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                    </div>
                    <div style="padding: 12px;">
                        ${standaloneHtml}
                        ${commonHtml}
                    </div>
                </div>
            </td>
        `;

        parentRow.after(subTr);
    } catch (err) {
        triggerBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
        showToast('Error', 'Connection error loading details breakdown', 'error');
        console.error(err);
    }
}

async function exportFabricReqExcel() {
    const planVal = document.getElementById('balance-qty-plan-select').value;
    if (!planVal) {
        showToast('Warning', 'Please select a valid Plan first.', 'warning');
        return;
    }

    if (!balanceQtyFabricFilteredData || balanceQtyFabricFilteredData.length === 0) {
        showToast('Warning', 'No filtered data to export.', 'warning');
        return;
    }

    const loader = document.getElementById('balance-qty-loader');
    if (loader) loader.classList.remove('hidden');

    const [plan_name, financial_year] = planVal.split('|');
    const version = document.getElementById('balance-qty-version-select').value;
    const fromDate = document.getElementById('balance-qty-from-date').value;
    const toDate = document.getElementById('balance-qty-to-date').value;

    const brand = document.getElementById('balance-qty-brand-filter').value;
    const category = document.getElementById('balance-qty-category-filter').value;
    const product = document.getElementById('balance-qty-product-filter').value;
    const search = document.getElementById('balance-qty-search').value;

    // Fetch all details matching active filters (WITHOUT target group filters, to get all rows for details sheet)
    let url = `/api/fabric-req/details?plan_name=${encodeURIComponent(plan_name)}&financial_year=${encodeURIComponent(financial_year)}&version=${encodeURIComponent(version)}&from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}&consider_fg=${balanceQtyConsider.fg}&consider_wip=${balanceQtyConsider.wip}&consider_pending=${balanceQtyConsider.pending}`;

    if (brand) url += `&brand=${encodeURIComponent(brand)}`;
    if (category) url += `&category=${encodeURIComponent(category)}`;
    if (product) url += `&product=${encodeURIComponent(product)}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (loader) loader.classList.add('hidden');

        if (!data.success) {
            showToast('Error', data.message || 'Failed to load details for Excel export', 'error');
            return;
        }

        // Apply column filters (Fabric Name, Color, Dia) to Summary rows and Detail rows locally
        let filteredDetails = data.details || [];
        for (const [colKey, filterState] of Object.entries(balanceQtyColumnFilters)) {
            if (!filterState) continue;
            const { selectedSet } = filterState;
            if (selectedSet && selectedSet.size > 0) {
                filteredDetails = filteredDetails.filter(row => {
                    let val = '';
                    if (colKey === 'fabric_name') val = row.fabric_name;
                    else if (colKey === 'color') val = row.color;
                    else if (colKey === 'dia') val = row.dia;

                    const formatted = val !== null && val !== undefined ? val.toString().trim() : '';
                    return selectedSet.has(formatted);
                });
            }
        }

        // Create Summary Sheet data
        const summaryHeaders = [
            'Fabric Name',
            'Color',
            'Dia',
            'Fabric Req',
            'Fabric Stock',
            'Fabric WIP',
            'Bal Required Fab',
            'Excess Qty'
        ];
        const summaryDataRows = balanceQtyFabricFilteredData.map(r => [
            r.fabric_name,
            r.color || '',
            r.dia ? Number(r.dia) : '',
            Number(r.fabric_req || 0),
            Number(r.fabric_stock || 0),
            Number(r.fabric_wip || 0),
            Number(r.bal_required_fab || 0),
            Number(r.excess_qty || 0)
        ]);
        const summarySheetData = [summaryHeaders, ...summaryDataRows];
        const summaryWorksheet = XLSX.utils.aoa_to_sheet(summarySheetData);

        // Auto-size Summary columns
        const summaryWidths = [];
        for (let c = 0; c < summaryHeaders.length; c++) {
            let max_len = summaryHeaders[c].length;
            for (let r = 0; r < summarySheetData.length; r++) {
                const val = summarySheetData[r][c];
                if (val !== null && val !== undefined) {
                    const len = val.toString().length;
                    if (len > max_len) max_len = len;
                }
            }
            summaryWidths.push({ wch: Math.min(50, Math.max(10, max_len + 2)) });
        }
        summaryWorksheet['!cols'] = summaryWidths;

        // Auto-filter and freeze Summary header
        const summaryRange = XLSX.utils.decode_range(summaryWorksheet['!ref']);
        summaryWorksheet['!autofilter'] = { ref: XLSX.utils.encode_range(summaryRange) };
        summaryWorksheet['!views'] = [{ state: 'frozen', ySplit: 1, xSplit: 0, topLeftCell: 'A2', activePane: 'bottomLeft' }];

        // Create Details Sheet data
        const detailsHeaders = [
            'Source Type',
            'Product / Common Production Name',
            'Brand',
            'Category',
            'Color',
            'Size',
            'Fabric Name',
            'Dia',
            'Bal Req Qty',
            'Fabric Consumption',
            'Fabric Requirement'
        ];
        const detailsDataRows = filteredDetails.map(d => [
            d.source_type,
            d.name,
            d.brand || '',
            d.category || '',
            d.color || '',
            d.size,
            d.fabric_name,
            d.dia ? Number(d.dia) : '',
            Number(d.bal_req_qty || 0),
            Number(d.fabric_consumption || 0),
            Number(d.fabric_requirement || 0)
        ]);
        const detailsSheetData = [detailsHeaders, ...detailsDataRows];
        const detailsWorksheet = XLSX.utils.aoa_to_sheet(detailsSheetData);

        // Auto-size Details columns
        const detailsWidths = [];
        for (let c = 0; c < detailsHeaders.length; c++) {
            let max_len = detailsHeaders[c].length;
            for (let r = 0; r < detailsSheetData.length; r++) {
                const val = detailsSheetData[r][c];
                if (val !== null && val !== undefined) {
                    const len = val.toString().length;
                    if (len > max_len) max_len = len;
                }
            }
            detailsWidths.push({ wch: Math.min(50, Math.max(10, max_len + 2)) });
        }
        detailsWorksheet['!cols'] = detailsWidths;

        // Auto-filter and freeze Details header
        const detailsRange = XLSX.utils.decode_range(detailsWorksheet['!ref']);
        detailsWorksheet['!autofilter'] = { ref: XLSX.utils.encode_range(detailsRange) };
        detailsWorksheet['!views'] = [{ state: 'frozen', ySplit: 1, xSplit: 0, topLeftCell: 'A2', activePane: 'bottomLeft' }];

        // Create workbook and append sheets
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, summaryWorksheet, 'Fabric Requirement Summary');
        XLSX.utils.book_append_sheet(workbook, detailsWorksheet, 'Fabric Requirement Details');

        // Write file
        const todayStr = new Date().toISOString().split('T')[0];
        const filename = `Fabric_Requirement_Report_${todayStr}.xlsx`;
        XLSX.writeFile(workbook, filename);
    } catch (err) {
        if (loader) loader.classList.add('hidden');
        showToast('Error', 'Connection error during Excel export', 'error');
        console.error(err);
    }
}

async function toggleCommonGroupMembers(fromDate, toDate, common_production_name, size, color, triggerBtn, globalColorCode) {
    const parentRow = triggerBtn.closest('tr');
    const displayColorForId = (globalColorCode || color).replace(/\s+/g, '_');
    const childRowId = `child-breakdown-${fromDate}-${toDate}-${common_production_name.replace(/\s+/g, '_')}-${size}-${displayColorForId}`;
    const existingChild = document.getElementById(childRowId);

    if (existingChild) {
        const icon = triggerBtn.querySelector('i');
        if (existingChild.classList.contains('hidden')) {
            existingChild.classList.remove('hidden');
            if (icon) {
                icon.className = 'fa-solid fa-chevron-down';
            }
        } else {
            existingChild.classList.add('hidden');
            if (icon) {
                icon.className = 'fa-solid fa-chevron-right';
            }
        }
        return;
    }

    triggerBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    const planVal = document.getElementById('balance-qty-plan-select').value;
    const [plan_name, financial_year] = planVal.split('|');
    const version = document.getElementById('balance-qty-version-select').value;

    const url = `/api/balance-qty/members?plan_name=${encodeURIComponent(plan_name)}&financial_year=${encodeURIComponent(financial_year)}&version=${encodeURIComponent(version)}&from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}&common_production_name=${encodeURIComponent(common_production_name)}&size=${encodeURIComponent(size)}&consider_fg=${balanceQtyConsider.fg}&consider_wip=${balanceQtyConsider.wip}&consider_pending=${balanceQtyConsider.pending}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (!data.success) {
            showToast('Error', data.message || 'Failed to load breakdown details', 'error');
            triggerBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
            return;
        }

        triggerBtn.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';

        const subTr = document.createElement('tr');
        subTr.id = childRowId;
        subTr.className = 'common-group-expanded-row';
        subTr.style.background = 'rgba(255, 255, 255, 0.01)';

        // Filter members by the selected parent global color code (or fallback to color)
        const filteredMembers = data.members.filter(m => {
            if (globalColorCode) {
                return (m.global_color_code || '').toLowerCase().trim() === globalColorCode.toLowerCase().trim();
            }
            return m.color.toLowerCase().trim() === color.toLowerCase().trim();
        });

        let subRowsHtml = '';
        filteredMembers.forEach(m => {
            const colorCatSuffix = m.color_category ? ` (${m.color_category})` : '';
            subRowsHtml += `
                <tr>
                    <td style="padding: 6px 12px; font-weight: 500;">${m.product}</td>
                    <td style="padding: 6px 12px;">${m.color}${colorCatSuffix}</td>
                    <td style="padding: 6px 12px;"><span class="badge badge-outline">${m.size}</span></td>
                    <td class="text-right" style="padding: 6px 12px;">${Number(m.calculated_qty).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                    <td class="text-right" style="padding: 6px 12px;">${Number(m.finished_goods_qty).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                    <td class="text-right" style="padding: 6px 12px;">${Number(m.production_wip_qty).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                    <td class="text-right" style="padding: 6px 12px;">${Number(m.pending_production_qty).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                    <td class="text-right" style="padding: 6px 12px; font-weight: 600; color: var(--accent-blue);">${Number(m.bal_required_qty).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                </tr>
            `;
        });

        subTr.innerHTML = `
            <td></td>
            <td colspan="13" style="padding: 12px 20px 20px 20px;">
                <div style="border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow: hidden; background: var(--bg-card); box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
                    <div style="padding: 8px 12px; background: rgba(255,255,255,0.02); border-bottom: 1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size: 12px; font-weight: 700; color: var(--accent-green); display:flex; align-items:center; gap: 6px;">
                            <i class="fa-solid fa-layer-group"></i> MEMBER BREAKDOWN: ${common_production_name} (Color: ${color}, Size: ${size})
                        </span>
                        <span style="font-size: 11px; color: var(--text-secondary); font-weight:500;">
                            *SKU Bal Qty is computed using standalone logic
                        </span>
                    </div>
                    <table class="spreadsheet-table" style="width: 100%; border-collapse: collapse; margin: 0; border: none;">
                        <thead style="background: rgba(255,255,255,0.01);">
                            <tr>
                                <th>Product SKU</th>
                                <th>Color</th>
                                <th>Size</th>
                                <th class="text-right">Req Qty</th>
                                <th class="text-right">FG Stock</th>
                                <th class="text-right">WIP Qty</th>
                                <th class="text-right">Pending Qty</th>
                                <th class="text-right">SKU Bal Qty</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${subRowsHtml}
                        </tbody>
                    </table>
                </div>
            </td>
        `;

        parentRow.after(subTr);
    } catch (err) {
        triggerBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
        showToast('Error', 'Connection error loading members breakdown', 'error');
        console.error(err);
    }
}

function openBalanceQtyMembersModal(plan_name, financial_year, version, month, year, common_production_name, size) {
    const modal = document.getElementById('balance-qty-members-modal');
    const subtitle = document.getElementById('balance-qty-members-modal-subtitle');
    const tbody = document.getElementById('balance-qty-members-tbody');

    subtitle.textContent = `Common Group: ${common_production_name} | Size: ${size} | Month: ${month} ${year} | Plan: ${plan_name}`;
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</td></tr>`;

    modal.classList.remove('hidden');

    const url = `/api/balance-qty/members?plan_name=${encodeURIComponent(plan_name)}&financial_year=${encodeURIComponent(financial_year)}&version=${encodeURIComponent(version)}&month=${encodeURIComponent(month)}&year=${year}&common_production_name=${encodeURIComponent(common_production_name)}&size=${encodeURIComponent(size)}`;

    fetch(url)
        .then(res => res.json())
        .then(data => {
            if (!data.success) {
                tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color: var(--accent-red);">${data.message}</td></tr>`;
                return;
            }

            tbody.innerHTML = '';
            data.members.forEach(m => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${m.product}</strong></td>
                    <td>${m.color}</td>
                    <td><span class="badge badge-outline">${m.size}</span></td>
                    <td class="text-right">${Number(m.calculated_qty).toLocaleString()}</td>
                    <td class="text-right">${Number(m.finished_goods_qty).toLocaleString()}</td>
                    <td class="text-right">${Number(m.production_wip_qty).toLocaleString()}</td>
                    <td class="text-right">${Number(m.pending_production_qty).toLocaleString()}</td>
                    <td class="text-right" style="color: var(--text-muted);">-</td>
                </tr>
                `;
                tbody.appendChild(tr);
            });
        })
        .catch(err => {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color: var(--accent-red);">Connection failed.</td></tr>`;
            console.error(err);
        });
}

function closeBalanceQtyMembersModal() {
    document.getElementById('balance-qty-members-modal').classList.add('hidden');
}


// ==========================================
// BULK CONTRIBUTION FIXING ENGINE IMPLEMENTATION
// ==========================================

// Checkbox selections tracked using unique logical keys
let bulkSelectedProducts = new Set(); // Stores product_id (int)
let bulkSelectedColors = new Set();   // Stores "product_id-color_code" (string)
let bulkSelectedSizes = new Set();    // Stores "product_id-color_code-size_id" (string)

// Excel filters tracked for each view mode
let bulkColumnFilters = {
    Product: {}, // { columnKey: { operator, compareVal1, compareVal2, selectedList, selectedSet } }
    Color: {},
    Size: {}
};

let bulkSaveScope = 'all'; // 'all' or 'selected'
let bulkViewMode = 'Product'; // 'Product', 'Color', or 'Size'
let bulkContribFiltersInitialized = false;
let bulkCalculatedData = null; // Stores calculation response: { products, colors, sizes, validation }

function switchPlanningContribSubTab(subTabId) {
    const subTabMaster = document.getElementById('planning-contrib-subtab-master');
    const subTabBulk = document.getElementById('planning-contrib-subtab-bulk');

    const wrapperMaster = document.getElementById('planning-contrib-master-wrapper');
    const wrapperBulk = document.getElementById('planning-contrib-bulk-wrapper');

    if (subTabId === 'master') {
        subTabMaster.classList.add('active');
        subTabBulk.classList.remove('active');

        wrapperMaster.classList.remove('hidden');
        wrapperBulk.classList.add('hidden');

        if (typeof fetchPlanningContribPage === 'function') {
            fetchPlanningContribPage();
        }
    } else if (subTabId === 'bulk') {
        subTabMaster.classList.remove('active');
        subTabBulk.classList.add('active');

        wrapperMaster.classList.add('hidden');
        wrapperBulk.classList.remove('hidden');

        initializeBulkContribTab();
    }
}

async function initializeBulkContribTab() {
    if (bulkContribFiltersInitialized) {
        return;
    }

    // Populate common period dropdowns for Bulk
    const fromMonthSel = document.getElementById('bulk-contrib-from-month');
    const fromYearSel = document.getElementById('bulk-contrib-from-year');
    const toMonthSel = document.getElementById('bulk-contrib-to-month');
    const toYearSel = document.getElementById('bulk-contrib-to-year');

    if (fromMonthSel) {
        fromMonthSel.innerHTML = MONTHS_LIST.map(m => `<option value="${m}" ${m === 'April' ? 'selected' : ''}>${m}</option>`).join('');
    }
    if (fromYearSel) {
        fromYearSel.innerHTML = YEARS_LIST.map(y => `<option value="${y}" ${y === '2026' ? 'selected' : ''}>${y}</option>`).join('');
    }
    if (toMonthSel) {
        toMonthSel.innerHTML = MONTHS_LIST.map(m => `<option value="${m}" ${m === 'December' ? 'selected' : ''}>${m}</option>`).join('');
    }
    if (toYearSel) {
        toYearSel.innerHTML = YEARS_LIST.map(y => `<option value="${y}" ${y === '2026' ? 'selected' : ''}>${y}</option>`).join('');
    }

    // Populate Brand select list using planningContribMeta (if loaded) or fetch it
    const brandFilter = document.getElementById('bulk-contrib-filter-brand');
    if (brandFilter && planningContribMeta && planningContribMeta.brands) {
        brandFilter.innerHTML = '<option value="">All Brands</option>';
        planningContribMeta.brands.forEach(b => {
            brandFilter.innerHTML += `<option value="${b.id}">${b.brand_name}</option>`;
        });
    } else if (brandFilter) {
        try {
            const brandResp = await fetch('/api/masters/brands?status=Active');
            const brandData = await brandResp.json();
            if (brandData.success && brandData.brands) {
                brandFilter.innerHTML = '<option value="">All Brands</option>';
                brandData.brands.forEach(b => {
                    brandFilter.innerHTML += `<option value="${b.id}">${b.brand_name}</option>`;
                });
            }
        } catch (e) {
            console.error("Error fetching brands for bulk filters:", e);
        }
    }

    // Initialize Products and Colors options lists
    updateBulkProductAndColorOptions();

    // Reset counts and buttons on tab init
    updateSelectionCounter();

    bulkContribFiltersInitialized = true;
}

function updateBulkProductAndColorOptions() {
    if (!planningContribMeta) return;

    const brandId = document.getElementById('bulk-contrib-filter-brand').value;

    // Product select list
    const productFilter = document.getElementById('bulk-contrib-filter-product');
    if (productFilter) {
        let prodList = planningContribMeta.products || [];
        if (brandId) {
            prodList = prodList.filter(p => p.brand_id === parseInt(brandId));
        }
        productFilter.innerHTML = '<option value="">All Products</option>';
        prodList.forEach(p => {
            productFilter.innerHTML += `<option value="${p.id}">${p.product_name}</option>`;
        });
    }

    // Color select list
    const colorFilter = document.getElementById('bulk-contrib-filter-color');
    if (colorFilter) {
        let colorList = planningContribMeta.colors || [];
        colorFilter.innerHTML = '<option value="">All Colors</option>';
        colorList.forEach(c => {
            colorFilter.innerHTML += `<option value="${c.global_color_code}">${c.display_color}</option>`;
        });
    }
}

function onBulkContribBrandChange() {
    updateBulkProductAndColorOptions();
}

async function calculateBulkContributions() {
    const fromMonth = document.getElementById('bulk-contrib-from-month').value;
    const fromYear = parseInt(document.getElementById('bulk-contrib-from-year').value);
    const toMonth = document.getElementById('bulk-contrib-to-month').value;
    const toYear = parseInt(document.getElementById('bulk-contrib-to-year').value);
    const rule = document.getElementById('bulk-contrib-rule').value;

    const brandVal = document.getElementById('bulk-contrib-filter-brand').value;
    const brandId = brandVal ? parseInt(brandVal) : null;

    const productVal = document.getElementById('bulk-contrib-filter-product').value;
    const productIds = productVal ? [parseInt(productVal)] : [];

    const colorVal = document.getElementById('bulk-contrib-filter-color').value;
    const colorCodes = colorVal ? [colorVal] : [];

    // Version resolves from existing Contribution Master dropdown
    const versionSelect = document.getElementById('planning-contrib-version-select');
    const version = versionSelect ? versionSelect.value : 'Standard';

    // Show spinner overlay
    const loader = document.getElementById('bulk-contrib-loader');
    const loaderText = document.getElementById('bulk-loader-text');
    const calculateBtn = document.getElementById('btn-bulk-calculate');

    if (loader) loader.classList.remove('hidden');
    if (loaderText) loaderText.textContent = "Calculating Product → Color → Size Contributions...";
    if (calculateBtn) calculateBtn.disabled = true;

    try {
        const response = await fetch('/api/planning-contribution/bulk-calculate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from_month: fromMonth,
                from_year: fromYear,
                to_month: toMonth,
                to_year: toYear,
                suggestion_rule: rule,
                version: version,
                brand_id: brandId,
                product_ids: productIds,
                color_codes: colorCodes
            })
        });

        const data = await response.json();
        if (response.ok && data.success) {
            if (data.products.length === 0 && data.colors.length === 0 && data.sizes.length === 0) {
                alert("No sales data found for the selected period.");
                bulkCalculatedData = null;
                document.getElementById('btn-bulk-fix-save').disabled = true;
                document.getElementById('btn-bulk-fix-selected').disabled = true;
                const tbody = document.getElementById('bulk-table-tbody');
                tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 40px;">No calculation results available. Click "Calculate All" to start.</td></tr>';
                return;
            }

            bulkCalculatedData = data;

            // Enforce default state: calculate all initializes with checkboxes unchecked
            bulkSelectedProducts.clear();
            bulkSelectedColors.clear();
            bulkSelectedSizes.clear();

            // Reset Excel Filters
            bulkColumnFilters = {
                Product: {},
                Color: {},
                Size: {}
            };

            // Populate summary metrics
            document.getElementById('bulk-summary-products').textContent = data.products.length;
            document.getElementById('bulk-summary-colors').textContent = data.colors.length;

            const uniqueSets = new Set(data.colors.map(c => `${c.product_id}-${c.color_code}`));
            document.getElementById('bulk-summary-sets').textContent = uniqueSets.size;
            document.getElementById('bulk-summary-sizes').textContent = data.sizes.length;

            const productSum = data.products.reduce((acc, p) => acc + (p.new_pct || 0), 0);
            document.getElementById('bulk-summary-product-total').textContent = `${productSum.toFixed(2)}%`;
            if (Math.abs(productSum - 100.00) > 0.05) {
                document.getElementById('bulk-summary-product-total').style.color = 'var(--accent-red)';
            } else {
                document.getElementById('bulk-summary-product-total').style.color = 'var(--accent-green)';
            }

            const colorValidText = document.getElementById('bulk-summary-color-valid');
            if (data.validation.color_groups_valid) {
                colorValidText.textContent = '✓ Valid';
                colorValidText.style.color = 'var(--accent-green)';
            } else {
                colorValidText.textContent = '⚠ Difference';
                colorValidText.style.color = 'var(--accent-red)';
            }

            const sizeValidText = document.getElementById('bulk-summary-size-valid');
            if (data.validation.size_groups_valid) {
                sizeValidText.textContent = '✓ Valid';
                sizeValidText.style.color = 'var(--accent-green)';
            } else {
                sizeValidText.textContent = '⚠ Difference';
                sizeValidText.style.color = 'var(--accent-red)';
            }

            document.getElementById('btn-bulk-fix-save').disabled = false;
            updateSelectionCounter();
            renderBulkTable();

            setTimeout(() => {
                alert(`Calculated ${data.products.length} products, ${data.colors.length} colors and ${data.sizes.length} sizes.`);
            }, 50);

        } else {
            alert(`Calculation failed: ${data.message || 'Unknown error'}`);
        }
    } catch (err) {
        console.error("Error during bulk calculation:", err);
        alert(`Calculation failed: ${err.message}`);
    } finally {
        if (loader) loader.classList.add('hidden');
        if (calculateBtn) calculateBtn.disabled = false;
    }
}

function switchBulkViewMode(mode) {
    bulkViewMode = mode;

    document.getElementById('btn-bulk-view-product').className = mode === 'Product' ? 'btn btn-primary' : 'btn btn-outline';
    document.getElementById('btn-bulk-view-color').className = mode === 'Color' ? 'btn btn-primary' : 'btn btn-outline';
    document.getElementById('btn-bulk-view-size').className = mode === 'Size' ? 'btn btn-primary' : 'btn btn-outline';

    closeExcelFilterPopup();
    renderBulkTable();
}

// ----------------------------------------------------
// EXCEL FILTER & OPERATORS DATA LOGIC
// ----------------------------------------------------

function getRowValue(row, colKey) {
    if (colKey === 'difference') {
        const cf = row.current_fixed_pct !== null && row.current_fixed_pct !== undefined ? row.current_fixed_pct : 0.0;
        return (row.new_pct || 0) - cf;
    }
    if (colKey === 'current_fixed_pct') {
        return row.current_fixed_pct !== null && row.current_fixed_pct !== undefined ? row.current_fixed_pct : 0.0;
    }
    return row[colKey];
}

function getRowValueFormatted(row, colKey) {
    const val = getRowValue(row, colKey);
    if (val === null || val === undefined) return '';
    if (colKey === 'calculated_pct' || colKey === 'current_fixed_pct' || colKey === 'new_pct' || colKey === 'difference') {
        return val.toFixed(2) + '%';
    }
    if (colKey === 'sales_qty') {
        return val.toString();
    }
    return val.toString();
}

function isFilterActive(colKey) {
    const filters = bulkColumnFilters[bulkViewMode];
    if (!filters || !filters[colKey]) return false;
    const f = filters[colKey];
    return (f.operator && f.operator !== 'None') || (f.selectedSet && f.selectedSet.size > 0);
}

function getHeaderThHtml(title, colKey, colType, isRightAligned = false, widthStyle = '') {
    const active = isFilterActive(colKey);
    const alignClass = isRightAligned ? 'text-right' : '';
    const justifyStyle = isRightAligned ? 'justify-content: flex-end;' : 'justify-content: space-between;';
    const widthAttr = widthStyle ? `width: ${widthStyle};` : '';

    return `
        <th style="position: relative; ${widthAttr}" class="${alignClass}">
            <div style="display: flex; align-items: center; ${justifyStyle} gap: 4px; width: 100%;">
                <span>${title}</span>
                <i class="fa-solid fa-filter" id="filter-btn-${colKey}" onclick="toggleExcelFilterPopup(event, '${colKey}', '${colType}')" 
                   style="cursor: pointer; font-size: 11px; margin-left: 4px; transition: color 0.2s; color: ${active ? 'var(--accent-blue)' : 'var(--text-secondary)'}; opacity: ${active ? '1' : '0.6'};"
                   title="Filter ${title}"></i>
            </div>
        </th>
    `;
}

function matchOperator(val, operator, cval1, cval2) {
    const nVal = parseFloat(val);
    const nCval1 = parseFloat(cval1);
    const nCval2 = parseFloat(cval2);

    if (operator === 'Equals') {
        if (!isNaN(nVal) && !isNaN(nCval1)) return Math.abs(nVal - nCval1) < 0.0001;
        return String(val).toLowerCase() === String(cval1).toLowerCase();
    }
    if (operator === 'Not Equals') {
        if (!isNaN(nVal) && !isNaN(nCval1)) return Math.abs(nVal - nCval1) >= 0.0001;
        return String(val).toLowerCase() !== String(cval1).toLowerCase();
    }
    if (operator === 'Greater Than') return nVal > nCval1;
    if (operator === 'Greater Than or Equal') return nVal >= nCval1;
    if (operator === 'Less Than') return nVal < nCval1;
    if (operator === 'Less Than or Equal') return nVal <= nCval1;
    if (operator === 'Between') return nVal >= nCval1 && nVal <= nCval2;

    const strVal = String(val).toLowerCase();
    const strCval = String(cval1).toLowerCase();

    if (operator === 'Contains') return strVal.includes(strCval);
    if (operator === 'Does Not Contain') return !strVal.includes(strCval);
    if (operator === 'Starts With') return strVal.startsWith(strCval);
    if (operator === 'Ends With') return strVal.endsWith(strCval);
    return true;
}

function applyFiltersToData(dataList, viewMode) {
    let result = [...dataList];
    const filters = bulkColumnFilters[viewMode] || {};

    for (const [colKey, filterState] of Object.entries(filters)) {
        if (!filterState) continue;

        const { operator, compareVal1, compareVal2, selectedSet } = filterState;

        // Apply operator rules
        if (operator && operator !== 'None') {
            result = result.filter(row => {
                const val = getRowValue(row, colKey);
                return matchOperator(val, operator, compareVal1, compareVal2);
            });
        }

        // Apply checklist checkboxes rules
        if (selectedSet && selectedSet.size > 0) {
            result = result.filter(row => {
                const val = getRowValueFormatted(row, colKey);
                return selectedSet.has(val);
            });
        }
    }

    return result;
}

function getVisibleFilteredRows() {
    if (!bulkCalculatedData) return [];

    let rawList = [];
    if (bulkViewMode === 'Product') rawList = bulkCalculatedData.products;
    else if (bulkViewMode === 'Color') rawList = bulkCalculatedData.colors;
    else if (bulkViewMode === 'Size') rawList = bulkCalculatedData.sizes;

    let list = applyFiltersToData(rawList, bulkViewMode);

    const searchTerm = document.getElementById('bulk-contrib-search').value.toLowerCase().trim();
    if (searchTerm) {
        if (bulkViewMode === 'Product') {
            list = list.filter(p => p.product_name.toLowerCase().includes(searchTerm));
        } else if (bulkViewMode === 'Color') {
            list = list.filter(c =>
                c.product_name.toLowerCase().includes(searchTerm) ||
                c.color_name.toLowerCase().includes(searchTerm)
            );
        } else if (bulkViewMode === 'Size') {
            list = list.filter(s =>
                s.product_name.toLowerCase().includes(searchTerm) ||
                (s.color_name && s.color_name.toLowerCase().includes(searchTerm)) ||
                s.size_name.toLowerCase().includes(searchTerm)
            );
        }
    }

    return list;
}

// ----------------------------------------------------
// EXCEL FILTER UI POPUP TRIGGER
// ----------------------------------------------------

let currentFilterColumn = null;
let currentFilterType = null;

function toggleExcelFilterPopup(event, colKey, colType) {
    event.stopPropagation();

    const existing = document.getElementById('excel-filter-popup');
    if (existing) {
        existing.remove();
        if (currentFilterColumn === colKey) {
            currentFilterColumn = null;
            return;
        }
    }

    currentFilterColumn = colKey;
    currentFilterType = colType;

    const rect = event.target.getBoundingClientRect();
    const top = rect.bottom + window.scrollY + 6;
    const left = Math.max(10, rect.left + window.scrollX - 160);

    const popup = document.createElement('div');
    popup.id = 'excel-filter-popup';
    popup.style.position = 'absolute';
    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
    popup.style.zIndex = '9999';
    popup.style.background = '#202433';
    popup.style.border = '1px solid rgba(255,255,255,0.12)';
    popup.style.borderRadius = '8px';
    popup.style.boxShadow = '0 8px 24px rgba(0,0,0,0.5)';
    popup.style.width = '240px';
    popup.style.padding = '12px';
    popup.style.display = 'flex';
    popup.style.flexDirection = 'column';
    popup.style.gap = '10px';
    popup.onclick = (e) => e.stopPropagation();

    const operators = colType === 'numeric'
        ? ['None', 'Equals', 'Not Equals', 'Greater Than', 'Greater Than or Equal', 'Less Than', 'Less Than or Equal', 'Between']
        : ['None', 'Contains', 'Does Not Contain', 'Equals', 'Starts With', 'Ends With'];

    const activeFilters = bulkColumnFilters[bulkViewMode] || {};
    const colFilter = activeFilters[colKey] || { operator: 'None', compareVal1: '', compareVal2: '', selectedList: [] };

    let operatorOptions = operators.map(op => `<option value="${op}" ${colFilter.operator === op ? 'selected' : ''}>${op}</option>`).join('');

    let html = `
        <div style="font-weight: 700; font-size: 11px; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 2px;">
            Filter Criteria
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px;">
            <select id="filter-operator-select" onchange="onFilterOperatorChange(this.value)"
                style="width: 100%; padding: 6px; border: 1px solid var(--border-color); background: rgba(0,0,0,0.3); color: var(--text-primary); border-radius: 4px; outline: none; font-size: 12px;">
                ${operatorOptions}
            </select>
            <div id="filter-input-val1-wrapper" style="${colFilter.operator === 'None' ? 'display:none;' : ''}">
                <input type="${colType === 'numeric' ? 'number' : 'text'}" id="filter-input-val1" value="${colFilter.compareVal1 || ''}" placeholder="Value..."
                    style="width: 100%; padding: 6px; border: 1px solid var(--border-color); background: rgba(0,0,0,0.3); color: var(--text-primary); border-radius: 4px; outline: none; font-size: 12px;">
            </div>
            <div id="filter-input-val2-wrapper" style="${colFilter.operator === 'Between' ? '' : 'display:none;'}">
                <input type="number" id="filter-input-val2" value="${colFilter.compareVal2 || ''}" placeholder="To Value..."
                    style="width: 100%; padding: 6px; border: 1px solid var(--border-color); background: rgba(0,0,0,0.3); color: var(--text-primary); border-radius: 4px; outline: none; font-size: 12px;">
            </div>
        </div>
        <div style="border-top: 1px solid var(--border-color); margin: 4px 0;"></div>
    `;

    let rawList = [];
    if (bulkViewMode === 'Product') rawList = bulkCalculatedData.products;
    else if (bulkViewMode === 'Color') rawList = bulkCalculatedData.colors;
    else if (bulkViewMode === 'Size') rawList = bulkCalculatedData.sizes;

    const uniqueValuesSet = new Set();
    rawList.forEach(row => {
        uniqueValuesSet.add(getRowValueFormatted(row, colKey));
    });

    const sortedUniqueValues = Array.from(uniqueValuesSet).sort((a, b) => {
        const na = parseFloat(a);
        const nb = parseFloat(b);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });

    const selSet = new Set(colFilter.selectedList || []);
    const isFilteredChecklist = selSet.size > 0;

    let checklistHtml = sortedUniqueValues.map(val => {
        const isChecked = isFilteredChecklist ? selSet.has(val) : true;
        return `
            <label class="checkbox-container excel-checklist-item" style="display: flex; align-items: center; gap: 8px; margin: 4px 0; font-size: 12px; font-weight: normal; cursor: pointer; color: var(--text-primary);">
                <input type="checkbox" class="excel-filter-checklist-checkbox" value="${val}" ${isChecked ? 'checked' : ''} onchange="onExcelChecklistItemChange()">
                <span class="checkmark"></span>
                <span>${val}</span>
            </label>
        `;
    }).join('');

    html += `
        <div style="font-weight: 700; font-size: 11px; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 2px;">
            Values Checklist
        </div>
        <input type="text" id="excel-checklist-search" placeholder="Search values..." oninput="onExcelChecklistSearch(this.value)"
            style="width: 100%; padding: 6px; border: 1px solid var(--border-color); background: rgba(0,0,0,0.3); color: var(--text-primary); border-radius: 4px; outline: none; font-size: 12px;">
        <div style="max-height: 120px; overflow-y: auto; padding: 4px; background: rgba(0,0,0,0.15); border: 1px solid var(--border-color); border-radius: 4px;" id="excel-checklist-container">
            <label class="checkbox-container" style="display: flex; align-items: center; gap: 8px; margin: 4px 0; font-size: 12px; font-weight: bold; cursor: pointer;">
                <input type="checkbox" id="excel-filter-select-all" ${!isFilteredChecklist ? 'checked' : ''} onchange="onExcelFilterToggleSelectAll(this)">
                <span class="checkmark"></span>
                <span>(Select All)</span>
            </label>
            <div id="excel-checklist-items-wrapper">
                ${checklistHtml}
            </div>
        </div>
        
        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px;">
            <button class="btn btn-outline btn-xs" onclick="closeExcelFilterPopup()" style="padding: 4px 8px; font-size: 11px;">Cancel</button>
            <button class="btn btn-outline btn-xs" onclick="clearExcelFilter('${colKey}')" style="padding: 4px 8px; font-size: 11px; color: var(--accent-red);">Clear</button>
            <button class="btn btn-primary btn-xs" onclick="applyExcelFilter('${colKey}')" style="padding: 4px 8px; font-size: 11px;">Apply</button>
        </div>
    `;

    popup.innerHTML = html;
    document.body.appendChild(popup);

    if (!window.excelFilterOutsideClickRegistered) {
        document.addEventListener('click', (e) => {
            const pop = document.getElementById('excel-filter-popup');
            if (pop && !pop.contains(e.target) && !e.target.classList.contains('fa-filter')) {
                pop.remove();
                currentFilterColumn = null;
            }
        });
        window.excelFilterOutsideClickRegistered = true;
    }
}

function onFilterOperatorChange(value) {
    const val1 = document.getElementById('filter-input-val1-wrapper');
    const val2 = document.getElementById('filter-input-val2-wrapper');

    if (value === 'None') {
        val1.style.display = 'none';
        val2.style.display = 'none';
    } else if (value === 'Between') {
        val1.style.display = '';
        val2.style.display = '';
    } else {
        val1.style.display = '';
        val2.style.display = 'none';
    }
}

function onExcelChecklistSearch(term) {
    const query = term.toLowerCase().trim();
    const items = document.querySelectorAll('.excel-checklist-item');
    items.forEach(item => {
        const valText = item.querySelector('span:last-child').textContent.toLowerCase();
        if (valText.includes(query)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

function onExcelFilterToggleSelectAll(selectAllCheckbox) {
    const checkboxes = document.querySelectorAll('.excel-filter-checklist-checkbox');
    checkboxes.forEach(cb => {
        const parent = cb.closest('.excel-checklist-item');
        if (parent && parent.style.display !== 'none') {
            cb.checked = selectAllCheckbox.checked;
        }
    });
}

function onExcelChecklistItemChange() {
    const selectAllCheckbox = document.getElementById('excel-filter-select-all');
    if (!selectAllCheckbox) return;

    const checkboxes = Array.from(document.querySelectorAll('.excel-filter-checklist-checkbox'));
    const allChecked = checkboxes.every(cb => cb.checked);
    const noneChecked = checkboxes.every(cb => !cb.checked);

    if (allChecked) {
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
    } else if (noneChecked) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    } else {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true;
    }
}

function closeExcelFilterPopup() {
    const pop = document.getElementById('excel-filter-popup');
    if (pop) pop.remove();
    currentFilterColumn = null;
}

function clearExcelFilter(colKey) {
    const activeFilters = bulkColumnFilters[bulkViewMode] || {};
    delete activeFilters[colKey];
    bulkColumnFilters[bulkViewMode] = activeFilters;

    closeExcelFilterPopup();
    renderBulkTable();
}

function applyExcelFilter(colKey) {
    const operator = document.getElementById('filter-operator-select').value;
    const compareVal1 = document.getElementById('filter-input-val1').value;
    const compareVal2 = document.getElementById('filter-input-val2').value;

    const selectAllCheckbox = document.getElementById('excel-filter-select-all');
    let selectedList = [];

    if (selectAllCheckbox && (!selectAllCheckbox.checked || selectAllCheckbox.indeterminate)) {
        const checkboxes = document.querySelectorAll('.excel-filter-checklist-checkbox');
        checkboxes.forEach(cb => {
            if (cb.checked) {
                selectedList.push(cb.value);
            }
        });
    }

    const activeFilters = bulkColumnFilters[bulkViewMode] || {};
    activeFilters[colKey] = {
        operator: operator,
        compareVal1: compareVal1,
        compareVal2: compareVal2,
        selectedList: selectedList,
        selectedSet: new Set(selectedList)
    };
    bulkColumnFilters[bulkViewMode] = activeFilters;

    closeExcelFilterPopup();
    renderBulkTable();
}

// ----------------------------------------------------
// ROW CHECKBOXES SELECTION HELPERS
// ----------------------------------------------------

function isRowSelected(row, viewMode) {
    if (viewMode === 'Product') {
        return bulkSelectedProducts.has(row.product_id);
    }
    if (viewMode === 'Color') {
        return bulkSelectedColors.has(`${row.product_id}-${row.color_code}`);
    }
    if (viewMode === 'Size') {
        return bulkSelectedSizes.has(`${row.product_id}-${row.color_code}-${row.size_id}`);
    }
    return false;
}

function toggleRowSelection(checkbox, idKey, viewMode) {
    if (viewMode === 'Product') {
        const pid = parseInt(idKey);
        if (checkbox.checked) {
            bulkSelectedProducts.add(pid);
        } else {
            bulkSelectedProducts.delete(pid);
        }
    } else if (viewMode === 'Color') {
        if (checkbox.checked) {
            bulkSelectedColors.add(idKey);
        } else {
            bulkSelectedColors.delete(idKey);
        }
    } else if (viewMode === 'Size') {
        if (checkbox.checked) {
            bulkSelectedSizes.add(idKey);
        } else {
            bulkSelectedSizes.delete(idKey);
        }
    }

    updateSelectionCounter();
    updateHeaderCheckboxState();
}

function toggleSelectAllVisible(headerCheckbox) {
    const visibleRows = getVisibleFilteredRows();

    visibleRows.forEach(row => {
        const key = getRowSelectionKey(row, bulkViewMode);
        if (headerCheckbox.checked) {
            if (bulkViewMode === 'Product') bulkSelectedProducts.add(row.product_id);
            else if (bulkViewMode === 'Color') bulkSelectedColors.add(key);
            else if (bulkViewMode === 'Size') bulkSelectedSizes.add(key);
        } else {
            if (bulkViewMode === 'Product') bulkSelectedProducts.delete(row.product_id);
            else if (bulkViewMode === 'Color') bulkSelectedColors.delete(key);
            else if (bulkViewMode === 'Size') bulkSelectedSizes.delete(key);
        }
    });

    renderBulkTable();
    updateSelectionCounter();
}

function getRowSelectionKey(row, viewMode) {
    if (viewMode === 'Product') return row.product_id;
    if (viewMode === 'Color') return `${row.product_id}-${row.color_code}`;
    if (viewMode === 'Size') return `${row.product_id}-${row.color_code}-${row.size_id}`;
    return '';
}

function updateHeaderCheckboxState() {
    const selectAllCheckbox = document.getElementById('bulk-select-all-header');
    if (!selectAllCheckbox) return;

    const visibleRows = getVisibleFilteredRows();
    if (visibleRows.length === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
        return;
    }

    let selectedCount = 0;
    visibleRows.forEach(row => {
        if (isRowSelected(row, bulkViewMode)) {
            selectedCount++;
        }
    });

    if (selectedCount === visibleRows.length) {
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
    } else if (selectedCount > 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true;
    } else {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    }
}

function updateSelectionCounter() {
    const productsCount = bulkSelectedProducts.size;
    const colorsCount = bulkSelectedColors.size;
    const sizesCount = bulkSelectedSizes.size;

    const prodCounter = document.getElementById('bulk-selected-products-count');
    const colorCounter = document.getElementById('bulk-selected-colors-count');
    const sizeCounter = document.getElementById('bulk-selected-sizes-count');

    if (prodCounter) prodCounter.textContent = `${productsCount} Product${productsCount !== 1 ? 's' : ''}`;
    if (colorCounter) colorCounter.textContent = `${colorsCount} Color${colorsCount !== 1 ? 's' : ''}`;
    if (sizeCounter) sizeCounter.textContent = `${sizesCount} Size${sizesCount !== 1 ? 's' : ''}`;

    // Toggle action buttons disabled state
    const fixSelectedBtn = document.getElementById('btn-bulk-fix-selected');
    if (fixSelectedBtn) {
        fixSelectedBtn.disabled = (productsCount === 0 && colorsCount === 0 && sizesCount === 0);
    }
}

// ----------------------------------------------------
// MAIN TABLE RENDERING LOGIC WITH ADDITIVE FILTERS
// ----------------------------------------------------

function renderBulkTable() {
    if (!bulkCalculatedData) return;

    const thead = document.getElementById('bulk-table-thead');
    const tbody = document.getElementById('bulk-table-tbody');
    const tfoot = document.getElementById('bulk-table-tfoot');

    tbody.innerHTML = '';
    tfoot.innerHTML = '';

    const visibleRows = getVisibleFilteredRows();

    if (bulkViewMode === 'Product') {
        thead.innerHTML = `
            <tr>
                <th style="width: 40px; text-align: center;">
                    <input type="checkbox" id="bulk-select-all-header" onchange="toggleSelectAllVisible(this)">
                </th>
                ${getHeaderThHtml('Product', 'product_name', 'text')}
                ${getHeaderThHtml('Sales Qty', 'sales_qty', 'numeric', true, '130px')}
                ${getHeaderThHtml('Calculated %', 'calculated_pct', 'numeric', true, '130px')}
                ${getHeaderThHtml('Current Fixed %', 'current_fixed_pct', 'numeric', true, '130px')}
                ${getHeaderThHtml('New %', 'new_pct', 'numeric', true, '130px')}
                ${getHeaderThHtml('Difference', 'difference', 'numeric', true, '120px')}
                ${getHeaderThHtml('Status', 'status', 'text', false, '110px')}
            </tr>
        `;

        if (visibleRows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 20px;">No products match search/filters.</td></tr>`;
            updateHeaderCheckboxState();
            return;
        }

        let totalQty = 0;
        let totalCalcPct = 0;
        let totalCurrentFixed = 0;
        let totalNew = 0;

        visibleRows.forEach(p => {
            totalQty += p.sales_qty || 0;
            totalCalcPct += p.calculated_pct || 0;
            const cf = p.current_fixed_pct !== null && p.current_fixed_pct !== undefined ? p.current_fixed_pct : 0.0;
            totalCurrentFixed += cf;
            totalNew += p.new_pct || 0;

            const diff = (p.new_pct || 0) - cf;
            const diffStyle = Math.abs(diff) < 0.01 ? '' : (diff > 0 ? 'color: var(--accent-green);' : 'color: var(--accent-red);');
            const diffSign = diff > 0 ? '+' : '';
            const checkedAttr = bulkSelectedProducts.has(p.product_id) ? 'checked' : '';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="text-align: center;">
                    <input type="checkbox" value="${p.product_id}" ${checkedAttr} onchange="toggleRowSelection(this, '${p.product_id}', 'Product')">
                </td>
                <td><strong>${p.product_name}</strong></td>
                <td class="text-right">${(p.sales_qty || 0).toLocaleString()}</td>
                <td class="text-right">${(p.calculated_pct || 0).toFixed(2)}%</td>
                <td class="text-right" style="color: var(--text-secondary);">${p.current_fixed_pct !== null && p.current_fixed_pct !== undefined ? p.current_fixed_pct.toFixed(2) + '%' : '-'}</td>
                <td class="text-right" style="color: var(--accent-blue); font-weight: bold;">${(p.new_pct || 0).toFixed(2)}%</td>
                <td class="text-right" style="${diffStyle}">${diffSign}${diff.toFixed(2)}%</td>
                <td style="text-align: center;"><span class="badge ${p.status === 'Completed' ? 'badge-success' : 'badge-warning'}">${p.status || 'Draft'}</span></td>
            `;
            tbody.appendChild(tr);
        });

        const tfootTr = document.createElement('tr');
        tfootTr.style.fontWeight = 'bold';
        tfootTr.style.background = 'rgba(255,255,255,0.03)';
        const diffSum = totalNew - totalCurrentFixed;
        const diffSumStyle = Math.abs(diffSum) < 0.01 ? '' : (diffSum > 0 ? 'color: var(--accent-green);' : 'color: var(--accent-red);');
        tfootTr.innerHTML = `
            <td colspan="2">TOTAL PRODUCT CONTRIBUTION</td>
            <td class="text-right">${totalQty.toLocaleString()}</td>
            <td class="text-right">${totalCalcPct.toFixed(2)}%</td>
            <td class="text-right">${totalCurrentFixed.toFixed(2)}%</td>
            <td class="text-right" style="color: ${Math.abs(totalNew - 100.00) < 0.05 ? 'var(--accent-green)' : 'var(--accent-red)'}; font-weight: bold;">${totalNew.toFixed(2)}%</td>
            <td class="text-right" style="${diffSumStyle}">${diffSum > 0 ? '+' : ''}${diffSum.toFixed(2)}%</td>
            <td></td>
        `;
        tfoot.appendChild(tfootTr);
        updateHeaderCheckboxState();

    } else if (bulkViewMode === 'Color') {
        thead.innerHTML = `
            <tr>
                <th style="width: 40px; text-align: center;">
                    <input type="checkbox" id="bulk-select-all-header" onchange="toggleSelectAllVisible(this)">
                </th>
                ${getHeaderThHtml('Product', 'product_name', 'text')}
                ${getHeaderThHtml('Color', 'color_name', 'text')}
                ${getHeaderThHtml('Sales Qty', 'sales_qty', 'numeric', true, '130px')}
                ${getHeaderThHtml('Calculated %', 'calculated_pct', 'numeric', true, '130px')}
                ${getHeaderThHtml('Current Fixed %', 'current_fixed_pct', 'numeric', true, '130px')}
                ${getHeaderThHtml('New %', 'new_pct', 'numeric', true, '130px')}
                ${getHeaderThHtml('Difference', 'difference', 'numeric', true, '120px')}
                ${getHeaderThHtml('Status', 'status', 'text', false, '110px')}
            </tr>
        `;

        if (visibleRows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 20px;">No colors match search/filters.</td></tr>`;
            updateHeaderCheckboxState();
            return;
        }

        visibleRows.forEach(c => {
            const cf = c.current_fixed_pct !== null && c.current_fixed_pct !== undefined ? c.current_fixed_pct : 0.0;
            const diff = (c.new_pct || 0) - cf;
            const diffStyle = Math.abs(diff) < 0.01 ? '' : (diff > 0 ? 'color: var(--accent-green);' : 'color: var(--accent-red);');
            const diffSign = diff > 0 ? '+' : '';
            const key = `${c.product_id}-${c.color_code}`;
            const checkedAttr = bulkSelectedColors.has(key) ? 'checked' : '';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="text-align: center;">
                    <input type="checkbox" value="${key}" ${checkedAttr} onchange="toggleRowSelection(this, '${key}', 'Color')">
                </td>
                <td>${c.product_name}</td>
                <td><strong>${c.color_name}</strong></td>
                <td class="text-right">${(c.sales_qty || 0).toLocaleString()}</td>
                <td class="text-right">${(c.calculated_pct || 0).toFixed(2)}%</td>
                <td class="text-right" style="color: var(--text-secondary);">${c.current_fixed_pct !== null && c.current_fixed_pct !== undefined ? c.current_fixed_pct.toFixed(2) + '%' : '-'}</td>
                <td class="text-right" style="color: var(--accent-blue); font-weight: bold;">${(c.new_pct || 0).toFixed(2)}%</td>
                <td class="text-right" style="${diffStyle}">${diffSign}${diff.toFixed(2)}%</td>
                <td style="text-align: center;"><span class="badge ${c.status === 'Completed' ? 'badge-success' : 'badge-warning'}">${c.status || 'Draft'}</span></td>
            `;
            tbody.appendChild(tr);
        });

        const tfootTr = document.createElement('tr');
        tfootTr.style.fontWeight = 'bold';
        tfootTr.style.background = 'rgba(255,255,255,0.03)';
        const allColorValid = bulkCalculatedData.validation.color_groups_valid;
        tfootTr.innerHTML = `
            <td colspan="5">COLOR GROUP SUM VALIDATION (Sum of color % within each Product must be 100%)</td>
            <td colspan="3" style="text-align: right; color: ${allColorValid ? 'var(--accent-green)' : 'var(--accent-red)'};">
                ${allColorValid ? 'All Color Groups Valid: ✓ Valid' : '⚠ Color Groups Sum Difference'}
            </td>
            <td></td>
        `;
        tfoot.appendChild(tfootTr);
        updateHeaderCheckboxState();

    } else if (bulkViewMode === 'Size') {
        thead.innerHTML = `
            <tr>
                <th style="width: 40px; text-align: center;">
                    <input type="checkbox" id="bulk-select-all-header" onchange="toggleSelectAllVisible(this)">
                </th>
                ${getHeaderThHtml('Product', 'product_name', 'text')}
                ${getHeaderThHtml('Color', 'color_name', 'text')}
                ${getHeaderThHtml('Size', 'size_name', 'text')}
                ${getHeaderThHtml('Sales Qty', 'sales_qty', 'numeric', true, '130px')}
                ${getHeaderThHtml('Calculated %', 'calculated_pct', 'numeric', true, '130px')}
                ${getHeaderThHtml('Current Fixed %', 'current_fixed_pct', 'numeric', true, '130px')}
                ${getHeaderThHtml('New %', 'new_pct', 'numeric', true, '130px')}
                ${getHeaderThHtml('Difference', 'difference', 'numeric', true, '120px')}
                ${getHeaderThHtml('Status', 'status', 'text', false, '110px')}
            </tr>
        `;

        if (visibleRows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-muted); padding: 20px;">No sizes match search/filters.</td></tr>`;
            updateHeaderCheckboxState();
            return;
        }

        visibleRows.forEach(s => {
            const cf = s.current_fixed_pct !== null && s.current_fixed_pct !== undefined ? s.current_fixed_pct : 0.0;
            const diff = (s.new_pct || 0) - cf;
            const diffStyle = Math.abs(diff) < 0.01 ? '' : (diff > 0 ? 'color: var(--accent-green);' : 'color: var(--accent-red);');
            const diffSign = diff > 0 ? '+' : '';
            const key = `${s.product_id}-${s.color_code}-${s.size_id}`;
            const checkedAttr = bulkSelectedSizes.has(key) ? 'checked' : '';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="text-align: center;">
                    <input type="checkbox" value="${key}" ${checkedAttr} onchange="toggleRowSelection(this, '${key}', 'Size')">
                </td>
                <td>${s.product_name}</td>
                <td>${s.color_name || 'NULL'}</td>
                <td><strong>${s.size_name}</strong></td>
                <td class="text-right">${(s.sales_qty || 0).toLocaleString()}</td>
                <td class="text-right">${(s.calculated_pct || 0).toFixed(2)}%</td>
                <td class="text-right" style="color: var(--text-secondary);">${s.current_fixed_pct !== null && s.current_fixed_pct !== undefined ? s.current_fixed_pct.toFixed(2) + '%' : '-'}</td>
                <td class="text-right" style="color: var(--accent-blue); font-weight: bold;">${(s.new_pct || 0).toFixed(2)}%</td>
                <td class="text-right" style="${diffStyle}">${diffSign}${diff.toFixed(2)}%</td>
                <td style="text-align: center;"><span class="badge ${s.status === 'Completed' ? 'badge-success' : 'badge-warning'}">${s.status || 'Draft'}</span></td>
            `;
            tbody.appendChild(tr);
        });

        const tfootTr = document.createElement('tr');
        tfootTr.style.fontWeight = 'bold';
        tfootTr.style.background = 'rgba(255,255,255,0.03)';
        const allSizeValid = bulkCalculatedData.validation.size_groups_valid;
        tfootTr.innerHTML = `
            <td colspan="6">SIZE GROUP SUM VALIDATION (Sum of size % within each Product+Color must be 100%)</td>
            <td colspan="3" style="text-align: right; color: ${allSizeValid ? 'var(--accent-green)' : 'var(--accent-red)'};">
                ${allSizeValid ? 'All Size Groups Valid: ✓ Valid' : '⚠ Size Groups Sum Difference'}
            </td>
            <td></td>
        `;
        tfoot.appendChild(tfootTr);
        updateHeaderCheckboxState();
    }
}

function filterBulkTable() {
    renderBulkTable();
}

// ----------------------------------------------------
// MODAL CONTROLLERS & DUAL SAVE IMPLEMENTATION
// ----------------------------------------------------

function openBulkFixSaveModal() {
    if (!bulkCalculatedData) return;
    bulkSaveScope = 'all';
    showBulkFixConfirmModal();
}

function openBulkFixSelectedModal() {
    if (!bulkCalculatedData) return;
    const productsCount = bulkSelectedProducts.size;
    const colorsCount = bulkSelectedColors.size;
    const sizesCount = bulkSelectedSizes.size;

    if (productsCount === 0 && colorsCount === 0 && sizesCount === 0) {
        alert("Please select at least one row to fix.");
        return;
    }

    bulkSaveScope = 'selected';
    showBulkFixConfirmModal();
}

function showBulkFixConfirmModal() {
    const fromMonth = document.getElementById('bulk-contrib-from-month').value;
    const fromYear = document.getElementById('bulk-contrib-from-year').value;
    const toMonth = document.getElementById('bulk-contrib-to-month').value;
    const toYear = document.getElementById('bulk-contrib-to-year').value;

    document.getElementById('bulk-confirm-period').textContent = `${fromMonth} ${fromYear} → ${toMonth} ${toYear}`;

    const versionSelect = document.getElementById('planning-contrib-version-select');
    const version = versionSelect ? versionSelect.value : 'Standard';
    document.getElementById('bulk-confirm-version').textContent = version;

    const descText = document.getElementById('bulk-confirm-modal-description');
    const warningText = document.getElementById('bulk-confirm-warning-text');

    if (bulkSaveScope === 'selected') {
        const pCount = bulkSelectedProducts.size;
        const cCount = bulkSelectedColors.size;
        const sCount = bulkSelectedSizes.size;

        document.getElementById('bulk-confirm-products-count').textContent = pCount;
        document.getElementById('bulk-confirm-colors-count').textContent = cCount;
        document.getElementById('bulk-confirm-sizes-count').textContent = sCount;

        descText.textContent = "Are you sure you want to fix ONLY the selected calculated Product, Color and Size contributions for the selected period?";
        warningText.textContent = "Only the selected rows will be updated. Unselected records in the database will remain completely untouched.";
    } else {
        document.getElementById('bulk-confirm-products-count').textContent = bulkCalculatedData.products.length;
        document.getElementById('bulk-confirm-colors-count').textContent = bulkCalculatedData.colors.length;
        document.getElementById('bulk-confirm-sizes-count').textContent = bulkCalculatedData.sizes.length;

        descText.textContent = "Are you sure you want to fix all calculated Product, Color and Size contributions for the selected period?";
        warningText.textContent = "This will save the calculated percentages as the new Fixed % and Manual % for these records in the database, overwriting any previous values for this period/version.";
    }

    document.getElementById('bulk-fix-confirm-modal').classList.remove('hidden');
}

function closeBulkFixSaveModal() {
    document.getElementById('bulk-fix-confirm-modal').classList.add('hidden');
}

async function executeBulkFixSave() {
    closeBulkFixSaveModal();

    const fromMonth = document.getElementById('bulk-contrib-from-month').value;
    const fromYear = parseInt(document.getElementById('bulk-contrib-from-year').value);
    const toMonth = document.getElementById('bulk-contrib-to-month').value;
    const toYear = parseInt(document.getElementById('bulk-contrib-to-year').value);

    const versionSelect = document.getElementById('planning-contrib-version-select');
    const version = versionSelect ? versionSelect.value : 'Standard';

    // Compile subsets or complete dataset based on scope
    let productsToSend = [];
    let colorsToSend = [];
    let sizesToSend = [];

    if (bulkSaveScope === 'selected') {
        productsToSend = bulkCalculatedData.products.filter(p => bulkSelectedProducts.has(p.product_id));
        colorsToSend = bulkCalculatedData.colors.filter(c => bulkSelectedColors.has(`${c.product_id}-${c.color_code}`));
        sizesToSend = bulkCalculatedData.sizes.filter(s => bulkSelectedSizes.has(`${s.product_id}-${s.color_code}-${s.size_id}`));
    } else {
        productsToSend = bulkCalculatedData.products;
        colorsToSend = bulkCalculatedData.colors;
        sizesToSend = bulkCalculatedData.sizes;
    }

    const loader = document.getElementById('bulk-contrib-loader');
    const loaderText = document.getElementById('bulk-loader-text');
    const saveBtn = document.getElementById('btn-bulk-fix-save');
    const saveSelectedBtn = document.getElementById('btn-bulk-fix-selected');

    if (loader) loader.classList.remove('hidden');
    if (loaderText) loaderText.textContent = "Saving contributions...";
    if (saveBtn) saveBtn.disabled = true;
    if (saveSelectedBtn) saveSelectedBtn.disabled = true;

    try {
        const response = await fetch('/api/planning-contribution/bulk-save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from_month: fromMonth,
                from_year: fromYear,
                to_month: toMonth,
                to_year: toYear,
                version: version,
                products: productsToSend,
                colors: colorsToSend,
                sizes: sizesToSend
            })
        });

        const data = await response.json();
        if (response.ok && data.success) {
            const savedMap = {};
            data.saved_records.forEach(r => {
                let key = '';
                if (r.contribution_type === 'Product') {
                    key = `Product-${r.product_id}`;
                } else if (r.contribution_type === 'Color') {
                    key = `Color-${r.product_id}-${r.color_code}`;
                } else if (r.contribution_type === 'Size') {
                    key = `Size-${r.product_id}-${r.size_id}-${r.color_code || ''}`;
                }
                savedMap[key] = r;
            });

            // Update local state details to show updated fixed percentages instantly in UI
            bulkCalculatedData.products.forEach(p => {
                const rec = savedMap[`Product-${p.product_id}`];
                if (rec) {
                    p.current_fixed_pct = rec.fixed_percentage;
                    p.status = 'Completed';
                    p.last_updated = rec.last_updated;
                    p.updated_by = rec.updated_by;
                }
            });
            bulkCalculatedData.colors.forEach(c => {
                const rec = savedMap[`Color-${c.product_id}-${c.color_code}`];
                if (rec) {
                    c.current_fixed_pct = rec.fixed_percentage;
                    c.status = 'Completed';
                    c.last_updated = rec.last_updated;
                    c.updated_by = rec.updated_by;
                }
            });
            bulkCalculatedData.sizes.forEach(s => {
                const rec = savedMap[`Size-${s.product_id}-${s.size_id}-${s.color_code || ''}`];
                if (rec) {
                    s.current_fixed_pct = rec.fixed_percentage;
                    s.status = 'Completed';
                    s.last_updated = rec.last_updated;
                    s.updated_by = rec.updated_by;
                }
            });

            // Clear selections of the rows that were fixed
            if (bulkSaveScope === 'selected') {
                productsToSend.forEach(p => bulkSelectedProducts.delete(p.product_id));
                colorsToSend.forEach(c => bulkSelectedColors.delete(`${c.product_id}-${c.color_code}`));
                sizesToSend.forEach(s => bulkSelectedSizes.delete(`${s.product_id}-${s.color_code}-${s.size_id}`));
            } else {
                bulkSelectedProducts.clear();
                bulkSelectedColors.clear();
                bulkSelectedSizes.clear();
            }

            updateSelectionCounter();
            renderBulkTable();

            alert(`${productsToSend.length} Product, ${colorsToSend.length} Color and ${sizesToSend.length} Size contributions fixed successfully.`);
        } else {
            alert(`Error saving contributions: ${data.message || 'Unknown error'}`);
        }
    } catch (err) {
        console.error("Error executing bulk save:", err);
        alert(`Save failed: ${err.message}`);
    } finally {
        if (loader) loader.classList.add('hidden');
        if (saveBtn) saveBtn.disabled = false;
        updateSelectionCounter();
    }
}

// ----------------------------------------------------
// EXPORT TO EXCEL / CSV CONTEXT IMPLEMENTATION
// ----------------------------------------------------

function exportBulkToExcel() {
    if (!bulkCalculatedData) return;

    const productsCount = bulkSelectedProducts.size;
    const colorsCount = bulkSelectedColors.size;
    const sizesCount = bulkSelectedSizes.size;
    const totalSelected = productsCount + colorsCount + sizesCount;

    let exportSelectedOnly = false;
    if (totalSelected > 0) {
        exportSelectedOnly = confirm(`You have ${totalSelected} selected items. Do you want to export ONLY the selected rows? (Click Cancel to export ALL calculated rows)`);
    }

    const headers = [
        "Level",
        "Product",
        "Color",
        "Size",
        "Sales Qty",
        "Calculated %",
        "Current Fixed %",
        "Difference",
        "Status"
    ];

    let csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n";

    let prods = bulkCalculatedData.products;
    let cols = bulkCalculatedData.colors;
    let szs = bulkCalculatedData.sizes;

    if (exportSelectedOnly) {
        prods = prods.filter(p => bulkSelectedProducts.has(p.product_id));
        cols = cols.filter(c => bulkSelectedColors.has(`${c.product_id}-${c.color_code}`));
        szs = szs.filter(s => bulkSelectedSizes.has(`${s.product_id}-${s.color_code}-${s.size_id}`));
    }

    prods.forEach(p => {
        const cf = p.current_fixed_pct !== null && p.current_fixed_pct !== undefined ? p.current_fixed_pct : 0.0;
        const diff = (p.new_pct || 0) - cf;
        const line = [
            "Product",
            `"${p.product_name}"`,
            "",
            "",
            `"${p.sales_qty || 0}"`,
            `"${(p.calculated_pct || 0).toFixed(2)}%"`,
            `"${p.current_fixed_pct !== null && p.current_fixed_pct !== undefined ? p.current_fixed_pct.toFixed(2) + '%' : '-'}"`,
            `"${diff.toFixed(2)}%"`,
            `"${p.status || 'Draft'}"`
        ];
        csvContent += line.join(",") + "\n";
    });

    cols.forEach(c => {
        const cf = c.current_fixed_pct !== null && c.current_fixed_pct !== undefined ? c.current_fixed_pct : 0.0;
        const diff = (c.new_pct || 0) - cf;
        const line = [
            "Color",
            `"${c.product_name}"`,
            `"${c.color_name}"`,
            "",
            `"${c.sales_qty || 0}"`,
            `"${(c.calculated_pct || 0).toFixed(2)}%"`,
            `"${c.current_fixed_pct !== null && c.current_fixed_pct !== undefined ? c.current_fixed_pct.toFixed(2) + '%' : '-'}"`,
            `"${diff.toFixed(2)}%"`,
            `"${c.status || 'Draft'}"`
        ];
        csvContent += line.join(",") + "\n";
    });

    szs.forEach(s => {
        const cf = s.current_fixed_pct !== null && s.current_fixed_pct !== undefined ? s.current_fixed_pct : 0.0;
        const diff = (s.new_pct || 0) - cf;
        const line = [
            "Size",
            `"${s.product_name}"`,
            `"${s.color_name || ''}"`,
            `"${s.size_name}"`,
            `"${s.sales_qty || 0}"`,
            `"${(s.calculated_pct || 0).toFixed(2)}%"`,
            `"${s.current_fixed_pct !== null && s.current_fixed_pct !== undefined ? s.current_fixed_pct.toFixed(2) + '%' : '-'}"`,
            `"${diff.toFixed(2)}%"`,
            `"${s.status || 'Draft'}"`
        ];
        csvContent += line.join(",") + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Bulk_Contribution_Fixing_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);

    link.click();
    document.body.removeChild(link);
}


// =====================================================================
// STOCK / WIP / PENDING ORDER - DELETE ALL & BULK FEED WORKFLOW
// =====================================================================

let bulkFeedState = {
    sheets: {
        'Fabric Stock': [],
        'Fabric WIP': [],
        'Production WIP': [],
        'Pending Orders': [],
        'Finished Goods': []
    },
    activeSheet: 'Fabric Stock',
    searchQuery: '',
    filterStatus: '',
    currentPage: 1,
    pageSize: 25,
    isValidated: false,
    isLoaded: false,
    filename: '',
    masterOptions: null,
    editingRowIdx: null
};

function downloadStockWipBulkTemplate() {
    window.location.href = '/api/planning-stock/bulk-feed-template';
}

let stockWipDeleteCounts = {};

async function openDeleteAllStockWipModal() {
    showLoader(true, "Fetching current Stock & WIP record counts...");
    try {
        const response = await fetch('/api/planning-stock/counts');
        const result = await response.json();
        if (response.ok && result.success) {
            const counts = result.counts || {};
            stockWipDeleteCounts = counts;
            const elFabStock = document.getElementById('delete-all-cnt-fabric-stock');
            const elFabWip = document.getElementById('delete-all-cnt-fabric-wip');
            const elProdWip = document.getElementById('delete-all-cnt-production-wip');
            const elPending = document.getElementById('delete-all-cnt-pending-orders');
            const elFinished = document.getElementById('delete-all-cnt-finished-goods');

            if (elFabStock) elFabStock.textContent = (counts.fabric_stock || 0).toLocaleString();
            if (elFabWip) elFabWip.textContent = (counts.fabric_wip || 0).toLocaleString();
            if (elProdWip) elProdWip.textContent = (counts.production_wip || 0).toLocaleString();
            if (elPending) elPending.textContent = (counts.pending_orders || 0).toLocaleString();
            if (elFinished) elFinished.textContent = (counts.finished_goods || 0).toLocaleString();

            // Set all checkboxes checked by default
            document.querySelectorAll('.delete-stock-wip-cb').forEach(cb => {
                cb.checked = true;
            });
            const selectAllCb = document.getElementById('delete-all-select-all');
            if (selectAllCb) selectAllCb.checked = true;

            updateDeleteSelectedSummary();

            const modal = document.getElementById('modal-stock-wip-delete-all');
            if (modal) modal.classList.remove('hidden');
        } else {
            showToast('Error', result.message || 'Failed to fetch record counts.', 'error');
        }
    } catch (err) {
        console.error("Error opening delete all modal:", err);
        showToast('Error', 'Network error fetching record counts.', 'error');
    } finally {
        showLoader(false);
    }
}

function toggleDeleteAllStockWipCheckboxes(checked) {
    document.querySelectorAll('.delete-stock-wip-cb').forEach(cb => {
        cb.checked = checked;
    });
    updateDeleteSelectedSummary();
}

function updateDeleteSelectedSummary() {
    const checkboxes = document.querySelectorAll('.delete-stock-wip-cb');
    let total = 0;
    let checkedCount = 0;

    checkboxes.forEach(cb => {
        if (cb.checked) {
            checkedCount++;
            const tabKey = cb.value.replace('-', '_');
            total += (stockWipDeleteCounts[tabKey] || 0);
        }
    });

    const selectAllCb = document.getElementById('delete-all-select-all');
    if (selectAllCb) {
        selectAllCb.checked = (checkedCount === checkboxes.length);
        selectAllCb.indeterminate = (checkedCount > 0 && checkedCount < checkboxes.length);
    }

    const elTotal = document.getElementById('delete-all-cnt-total');
    if (elTotal) elTotal.textContent = total.toLocaleString();

    const btn = document.getElementById('btn-confirm-delete-all-stock-wip');
    if (btn) {
        btn.disabled = (checkedCount === 0);
        btn.innerHTML = `<i class="fa-solid fa-trash-can"></i> Delete Selected Records (${total.toLocaleString()})`;
    }
}

function closeDeleteAllStockWipModal() {
    const modal = document.getElementById('modal-stock-wip-delete-all');
    if (modal) modal.classList.add('hidden');
}

async function confirmDeleteAllStockWip() {
    const checkedBoxes = Array.from(document.querySelectorAll('.delete-stock-wip-cb:checked'));
    if (checkedBoxes.length === 0) {
        alert("Please select at least one table to delete.");
        return;
    }

    const selectedTabs = checkedBoxes.map(cb => cb.value);

    const btn = document.getElementById('btn-confirm-delete-all-stock-wip');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting...';
    }

    showLoader(true, "Deleting records from selected tables...");
    try {
        const response = await fetch('/api/planning-stock/delete-all', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tabs: selectedTabs })
        });
        const result = await response.json();
        if (response.ok && result.success) {
            closeDeleteAllStockWipModal();
            showToast('Success', result.message || 'Records deleted successfully.', 'success');

            await fetchStockWipSavedData();
        } else {
            showToast('Delete Failed', result.message || 'Failed to delete records.', 'error');
        }
    } catch (err) {
        console.error("Error executing delete:", err);
        showToast('Error', 'Network error while deleting records.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
        }
        showLoader(false);
    }
}

async function fetchStockWipMasterOptionsIfNeeded() {
    if (bulkFeedState.masterOptions) return bulkFeedState.masterOptions;
    try {
        const resp = await fetch('/api/planning-stock/master-options');
        const res = await resp.json();
        if (resp.ok && res.success) {
            bulkFeedState.masterOptions = res;
            return res;
        }
    } catch (e) {
        console.warn("Could not fetch master options:", e);
    }
    return null;
}

async function openStockWipBulkFeedModal() {
    await fetchStockWipMasterOptionsIfNeeded();
    const modal = document.getElementById('modal-stock-wip-bulk-feed');
    if (!modal) return;

    modal.classList.remove('hidden');

    if (bulkFeedState.isLoaded) {
        document.getElementById('bulk-feed-upload-view').classList.add('hidden');
        document.getElementById('bulk-feed-grid-view').classList.remove('hidden');
        renderBulkFeedGrid();
    } else {
        document.getElementById('bulk-feed-upload-view').classList.remove('hidden');
        document.getElementById('bulk-feed-grid-view').classList.add('hidden');
    }
}

function closeStockWipBulkFeedModal() {
    const modal = document.getElementById('modal-stock-wip-bulk-feed');
    if (modal) modal.classList.add('hidden');
}

function triggerBulkFeedReupload() {
    bulkFeedState.isLoaded = false;
    bulkFeedState.isValidated = false;
    bulkFeedState.editingRowIdx = null;
    bulkFeedState.sheets = {
        'Fabric Stock': [],
        'Fabric WIP': [],
        'Production WIP': [],
        'Pending Orders': [],
        'Finished Goods': []
    };

    const fileInput = document.getElementById('bulk-feed-file-input');
    if (fileInput) fileInput.value = '';

    document.getElementById('bulk-feed-upload-view').classList.remove('hidden');
    document.getElementById('bulk-feed-grid-view').classList.add('hidden');

    const btnVal = document.getElementById('btn-bulk-feed-validate');
    const btnSave = document.getElementById('btn-bulk-feed-save');
    if (btnVal) btnVal.disabled = true;
    if (btnSave) btnSave.disabled = true;
}

function handleBulkFeedFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    showLoader(true, "Reading 5-sheet Excel workbook...");
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const dataBytes = new Uint8Array(e.target.result);
            const workbook = XLSX.read(dataBytes, { type: 'array' });

            const expectedSheets = ['Fabric Stock', 'Fabric WIP', 'Production WIP', 'Pending Orders', 'Finished Goods'];

            const sheetMap = {};
            workbook.SheetNames.forEach(name => {
                const norm = name.trim().toLowerCase();
                expectedSheets.forEach(exp => {
                    if (exp.toLowerCase() === norm) {
                        sheetMap[exp] = name;
                    }
                });
            });

            const missingSheets = expectedSheets.filter(s => !sheetMap[s]);
            if (missingSheets.length > 0) {
                showToast('Missing Sheets', `Bulk Feed failed: Missing required sheet(s): ${missingSheets.join(', ')}. Please use the standard template.`, 'error');
                showLoader(false);
                return;
            }

            const parsedSheets = {
                'Fabric Stock': [],
                'Fabric WIP': [],
                'Production WIP': [],
                'Pending Orders': [],
                'Finished Goods': []
            };

            let totalRecords = 0;

            expectedSheets.forEach(sheetTitle => {
                const realSheetName = sheetMap[sheetTitle];
                const worksheet = workbook.Sheets[realSheetName];
                const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

                rawRows.forEach((r, idx) => {
                    let parsedRow = {};
                    if (sheetTitle === 'Fabric Stock' || sheetTitle === 'Fabric WIP') {
                        parsedRow = {
                            'Fabric Name': String(r['Fabric Name'] || r['fabric_name'] || r['Fabric'] || r['fabric'] || '').trim(),
                            'GSM': String(r['GSM'] || r['gsm'] || '').trim(),
                            'DIA': String(r['DIA'] || r['dia'] || '').trim(),
                            'Color': String(r['Color'] || r['color'] || '').trim(),
                            'Weight': String(r['Weight'] || r['weight_mtr'] || r['weight'] || '').trim()
                        };
                    } else if (sheetTitle === 'Production WIP') {
                        parsedRow = {
                            'Product Name': String(r['Product Name'] || r['product_name'] || r['Product'] || r['product'] || '').trim(),
                            'Color': String(r['Color'] || r['color'] || '').trim(),
                            'Size': String(r['Size'] || r['size'] || '').trim(),
                            'Production Type': String(r['Production Type'] || r['production_type'] || 'Common').trim(),
                            'Production Group': String(r['Production Group'] || r['production_group'] || 'Group A').trim(),
                            'Qty': String(r['Qty'] || r['qty'] || r['Quantity'] || r['quantity'] || '').trim()
                        };
                    } else { // Pending Orders, Finished Goods
                        parsedRow = {
                            'Product Name': String(r['Product Name'] || r['product_name'] || r['Product'] || r['product'] || '').trim(),
                            'Color': String(r['Color'] || r['color'] || '').trim(),
                            'Size': String(r['Size'] || r['size'] || '').trim(),
                            'Qty': String(r['Qty'] || r['qty'] || r['Quantity'] || r['quantity'] || '').trim()
                        };
                    }

                    parsedRow._excelRow = idx + 2;
                    parsedRow._original = { ...parsedRow };
                    parsedRow._isEdited = false;
                    parsedRow.validation_status = 'NOT_VALIDATED';
                    parsedRow.validation_message = 'Loaded - Click Validate to verify';

                    parsedSheets[sheetTitle].push(parsedRow);
                    totalRecords++;
                });
            });

            bulkFeedState.sheets = parsedSheets;
            bulkFeedState.filename = file.name;
            bulkFeedState.isLoaded = true;
            bulkFeedState.isValidated = false;
            bulkFeedState.activeSheet = 'Fabric Stock';
            bulkFeedState.searchQuery = '';
            bulkFeedState.filterStatus = '';
            bulkFeedState.currentPage = 1;
            bulkFeedState.editingRowIdx = null;

            document.getElementById('bulk-feed-upload-view').classList.add('hidden');
            document.getElementById('bulk-feed-grid-view').classList.remove('hidden');

            const elFilename = document.getElementById('bulk-feed-filename');
            if (elFilename) elFilename.textContent = file.name;

            const elTotalBadge = document.getElementById('bulk-feed-total-loaded-badge');
            if (elTotalBadge) elTotalBadge.textContent = totalRecords.toLocaleString();

            updateBulkFeedKpiCards();
            updateBulkFeedSheetTabBadges();
            renderBulkFeedGrid();

            const btnVal = document.getElementById('btn-bulk-feed-validate');
            const btnSave = document.getElementById('btn-bulk-feed-save');
            if (btnVal) {
                btnVal.disabled = false;
                btnVal.innerHTML = '<i class="fa-solid fa-check-double"></i> <span>Validate</span>';
            }
            if (btnSave) btnSave.disabled = true;

            const footerStatus = document.getElementById('bulk-feed-footer-status');
            if (footerStatus) {
                footerStatus.innerHTML = `<i class="fa-solid fa-circle-info" style="color: var(--accent-blue);"></i> <span><strong>${totalRecords}</strong> records loaded. Review rows and click <strong>Validate</strong> to check master references.</span>`;
            }

            showToast('Workbook Loaded', `${totalRecords} rows loaded into 5 sheets. Click Validate to check rules.`, 'info');
        } catch (err) {
            console.error("Error reading Bulk Feed Excel:", err);
            showToast('Parse Error', 'Failed to read Excel workbook: ' + err.message, 'error');
        } finally {
            showLoader(false);
        }
    };
    reader.readAsArrayBuffer(file);
}

function switchBulkFeedSheet(sheetName) {
    bulkFeedState.activeSheet = sheetName;
    bulkFeedState.currentPage = 1;
    bulkFeedState.editingRowIdx = null;

    const sheetButtons = {
        'Fabric Stock': 'bulk-tab-fabric-stock',
        'Fabric WIP': 'bulk-tab-fabric-wip',
        'Production WIP': 'bulk-tab-production-wip',
        'Pending Orders': 'bulk-tab-pending-orders',
        'Finished Goods': 'bulk-tab-finished-goods'
    };

    Object.keys(sheetButtons).forEach(name => {
        const btn = document.getElementById(sheetButtons[name]);
        if (btn) {
            if (name === sheetName) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    });

    renderBulkFeedGrid();
}

function onBulkFeedSearchFilter() {
    const searchInput = document.getElementById('bulk-feed-search');
    const statusSelect = document.getElementById('bulk-feed-filter-status');
    bulkFeedState.searchQuery = searchInput ? searchInput.value.toLowerCase().trim() : '';
    bulkFeedState.filterStatus = statusSelect ? statusSelect.value : '';
    bulkFeedState.currentPage = 1;
    bulkFeedState.editingRowIdx = null;
    renderBulkFeedGrid();
}

function onBulkFeedPageSizeChange() {
    const sizeSelect = document.getElementById('bulk-feed-page-size');
    if (sizeSelect) {
        bulkFeedState.pageSize = parseInt(sizeSelect.value) || 25;
        bulkFeedState.currentPage = 1;
        renderBulkFeedGrid();
    }
}

function updateBulkFeedKpiCards() {
    let total = 0;
    let valid = 0;
    let invalid = 0;
    let duplicate = 0;

    Object.keys(bulkFeedState.sheets).forEach(sheetName => {
        const rows = bulkFeedState.sheets[sheetName] || [];
        total += rows.length;
        valid += rows.filter(r => r.validation_status === 'VALID').length;
        invalid += rows.filter(r => r.validation_status === 'INVALID' || r.validation_status === 'NEEDS_REVALIDATION').length;
        duplicate += rows.filter(r => r.validation_status === 'DUPLICATE').length;
    });

    const elTotal = document.getElementById('bulk-feed-kpi-total');
    const elValid = document.getElementById('bulk-feed-kpi-valid');
    const elInvalid = document.getElementById('bulk-feed-kpi-invalid');
    const elDuplicate = document.getElementById('bulk-feed-kpi-duplicate');

    if (elTotal) elTotal.textContent = total.toLocaleString();
    if (elValid) elValid.textContent = valid.toLocaleString();
    if (elInvalid) elInvalid.textContent = invalid.toLocaleString();
    if (elDuplicate) elDuplicate.textContent = duplicate.toLocaleString();

    const btnSave = document.getElementById('btn-bulk-feed-save');
    const footerStatus = document.getElementById('bulk-feed-footer-status');

    if (btnSave) {
        if (bulkFeedState.isValidated && total > 0 && invalid === 0 && duplicate === 0 && valid === total) {
            btnSave.disabled = false;
            if (footerStatus) {
                footerStatus.innerHTML = `<i class="fa-solid fa-circle-check" style="color: var(--accent-green);"></i> <span style="color: var(--accent-green); font-weight: 600;">All ${total} records are VALID and ready to save.</span>`;
            }
        } else {
            btnSave.disabled = true;
            if (bulkFeedState.isValidated) {
                if (footerStatus) {
                    footerStatus.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color: var(--accent-red);"></i> <span style="color: var(--accent-red); font-weight: 600;">${invalid} invalid and ${duplicate} duplicate rows require correction before saving.</span>`;
                }
            }
        }
    }
}

function updateBulkFeedSheetTabBadges() {
    const badgeMapping = {
        'Fabric Stock': 'badge-count-fabric-stock',
        'Fabric WIP': 'badge-count-fabric-wip',
        'Production WIP': 'badge-count-production-wip',
        'Pending Orders': 'badge-count-pending-orders',
        'Finished Goods': 'badge-count-finished-goods'
    };

    Object.keys(badgeMapping).forEach(sheetName => {
        const badgeEl = document.getElementById(badgeMapping[sheetName]);
        if (!badgeEl) return;
        const rows = bulkFeedState.sheets[sheetName] || [];
        const invCount = rows.filter(r => r.validation_status === 'INVALID' || r.validation_status === 'DUPLICATE' || r.validation_status === 'NEEDS_REVALIDATION').length;

        if (invCount > 0) {
            badgeEl.textContent = `${rows.length} (${invCount} invalid)`;
            badgeEl.style.borderColor = 'var(--accent-red)';
            badgeEl.style.color = 'var(--accent-red)';
            badgeEl.style.background = 'rgba(239, 68, 68, 0.1)';
        } else {
            badgeEl.textContent = `${rows.length}`;
            badgeEl.style.borderColor = 'var(--border-color)';
            badgeEl.style.color = 'var(--text-secondary)';
            badgeEl.style.background = 'transparent';
        }
    });
}

function renderBulkFeedGrid() {
    const thead = document.getElementById('bulk-feed-thead');
    const tbody = document.getElementById('bulk-feed-tbody');
    if (!thead || !tbody) return;

    const sheetName = bulkFeedState.activeSheet;
    const allSheetRows = bulkFeedState.sheets[sheetName] || [];

    let colHeaders = [];
    if (sheetName === 'Fabric Stock' || sheetName === 'Fabric WIP') {
        colHeaders = ['Fabric Name', 'GSM', 'DIA', 'Color', 'Weight'];
    } else if (sheetName === 'Production WIP') {
        colHeaders = ['Product Name', 'Color', 'Size', 'Production Type', 'Production Group', 'Qty'];
    } else { // Pending Orders, Finished Goods
        colHeaders = ['Product Name', 'Color', 'Size', 'Qty'];
    }

    let headerHtml = `<tr>
        <th style="width: 85px; text-align: center;">Excel Row</th>`;
    colHeaders.forEach(col => {
        headerHtml += `<th>${col}</th>`;
    });
    headerHtml += `
        <th style="width: 140px; text-align: center;">Status</th>
        <th style="width: 260px;">Validation Message</th>
        <th style="width: 120px; text-align: center;">Actions</th>
    </tr>`;
    thead.innerHTML = headerHtml;

    const filteredRowsWithIdx = allSheetRows.map((row, originalIdx) => ({ row, originalIdx })).filter(({ row }) => {
        if (bulkFeedState.filterStatus) {
            if (bulkFeedState.filterStatus === 'EDITED') {
                if (!row._isEdited) return false;
            } else if (row.validation_status !== bulkFeedState.filterStatus) {
                return false;
            }
        }
        if (bulkFeedState.searchQuery) {
            const query = bulkFeedState.searchQuery;
            const values = Object.values(row).map(v => String(v).toLowerCase());
            const matches = values.some(v => v.includes(query));
            if (!matches) return false;
        }
        return true;
    });

    const totalItems = filteredRowsWithIdx.length;
    const pageSize = bulkFeedState.pageSize;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (bulkFeedState.currentPage > totalPages) bulkFeedState.currentPage = totalPages;

    const startIndex = (bulkFeedState.currentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, totalItems);
    const visiblePageItems = filteredRowsWithIdx.slice(startIndex, endIndex);

    const elStart = document.getElementById('bulk-feed-page-start');
    const elEnd = document.getElementById('bulk-feed-page-end');
    const elTotal = document.getElementById('bulk-feed-page-total');
    if (elStart) elStart.textContent = totalItems === 0 ? '0' : (startIndex + 1).toLocaleString();
    if (elEnd) elEnd.textContent = endIndex.toLocaleString();
    if (elTotal) elTotal.textContent = totalItems.toLocaleString();

    renderBulkFeedPaginationButtons(totalPages);

    if (visiblePageItems.length === 0) {
        const colSpan = colHeaders.length + 4;
        tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align: center; padding: 32px; color: var(--text-muted); font-size: 13.5px;">
            <i class="fa-solid fa-inbox" style="font-size: 24px; margin-bottom: 8px; display: block; opacity: 0.5;"></i>
            ${allSheetRows.length === 0 ? 'No rows found in this sheet.' : 'No rows match the selected filter or search query.'}
        </td></tr>`;
        return;
    }

    const masterOptions = bulkFeedState.masterOptions || {};
    const fabricsList = masterOptions.fabrics || [];
    const colorsList = masterOptions.colors || [];
    const sizesList = masterOptions.sizes || [];
    const productsList = masterOptions.products || [];
    const commonProdsList = masterOptions.common_productions || [];

    let bodyHtml = '';

    visiblePageItems.forEach(({ row, originalIdx }) => {
        const isEditing = (bulkFeedState.editingRowIdx === originalIdx);
        const status = row.validation_status || 'NOT_VALIDATED';
        const msg = row.validation_message || '';

        let statusBadgeClass = 'table-badge badge-outline';
        let statusBadgeStyle = 'border-color: var(--border-color); color: var(--text-muted);';
        let statusText = 'NOT VALIDATED';

        if (status === 'VALID') {
            statusBadgeStyle = 'border-color: var(--accent-green); color: var(--accent-green); background: rgba(34, 197, 94, 0.1); font-weight: 700;';
            statusText = '<i class="fa-solid fa-check"></i> VALID';
        } else if (status === 'INVALID') {
            statusBadgeStyle = 'border-color: var(--accent-red); color: var(--accent-red); background: rgba(239, 68, 68, 0.12); font-weight: 700;';
            statusText = '<i class="fa-solid fa-xmark"></i> INVALID';
        } else if (status === 'DUPLICATE') {
            statusBadgeStyle = 'border-color: var(--accent-orange); color: var(--accent-orange); background: rgba(245, 158, 11, 0.12); font-weight: 700;';
            statusText = '<i class="fa-solid fa-copy"></i> DUPLICATE';
        } else if (status === 'NEEDS_REVALIDATION') {
            statusBadgeStyle = 'border-color: var(--accent-purple); color: var(--accent-purple); background: rgba(99, 102, 241, 0.12); font-weight: 700;';
            statusText = '<i class="fa-solid fa-arrows-rotate"></i> REVALIDATE';
        }

        const rowBg = isEditing ? 'background: rgba(59, 130, 246, 0.08);' : (status === 'INVALID' ? 'background: rgba(239, 68, 68, 0.04);' : '');

        bodyHtml += `<tr style="${rowBg}">`;

        bodyHtml += `<td style="text-align: center; font-size: 12px; color: var(--text-muted); font-weight: 600;">
            #${row._excelRow || (originalIdx + 2)}
            ${row._isEdited ? '<div class="table-badge" style="font-size: 9px; padding: 1px 4px; background: rgba(99, 102, 241, 0.2); color: var(--accent-purple); margin-top: 2px;">EDITED</div>' : ''}
        </td>`;

        if (sheetName === 'Fabric Stock' || sheetName === 'Fabric WIP') {
            if (isEditing) {
                bodyHtml += `<td>
                    <select id="edit-cell-fabric-${originalIdx}" class="modal-select" style="padding: 4px 6px; font-size: 12px; width: 100%; height: 28px; background: rgba(0,0,0,0.5); color: var(--text-primary); border: 1px solid var(--accent-blue); border-radius: var(--radius-sm);" onchange="onBulkFeedFabricChange(${originalIdx})">
                        <option value="">-- Select Fabric --</option>
                        ${fabricsList.map(f => `<option value="${f.fabric_name}" ${f.fabric_name.toLowerCase() === (row['Fabric Name'] || '').toLowerCase() ? 'selected' : ''}>${f.fabric_name}</option>`).join('')}
                    </select>
                </td>`;
                bodyHtml += `<td>
                    <input type="number" id="edit-cell-gsm-${originalIdx}" value="${row['GSM'] || ''}" style="padding: 4px 6px; font-size: 12px; width: 100%; height: 28px; background: rgba(0,0,0,0.5); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
                </td>`;
                bodyHtml += `<td>
                    <input type="number" step="0.5" id="edit-cell-dia-${originalIdx}" value="${row['DIA'] || ''}" style="padding: 4px 6px; font-size: 12px; width: 100%; height: 28px; background: rgba(0,0,0,0.5); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
                </td>`;
                bodyHtml += `<td>
                    <select id="edit-cell-color-${originalIdx}" class="modal-select" style="padding: 4px 6px; font-size: 12px; width: 100%; height: 28px; background: rgba(0,0,0,0.5); color: var(--text-primary); border: 1px solid var(--accent-blue); border-radius: var(--radius-sm);">
                        <option value="">-- Select Color --</option>
                        ${colorsList.map(c => `<option value="${c.display_color}" ${c.display_color.toLowerCase() === (row['Color'] || '').toLowerCase() || c.global_color_code.toLowerCase() === (row['Color'] || '').toLowerCase() ? 'selected' : ''}>${c.display_color}</option>`).join('')}
                    </select>
                </td>`;
                bodyHtml += `<td>
                    <input type="number" step="0.01" id="edit-cell-weight-${originalIdx}" value="${row['Weight'] || ''}" style="padding: 4px 6px; font-size: 12px; width: 100%; height: 28px; background: rgba(0,0,0,0.5); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
                </td>`;
            } else {
                bodyHtml += `<td><strong style="color: var(--text-primary);">${row['Fabric Name'] || '<span style="color: var(--accent-red);">(empty)</span>'}</strong></td>`;
                bodyHtml += `<td>${row['GSM'] || ''}</td>`;
                bodyHtml += `<td>${row['DIA'] || ''}</td>`;
                bodyHtml += `<td>${row['Color'] || '<span style="color: var(--accent-red);">(empty)</span>'}</td>`;
                bodyHtml += `<td>${row['Weight'] || ''}</td>`;
            }
        } else if (sheetName === 'Production WIP') {
            if (isEditing) {
                bodyHtml += `<td>
                    <select id="edit-cell-product-${originalIdx}" class="modal-select" style="padding: 4px 6px; font-size: 12px; width: 100%; height: 28px; background: rgba(0,0,0,0.5); color: var(--text-primary); border: 1px solid var(--accent-blue); border-radius: var(--radius-sm);">
                        <option value="">-- Select Product / Group --</option>
                        <optgroup label="Stand Alone Products">
                            ${productsList.map(p => `<option value="${p.product_name}" ${p.product_name.toLowerCase() === (row['Product Name'] || '').toLowerCase() ? 'selected' : ''}>${p.product_name}</option>`).join('')}
                        </optgroup>
                        <optgroup label="Common Production Groups">
                            ${commonProdsList.map(cp => `<option value="${cp}" ${cp.toLowerCase() === (row['Product Name'] || '').toLowerCase() ? 'selected' : ''}>${cp}</option>`).join('')}
                        </optgroup>
                    </select>
                </td>`;
                bodyHtml += `<td>
                    <select id="edit-cell-color-${originalIdx}" class="modal-select" style="padding: 4px 6px; font-size: 12px; width: 100%; height: 28px; background: rgba(0,0,0,0.5); color: var(--text-primary); border: 1px solid var(--accent-blue); border-radius: var(--radius-sm);">
                        <option value="">-- Select Color --</option>
                        ${colorsList.map(c => `<option value="${c.display_color}" ${c.display_color.toLowerCase() === (row['Color'] || '').toLowerCase() || c.global_color_code.toLowerCase() === (row['Color'] || '').toLowerCase() ? 'selected' : ''}>${c.display_color}</option>`).join('')}
                    </select>
                </td>`;
                bodyHtml += `<td>
                    <select id="edit-cell-size-${originalIdx}" class="modal-select" style="padding: 4px 6px; font-size: 12px; width: 100%; height: 28px; background: rgba(0,0,0,0.5); color: var(--text-primary); border: 1px solid var(--accent-blue); border-radius: var(--radius-sm);">
                        <option value="">-- Select Size --</option>
                        ${sizesList.map(s => `<option value="${s.size}" ${s.size.toLowerCase() === (row['Size'] || '').toLowerCase() || s.size_code.toLowerCase() === (row['Size'] || '').toLowerCase() ? 'selected' : ''}>${s.size}</option>`).join('')}
                    </select>
                </td>`;
                bodyHtml += `<td>
                    <select id="edit-cell-prodtype-${originalIdx}" class="modal-select" style="padding: 4px 6px; font-size: 12px; width: 100%; height: 28px; background: rgba(0,0,0,0.5); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
                        <option value="Common" ${(row['Production Type'] || 'Common') === 'Common' ? 'selected' : ''}>Common</option>
                        <option value="Stand Alone" ${(row['Production Type'] || '') === 'Stand Alone' ? 'selected' : ''}>Stand Alone</option>
                    </select>
                </td>`;
                bodyHtml += `<td>
                    <input type="text" id="edit-cell-prodgroup-${originalIdx}" value="${row['Production Group'] || 'Group A'}" style="padding: 4px 6px; font-size: 12px; width: 100%; height: 28px; background: rgba(0,0,0,0.5); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
                </td>`;
                bodyHtml += `<td>
                    <input type="number" id="edit-cell-qty-${originalIdx}" value="${row['Qty'] || ''}" style="padding: 4px 6px; font-size: 12px; width: 100%; height: 28px; background: rgba(0,0,0,0.5); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
                </td>`;
            } else {
                bodyHtml += `<td><strong style="color: var(--text-primary);">${row['Product Name'] || '<span style="color: var(--accent-red);">(empty)</span>'}</strong></td>`;
                bodyHtml += `<td>${row['Color'] || ''}</td>`;
                bodyHtml += `<td>${row['Size'] || ''}</td>`;
                bodyHtml += `<td>${row['Production Type'] || 'Common'}</td>`;
                bodyHtml += `<td>${row['Production Group'] || 'Group A'}</td>`;
                bodyHtml += `<td>${row['Qty'] || ''}</td>`;
            }
        } else { // Pending Orders, Finished Goods
            if (isEditing) {
                bodyHtml += `<td>
                    <select id="edit-cell-product-${originalIdx}" class="modal-select" style="padding: 4px 6px; font-size: 12px; width: 100%; height: 28px; background: rgba(0,0,0,0.5); color: var(--text-primary); border: 1px solid var(--accent-blue); border-radius: var(--radius-sm);">
                        <option value="">-- Select Product --</option>
                        ${productsList.map(p => `<option value="${p.product_name}" ${p.product_name.toLowerCase() === (row['Product Name'] || '').toLowerCase() ? 'selected' : ''}>${p.product_name}</option>`).join('')}
                    </select>
                </td>`;
                bodyHtml += `<td>
                    <select id="edit-cell-color-${originalIdx}" class="modal-select" style="padding: 4px 6px; font-size: 12px; width: 100%; height: 28px; background: rgba(0,0,0,0.5); color: var(--text-primary); border: 1px solid var(--accent-blue); border-radius: var(--radius-sm);">
                        <option value="">-- Select Color --</option>
                        ${colorsList.map(c => `<option value="${c.display_color}" ${c.display_color.toLowerCase() === (row['Color'] || '').toLowerCase() || c.global_color_code.toLowerCase() === (row['Color'] || '').toLowerCase() ? 'selected' : ''}>${c.display_color}</option>`).join('')}
                    </select>
                </td>`;
                bodyHtml += `<td>
                    <select id="edit-cell-size-${originalIdx}" class="modal-select" style="padding: 4px 6px; font-size: 12px; width: 100%; height: 28px; background: rgba(0,0,0,0.5); color: var(--text-primary); border: 1px solid var(--accent-blue); border-radius: var(--radius-sm);">
                        <option value="">-- Select Size --</option>
                        ${sizesList.map(s => `<option value="${s.size}" ${s.size.toLowerCase() === (row['Size'] || '').toLowerCase() || s.size_code.toLowerCase() === (row['Size'] || '').toLowerCase() ? 'selected' : ''}>${s.size}</option>`).join('')}
                    </select>
                </td>`;
                bodyHtml += `<td>
                    <input type="number" id="edit-cell-qty-${originalIdx}" value="${row['Qty'] || ''}" style="padding: 4px 6px; font-size: 12px; width: 100%; height: 28px; background: rgba(0,0,0,0.5); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
                </td>`;
            } else {
                bodyHtml += `<td><strong style="color: var(--text-primary);">${row['Product Name'] || '<span style="color: var(--accent-red);">(empty)</span>'}</strong></td>`;
                bodyHtml += `<td>${row['Color'] || ''}</td>`;
                bodyHtml += `<td>${row['Size'] || ''}</td>`;
                bodyHtml += `<td>${row['Qty'] || ''}</td>`;
            }
        }

        bodyHtml += `<td style="text-align: center;">
            <span class="${statusBadgeClass}" style="${statusBadgeStyle} font-size: 11px; padding: 2px 8px; border-radius: var(--radius-sm);">
                ${statusText}
            </span>
        </td>`;

        bodyHtml += `<td style="font-size: 12px; color: ${status === 'INVALID' ? 'var(--accent-red)' : (status === 'DUPLICATE' ? 'var(--accent-orange)' : 'var(--text-secondary)')};">
            ${msg || '-'}
        </td>`;

        bodyHtml += `<td style="text-align: center; white-space: nowrap;">`;
        if (isEditing) {
            bodyHtml += `
                <button class="btn btn-sm btn-success" onclick="applyBulkFeedRowEdit(${originalIdx})" style="padding: 2px 8px; font-size: 11px; margin-right: 4px;" title="Apply changes">
                    <i class="fa-solid fa-check"></i>
                </button>
                <button class="btn btn-sm btn-outline" onclick="cancelBulkFeedRowEdit()" style="padding: 2px 8px; font-size: 11px;" title="Cancel edit">
                    <i class="fa-solid fa-xmark"></i>
                </button>`;
        } else {
            bodyHtml += `
                <button class="btn btn-sm btn-outline" onclick="startBulkFeedRowEdit(${originalIdx})" style="padding: 2px 8px; font-size: 11px; margin-right: 4px;" title="Edit row inline">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>`;
            if (row._isEdited) {
                bodyHtml += `
                    <button class="btn btn-sm btn-outline" onclick="resetBulkFeedRow(${originalIdx})" style="padding: 2px 6px; font-size: 11px; color: var(--accent-orange); border-color: var(--accent-orange);" title="Restore original Excel value">
                        <i class="fa-solid fa-rotate-left"></i>
                    </button>`;
            }
        }
        bodyHtml += `</td></tr>`;
    });

    tbody.innerHTML = bodyHtml;
}

function onBulkFeedFabricChange(rowIdx) {
    const selFabric = document.getElementById(`edit-cell-fabric-${rowIdx}`);
    if (!selFabric) return;
    const fabName = selFabric.value;
    const masterOptions = bulkFeedState.masterOptions || {};
    const fabricsList = masterOptions.fabrics || [];
    const fabObj = fabricsList.find(f => f.fabric_name.toLowerCase() === fabName.toLowerCase());
    if (fabObj) {
        const inputGsm = document.getElementById(`edit-cell-gsm-${rowIdx}`);
        const inputDia = document.getElementById(`edit-cell-dia-${rowIdx}`);
        if (inputGsm && fabObj.gsm) inputGsm.value = fabObj.gsm;
        if (inputDia && fabObj.dias && fabObj.dias.length > 0) inputDia.value = fabObj.dias[0];
    }
}

function renderBulkFeedPaginationButtons(totalPages) {
    const container = document.getElementById('bulk-feed-pagination');
    if (!container) return;

    const curr = bulkFeedState.currentPage;
    let html = '';

    html += `<button class="btn-page ${curr === 1 ? 'disabled' : ''}" onclick="setBulkFeedPage(${curr - 1})" ${curr === 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>`;

    let startP = Math.max(1, curr - 2);
    let endP = Math.min(totalPages, curr + 2);

    for (let p = startP; p <= endP; p++) {
        html += `<button class="btn-page ${p === curr ? 'active' : ''}" onclick="setBulkFeedPage(${p})">${p}</button>`;
    }

    html += `<button class="btn-page ${curr === totalPages ? 'disabled' : ''}" onclick="setBulkFeedPage(${curr + 1})" ${curr === totalPages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button>`;

    container.innerHTML = html;
}

function setBulkFeedPage(pageNum) {
    bulkFeedState.currentPage = pageNum;
    renderBulkFeedGrid();
}

function startBulkFeedRowEdit(originalIdx) {
    bulkFeedState.editingRowIdx = originalIdx;
    renderBulkFeedGrid();
}

function cancelBulkFeedRowEdit() {
    bulkFeedState.editingRowIdx = null;
    renderBulkFeedGrid();
}

function applyBulkFeedRowEdit(originalIdx) {
    const sheetName = bulkFeedState.activeSheet;
    const row = bulkFeedState.sheets[sheetName][originalIdx];
    if (!row) return;

    if (sheetName === 'Fabric Stock' || sheetName === 'Fabric WIP') {
        const elFab = document.getElementById(`edit-cell-fabric-${originalIdx}`);
        const elGsm = document.getElementById(`edit-cell-gsm-${originalIdx}`);
        const elDia = document.getElementById(`edit-cell-dia-${originalIdx}`);
        const elCol = document.getElementById(`edit-cell-color-${originalIdx}`);
        const elWeight = document.getElementById(`edit-cell-weight-${originalIdx}`);

        if (elFab) row['Fabric Name'] = elFab.value.trim();
        if (elGsm) row['GSM'] = elGsm.value.trim();
        if (elDia) row['DIA'] = elDia.value.trim();
        if (elCol) row['Color'] = elCol.value.trim();
        if (elWeight) row['Weight'] = elWeight.value.trim();
    } else if (sheetName === 'Production WIP') {
        const elProd = document.getElementById(`edit-cell-product-${originalIdx}`);
        const elCol = document.getElementById(`edit-cell-color-${originalIdx}`);
        const elSize = document.getElementById(`edit-cell-size-${originalIdx}`);
        const elType = document.getElementById(`edit-cell-prodtype-${originalIdx}`);
        const elGroup = document.getElementById(`edit-cell-prodgroup-${originalIdx}`);
        const elQty = document.getElementById(`edit-cell-qty-${originalIdx}`);

        if (elProd) row['Product Name'] = elProd.value.trim();
        if (elCol) row['Color'] = elCol.value.trim();
        if (elSize) row['Size'] = elSize.value.trim();
        if (elType) row['Production Type'] = elType.value.trim();
        if (elGroup) row['Production Group'] = elGroup.value.trim();
        if (elQty) row['Qty'] = elQty.value.trim();
    } else { // Pending Orders, Finished Goods
        const elProd = document.getElementById(`edit-cell-product-${originalIdx}`);
        const elCol = document.getElementById(`edit-cell-color-${originalIdx}`);
        const elSize = document.getElementById(`edit-cell-size-${originalIdx}`);
        const elQty = document.getElementById(`edit-cell-qty-${originalIdx}`);

        if (elProd) row['Product Name'] = elProd.value.trim();
        if (elCol) row['Color'] = elCol.value.trim();
        if (elSize) row['Size'] = elSize.value.trim();
        if (elQty) row['Qty'] = elQty.value.trim();
    }

    row._isEdited = true;
    row.validation_status = 'NEEDS_REVALIDATION';
    row.validation_message = 'Edited - Click Re-Validate to check rules';

    bulkFeedState.editingRowIdx = null;

    const btnSave = document.getElementById('btn-bulk-feed-save');
    if (btnSave) btnSave.disabled = true;

    const btnVal = document.getElementById('btn-bulk-feed-validate');
    if (btnVal) {
        btnVal.disabled = false;
        btnVal.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> <span>Re-Validate</span>';
    }

    updateBulkFeedKpiCards();
    updateBulkFeedSheetTabBadges();
    renderBulkFeedGrid();
    showToast('Row Updated', `Row #${row._excelRow} updated. Click Re-Validate to verify changes.`, 'info');
}

function resetBulkFeedRow(originalIdx) {
    const sheetName = bulkFeedState.activeSheet;
    const row = bulkFeedState.sheets[sheetName][originalIdx];
    if (!row || !row._original) return;

    Object.keys(row._original).forEach(k => {
        row[k] = row._original[k];
    });
    row._isEdited = false;
    row.validation_status = 'NOT_VALIDATED';
    row.validation_message = 'Restored to original Excel value';

    const btnSave = document.getElementById('btn-bulk-feed-save');
    if (btnSave) btnSave.disabled = true;

    const btnVal = document.getElementById('btn-bulk-feed-validate');
    if (btnVal) {
        btnVal.disabled = false;
        btnVal.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> <span>Re-Validate</span>';
    }

    updateBulkFeedKpiCards();
    updateBulkFeedSheetTabBadges();
    renderBulkFeedGrid();
    showToast('Row Reset', `Row #${row._excelRow} restored to original Excel values.`, 'info');
}

async function validateBulkFeedGridData() {
    let totalRows = 0;
    Object.keys(bulkFeedState.sheets).forEach(s => {
        totalRows += bulkFeedState.sheets[s].length;
    });

    if (totalRows === 0) {
        showToast('Empty Workbook', 'No rows available to validate.', 'warning');
        return;
    }

    showLoader(true, "Validating current Bulk Feed records against database master tables...");
    try {
        const response = await fetch('/api/planning-stock/bulk-feed/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sheets: bulkFeedState.sheets })
        });

        const result = await response.json();
        if (response.ok && result.success) {
            Object.keys(result.sheets).forEach(sheetName => {
                const validatedRows = result.sheets[sheetName] || [];
                const currentRows = bulkFeedState.sheets[sheetName] || [];

                validatedRows.forEach((vRow, idx) => {
                    if (currentRows[idx]) {
                        currentRows[idx].validation_status = vRow.validation_status;
                        currentRows[idx].validation_message = vRow.validation_message;
                        Object.keys(vRow).forEach(k => {
                            if (!k.startsWith('_')) {
                                currentRows[idx][k] = vRow[k];
                            }
                        });
                    }
                });
            });

            bulkFeedState.isValidated = true;

            const btnVal = document.getElementById('btn-bulk-feed-validate');
            if (btnVal) {
                btnVal.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> <span>Re-Validate</span>';
            }

            updateBulkFeedKpiCards();
            updateBulkFeedSheetTabBadges();
            renderBulkFeedGrid();

            const summary = result.summary || {};
            const invCount = summary.invalid || 0;
            const dupCount = summary.duplicate || 0;

            if (invCount === 0 && dupCount === 0) {
                showToast('Validation Success', 'All records are VALID! You can now click Save Bulk Feed.', 'success');
            } else {
                showToast('Validation Complete', `Found ${invCount} invalid and ${dupCount} duplicate records. Filter by Invalid to correct them.`, 'warning');
            }
        } else {
            showToast('Validation Error', result.message || 'Validation failed.', 'error');
        }
    } catch (err) {
        console.error("Error during bulk validation:", err);
        showToast('Error', 'Network error during validation.', 'error');
    } finally {
        showLoader(false);
    }
}

async function saveBulkFeedGridData() {
    let totalInvalid = 0;
    let totalDuplicate = 0;
    let totalRows = 0;

    Object.keys(bulkFeedState.sheets).forEach(sheetName => {
        const rows = bulkFeedState.sheets[sheetName] || [];
        totalRows += rows.length;
        totalInvalid += rows.filter(r => r.validation_status === 'INVALID' || r.validation_status === 'NEEDS_REVALIDATION').length;
        totalDuplicate += rows.filter(r => r.validation_status === 'DUPLICATE').length;
    });

    if (totalRows === 0) {
        showToast('Empty Workbook', 'No records to save.', 'warning');
        return;
    }

    if (totalInvalid > 0 || totalDuplicate > 0) {
        showToast('Cannot Save', `Please correct all ${totalInvalid} invalid and ${totalDuplicate} duplicate rows before saving.`, 'error');
        return;
    }

    const btnSave = document.getElementById('btn-bulk-feed-save');
    if (btnSave) {
        btnSave.disabled = true;
        btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    }

    showLoader(true, "Executing atomic bulk save across all 5 transaction tables...");
    try {
        const response = await fetch('/api/planning-stock/bulk-feed/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sheets: bulkFeedState.sheets })
        });

        const result = await response.json();
        if (response.ok && result.success) {
            closeStockWipBulkFeedModal();

            const inserted = result.inserted_counts || {};
            const summaryMsg = `Fabric Stock: ${inserted['Fabric Stock'] || 0}, Fabric WIP: ${inserted['Fabric WIP'] || 0}, Production WIP: ${inserted['Production WIP'] || 0}, Pending Orders: ${inserted['Pending Orders'] || 0}, Finished Goods: ${inserted['Finished Goods'] || 0}. (Total: ${result.total_inserted || 0})`;

            showToast('Bulk Feed Completed', `Bulk Feed saved successfully! ${summaryMsg}`, 'success');

            triggerBulkFeedReupload();
            await fetchStockWipSavedData();
        } else {
            showToast('Save Failed', result.message || 'Failed to save Bulk Feed records.', 'error');
        }
    } catch (err) {
        console.error("Error saving Bulk Feed:", err);
        showToast('Error', 'Network error while saving Bulk Feed data.', 'error');
    } finally {
        if (btnSave) {
            btnSave.disabled = false;
            btnSave.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> <span>Save Bulk Feed</span>';
        }
        showLoader(false);
    }
}

// =====================================================================
// PENDING QTY PLANNING MODULE CONTROLLER (ISOLATED & PRODUCTION-SAFE)
// =====================================================================

const pendingPlanningState = {
    plan_id: null,
    plan_name: 'LIVE_PENDING_ORDERS',
    financial_year: 'CURRENT',
    version: 'v1',
    from_date: '2020-01-01',
    to_date: '2099-12-31',
    activeSubTab: 'pending-plan',
    meta: null,
    dataLoaded: false,
    lastLoadedPlanId: null,
    allRecords: [],
    filters: {
        item_type: new Set(),
        brand: new Set(),
        category: new Set(),
        product_name: new Set(),
        color: new Set(),
        size: new Set(),
        status: new Set(),
        requirement_qty: null,
        fg_qty: null,
        wip_qty: null,
        already_planned_qty: null,
        net_pending_qty: null
    },
    distinctValues: {
        item_type: [],
        brand: [],
        category: [],
        product_name: [],
        color: [],
        size: [],
        status: []
    },
    activePopupCol: null,
    page: 1,
    per_page: 50,
    searchDebounceTimer: null,
    currentPoolForAlloc: null,
    expandedRows: new Set(),
    expandedPools: new Set()
};

// Global click handler to close pending plan filter popup when clicking outside
document.addEventListener('click', function (e) {
    const popup = document.getElementById('pending-plan-filter-popup');
    if (!popup || popup.classList.contains('hidden')) return;
    if (popup.contains(e.target)) return;
    if (e.target.closest('.pending-col-filter-btn')) return;
    closePendingPlanFilterPopup();
});

async function initializePendingQtyPlanningTab() {
    if (!pendingPlanningState.meta) {
        await loadPendingPlanningMeta();
    }
    await calculatePendingQtyPlan(false);
}

async function loadPendingPlanningMeta() {
    try {
        const res = await fetch('/api/pending-qty-plan/meta');
        const data = await res.json();
        if (data.success) {
            pendingPlanningState.meta = data;
        }
    } catch (err) {
        console.error("Error loading pending plan meta:", err);
    }
}

function populateSelectOptions(selectId, items, defaultLabel) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = `<option value="">${defaultLabel}</option>`;
    (items || []).forEach(item => {
        const opt = document.createElement('option');
        opt.value = item;
        opt.textContent = item;
        sel.appendChild(opt);
    });
}

function getPendingFilterValues() {
    return {
        brand: document.getElementById('pending-brand-filter')?.value || '',
        category: document.getElementById('pending-category-filter')?.value || '',
        product_type: document.getElementById('pending-product-type-filter')?.value || 'All',
        common_production_name: document.getElementById('pending-common-name-filter')?.value || '',
        product: document.getElementById('pending-product-filter')?.value || '',
        color: document.getElementById('pending-color-filter')?.value || '',
        size: document.getElementById('pending-size-filter')?.value || '',
        fabric_name: document.getElementById('pending-fabric-filter')?.value || '',
        status: document.getElementById('pending-status-filter')?.value || 'All',
        search: document.getElementById('pending-search-input')?.value || ''
    };
}

function applyPendingPlanningFilters() {
    pendingPlanningState.page = 1;
    loadActivePendingSubTabTable();
}

function debouncePendingSearch() {
    clearTimeout(pendingPlanningState.searchDebounceTimer);
    pendingPlanningState.searchDebounceTimer = setTimeout(() => {
        applyPendingPlanningFilters();
    }, 300);
}

async function calculatePendingQtyPlan(recalculate = true) {
    if (recalculate) {
        showLoader(true, "Calculating Net Pending Qty, Shared Fabric Pools & Allocations...");
    }

    try {
        const payload = {
            plan_name: 'LIVE_PENDING_ORDERS',
            financial_year: 'CURRENT',
            version: 'v1',
            from_date: '2020-01-01',
            to_date: '2099-12-31'
        };

        const res = await fetch('/api/pending-qty-plan/calculate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (res.ok && data.success) {
            pendingPlanningState.plan_id = data.plan_id;
            if (recalculate) {
                showToast('Calculated', 'Pending Qty Plan and Fabric Allocations calculated successfully!', 'success');
            }
            await refreshPendingPlanningSummary();
            await loadActivePendingSubTabTable();
        } else {
            showToast('Calculation Notice', data.message || 'No pending orders found.', 'info');
            clearPendingPlanningViews();
        }
    } catch (err) {
        console.error("Error calculating pending plan:", err);
        showToast('Error', 'Network error during calculation.', 'error');
    } finally {
        if (recalculate) {
            showLoader(false);
        }
    }
}

async function refreshPendingPlanningSummary() {
    try {
        const params = new URLSearchParams();
        if (pendingPlanningState.plan_id) {
            params.append('plan_id', pendingPlanningState.plan_id);
        }
        const res = await fetch(`/api/pending-qty-plan/summary?${params.toString()}`);
        const data = await res.json();
        if (data.success) {
            document.getElementById('kpi-total-pending-qty').textContent = Math.round(data.total_pending_qty || 0).toLocaleString();
            document.getElementById('kpi-cut-now-qty').textContent = Math.round(data.cut_now_qty || 0).toLocaleString();
            document.getElementById('kpi-partial-qty').textContent = Math.round(data.partial_qty || 0).toLocaleString();
            document.getElementById('kpi-shortage-qty').textContent = Math.round(data.fabric_shortage_qty || 0).toLocaleString();
            document.getElementById('kpi-shortage-kg-sub').textContent = `Shortage: ${(data.fabric_shortage_kg || 0).toFixed(2)} KG`;

            const pools = data.fabric_pools || {};
            document.getElementById('kpi-pool-enough').textContent = pools.enough || 0;
            document.getElementById('kpi-pool-partial').textContent = pools.partial || 0;
            document.getElementById('kpi-pool-shortage').textContent = pools.shortage || 0;

            const badge = document.getElementById('kpi-plan-status-badge');
            if (badge) {
                const status = data.plan_status || 'Draft';
                badge.textContent = status;
                if (status === 'Confirmed') {
                    badge.style.background = '#10b981';
                } else if (status === 'Calculated') {
                    badge.style.background = '#3b82f6';
                } else if (status === 'Reviewed') {
                    badge.style.background = '#f59e0b';
                } else {
                    badge.style.background = '#6b7280';
                }
            }
        }
    } catch (err) {
        console.error("Error refreshing summary:", err);
    }
}

function clearPendingPlanningViews() {
    pendingPlanningState.dataLoaded = false;
    pendingPlanningState.allRecords = [];
    if (typeof fabRequiredState !== 'undefined') {
        fabRequiredState.dataLoaded = false;
        fabRequiredState.allRecords = [];
        fabRequiredState.lastLoadedPlanId = null;
    }
    document.getElementById('pending-plan-table-body').innerHTML = `
        <tr><td colspan="13" style="text-align: center; padding: 40px; color: var(--text-muted);">No pending planning data available.</td></tr>
    `;
    document.getElementById('cutting-plan-table-body').innerHTML = `
        <tr><td colspan="14" style="text-align: center; padding: 40px; color: var(--text-muted);">No cutting plan data available.</td></tr>
    `;
    document.getElementById('fab-required-table-body').innerHTML = `
        <tr><td colspan="14" style="text-align: center; padding: 40px; color: var(--text-muted);">No fabric pool data available.</td></tr>
    `;
}

function switchPendingSubTab(subTabId) {
    pendingPlanningState.activeSubTab = subTabId;

    document.getElementById('pending-subtab-btn-pending')?.classList.remove('active');
    document.getElementById('pending-subtab-btn-cutting')?.classList.remove('active');
    document.getElementById('pending-subtab-btn-fabric')?.classList.remove('active');

    document.getElementById('pending-subtab-view-pending')?.classList.add('hidden');
    document.getElementById('pending-subtab-view-cutting')?.classList.add('hidden');
    document.getElementById('pending-subtab-view-fabric')?.classList.add('hidden');

    if (subTabId === 'pending-plan') {
        document.getElementById('pending-subtab-btn-pending')?.classList.add('active');
        document.getElementById('pending-subtab-view-pending')?.classList.remove('hidden');
    } else if (subTabId === 'cutting-plan') {
        document.getElementById('pending-subtab-btn-cutting')?.classList.add('active');
        document.getElementById('pending-subtab-view-cutting')?.classList.remove('hidden');
    } else if (subTabId === 'fab-required') {
        document.getElementById('pending-subtab-btn-fabric')?.classList.add('active');
        document.getElementById('pending-subtab-view-fabric')?.classList.remove('hidden');
    }

    pendingPlanningState.page = 1;
    loadActivePendingSubTabTable();
}

async function loadActivePendingSubTabTable() {
    if (!pendingPlanningState.plan_id) return;

    if (pendingPlanningState.activeSubTab === 'pending-plan') {
        await loadPendingPlanTable(pendingPlanningState.page);
    } else if (pendingPlanningState.activeSubTab === 'cutting-plan') {
        await loadCuttingPlanTable(1);
    } else if (pendingPlanningState.activeSubTab === 'fab-required') {
        await loadFabRequiredTable(pendingPlanningState.page);
    }
}

// -------------------------------------------------------------
// TAB 1: PENDING QTY PLAN TABLE (EXCEL-STYLE IN-MEMORY FILTERING)
// -------------------------------------------------------------

function populatePendingPlanDistinctValues() {
    const item_types = new Set();
    const brands = new Set();
    const categories = new Set();
    const product_names = new Set();
    const colors = new Set();
    const sizes = new Set();
    const statuses = new Set();

    (pendingPlanningState.allRecords || []).forEach(r => {
        if (r.item_type) item_types.add(r.item_type);
        if (r.brand) brands.add(r.brand);
        if (r.category) categories.add(r.category);
        if (r.product_name) product_names.add(r.product_name);
        if (r.color) colors.add(r.color);
        if (r.size) sizes.add(r.size);
        if (r.status) statuses.add(r.status);
    });

    pendingPlanningState.distinctValues.item_type = Array.from(item_types).sort((a, b) => a.localeCompare(b));
    pendingPlanningState.distinctValues.brand = Array.from(brands).sort((a, b) => a.localeCompare(b));
    pendingPlanningState.distinctValues.category = Array.from(categories).sort((a, b) => a.localeCompare(b));
    pendingPlanningState.distinctValues.product_name = Array.from(product_names).sort((a, b) => a.localeCompare(b));
    pendingPlanningState.distinctValues.color = Array.from(colors).sort((a, b) => a.localeCompare(b));
    pendingPlanningState.distinctValues.size = Array.from(sizes).sort((a, b) => a.localeCompare(b));
    pendingPlanningState.distinctValues.status = Array.from(statuses).sort((a, b) => a.localeCompare(b));
}

function filterPendingPlanRecords() {
    return (pendingPlanningState.allRecords || []).filter(r => {
        // Categorical filters
        const cats = ['item_type', 'brand', 'category', 'product_name', 'color', 'size', 'status'];
        for (const col of cats) {
            const activeSet = pendingPlanningState.filters[col];
            if (activeSet && activeSet.size > 0) {
                const val = r[col] || '';
                if (!activeSet.has(val)) return false;
            }
        }

        // Numeric filters
        const nums = ['requirement_qty', 'fg_qty', 'wip_qty', 'already_planned_qty', 'net_pending_qty'];
        for (const col of nums) {
            const numFilter = pendingPlanningState.filters[col];
            if (numFilter && numFilter.operator) {
                const val = Number(r[col]) || 0;
                const v1 = numFilter.val1 !== null && numFilter.val1 !== undefined ? Number(numFilter.val1) : null;
                const v2 = numFilter.val2 !== null && numFilter.val2 !== undefined ? Number(numFilter.val2) : null;
                if (!evalPendingNumericPredicate(val, numFilter.operator, v1, v2)) {
                    return false;
                }
            }
        }

        return true;
    });
}

function evalPendingNumericPredicate(val, op, v1, v2) {
    if (v1 === null || isNaN(v1)) return true;
    switch (op) {
        case 'eq': return val === v1;
        case 'neq': return val !== v1;
        case 'gt': return val > v1;
        case 'gte': return val >= v1;
        case 'lt': return val < v1;
        case 'lte': return val <= v1;
        case 'between': return (v2 !== null && !isNaN(v2)) ? (val >= v1 && val <= v2) : (val >= v1);
        default: return true;
    }
}

async function loadPendingPlanTable(page = 1) {
    pendingPlanningState.page = page;

    // Check if initial fetch is needed or plan changed
    if (!pendingPlanningState.dataLoaded || pendingPlanningState.lastLoadedPlanId !== pendingPlanningState.plan_id) {
        if (!pendingPlanningState.plan_id) {
            renderPendingPlanEmpty("No active plan calculated. Please click <strong>Recalculate & Refresh</strong>.");
            return;
        }

        const tbody = document.getElementById('pending-plan-table-body');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="13" style="text-align: center; padding: 40px; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin" style="margin-right: 8px;"></i> Loading pending plan dataset...</td></tr>`;
        }

        try {
            const params = new URLSearchParams({
                plan_id: pendingPlanningState.plan_id,
                page: 1,
                per_page: -1
            });
            const res = await fetch(`/api/pending-qty-plan/pending-plan?${params.toString()}`);
            const data = await res.json();
            if (data.success && data.rows) {
                pendingPlanningState.allRecords = data.rows;
            } else {
                pendingPlanningState.allRecords = [];
            }
            pendingPlanningState.dataLoaded = true;
            pendingPlanningState.lastLoadedPlanId = pendingPlanningState.plan_id;
            populatePendingPlanDistinctValues();
        } catch (err) {
            console.error("Error fetching complete pending plan dataset:", err);
            pendingPlanningState.allRecords = [];
            pendingPlanningState.dataLoaded = true;
        }
    }

    renderFilteredPendingPlanTable();
}

function renderFilteredPendingPlanTable() {
    const tbody = document.getElementById('pending-plan-table-body');
    if (!tbody) return;

    const filteredRecords = filterPendingPlanRecords();
    const totalCount = filteredRecords.length;

    // Calculate dynamic totals for footer
    let totReq = 0, totFg = 0, totWip = 0, totPlanned = 0, totNet = 0;
    filteredRecords.forEach(r => {
        totReq += Number(r.requirement_qty) || 0;
        totFg += Number(r.fg_qty) || 0;
        totWip += Number(r.wip_qty) || 0;
        totPlanned += Number(r.already_planned_qty) || 0;
        totNet += Number(r.net_pending_qty) || 0;
    });

    const footReq = document.getElementById('foot-pending-req');
    if (footReq) footReq.textContent = Math.round(totReq).toLocaleString();
    const footFg = document.getElementById('foot-pending-fg');
    if (footFg) footFg.textContent = Math.round(totFg).toLocaleString();
    const footWip = document.getElementById('foot-pending-wip');
    if (footWip) footWip.textContent = Math.round(totWip).toLocaleString();
    const footPlanned = document.getElementById('foot-pending-planned');
    if (footPlanned) footPlanned.textContent = Math.round(totPlanned).toLocaleString();
    const footNet = document.getElementById('foot-pending-net');
    if (footNet) footNet.textContent = Math.round(totNet).toLocaleString();

    if (totalCount === 0) {
        tbody.innerHTML = `<tr><td colspan="13" style="text-align: center; padding: 40px; color: var(--text-muted);"><i class="fa-solid fa-filter-circle-xmark" style="margin-right: 6px;"></i> No pending planning records match the active filters.</td></tr>`;
        renderPendingPlanPaginationUI(0, pendingPlanningState.page, pendingPlanningState.per_page);
        return;
    }

    const startIdx = (pendingPlanningState.page - 1) * pendingPlanningState.per_page;
    const pageRows = filteredRecords.slice(startIdx, startIdx + pendingPlanningState.per_page);

    let html = '';
    pageRows.forEach(r => {
        const isCommon = (r.item_type === 'Common');
        const rowId = `pending-row-${r.id}`;
        const isExpanded = pendingPlanningState.expandedRows.has(rowId);

        html += `
            <tr id="${rowId}" style="border-bottom: 1px solid var(--border-color); ${isCommon ? 'background: rgba(59, 130, 246, 0.03);' : ''}">
                <td style="text-align: center;">
                    ${isCommon ? `<button class="btn btn-sm" onclick="togglePendingCommonMembers('${rowId}', '${escapeHtml(r.common_production_name)}', '${escapeHtml(r.color)}', '${escapeHtml(r.size)}', this)" style="padding: 2px 6px; font-size: 11px;"><i class="fa-solid ${isExpanded ? 'fa-minus' : 'fa-plus'}"></i></button>` : ''}
                </td>
                <td><span class="badge" style="background: ${isCommon ? '#8b5cf6' : '#6b7280'}; color: #fff; font-size: 10px; padding: 2px 6px;">${escapeHtml(r.item_type || '')}</span></td>
                <td>${escapeHtml(r.brand || '-')}</td>
                <td>${escapeHtml(r.category || '-')}</td>
                <td style="font-weight: 600; color: ${isCommon ? 'var(--accent-blue)' : 'var(--text-primary)'};">${escapeHtml(r.product_name || '')}</td>
                <td>${escapeHtml(r.color || '')}</td>
                <td><span class="badge" style="background: rgba(255,255,255,0.08);">${escapeHtml(r.size || '')}</span></td>
                <td style="text-align: right; font-weight: 600;">${Math.round(r.requirement_qty || 0).toLocaleString()}</td>
                <td style="text-align: right;">${Math.round(r.fg_qty || 0).toLocaleString()}</td>
                <td style="text-align: right;">${Math.round(r.wip_qty || 0).toLocaleString()}</td>
                <td style="text-align: right;">${Math.round(r.already_planned_qty || 0).toLocaleString()}</td>
                <td style="text-align: right; font-weight: 700; color: var(--primary-color); font-size: 13px;">${Math.round(r.net_pending_qty || 0).toLocaleString()}</td>
                <td style="text-align: center;">${renderStatusBadge(r.status)}</td>
            </tr>
            ${isCommon && isExpanded ? `<tr id="${rowId}-members" class="member-subrow"><td colspan="13" style="padding: 0 0 0 40px; background: rgba(0,0,0,0.2);"><div id="${rowId}-members-container" style="padding: 10px 0;"><i class="fa-solid fa-spinner fa-spin"></i> Loading members...</div></td></tr>` : ''}
        `;
    });

    tbody.innerHTML = html;
    renderPendingPlanPaginationUI(totalCount, pendingPlanningState.page, pendingPlanningState.per_page);
}

function renderPendingPlanEmpty(msg) {
    const tbody = document.getElementById('pending-plan-table-body');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="13" style="text-align: center; padding: 40px; color: var(--text-muted);">${msg}</td></tr>`;
    }
    renderPendingPlanPaginationUI(0, 1, pendingPlanningState.per_page);
}

function renderPendingPlanPaginationUI(totalRecords, page, perPage) {
    const container = document.getElementById('pending-plan-pagination');
    if (!container) return;

    if (totalRecords === 0) {
        container.innerHTML = `<div style="color: var(--text-muted);">Showing 0 to 0 of 0 records</div>`;
        return;
    }

    const totalPages = Math.ceil(totalRecords / perPage) || 1;
    const fromRecord = Math.min((page - 1) * perPage + 1, totalRecords);
    const toRecord = Math.min(page * perPage, totalRecords);

    container.innerHTML = `
        <div style="color: var(--text-secondary);">
            Showing <strong>${fromRecord}</strong> to <strong>${toRecord}</strong> of <strong>${totalRecords.toLocaleString()}</strong> records
            ${pendingPlanningState.allRecords.length !== totalRecords ? `<span style="color: var(--text-muted); font-size: 11px;"> (Filtered from ${pendingPlanningState.allRecords.length.toLocaleString()} total)</span>` : ''}
        </div>
        <div style="display: flex; gap: 6px; align-items: center;">
            <button class="btn btn-sm btn-outline" onclick="changePendingPlanPage(${page - 1})" ${page <= 1 ? 'disabled style="opacity: 0.4; cursor: not-allowed;"' : ''} style="height: 28px; padding: 0 10px;">
                <i class="fa-solid fa-chevron-left"></i>
            </button>
            <span style="font-size: 11.5px; color: var(--text-secondary); margin: 0 4px;">Page <strong>${page}</strong> of <strong>${totalPages}</strong></span>
            <button class="btn btn-sm btn-outline" onclick="changePendingPlanPage(${page + 1})" ${page >= totalPages ? 'disabled style="opacity: 0.4; cursor: not-allowed;"' : ''} style="height: 28px; padding: 0 10px;">
                <i class="fa-solid fa-chevron-right"></i>
            </button>
        </div>
    `;
}

function changePendingPlanPage(newPage) {
    const filteredRecords = filterPendingPlanRecords();
    const totalPages = Math.ceil(filteredRecords.length / pendingPlanningState.per_page) || 1;
    if (newPage < 1) newPage = 1;
    if (newPage > totalPages) newPage = totalPages;
    pendingPlanningState.page = newPage;
    renderFilteredPendingPlanTable(); // PURE IN-MEMORY (0 network requests)
}

const isPendingNumericCol = (colKey) => ['requirement_qty', 'fg_qty', 'wip_qty', 'already_planned_qty', 'net_pending_qty'].includes(colKey);

function openPendingPlanFilter(colKey, event) {
    if (event) event.stopPropagation();
    pendingPlanningState.activePopupCol = colKey;

    const popup = document.getElementById('pending-plan-filter-popup');
    const titleSpan = document.getElementById('pending-popup-col-title');
    const catSection = document.getElementById('pending-popup-categorical-section');
    const numSection = document.getElementById('pending-popup-numeric-section');
    const btn = event ? event.currentTarget : document.getElementById(`pending-filter-btn-${colKey}`);

    const colTitles = {
        item_type: 'Product Type Filter',
        brand: 'Brand Filter',
        category: 'Category Filter',
        product_name: 'Product / Group Filter',
        color: 'Color Filter',
        size: 'Size Filter',
        requirement_qty: 'Pending Order Qty Filter',
        fg_qty: 'FG Stock Filter',
        wip_qty: 'WIP Qty Filter',
        already_planned_qty: 'Already Planned Filter',
        net_pending_qty: 'Net Pending Qty Filter',
        status: 'Status Filter'
    };

    if (titleSpan) titleSpan.textContent = colTitles[colKey] || 'Filter';

    if (isPendingNumericCol(colKey)) {
        if (catSection) catSection.classList.add('hidden');
        if (numSection) numSection.classList.remove('hidden');
        renderPendingNumericFilterUI(colKey);
    } else {
        if (numSection) numSection.classList.add('hidden');
        if (catSection) catSection.classList.remove('hidden');
        const searchInput = document.getElementById('pending-popup-search');
        if (searchInput) searchInput.value = '';
        renderPendingFilterCheckboxes(colKey, '');
    }

    if (popup && btn) {
        popup.classList.remove('hidden');
        const rect = btn.getBoundingClientRect();
        popup.style.position = 'fixed';
        popup.style.zIndex = '99999';
        popup.style.top = `${rect.bottom + 4}px`;
        let leftPos = rect.left - 100;
        if (leftPos < 10) leftPos = 10;
        if (leftPos + 250 > window.innerWidth) leftPos = window.innerWidth - 260;
        popup.style.left = `${leftPos}px`;
        if (!isPendingNumericCol(colKey)) {
            const searchInput = document.getElementById('pending-popup-search');
            if (searchInput) setTimeout(() => searchInput.focus(), 50);
        }
    }
}

function renderPendingFilterCheckboxes(colKey, searchFilter) {
    const listContainer = document.getElementById('pending-popup-checkbox-list');
    if (!listContainer) return;

    const values = pendingPlanningState.distinctValues[colKey] || [];
    const activeSet = pendingPlanningState.filters[colKey];
    const term = (searchFilter || '').toLowerCase().trim();

    let html = '';
    let matchCount = 0;

    values.forEach((val, idx) => {
        if (term && !String(val).toLowerCase().includes(term)) return;
        matchCount++;
        const isChecked = (!activeSet || activeSet.size === 0) || activeSet.has(val);
        const itemId = `pending-chk-${colKey}-${idx}`;
        html += `
            <label class="pending-filter-checkbox-item" for="${itemId}">
                <input type="checkbox" id="${itemId}" value="${escapeHtml(val)}" ${isChecked ? 'checked' : ''}>
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(val)}</span>
            </label>
        `;
    });

    if (matchCount === 0) {
        html = `<div style="font-size: 11px; color: var(--text-muted); text-align: center; padding: 12px 0;">No matching options</div>`;
    }

    listContainer.innerHTML = html;
}

function onPendingFilterSearchInput(val) {
    if (!pendingPlanningState.activePopupCol) return;
    renderPendingFilterCheckboxes(pendingPlanningState.activePopupCol, val);
}

function pendingFilterSelectAll(selectAll) {
    const checkboxes = document.querySelectorAll('#pending-popup-checkbox-list input[type="checkbox"]');
    checkboxes.forEach(chk => { chk.checked = selectAll; });
}

function renderPendingNumericFilterUI(colKey) {
    const numFilter = pendingPlanningState.filters[colKey] || {};
    const opSelect = document.getElementById('pending-popup-num-operator');
    const val1Input = document.getElementById('pending-popup-num-val1');
    const val2Input = document.getElementById('pending-popup-num-val2');
    const val2Wrap = document.getElementById('pending-popup-num-val2-wrap');

    const op = numFilter.operator || 'gte';
    if (opSelect) opSelect.value = op;
    if (val1Input) val1Input.value = numFilter.val1 !== undefined && numFilter.val1 !== null ? numFilter.val1 : '';
    if (val2Input) val2Input.value = numFilter.val2 !== undefined && numFilter.val2 !== null ? numFilter.val2 : '';

    if (val2Wrap) {
        if (op === 'between') val2Wrap.classList.remove('hidden');
        else val2Wrap.classList.add('hidden');
    }
}

function onPendingNumericOperatorChange(val) {
    const val2Wrap = document.getElementById('pending-popup-num-val2-wrap');
    if (val2Wrap) {
        if (val === 'between') val2Wrap.classList.remove('hidden');
        else val2Wrap.classList.add('hidden');
    }
}

function applyPendingPlanFilterCurrent() {
    const colKey = pendingPlanningState.activePopupCol;
    if (!colKey) return;

    if (isPendingNumericCol(colKey)) {
        const op = document.getElementById('pending-popup-num-operator')?.value || 'gte';
        const v1Raw = document.getElementById('pending-popup-num-val1')?.value;
        const v2Raw = document.getElementById('pending-popup-num-val2')?.value;

        if (v1Raw === '' || v1Raw === undefined || v1Raw === null) {
            pendingPlanningState.filters[colKey] = null;
        } else {
            pendingPlanningState.filters[colKey] = {
                operator: op,
                val1: Number(v1Raw),
                val2: (op === 'between' && v2Raw !== '') ? Number(v2Raw) : null
            };
        }
    } else {
        const checkboxes = document.querySelectorAll('#pending-popup-checkbox-list input[type="checkbox"]');
        const checkedValues = new Set();
        checkboxes.forEach(chk => {
            if (chk.checked) checkedValues.add(chk.value);
        });

        const totalValues = pendingPlanningState.distinctValues[colKey] || [];
        if (checkedValues.size === totalValues.length || checkedValues.size === 0) {
            pendingPlanningState.filters[colKey] = new Set();
        } else {
            pendingPlanningState.filters[colKey] = checkedValues;
        }
    }

    updatePendingFilterBtnVisualState(colKey);
    closePendingPlanFilterPopup();
    pendingPlanningState.page = 1;
    renderFilteredPendingPlanTable(); // PURE IN-MEMORY (0 network requests)
}

function clearPendingPlanFilterCurrent() {
    const colKey = pendingPlanningState.activePopupCol;
    if (!colKey) return;

    if (isPendingNumericCol(colKey)) {
        pendingPlanningState.filters[colKey] = null;
    } else {
        if (pendingPlanningState.filters[colKey]) {
            pendingPlanningState.filters[colKey].clear();
        } else {
            pendingPlanningState.filters[colKey] = new Set();
        }
    }

    updatePendingFilterBtnVisualState(colKey);
    closePendingPlanFilterPopup();
    pendingPlanningState.page = 1;
    renderFilteredPendingPlanTable(); // PURE IN-MEMORY (0 network requests)
}

function clearAllPendingPlanHeaderFilters() {
    ['item_type', 'brand', 'category', 'product_name', 'color', 'size', 'status'].forEach(k => {
        if (pendingPlanningState.filters[k]) pendingPlanningState.filters[k].clear();
        else pendingPlanningState.filters[k] = new Set();
        updatePendingFilterBtnVisualState(k);
    });

    ['requirement_qty', 'fg_qty', 'wip_qty', 'already_planned_qty', 'net_pending_qty'].forEach(k => {
        pendingPlanningState.filters[k] = null;
        updatePendingFilterBtnVisualState(k);
    });

    closePendingPlanFilterPopup();
    pendingPlanningState.page = 1;
    renderFilteredPendingPlanTable(); // PURE IN-MEMORY (0 network requests)
}

function updatePendingFilterBtnVisualState(colKey) {
    const btn = document.getElementById(`pending-filter-btn-${colKey}`);
    let isFiltered = false;

    if (isPendingNumericCol(colKey)) {
        isFiltered = !!pendingPlanningState.filters[colKey];
    } else {
        isFiltered = pendingPlanningState.filters[colKey] && pendingPlanningState.filters[colKey].size > 0;
    }

    if (btn) {
        if (isFiltered) btn.classList.add('active');
        else btn.classList.remove('active');
    }

    // Check if any filter is active across all columns
    let anyActive = false;
    ['item_type', 'brand', 'category', 'product_name', 'color', 'size', 'status'].forEach(k => {
        if (pendingPlanningState.filters[k] && pendingPlanningState.filters[k].size > 0) anyActive = true;
    });
    ['requirement_qty', 'fg_qty', 'wip_qty', 'already_planned_qty', 'net_pending_qty'].forEach(k => {
        if (pendingPlanningState.filters[k]) anyActive = true;
    });

    const clearAllBtn = document.getElementById('pending-plan-clear-all-filters-btn');
    if (clearAllBtn) {
        if (anyActive) clearAllBtn.classList.remove('hidden');
        else clearAllBtn.classList.add('hidden');
    }
}

function closePendingPlanFilterPopup() {
    const popup = document.getElementById('pending-plan-filter-popup');
    if (popup) popup.classList.add('hidden');
    pendingPlanningState.activePopupCol = null;
}

async function togglePendingCommonMembers(rowId, commonName, primaryColor, size, btn) {
    const isExpanded = pendingPlanningState.expandedRows.has(rowId);
    if (isExpanded) {
        pendingPlanningState.expandedRows.delete(rowId);
        const subRow = document.getElementById(`${rowId}-members`);
        if (subRow) subRow.remove();
        if (btn) btn.innerHTML = '<i class="fa-solid fa-plus"></i>';
    } else {
        pendingPlanningState.expandedRows.add(rowId);
        if (btn) btn.innerHTML = '<i class="fa-solid fa-minus"></i>';

        const parentTr = document.getElementById(rowId);
        if (!parentTr) return;

        const subTr = document.createElement('tr');
        subTr.id = `${rowId}-members`;
        subTr.className = 'member-subrow';
        subTr.innerHTML = `
            <td colspan="14" style="padding: 8px 16px 12px 48px; background: rgba(0,0,0,0.18); border-bottom: 1px solid var(--border-color);">
                <div id="${rowId}-members-container" style="padding: 4px 0;">
                    <i class="fa-solid fa-spinner fa-spin"></i> Loading member breakdown...
                </div>
            </td>
        `;
        parentTr.after(subTr);

        try {
            const params = new URLSearchParams({
                plan_id: pendingPlanningState.plan_id,
                common_name: commonName,
                color: primaryColor,
                size: size
            });
            const res = await fetch(`/api/pending-qty-plan/members?${params.toString()}`);
            const data = await res.json();
            const container = document.getElementById(`${rowId}-members-container`);
            if (!container) return;

            if (!data.success || !data.members || data.members.length === 0) {
                container.innerHTML = `<div style="font-size: 11.5px; color: var(--text-muted);">No member SKUs recorded.</div>`;
                return;
            }

            let mHtml = `
                <div style="font-size: 11.5px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px;">
                    <i class="fa-solid fa-code-fork"></i> Common Production Member SKUs:
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 11.5px; background: var(--bg-card); border-radius: 6px; overflow: hidden; border: 1px solid var(--border-color);">
                    <thead>
                        <tr style="background: rgba(255,255,255,0.03); border-bottom: 1px solid var(--border-color);">
                            <th style="padding: 6px 10px; text-align: left;">Member Style</th>
                            <th style="padding: 6px 10px; text-align: left;">Color</th>
                            <th style="padding: 6px 10px; text-align: left;">Size</th>
                            <th style="padding: 6px 10px; text-align: right;">Req Qty</th>
                            <th style="padding: 6px 10px; text-align: right;">FG</th>
                            <th style="padding: 6px 10px; text-align: right;">WIP</th>
                            <th style="padding: 6px 10px; text-align: right; color: var(--primary-color);">Pending</th>
                            <th style="padding: 6px 10px; text-align: right;">Fab Req (KG)</th>
                            <th style="padding: 6px 10px; text-align: right;">Alloc (KG)</th>
                            <th style="padding: 6px 10px; text-align: right; color: #10b981;">Cuttable</th>
                            <th style="padding: 6px 10px; text-align: right; color: #f59e0b;">Hold</th>
                            <th style="padding: 6px 10px; text-align: center;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            data.members.forEach(m => {
                mHtml += `
                    <tr style="border-bottom: 1px solid var(--border-color);">
                        <td style="padding: 6px 10px; font-weight: 500;">${escapeHtml(m.product_name)}</td>
                        <td style="padding: 6px 10px;">${escapeHtml(m.color)}</td>
                        <td style="padding: 6px 10px;">${escapeHtml(m.size)}</td>
                        <td style="padding: 6px 10px; text-align: right;">${Math.round(m.requirement_qty).toLocaleString()}</td>
                        <td style="padding: 6px 10px; text-align: right;">${Math.round(m.fg_qty).toLocaleString()}</td>
                        <td style="padding: 6px 10px; text-align: right;">${Math.round(m.wip_qty).toLocaleString()}</td>
                        <td style="padding: 6px 10px; text-align: right; font-weight: 600; color: var(--primary-color);">${Math.round(m.net_pending_qty).toLocaleString()}</td>
                        <td style="padding: 6px 10px; text-align: right;">${m.fabric_required_kg.toFixed(2)}</td>
                        <td style="padding: 6px 10px; text-align: right;">${m.allocated_fabric_kg.toFixed(2)}</td>
                        <td style="padding: 6px 10px; text-align: right; font-weight: 600; color: #10b981;">${Math.round(m.cuttable_qty).toLocaleString()}</td>
                        <td style="padding: 6px 10px; text-align: right; color: #f59e0b;">${Math.round(m.hold_qty).toLocaleString()}</td>
                        <td style="padding: 6px 10px; text-align: center;">${renderStatusBadge(m.status)}</td>
                    </tr>
                `;
            });

            mHtml += `</tbody></table>`;
            container.innerHTML = mHtml;
        } catch (err) {
            console.error("Error loading member SKUs:", err);
        }
    }
}

// =============================================================
// TAB 2: CUTTING PLAN (ISOLATED HIERARCHICAL PRESENTATION ENGINE)
// Hierarchy: Fabric -> Color -> Dia -> Mapped Products -> Sub Total
// =============================================================

const cuttingPlanState = {
    allRecords: [],             // Complete dataset from API
    overallTotalPending: 0,     // Invariant denominator for Net Pending %
    overallTotals: {},          // Raw totals from backend
    filters: {                  // Active column filters (columnKey -> Set of selected values)
        fabric: new Set(),
        color: new Set(),
        dia: new Set(),
        product: new Set(),
        type: new Set(),
        status: new Set()
    },
    distinctValues: {           // All distinct options extracted from allRecords
        fabric: [],
        color: [],
        dia: [],
        product: [],
        type: [],
        status: []
    },
    showSubTotals: true,        // Subtotal toggle (default ON)
    collapsedGroups: new Set(), // Set of groupKeys that are collapsed
    page: 1,
    perPage: 50,
    activePopupCol: null
};

// Global click handler to close filter popup when clicking outside
document.addEventListener('click', function (e) {
    const popup = document.getElementById('cutting-plan-filter-popup');
    if (!popup || popup.classList.contains('hidden')) return;
    if (popup.contains(e.target)) return;
    if (e.target.closest('.cutting-col-filter-btn')) return;
    closeCuttingPlanFilterPopup();
});

async function loadCuttingPlanTable(page = 1) {
    cuttingPlanState.page = page;
    const tbody = document.getElementById('cutting-plan-table-body');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="15" style="text-align: center; padding: 40px; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin" style="margin-right: 8px;"></i> Loading complete cutting plan dataset...</td></tr>`;
    }

    try {
        // Fetch complete cutting plan dataset & fabric pool stock in parallel
        const params = new URLSearchParams({
            plan_id: pendingPlanningState.plan_id,
            page: 1,
            per_page: -1
        });

        let allRows = [];
        let totals = {};

        const [cuttingRes, fabRes] = await Promise.all([
            fetch(`/api/pending-qty-plan/cutting-plan?${params.toString()}`).then(r => r.json()).catch(() => ({ success: false })),
            fetch(`/api/pending-qty-plan/fab-required?plan_id=${pendingPlanningState.plan_id}&per_page=-1`).then(r => r.json()).catch(() => ({ success: false }))
        ]);

        if (cuttingRes.success && cuttingRes.rows) {
            allRows = cuttingRes.rows;
            totals = cuttingRes.totals || {};

            // Fallback if per_page=-1 was constrained by backend pagination
            if (cuttingRes.total_count && cuttingRes.total_count > allRows.length) {
                let currentPage = 2;
                const pageSize = 100;
                while (allRows.length < cuttingRes.total_count) {
                    const pageParams = new URLSearchParams({
                        plan_id: pendingPlanningState.plan_id,
                        page: currentPage,
                        per_page: pageSize
                    });
                    const pRes = await fetch(`/api/pending-qty-plan/cutting-plan?${pageParams.toString()}`);
                    const pData = await pRes.json();
                    if (pData.success && pData.rows && pData.rows.length > 0) {
                        allRows = allRows.concat(pData.rows);
                        currentPage++;
                    } else {
                        break;
                    }
                }
            }
        }

        // Build authoritative physical fabric pool available stock map
        const fabricPoolMap = new Map();
        if (fabRes.success && fabRes.rows) {
            fabRes.rows.forEach(p => {
                const fKey = String(p.fabric_name || '').toLowerCase().trim().replace(/[\s_-]+/g, '_');
                const cKey = String(p.fabric_color || p.color || '').toLowerCase().trim().replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ');
                const dNum = parseFloat(String(p.dia || '').replace(/[^0-9.]/g, ''));
                const dKey = (!isNaN(dNum) && dNum > 0) ? dNum.toFixed(1) : '0.0';
                const pKey = `${fKey}|${cKey}|${dKey}`;
                fabricPoolMap.set(pKey, Number(p.available_stock_kg) || 0);
            });
        }
        cuttingPlanState.fabricPoolMap = fabricPoolMap;

        cuttingPlanState.allRecords = allRows;
        cuttingPlanState.overallTotals = totals;

        // Lock the authoritative invariant denominator for Net Pending %
        cuttingPlanState.overallTotalPending = Number(totals.net_pending_qty) || allRows.reduce((sum, r) => sum + (Number(r.net_pending_qty) || 0), 0) || 1;

        // Populate distinct filter options from the COMPLETE dataset
        populateCuttingPlanFilters();

        const subTotalCb = document.getElementById('cutting-show-subtotal-toggle') || document.getElementById('cutting-show-subtotal-cb');
        if (subTotalCb) {
            cuttingPlanState.showSubTotals = subTotalCb.checked;
        }

        // Process filters, build hierarchy, calculate subtotals, and render
        processAndRenderCuttingPlan();

    } catch (err) {
        console.error("Error loading cutting plan table:", err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="15" style="text-align: center; padding: 40px; color: #ef4444;"><i class="fa-solid fa-triangle-exclamation"></i> Error loading cutting plan data.</td></tr>`;
        }
    }
}

function populateCuttingPlanFilters() {
    const fabrics = new Set();
    const colors = new Set();
    const dias = new Set();
    const products = new Set();
    const types = new Set();
    const statuses = new Set();

    cuttingPlanState.allRecords.forEach(r => {
        // Include only records with Net Pending Qty > 0 for filter choices
        if (Number(r.net_pending_qty) > 0) {
            if (r.fabric_name) fabrics.add(r.fabric_name);
            const colorVal = r.fabric_color || r.color;
            if (colorVal) colors.add(colorVal);
            if (r.dia !== undefined && r.dia !== null) {
                const diaStr = (Number(r.dia) > 0) ? (Number(r.dia).toFixed(1) + '"') : String(r.dia);
                dias.add(diaStr);
            }
            if (r.product_name) products.add(r.product_name);
            if (r.item_type) types.add(r.item_type);
            if (r.status) statuses.add(r.status);
        }
    });

    cuttingPlanState.distinctValues.fabric = Array.from(fabrics).sort((a, b) => a.localeCompare(b));
    cuttingPlanState.distinctValues.color = Array.from(colors).sort((a, b) => a.localeCompare(b));
    cuttingPlanState.distinctValues.dia = Array.from(dias).sort((a, b) => parseFloat(a) - parseFloat(b));
    cuttingPlanState.distinctValues.product = Array.from(products).sort((a, b) => a.localeCompare(b));
    cuttingPlanState.distinctValues.type = Array.from(types).sort((a, b) => a.localeCompare(b));
    cuttingPlanState.distinctValues.status = Array.from(statuses).sort((a, b) => a.localeCompare(b));
}

function openCuttingPlanFilter(colKey, event) {
    if (event) event.stopPropagation();
    cuttingPlanState.activePopupCol = colKey;

    const popup = document.getElementById('cutting-plan-filter-popup');
    const titleSpan = document.getElementById('cutting-popup-col-title');
    const searchInput = document.getElementById('cutting-popup-search');
    const btn = event ? event.currentTarget : document.getElementById(`cutting-filter-btn-${colKey}`);

    const colTitles = {
        fabric: 'Fabric Filter',
        color: 'Color Filter',
        dia: 'Dia Filter',
        product: 'Product Filter',
        type: 'Type Filter',
        status: 'Cut Status Filter'
    };

    if (titleSpan) titleSpan.textContent = colTitles[colKey] || 'Filter';
    if (searchInput) searchInput.value = '';

    renderCuttingFilterCheckboxes(colKey, '');

    if (popup && btn) {
        popup.classList.remove('hidden');
        const rect = btn.getBoundingClientRect();
        popup.style.position = 'fixed';
        popup.style.zIndex = '99999';
        popup.style.top = `${rect.bottom + 4}px`;
        let leftPos = rect.left - 100;
        if (leftPos < 10) leftPos = 10;
        if (leftPos + 250 > window.innerWidth) leftPos = window.innerWidth - 260;
        popup.style.left = `${leftPos}px`;
        if (searchInput) setTimeout(() => searchInput.focus(), 50);
    }
}

function closeCuttingPlanFilterPopup() {
    const popup = document.getElementById('cutting-plan-filter-popup');
    if (popup) popup.classList.add('hidden');
    cuttingPlanState.activePopupCol = null;
}
function closeCuttingPlanFilter() {
    closeCuttingPlanFilterPopup();
}

function renderCuttingFilterCheckboxes(colKey, searchFilter) {
    const listContainer = document.getElementById('cutting-popup-checkbox-list');
    if (!listContainer) return;

    const values = cuttingPlanState.distinctValues[colKey] || [];
    const activeSet = cuttingPlanState.filters[colKey] || new Set();
    const term = (searchFilter || '').toLowerCase().trim();

    let html = '';
    let matchCount = 0;

    values.forEach((val, idx) => {
        if (term && !String(val).toLowerCase().includes(term)) return;
        matchCount++;
        const isChecked = (activeSet.size === 0) || activeSet.has(val);
        const itemId = `cutting-chk-${colKey}-${idx}`;
        html += `
            <label class="cutting-filter-checkbox-item" for="${itemId}">
                <input type="checkbox" id="${itemId}" class="cutting-filter-item-cb" value="${escapeHtml(String(val))}" ${isChecked ? 'checked' : ''}>
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(String(val))}</span>
            </label>
        `;
    });

    if (matchCount === 0) {
        html = `<div style="font-size: 11px; color: var(--text-muted); text-align: center; padding: 12px 0;">No matching options</div>`;
    }

    listContainer.innerHTML = html;
}

function onCuttingFilterSearchInput(val) {
    if (!cuttingPlanState.activePopupCol) return;
    renderCuttingFilterCheckboxes(cuttingPlanState.activePopupCol, val);
}
function onCuttingFilterSearch(term) {
    onCuttingFilterSearchInput(term);
}

function cuttingFilterSelectAll(selectAll) {
    const checkboxes = document.querySelectorAll('#cutting-popup-checkbox-list input[type="checkbox"]');
    checkboxes.forEach(chk => { chk.checked = selectAll; });
}
function selectAllCuttingFilter(select) {
    cuttingFilterSelectAll(select);
}

function applyCuttingPlanFilterCurrent() {
    const colKey = cuttingPlanState.activePopupCol;
    if (!colKey) return;

    const checkboxes = document.querySelectorAll('#cutting-popup-checkbox-list input[type="checkbox"]');
    const checkedValues = new Set();
    checkboxes.forEach(chk => {
        if (chk.checked) checkedValues.add(chk.value);
    });

    const totalValues = cuttingPlanState.distinctValues[colKey] || [];

    // If all are checked or none are checked, treat as no active filter on this column
    if (checkedValues.size === totalValues.length || checkedValues.size === 0) {
        cuttingPlanState.filters[colKey].clear();
    } else {
        cuttingPlanState.filters[colKey] = checkedValues;
    }

    updateCuttingFilterButtonState(colKey);
    closeCuttingPlanFilterPopup();
    cuttingPlanState.page = 1;
    processAndRenderCuttingPlan();
}
function applyCuttingPlanFilter() {
    applyCuttingPlanFilterCurrent();
}

function clearCuttingPlanFilterCurrent() {
    const colKey = cuttingPlanState.activePopupCol;
    if (!colKey) return;

    cuttingPlanState.filters[colKey].clear();
    updateCuttingFilterButtonState(colKey);
    closeCuttingPlanFilterPopup();
    cuttingPlanState.page = 1;
    processAndRenderCuttingPlan();
}
function clearSingleCuttingFilter() {
    clearCuttingPlanFilterCurrent();
}

function clearAllCuttingPlanHeaderFilters() {
    Object.keys(cuttingPlanState.filters).forEach(k => {
        cuttingPlanState.filters[k].clear();
        updateCuttingFilterButtonState(k);
    });
    closeCuttingPlanFilterPopup();
    cuttingPlanState.page = 1;
    processAndRenderCuttingPlan();
}
function clearAllCuttingPlanFilters() {
    clearAllCuttingPlanHeaderFilters();
}

function updateCuttingFilterButtonState(colKey) {
    const btn = document.getElementById(`cutting-filter-btn-${colKey}`);
    if (!btn) return;
    const isFiltered = cuttingPlanState.filters[colKey] && cuttingPlanState.filters[colKey].size > 0;
    if (isFiltered) {
        btn.classList.add('active');
        btn.innerHTML = `<i class="fa-solid fa-filter-circle-xmark"></i>`;
    } else {
        btn.classList.remove('active');
        btn.innerHTML = `<i class="fa-solid fa-filter"></i>`;
    }

    let anyActive = false;
    Object.keys(cuttingPlanState.filters).forEach(k => {
        if (cuttingPlanState.filters[k].size > 0) anyActive = true;
    });

    const clearAllBtn = document.getElementById('cutting-clear-all-filters-btn');
    if (clearAllBtn) {
        if (anyActive) clearAllBtn.classList.remove('hidden');
        else clearAllBtn.classList.add('hidden');
    }
}
function updateFilterBtnVisualState(colKey) {
    updateCuttingFilterButtonState(colKey);
}

function toggleCuttingPlanSubtotals(checked) {
    if (checked !== undefined) {
        cuttingPlanState.showSubTotals = !!checked;
    } else {
        const cb = document.getElementById('cutting-show-subtotal-toggle') || document.getElementById('cutting-show-subtotal-cb');
        if (cb) cuttingPlanState.showSubTotals = cb.checked;
    }
    processAndRenderCuttingPlan();
}
function toggleCuttingSubTotals(checked) {
    toggleCuttingPlanSubtotals(checked);
}

function expandAllCuttingPlanGroups() {
    cuttingPlanState.collapsedGroups.clear();
    processAndRenderCuttingPlan();
}

function collapseAllCuttingPlanGroups() {
    cuttingPlanState.collapsedGroups.clear();
    cuttingPlanState.allRecords.forEach(r => {
        const fab = r.fabric_name || 'Unknown Fabric';
        const color = r.fabric_color || r.color || 'Unknown Color';
        const diaStr = (Number(r.dia) > 0) ? (Number(r.dia).toFixed(1) + '"') : String(r.dia || '-');
        cuttingPlanState.collapsedGroups.add(`fabric:${fab}`);
        cuttingPlanState.collapsedGroups.add(`color:${fab}|${color}`);
        cuttingPlanState.collapsedGroups.add(`dia:${fab}|${color}|${diaStr}`);
    });
    processAndRenderCuttingPlan();
}

function toggleCuttingPlanGroup(groupKey) {
    if (cuttingPlanState.collapsedGroups.has(groupKey)) {
        cuttingPlanState.collapsedGroups.delete(groupKey);
    } else {
        cuttingPlanState.collapsedGroups.add(groupKey);
    }
    processAndRenderCuttingPlan();
}

// -------------------------------------------------------------
// HIERARCHICAL PROCESSING & RENDERING PIPELINE (15 COLUMNS)
// -------------------------------------------------------------
function processAndRenderCuttingPlan() {
    const tbody = document.getElementById('cutting-plan-table-body');
    if (!tbody) return;

    if (!cuttingPlanState.allRecords || cuttingPlanState.allRecords.length === 0) {
        tbody.innerHTML = `<tr><td colspan="15" style="text-align: center; padding: 40px; color: var(--text-muted);">No cutting plan data available.</td></tr>`;
        updateCuttingPlanFootTotals([]);
        renderCuttingPlanPaginationUI(0, 1, cuttingPlanState.perPage);
        return;
    }

    // STEP 1: Filter records
    const filteredRecords = cuttingPlanState.allRecords.filter(r => {
        // Strict exclusion rule: Net Pending Qty > 0
        if (Number(r.net_pending_qty) <= 0) return false;

        const fab = r.fabric_name || 'Unknown Fabric';
        const col = r.fabric_color || r.color || 'Unknown Color';
        const diaStr = (Number(r.dia) > 0) ? (Number(r.dia).toFixed(1) + '"') : String(r.dia || '-');
        const prod = r.product_name || '';
        const type = r.item_type || '';
        const stat = r.status || '';

        // Multi-column AND logic
        if (cuttingPlanState.filters.fabric.size > 0 && !cuttingPlanState.filters.fabric.has(fab)) return false;
        if (cuttingPlanState.filters.color.size > 0 && !cuttingPlanState.filters.color.has(col)) return false;
        if (cuttingPlanState.filters.dia.size > 0 && !cuttingPlanState.filters.dia.has(diaStr)) return false;
        if (cuttingPlanState.filters.product.size > 0 && !cuttingPlanState.filters.product.has(prod)) return false;
        if (cuttingPlanState.filters.type.size > 0 && !cuttingPlanState.filters.type.has(type)) return false;
        if (cuttingPlanState.filters.status.size > 0 && !cuttingPlanState.filters.status.has(stat)) return false;

        return true;
    });

    if (filteredRecords.length === 0) {
        tbody.innerHTML = `<tr><td colspan="15" style="text-align: center; padding: 40px; color: var(--text-muted);"><i class="fa-solid fa-filter-circle-xmark" style="margin-right: 6px;"></i> No cutting plan rows match the active filters.</td></tr>`;
        renderCuttingPlanPaginationUI(0, cuttingPlanState.page, cuttingPlanState.perPage);
        updateCuttingPlanFootTotals([]);
        return;
    }

    // STEP 2: Build 4-Level Grouping Hierarchy (Fabric -> Color -> Dia -> Products)
    const hierarchy = new Map(); // fabric -> Map(color -> Map(dia -> { products: [], available_stock_kg: 0 }))

    filteredRecords.forEach(r => {
        const fab = r.fabric_name || 'Unknown Fabric';
        const col = r.fabric_color || r.color || 'Unknown Color';
        const diaStr = (Number(r.dia) > 0) ? (Number(r.dia).toFixed(1) + '"') : String(r.dia || '-');

        if (!hierarchy.has(fab)) hierarchy.set(fab, new Map());
        const colorMap = hierarchy.get(fab);

        if (!colorMap.has(col)) colorMap.set(col, new Map());
        const diaMap = colorMap.get(col);

        // Authoritative resolution of Fabric Stock Available KG for physical pool
        const fKey = String(fab || '').toLowerCase().trim().replace(/[\s_-]+/g, '_');
        const cKey = String(col || '').toLowerCase().trim().replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ');
        const dNum = parseFloat(String(r.dia || '').replace(/[^0-9.]/g, ''));
        const dKey = (!isNaN(dNum) && dNum > 0) ? dNum.toFixed(1) : '0.0';
        const poolKey = `${fKey}|${cKey}|${dKey}`;

        let poolStock = 0;
        if (cuttingPlanState.fabricPoolMap && cuttingPlanState.fabricPoolMap.has(poolKey)) {
            poolStock = cuttingPlanState.fabricPoolMap.get(poolKey);
        } else if (Number(r.available_stock_kg) > 0) {
            poolStock = Number(r.available_stock_kg);
        }

        if (!diaMap.has(diaStr)) {
            diaMap.set(diaStr, {
                products: [],
                available_stock_kg: poolStock
            });
        }

        const diaGroup = diaMap.get(diaStr);
        diaGroup.products.push(r);
        if (diaGroup.available_stock_kg === 0 && poolStock > 0) {
            diaGroup.available_stock_kg = poolStock;
        }
    });

    // STEP 3: Flatten into Display Rows structure (with Expand/Collapse and Subtotals)
    const displayRows = [];

    // Sort fabrics alphabetically
    const sortedFabrics = Array.from(hierarchy.keys()).sort((a, b) => a.localeCompare(b));

    sortedFabrics.forEach(fab => {
        const colorMap = hierarchy.get(fab);
        const fabKey = `fabric:${fab}`;
        const isFabCollapsed = cuttingPlanState.collapsedGroups.has(fabKey);

        // Count total products in this fabric
        let fabProductCount = 0;
        colorMap.forEach(dMap => {
            dMap.forEach(dGroup => {
                fabProductCount += dGroup.products.length;
            });
        });

        // Level 1: Fabric Header Row
        displayRows.push({
            rowType: 'group-fabric',
            key: fabKey,
            title: fab,
            count: fabProductCount,
            isCollapsed: isFabCollapsed
        });

        if (isFabCollapsed) return;

        // Sort colors alphabetically
        const sortedColors = Array.from(colorMap.keys()).sort((a, b) => a.localeCompare(b));

        sortedColors.forEach(col => {
            const diaMap = colorMap.get(col);
            const colorKey = `color:${fab}|${col}`;
            const isColorCollapsed = cuttingPlanState.collapsedGroups.has(colorKey);

            let colorProductCount = 0;
            diaMap.forEach(dGroup => {
                colorProductCount += dGroup.products.length;
            });

            // Level 2: Color Header Row
            displayRows.push({
                rowType: 'group-color',
                key: colorKey,
                fabric: fab,
                title: col,
                count: colorProductCount,
                isCollapsed: isColorCollapsed
            });

            if (isColorCollapsed) return;

            // Sort dias numerically/alphabetically
            const sortedDias = Array.from(diaMap.keys()).sort((a, b) => parseFloat(a) - parseFloat(b));

            sortedDias.forEach(diaStr => {
                const diaGroup = diaMap.get(diaStr);
                const diaKey = `dia:${fab}|${col}|${diaStr}`;
                const isDiaCollapsed = cuttingPlanState.collapsedGroups.has(diaKey);

                // Level 3: Dia Header Row
                displayRows.push({
                    rowType: 'group-dia',
                    key: diaKey,
                    fabric: fab,
                    color: col,
                    title: diaStr,
                    count: diaGroup.products.length,
                    isCollapsed: isDiaCollapsed
                });

                if (isDiaCollapsed) return;

                // Sort products by priority ASC, net_pending_qty DESC
                const sortedProducts = diaGroup.products.slice().sort((a, b) => {
                    const pA = a.priority !== undefined ? a.priority : 999;
                    const pB = b.priority !== undefined ? b.priority : 999;
                    if (pA !== pB) return pA - pB;
                    return (b.net_pending_qty || 0) - (a.net_pending_qty || 0);
                });

                // Level 4: Mapped Product Rows (15 Columns, Available KG = Actual Physical Pool Stock)
                let groupPending = 0;
                let groupReqQty = 0;
                let groupFabReq = 0;
                let groupCuttable = 0;
                let groupHold = 0;
                let groupShortage = 0;

                sortedProducts.forEach(prod => {
                    groupPending += Number(prod.net_pending_qty) || 0;
                    groupReqQty += Number(prod.requirement_qty !== undefined && prod.requirement_qty !== null ? prod.requirement_qty : prod.net_pending_qty) || 0;
                    groupFabReq += Number(prod.fabric_required_kg) || 0;
                    groupCuttable += Number(prod.cuttable_qty) || 0;
                    groupHold += Number(prod.hold_qty) || 0;
                    groupShortage += Number(prod.shortage_kg) || 0;

                    displayRows.push({
                        rowType: 'product',
                        fabric: fab,
                        color: col,
                        dia: diaStr,
                        data: prod,
                        available_stock_kg: diaGroup.available_stock_kg !== undefined ? diaGroup.available_stock_kg : (Number(prod.available_stock_kg) || 0)
                    });
                });

                // Level 5: Sub Total Row (15 Columns, Available KG = Actual Physical Pool Stock ONCE)
                if (cuttingPlanState.showSubTotals) {
                    displayRows.push({
                        rowType: 'subtotal',
                        fabric: fab,
                        color: col,
                        dia: diaStr,
                        net_pending_qty: groupPending,
                        balance_req_qty: groupReqQty,
                        fabric_required_kg: groupFabReq,
                        available_stock_kg: diaGroup.available_stock_kg, // Actual physical pool stock ONCE
                        cuttable_qty: groupCuttable,
                        hold_qty: groupHold,
                        shortage_kg: groupShortage
                    });
                }
            });
        });
    });

    // STEP 4: Paginate Display Rows
    const totalDisplayRows = displayRows.length;
    const perPage = cuttingPlanState.perPage;
    const totalPages = Math.ceil(totalDisplayRows / perPage) || 1;
    if (cuttingPlanState.page > totalPages) cuttingPlanState.page = totalPages;
    if (cuttingPlanState.page < 1) cuttingPlanState.page = 1;

    const startIndex = (cuttingPlanState.page - 1) * perPage;
    const endIndex = Math.min(startIndex + perPage, totalDisplayRows);
    const visibleRows = displayRows.slice(startIndex, endIndex);

    // STEP 5: Render Visible Rows (15 Columns Table)
    let html = '';
    const overallPendingDenominator = cuttingPlanState.overallTotalPending || 1;

    visibleRows.forEach(item => {
        if (item.rowType === 'group-fabric') {
            html += `
                <tr class="cutting-group-fabric-row" style="border-bottom: 1px solid var(--border-color);">
                    <td colspan="15" style="padding: 9px 14px;">
                        <button class="cutting-group-toggle-btn" onclick="toggleCuttingPlanGroup('${escapeHtml(item.key)}')" title="Toggle Fabric Group">
                            <i class="fa-solid ${item.isCollapsed ? 'fa-chevron-right' : 'fa-chevron-down'}"></i>
                        </button>
                        <span style="font-size: 13px; font-weight: 700; color: #60a5fa; letter-spacing: 0.3px;">
                            <i class="fa-solid fa-layer-group" style="margin-right: 6px;"></i> FABRIC: ${escapeHtml(item.title)}
                        </span>
                        <span class="badge" style="background: rgba(59, 130, 246, 0.25); color: #93c5fd; font-size: 11px; margin-left: 10px; padding: 2px 8px; border-radius: 10px;">
                            ${item.count} items
                        </span>
                    </td>
                </tr>
            `;
        } else if (item.rowType === 'group-color') {
            html += `
                <tr class="cutting-group-color-row" style="border-bottom: 1px solid var(--border-color);">
                    <td colspan="15" style="padding: 7px 14px 7px 28px;">
                        <button class="cutting-group-toggle-btn" onclick="toggleCuttingPlanGroup('${escapeHtml(item.key)}')" title="Toggle Color Group">
                            <i class="fa-solid ${item.isCollapsed ? 'fa-chevron-right' : 'fa-chevron-down'}"></i>
                        </button>
                        <span style="font-size: 12.5px; font-weight: 600; color: #c084fc;">
                            <i class="fa-solid fa-palette" style="margin-right: 6px;"></i> COLOR: ${escapeHtml(item.title)}
                        </span>
                        <span class="badge" style="background: rgba(139, 92, 246, 0.2); color: #d8b4fe; font-size: 10.5px; margin-left: 8px; padding: 1px 7px; border-radius: 10px;">
                            ${item.count} items
                        </span>
                    </td>
                </tr>
            `;
        } else if (item.rowType === 'group-dia') {
            html += `
                <tr class="cutting-group-dia-row" style="border-bottom: 1px solid var(--border-color);">
                    <td colspan="15" style="padding: 6px 14px 6px 48px;">
                        <button class="cutting-group-toggle-btn" onclick="toggleCuttingPlanGroup('${escapeHtml(item.key)}')" title="Toggle Dia Group">
                            <i class="fa-solid ${item.isCollapsed ? 'fa-chevron-right' : 'fa-chevron-down'}"></i>
                        </button>
                        <span style="font-size: 12px; font-weight: 600; color: #34d399;">
                            <i class="fa-solid fa-circle-dot" style="margin-right: 6px;"></i> DIA: ${escapeHtml(item.title)}
                        </span>
                        <span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #6ee7b7; font-size: 10px; margin-left: 8px; padding: 1px 6px; border-radius: 10px;">
                            ${item.count} items
                        </span>
                    </td>
                </tr>
            `;
        } else if (item.rowType === 'product') {
            const r = item.data;
            const isCommon = (r.item_type === 'Common');
            const skuTitle = `${r.product_name} (${r.color || item.color} - ${r.size || '-'})`;
            const netPending = Number(r.net_pending_qty) || 0;
            const netPendingPct = ((netPending / overallPendingDenominator) * 100).toFixed(2);
            const balanceReq = Number(r.requirement_qty !== undefined && r.requirement_qty !== null ? r.requirement_qty : r.net_pending_qty) || 0;
            const availStock = item.available_stock_kg !== undefined ? item.available_stock_kg : (Number(r.available_stock_kg) || 0);

            html += `
                <tr style="border-bottom: 1px solid var(--border-color); ${isCommon ? 'background: rgba(59, 130, 246, 0.02);' : ''}">
                    <td style="color: var(--text-secondary); font-size: 11.5px; padding-left: 12px;">${escapeHtml(item.fabric)}</td>
                    <td style="color: var(--text-secondary); font-size: 11.5px;">${escapeHtml(item.color)}</td>
                    <td style="text-align: center; color: var(--text-secondary); font-size: 11.5px;"><span class="badge" style="background: rgba(255,255,255,0.06);">${escapeHtml(item.dia)}</span></td>
                    <td style="font-weight: 600; color: ${isCommon ? 'var(--accent-blue)' : 'var(--text-primary)'};">
                        ${isCommon ? `<i class="fa-solid fa-code-fork" style="font-size: 10px; color: #8b5cf6; margin-right: 4px;" title="Common Production"></i>` : ''}
                        ${escapeHtml(r.product_name)}
                    </td>
                    <td style="text-align: center;">
                        <span class="badge" style="background: ${isCommon ? '#8b5cf6' : '#6b7280'}; color: #fff; font-size: 10px; padding: 2px 6px;">${r.item_type}</span>
                    </td>
                    <td style="text-align: right; font-weight: 700; color: var(--primary-color); font-size: 12.5px;">${Math.round(netPending).toLocaleString()}</td>
                    <td style="text-align: right; font-weight: 600; color: var(--text-secondary);">${netPendingPct}%</td>
                    <td style="text-align: right; font-weight: 600;">${Math.round(balanceReq).toLocaleString()}</td>
                    <td style="text-align: right;">${(Number(r.fabric_required_kg) || 0).toFixed(2)}</td>
                    <td style="text-align: right; font-weight: 600; color: ${availStock > 0 ? '#10b981' : 'var(--text-muted)'};">${availStock > 0 ? availStock.toFixed(2) : '-'}</td>
                    <td style="text-align: right; font-weight: 700; color: #10b981;">${Math.round(Number(r.cuttable_qty) || 0).toLocaleString()}</td>
                    <td style="text-align: right; font-weight: 600; color: #f59e0b;">${Math.round(Number(r.hold_qty) || 0).toLocaleString()}</td>
                    <td style="text-align: right; font-weight: 600; color: #ef4444;">${(Number(r.shortage_kg) || 0).toFixed(2)}</td>
                    <td style="text-align: center;">${renderStatusBadge(r.status)}</td>
                    <td style="text-align: center;">
                        <button class="btn btn-sm btn-outline" onclick="openPendingPriorityModal(${r.id}, '${escapeHtml(skuTitle)}', ${r.priority})" title="Set manual priority" style="padding: 2px 7px; font-size: 11px;">
                            ${r.priority || 999} <i class="fa-solid fa-arrow-up-1-9" style="font-size: 9px; opacity: 0.7; margin-left: 2px;"></i>
                        </button>
                    </td>
                </tr>
            `;
        } else if (item.rowType === 'subtotal') {
            const subPending = item.net_pending_qty || 0;
            const subPendingPct = ((subPending / overallPendingDenominator) * 100).toFixed(2);
            const availStock = item.available_stock_kg || 0;

            html += `
                <tr class="cutting-subtotal-row">
                    <td style="color: var(--text-secondary); font-size: 11px; padding-left: 12px;">${escapeHtml(item.fabric)}</td>
                    <td style="color: var(--text-secondary); font-size: 11px;">${escapeHtml(item.color)}</td>
                    <td style="text-align: center; color: var(--text-secondary); font-size: 11px;">${escapeHtml(item.dia)}</td>
                    <td style="font-weight: 800; color: #60a5fa; letter-spacing: 0.3px;">
                        <i class="fa-solid fa-calculator" style="margin-right: 4px;"></i> SUB TOTAL
                    </td>
                    <td style="text-align: center; color: var(--text-muted);">-</td>
                    <td style="text-align: right; font-weight: 800; color: var(--primary-color); font-size: 13px;">${Math.round(subPending).toLocaleString()}</td>
                    <td style="text-align: right; font-weight: 700; color: #60a5fa;">${subPendingPct}%</td>
                    <td style="text-align: right; font-weight: 700;">${Math.round(item.balance_req_qty || 0).toLocaleString()}</td>
                    <td style="text-align: right; font-weight: 700;">${(item.fabric_required_kg || 0).toFixed(2)}</td>
                    <td style="text-align: right; font-weight: 800; color: #10b981; font-size: 12.5px;">${availStock > 0 ? availStock.toFixed(2) : '-'}</td>
                    <td style="text-align: right; font-weight: 800; color: #10b981; font-size: 13px;">${Math.round(item.cuttable_qty || 0).toLocaleString()}</td>
                    <td style="text-align: right; font-weight: 700; color: #f59e0b;">${Math.round(item.hold_qty || 0).toLocaleString()}</td>
                    <td style="text-align: right; font-weight: 700; color: #ef4444;">${(item.shortage_kg || 0).toFixed(2)}</td>
                    <td style="text-align: center; color: var(--text-muted);">-</td>
                    <td style="text-align: center; color: var(--text-muted);">-</td>
                </tr>
            `;
        }
    });

    tbody.innerHTML = html;

    // STEP 6: Update Overall Foot Totals (15 Columns)
    updateCuttingPlanFootTotals(filteredRecords);

    // STEP 7: Render Pagination UI
    renderCuttingPlanPaginationUI(totalDisplayRows, cuttingPlanState.page, perPage);
}

function updateCuttingPlanFootTotals(filteredRecords) {
    let totPending = 0;
    let totReq = 0;
    let totFabReq = 0;
    let totCuttable = 0;
    let totHold = 0;
    let totShortage = 0;

    filteredRecords.forEach(r => {
        totPending += Number(r.net_pending_qty) || 0;
        totReq += Number(r.requirement_qty !== undefined && r.requirement_qty !== null ? r.requirement_qty : r.net_pending_qty) || 0;
        totFabReq += Number(r.fabric_required_kg) || 0;
        totCuttable += Number(r.cuttable_qty) || 0;
        totHold += Number(r.hold_qty) || 0;
        totShortage += Number(r.shortage_kg) || 0;
    });

    const pendingPct = ((totPending / (cuttingPlanState.overallTotalPending || 1)) * 100).toFixed(2) + '%';

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    setVal('foot-cutting-pending', Math.round(totPending).toLocaleString());
    setVal('foot-cutting-pending-pct', pendingPct);
    setVal('foot-cutting-balance-req', Math.round(totReq).toLocaleString());
    setVal('foot-cutting-fab-req', totFabReq.toFixed(2));
    setVal('foot-cutting-avail', '-');
    setVal('foot-cutting-cuttable', Math.round(totCuttable).toLocaleString());
    setVal('foot-cutting-hold', Math.round(totHold).toLocaleString());
    setVal('foot-cutting-shortage', totShortage.toFixed(2));
}

function renderCuttingPlanPaginationUI(totalRows, currentPage, perPage) {
    const container = document.getElementById('cutting-plan-pagination');
    if (!container) return;

    if (totalRows === 0) {
        container.innerHTML = `<div style="color: var(--text-muted);">Showing 0 items</div>`;
        return;
    }

    const totalPages = Math.ceil(totalRows / perPage) || 1;
    const startItem = (currentPage - 1) * perPage + 1;
    const endItem = Math.min(currentPage * perPage, totalRows);

    container.innerHTML = `
        <div style="display: flex; align-items: center; gap: 14px; color: var(--text-secondary);">
            <span>Showing <strong>${startItem}</strong> to <strong>${endItem}</strong> of <strong>${totalRows.toLocaleString()}</strong> items</span>
            <div style="display: flex; align-items: center; gap: 6px;">
                <span>Rows per page:</span>
                <select onchange="changeCuttingPlanPerPage(Number(this.value))" class="form-select" style="padding: 2px 6px; height: 26px; font-size: 11.5px; width: 70px;">
                    <option value="25" ${perPage === 25 ? 'selected' : ''}>25</option>
                    <option value="50" ${perPage === 50 ? 'selected' : ''}>50</option>
                    <option value="100" ${perPage === 100 ? 'selected' : ''}>100</option>
                    <option value="200" ${perPage === 200 ? 'selected' : ''}>200</option>
                    <option value="10000" ${perPage >= 10000 ? 'selected' : ''}>All</option>
                </select>
            </div>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
            <button class="btn btn-sm btn-outline" onclick="changeCuttingPlanPage(1)" ${currentPage <= 1 ? 'disabled' : ''} style="padding: 2px 8px; font-size: 11px;">
                <i class="fa-solid fa-angles-left"></i>
            </button>
            <button class="btn btn-sm btn-outline" onclick="changeCuttingPlanPage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''} style="padding: 2px 8px; font-size: 11px;">
                <i class="fa-solid fa-chevron-left"></i>
            </button>
            <span style="padding: 0 8px; font-weight: 600; color: var(--text-primary);">Page ${currentPage} of ${totalPages}</span>
            <button class="btn btn-sm btn-outline" onclick="changeCuttingPlanPage(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''} style="padding: 2px 8px; font-size: 11px;">
                <i class="fa-solid fa-chevron-right"></i>
            </button>
            <button class="btn btn-sm btn-outline" onclick="changeCuttingPlanPage(${totalPages})" ${currentPage >= totalPages ? 'disabled' : ''} style="padding: 2px 8px; font-size: 11px;">
                <i class="fa-solid fa-angles-right"></i>
            </button>
        </div>
    `;
}

function changeCuttingPlanPage(newPage) {
    cuttingPlanState.page = newPage;
    processAndRenderCuttingPlan();
}

function changeCuttingPlanPerPage(newPerPage) {
    cuttingPlanState.perPage = newPerPage;
    cuttingPlanState.page = 1;
    processAndRenderCuttingPlan();
}

// -------------------------------------------------------------
// TAB 3: FAB REQUIRED (FABRIC POOL VIEW) - EXCEL-STYLE IN-MEMORY FILTERING
// -------------------------------------------------------------

const fabRequiredState = {
    dataLoaded: false,
    allRecords: [],
    lastLoadedPlanId: null,
    filters: {
        fabric_name: new Set(),
        fabric_color: new Set(),
        dia: null,
        gsm: null,
        consuming_products_count: null,
        available_stock_kg: null,
        required_fabric_kg: null,
        allocated_fabric_kg: null,
        remaining_fabric_kg: null,
        shortage_kg: null,
        coverage_pct: null,
        status: new Set()
    },
    distinctValues: {
        fabric_name: [],
        fabric_color: [],
        status: []
    },
    activePopupCol: null,
    page: 1,
    per_page: 50
};

// Global click handler to close fab required filter popup when clicking outside
document.addEventListener('click', function (e) {
    const popup = document.getElementById('fab-required-filter-popup');
    if (!popup || popup.classList.contains('hidden')) return;
    if (popup.contains(e.target)) return;
    if (e.target.closest('.pending-col-filter-btn') || e.target.closest('.fab-required-col-filter-btn')) return;
    closeFabRequiredFilterPopup();
});

const isFabRequiredNumericCol = (colKey) => [
    'dia', 'gsm', 'consuming_products_count', 'available_stock_kg',
    'required_fabric_kg', 'allocated_fabric_kg', 'remaining_fabric_kg',
    'shortage_kg', 'coverage_pct'
].includes(colKey);

function populateFabRequiredDistinctValues() {
    const fabrics = new Set();
    const colors = new Set();
    const statuses = new Set();

    (fabRequiredState.allRecords || []).forEach(r => {
        if (r.fabric_name !== undefined && r.fabric_name !== null && String(r.fabric_name).trim() !== '') {
            fabrics.add(String(r.fabric_name));
        }
        if (r.fabric_color !== undefined && r.fabric_color !== null && String(r.fabric_color).trim() !== '') {
            colors.add(String(r.fabric_color));
        }
        if (r.status !== undefined && r.status !== null && String(r.status).trim() !== '') {
            statuses.add(String(r.status));
        }
    });

    fabRequiredState.distinctValues.fabric_name = Array.from(fabrics).sort((a, b) => a.localeCompare(b));
    fabRequiredState.distinctValues.fabric_color = Array.from(colors).sort((a, b) => a.localeCompare(b));
    fabRequiredState.distinctValues.status = Array.from(statuses).sort((a, b) => a.localeCompare(b));
}

function filterFabRequiredRecords() {
    return (fabRequiredState.allRecords || []).filter(r => {
        // Categorical filters
        const cats = ['fabric_name', 'fabric_color', 'status'];
        for (const col of cats) {
            const activeSet = fabRequiredState.filters[col];
            if (activeSet && activeSet.size > 0) {
                const rawVal = r[col];
                const val = (rawVal !== undefined && rawVal !== null) ? String(rawVal) : '';
                if (!activeSet.has(val)) return false;
            }
        }

        // Numeric filters
        const nums = [
            'dia', 'gsm', 'consuming_products_count', 'available_stock_kg',
            'required_fabric_kg', 'allocated_fabric_kg', 'remaining_fabric_kg',
            'shortage_kg', 'coverage_pct'
        ];
        for (const col of nums) {
            const numFilter = fabRequiredState.filters[col];
            if (numFilter && numFilter.operator) {
                const rawVal = r[col];
                if (rawVal === undefined || rawVal === null || rawVal === '') return false;
                const val = Number(rawVal);
                if (isNaN(val)) return false;

                const v1 = (numFilter.val1 !== null && numFilter.val1 !== undefined && numFilter.val1 !== '') ? Number(numFilter.val1) : null;
                const v2 = (numFilter.val2 !== null && numFilter.val2 !== undefined && numFilter.val2 !== '') ? Number(numFilter.val2) : null;

                if (!evalFabRequiredNumericPredicate(val, numFilter.operator, v1, v2)) {
                    return false;
                }
            }
        }

        return true;
    });
}

function evalFabRequiredNumericPredicate(val, op, v1, v2) {
    if (v1 === null || isNaN(v1)) return true;
    switch (op) {
        case 'eq': return val === v1;
        case 'neq': return val !== v1;
        case 'gt': return val > v1;
        case 'gte': return val >= v1;
        case 'lt': return val < v1;
        case 'lte': return val <= v1;
        case 'between': return (v2 !== null && !isNaN(v2)) ? (val >= v1 && val <= v2) : (val >= v1);
        default: return true;
    }
}

async function loadFabRequiredTable(page = 1) {
    fabRequiredState.page = page;

    if (!fabRequiredState.dataLoaded || fabRequiredState.lastLoadedPlanId !== pendingPlanningState.plan_id) {
        if (!pendingPlanningState.plan_id) {
            renderFabRequiredEmpty("No fabric pool data available. Please select a plan and click <strong>Recalculate & Refresh</strong>.");
            return;
        }

        const tbody = document.getElementById('fab-required-table-body');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="14" style="text-align: center; padding: 40px; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin" style="margin-right: 8px;"></i> Loading fabric pool dataset...</td></tr>`;
        }

        try {
            const params = new URLSearchParams({
                plan_id: pendingPlanningState.plan_id,
                page: 1,
                per_page: -1
            });
            const res = await fetch(`/api/pending-qty-plan/fab-required?${params.toString()}`);
            const data = await res.json();
            if (data.success && data.rows) {
                fabRequiredState.allRecords = data.rows;
            } else {
                fabRequiredState.allRecords = [];
            }
            fabRequiredState.dataLoaded = true;
            fabRequiredState.lastLoadedPlanId = pendingPlanningState.plan_id;
            populateFabRequiredDistinctValues();
        } catch (err) {
            console.error("Error fetching complete fab required dataset:", err);
            fabRequiredState.allRecords = [];
            fabRequiredState.dataLoaded = true;
        }
    }

    renderFilteredFabRequiredTable();
}

function renderFilteredFabRequiredTable() {
    const tbody = document.getElementById('fab-required-table-body');
    if (!tbody) return;

    const filteredRecords = filterFabRequiredRecords();
    const totalCount = filteredRecords.length;

    // Dynamic totals calculation across filtered rows
    let totAvail = 0, totReq = 0, totAlloc = 0, totShortage = 0;
    filteredRecords.forEach(r => {
        totAvail += Number(r.available_stock_kg) || 0;
        totReq += Number(r.required_fabric_kg) || 0;
        totAlloc += Number(r.allocated_fabric_kg) || 0;
        totShortage += Number(r.shortage_kg) || 0;
    });

    const footAvail = document.getElementById('foot-fabric-avail');
    if (footAvail) footAvail.textContent = totAvail.toFixed(2);
    const footReq = document.getElementById('foot-fabric-req');
    if (footReq) footReq.textContent = totReq.toFixed(2);
    const footAlloc = document.getElementById('foot-fabric-alloc');
    if (footAlloc) footAlloc.textContent = totAlloc.toFixed(2);
    const footShortage = document.getElementById('foot-fabric-shortage');
    if (footShortage) footShortage.textContent = totShortage.toFixed(2);

    if (totalCount === 0) {
        tbody.innerHTML = `<tr><td colspan="14" style="text-align: center; padding: 40px; color: var(--text-muted);"><i class="fa-solid fa-filter-circle-xmark" style="margin-right: 6px;"></i> No fabric pools match the active filter criteria.</td></tr>`;
        renderFabRequiredPaginationUI(0, fabRequiredState.page, fabRequiredState.per_page);
        return;
    }

    const startIdx = (fabRequiredState.page - 1) * fabRequiredState.per_page;
    const pageRows = filteredRecords.slice(startIdx, startIdx + fabRequiredState.per_page);

    let html = '';
    pageRows.forEach(r => {
        const poolKey = `${r.fabric_name}_${r.fabric_color}_${r.dia}_${r.gsm}`.replace(/[^a-zA-Z0-9_-]/g, '_');
        const isExpanded = pendingPlanningState.expandedPools.has(poolKey);

        const diaDisplay = (r.dia !== undefined && r.dia !== null && !isNaN(Number(r.dia))) ? Number(r.dia).toFixed(1) : '-';
        const gsmDisplay = (r.gsm !== undefined && r.gsm !== null) ? r.gsm : '-';
        const availDisplay = (r.available_stock_kg !== undefined && r.available_stock_kg !== null) ? Number(r.available_stock_kg).toFixed(2) : '0.00';
        const reqDisplay = (r.required_fabric_kg !== undefined && r.required_fabric_kg !== null) ? Number(r.required_fabric_kg).toFixed(2) : '0.00';
        const allocDisplay = (r.allocated_fabric_kg !== undefined && r.allocated_fabric_kg !== null) ? Number(r.allocated_fabric_kg).toFixed(2) : '0.00';
        const remDisplay = (r.remaining_fabric_kg !== undefined && r.remaining_fabric_kg !== null) ? Number(r.remaining_fabric_kg).toFixed(2) : '0.00';
        const shortageDisplay = (r.shortage_kg !== undefined && r.shortage_kg !== null) ? Number(r.shortage_kg).toFixed(2) : '0.00';
        const coveragePct = Number(r.coverage_pct) || 0;

        html += `
            <tr id="pool-row-${poolKey}" style="border-bottom: 1px solid var(--border-color);">
                <td style="text-align: center;">
                    <button class="btn btn-sm" onclick="toggleFabricPoolConsumers('${poolKey}', '${escapeHtml(r.fabric_name)}', '${escapeHtml(r.fabric_color)}', ${r.dia}, ${r.gsm}, this)" style="padding: 2px 6px; font-size: 11px;">
                        <i class="fa-solid ${isExpanded ? 'fa-minus' : 'fa-plus'}"></i>
                    </button>
                </td>
                <td style="font-weight: 600;">${escapeHtml(r.fabric_name || '')}</td>
                <td>${escapeHtml(r.fabric_color || '')}</td>
                <td style="text-align: center;"><span class="badge" style="background: rgba(255,255,255,0.08);">${diaDisplay}</span></td>
                <td style="text-align: center;">${gsmDisplay}</td>
                <td style="text-align: center;"><span class="badge" style="background: #3b82f6; color: #fff; font-size: 11px; padding: 2px 7px;">${r.consuming_products_count || 0} styles</span></td>
                <td style="text-align: right; font-weight: 700; color: #10b981;">${availDisplay}</td>
                <td style="text-align: right; font-weight: 600;">${reqDisplay}</td>
                <td style="text-align: right; font-weight: 600;">${allocDisplay}</td>
                <td style="text-align: right; color: var(--text-secondary);">${remDisplay}</td>
                <td style="text-align: right; font-weight: 700; color: #ef4444;">${shortageDisplay}</td>
                <td style="text-align: center;">
                    <div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
                        <span style="font-weight: 600;">${coveragePct}%</span>
                        <div style="width: 40px; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
                            <div style="width: ${Math.min(100, coveragePct)}%; height: 100%; background: ${coveragePct >= 100 ? '#10b981' : (coveragePct > 0 ? '#f59e0b' : '#ef4444')};"></div>
                        </div>
                    </div>
                </td>
                <td style="text-align: center;">${renderStatusBadge(r.status)}</td>
                <td style="text-align: center;">
                    <button class="btn btn-sm btn-primary" onclick="openPendingManualAllocModal('${escapeHtml(r.fabric_name)}', '${escapeHtml(r.fabric_color)}', ${r.dia}, ${r.gsm}, ${r.available_stock_kg})" title="Manually allocate fabric stock across consuming styles" style="padding: 2px 8px; font-size: 11px;">
                        <i class="fa-solid fa-sliders"></i> Allocate
                    </button>
                </td>
            </tr>
            ${isExpanded ? `<tr id="pool-subrow-${poolKey}"><td colspan="14" style="padding: 0 0 0 40px; background: rgba(0,0,0,0.18);"><div id="pool-subrow-container-${poolKey}" style="padding: 10px 0;"><i class="fa-solid fa-spinner fa-spin"></i> Loading consuming styles...</div></td></tr>` : ''}
        `;
    });

    tbody.innerHTML = html;
    renderFabRequiredPaginationUI(totalCount, fabRequiredState.page, fabRequiredState.per_page);
}

function renderFabRequiredEmpty(msg) {
    const tbody = document.getElementById('fab-required-table-body');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="14" style="text-align: center; padding: 40px; color: var(--text-muted);">${msg}</td></tr>`;
    }
    renderFabRequiredPaginationUI(0, 1, fabRequiredState.per_page);
}

function renderFabRequiredPaginationUI(totalRecords, page, perPage) {
    const container = document.getElementById('fab-required-pagination');
    if (!container) return;

    if (totalRecords === 0) {
        container.innerHTML = `<div style="color: var(--text-muted);">Showing 0 to 0 of 0 records</div>`;
        return;
    }

    const totalPages = Math.ceil(totalRecords / perPage) || 1;
    const fromRecord = Math.min((page - 1) * perPage + 1, totalRecords);
    const toRecord = Math.min(page * perPage, totalRecords);

    container.innerHTML = `
        <div style="color: var(--text-secondary);">
            Showing <strong>${fromRecord}</strong> to <strong>${toRecord}</strong> of <strong>${totalRecords.toLocaleString()}</strong> records
            ${fabRequiredState.allRecords.length !== totalRecords ? `<span style="color: var(--text-muted); font-size: 11px;"> (Filtered from ${fabRequiredState.allRecords.length.toLocaleString()} total)</span>` : ''}
        </div>
        <div style="display: flex; gap: 6px; align-items: center;">
            <button class="btn btn-sm btn-outline" onclick="changeFabRequiredPage(${page - 1})" ${page <= 1 ? 'disabled style="opacity: 0.4; cursor: not-allowed;"' : ''} style="height: 28px; padding: 0 10px;">
                <i class="fa-solid fa-chevron-left"></i>
            </button>
            <span style="font-size: 11.5px; color: var(--text-secondary); margin: 0 4px;">Page <strong>${page}</strong> of <strong>${totalPages}</strong></span>
            <button class="btn btn-sm btn-outline" onclick="changeFabRequiredPage(${page + 1})" ${page >= totalPages ? 'disabled style="opacity: 0.4; cursor: not-allowed;"' : ''} style="height: 28px; padding: 0 10px;">
                <i class="fa-solid fa-chevron-right"></i>
            </button>
        </div>
    `;
}

function changeFabRequiredPage(newPage) {
    const filteredRecords = filterFabRequiredRecords();
    const totalPages = Math.ceil(filteredRecords.length / fabRequiredState.per_page) || 1;
    if (newPage < 1) newPage = 1;
    if (newPage > totalPages) newPage = totalPages;
    fabRequiredState.page = newPage;
    renderFilteredFabRequiredTable();
}

function openFabRequiredFilter(colKey, event) {
    if (event) event.stopPropagation();
    fabRequiredState.activePopupCol = colKey;

    const popup = document.getElementById('fab-required-filter-popup');
    const titleSpan = document.getElementById('fab-required-popup-col-title');
    const catSection = document.getElementById('fab-required-popup-categorical-section');
    const numSection = document.getElementById('fab-required-popup-numeric-section');
    const btn = event ? event.currentTarget : document.getElementById(`fab-required-filter-btn-${colKey}`);

    const colTitles = {
        fabric_name: 'Fabric Name Filter',
        fabric_color: 'Fabric Color Filter',
        dia: 'Dia Filter',
        gsm: 'GSM Filter',
        consuming_products_count: 'Consuming Styles Filter',
        available_stock_kg: 'Avail Stock (KG) Filter',
        required_fabric_kg: 'Total Req (KG) Filter',
        allocated_fabric_kg: 'Allocated (KG) Filter',
        remaining_fabric_kg: 'Remaining (KG) Filter',
        shortage_kg: 'Shortage (KG) Filter',
        coverage_pct: 'Coverage % Filter',
        status: 'Status Filter'
    };

    if (titleSpan) titleSpan.textContent = colTitles[colKey] || `${colKey} Filter`;

    if (isFabRequiredNumericCol(colKey)) {
        if (catSection) catSection.classList.add('hidden');
        if (numSection) numSection.classList.remove('hidden');
        renderFabRequiredNumericFilterUI(colKey);
    } else {
        if (numSection) numSection.classList.add('hidden');
        if (catSection) catSection.classList.remove('hidden');
        const searchInput = document.getElementById('fab-required-popup-search');
        if (searchInput) searchInput.value = '';
        renderFabRequiredFilterCheckboxes(colKey, '');
    }

    if (popup && btn) {
        popup.classList.remove('hidden');
        const rect = btn.getBoundingClientRect();
        popup.style.position = 'fixed';
        popup.style.zIndex = '99999';
        popup.style.top = `${rect.bottom + 4}px`;
        let leftPos = rect.left - 100;
        if (leftPos < 10) leftPos = 10;
        if (leftPos + 250 > window.innerWidth) leftPos = window.innerWidth - 260;
        popup.style.left = `${leftPos}px`;
        if (!isFabRequiredNumericCol(colKey)) {
            const searchInput = document.getElementById('fab-required-popup-search');
            if (searchInput) setTimeout(() => searchInput.focus(), 50);
        }
    }
}

function closeFabRequiredFilterPopup() {
    const popup = document.getElementById('fab-required-filter-popup');
    if (popup) popup.classList.add('hidden');
    fabRequiredState.activePopupCol = null;
}

function renderFabRequiredFilterCheckboxes(colKey, searchFilter) {
    const listContainer = document.getElementById('fab-required-popup-checkbox-list');
    if (!listContainer) return;

    const values = fabRequiredState.distinctValues[colKey] || [];
    const activeSet = fabRequiredState.filters[colKey];
    const term = (searchFilter || '').toLowerCase().trim();

    let html = '';
    let matchCount = 0;

    values.forEach((val, idx) => {
        if (term && !String(val).toLowerCase().includes(term)) return;
        matchCount++;
        const isChecked = (!activeSet || activeSet.size === 0) || activeSet.has(val);
        const itemId = `fab-required-chk-${colKey}-${idx}`;
        html += `
            <label class="pending-filter-checkbox-item" for="${itemId}">
                <input type="checkbox" id="${itemId}" value="${escapeHtml(val)}" ${isChecked ? 'checked' : ''}>
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(val)}</span>
            </label>
        `;
    });

    if (matchCount === 0) {
        html = `<div style="font-size: 11px; color: var(--text-muted); text-align: center; padding: 12px 0;">No matching options</div>`;
    }

    listContainer.innerHTML = html;
}

function onFabRequiredFilterSearchInput(val) {
    if (!fabRequiredState.activePopupCol) return;
    renderFabRequiredFilterCheckboxes(fabRequiredState.activePopupCol, val);
}

function fabRequiredFilterSelectAll(selectAll) {
    const checkboxes = document.querySelectorAll('#fab-required-popup-checkbox-list input[type="checkbox"]');
    checkboxes.forEach(chk => { chk.checked = selectAll; });
}

function renderFabRequiredNumericFilterUI(colKey) {
    const numFilter = fabRequiredState.filters[colKey] || {};
    const opSelect = document.getElementById('fab-required-popup-num-operator');
    const val1Input = document.getElementById('fab-required-popup-num-val1');
    const val2Input = document.getElementById('fab-required-popup-num-val2');
    const val2Wrap = document.getElementById('fab-required-popup-num-val2-wrap');

    const op = numFilter.operator || 'gte';
    if (opSelect) opSelect.value = op;
    if (val1Input) val1Input.value = numFilter.val1 !== undefined && numFilter.val1 !== null ? numFilter.val1 : '';
    if (val2Input) val2Input.value = numFilter.val2 !== undefined && numFilter.val2 !== null ? numFilter.val2 : '';

    if (val2Wrap) {
        if (op === 'between') val2Wrap.classList.remove('hidden');
        else val2Wrap.classList.add('hidden');
    }
}

function onFabRequiredNumericOperatorChange(val) {
    const val2Wrap = document.getElementById('fab-required-popup-num-val2-wrap');
    if (val2Wrap) {
        if (val === 'between') val2Wrap.classList.remove('hidden');
        else val2Wrap.classList.add('hidden');
    }
}

function applyFabRequiredFilterCurrent() {
    const colKey = fabRequiredState.activePopupCol;
    if (!colKey) return;

    if (isFabRequiredNumericCol(colKey)) {
        const op = document.getElementById('fab-required-popup-num-operator')?.value || 'gte';
        const v1Raw = document.getElementById('fab-required-popup-num-val1')?.value;
        const v2Raw = document.getElementById('fab-required-popup-num-val2')?.value;

        if (v1Raw === '' || v1Raw === undefined || v1Raw === null) {
            delete fabRequiredState.filters[colKey];
        } else {
            fabRequiredState.filters[colKey] = {
                operator: op,
                val1: Number(v1Raw),
                val2: (op === 'between' && v2Raw !== '') ? Number(v2Raw) : null
            };
        }
    } else {
        const checkboxes = document.querySelectorAll('#fab-required-popup-checkbox-list input[type="checkbox"]');
        const checkedValues = new Set();
        checkboxes.forEach(chk => {
            if (chk.checked) checkedValues.add(chk.value);
        });

        const totalValues = fabRequiredState.distinctValues[colKey] || [];
        if (checkedValues.size === totalValues.length || checkedValues.size === 0) {
            delete fabRequiredState.filters[colKey];
        } else {
            fabRequiredState.filters[colKey] = checkedValues;
        }
    }

    updateFabRequiredFilterBtnVisualState(colKey);
    closeFabRequiredFilterPopup();
    fabRequiredState.page = 1;
    renderFilteredFabRequiredTable();
}

function clearFabRequiredFilterCurrent() {
    const colKey = fabRequiredState.activePopupCol;
    if (!colKey) return;

    delete fabRequiredState.filters[colKey];
    updateFabRequiredFilterBtnVisualState(colKey);
    closeFabRequiredFilterPopup();
    fabRequiredState.page = 1;
    renderFilteredFabRequiredTable();
}

function clearAllFabRequiredFilters() {
    fabRequiredState.filters = {
        fabric_name: new Set(),
        fabric_color: new Set(),
        dia: null,
        gsm: null,
        consuming_products_count: null,
        available_stock_kg: null,
        required_fabric_kg: null,
        allocated_fabric_kg: null,
        remaining_fabric_kg: null,
        shortage_kg: null,
        coverage_pct: null,
        status: new Set()
    };

    const cols = [
        'fabric_name', 'fabric_color', 'dia', 'gsm', 'consuming_products_count',
        'available_stock_kg', 'required_fabric_kg', 'allocated_fabric_kg',
        'remaining_fabric_kg', 'shortage_kg', 'coverage_pct', 'status'
    ];
    cols.forEach(c => updateFabRequiredFilterBtnVisualState(c));

    closeFabRequiredFilterPopup();
    fabRequiredState.page = 1;
    renderFilteredFabRequiredTable();
}

function updateFabRequiredFilterBtnVisualState(colKey) {
    const btn = document.getElementById(`fab-required-filter-btn-${colKey}`);
    const filter = fabRequiredState.filters[colKey];

    let isFiltered = false;
    if (filter) {
        if (isFabRequiredNumericCol(colKey)) {
            isFiltered = filter.val1 !== undefined && filter.val1 !== null;
        } else if (filter instanceof Set) {
            isFiltered = filter.size > 0;
        }
    }

    if (btn) {
        if (isFiltered) {
            btn.classList.add('active');
            btn.innerHTML = `<i class="fa-solid fa-filter-circle-xmark"></i>`;
        } else {
            btn.classList.remove('active');
            btn.innerHTML = `<i class="fa-solid fa-filter"></i>`;
        }
    }

    let anyActive = false;
    Object.keys(fabRequiredState.filters).forEach(k => {
        const f = fabRequiredState.filters[k];
        if (f) {
            if (isFabRequiredNumericCol(k) && f.val1 !== undefined && f.val1 !== null) anyActive = true;
            else if (f instanceof Set && f.size > 0) anyActive = true;
        }
    });

    const clearAllBtn = document.getElementById('fab-required-clear-all-filters-btn');
    if (clearAllBtn) {
        if (anyActive) clearAllBtn.classList.remove('hidden');
        else clearAllBtn.classList.add('hidden');
    }
}

async function toggleFabricPoolConsumers(poolKey, fabricName, fabricColor, dia, gsm, btn) {
    const isExpanded = pendingPlanningState.expandedPools.has(poolKey);
    if (isExpanded) {
        pendingPlanningState.expandedPools.delete(poolKey);
        const subRow = document.getElementById(`pool-subrow-${poolKey}`);
        if (subRow) subRow.remove();
        if (btn) btn.innerHTML = '<i class="fa-solid fa-plus"></i>';
    } else {
        pendingPlanningState.expandedPools.add(poolKey);
        if (btn) btn.innerHTML = '<i class="fa-solid fa-minus"></i>';

        const parentTr = document.getElementById(`pool-row-${poolKey}`);
        if (!parentTr) return;

        const subTr = document.createElement('tr');
        subTr.id = `pool-subrow-${poolKey}`;
        subTr.innerHTML = `
            <td colspan="14" style="padding: 8px 16px 12px 48px; background: rgba(0,0,0,0.18); border-bottom: 1px solid var(--border-color);">
                <div id="pool-subrow-container-${poolKey}" style="padding: 4px 0;">
                    <i class="fa-solid fa-spinner fa-spin"></i> Loading consuming styles...
                </div>
            </td>
        `;
        parentTr.after(subTr);

        try {
            const params = new URLSearchParams({
                plan_id: pendingPlanningState.plan_id,
                fabric_name: fabricName,
                fabric_color: fabricColor,
                dia: dia
            });
            const res = await fetch(`/api/pending-qty-plan/pool-consumers?${params.toString()}`);
            const data = await res.json();
            const container = document.getElementById(`pool-subrow-container-${poolKey}`);
            if (!container) return;

            if (!data.success || !data.consumers || data.consumers.length === 0) {
                container.innerHTML = `<div style="font-size: 11.5px; color: var(--text-muted);">No active consumer styles for this fabric pool.</div>`;
                return;
            }

            let cHtml = `
                <div style="font-size: 11.5px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px;">
                    <i class="fa-solid fa-scissors"></i> Consuming Products & Allocation Breakdown for ${escapeHtml(fabricName)} / ${escapeHtml(fabricColor)}:
                </div>
                <table style="width: 100%; border-collapse: collapse; font-size: 11.5px; background: var(--bg-card); border-radius: 6px; overflow: hidden; border: 1px solid var(--border-color);">
                    <thead>
                        <tr style="background: rgba(255,255,255,0.03); border-bottom: 1px solid var(--border-color);">
                            <th style="padding: 6px 10px; width: 60px; text-align: center;">Priority</th>
                            <th style="padding: 6px 10px; text-align: left;">Product Type</th>
                            <th style="padding: 6px 10px; text-align: left;">Product / Common Group</th>
                            <th style="padding: 6px 10px; text-align: left;">Color</th>
                            <th style="padding: 6px 10px; text-align: left;">Size</th>
                            <th style="padding: 6px 10px; text-align: right;">Net Pending</th>
                            <th style="padding: 6px 10px; text-align: right;">Req Fabric (KG)</th>
                            <th style="padding: 6px 10px; text-align: right;">Allocated (KG)</th>
                            <th style="padding: 6px 10px; text-align: right; color: #10b981;">Cuttable (Pcs)</th>
                            <th style="padding: 6px 10px; text-align: right; color: #f59e0b;">Hold (Pcs)</th>
                            <th style="padding: 6px 10px; text-align: center;">Alloc Type</th>
                            <th style="padding: 6px 10px; text-align: center;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            data.consumers.forEach(c => {
                cHtml += `
                    <tr style="border-bottom: 1px solid var(--border-color);">
                        <td style="padding: 6px 10px; text-align: center;"><span class="badge" style="background: rgba(255,255,255,0.08); font-weight: 700;">${c.priority}</span></td>
                        <td style="padding: 6px 10px;"><span class="badge" style="background: ${c.item_type === 'Common' ? '#8b5cf6' : '#6b7280'}; color: #fff; font-size: 10px; padding: 2px 5px;">${c.item_type}</span></td>
                        <td style="padding: 6px 10px; font-weight: 500;">${escapeHtml(c.product_name)}</td>
                        <td style="padding: 6px 10px;">${escapeHtml(c.color)}</td>
                        <td style="padding: 6px 10px;">${escapeHtml(c.size)}</td>
                        <td style="padding: 6px 10px; text-align: right; font-weight: 600;">${Math.round(c.net_pending_qty).toLocaleString()}</td>
                        <td style="padding: 6px 10px; text-align: right;">${c.required_fabric_kg.toFixed(2)}</td>
                        <td style="padding: 6px 10px; text-align: right; font-weight: 600;">${c.allocated_fabric_kg.toFixed(2)}</td>
                        <td style="padding: 6px 10px; text-align: right; font-weight: 600; color: #10b981;">${Math.round(c.cuttable_qty).toLocaleString()}</td>
                        <td style="padding: 6px 10px; text-align: right; color: #f59e0b;">${Math.round(c.hold_qty).toLocaleString()}</td>
                        <td style="padding: 6px 10px; text-align: center;"><span class="badge" style="background: ${c.allocation_type === 'MANUAL' ? '#3b82f6' : 'rgba(255,255,255,0.08)'}; color: #fff; font-size: 9.5px; padding: 1px 5px;">${c.allocation_type}</span></td>
                        <td style="padding: 6px 10px; text-align: center;">${renderStatusBadge(c.status)}</td>
                    </tr>
                `;
            });

            cHtml += `</tbody></table>`;
            container.innerHTML = cHtml;
        } catch (err) {
            console.error("Error loading pool consumers:", err);
        }
    }
}

// -------------------------------------------------------------
// PRIORITY MODAL HANDLERS
// -------------------------------------------------------------
function openPendingPriorityModal(lineId, skuTitle, currentPriority) {
    document.getElementById('modal-priority-line-id').value = lineId;
    document.getElementById('modal-priority-sku-title').textContent = skuTitle;
    document.getElementById('modal-priority-sku-sub').textContent = `Current Priority: ${currentPriority}`;
    document.getElementById('modal-priority-input').value = currentPriority;
    document.getElementById('pending-priority-modal')?.classList.remove('hidden');
}

function closePendingPriorityModal() {
    document.getElementById('pending-priority-modal')?.classList.add('hidden');
}

async function savePendingLinePriority() {
    const lineId = document.getElementById('modal-priority-line-id').value;
    const priorityVal = parseInt(document.getElementById('modal-priority-input').value);

    if (!lineId || isNaN(priorityVal) || priorityVal < 1) {
        showToast('Warning', 'Please enter a valid positive priority number.', 'warning');
        return;
    }

    showLoader(true, "Updating priority and recalculating allocations...");
    try {
        const res = await fetch('/api/pending-qty-plan/update-priority', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                plan_id: pendingPlanningState.plan_id,
                line_id: lineId,
                priority: priorityVal
            })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            closePendingPriorityModal();
            showToast('Priority Updated', 'Priority updated and allocations recalculated successfully!', 'success');
            await refreshPendingPlanningSummary();
            await loadActivePendingSubTabTable();
        } else {
            showToast('Error', data.message || 'Failed to update priority.', 'error');
        }
    } catch (err) {
        console.error("Error saving priority:", err);
        showToast('Error', 'Network error updating priority.', 'error');
    } finally {
        showLoader(false);
    }
}

// -------------------------------------------------------------
// MANUAL ALLOCATION MODAL HANDLERS
// -------------------------------------------------------------
async function openPendingManualAllocModal(fabricName, fabricColor, dia, gsm, availStock) {
    pendingPlanningState.currentPoolForAlloc = {
        fabric_name: fabricName,
        fabric_color: fabricColor,
        dia: dia,
        gsm: gsm,
        available_stock_kg: availStock
    };

    document.getElementById('modal-alloc-pool-title').textContent = `${fabricName} / ${fabricColor} (Dia: ${dia}, GSM: ${gsm || '-'})`;
    document.getElementById('modal-alloc-avail-stock').textContent = `${availStock.toFixed(2)} KG`;
    document.getElementById('modal-alloc-error-banner').classList.add('hidden');

    const tbody = document.getElementById('modal-alloc-consumers-tbody');
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading consumers...</td></tr>`;

    document.getElementById('pending-manual-allocation-modal')?.classList.remove('hidden');

    try {
        const params = new URLSearchParams({
            plan_id: pendingPlanningState.plan_id,
            fabric_name: fabricName,
            fabric_color: fabricColor,
            dia: dia
        });
        const res = await fetch(`/api/pending-qty-plan/pool-consumers?${params.toString()}`);
        const data = await res.json();

        if (!data.success || !data.consumers || data.consumers.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--text-muted);">No active consumer styles found.</td></tr>`;
            return;
        }

        let html = '';
        data.consumers.forEach(c => {
            const currentAlloc = c.manual_allocated_kg !== null ? c.manual_allocated_kg : c.allocated_fabric_kg;
            html += `
                <tr style="border-bottom: 1px solid var(--border-color);">
                    <td style="text-align: center;"><span class="badge" style="background: rgba(255,255,255,0.08);">${c.priority}</span></td>
                    <td><span class="badge" style="background: ${c.item_type === 'Common' ? '#8b5cf6' : '#6b7280'}; color: #fff; font-size: 10px; padding: 2px 5px;">${c.item_type}</span></td>
                    <td style="font-weight: 500;">${escapeHtml(c.product_name)}</td>
                    <td>${escapeHtml(c.color)}</td>
                    <td>${escapeHtml(c.size)}</td>
                    <td style="text-align: right; font-weight: 600;">${Math.round(c.net_pending_qty).toLocaleString()}</td>
                    <td style="text-align: right;">${c.required_fabric_kg.toFixed(2)}</td>
                    <td style="text-align: right;">
                        <input type="number" class="form-input modal-alloc-input" data-line-id="${c.line_id}" min="0" max="${availStock}" step="0.01" value="${currentAlloc.toFixed(2)}" oninput="recalcModalAllocationTotal()" style="width: 110px; text-align: right; height: 30px; font-size: 12px;">
                    </td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
        recalcModalAllocationTotal();
    } catch (err) {
        console.error("Error loading consumers for manual alloc:", err);
    }
}

function closePendingManualAllocModal() {
    document.getElementById('pending-manual-allocation-modal')?.classList.add('hidden');
}

function recalcModalAllocationTotal() {
    const inputs = document.querySelectorAll('.modal-alloc-input');
    let total = 0;
    inputs.forEach(inp => {
        const val = parseFloat(inp.value) || 0;
        total += val;
    });

    const avail = pendingPlanningState.currentPoolForAlloc ? pendingPlanningState.currentPoolForAlloc.available_stock_kg : 0;
    const remaining = Math.max(0, avail - total);

    document.getElementById('modal-alloc-total-allocated').textContent = `${total.toFixed(2)} KG`;
    document.getElementById('modal-alloc-remaining-stock').textContent = `${remaining.toFixed(2)} KG`;

    const errorBanner = document.getElementById('modal-alloc-error-banner');
    const saveBtn = document.getElementById('modal-alloc-save-btn');

    if (total > avail + 0.001) {
        errorBanner.classList.remove('hidden');
        errorBanner.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Total allocation (${total.toFixed(2)} KG) exceeds available stock (${avail.toFixed(2)} KG)!`;
        if (saveBtn) saveBtn.disabled = true;
    } else {
        errorBanner.classList.add('hidden');
        if (saveBtn) saveBtn.disabled = false;
    }
}

function resetModalManualAllocations() {
    const inputs = document.querySelectorAll('.modal-alloc-input');
    inputs.forEach(inp => {
        inp.value = '0.00';
    });
    recalcModalAllocationTotal();
}

async function savePendingManualAllocation() {
    if (!pendingPlanningState.currentPoolForAlloc) return;

    const inputs = document.querySelectorAll('.modal-alloc-input');
    const allocations = [];
    inputs.forEach(inp => {
        const lineId = parseInt(inp.dataset.lineId);
        const val = parseFloat(inp.value) || 0;
        allocations.push({
            line_id: lineId,
            manual_allocated_kg: val
        });
    });

    showLoader(true, "Applying manual allocations and recalculating plan...");
    try {
        const payload = {
            plan_id: pendingPlanningState.plan_id,
            fabric_name: pendingPlanningState.currentPoolForAlloc.fabric_name,
            fabric_color: pendingPlanningState.currentPoolForAlloc.fabric_color,
            dia: pendingPlanningState.currentPoolForAlloc.dia,
            gsm: pendingPlanningState.currentPoolForAlloc.gsm,
            allocations: allocations
        };

        const res = await fetch('/api/pending-qty-plan/manual-allocation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok && data.success) {
            closePendingManualAllocModal();
            showToast('Saved', 'Manual allocation applied and plan recalculated successfully!', 'success');
            await refreshPendingPlanningSummary();
            await loadActivePendingSubTabTable();
        } else {
            showToast('Validation Error', data.message || 'Failed to save manual allocation.', 'error');
        }
    } catch (err) {
        console.error("Error saving manual allocation:", err);
        showToast('Error', 'Network error saving allocation.', 'error');
    } finally {
        showLoader(false);
    }
}

// -------------------------------------------------------------
// PLAN CONFIRMATION & EXPORT
// -------------------------------------------------------------
async function confirmPendingQtyPlan() {
    if (!pendingPlanningState.plan_id) {
        showToast('Info', 'Please calculate a plan first before confirming.', 'info');
        return;
    }

    if (!confirm("Are you sure you want to confirm and freeze this Pending Qty Plan?")) {
        return;
    }

    showLoader(true, "Confirming plan...");
    try {
        const res = await fetch('/api/pending-qty-plan/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan_id: pendingPlanningState.plan_id })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            showToast('Plan Confirmed', 'Pending Qty Plan confirmed and frozen successfully!', 'success');
            await refreshPendingPlanningSummary();
        } else {
            showToast('Error', data.message || 'Failed to confirm plan.', 'error');
        }
    } catch (err) {
        console.error("Error confirming plan:", err);
        showToast('Error', 'Network error confirming plan.', 'error');
    } finally {
        showLoader(false);
    }
}

function exportCurrentPendingTabExcel() {
    if (!pendingPlanningState.plan_id) {
        showToast('Info', 'Please calculate a plan before exporting.', 'info');
        return;
    }

    const filters = getPendingFilterValues();
    const params = new URLSearchParams({
        plan_id: pendingPlanningState.plan_id,
        tab: pendingPlanningState.activeSubTab,
        ...filters
    });

    window.location.href = `/api/pending-qty-plan/export?${params.toString()}`;
}

// -------------------------------------------------------------
// UI HELPERS (STATUS BADGES, PAGINATION)
// -------------------------------------------------------------
function renderStatusBadge(status) {
    if (!status) return `<span class="badge" style="background: #6b7280; color: #fff; font-size: 10px; padding: 2px 6px;">-</span>`;

    let bg = '#6b7280';
    if (status === 'FULL' || status === 'ENOUGH') {
        bg = '#10b981';
    } else if (status === 'PARTIAL') {
        bg = '#f59e0b';
    } else if (status === 'FABRIC SHORTAGE' || status === 'SHORTAGE') {
        bg = '#ef4444';
    } else if (status === 'NO PENDING') {
        bg = '#6b7280';
    } else if (status === 'HOLD') {
        bg = '#d97706';
    }

    return `<span class="badge" style="background: ${bg}; color: #fff; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px;">${status}</span>`;
}

function changePendingPageSize(newSize) {
    const val = parseInt(newSize);
    pendingPlanningState.per_page = val;
    pendingPlanningState.page = 1;
    loadActivePendingSubTabTable();
}

function renderPendingPagination(containerId, totalCount, currentPage, perPage, fetchFunc) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (totalCount === 0) {
        container.innerHTML = `<div>Showing 0 of 0 records</div><div></div>`;
        return;
    }

    const isAll = (perPage === -1 || perPage >= 100000);
    const effectivePerPage = isAll ? totalCount : perPage;
    const totalPages = isAll ? 1 : Math.ceil(totalCount / effectivePerPage);
    const start = isAll ? 1 : (currentPage - 1) * effectivePerPage + 1;
    const end = isAll ? totalCount : Math.min(currentPage * effectivePerPage, totalCount);

    let html = `
        <div style="color: var(--text-secondary); font-size: 12px; display: flex; align-items: center; gap: 16px;">
            <div>
                Showing <strong>${start}</strong> to <strong>${end}</strong> of <strong>${totalCount}</strong> records
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
                <span style="color: var(--text-secondary); font-size: 11.5px;">Rows per page:</span>
                <select class="form-select" onchange="changePendingPageSize(this.value)" style="height: 28px; padding: 2px 8px; font-size: 12px; width: 80px; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 4px;">
                    <option value="25" ${perPage === 25 ? 'selected' : ''}>25</option>
                    <option value="50" ${perPage === 50 ? 'selected' : ''}>50</option>
                    <option value="100" ${perPage === 100 ? 'selected' : ''}>100</option>
                    <option value="250" ${perPage === 250 ? 'selected' : ''}>250</option>
                    <option value="500" ${perPage === 500 ? 'selected' : ''}>500</option>
                    <option value="1000" ${perPage === 1000 ? 'selected' : ''}>1000</option>
                    <option value="-1" ${isAll ? 'selected' : ''}>All</option>
                </select>
            </div>
        </div>
        <div style="display: flex; gap: 4px; align-items: center;">
            <button class="btn btn-sm btn-outline" ${currentPage <= 1 || isAll ? 'disabled' : ''} onclick="${fetchFunc.name}(1)" title="First Page">
                <i class="fa-solid fa-angles-left"></i>
            </button>
            <button class="btn btn-sm btn-outline" ${currentPage <= 1 || isAll ? 'disabled' : ''} onclick="${fetchFunc.name}(${currentPage - 1})" title="Previous Page">
                <i class="fa-solid fa-angle-left"></i>
            </button>
            <span style="padding: 0 8px; font-weight: 600; font-size: 12px;">Page ${currentPage} of ${totalPages}</span>
            <button class="btn btn-sm btn-outline" ${currentPage >= totalPages || isAll ? 'disabled' : ''} onclick="${fetchFunc.name}(${currentPage + 1})" title="Next Page">
                <i class="fa-solid fa-angle-right"></i>
            </button>
            <button class="btn btn-sm btn-outline" ${currentPage >= totalPages || isAll ? 'disabled' : ''} onclick="${fetchFunc.name}(${totalPages})" title="Last Page">
                <i class="fa-solid fa-angles-right"></i>
            </button>
        </div>
    `;

    container.innerHTML = html;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// =====================================================================
// LEAD DAYS MASTER MODULE (PREPARATION FOR FUTURE BASE STOCK MODULE)
// STRICTLY ISOLATED JAVASCRIPT & STATE MANAGEMENT
// =====================================================================
const leadDaysState = {
    activeSubTab: 'fabric', // 'fabric' | 'production'
    fabricList: [],
    productionList: {
        standalone: [],
        common_production: []
    },
    fabricSearch: '',
    fabricStatus: 'all', // 'all' | 'set' | 'unset'
    productionSearch: '',
    productionType: 'all', // 'all' | 'Stand Alone' | 'Common Production'
    productionStatus: 'all', // 'all' | 'set' | 'unset'
    editing: {
        fabric: {}, // fabricId -> true
        standalone: {}, // productId -> true
        common_production: {} // commonId -> true
    }
};

function initLeadDaysMaster() {
    if (leadDaysState.activeSubTab === 'fabric') {
        fetchFabricLeadDaysMaster();
    } else {
        fetchProductionLeadDaysMaster();
    }
}

function switchLeadDaysSubTab(subTab) {
    leadDaysState.activeSubTab = subTab;
    const btnFab = document.getElementById('lead-days-subtab-fabric');
    const btnProd = document.getElementById('lead-days-subtab-production');
    const secFab = document.getElementById('fabric-lead-days-section');
    const secProd = document.getElementById('production-lead-days-section');

    if (subTab === 'fabric') {
        if (btnFab) { btnFab.className = 'btn btn-primary'; }
        if (btnProd) { btnProd.className = 'btn btn-outline'; }
        if (secFab) { secFab.classList.remove('hidden'); }
        if (secProd) { secProd.classList.add('hidden'); }
        fetchFabricLeadDaysMaster();
    } else {
        if (btnFab) { btnFab.className = 'btn btn-outline'; }
        if (btnProd) { btnProd.className = 'btn btn-primary'; }
        if (secFab) { secFab.classList.add('hidden'); }
        if (secProd) { secProd.classList.remove('hidden'); }
        fetchProductionLeadDaysMaster();
    }
}

async function fetchFabricLeadDaysMaster() {
    const tbody = document.getElementById('fabric-lead-days-table-body');
    const loader = document.getElementById('fabric-lead-days-loader');
    const emptyEl = document.getElementById('fabric-lead-days-empty');

    if (loader) loader.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');

    try {
        const res = await fetch('/api/masters/lead-days/fabric');
        const data = await res.json();
        if (loader) loader.classList.add('hidden');

        if (data.success && data.fabrics) {
            leadDaysState.fabricList = data.fabrics;
            renderFabricLeadDaysTable();
        } else {
            showToast('Error', data.message || 'Failed to load fabric lead days', 'error');
        }
    } catch (err) {
        if (loader) loader.classList.add('hidden');
        console.error("Error loading fabric lead days:", err);
        showToast('Error', 'Connection error while loading fabric lead days', 'error');
    }
}

function handleFabricLeadDaysSearch() {
    const searchInput = document.getElementById('fabric-lead-days-search');
    const statusSelect = document.getElementById('fabric-lead-days-filter-status');
    leadDaysState.fabricSearch = searchInput ? searchInput.value.toLowerCase().trim() : '';
    leadDaysState.fabricStatus = statusSelect ? statusSelect.value : 'all';
    renderFabricLeadDaysTable();
}

function renderFabricLeadDaysTable() {
    const tbody = document.getElementById('fabric-lead-days-table-body');
    const emptyEl = document.getElementById('fabric-lead-days-empty');
    if (!tbody) return;

    const term = leadDaysState.fabricSearch;
    const stat = leadDaysState.fabricStatus;

    const filtered = leadDaysState.fabricList.filter(item => {
        const name = (item.fabric_name || '').toLowerCase();
        const gsm = String(item.gsm || '');
        const uom = (item.uom || '').toLowerCase();
        const dias = (item.dias || []).join(' ');

        if (term) {
            const matches = name.includes(term) || gsm.includes(term) || uom.includes(term) || dias.includes(term);
            if (!matches) return false;
        }

        const isSet = item.lead_days !== null && item.lead_days !== undefined;
        if (stat === 'set' && !isSet) return false;
        if (stat === 'unset' && isSet) return false;

        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');

    let html = '';
    filtered.forEach(item => {
        const isEditing = leadDaysState.editing.fabric[item.id] === true;
        const diasStr = item.dias && item.dias.length > 0 ? item.dias.map(d => `${d}"`).join(', ') : '-';
        const isSet = item.lead_days !== null && item.lead_days !== undefined;

        let leadDaysDisplay = '';
        let actionDisplay = '';

        if (isEditing) {
            leadDaysDisplay = `
                <input type="number" id="input-fab-lead-${item.id}" value="${isSet ? item.lead_days : ''}" placeholder="Days" min="0" step="1"
                    style="width: 80px; padding: 4px 8px; font-size: 13px; text-align: center; background: var(--bg-primary); border: 1px solid var(--accent-blue); color: var(--text-primary); border-radius: var(--radius-sm);"
                    onkeydown="if(event.key==='Enter') saveFabricLeadDay(${item.id})">
            `;
            actionDisplay = `
                <button class="btn btn-xs btn-primary" onclick="saveFabricLeadDay(${item.id})" style="padding: 3px 10px; margin-right: 4px;">
                    <i class="fa-solid fa-check"></i> Save
                </button>
                <button class="btn btn-xs btn-outline" onclick="cancelEditFabricLeadDay(${item.id})" style="padding: 3px 8px;">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            `;
        } else {
            if (isSet) {
                leadDaysDisplay = `
                    <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; font-weight: 700; font-size: 12.5px; padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(16, 185, 129, 0.3);">
                        <i class="fa-solid fa-business-time" style="font-size: 11px; margin-right: 4px;"></i> ${item.lead_days} Days
                    </span>
                `;
            } else {
                leadDaysDisplay = `
                    <span class="badge" style="background: rgba(148, 163, 184, 0.12); color: var(--text-muted); font-size: 11.5px; padding: 3px 8px; border-radius: 6px;">
                        Not Set
                    </span>
                `;
            }
            actionDisplay = `
                <button class="btn btn-xs btn-outline" onclick="startEditFabricLeadDay(${item.id})" style="padding: 3px 10px;">
                    <i class="fa-solid fa-pen-to-square" style="margin-right: 3px;"></i> Edit
                </button>
            `;
        }

        html += `
            <tr style="border-bottom: 1px solid var(--border-color);">
                <td style="font-weight: 600; color: var(--text-primary);">${escapeHtml(item.fabric_name)}</td>
                <td style="text-align: right; color: var(--text-secondary);">${item.gsm || '-'}</td>
                <td style="text-align: center; color: var(--text-secondary);"><span class="badge" style="background: rgba(255,255,255,0.05);">${escapeHtml(diasStr)}</span></td>
                <td style="text-align: center; color: var(--text-secondary); font-size: 12px;">${escapeHtml(item.uom)}</td>
                <td style="text-align: center;">${leadDaysDisplay}</td>
                <td style="text-align: center;">${actionDisplay}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

function startEditFabricLeadDay(id) {
    leadDaysState.editing.fabric[id] = true;
    renderFabricLeadDaysTable();
    setTimeout(() => {
        const el = document.getElementById(`input-fab-lead-${id}`);
        if (el) el.focus();
    }, 50);
}

function cancelEditFabricLeadDay(id) {
    delete leadDaysState.editing.fabric[id];
    renderFabricLeadDaysTable();
}

async function saveFabricLeadDay(id) {
    const input = document.getElementById(`input-fab-lead-${id}`);
    if (!input) return;

    const valStr = input.value.trim();
    let val = null;

    if (valStr !== '') {
        const num = Number(valStr);
        if (!Number.isInteger(num) || num < 0) {
            showToast('Validation Error', 'Lead Days must be a whole number (0 or greater).', 'warning');
            input.focus();
            return;
        }
        val = num;
    }

    try {
        const res = await fetch('/api/masters/lead-days/fabric', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fabric_id: id, lead_days: val })
        });
        const data = await res.json();
        if (data.success) {
            const item = leadDaysState.fabricList.find(f => f.id === id);
            if (item) item.lead_days = val;
            delete leadDaysState.editing.fabric[id];
            renderFabricLeadDaysTable();
            showToast('Success', 'Fabric Lead Days saved successfully.', 'success');
        } else {
            showToast('Error', data.message || 'Failed to save fabric lead days', 'error');
        }
    } catch (err) {
        console.error("Error saving fabric lead days:", err);
        showToast('Error', 'Connection error while saving fabric lead days', 'error');
    }
}

async function fetchProductionLeadDaysMaster() {
    const tbody = document.getElementById('production-lead-days-table-body');
    const loader = document.getElementById('production-lead-days-loader');
    const emptyEl = document.getElementById('production-lead-days-empty');

    if (loader) loader.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');

    try {
        const res = await fetch('/api/masters/lead-days/production');
        const data = await res.json();
        if (loader) loader.classList.add('hidden');

        if (data.success) {
            leadDaysState.productionList = {
                standalone: data.standalone || [],
                common_production: data.common_production || []
            };
            renderProductionLeadDaysTable();
        } else {
            showToast('Error', data.message || 'Failed to load production lead days', 'error');
        }
    } catch (err) {
        if (loader) loader.classList.add('hidden');
        console.error("Error loading production lead days:", err);
        showToast('Error', 'Connection error while loading production lead days', 'error');
    }
}

function handleProductionLeadDaysSearch() {
    const searchInput = document.getElementById('production-lead-days-search');
    const typeSelect = document.getElementById('production-lead-days-filter-type');
    const statusSelect = document.getElementById('production-lead-days-filter-status');
    leadDaysState.productionSearch = searchInput ? searchInput.value.toLowerCase().trim() : '';
    leadDaysState.productionType = typeSelect ? typeSelect.value : 'all';
    leadDaysState.productionStatus = statusSelect ? statusSelect.value : 'all';
    renderProductionLeadDaysTable();
}

function renderProductionLeadDaysTable() {
    const tbody = document.getElementById('production-lead-days-table-body');
    const emptyEl = document.getElementById('production-lead-days-empty');
    if (!tbody) return;

    const term = leadDaysState.productionSearch;
    const typeFilter = leadDaysState.productionType;
    const statFilter = leadDaysState.productionStatus;

    let combined = [];

    // Stand Alone rows
    if (typeFilter === 'all' || typeFilter === 'Stand Alone') {
        leadDaysState.productionList.standalone.forEach(item => {
            combined.push({
                rowType: 'standalone',
                id: item.id,
                type: 'Stand Alone',
                name: item.name,
                code: item.code || '-',
                member_count: null,
                member_products: null,
                lead_days: item.lead_days
            });
        });
    }

    // Common Production rows
    if (typeFilter === 'all' || typeFilter === 'Common Production') {
        leadDaysState.productionList.common_production.forEach(item => {
            combined.push({
                rowType: 'common_production',
                id: item.id,
                type: 'Common Production',
                name: item.name,
                code: null,
                member_count: item.member_count,
                member_products: item.member_products || [],
                lead_days: item.lead_days
            });
        });
    }

    // Filter
    const filtered = combined.filter(item => {
        const name = (item.name || '').toLowerCase();
        const code = (item.code || '').toLowerCase();
        const type = (item.type || '').toLowerCase();

        if (term) {
            const matches = name.includes(term) || code.includes(term) || type.includes(term);
            if (!matches) return false;
        }

        const isSet = item.lead_days !== null && item.lead_days !== undefined;
        if (statFilter === 'set' && !isSet) return false;
        if (statFilter === 'unset' && isSet) return false;

        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');

    let html = '';
    filtered.forEach(item => {
        const isCommon = item.rowType === 'common_production';
        const isEditing = isCommon ? (leadDaysState.editing.common_production[item.id] === true) : (leadDaysState.editing.standalone[item.id] === true);
        const isSet = item.lead_days !== null && item.lead_days !== undefined;

        let leadDaysDisplay = '';
        let actionDisplay = '';

        if (isEditing) {
            leadDaysDisplay = `
                <input type="number" id="input-prod-lead-${item.rowType}-${item.id}" value="${isSet ? item.lead_days : ''}" placeholder="Days" min="0" step="1"
                    style="width: 80px; padding: 4px 8px; font-size: 13px; text-align: center; background: var(--bg-primary); border: 1px solid var(--accent-blue); color: var(--text-primary); border-radius: var(--radius-sm);"
                    onkeydown="if(event.key==='Enter') saveProductionLeadDay('${item.rowType}', ${item.id})">
            `;
            actionDisplay = `
                <button class="btn btn-xs btn-primary" onclick="saveProductionLeadDay('${item.rowType}', ${item.id})" style="padding: 3px 10px; margin-right: 4px;">
                    <i class="fa-solid fa-check"></i> Save
                </button>
                <button class="btn btn-xs btn-outline" onclick="cancelEditProductionLeadDay('${item.rowType}', ${item.id})" style="padding: 3px 8px;">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            `;
        } else {
            if (isSet) {
                leadDaysDisplay = `
                    <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; font-weight: 700; font-size: 12.5px; padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(16, 185, 129, 0.3);">
                        <i class="fa-solid fa-business-time" style="font-size: 11px; margin-right: 4px;"></i> ${item.lead_days} Days
                    </span>
                `;
            } else {
                leadDaysDisplay = `
                    <span class="badge" style="background: rgba(148, 163, 184, 0.12); color: var(--text-muted); font-size: 11.5px; padding: 3px 8px; border-radius: 6px;">
                        Not Set
                    </span>
                `;
            }
            actionDisplay = `
                <button class="btn btn-xs btn-outline" onclick="startEditProductionLeadDay('${item.rowType}', ${item.id})" style="padding: 3px 10px;">
                    <i class="fa-solid fa-pen-to-square" style="margin-right: 3px;"></i> Edit
                </button>
            `;
        }

        // Details column
        let detailsDisplay = '';
        if (isCommon) {
            const memberTooltip = item.member_products && item.member_products.length > 0 ? escapeHtml(item.member_products.join(', ')) : 'No active members';
            detailsDisplay = `
                <span class="badge" style="background: rgba(139, 92, 246, 0.15); color: #c084fc; font-weight: 600; padding: 3px 8px; border-radius: 6px;" title="Products: ${memberTooltip}">
                    <i class="fa-solid fa-cubes" style="margin-right: 4px;"></i> ${item.member_count} Members
                </span>
            `;
        } else {
            detailsDisplay = `<span style="color: var(--text-secondary); font-size: 12.5px;">${escapeHtml(item.code)}</span>`;
        }

        const typeBadge = isCommon ?
            `<span class="badge" style="background: #8b5cf6; color: #fff; font-size: 11px; padding: 3px 8px;"><i class="fa-solid fa-layer-group" style="margin-right: 3px;"></i> Common Production</span>` :
            `<span class="badge" style="background: #64748b; color: #fff; font-size: 11px; padding: 3px 8px;"><i class="fa-solid fa-shirt" style="margin-right: 3px;"></i> Stand Alone</span>`;

        html += `
            <tr style="border-bottom: 1px solid var(--border-color); ${isCommon ? 'background: rgba(139, 92, 246, 0.02);' : ''}">
                <td style="text-align: center;">${typeBadge}</td>
                <td style="font-weight: 600; color: ${isCommon ? '#a78bfa' : 'var(--text-primary)'};">${escapeHtml(item.name)}</td>
                <td style="color: var(--text-secondary);">${detailsDisplay}</td>
                <td style="text-align: center;">${leadDaysDisplay}</td>
                <td style="text-align: center;">${actionDisplay}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

function startEditProductionLeadDay(type, id) {
    if (type === 'common_production') {
        leadDaysState.editing.common_production[id] = true;
    } else {
        leadDaysState.editing.standalone[id] = true;
    }
    renderProductionLeadDaysTable();
    setTimeout(() => {
        const el = document.getElementById(`input-prod-lead-${type}-${id}`);
        if (el) el.focus();
    }, 50);
}

function cancelEditProductionLeadDay(type, id) {
    if (type === 'common_production') {
        delete leadDaysState.editing.common_production[id];
    } else {
        delete leadDaysState.editing.standalone[id];
    }
    renderProductionLeadDaysTable();
}

async function saveProductionLeadDay(type, id) {
    const input = document.getElementById(`input-prod-lead-${type}-${id}`);
    if (!input) return;

    const valStr = input.value.trim();
    let val = null;

    if (valStr !== '') {
        const num = Number(valStr);
        if (!Number.isInteger(num) || num < 0) {
            showToast('Validation Error', 'Lead Days must be a whole number (0 or greater).', 'warning');
            input.focus();
            return;
        }
        val = num;
    }

    try {
        const res = await fetch('/api/masters/lead-days/production', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: type, id: id, lead_days: val })
        });
        const data = await res.json();
        if (data.success) {
            if (type === 'common_production') {
                const item = leadDaysState.productionList.common_production.find(c => c.id === id);
                if (item) item.lead_days = val;
                delete leadDaysState.editing.common_production[id];
            } else {
                const item = leadDaysState.productionList.standalone.find(s => s.id === id);
                if (item) item.lead_days = val;
                delete leadDaysState.editing.standalone[id];
            }
            renderProductionLeadDaysTable();
            showToast('Success', 'Production Lead Days saved successfully.', 'success');
        } else {
            showToast('Error', data.message || 'Failed to save production lead days', 'error');
        }
    } catch (err) {
        console.error("Error saving production lead days:", err);
        showToast('Error', 'Connection error while saving production lead days', 'error');
    }
}

function exportLeadDaysExcel() {
    if (leadDaysState.activeSubTab === 'fabric') {
        const rows = leadDaysState.fabricList.map(f => ({
            'Fabric Name': f.fabric_name,
            'GSM': f.gsm || '-',
            'DIA': f.dias && f.dias.length > 0 ? f.dias.join(', ') : '-',
            'UOM': f.uom || 'KGS',
            'Lead Days': f.lead_days !== null && f.lead_days !== undefined ? f.lead_days : 'Not Set'
        }));
        if (typeof XLSX !== 'undefined') {
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Fabric Lead Days');
            XLSX.writeFile(wb, `Fabric_Lead_Days_${new Date().toISOString().split('T')[0]}.xlsx`);
        } else {
            showToast('Info', 'Export ready for ' + rows.length + ' fabrics', 'info');
        }
    } else {
        const standaloneRows = leadDaysState.productionList.standalone.map(s => ({
            'Type': 'Stand Alone',
            'Name': s.name,
            'Code / Details': s.code || '-',
            'Lead Days': s.lead_days !== null && s.lead_days !== undefined ? s.lead_days : 'Not Set'
        }));
        const commonRows = leadDaysState.productionList.common_production.map(c => ({
            'Type': 'Common Production',
            'Name': c.name,
            'Code / Details': `${c.member_count} Members: ${(c.member_products || []).join(', ')}`,
            'Lead Days': c.lead_days !== null && c.lead_days !== undefined ? c.lead_days : 'Not Set'
        }));
        const rows = [...standaloneRows, ...commonRows];
        if (typeof XLSX !== 'undefined') {
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Production Lead Days');
            XLSX.writeFile(wb, `Production_Lead_Days_${new Date().toISOString().split('T')[0]}.xlsx`);
        } else {
            showToast('Info', 'Export ready for ' + rows.length + ' production items', 'info');
        }
    }
}


