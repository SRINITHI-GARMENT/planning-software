class MultiSelectFilter {
    constructor(containerId, filterKey, label, options = [], onApplyCallback = null) {
        this.container = document.getElementById(containerId);
        this.filterKey = filterKey;
        this.label = label;
        this.allOptions = [...options];
        this.onApply = onApplyCallback;

        // Selections state
        this.appliedSelections = new Set();
        this.tempSelections = new Set();

        this.init();
    }

    init() {
        // Create accordion elements
        this.element = document.createElement('div');
        this.element.className = 'filter-accordion-item';
        this.element.id = `filter-${this.filterKey}-item`;

        this.element.innerHTML = `
            <div class="filter-accordion-header" id="header-${this.filterKey}">
                <span class="filter-title">${this.label}</span>
                <span class="filter-badge" id="badge-${this.filterKey}">All</span>
                <i class="fa-solid fa-chevron-down filter-icon"></i>
            </div>
            <div class="filter-accordion-body hidden" id="body-${this.filterKey}">
                <div class="filter-search-wrapper">
                    <input type="text" class="filter-search-input" id="search-${this.filterKey}" placeholder="Search ${this.label.toLowerCase()}...">
                </div>
                <div class="filter-shortcuts">
                    <button type="button" class="btn-shortcut" id="btn-select-all-${this.filterKey}">Select All</button>
                    <button type="button" class="btn-shortcut" id="btn-clear-${this.filterKey}">Clear All</button>
                </div>
                <div class="filter-checkbox-list" id="list-${this.filterKey}">
                    <!-- List items will be generated here -->
                </div>
                <div class="filter-actions">
                    <button type="button" class="btn btn-xs btn-outline" id="btn-cancel-${this.filterKey}">Cancel</button>
                    <button type="button" class="btn btn-xs btn-primary" id="btn-apply-${this.filterKey}">Apply</button>
                </div>
            </div>
        `;

        this.container.appendChild(this.element);

        // Cache DOM elements
        this.headerEl = this.element.querySelector('.filter-accordion-header');
        this.bodyEl = this.element.querySelector('.filter-accordion-body');
        this.badgeEl = this.element.querySelector('.filter-badge');
        this.searchEl = this.element.querySelector('.filter-search-input');
        this.listEl = this.element.querySelector('.filter-checkbox-list');

        // Event Listeners
        this.headerEl.addEventListener('click', () => this.toggleCollapse());
        this.searchEl.addEventListener('input', () => this.renderList());

        this.element.querySelector(`#btn-select-all-${this.filterKey}`).addEventListener('click', () => this.selectAll());
        this.element.querySelector(`#btn-clear-${this.filterKey}`).addEventListener('click', () => this.clearAll());
        this.element.querySelector(`#btn-cancel-${this.filterKey}`).addEventListener('click', () => this.cancel());
        this.element.querySelector(`#btn-apply-${this.filterKey}`).addEventListener('click', () => this.apply());

        // Initial render
        this.renderList();
    }

    toggleCollapse() {
        const isCollapsed = this.bodyEl.classList.contains('hidden');

        // Close all other filter accordions first for a neat accordion effect
        document.querySelectorAll('.filter-accordion-body').forEach(el => {
            if (el !== this.bodyEl) {
                el.classList.add('hidden');
                el.previousElementSibling.classList.remove('expanded');
            }
        });

        if (isCollapsed) {
            this.bodyEl.classList.remove('hidden');
            this.headerEl.classList.add('expanded');
            // Copy applied to temp selections on expand
            this.tempSelections = new Set(this.appliedSelections);
            this.renderList();
            this.searchEl.focus();
        } else {
            this.bodyEl.classList.add('hidden');
            this.headerEl.classList.remove('expanded');
        }
    }

    renderList() {
        const query = this.searchEl.value.toLowerCase().trim();
        this.listEl.innerHTML = '';

        const filtered = this.allOptions.filter(opt => {
            const valStr = String(opt || '').toLowerCase();
            return valStr.includes(query);
        });

        if (filtered.length === 0) {
            this.listEl.innerHTML = '<div class="filter-no-results">No options found</div>';
            return;
        }

        filtered.forEach(opt => {
            const row = document.createElement('label');
            row.className = 'filter-checkbox-row';

            const isChecked = this.tempSelections.has(opt);

            row.innerHTML = `
                <input type="checkbox" ${isChecked ? 'checked' : ''}>
                <span>${opt}</span>
            `;

            row.querySelector('input').addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.tempSelections.add(opt);
                } else {
                    this.tempSelections.delete(opt);
                }
            });

            this.listEl.appendChild(row);
        });
    }

    selectAll() {
        const query = this.searchEl.value.toLowerCase().trim();
        this.allOptions.forEach(opt => {
            const valStr = String(opt || '').toLowerCase();
            if (valStr.includes(query)) {
                this.tempSelections.add(opt);
            }
        });
        this.renderList();
    }

    clearAll() {
        const query = this.searchEl.value.toLowerCase().trim();
        if (query) {
            // If there's a search query, only clear matching visible items
            this.allOptions.forEach(opt => {
                const valStr = String(opt || '').toLowerCase();
                if (valStr.includes(query)) {
                    this.tempSelections.delete(opt);
                }
            });
        } else {
            this.tempSelections.clear();
        }
        this.renderList();
    }

    cancel() {
        this.tempSelections = new Set(this.appliedSelections);
        this.bodyEl.classList.add('hidden');
        this.headerEl.classList.remove('expanded');
        this.searchEl.value = '';
    }

    apply() {
        this.appliedSelections = new Set(this.tempSelections);
        this.updateBadge();
        this.bodyEl.classList.add('hidden');
        this.headerEl.classList.remove('expanded');
        this.searchEl.value = '';

        if (this.onApply) {
            this.onApply(Array.from(this.appliedSelections));
        }
    }

    updateBadge() {
        const count = this.appliedSelections.size;
        if (count === 0) {
            this.badgeEl.textContent = 'All';
            this.badgeEl.className = 'filter-badge';
        } else {
            this.badgeEl.textContent = `${count} selected`;
            this.badgeEl.className = 'filter-badge active';
        }
    }

    setSelections(selections = []) {
        this.appliedSelections = new Set(selections);
        this.tempSelections = new Set(selections);
        this.updateBadge();
        this.renderList();
    }

    getSelections() {
        return Array.from(this.appliedSelections);
    }

    clear() {
        this.appliedSelections.clear();
        this.tempSelections.clear();
        this.updateBadge();
        this.searchEl.value = '';
        this.renderList();
    }
}

// Export class to global window context
window.MultiSelectFilter = MultiSelectFilter;
