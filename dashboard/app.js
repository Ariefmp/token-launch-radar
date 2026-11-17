// Token Radar dashboard: board, detail view and filter, no network.
// Reads window.RADAR (written by main.ts from the same board), renders the
// table, and opens a detail view per protocol. Deep links: #detail=<slug>,
// #q=<text>, #cat=<name>, #tab=live, #watchlist=1, #growing=1.

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
    growing: false,
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
    '<li><b>Growth:</b> 7-day TVL change, clamped to ' + m.growth_floor + '%&hellip;' + m.growth_cap + '%, raised to the power ' + m.growth_exponent + ' &mdash; gentle near zero, sharp at the extremes: a protocol compounding hard is worth much more, one collapsing much less.</li>' +
    '<li><b>Maturity:</b> ' + m.maturity_floor + ' + ' + m.maturity_range + ' &times; the square root of min(age, ' + m.maturity_days + ' days) / ' + m.maturity_days + ' &mdash; the first year with no token is the strongest signal; later years add less, up to ' + (m.maturity_floor + m.maturity_range).toFixed(2) + '&times;.</li>' +
    '<li><b>Breadth:</b> 1 + ' + m.breadth_per_chain + ' per extra chain, up to ' + m.breadth_max_chains + ' extra &mdash; a protocol live on more chains has more surface to launch from.</li>' +
    '<li><b>Category:</b> &times;' + m.category_native + ' for token-native models (lending, exchanges, derivatives, yield, RWA and the like), &times;' + m.category_unlikely + ' for models that rarely carry a token (chains, stablecoin issuers, token lockers, BTC wrappers), &times;1.00 for the rest.</li>' +
    '<li><b>Dominance:</b> &times;' + m.dominance_first + ' for the largest pre-token protocol in its category by TVL (in a category of three or more), &times;' + m.dominance_top3 + ' for 2nd and 3rd, &times;1.00 for the rest &mdash; the category leader is the category&rsquo;s most likely next launch; a leader of two takes &times;' + m.dominance_top3 + ' and a lone protocol &times;1.00, because leadership means beating peers.</li>' +
    '<li><b>Data quality:</b> &times;' + m.data_quality_unknown_growth + ' when the 7-day change is missing, &times;' + m.data_quality_unknown_age + ' when the listing date is missing &mdash; what the snapshot cannot measure is worth less than what it can.</li>' +
    '<li><b>Unknown age</b> counts as ' + m.unknown_age_days + ' days and takes the data-quality discount; unknown 7-day change counts as 0% and takes it too.</li>';

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
      if (state.growing && !(r.change_7d !== null && r.change_7d > 0)) return false;
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
        ((r.chains || []).length > 2 ? '<span class="badge">+' + ((r.chains || []).length - 2) + '</span>' : '') + '</td>' +
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

  // ---- value spread and categories ----
  function renderSpread() {
    var buckets = [
      { label: 'under $1M', test: function (v) { return v < 1e6; } },
      { label: '$1M – $10M', test: function (v) { return v >= 1e6 && v < 1e7; } },
      { label: '$10M – $50M', test: function (v) { return v >= 1e7 && v < 5e7; } },
      { label: '$50M – $100M', test: function (v) { return v >= 5e7 && v < 1e8; } },
      { label: '$100M – $500M', test: function (v) { return v >= 1e8 && v < 5e8; } },
      { label: 'over $500M', test: function (v) { return v >= 5e8; } },
    ];
    var counts = buckets.map(function () { return 0; });
    var total = 0;
    R.rows.forEach(function (r) {
      total += r.implied_value_usd;
      for (var i = 0; i < buckets.length; i++) {
        if (buckets[i].test(r.implied_value_usd)) { counts[i]++; break; }
      }
    });
    var max = Math.max.apply(null, counts.concat([1]));
    var html = '';
    buckets.forEach(function (b, i) {
      var w = Math.round((counts[i] / max) * 100);
      html += '<div class="dist-row"><span class="dist-label">' + b.label + '</span>' +
        '<span class="dist-bar"><span style="width:' + w + '%"></span></span>' +
        '<span class="dist-count">' + counts[i] + '</span></div>';
    });
    $('dist').innerHTML = html;
    var top10 = R.rows.slice(0, 10).reduce(function (n, r) { return n + r.implied_value_usd; }, 0);
    var median = R.rows[Math.floor(R.rows.length / 2)].implied_value_usd;
    $('concentration').textContent = 'The top 10 protocols hold ' +
      Math.round((top10 / total) * 100) + '% of the board\u2019s ' + money(total) +
      ' of total implied value; the median protocol is worth ' + money(median) + '.';
  }

  function renderCats() {
    var byCat = {};
    R.rows.forEach(function (r) {
      var c = r.category || 'No category';
      if (!byCat[c]) byCat[c] = { n: 0, total: 0 };
      byCat[c].n++;
      byCat[c].total += r.implied_value_usd;
    });
    var list = Object.keys(byCat).map(function (c) {
      return { name: c, n: byCat[c].n, total: byCat[c].total };
    }).sort(function (a, b) { return b.total - a.total; }).slice(0, 10);
    var total = R.rows.reduce(function (n, r) { return n + r.implied_value_usd; }, 0);
    $('cat-rows').innerHTML = list.map(function (c) {
      return '<tr><td><strong>' + esc(c.name) + '</strong></td>' +
        '<td class="num">' + c.n + '</td>' +
        '<td class="num"><strong>' + money(c.total) + '</strong></td>' +
        '<td class="num">' + (100 * c.total / total).toFixed(1) + '%</td></tr>';
    }).join('');
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

  function riskFlags(r) {
    var flags = [];
    if (r.change_7d !== null && r.change_7d < -20) {
      flags.push('TVL fell ' + Math.abs(r.change_7d).toFixed(1) + '% in 7 days — the protocol is shrinking fast.');
    } else if (r.change_7d !== null && r.change_7d < 0) {
      flags.push('TVL fell ' + Math.abs(r.change_7d).toFixed(1) + '% in 7 days.');
    }
    if (r.age_days === null) {
      flags.push('Age unknown — the snapshot carries no listing date, so maturity is estimated at ' + R.model.unknown_age_days + ' days.');
    }
    if (r.model.data_quality_multiplier < 1) {
      flags.push('The snapshot is missing a figure for this protocol, so the model discounts it for the gap.');
    }
    if ((r.chains || []).length <= 1) {
      flags.push('Live on a single chain — a launch has only one chain to land on.');
    }
    if (r.model.category_group === 'unlikely') {
      flags.push('Category (' + (r.category || 'none') + ') rarely carries a token.');
    }
    if (r.model.stale_multiplier < 1) {
      flags.push('Stale: over two years old and still shrinking — the launch window may have passed.');
    }
    return flags;
  }

  function peers(r) {
    var same = R.rows.filter(function (x) { return x.category === r.category && x.slug !== r.slug; });
    var above = same.filter(function (x) { return x.rank < r.rank; }).slice(-2);
    var below = same.filter(function (x) { return x.rank > r.rank; }).slice(0, 2);
    return above.concat(below);
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
    var flags = riskFlags(r);
    var near = peers(r);
    var staleRow = md.stale_multiplier < 1
      ? '<tr><td>Stale: over ' + R.model.stale_age_days + ' days old and shrinking ' + (md.growth_pct > 0 ? '+' : '') + md.growth_pct + '%</td><td>&times;' + md.stale_multiplier + '</td></tr>'
      : '';
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
      '<tr><td>Category: ' + esc(r.category || 'no category') + ' (' + md.category_group + ')</td><td>&times;' + md.category_multiplier + '</td></tr>' +
      '<tr><td>Dominance: #' + md.dominance_rank + ' of ' + md.category_size + ' in ' + esc(r.category || 'this category') + ' by TVL</td><td>&times;' + md.dominance_multiplier + '</td></tr>' +
      (md.data_quality_multiplier < 1
        ? '<tr><td>Data quality: ' + (r.change_7d === null ? '7-day change missing' : '') + (r.change_7d === null && r.age_days === null ? ' and ' : '') + (r.age_days === null ? 'listing date missing' : '') + '</td><td>&times;' + md.data_quality_multiplier + '</td></tr>'
        : '') +
      staleRow +
      '<tr class="total"><td>Implied value</td><td>' + money(r.implied_value_usd) + '</td></tr>' +
      '</tbody></table>' +
      '<h4>What could be wrong</h4>' +
      (flags.length
        ? '<ul class="flags">' + flags.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>'
        : '<p class="note">No red flags in the snapshot: TVL is not collapsing, the age is known, and the category carries tokens.</p>') +
      '<h4>Nearest peers in ' + esc(r.category || 'this category') + '</h4>' +
      (near.length
        ? '<ul class="peers">' + near.map(function (p) {
            return '<li><a href="#" data-slug="' + esc(p.slug) + '">#' + p.rank + ' ' + esc(p.name) + '</a> &mdash; ' + money(p.implied_value_usd) + '</li>';
          }).join('') + '</ul>'
        : '<p class="note">No other ranked protocol shares this category.</p>') +
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
  $('growing').addEventListener('change', function (e) { state.growing = e.target.checked; renderBoard(); });
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
  $('detail-body').addEventListener('click', function (e) {
    var a = e.target.closest('a[data-slug]');
    if (!a) return;
    e.preventDefault();
    renderDetail(a.getAttribute('data-slug'));
    renderBoard();
    $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    try { history.replaceState(null, '', '#detail=' + a.getAttribute('data-slug')); } catch (err) { /* no history */ }
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
      if (k === 'cat' && v) { state.cat = v; $('cat').value = v; }
      if (k === 'growing' && v === '1') { state.growing = true; $('growing').checked = true; }
      if (k === 'tab' && (v === 'live' || v === 'board')) setTab(v);
      if (k === 'watchlist' && v === '1') { state.watch = true; $('watch').checked = true; }
    });
  }

  renderBoard();
  renderLive();
  renderSpread();
  renderCats();
  fromHash();
  renderBoard();
  if (state.selected) renderDetail(state.selected);
})();
