// Token Radar dashboard: board, detail view and filter, no network.
// Reads window.RADAR (written by main.ts from the same board), renders the
// table, and opens a detail view per protocol. Deep links: #detail=<slug>,
// #q=<text>, #tab=live, #watchlist=1.

(function () {
  'use strict';
  var R = window.RADAR;
  if (!R || !Array.isArray(R.rows)) {
    document.getElementById('rows').innerHTML =
      '<tr><td colspan="8">No radar data was loaded.</td></tr>';
    return;
  }

  var watchSet = {};
  (R.watchlist || []).forEach(function (s) { watchSet[s] = true; });

  var state = {
    tab: 'board',
    q: '',
    cat: '',
    chain: '',
    watch: false,
    sortKey: 'rank',
    sortDir: 1,
    selected: null,
  };

  function $(id) { return document.getElementById(id); }

  function money(n) {
    if (n === null || n === undefined) return '--';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }

  function pct(n) {
    if (n === null || n === undefined) return '--';
    var s = (n > 0 ? '+' : '') + n.toFixed(1) + '%';
    return s;
  }

  function pctClass(n) {
    if (n === null || n === undefined) return '';
    return n >= 0 ? 'up' : 'down';
  }

  function ageText(n) {
    if (n === null || n === undefined) return '--';
    if (n >= 365) return (n / 365).toFixed(1) + ' y';
    return n + ' d';
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---- header ----
  var stats = $('stats');
  stats.innerHTML =
    '<div><dt>Protocols in snapshot</dt><dd>' + (R.protocols_total || R.rows.length + R.live_size) + '</dd></div>' +
    '<div><dt>Watchlist</dt><dd>' + R.watchlist_size + '</dd></div>' +
    '<div><dt>Ranked pre-token</dt><dd>' + R.board_size + '</dd></div>' +
    '<div><dt>Early finds below floor</dt><dd>' + R.early_size + '</dd></div>' +
    '<div><dt>Live tokens set aside</dt><dd>' + R.live_size + '</dd></div>';
  $('asof').textContent =
    'Snapshot as of ' + R.as_of + ' · DefiLlama public API, fetched once and frozen · watchlist floor ' + money(R.floor_usd) + '.';

  var m = R.model;
  $('model-list').innerHTML =
    '<li><b>Base:</b> TVL &times; ' + m.base_multiple + ' &mdash; the launch multiple applied to the value already locked in the protocol.</li>' +
    '<li><b>Growth:</b> 7-day TVL change, clamped to ' + m.growth_floor + '%&hellip;' + m.growth_cap + '%, weighted ' + m.growth_weight + ' &mdash; a protocol still compounding is worth more than one shrinking.</li>' +
    '<li><b>Maturity:</b> ' + m.maturity_floor + ' + ' + m.maturity_range + ' &times; min(age, ' + m.maturity_days + ' days) / ' + m.maturity_days + ' &mdash; running longer with no token raises the value, up to ' + (m.maturity_floor + m.maturity_range).toFixed(2) + '&times;.</li>' +
    '<li><b>Breadth:</b> 1 + ' + m.breadth_per_chain + ' per extra chain, up to ' + m.breadth_max_chains + ' extra &mdash; a protocol live on more chains has more surface to launch from.</li>' +
    '<li><b>Unknown age</b> counts as ' + m.unknown_age_days + ' days; unknown 7-day change counts as 0%.</li>';

  // ---- filters ----
  var cats = {};
  var chains = {};
  R.rows.forEach(function (r) {
    if (r.category) cats[r.category] = true;
    (r.chains || []).forEach(function (c) { chains[c] = true; });
  });
  var catSel = $('cat');
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c;
    catSel.appendChild(o);
  });
  var chainSel = $('chain');
  Object.keys(chains).sort().forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c;
    chainSel.appendChild(o);
  });

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return R.rows.filter(function (r) {
      if (state.watch && !watchSet[r.slug]) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function sortVal(r, key) {
    var v = r[key];
    if (key === 'chains') return (r.chains || [])[0] || '';
    if (key === 'change_7d') return v === null ? 0 : v;
    if (key === 'age_days') return v === null ? -1 : v;
    if (typeof v === 'string') return v.toLowerCase();
    return v === null || v === undefined ? '' : v;
  }

  function renderBoard() {
    var rows = filtered();
    var key = state.sortKey;
    var dir = state.sortDir;
    rows.sort(function (a, b) {
      var x = sortVal(a, key);
      var y = sortVal(b, key);
      if (x < y) return -1 * dir;
      if (x > y) return 1 * dir;
      return (a.slug < b.slug ? -1 : 1);
    });
    var html = '';
    rows.forEach(function (r) {
      var sel = state.selected === r.slug ? ' class="selected"' : '';
      html += '<tr data-slug="' + esc(r.slug) + '"' + sel + '>' +
        '<td>' + r.rank + '</td>' +
        '<td><strong>' + esc(r.name) + '</strong><span class="sub">' + esc(r.slug) +
        (watchSet[r.slug] ? ' <span class="badge watch">watchlist</span>' : '') + '</span></td>' +
        '<td>' + esc(r.category || '--') + '</td>' +
        '<td>' + (r.chains || []).slice(0, 2).map(function (c) { return '<span class="badge">' + esc(c) + '</span>'; }).join('') +
        ((r.chains || []).length > 3 ? '<span class="badge">+' + ((r.chains || []).length - 3) + '</span>' : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + pctClass(r.change_7d) + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong></td>' +
        '</tr>';
    });
    $('rows').innerHTML = html || '<tr><td colspan="8">No protocols match the filter.</td></tr>';
    $('count').textContent = rows.length + ' of ' + R.rows.length + ' ranked protocols shown.';
    document.querySelectorAll('#board th[data-sort]').forEach(function (th) {
      th.setAttribute('aria-sort', th.getAttribute('data-sort') === state.sortKey
        ? (state.sortDir === 1 ? 'ascending' : 'descending') : 'none');
    });
  }

  function renderLive() {
    var html = '';
    (R.live || []).forEach(function (p) {
      html += '<tr>' +
        '<td><strong>' + esc(p.name) + '</strong><span class="sub">' + esc(p.slug) + '</span></td>' +
        '<td>' + esc(p.category || '--') + '</td>' +
        '<td>' + (p.chains || []).slice(0, 2).map(function (c) { return '<span class="badge">' + esc(c) + '</span>'; }).join('') + '</td>' +
        '<td class="num">' + money(p.tvl_usd) + '</td>' +
        '<td class="num"><strong>' + money(p.mcap_usd) + '</strong></td>' +
        '<td class="num ' + pctClass(p.change_7d) + '">' + pct(p.change_7d) + '</td>' +
        '</tr>';
    });
    $('live-rows').innerHTML = html;
  }

  // ---- detail view ----
  function splitStep(s) {
    var i = s.indexOf(' Cost: ');
    if (i < 0) return { action: s, cost: '', time: '' };
    var action = s.slice(0, i);
    var rest = s.slice(i + 7);
    var j = rest.indexOf('. Time: ');
    if (j < 0) return { action: action, cost: rest, time: '' };
    return { action: action, cost: rest.slice(0, j), time: rest.slice(j + 8).replace(/\.$/, '') };
  }

  function renderDetail(slug) {
    var r = null;
    for (var i = 0; i < R.rows.length; i++) {
      if (R.rows[i].slug === slug) { r = R.rows[i]; break; }
    }
    var box = $('detail');
    if (!r) { box.hidden = true; state.selected = null; return; }
    state.selected = slug;
    var md = r.model;
    var steps = '';
    (r.farm_steps || []).forEach(function (s) {
      var p = splitStep(s);
      steps += '<li>' + esc(p.action) +
        '<span class="cost">Cost: ' + esc(p.cost) + ' &middot; Time: ' + esc(p.time) + '</span></li>';
    });
    $('detail-body').innerHTML =
      '<h3>' + esc(r.name) + ' <span class="badge">rank #' + r.rank + '</span>' +
      (watchSet[r.slug] ? ' <span class="badge watch">watchlist</span>' : '') + '</h3>' +
      '<p class="meta">' + esc(r.category || 'No category') + ' &middot; ' +
      (r.chains || []).map(esc).join(', ') + ' &middot; TVL ' + money(r.tvl_usd) +
      ' &middot; 7d <span class="' + pctClass(r.change_7d) + '">' + pct(r.change_7d) + '</span>' +
      ' &middot; tracked since ' + (r.listed_at || 'unknown') + ' (' + ageText(r.age_days) + ')' +
      ' &middot; records no token</p>' +
      '<h4>Why rank #' + r.rank + ' &mdash; the model&rsquo;s working</h4>' +
      '<table class="breakdown"><tbody>' +
      '<tr><td>Base: TVL &times; ' + R.model.base_multiple + '</td><td>' + money(md.base_usd) + '</td></tr>' +
      '<tr><td>Growth: ' + (md.growth_pct > 0 ? '+' : '') + md.growth_pct + '% over 7 days</td><td>&times;' + md.growth_multiplier + '</td></tr>' +
      '<tr><td>Maturity: ' + (md.age_days === null ? 'unknown age' : md.age_days + ' days old') + '</td><td>&times;' + md.maturity_multiplier + '</td></tr>' +
      '<tr><td>Breadth: ' + (r.chains || []).length + ' chain' + ((r.chains || []).length === 1 ? '' : 's') + '</td><td>&times;' + md.breadth_multiplier + '</td></tr>' +
      '<tr class="total"><td>Implied value</td><td>' + money(r.implied_value_usd) + '</td></tr>' +
      '</tbody></table>' +
      '<h4>Farm plan &mdash; six steps</h4>' +
      '<ol class="steps">' + steps + '</ol>' +
      '<p class="note">Costs are in US dollars of capital and gas at the time of the snapshot; ' +
      'a farm plan is a plan, not a promise of an airdrop.</p>';
    box.hidden = false;
  }

  // ---- tabs ----
  function setTab(tab) {
    state.tab = tab;
    $('tab-board').classList.toggle('active', tab === 'board');
    $('tab-live').classList.toggle('active', tab === 'live');
    $('board-panel').hidden = tab !== 'board';
    $('live-panel').hidden = tab !== 'live';
    if (tab === 'live') renderLive();
  }
  $('tab-board').addEventListener('click', function () { setTab('board'); });
  $('tab-live').addEventListener('click', function () { setTab('live'); });

  // ---- controls ----
  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  $('cat').addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  $('watch').addEventListener('change', function (e) { state.watch = e.target.checked; renderBoard(); });
  document.querySelectorAll('#board th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (state.sortKey === k) state.sortDir = -state.sortDir;
      else { state.sortKey = k; state.sortDir = 1; }
      renderBoard();
    });
  });
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (!tr) return;
    renderDetail(tr.getAttribute('data-slug'));
    renderBoard();
    $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    try { history.replaceState(null, '', '#detail=' + tr.getAttribute('data-slug')); } catch (err) { /* no history */ }
  });
  $('back').addEventListener('click', function (e) {
    e.preventDefault();
    $('detail').hidden = true;
    state.selected = null;
    renderBoard();
    try { history.replaceState(null, '', '#board'); } catch (err) { /* no history */ }
  });

  // ---- deep links: #detail=<slug>, #q=<text>, #tab=live, #watchlist=1 ----
  function fromHash() {
    var h = (window.location.hash || '').replace(/^#/, '');
    var parts = h.split('&');
    parts.forEach(function (part) {
      var kv = part.split('=');
      var k = kv[0];
      var v = kv[1] ? decodeURIComponent(kv[1]) : '';
      if (k === 'detail' && v) renderDetail(v);
      if (k === 'q' && v) { state.q = v; $('q').value = v; }
      if (k === 'tab' && (v === 'live' || v === 'board')) setTab(v);
      if (k === 'watchlist' && v === '1') { state.watch = true; $('watch').checked = true; }
    });
  }

  renderBoard();
  renderLive();
  fromHash();
  renderBoard();
  if (state.selected) renderDetail(state.selected);
})();
