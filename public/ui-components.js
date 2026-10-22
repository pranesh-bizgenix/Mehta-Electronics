/* Network-free UI components. Do not put business rules or connector handlers here. */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const button = (text, action, className = 'secondary') => {
  const element = node('button', className, text);
  element.type = 'button';
  element.addEventListener('click', action);
  return element;
};
const descriptions = {
  dashboard: 'A clear view of your business, grounded in Tally.',
  customers: 'Relationships, contacts and customer records in one place.',
  items: 'Find the right part. Keep every detail within reach.',
  enquiries: 'Turn incoming requirements into your next opportunity.',
  quotations: 'Clear proposals. Confident conversations.',
  orders: 'Every commitment, from confirmation to completion.',
  users: 'Your team, with the right access.',
  tally: 'Review imported records and reconciliation.',
  'tally-connector': 'Connection status and existing connector controls.',
  audit: 'A traceable history of activity across your workspace.'
};

export class Sidebar {
  constructor() {
    const paths = {
      dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
      customers: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M20 8v6 M17 11h6',
      items: 'M12 3 3 8v9l9 5 9-5V8z M3 8l9 5 9-5 M12 13v9 M7 5l10 6',
      enquiries: 'M4 3h16v14H9l-5 4z M8 7h8 M8 11h5',
      quotations: 'M6 2h9l4 4v16H6z M14 2v5h5 M9 11h7 M9 15h7 M9 19h4',
      orders: 'M3 5h18l-2 10H6z M3 2v3 M8 21h.01 M17 21h.01 M6 15l-1 3h14',
      users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M17 4a4 4 0 0 1 0 8 M22 21v-3a4 4 0 0 0-3-3',
      tally: 'M4 4v16h17 M8 15v-4 M13 15V7 M18 15v-6',
      'tally-connector': 'M8 2v6 M16 2v6 M5 8h14v3a7 7 0 0 1-14 0z M12 18v4',
      audit: 'M9 3H5v19h15V3h-4 M9 2h7v4H9z M8 11h8 M8 15h8 M8 19h5'
    };
    const groups = { dashboard: 'Workspace', customers: 'Sales & relationships', users: 'Administration', tally: 'Tally · Read only' };
    $$('#nav button[data-view]').forEach(item => {
      const key = item.dataset.view;
      item.setAttribute('aria-label', item.textContent.trim());
      if (groups[key]) {
        const label = node('div', 'nav-group-label', groups[key]);
        label.dataset.groupStart = key;
        item.before(label);
      }
      const icon = node('span', 'nav-icon');
      icon.setAttribute('aria-hidden', 'true');
      // Paths come from this fixed local icon set, never from imported data.
      icon.innerHTML = `<svg viewBox="0 0 24 24"><path d="${paths[key] || paths.items}"/></svg>`;
      item.prepend(icon);
    });
    const scrim = button('', () => this.close(), 'nav-scrim');
    scrim.setAttribute('aria-label', 'Close navigation');
    scrim.hidden = true;
    $('#app').append(scrim);
    this.scrim = scrim;
    $('#menu-toggle').addEventListener('click', () => this.toggle());
    matchMedia('(min-width: 761px)').addEventListener('change', event => { if (event.matches) this.close(false); });
    $('#nav').addEventListener('click', event => {
      if (event.target.closest('button[data-view]')) this.close(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && $('#app').classList.contains('nav-open')) this.close();
      if (event.key !== 'Tab' || !$('#app').classList.contains('nav-open')) return;
      const stops = $$('button:not(.hidden),a[href]', $('.sidebar')).filter(el => el.offsetParent !== null);
      const first = stops[0], last = stops.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
    new MutationObserver(() => {
      $$('#nav button[data-view]').forEach(item => item.setAttribute('aria-current', item.classList.contains('active') ? 'page' : 'false'));
      $$('.nav-group-label').forEach(label => {
        let next = label.nextElementSibling, visible = false;
        while (next && !next.classList.contains('nav-group-label')) {
          if (next.matches('button:not(.hidden)')) visible = true;
          next = next.nextElementSibling;
        }
        label.hidden = !visible;
      });
    }).observe($('#nav'), { subtree: true, attributes: true, attributeFilter: ['class'] });
  }
  toggle() {
    if ($('#app').classList.contains('nav-open')) return this.close();
    $('#app').classList.add('nav-open');
    $('#menu-toggle').setAttribute('aria-expanded', 'true');
    this.scrim.hidden = false;
    $('.content').inert = true;
    $('#nav button:not(.hidden)')?.focus();
  }
  close(restore = true) {
    const wasOpen = $('#app').classList.contains('nav-open');
    $('#app').classList.remove('nav-open');
    $('#menu-toggle').setAttribute('aria-expanded', 'false');
    this.scrim.hidden = true;
    $('.content').inert = false;
    if (wasOpen && restore) $('#menu-toggle').focus();
    if (wasOpen && !restore) $('#view').focus({ preventScroll: true });
  }
}

export class PageHeader {
  update() {
    const view = $('#nav button.active')?.dataset.view || 'dashboard';
    $('#page-description').textContent = descriptions[view] || '';
  }
}

export class DataTable {
  constructor(table) {
    this.table = table;
    this.rows = [...table.tBodies[0]?.rows || []].filter(row => !row.querySelector('.empty'));
    this.page = 1;
    this.direction = 1;
    this.query = '';
    const title = $('#page-title').textContent;
    const wrap = table.closest('.table-wrap');
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', `${title} table, scroll for more columns`);
    const tools = node('div', 'data-tools');
    const filter = node('input');
    filter.type = 'search';
    filter.placeholder = 'Filter loaded rows…';
    filter.setAttribute('aria-label', `Filter loaded ${title} rows`);
    filter.addEventListener('input', () => { this.query = filter.value.toLocaleLowerCase(); this.page = 1; this.render(); });
    this.count = node('span', 'data-scope');
    this.count.setAttribute('role', 'status');
    const picker = node('details', 'column-picker');
    picker.append(node('summary', 'secondary', 'Columns'));
    const menu = node('div', 'column-menu');
    picker.append(menu);
    [...table.tHead?.rows[0]?.cells || []].forEach((cell, index) => {
      const label = cell.textContent.trim();
      if (!label) return;
      const check = node('input');
      check.type = 'checkbox'; check.checked = true;
      const entry = node('label'); entry.append(check, document.createTextNode(label)); menu.append(entry);
      check.addEventListener('change', () => {
        // Keep at least one named column visible.
        const checked = $$('input:checked', menu);
        if (!checked.length) { check.checked = true; return; }
        [...table.rows].forEach(row => { if (row.cells[index]) row.cells[index].hidden = !check.checked; });
      });
      // Existing master-table sorting retains its original API handler.
      if (cell.querySelector('button,a,input') || this.rows.some(row => row.cells[index]?.querySelector('button,a,input'))) return;
      const sort = button(label, () => this.sort(index), 'table-sort');
      const indicator = node('span', 'sort-indicator', '↕');
      indicator.setAttribute('aria-hidden', 'true'); sort.append(indicator);
      cell.replaceChildren(sort); cell.setAttribute('aria-sort', 'none');
      sort.setAttribute('aria-label', `Sort loaded rows by ${label}`);
    });
    picker.addEventListener('keydown', event => { if (event.key === 'Escape') { picker.open = false; $('summary', picker).focus(); } });
    tools.append(filter, this.count, picker); wrap.before(tools);
    this.empty = node('div', 'data-empty', 'No loaded rows match your filter. Try another term.');
    this.empty.hidden = true; wrap.after(this.empty);
    this.pager = node('div', 'data-pagination');
    this.prev = button('Previous rows', () => { this.page--; this.render(); });
    this.next = button('Next rows', () => { this.page++; this.render(); });
    this.pageLabel = node('span');
    this.pager.append(this.prev, this.pageLabel, this.next); this.empty.after(this.pager);
    this.render();
  }
  sort(index) {
    this.direction = this.sortIndex === index ? -this.direction : 1;
    this.sortIndex = index;
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const value = row => row.cells[index]?.textContent.trim() || '';
    const number = text => /^[-+₹$€£\d,.%\s]+$/.test(text) && /\d/.test(text) ? Number(text.replace(/[^\d.+-]/g, '')) : null;
    this.rows.sort((a, b) => {
      const left = value(a), right = value(b), ln = number(left), rn = number(right);
      return this.direction * (ln !== null && rn !== null ? ln - rn : collator.compare(left, right));
    });
    this.rows.forEach(row => this.table.tBodies[0].append(row));
    [...this.table.tHead.rows[0].cells].forEach((cell, i) => {
      if (!cell.hasAttribute('aria-sort')) return;
      cell.setAttribute('aria-sort', i === index ? (this.direction === 1 ? 'ascending' : 'descending') : 'none');
      const indicator = $('.sort-indicator', cell);
      if (indicator) indicator.textContent = i === index ? (this.direction === 1 ? '↑' : '↓') : '↕';
    });
    this.render();
  }
  render() {
    const matches = this.rows.filter(row => row.textContent.toLocaleLowerCase().includes(this.query));
    const pages = Math.max(1, Math.ceil(matches.length / 20));
    this.page = Math.min(pages, Math.max(1, this.page));
    const visible = new Set(matches.slice((this.page - 1) * 20, this.page * 20));
    this.rows.forEach(row => { row.hidden = !visible.has(row); });
    this.count.textContent = `${matches.length} of ${this.rows.length} loaded rows · local filter`;
    this.empty.hidden = !!matches.length || !this.rows.length;
    this.pager.hidden = matches.length <= 20;
    this.prev.disabled = this.page === 1; this.next.disabled = this.page === pages;
    this.pageLabel.textContent = `Loaded rows ${this.page} / ${pages}`;
  }
}

// Small reusable primitives for existing markup and future screens.
export const StatCard = { enhance: root => $$('.card,.ov-stat', root).forEach(el => el.classList.add('ui-stat-card')) };
export const StatusBadge = { enhance: root => $$('.status', root).forEach(el => el.classList.add('ui-status-badge')) };
export const FormField = { enhance: root => {
  $$('input,select,textarea', root).forEach((input, index) => {
    if (!input.getAttribute('aria-label') && !input.labels?.length) {
      input.setAttribute('aria-label', input.placeholder || input.name || `Field ${index + 1}`);
    }
  });
} };
export const Modal = { enhance: dialog => { if (dialog) dialog.setAttribute('aria-modal', 'true'); } };
export const Toast = { enhance: element => {
  element.setAttribute('aria-atomic', 'true');
  element.setAttribute('role', element.classList.contains('bad') ? 'alert' : 'status');
} };
export class Tabs {
  constructor(root) {
    const tabs = $$('[role=tab]', root);
    root.classList.add('ui-tabs'); root.setAttribute('role', 'tablist');
    const select = tab => tabs.forEach(item => {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected)); item.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(item.getAttribute('aria-controls'));
      if (panel) { panel.hidden = !selected; panel.setAttribute('role', 'tabpanel'); }
    });
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => select(tab));
      tab.addEventListener('keydown', event => {
        const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : null;
        if (next) { event.preventDefault(); next.focus(); select(next); }
      });
    });
    if (tabs.length) select(tabs.find(tab => tab.getAttribute('aria-selected') === 'true') || tabs[0]);
  }
}
export function ConfirmDialog({ title, message, confirmLabel = 'Continue' }) {
  return new Promise(resolve => {
    const dialog = node('dialog'), heading = node('h2', '', title), content = node('p', '', message);
    heading.id = 'confirmation-title'; dialog.setAttribute('aria-labelledby', heading.id);
    const body = node('div', 'detail'), actions = node('div', 'detail-actions');
    const cancel = button('Cancel', () => { dialog.returnValue = 'cancel'; dialog.close(); });
    const confirm = button(confirmLabel, () => { dialog.returnValue = 'confirm'; dialog.close(); }, 'primary');
    actions.append(cancel, confirm); body.append(heading, content, actions); dialog.append(body); document.body.append(dialog);
    dialog.addEventListener('close', () => { const accepted = dialog.returnValue === 'confirm'; dialog.remove(); resolve(accepted); }, { once: true });
    dialog.showModal(); cancel.focus();
  });
}

export class AppShell {
  constructor() {
    this.sidebar = new Sidebar(); this.header = new PageHeader();
    const theme = $('#theme-toggle');
    const media = matchMedia('(prefers-color-scheme: dark)');
    let preference;
    try { preference = localStorage.getItem('mehta-theme'); } catch { /* Storage can be disabled. */ }
    const applyTheme = dark => {
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      theme.textContent = dark ? 'Light mode' : 'Dark mode';
      theme.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} mode`);
      theme.setAttribute('aria-pressed', String(dark));
    };
    applyTheme(preference ? preference === 'dark' : media.matches);
    media.addEventListener('change', event => { if (!preference) applyTheme(event.matches); });
    theme.addEventListener('click', () => {
      const dark = document.documentElement.dataset.theme !== 'dark';
      preference = dark ? 'dark' : 'light'; applyTheme(dark);
      try { localStorage.setItem('mehta-theme', preference); } catch { /* Session-only theme still works. */ }
    });
    this.enhanced = new WeakSet();
    const enhance = () => {
      this.header.update();
      const root = $('#view');
      // Frozen Connector screen: CSS only. Do not enhance, reorder or intercept its controls.
      if ($('#nav button.active')?.dataset.view !== 'tally-connector') {
        $$('.table-wrap table', root).forEach(table => {
          if (this.enhanced.has(table)) return;
          this.enhanced.add(table); new DataTable(table);
        });
        StatCard.enhance(root); StatusBadge.enhance(root); FormField.enhance(root);
      }
    };
    let scheduled = false;
    new MutationObserver(records => {
      const replaced = records.some(record => record.target === $('#view') && record.type === 'childList');
      if (replaced) this.finish();
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(() => { scheduled = false; enhance(); });
      }
    }).observe($('#view'), { childList: true, subtree: true });
    document.addEventListener('click', event => {
      const target = event.target.closest('button');
      if (!target || target.disabled) return;
      const destination = target.dataset.view;
      if (destination === 'tally-connector' || (!destination && $('#nav button.active')?.dataset.view === 'tally-connector')) { this.finish(); return; }
      if (destination || target.matches('#customer-go,#item-go,#enquiry-go,#quotation-go,#order-go,#tally-master-go,.pager-prev,.pager-next')) this.loading();
    }, true);
    new MutationObserver(() => {
      const toast = $('#toast'); Toast.enhance(toast);
      if (toast.classList.contains('show') && toast.classList.contains('bad') && this.pending) this.error(toast.textContent);
    }).observe($('#toast'), { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(() => { FormField.enhance($('#modal')); Modal.enhance($('#modal')); }).observe($('#modal-body'), { childList: true });
    // Initial authenticated page load also gets a skeleton, without wrapping fetch.
    new MutationObserver(() => {
      if (!$('#app').classList.contains('hidden') && !$('#view').children.length) this.loading();
    }).observe($('#app'), { attributes: true, attributeFilter: ['class'] });
    enhance();
  }
  loading() {
    this.finish(); this.pending = true;
    const feedback = $('#page-feedback');
    feedback.hidden = false; feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-label', 'Loading page');
    const grid = node('div', 'loading-grid');
    for (let i = 0; i < 3; i++) { const skeleton = node('div', 'skeleton'); skeleton.setAttribute('aria-hidden', 'true'); grid.append(skeleton); }
    const wide = node('div', 'skeleton skeleton-wide'); wide.setAttribute('aria-hidden', 'true');
    feedback.replaceChildren(grid, wide); $('#view').setAttribute('aria-busy', 'true');
    this.timer = setTimeout(() => { if (this.pending) this.error('This page is taking longer than expected. You can try again.'); }, 20000);
  }
  finish() {
    this.pending = false; clearTimeout(this.timer);
    $('#page-feedback').hidden = true; $('#page-feedback').replaceChildren(); $('#view').removeAttribute('aria-busy');
  }
  error(message) {
    this.finish();
    const feedback = $('#page-feedback'), error = node('div', 'feedback-error');
    feedback.hidden = false; feedback.setAttribute('role', 'alert'); feedback.removeAttribute('aria-label');
    error.append(node('h2', '', 'We couldn’t load this view'), node('p', '', message), button('Try again', () => $('#nav button.active')?.click()));
    feedback.replaceChildren(error);
  }
}

if ($('#theme-toggle') && $('#menu-toggle')) new AppShell();
