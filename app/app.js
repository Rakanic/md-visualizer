/* mdviz app — views over the document model built by core.js */
(() => {
  'use strict';
  const MDV = window.MDV;
  const MK = window.marked;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SVGNS = 'http://www.w3.org/2000/svg';

  const KINDS = {
    decision: { label: 'Decision', icon: '◆' },
    finding: { label: 'Finding', icon: '●' },
    result: { label: 'Result', icon: '▲' },
    open: { label: 'Open', icon: '○' },
    caveat: { label: 'Caveat', icon: '!' },
  };
  const KORDER = MDV.KIND_ORDER;
  const ETYPES = { file: 'Files', param: 'Parameters', symbol: 'Symbols', env: 'Env / constants', command: 'Commands' };
  const VIEW_NAMES = { timeline: 'Timeline', system: 'System', decisions: 'Decisions', overview: 'Overview', map: 'Map', board: 'Board', data: 'Data', graph: 'Graph', slides: 'Slides', read: 'Read' };
  // project logs get a focused set of views; everything else sits under "More"
  function viewSets() {
    if (S.docs.some((d) => d.log && S.active.has(d.name))) return { primary: ['timeline', 'system', 'decisions', 'slides', 'read'], more: ['overview', 'map', 'board', 'data', 'graph'] };
    return { primary: ['overview', 'map', 'timeline', 'board', 'data', 'slides', 'read'], more: ['graph'] };
  }
  const allViews = () => { const v = viewSets(); return v.primary.concat(v.more); };
  const docColor = (i) => `var(--s${(i % 8) + 1})`;
  // running inside the macOS app (macos/MDViz.swift): files, saving and printing go through the host
  const NATIVE = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.mdviz;
  const host = (msg) => NATIVE.postMessage(msg);

  const store = {
    get(k, d) { try { const v = localStorage.getItem('mdviz.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('mdviz.' + k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } },
  };

  const S = {
    raw: [], docs: [], active: new Set(), view: 'overview', q: '',
    collapsed: null, xrefs: true, pz: {},
    graph: { types: new Set(['file', 'param', 'symbol', 'env']), min: 2, sections: true },
    board: { kinds: new Set(KORDER), sort: 'doc' },
    tableUI: {}, slide: 0, drawer: null, printing: null,
  };

  // ---------- markdown rendering ----------
  function sanitize(html) {
    const t = document.createElement('template');
    t.innerHTML = html;
    t.content.querySelectorAll('script,iframe,object,embed,style,link,meta,base,form').forEach((n) => n.remove());
    t.content.querySelectorAll('*').forEach((n) => {
      for (const a of [...n.attributes]) if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
    });
    return t.innerHTML;
  }
  const inline = (md) => sanitize(MK.parseInline(String(md || '').replace(/\n/g, ' ')));
  const blockHtml = (md) => sanitize(MK.parse(md || ''));
  const hl = (html) => {
    if (!S.q) return html;
    const re = new RegExp('(' + S.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return html.replace(/(^|>)([^<]+)/g, (m, a, txt) => a + txt.replace(re, '<mark>$1</mark>'));
  };
  const matches = (...texts) => !S.q || texts.some((t) => String(t || '').toLowerCase().includes(S.q));

  // ---------- lookup ----------
  const activeDocs = () => S.docs.filter((d) => S.active.has(d.name));
  const docOf = (id) => S.docs[parseInt(/^d(\d+)/.exec(id)[1], 10)];
  const sec = (id) => docOf(id).byId[id];
  const secLabel = (s) => (s.level === 0 ? docOf(s.id).title : (s.num ? '§' + s.num + ' ' : '') + s.title);
  const shortLabel = (s, n = 34) => { const t = secLabel(s); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const fmtDate = (iso, opts) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, Object.assign({ timeZone: 'UTC', month: 'short', day: 'numeric' }, opts));
  };
  const glyphs = (kinds, extra) => {
    const parts = KORDER.filter((k) => kinds[k]).map((k) => `<span title="${KINDS[k].label}"><i style="color:var(--k-${k})">${KINDS[k].icon}</i>${kinds[k]}</span>`);
    if (extra) parts.push(extra);
    return parts.length ? `<span class="glyphs">${parts.join('')}</span>` : '';
  };
  const kindTag = (k) => `<span class="kind"><i style="color:var(--k-${k})">${KINDS[k].icon}</i>${KINDS[k].label}</span>`;
  const secChip = (s, n) => `<span class="chip" data-sec="${s.id}" title="${esc(secLabel(s))}">${S.active.size > 1 ? `<span class="dot" style="background:${docColor(docOf(s.id).index)}"></span>` : ''}${esc(shortLabel(s, n || 30))}</span>`;

  // ---------- tooltip ----------
  const tip = $('#tip');
  function showTip(e, html) {
    tip.innerHTML = html;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = Math.max(8, y) + 'px';
  }
  const hideTip = () => { tip.hidden = true; };

  // ---------- loading ----------
  function setDocs(raw, keepActive) {
    S.raw = raw;
    S.docs = raw.map((r, i) => MDV.parseDoc(r.name, r.text, i));
    if (!keepActive) S.active = new Set(raw.map((r) => r.name));
    else S.active = new Set([...S.active].filter((n) => raw.some((r) => r.name === n)));
    S.collapsed = null;
    const total = raw.reduce((a, r) => a + r.text.length, 0);
    store.set('docs', total < 4e6 ? raw : []);
    store.set('active', [...S.active]);
  }
  // only: show just these documents (earlier ones stay in the sidebar, unchecked)
  function addDocs(items, opts) {
    if (!items || !items.length) return;
    const raw = S.raw.filter((r) => !items.some((x) => x.name === r.name)).concat(items);
    const prev = opts && opts.only ? new Set() : new Set(S.active);
    setDocs(raw, true);
    S.active = new Set();
    prev.forEach((n) => S.active.add(n));
    items.forEach((x) => S.active.add(x.name));
    store.set('active', [...S.active]);
    if (!viewSets().primary.includes(S.view)) S.view = viewSets().primary[0];
    const added = S.docs.find((d) => d.log && items.some((x) => x.name === d.name));
    if (added) { S.project = added.name; S.view = 'timeline'; }
    render();
  }
  const pickFiles = () => (NATIVE ? host({ type: 'open' }) : $('#file').click());
  function addFiles(list) {
    const files = [...list].filter((f) => /\.(md|markdown|mdx|txt)$/i.test(f.name) || f.type === 'text/markdown');
    if (!files.length) return;
    Promise.all(files.map((f) => f.text().then((text) => ({ name: f.name, text })))).then((items) => {
      const raw = S.raw.filter((r) => !items.some((x) => x.name === r.name)).concat(items);
      const prev = new Set(S.active);
      setDocs(raw, true);
      prev.forEach((n) => S.active.add(n));
      items.forEach((x) => S.active.add(x.name));
      store.set('active', [...S.active]);
      const added = S.docs.find((d) => d.log && items.some((x) => x.name === d.name));
      if (added) { S.project = added.name; S.view = 'timeline'; }
      render();
    });
  }

  // ---------- chrome ----------
  function renderTabs() {
    const { primary, more } = viewSets();
    $('#tabs').innerHTML = primary.map((k) => `<button role="tab" data-view="${k}" aria-selected="${S.view === k}">${VIEW_NAMES[k]}</button>`).join('');
    const inMore = more.includes(S.view);
    $('#more').innerHTML = more.length ? `<button class="more-btn ${inMore ? 'on' : ''}" data-more="1">${inMore ? VIEW_NAMES[S.view] : 'More'} ▾</button>
      <div class="menu-pop" hidden>${more.map((k) => `<button data-view="${k}">${VIEW_NAMES[k]}</button>`).join('')}</div>` : '';
  }
  function renderSide() {
    $('#doclist').innerHTML = S.docs.map((d) => {
      const st = MDV.stats(d);
      return `<li><label><input type="checkbox" data-doc="${esc(d.name)}" ${S.active.has(d.name) ? 'checked' : ''}>
        <span class="dot" style="background:${docColor(d.index)}"></span>
        <span style="min-width:0"><div class="nm" title="${esc(d.name)}">${esc(d.name)}</div><div class="sub">${st.sections} sections · ${st.words.toLocaleString()} words</div></span></label>
        <button class="rm" data-rm="${esc(d.name)}" title="Remove">✕</button></li>`;
    }).join('') || '<li class="meta">No documents yet.</li>';
  }
  function setView(v) {
    if (!allViews().includes(v)) v = viewSets().primary[0];
    S.view = v;
    store.set('view', v);
    if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
    render();
  }

  function render() {
    renderTabs();
    renderSide();
    const main = $('#main');
    main.innerHTML = '';
    main.scrollTop = 0;
    hideTip();
    const docs = activeDocs();
    if (!S.docs.length) return viewEmpty(main);
    if (!docs.length) { main.innerHTML = '<div class="view"><p class="empty-note">Check a document on the left to see it.</p></div>'; return; }
    if (!allViews().includes(S.view)) S.view = viewSets().primary[0];
    renderTabs();
    const proj = docs.some((d) => d.log);
    ({ overview: viewOverview, map: viewMap, timeline: proj ? viewProject : viewTimeline, board: viewBoard, data: viewData, graph: viewGraph,
      slides: viewSlides, read: viewRead, system: viewSystem, decisions: viewDecisions })[S.view](main, docs);
  }

  function viewEmpty(main) {
    main.innerHTML = `<div class="hero">
      <h1>Turn long markdown into something you can see.</h1>
      <p>Drop one or more <code>.md</code> files, such as plans, design docs, research logs, or reports written by Claude. mdviz parses the structure and gives you a map, a timeline, a decision board, charts from every numeric table, a reference graph, slides, and a clean reader.</p>
      <div class="bigdrop" id="bigdrop">Drop .md files anywhere, or click to choose</div>
      <ul>
        <li><b>Overview</b> shows status, counts, activity by date, plan steps, open items, and decisions.</li>
        <li><b>Map</b> is a collapsible mind map of the headings with cross-references between them.</li>
        <li><b>Timeline</b> puts sections on their dates (ISO dates in headings or text).</li>
        <li><b>Board</b> collects Decision / Finding / Result / Open / Caveat statements.</li>
        <li><b>Data</b> charts every numeric table. Percent columns become error bars against a target band.</li>
        <li><b>Graph</b> links files, parameters, and symbols to the sections that mention them.</li>
        <li><b>Slides</b> builds a deck from the sections, and you can export it to PDF.</li>
      </ul>
      <p class="meta">Everything runs locally in this page. Nothing is uploaded.</p></div>`;
    $('#bigdrop').onclick = pickFiles;
  }

  // ======================================================================
  // Overview
  // ======================================================================
  function viewOverview(main, docs) {
    const v = document.createElement('div');
    v.className = 'view';
    main.appendChild(v);
    for (const doc of docs) {
      const st = MDV.stats(doc);
      const box = document.createElement('div');
      box.className = 'ov-doc';
      const span = doc.span ? `${fmtDate(doc.span[0], { year: 'numeric' })} → ${fmtDate(doc.span[1], { year: 'numeric' })}` : '';
      const tile = (val, lbl, act, k) => `<button class="tile" data-act="${act}" ${k ? `data-kind="${k}"` : ''}><div class="v">${val}</div><div class="l">${k ? `<i style="font-style:normal;color:var(--k-${k})">${KINDS[k].icon}</i>` : ''}${lbl}</div></button>`;
      box.innerHTML = `
        <h1>${esc(doc.title)}</h1>
        <div class="meta">${esc(doc.name)} · ${st.words.toLocaleString()} words${span ? ' · ' + span : ''}${doc.target != null ? ` · target ±${doc.target} %` : ''}</div>
        ${doc.status ? `<p class="status">${inline(MDV.summarize(doc.status, 320))}</p>` : ''}
        <div class="tiles">
          ${tile(st.sections, 'Sections', 'map')}
          ${KORDER.map((k) => tile(st[k], KINDS[k].label + (st[k] === 1 ? '' : 's'), 'board', k)).join('')}
          ${tile(st.tables, 'Tables', 'data')}
          ${tile(st.entities, 'References', 'graph')}
        </div>
        <div class="grid2">
          <div class="card"><h3>Writing activity by date</h3><div class="act-chart chart"></div></div>
          <div class="card"><h3>Most-referenced</h3><div class="bars-mini top-refs"></div></div>
          <div class="card ov-steps" hidden><h3>Plan steps</h3><div class="steps"></div></div>
          <div class="card"><h3>Open items</h3><div class="list ov-open"></div></div>
          <div class="card"><h3>Decisions</h3><div class="list ov-dec"></div></div>
          <div class="card"><h3>Latest findings &amp; results</h3><div class="list ov-res"></div></div>
        </div>`;
      v.appendChild(box);

      // activity chart: words per date (sections with their own date)
      const byDate = {};
      doc.sections.forEach((s) => { if (s.own && s.level > 0) (byDate[s.own] = byDate[s.own] || []).push(s); });
      const dates = Object.keys(byDate).sort();
      if (dates.length) {
        const rows = dates.map((d) => ({ label: fmtDate(d), values: [byDate[d].reduce((a, s) => a + s.words, 0)], tipExtra: byDate[d].map((s) => esc(shortLabel(s, 46))).join('<br>') }));
        drawColumns($('.act-chart', box), rows, { unit: 'words', onClick: () => setView('timeline') });
      } else $('.act-chart', box).innerHTML = '<div class="empty-note">No ISO dates (YYYY-MM-DD) found.</div>';

      const ents = Object.values(doc.entities).sort((a, b) => b.count - a.count).slice(0, 10);
      const maxc = ents.length ? ents[0].count : 1;
      $('.top-refs', box).innerHTML = ents.map((e) => `<div class="r" data-ent="${esc(e.id)}" data-doc="${doc.index}"><span class="n mono" title="${esc(e.key)}">${esc(e.key)}</span><span><div class="b" style="width:${Math.max(4, (e.count / maxc) * 100)}%;background:var(--t-${e.type})"></div></span><span class="c">${e.count}</span></div>`).join('');

      const steps = doc.sections.find((s) => s.steps.length >= 2);
      if (steps) {
        $('.ov-steps', box).hidden = false;
        $('.ov-steps h3', box).innerHTML = `Plan steps · ${steps.steps.filter((x) => x.done).length}/${steps.steps.length} done`;
        $('.ov-steps .steps', box).innerHTML = steps.steps.map((x) => `<div class="step ${x.done ? 'done' : ''}"><div class="n">${x.done ? '✓' : x.n}</div><div class="x">${inline(MDV.summarize(x.md, 150))}</div></div>`).join('');
      }
      const itemList = (kinds, limit, newest) => {
        let items = doc.items.filter((b) => kinds.includes(b.kind));
        if (newest) items = items.slice().sort((a, b) => (sec(b.sectionId).when || '').localeCompare(sec(a.sectionId).when || '') || 0);
        return items.slice(0, limit).map((b) => {
          const s = sec(b.sectionId);
          return `<div class="li"><div class="t">${inline(MDV.summarize(b.md, 200))}</div><div class="f">${kindTag(b.kind)} ${secChip(s)} <span class="meta">${fmtDate(s.when)}</span></div></div>`;
        }).join('') || '<div class="empty-note">None found.</div>';
      };
      $('.ov-open', box).innerHTML = itemList(['open'], 8, true);
      $('.ov-dec', box).innerHTML = itemList(['decision'], 8, false);
      $('.ov-res', box).innerHTML = itemList(['finding', 'result'], 8, true);
    }
    v.addEventListener('click', (e) => {
      const t = e.target.closest('.tile');
      if (t) {
        if (t.dataset.kind) { S.board.kinds = new Set([t.dataset.kind]); }
        else if (t.dataset.act === 'board') S.board.kinds = new Set(KORDER);
        setView(t.dataset.act);
      }
    });
  }

  // ======================================================================
  // Charts (plain SVG)
  // ======================================================================
  function niceTicks(lo, hi, n) {
    if (hi === lo) hi = lo + 1;
    const step0 = (hi - lo) / Math.max(1, n);
    const p = Math.pow(10, Math.floor(Math.log10(step0)));
    const e = step0 / p;
    const step = (e >= 5 ? 10 : e >= 2 ? 5 : e >= 1.4 ? 2 : 1) * p;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }
  const fmtNum = (v) => {
    if (v == null || isNaN(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
    if (a >= 1e4) return (v / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'k';
    if (a >= 100) return Math.round(v).toLocaleString();
    return (+v.toFixed(2)).toString();
  };
  const svgEl = (w, h) => `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">`;
  // horizontal bar with a rounded data end and a square baseline end
  function barPath(x0, x1, y, h) {
    const r = Math.min(4, Math.abs(x1 - x0), h / 2);
    if (Math.abs(x1 - x0) < 0.5) return '';
    if (x1 >= x0) return `M${x0},${y}H${x1 - r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 - r},${y + h}H${x0}Z`;
    return `M${x0},${y}H${x1 + r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 + r},${y + h}H${x0}Z`;
  }
  function colPath(x, w, y0, y1) {
    const r = Math.min(4, Math.abs(y0 - y1), w / 2);
    if (Math.abs(y0 - y1) < 0.5) return '';
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  }
  function wireTips(root, tips) {
    root.querySelectorAll('[data-tip]').forEach((n) => {
      n.addEventListener('mousemove', (e) => showTip(e, tips[n.dataset.tip]));
      n.addEventListener('mouseleave', hideTip);
    });
  }

  // rows: [{label, values:[..], out?, tipExtra?}], series: [{name, color}]
  function drawBars(el, rows, series, o) {
    o = o || {};
    const W = Math.max(320, o.width || el.clientWidth || 700);
    const labW = Math.min(o.labelWidth || 240, Math.round(W * 0.38));
    const k = series.length;
    const bh = k > 1 ? 11 : 16, gap = 2;
    const gh = k * bh + (k - 1) * gap, rowGap = k > 1 ? 14 : 9;
    const top = 26, right = 56;
    const H = top + rows.length * (gh + rowGap) + 4;
    const vals = rows.flatMap((r) => r.values).filter((v) => v != null && isFinite(v));
    if (!vals.length) { el.innerHTML = '<div class="empty-note">No numeric values to chart.</div>'; return; }
    const log = o.log && vals.every((v) => v > 0);
    let lo = log ? Math.min(...vals) : Math.min(0, ...vals), hi = Math.max(0, ...vals);
    let x;
    if (log) {
      const l0 = Math.floor(Math.log10(lo)), l1 = Math.ceil(Math.log10(hi));
      lo = Math.pow(10, l0); hi = Math.pow(10, l1 === l0 ? l0 + 1 : l1);
      x = (v) => labW + ((Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * (W - labW - right);
    } else {
      const ticks0 = niceTicks(lo, hi, 5);
      lo = Math.min(lo, ticks0[0]); hi = Math.max(hi, ticks0[ticks0.length - 1]);
      x = (v) => labW + ((v - lo) / (hi - lo || 1)) * (W - labW - right);
    }
    const ticks = log ? Array.from({ length: Math.round(Math.log10(hi / lo)) + 1 }, (_, i) => lo * Math.pow(10, i)) : niceTicks(lo, hi, 5);
    const tips = [];
    let s = svgEl(W, H);
    ticks.forEach((t) => { s += `<line class="gl" x1="${x(t)}" x2="${x(t)}" y1="${top - 6}" y2="${H}"/><text x="${x(t)}" y="${top - 12}" text-anchor="middle">${fmtNum(t)}</text>`; });
    if (!log) s += `<line class="zero" x1="${x(0)}" x2="${x(0)}" y1="${top - 6}" y2="${H}"/>`;
    rows.forEach((r, ri) => {
      const y0 = top + ri * (gh + rowGap) + rowGap / 2;
      const maxCh = Math.floor((labW - 12) / 6.6);
      const lab = r.label.length > maxCh ? r.label.slice(0, maxCh - 1) + '…' : r.label;
      s += `<text class="lab" x="${labW - 10}" y="${y0 + gh / 2 + 4}" text-anchor="end">${esc(lab)}</text>`;
      r.values.forEach((v, si) => {
        const y = y0 + si * (bh + gap);
        tips.push(`<b>${esc(r.label)}</b><br><span class="tm">${esc(series[si].name)}:</span> <b>${v == null ? '—' : v.toLocaleString()}${o.unit ? ' ' + esc(o.unit) : ''}</b>${r.deltas && r.deltas[si] != null ? ` <span class="tm">(${r.deltas[si] > 0 ? '+' : ''}${r.deltas[si]} %)</span>` : ''}${r.tipExtra ? '<br>' + r.tipExtra : ''}`);
        const ti = tips.length - 1;
        if (v == null || !isFinite(v)) { s += `<text class="val" x="${x(log ? lo : 0) + 4}" y="${y + bh - 2}">—</text>`; return; }
        const x0 = log ? x(lo) : x(0), x1 = x(v);
        s += `<path class="bar" d="${barPath(x0, x1, y, bh)}" fill="${series[si].color}"/>`;
        s += `<rect class="hit" data-tip="${ti}" x="${labW}" y="${y - gap / 2}" width="${W - labW}" height="${bh + gap}"/>`;
        if (k === 1 && rows.length <= 24) s += `<text class="val" x="${v >= 0 ? x1 + 5 : x1 - 5}" y="${y + bh - 4}" text-anchor="${v >= 0 ? 'start' : 'end'}">${fmtNum(v)}</text>`;
      });
    });
    s += '</svg>';
    el.innerHTML = (k > 1 ? `<div class="legend">${series.map((sr) => `<span><span class="sw" style="background:${sr.color}"></span>${esc(sr.name)}</span>`).join('')}</div>` : '') + s;
    wireTips(el, tips);
  }

  // Signed percentages: bars from zero, a shaded ±target band, out-of-band rows flagged.
  function drawDiverging(el, rows, o) {
    o = o || {};
    const W = Math.max(320, o.width || el.clientWidth || 700);
    const labW = Math.min(o.labelWidth || 260, Math.round(W * 0.4));
    const bh = 16, rowGap = 9, top = 26, side = 46;
    const H = top + rows.length * (bh + rowGap) + 4;
    const vals = rows.map((r) => r.value).filter((v) => v != null && isFinite(v));
    if (!vals.length) { el.innerHTML = '<div class="empty-note">No numeric values to chart.</div>'; return; }
    const t = o.threshold;
    const m = Math.max(...vals.map(Math.abs), t ? t * 1.6 : 1);
    const ticks = niceTicks(-m, m, 6);
    const lo = Math.min(-m, ticks[0]), hi = Math.max(m, ticks[ticks.length - 1]);
    const x = (v) => labW + side + ((v - lo) / (hi - lo)) * (W - labW - 2 * side);
    const tips = [];
    let s = svgEl(W, H);
    if (t) s += `<rect class="band" x="${x(-t)}" y="${top - 6}" width="${x(t) - x(-t)}" height="${H - top + 6}"/><text x="${x(t) + 4}" y="${H - 4}" style="font-size:10.5px">±${t} %</text>`;
    ticks.forEach((tk) => { s += `<line class="gl" x1="${x(tk)}" x2="${x(tk)}" y1="${top - 6}" y2="${H}"/><text x="${x(tk)}" y="${top - 12}" text-anchor="middle">${tk > 0 ? '+' : ''}${fmtNum(tk)}%</text>`; });
    s += `<line class="zero" x1="${x(0)}" x2="${x(0)}" y1="${top - 6}" y2="${H}"/>`;
    rows.forEach((r, ri) => {
      const y = top + ri * (bh + rowGap) + rowGap / 2;
      const out = t && r.value != null && Math.abs(r.value) > t;
      const maxCh = Math.floor((labW - 22) / 6.8);
      const lab = r.label.length > maxCh ? r.label.slice(0, maxCh - 1) + '…' : r.label;
      s += `<text class="lab ${out ? 'out' : ''}" x="${labW - 8}" y="${y + bh - 4}" text-anchor="end">${out ? '⚠ ' : ''}${esc(lab)}</text>`;
      tips.push(`<b>${esc(r.label)}</b><br>${esc(o.seriesName || 'value')}: <b>${r.value == null ? '—' : (r.value > 0 ? '+' : '') + r.value + ' %'}</b>${t ? `<br><span class="tm">${out ? 'outside' : 'within'} ±${t} % target</span>` : ''}${r.tipExtra ? '<br>' + r.tipExtra : ''}`);
      if (r.value == null) { s += `<text class="val" x="${x(0) + 4}" y="${y + bh - 4}">—</text>`; return; }
      s += `<path class="bar" d="${barPath(x(0), x(r.value), y, bh)}" fill="${r.value < 0 ? 'var(--neg)' : 'var(--pos)'}"/>`;
      s += `<rect class="hit" data-tip="${tips.length - 1}" x="${labW}" y="${y - rowGap / 2}" width="${W - labW}" height="${bh + rowGap}"/>`;
      s += `<text class="val" x="${r.value >= 0 ? x(r.value) + 5 : x(r.value) - 5}" y="${y + bh - 4}" text-anchor="${r.value >= 0 ? 'start' : 'end'}">${r.value > 0 ? '+' : ''}${r.value}%</text>`;
    });
    s += '</svg>';
    el.innerHTML = `<div class="legend"><span><span class="sw" style="background:var(--neg)"></span>below (−)</span><span><span class="sw" style="background:var(--pos)"></span>above (+)</span>${t ? `<span><span class="sw" style="background:var(--band);border:1px solid var(--axis)"></span>target band ±${t} %</span>` : ''}</div>` + s;
    wireTips(el, tips);
  }

  // vertical columns, one series (activity)
  function drawColumns(el, rows, o) {
    const W = Math.max(280, el.clientWidth || 480), H = 170, top = 14, bottom = 30, left = 50;
    const vals = rows.map((r) => r.values[0]);
    const ticks = niceTicks(0, Math.max(...vals, 1), 4);
    const hi = ticks[ticks.length - 1];
    const bw = Math.min(46, ((W - left) / rows.length) * 0.66);
    const step = (W - left) / rows.length;
    const y = (v) => H - bottom - (v / hi) * (H - top - bottom);
    const tips = [];
    let s = svgEl(W, H);
    ticks.forEach((t) => { s += `<line class="gl" x1="${left}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text x="${left - 6}" y="${y(t) + 4}" text-anchor="end">${fmtNum(t)}</text>`; });
    rows.forEach((r, i) => {
      const cx = left + i * step + step / 2;
      tips.push(`<b>${esc(r.label)}</b>: ${r.values[0].toLocaleString()} ${esc(o.unit || '')}<br><span class="tm">${r.tipExtra || ''}</span>`);
      s += `<path class="bar" d="${colPath(cx - bw / 2, bw, y(0), y(r.values[0]))}" fill="var(--s1)"/>`;
      s += `<rect class="hit" data-tip="${tips.length - 1}" x="${cx - step / 2}" y="${top}" width="${step}" height="${H - top}" style="cursor:pointer"/>`;
      if (rows.length <= 14 || i % Math.ceil(rows.length / 14) === 0) s += `<text x="${cx}" y="${H - 10}" text-anchor="middle">${esc(r.label)}</text>`;
    });
    s += `<line class="zero" x1="${left}" x2="${W}" y1="${y(0)}" y2="${y(0)}"/></svg>`;
    el.innerHTML = s;
    wireTips(el, tips);
    if (o.onClick) $$('.hit', el).forEach((n) => n.addEventListener('click', o.onClick));
  }

  // series lines over category labels, crosshair tooltip
  function drawLines(el, labels, series, o) {
    o = o || {};
    const W = Math.max(320, o.width || el.clientWidth || 700), H = o.height || 260, top = 14, bottom = 34, left = 48, right = 16;
    const vals = series.flatMap((s) => s.values).filter((v) => v != null && isFinite(v));
    if (!vals.length) { el.innerHTML = '<div class="empty-note">No values.</div>'; return; }
    const ticks = niceTicks(Math.min(0, ...vals), Math.max(...vals), 5);
    const lo = ticks[0], hi = ticks[ticks.length - 1];
    const x = (i) => left + (labels.length === 1 ? (W - left - right) / 2 : (i / (labels.length - 1)) * (W - left - right));
    const y = (v) => H - bottom - ((v - lo) / (hi - lo || 1)) * (H - top - bottom);
    let s = svgEl(W, H);
    ticks.forEach((t) => { s += `<line class="gl" x1="${left}" x2="${W - right}" y1="${y(t)}" y2="${y(t)}"/><text x="${left - 6}" y="${y(t) + 4}" text-anchor="end">${fmtNum(t)}</text>`; });
    labels.forEach((l, i) => { if (labels.length <= 12 || i % Math.ceil(labels.length / 12) === 0) s += `<text x="${x(i)}" y="${H - 12}" text-anchor="middle">${esc(l)}</text>`; });
    if (o.target != null) s += `<line x1="${left}" x2="${W - right}" y1="${y(o.target)}" y2="${y(o.target)}" stroke="var(--muted)" stroke-dasharray="4 4"/>`;
    series.forEach((sr) => {
      const pts = sr.values.map((v, i) => (v == null ? null : [x(i), y(v)]));
      let d = '', pen = false;
      pts.forEach((p) => { if (!p) { pen = false; return; } d += (pen ? 'L' : 'M') + p[0] + ',' + p[1]; pen = true; });
      s += `<path d="${d}" fill="none" stroke="${sr.color}" stroke-width="2"/>`;
      pts.forEach((p) => { if (p) s += `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${sr.color}" stroke="var(--surface)" stroke-width="2"/>`; });
    });
    s += `<line class="xh" x1="0" x2="0" y1="${top}" y2="${H - bottom}" stroke="var(--axis)" visibility="hidden"/><rect class="hit" x="${left}" y="${top}" width="${W - left - right}" height="${H - top - bottom}"/></svg>`;
    el.innerHTML = (series.length > 1 ? `<div class="legend">${series.map((sr) => `<span><span class="sw" style="background:${sr.color}"></span>${esc(sr.name)}</span>`).join('')}</div>` : '') + s;
    const hit = $('.hit', el), xh = $('.xh', el), svg = $('svg', el);
    hit.addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect();
      const px = (e.clientX - r.left) * (W / r.width);
      let best = 0;
      labels.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
      xh.setAttribute('x1', x(best)); xh.setAttribute('x2', x(best)); xh.setAttribute('visibility', 'visible');
      showTip(e, `<b>${esc(labels[best])}</b>` + series.map((sr) => `<br><span class="sw" style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${sr.color}"></span> ${esc(sr.name)}: <b>${sr.values[best] == null ? '—' : sr.values[best].toLocaleString()}</b>${o.unit ? ' ' + esc(o.unit) : ''}`).join(''));
    });
    hit.addEventListener('mouseleave', () => { xh.setAttribute('visibility', 'hidden'); hideTip(); });
  }

  // ---------- table -> chart choice ----------
  function tableSeries(tb) {
    const out = [];
    tb.cols.forEach((c) => {
      if (c.type === 'num') out.push({ name: c.name, ci: c.index, kind: 'num', unit: c.unit });
      if (c.type === 'pct') out.push({ name: c.name, ci: c.index, kind: 'pct', unit: '%' });
      if (c.hasDelta && c.type !== 'pct') out.push({ name: c.name + ' Δ%', ci: c.index, kind: 'delta', unit: '%' });
    });
    out.forEach((s, i) => { s.color = `var(--s${(i % 8) + 1})`; });
    return out;
  }
  function tableUI(tb, doc) {
    if (S.tableUI[tb.id]) return S.tableUI[tb.id];
    const ser = tableSeries(tb);
    const d = tb.directive || {};
    let type = d.chart || d.type || null;
    let on;
    const pct = ser.filter((s) => s.kind === 'pct'), deltas = ser.filter((s) => s.kind === 'delta'), nums = ser.filter((s) => s.kind === 'num');
    if (d.series) {
      const want = String(d.series).split(',').map((x) => x.trim().toLowerCase());
      on = ser.filter((s) => want.includes(s.name.toLowerCase())).map((s) => s.name);
    }
    if (!type) type = pct.length ? 'diverging' : nums.length ? 'bars' : deltas.length ? 'diverging' : null;
    if (!on || !on.length) {
      if (type === 'diverging') on = [(pct[0] || deltas[0] || ser[0] || {}).name];
      else {
        const units = {};
        nums.forEach((s) => { units[s.unit] = (units[s.unit] || 0) + 1; });
        const u = Object.keys(units).sort((a, b) => units[b] - units[a])[0];
        on = nums.filter((s) => s.unit === u).slice(0, 4).map((s) => s.name);
      }
    }
    const vals = tb.rows.flatMap((r) => nums.filter((x) => on.includes(x.name)).map((x) => r[x.ci] && r[x.ci].num)).filter((x) => x != null);
    const wide = vals.length > 2 && vals.every((x) => x > 0) && Math.max(...vals) / Math.min(...vals) >= 100;
    const ui = { type, on: new Set(on), log: type === 'bars' && wide, threshold: d.target != null ? +d.target : doc.target, mode: type && d.chart !== 'none' ? 'chart' : 'table' };
    S.tableUI[tb.id] = ui;
    return ui;
  }
  function renderTableChart(el, tb, ui, o) {
    const ser = tableSeries(tb).filter((s) => ui.on.has(s.name));
    if (!ser.length) { el.innerHTML = '<div class="empty-note">Select a series.</div>'; return; }
    const get = (row, s) => { const c = row[s.ci]; return !c ? null : s.kind === 'delta' ? c.delta : s.kind === 'pct' ? (c.pct ?? c.delta) : c.num; };
    if (ui.type === 'diverging' && ser.length === 1 && ser[0].kind !== 'num') {
      const rows = tb.rows.map((r, i) => ({ label: tb.labels[i], value: get(r, ser[0]), tipExtra: esc(r.map((c, ci) => `${tb.header[ci]}: ${c.plain}`).join(' · ')) })).filter((r) => r.value != null || !o || !o.compact);
      drawDiverging(el, rows, Object.assign({ threshold: ui.threshold, seriesName: ser[0].name }, o));
    } else if (ui.type === 'line') {
      drawLines(el, tb.labels, ser.map((s) => ({ name: s.name, color: s.color, values: tb.rows.map((r) => get(r, s)) })), o);
    } else {
      const rows = tb.rows.map((r, i) => ({ label: tb.labels[i], values: ser.map((s) => get(r, s)), deltas: ser.map((s) => (r[s.ci] ? r[s.ci].delta : null)) }))
        .filter((r) => r.values.some((v) => v != null));
      drawBars(el, rows, ser, Object.assign({ log: ui.log, unit: ser.length === 1 ? ser[0].unit : '' }, o));
    }
  }
  function renderTableHtml(tb, ui, sortState) {
    const order = tb.rows.map((_, i) => i);
    if (sortState && sortState.col != null) {
      const ci = sortState.col, dir = sortState.dir;
      order.sort((a, b) => {
        const A = tb.rows[a][ci], B = tb.rows[b][ci];
        const an = A && A.num != null ? A.num : null, bn = B && B.num != null ? B.num : null;
        if (an != null && bn != null) return (an - bn) * dir;
        if (an != null) return -1;
        if (bn != null) return 1;
        return String(A ? A.plain : '').localeCompare(String(B ? B.plain : '')) * dir;
      });
    }
    const t = ui && ui.threshold;
    let h = '<div class="tablewrap"><table><thead><tr>';
    tb.header.forEach((c, i) => { h += `<th class="sortable" data-col="${i}">${esc(c)}${sortState && sortState.col === i ? (sortState.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`; });
    h += '</tr></thead><tbody>';
    order.forEach((ri) => {
      h += '<tr>' + tb.header.map((_, ci) => {
        const c = tb.rows[ri][ci] || { md: '', plain: '' };
        const isNum = tb.cols[ci].type !== 'text';
        const out = t && ((c.pct != null && Math.abs(c.pct) > t) || (c.delta != null && Math.abs(c.delta) > t));
        return `<td class="${isNum ? 'num' : ''} ${out ? 'out' : ''}">${hl(inline(c.md))}</td>`;
      }).join('') + '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  // a table card with controls; used by Data view and the readers
  function tableCard(tb, doc, opts) {
    opts = opts || {};
    const ui = tableUI(tb, doc);
    const wrap = document.createElement('div');
    let sortState = null;
    const draw = () => {
      const ser = tableSeries(tb);
      const canChart = !!ui.type && ser.length;
      const controls = canChart ? `<div class="toolbar">
          ${ser.map((s) => `<span class="chip ${ui.on.has(s.name) ? '' : 'off'}" data-ser="${esc(s.name)}"><span class="sw" style="background:${s.color}"></span>${esc(s.name)}</span>`).join('')}
          <span class="lbl">Chart</span><select data-k="type">${['bars', 'diverging', 'line'].map((t) => `<option ${ui.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
          ${ui.type === 'bars' ? `<label class="lbl"><input type="checkbox" data-k="log" ${ui.log ? 'checked' : ''}> log scale</label>` : ''}
          ${ui.type === 'diverging' ? `<span class="lbl">target ±</span><input type="number" data-k="threshold" min="0" step="0.5" style="width:64px" value="${ui.threshold ?? ''}"><span class="lbl">%</span>` : ''}
          <span class="spacer"></span>
          <select data-k="mode">${[['chart', 'Chart'], ['both', 'Chart + table'], ['table', 'Table']].map(([v, l]) => `<option value="${v}" ${ui.mode === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </div>` : '';
      wrap.innerHTML = controls + (canChart && ui.mode !== 'table' ? '<div class="chart"></div>' : '') + (!canChart || ui.mode !== 'chart' ? renderTableHtml(tb, ui, sortState) : '');
      const ch = $('.chart', wrap);
      if (ch) requestAnimationFrame(() => renderTableChart(ch, tb, ui, { width: opts.width }));
    };
    wrap.addEventListener('click', (e) => {
      const c = e.target.closest('[data-ser]');
      if (c) {
        const n = c.dataset.ser;
        if (ui.type === 'diverging') ui.on = new Set([n]);
        else if (ui.on.has(n)) { if (ui.on.size > 1) ui.on.delete(n); } else ui.on.add(n);
        draw();
      }
      const th = e.target.closest('th[data-col]');
      if (th) {
        const ci = +th.dataset.col;
        sortState = sortState && sortState.col === ci ? (sortState.dir === -1 ? null : { col: ci, dir: -1 }) : { col: ci, dir: 1 };
        draw();
      }
    });
    wrap.addEventListener('change', (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      if (k === 'log') ui.log = e.target.checked;
      else if (k === 'threshold') ui.threshold = e.target.value === '' ? null : +e.target.value;
      else if (k === 'type') {
        ui.type = e.target.value;
        const ser = tableSeries(tb);
        if (ui.type === 'diverging') { const p = ser.find((s) => s.kind !== 'num') || ser[0]; ui.on = new Set([p.name]); }
      } else ui[k] = e.target.value;
      draw();
    });
    draw();
    return wrap;
  }

  // ======================================================================
  // Data view
  // ======================================================================
  function viewData(main, docs) {
    const v = document.createElement('div');
    v.className = 'view';
    main.appendChild(v);
    let n = 0;
    v.innerHTML = '<h1>Data</h1><div class="meta">Every table in the documents. Numeric columns are charted, and cells like <code>4128 (+11 %)</code> give both a value and a delta. Click a column header to sort.</div>';
    for (const doc of docs) {
      const charts = doc.charts.filter((c) => matches(c.title, secLabel(sec(c.sectionId))));
      const tables = doc.tables.filter((tb) => matches(tb.header.join(' '), tb.labels.join(' '), secLabel(sec(tb.sectionId))));
      if (!charts.length && !tables.length) continue;
      if (docs.length > 1) v.insertAdjacentHTML('beforeend', `<h2 class="sec"><span class="dot" style="background:${docColor(doc.index)}"></span> ${esc(doc.title)}</h2>`);
      for (const c of charts) {
        const card = document.createElement('div');
        card.className = 'card tcard';
        card.innerHTML = `<div class="tcard-h"><span class="ttl">${esc(c.title || 'Chart')}</span>${secChip(sec(c.sectionId), 50)}</div><div class="chart"></div>`;
        v.appendChild(card);
        requestAnimationFrame(() => drawSpec($('.chart', card), c, doc));
        n++;
      }
      const charted = tables.filter((tb) => tb.numeric && tableUI(tb, doc).type);
      const plain = tables.filter((tb) => !charted.includes(tb));
      for (const tb of charted.concat(plain)) {
        if (tb === plain[0]) v.insertAdjacentHTML('beforeend', `<h2 class="sec">Reference tables <span class="meta">(no numeric columns)</span></h2>`);
        const s = sec(tb.sectionId);
        const card = document.createElement('div');
        card.className = 'card tcard';
        const idx = s.tables.indexOf(tb.id) + 1;
        card.innerHTML = `<div class="tcard-h"><span class="ttl">${esc(tb.directive && tb.directive.title ? tb.directive.title : tb.header.slice(0, 4).join(' · '))}</span>${secChip(s, 50)}<span class="meta">table ${idx} · ${tb.rows.length} rows</span></div>`;
        card.appendChild(tableCard(tb, doc));
        v.appendChild(card);
        n++;
      }
    }
    if (!n) v.insertAdjacentHTML('beforeend', '<p class="empty-note">No tables match.</p>');
  }
  function drawSpec(el, c, doc) {
    const series = (c.series || []).map((s, i) => ({ name: s.name || `series ${i + 1}`, color: `var(--s${(i % 8) + 1})`, values: s.values || [] }));
    const labels = c.labels || (series[0] ? series[0].values.map((_, i) => String(i + 1)) : []);
    if (c.type === 'line') return drawLines(el, labels, series, { unit: c.unit, target: c.target });
    if (c.type === 'diverging') return drawDiverging(el, labels.map((l, i) => ({ label: l, value: series[0] ? series[0].values[i] : null })), { threshold: c.target ?? doc.target, seriesName: series[0] && series[0].name });
    return drawBars(el, labels.map((l, i) => ({ label: l, values: series.map((s) => s.values[i] ?? null) })), series, { unit: c.unit, log: c.log });
  }

  // ======================================================================
  // pan / zoom for SVG canvases
  // ======================================================================
  function panZoom(svg, g, key, minK) {
    const t = S.pz[key] || (S.pz[key] = { x: 30, y: 30, k: 1, fitted: false });
    const apply = () => g.setAttribute('transform', `translate(${t.x},${t.y}) scale(${t.k})`);
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const k = Math.min(4, Math.max(0.1, t.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018))));
      t.x = mx - (mx - t.x) * (k / t.k); t.y = my - (my - t.y) * (k / t.k); t.k = k;
      apply();
    }, { passive: false });
    let drag = null;
    svg.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.node,.gnode')) return;
      drag = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y };
      svg.setPointerCapture(e.pointerId);
      svg.classList.add('panning');
    });
    svg.addEventListener('pointermove', (e) => { if (drag) { t.x = drag.tx + e.clientX - drag.x; t.y = drag.ty + e.clientY - drag.y; apply(); } });
    const end = () => { drag = null; svg.classList.remove('panning'); };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    const fit = () => {
      const b = g.getBBox();
      const r = svg.getBoundingClientRect();
      if (!b.width || !r.width) return;
      // fit the whole drawing, but never below a readable scale: tall trees start top-aligned
      t.k = Math.min(1.2, Math.max(0.1, Math.min((r.width - 60) / b.width, (r.height - 90) / b.height)));
      if (minK && t.k < minK) t.k = Math.min(minK, (r.width - 60) / b.width);
      t.x = (r.width - b.width * t.k) / 2 - b.x * t.k;
      t.y = Math.max(64, (r.height - b.height * t.k) / 2) - b.y * t.k;
      t.fitted = true;
      apply();
    };
    apply();
    return { fit, apply, t, zoom: (f) => { const r = svg.getBoundingClientRect(); const mx = r.width / 2, my = r.height / 2; const k = Math.min(4, Math.max(0.1, t.k * f)); t.x = mx - (mx - t.x) * (k / t.k); t.y = my - (my - t.y) * (k / t.k); t.k = k; apply(); } };
  }
  const svgNode = (tag, attrs) => { const n = document.createElementNS(SVGNS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };

  // ======================================================================
  // Map — collapsible section tree with cross-references
  // ======================================================================
  function viewMap(main, docs) {
    if (!S.collapsed) {
      S.collapsed = new Set();
      S.docs.forEach((d) => d.sections.forEach((s) => { if (s.level >= 3 && s.children.length) S.collapsed.add(s.id); }));
    }
    main.innerHTML = `<div class="view wide"><div class="canvas-wrap">
      <div class="float-tools">
        <button class="btn small" data-a="fit">Fit</button>
        <button class="btn small" data-a="in">＋</button><button class="btn small" data-a="out">－</button>
        <button class="btn small" data-a="expand">Expand all</button><button class="btn small" data-a="collapse">Collapse to level 2</button>
        <label><input type="checkbox" data-a="xrefs" ${S.xrefs ? 'checked' : ''}> cross-references</label>
      </div>
      <svg><defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="var(--accent)"/></marker></defs><g class="vp"></g></svg>
      <div class="legend-float">${KORDER.map((k) => `<span><span style="color:var(--k-${k})">${KINDS[k].icon}</span> ${KINDS[k].label}</span>`).join('')}<span>▦ table</span><span><svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" class="xref"/></svg> cross-ref</span><span class="meta">Click a node to read it. Click ± to fold. Drag to pan, scroll to zoom.</span></div>
    </div></div>`;
    const svg = $('svg', main), g = $('.vp', main);
    const W = 260, H = 50, GX = 70, GY = 12;
    const hits = new Set(), forced = new Set();
    if (S.q) docs.forEach((d) => d.sections.forEach((s) => {
      if (matches(s.fullTitle, s.md)) { hits.add(s.id); let p = s.parent; while (p) { forced.add(p); p = d.byId[p].parent; } }
    }));
    const isOpen = (s) => forced.has(s.id) || !S.collapsed.has(s.id);
    const pos = {};
    let y = 0;
    const place = (d, s, depth) => {
      const kids = isOpen(s) ? s.children.map((c) => d.byId[c]) : [];
      if (!kids.length) { pos[s.id] = { x: depth * (W + GX), y }; y += H + GY; return; }
      kids.forEach((k) => place(d, k, depth + 1));
      const ys = kids.map((k) => pos[k.id].y);
      pos[s.id] = { x: depth * (W + GX), y: (ys[0] + ys[ys.length - 1]) / 2 };
    };
    docs.forEach((d) => { place(d, d.sections[0], 0); y += 40; });
    let edges = '', xr = '';
    docs.forEach((d) => d.sections.forEach((s) => {
      if (!pos[s.id] || !s.parent || !pos[s.parent]) return;
      const a = pos[s.parent], b = pos[s.id];
      const x0 = a.x + W, y0 = a.y + H / 2, x1 = b.x, y1 = b.y + H / 2, mx = (x0 + x1) / 2;
      edges += `<path class="edge" d="M${x0},${y0}C${mx},${y0} ${mx},${y1} ${x1},${y1}"/>`;
    }));
    if (S.xrefs) docs.forEach((d) => d.xrefs.forEach((r) => {
      const vis = (id) => { while (id && !pos[id]) id = d.byId[id].parent; return id; };
      const a = vis(r.from), b = vis(r.to);
      if (!a || !b || a === b) return;
      const pa = pos[a], pb = pos[b];
      const x0 = pa.x + W - 30, y0 = pa.y + (pb.y > pa.y ? H : 0), x1 = pb.x + W - 30, y1 = pb.y + (pb.y > pa.y ? 0 : H);
      const bend = 60 + Math.min(220, Math.abs(y1 - y0) * 0.25);
      xr += `<path class="xref" marker-end="url(#arr)" d="M${x0},${y0}C${x0 + bend},${y0} ${x1 + bend},${y1} ${x1},${y1}"><title>${esc(r.label)}: ${esc(secLabel(d.byId[r.from]))} → ${esc(secLabel(d.byId[r.to]))}</title></path>`;
    }));
    let nodes = '';
    docs.forEach((d) => d.sections.forEach((s) => {
      const p = pos[s.id];
      if (!p) return;
      const title = s.level === 0 ? d.title : s.title;
      const maxc = s.level <= 1 ? 30 : 34;
      const t = title.length > maxc ? title.slice(0, maxc - 1) + '…' : title;
      const counts = KORDER.filter((k) => s.kinds[k]).map((k) => `<tspan fill="var(--k-${k})">${KINDS[k].icon}</tspan>${s.kinds[k]}`).join(' ');
      const meta = [s.own ? fmtDate(s.own) : '', counts, s.tables.length ? `▦${s.tables.length}` : '', s.words ? `${s.words}w` : ''].filter(Boolean).join('  ');
      const cls = ['node', hits.has(s.id) ? 'hit' : '', S.q && !hits.has(s.id) ? 'dimmed' : ''].join(' ');
      const hasKids = s.children.length > 0;
      const open = isOpen(s);
      nodes += `<g class="${cls}" data-sec="${s.id}" transform="translate(${p.x},${p.y})">
        <rect class="box" width="${W}" height="${H}" rx="9"/>
        <rect width="4" height="${H - 16}" x="0" y="8" rx="2" fill="${docColor(d.index)}"/>
        <text x="14" y="21" style="font-weight:${s.level <= 2 ? 650 : 500}">${s.num ? `<tspan fill="var(--muted)">${esc(s.num)} </tspan>` : ''}${esc(t)}</text>
        <text class="sub" x="14" y="38">${meta}</text>
        ${hasKids ? `<g class="tg" data-tg="${s.id}" transform="translate(${W},${H / 2})"><circle r="9"/><text y="3.5">${open ? '−' : s.children.length}</text></g>` : ''}
      </g>`;
    }));
    g.innerHTML = edges + nodes + xr;
    const pz = panZoom(svg, g, 'map', 0.8);
    if (!pz.t.fitted) requestAnimationFrame(pz.fit);
    svg.addEventListener('click', (e) => {
      const tg = e.target.closest('[data-tg]');
      if (tg) { const id = tg.dataset.tg; S.collapsed.has(id) ? S.collapsed.delete(id) : S.collapsed.add(id); viewMap(main, docs); return; }
      const n = e.target.closest('.node');
      if (n) openSection(n.dataset.sec);
    });
    svg.addEventListener('mousemove', (e) => {
      const n = e.target.closest('.node');
      if (!n || e.target.closest('[data-tg]')) return hideTip();
      const s = sec(n.dataset.sec);
      const first = s.blocks[0];
      showTip(e, `<b>${esc(secLabel(s))}</b>${s.when ? ` <span class="tm">· ${fmtDate(s.when, { year: 'numeric' })}</span>` : ''}${first ? `<br><span class="tm">${inline(MDV.summarize(first.md, 220))}</span>` : ''}`);
    });
    svg.addEventListener('mouseleave', hideTip);
    $('.float-tools', main).addEventListener('click', (e) => {
      const a = e.target.dataset.a;
      if (a === 'fit') pz.fit();
      if (a === 'in') pz.zoom(1.25);
      if (a === 'out') pz.zoom(0.8);
      if (a === 'expand') { S.collapsed.clear(); S.pz.map = null; viewMap(main, docs); }
      if (a === 'collapse') { S.collapsed = new Set(); S.docs.forEach((d) => d.sections.forEach((s) => { if (s.level >= 2 && s.children.length) S.collapsed.add(s.id); })); S.pz.map = null; viewMap(main, docs); }
    });
    $('[data-a="xrefs"]', main).addEventListener('change', (e) => { S.xrefs = e.target.checked; viewMap(main, docs); });
  }

  // ======================================================================
  // Timeline
  // ======================================================================
  function viewTimeline(main, docs) {
    const secs = [];
    docs.forEach((d) => d.sections.forEach((s) => { if (s.level > 0 || s.own) secs.push(s); }));
    const dated = secs.filter((s) => s.own);
    const dates = [...new Set(dated.map((s) => s.own))].sort();
    const shown = new Set(dated.map((s) => s.id));
    // undated sections are listed inside their nearest dated ancestor; with none, in the "Undated" column
    const undatedTop = secs.filter((s) => !s.own && !(function up(p) { while (p) { if (shown.has(p)) return true; p = sec(p).parent; } return false; })(s.parent));
    const v = document.createElement('div');
    v.className = 'view wide';
    v.style.overflow = 'auto';
    let html = '<div class="tl">';
    const card = (s) => {
      const d = docOf(s.id);
      const kids = [];
      const collect = (id) => sec(id).children.forEach((c) => { const k = sec(c); if (!k.own) { kids.push(k); collect(c); } });
      collect(s.id);
      const first = s.blocks.find((b) => b.plain.length > 30) || s.blocks[0];
      const dim = S.q && !matches(s.fullTitle, s.md) ? 'dimmed' : '';
      return `<div class="tl-card ${dim}" data-sec="${s.id}" style="--dc:${docColor(d.index)}">
        <div class="t">${s.num ? `<span class="meta">${esc(s.num)}</span> ` : ''}${hl(esc(s.level === 0 ? d.title : s.title))}</div>
        <div style="margin-top:4px">${glyphs(s.kinds, s.tables.length ? `<span>▦${s.tables.length}</span>` : '')}</div>
        ${first ? `<div class="s">${hl(inline(MDV.summarize(first.md, 170)))}</div>` : ''}
        ${kids.length ? `<div class="kids">${kids.map((k) => `<a href="#" data-sec="${k.id}">↳ ${esc(shortLabel(k, 44))}</a>`).join('')}</div>` : ''}
      </div>`;
    };
    if (undatedTop.length) {
      html += `<div class="tl-col"><div class="tl-head"><div class="d">Undated</div><div class="m">${undatedTop.length} sections</div></div>${undatedTop.filter((s) => !s.parent || shown.has(s.parent) || !undatedTop.includes(sec(s.parent))).map(card).join('')}</div>`;
    }
    dates.forEach((dt, i) => {
      if (i > 0) {
        const gap = Math.round((Date.parse(dt) - Date.parse(dates[i - 1])) / 864e5);
        if (gap > 1) html += `<div class="tl-gap">${gap - 1} day${gap > 2 ? 's' : ''} later</div>`;
      }
      const list = dated.filter((s) => s.own === dt);
      const words = list.reduce((a, s) => a + s.words, 0);
      html += `<div class="tl-col"><div class="tl-head"><div class="d">${fmtDate(dt, { weekday: 'short' })}</div><div class="m">${dt} · ${list.length} section${list.length > 1 ? 's' : ''} · ${words.toLocaleString()} words</div></div>${list.map(card).join('')}</div>`;
    });
    if (!dates.length) html += '<p class="empty-note" style="padding:20px">No ISO dates (YYYY-MM-DD) found in headings or text.</p>';
    v.innerHTML = html + '</div>';
    main.appendChild(v);
    v.addEventListener('click', (e) => { const n = e.target.closest('[data-sec]'); if (n) { e.preventDefault(); e.stopPropagation(); openSection(n.dataset.sec); } });
  }

  // ======================================================================
  // Board — classified statements
  // ======================================================================
  function viewBoard(main, docs) {
    const v = document.createElement('div');
    v.className = 'view';
    v.style.maxWidth = 'none';
    main.appendChild(v);
    const all = [];
    docs.forEach((d) => d.items.forEach((b) => all.push(b)));
    const counts = {};
    all.forEach((b) => { counts[b.kind] = (counts[b.kind] || 0) + 1; });
    const kinds = KORDER.filter((k) => S.board.kinds.has(k));
    let html = `<div class="toolbar">${KORDER.map((k) => `<span class="chip ${S.board.kinds.has(k) ? '' : 'off'}" data-kind="${k}"><span style="color:var(--k-${k})">${KINDS[k].icon}</span>${KINDS[k].label} · ${counts[k] || 0}</span>`).join('')}
      <span class="lbl">Sort</span><select id="bsort"><option value="doc" ${S.board.sort === 'doc' ? 'selected' : ''}>Document order</option><option value="new" ${S.board.sort === 'new' ? 'selected' : ''}>Newest first</option></select>
      <span class="meta">Statements are classified by their lead-in, e.g. <b>Decision:</b>, <b>Found</b>, <b>Result</b>, <b>Open:</b>, <b>Caveat</b>.</span></div>`;
    html += `<div class="board" style="--cols:${kinds.length}">`;
    for (const k of kinds) {
      let items = all.filter((b) => b.kind === k && matches(b.plain, secLabel(sec(b.sectionId))));
      if (S.board.sort === 'new') items = items.slice().sort((a, b) => (sec(b.sectionId).when || '').localeCompare(sec(a.sectionId).when || ''));
      html += `<div><div class="col-h" style="--kc:var(--k-${k})">${kindTag(k)}<span class="n">${items.length}</span></div>`;
      html += items.map((b) => {
        const s = sec(b.sectionId);
        return `<div class="bcard"><div class="body">${hl(inline(b.md))}</div><div class="f">${secChip(s)}<span class="meta">${fmtDate(s.when)}</span></div></div>`;
      }).join('') || '<div class="empty-note">Nothing here.</div>';
      html += '</div>';
    }
    v.innerHTML = html + '</div>';
    v.addEventListener('click', (e) => {
      const c = e.target.closest('[data-kind]');
      if (c) {
        const k = c.dataset.kind;
        if (e.altKey || e.metaKey) S.board.kinds = new Set([k]);
        else if (S.board.kinds.has(k)) { if (S.board.kinds.size > 1) S.board.kinds.delete(k); } else S.board.kinds.add(k);
        return render();
      }
      const b = e.target.closest('.bcard .body');
      if (b) b.parentElement.classList.toggle('open');
    });
    $('#bsort', v).addEventListener('change', (e) => { S.board.sort = e.target.value; render(); });
  }

  // ======================================================================
  // Graph — references ↔ sections, force layout
  // ======================================================================
  function viewGraph(main, docs) {
    const G = S.graph;
    const ents = [];
    docs.forEach((d) => Object.values(d.entities).forEach((e) => ents.push({ e, d })));
    const tc = {};
    ents.forEach(({ e }) => { tc[e.type] = (tc[e.type] || 0) + 1; });
    const keep = ents.filter(({ e }) => G.types.has(e.type) && e.count >= G.min && matches(e.key)).sort((a, b) => b.e.count - a.e.count).slice(0, 260);
    main.innerHTML = `<div class="view wide"><div class="graph-layout">
      <div class="graph-side"><div class="meta" style="margin-bottom:8px">${keep.length} references (mentioned ≥ ${G.min}×)</div><div class="glist"></div></div>
      <div class="canvas-wrap">
        <div class="float-tools">
          ${Object.keys(ETYPES).map((t) => `<span class="chip ${G.types.has(t) ? '' : 'off'}" data-type="${t}"><span class="sw" style="background:var(--t-${t});border-radius:50%"></span>${ETYPES[t]} · ${tc[t] || 0}</span>`).join('')}
          <label>min mentions <input type="range" min="1" max="8" value="${G.min}" data-a="min"> <b>${G.min}</b></label>
          <label><input type="checkbox" data-a="sections" ${G.sections ? 'checked' : ''}> sections</label>
          <button class="btn small" data-a="fit">Fit</button>
        </div>
        <svg><g class="vp"></g></svg>
        <div class="legend-float"><span><svg width="10" height="10"><rect width="10" height="10" rx="2" fill="var(--text-2)"/></svg> section</span><span><svg width="10" height="10"><circle cx="5" cy="5" r="5" fill="var(--s1)"/></svg> reference (size = mentions)</span><span class="meta">Hover to trace links. Click for every mention. Drag a node to pin it.</span></div>
      </div></div></div>`;
    $('.glist', main).innerHTML = keep.map(({ e, d }) => `<div class="r" data-ent="${esc(e.id)}" data-doc="${d.index}"><span class="dot" style="background:var(--t-${e.type})"></span><span class="k" title="${esc(e.key)}">${hl(esc(e.key))}</span><span class="c">${e.count}</span></div>`).join('') || '<div class="empty-note">Nothing matches.</div>';

    // build nodes/links
    const nodes = [], links = [], idx = {};
    const add = (n) => { idx[n.id] = nodes.length; nodes.push(n); return n; };
    keep.forEach(({ e, d }) => add({ id: d.id + '|' + e.id, ent: e, doc: d, r: 4 + Math.sqrt(e.count) * 2.6, color: `var(--t-${e.type})`, label: e.key }));
    if (G.sections) {
      keep.forEach(({ e, d }) => e.sections.forEach((sid) => {
        if (idx[sid] == null) { const s = sec(sid); add({ id: sid, sec: s, r: 6, color: 'var(--text-2)', label: s.num ? '§' + s.num : shortLabel(s, 22) }); }
        links.push({ s: idx[d.id + '|' + e.id], t: idx[sid] });
      }));
    } else {
      for (let i = 0; i < keep.length; i++) for (let j = i + 1; j < keep.length; j++) {
        if (keep[i].d !== keep[j].d) continue;
        const shared = keep[i].e.sections.filter((x) => keep[j].e.sections.includes(x)).length;
        if (shared) links.push({ s: i, t: j, w: shared });
      }
    }
    const svg = $('svg', main), g = $('.vp', main);
    const rect = svg.getBoundingClientRect();
    const cx = (rect.width || 800) / 2, cy = (rect.height || 600) / 2;
    nodes.forEach((n, i) => { const a = i * 2.39996, rr = 12 * Math.sqrt(i + 1); n.x = cx + rr * Math.cos(a); n.y = cy + rr * Math.sin(a); n.vx = 0; n.vy = 0; });
    const adj = nodes.map(() => new Set());
    links.forEach((l) => { adj[l.s].add(l.t); adj[l.t].add(l.s); });
    const labelMin = keep.length > 30 ? keep[Math.min(24, keep.length - 1)].e.count : 0;
    g.innerHTML = links.map((l, i) => `<line class="glink" data-l="${i}"/>`).join('') + nodes.map((n, i) => n.sec
      ? `<g class="gnode" data-i="${i}"><rect width="12" height="12" x="-6" y="-6" rx="2" fill="${n.color}"/><text x="9" y="4">${esc(n.label)}</text></g>`
      : `<g class="gnode" data-i="${i}"><circle r="${n.r}" fill="${n.color}"/><text x="${n.r + 3}" y="4" ${n.ent.count >= labelMin ? '' : 'visibility="hidden"'}>${esc(n.label)}</text></g>`).join('');
    const lineEls = $$('.glink', g), nodeEls = $$('.gnode', g);
    const draw = () => {
      links.forEach((l, i) => { const a = nodes[l.s], b = nodes[l.t]; const el = lineEls[i]; el.setAttribute('x1', a.x); el.setAttribute('y1', a.y); el.setAttribute('x2', b.x); el.setAttribute('y2', b.y); });
      nodes.forEach((n, i) => nodeEls[i].setAttribute('transform', `translate(${n.x},${n.y})`));
    };
    let alpha = 1;
    const tick = () => {
      const N = nodes.length;
      for (let i = 0; i < N; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < N; j++) {
          const b = nodes[j];
          let dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy || 0.01;
          if (d2 > 90000) continue;
          const f = (900 * alpha) / d2;
          dx *= f; dy *= f;
          a.vx -= dx; a.vy -= dy; b.vx += dx; b.vy += dy;
        }
      }
      links.forEach((l) => {
        const a = nodes[l.s], b = nodes[l.t];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = ((d - (G.sections ? 46 : 70)) / d) * 0.06 * alpha;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      });
      nodes.forEach((n) => {
        n.vx += (cx - n.x) * 0.004 * alpha; n.vy += (cy - n.y) * 0.004 * alpha;
        if (!n.fixed) { n.x += n.vx; n.y += n.vy; }
        n.vx *= 0.6; n.vy *= 0.6;
      });
      alpha *= 0.985;
    };
    const pz = panZoom(svg, g, 'graph');
    let frames = 0;
    const loop = () => {
      if (!document.body.contains(svg)) return;
      for (let i = 0; i < 3; i++) tick();
      draw();
      if (++frames === 40 && !pz.t.fitted) pz.fit();
      if (alpha > 0.02) requestAnimationFrame(loop);
    };
    S.pz.graph && (S.pz.graph.fitted = false);
    loop();

    const focus = (i) => {
      nodeEls.forEach((el, j) => {
        const on = i == null || j === i || adj[i].has(j);
        el.classList.toggle('dimmed', !on);
        const tx = $('text', el);
        if (tx && !nodes[j].sec) tx.setAttribute('visibility', on && i != null ? 'visible' : nodes[j].ent.count >= labelMin ? 'visible' : 'hidden');
      });
      lineEls.forEach((el, k) => { const l = links[k]; const on = i != null && (l.s === i || l.t === i); el.classList.toggle('hl', on); el.classList.toggle('dimmed', i != null && !on); });
    };
    let dragN = null, moved = false;
    svg.addEventListener('pointerdown', (e) => {
      const n = e.target.closest('.gnode');
      if (!n) return;
      dragN = nodes[+n.dataset.i]; moved = false;
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', (e) => {
      if (dragN) {
        const r = svg.getBoundingClientRect();
        dragN.x = (e.clientX - r.left - pz.t.x) / pz.t.k; dragN.y = (e.clientY - r.top - pz.t.y) / pz.t.k;
        dragN.fixed = true; moved = true; draw(); return;
      }
      const n = e.target.closest('.gnode');
      if (!n) { focus(null); return hideTip(); }
      const i = +n.dataset.i, nd = nodes[i];
      focus(i);
      showTip(e, nd.sec ? `<b>${esc(secLabel(nd.sec))}</b><br><span class="tm">${adj[i].size} references</span>`
        : `<b class="mono">${esc(nd.ent.key)}</b><br><span class="tm">${ETYPES[nd.ent.type]} · ${nd.ent.count} mentions in ${nd.ent.sections.length} sections</span>${nd.ent.changes.length ? `<br><span class="tm">value history: ${nd.ent.changes.map(chgText).join(' → ')}</span>` : ''}`);
    });
    svg.addEventListener('pointerup', (e) => {
      if (dragN && !moved) { const n = nodes[nodes.indexOf(dragN)]; n.sec ? openSection(n.sec.id) : openEntity(n.doc.index, n.ent.id); }
      dragN = null;
    });
    svg.addEventListener('mouseleave', () => { focus(null); hideTip(); });
    $('.float-tools', main).addEventListener('click', (e) => {
      const c = e.target.closest('[data-type]');
      if (c) { const t = c.dataset.type; G.types.has(t) ? G.types.delete(t) : G.types.add(t); return viewGraph(main, docs); }
      if (e.target.dataset.a === 'fit') pz.fit();
    });
    $('[data-a="min"]', main).addEventListener('change', (e) => { G.min = +e.target.value; viewGraph(main, docs); });
    $('[data-a="min"]', main).addEventListener('input', (e) => { e.target.nextElementSibling.textContent = e.target.value; });
    $('[data-a="sections"]', main).addEventListener('change', (e) => { G.sections = e.target.checked; viewGraph(main, docs); });
  }
  const chgText = (c) => (c.from != null ? `${c.from}→${c.to}` : c.to != null ? `→${c.to}` : `${c.value}`);

  // ======================================================================
  // Slides
  // ======================================================================
  function pointsFor(s, max) {
    const d = docOf(s.id);
    let blocks = s.blocks.slice();
    // fold small undated subsections (level ≥ 4) into their parent's slide
    s.children.forEach((c) => { const k = d.byId[c]; if (k.level >= 4 && k.words < 60) blocks = blocks.concat(k.blocks); });
    const rank = (b) => (b.kind ? KORDER.indexOf(b.kind) : 10);
    const picked = blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.plain.length > 12)
      .sort((x, y) => rank(x.b) - rank(y.b) || x.i - y.i).slice(0, max).sort((x, y) => (x.b.kind && y.b.kind ? 0 : 0) || x.i - y.i);
    return picked.map(({ b }) => b);
  }
  function buildSlides(docs) {
    const out = [];
    for (const d of docs) {
      if (d.log) {
        out.push({ type: 'proj-title', doc: d });
        d.log.entries.forEach((e) => {
          out.push({ type: 'entry', e, doc: d });
          e.scenarios.forEach((sc) => out.push({ type: 'scenario', e, sc, doc: d }));
        });
        const open = projOpen(d).filter((o) => !o.done);
        if (open.length) out.push({ type: 'proj-open', doc: d, open });
        continue;
      }
      out.push({ type: 'title', doc: d });
      const walk = (s) => {
        if (s.level > 0) {
          const kids = s.children.map((c) => d.byId[c]);
          const hasContent = s.words >= 25 || s.tables.length || s.mermaid.length || s.charts.length || s.steps.length;
          if (!hasContent && kids.length) out.push({ type: 'divider', s, doc: d });
          else out.push({ type: 'content', s, doc: d });
        }
        s.children.forEach((c) => { const k = d.byId[c]; if (!(k.level >= 4 && k.words < 60)) walk(k); });
      };
      walk(d.sections[0]);
      if (d.items.some((b) => b.kind === 'decision')) out.push({ type: 'summary', kind: 'decision', doc: d });
      if (d.items.some((b) => b.kind === 'open')) out.push({ type: 'summary', kind: 'open', doc: d });
    }
    return out;
  }
  function slideTitle(sl) {
    if (sl.type === 'proj-title') return sl.doc.log.project;
    if (sl.type === 'entry') return (sl.e.date ? fmtDate(sl.e.date) + ' · ' : '') + sl.e.title;
    if (sl.type === 'proj-open') return 'Open items';
    if (sl.type === 'scenario') return 'Example · ' + (sl.sc.title || sl.e.title);
    if (sl.type === 'title') return sl.doc.title;
    if (sl.type === 'summary') return sl.kind === 'open' ? 'Open items' : 'Decisions';
    return secLabel(sl.s);
  }
  function renderSlide(sl, i, n) {
    const el = document.createElement('div');
    el.className = 'slide';
    const d = sl.doc;
    const foot = `<div class="foot"><span>${esc(d.title.length > 80 ? d.title.slice(0, 79) + '…' : d.title)}</span><span>${i + 1} / ${n}</span></div>`;
    if (sl.type === 'proj-title') {
      const L = d.log;
      el.classList.add('proj-slide');
      el.innerHTML = `<div class="kick">${esc(L.status || 'project log')} · ${L.entries.length} entries</div>
        <div class="ps-grid"><div><h1 class="ps-h1">${esc(L.project)}</h1>${L.goal ? `<div class="status">${inline(L.goal)}</div>` : ''}${L.now && L.now.summary ? `<p class="ps-sum">${inline(L.now.summary)}</p>` : ''}</div>
        <div class="vis">${L.now && L.now.diagrams[0] ? mmBox(L.now.diagrams[0]) : ''}</div></div>${foot}`;
      el._vis = { kind: 'mermaid' };
      return el;
    }
    if (sl.type === 'entry') {
      const e = sl.e;
      const df = MDV.diffDiagrams(e.before[0], e.after[0]);
      const diag = df.before || df.after || e.diagrams[0];
      const decs = e.decisions.slice(0, 3).map((b) => decTitle(b));
      el.classList.add('entry-slide');
      el.innerHTML = `<div class="kick">${e.date ? fmtDate(e.date, { weekday: 'short', year: 'numeric' }) : 'entry ' + (e.index + 1)}</div>
        <h2>${esc(e.title)}</h2>${e.summary ? `<p class="es-sum">${inline(MDV.summarize(e.summary, 230))}</p>` : ''}
        ${diag ? `<div class="es-ba ${df.before && df.after ? 'two' : ''}">${df.before ? `<figure><figcaption>Before</figcaption>${mmBox(df.before)}</figure>` : ''}${df.before && df.after ? '<div class="ba-arrow">→</div>' : ''}${df.after ? `<figure><figcaption>After</figcaption>${mmBox(df.after)}</figure>` : ''}${!df.before && !df.after ? `<figure>${mmBox(diag)}</figure>` : ''}</div>`
          : `<div class="chart"></div>`}
        ${decs.length ? `<div class="es-dec">${decs.map((t) => `<span class="dec-pill"><i>◆</i>${inline(t)}</span>`).join('')}</div>` : ''}${foot}`;
      const tb = e.results.map((id) => d.tables.find((t) => t.id === id))[0];
      el._vis = diag ? { kind: 'mermaid' } : tb ? { kind: 'chart', tb, doc: d } : null;
      return el;
    }
    if (sl.type === 'scenario') {
      el.classList.add('scn-slide');
      el.innerHTML = `<div class="kick">${esc(sl.e.title)} · example</div><h2>${esc(sl.sc.title || 'Where it failed, and the fix')}</h2><div class="scn"></div>${foot}`;
      el._vis = { kind: 'scenario', sc: sl.sc, doc: d };
      return el;
    }
    if (sl.type === 'proj-open') {
      el.innerHTML = `<div class="kick">${esc(d.log.project)}</div><h2>Open items</h2>
        <div class="sbody"><ul class="pts">${sl.open.slice(0, 7).map((o) => `<li style="--kc:var(--k-open)"><i>○</i><span>${inline(MDV.summarize(o.md, 200))}${o.entry ? ` <span class="meta">— ${esc(o.entry.title)}</span>` : ''}</span></li>`).join('')}</ul></div>${foot}`;
      return el;
    }
    if (sl.type === 'title') {
      const st = MDV.stats(d);
      el.classList.add('title-slide');
      el.innerHTML = `<div class="kick">${esc(d.name)}${d.span ? ` · ${fmtDate(d.span[0], { year: 'numeric' })} → ${fmtDate(d.span[1], { year: 'numeric' })}` : ''}</div>
        <h1>${esc(d.title)}</h1>${d.status ? `<div class="status">${inline(MDV.summarize(d.status, 260))}</div>` : ''}
        <div class="tiles">${[['Sections', st.sections], ...KORDER.filter((k) => st[k]).map((k) => [KINDS[k].label + 's', st[k], k]), ['Tables', st.tables]].map(([l, v, k]) => `<div class="tile"><div class="v">${v}</div><div class="l">${k ? `<i style="font-style:normal;color:var(--k-${k})">${KINDS[k].icon}</i>` : ''}${l}</div></div>`).join('')}</div>${foot}`;
      return el;
    }
    if (sl.type === 'summary') {
      const items = d.items.filter((b) => b.kind === sl.kind).slice(-6);
      el.innerHTML = `<div class="kick">Summary</div><h2>${sl.kind === 'open' ? 'Open items' : 'Decisions'}</h2>
        <div class="sbody"><ul class="pts">${items.map((b) => `<li style="--kc:var(--k-${b.kind})"><i>${KINDS[b.kind].icon}</i><span>${inline(MDV.summarize(b.md, 190))} <span class="meta">— ${esc(shortLabel(sec(b.sectionId), 40))}</span></span></li>`).join('')}</ul></div>${foot}`;
      return el;
    }
    const s = sl.s;
    const kick = `<div class="kick">${s.parent && d.byId[s.parent].level > 0 ? esc(shortLabel(d.byId[s.parent], 50)) : esc(d.title.length > 60 ? d.title.slice(0, 59) + '…' : d.title)}${s.when ? ` <span>· ${fmtDate(s.when, { year: 'numeric' })}</span>` : ''}</div>`;
    const title = `<h2>${s.num ? `<span style="color:var(--muted)">${esc(s.num)}</span> ` : ''}${esc(s.title)}</h2>`;
    if (sl.type === 'divider') {
      el.classList.add('divider');
      const kids = s.children.map((c) => d.byId[c]);
      el.innerHTML = `${kick}${s.num ? `<div class="num">${esc(s.num)}</div>` : ''}<h2>${esc(s.title)}</h2>
        <div class="kids-grid ${kids.length > 9 ? 'dense' : ''}">${kids.slice(0, kids.length > 16 ? 15 : 16).map((k) => `<div class="k"><b>${k.num ? esc(k.num) + ' ' : ''}</b>${esc(k.title.length > 52 ? k.title.slice(0, 51) + '…' : k.title)}<div class="m">${[k.own ? fmtDate(k.own) : '', glyphs(k.kinds)].filter(Boolean).join(' · ')}</div></div>`).join('')}${kids.length > 16 ? `<div class="k meta">+${kids.length - 15} more</div>` : ''}</div>${foot}`;
      return el;
    }
    // content slide: key points + one visual
    const tb = s.tables.map((id) => d.tables.find((t) => t.id === id)).find((t) => t && t.numeric) || s.tables.map((id) => d.tables.find((t) => t.id === id))[0];
    let vis = '';
    let visKind = null;
    if (s.charts.length) { visKind = 'spec'; vis = `<div class="cap">${esc(s.charts[0].title || '')}</div><div class="chart"></div>`; }
    else if (tb && tb.numeric && tableUI(tb, d).type) { visKind = 'chart'; vis = `<div class="cap">${esc(tb.header.slice(0, 4).join(' · '))}</div><div class="chart"></div>`; }
    else if (s.mermaid.length) { visKind = 'mermaid'; vis = `<div class="mermaid-box"><pre class="mdv-mm">${esc(s.mermaid[0])}</pre></div>`; }
    else if (tb) {
      visKind = 'table';
      const rows = tb.rows.slice(0, 7);
      vis = `<div class="tablewrap"><table><thead><tr>${tb.header.slice(0, 4).map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.slice(0, 4).map((c, ci) => `<td class="${tb.cols[ci].type !== 'text' ? 'num' : ''}">${inline(MDV.summarize(c.md, 70))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${tb.rows.length > 7 ? `<div class="cap">+${tb.rows.length - 7} more rows</div>` : ''}`;
    } else if (s.steps.length >= 2) {
      visKind = 'steps';
      vis = `<div class="steps">${s.steps.slice(0, 8).map((x) => `<div class="step ${x.done ? 'done' : ''}"><div class="n">${x.done ? '✓' : x.n}</div><div class="x" style="font-size:15px">${inline(MDV.summarize(x.md, 90))}</div></div>`).join('')}</div>`;
    } else if (s.code.length) {
      visKind = 'code';
      vis = `<pre><code>${esc(s.code[0].text.split('\n').slice(0, 16).join('\n'))}</code></pre>`;
    }
    const pts = pointsFor(s, vis ? 4 : 6);
    const lim = vis ? 200 : 260;
    const ptsHtml = `<ul class="pts">${pts.map((b) => `<li style="--kc:${b.kind ? `var(--k-${b.kind})` : 'var(--axis)'}"><i>${b.kind ? KINDS[b.kind].icon : '—'}</i><span>${b.kind ? `<span class="kt">${KINDS[b.kind].label}</span>` : ''}${inline(MDV.summarize(b.md.replace(/^\s*\*\*[^*]+\*\*:?\s*/, (m) => (b.kind ? '' : m)), lim))}</span></li>`).join('')}</ul>`;
    el.innerHTML = `${kick}${title}<div class="sbody ${vis && pts.length ? 'two' : ''}">${pts.length ? ptsHtml : ''}${vis ? `<div class="vis">${vis}</div>` : ''}</div>${foot}`;
    el._vis = { kind: visKind, tb, spec: s.charts[0], doc: d };
    return el;
  }
  function hydrateSlide(el) {
    const v = el._vis;
    if (!v) return;
    const ch = $('.chart', el);
    if (v.kind === 'chart') {
      const ui = Object.assign({}, tableUI(v.tb, v.doc));
      const nRows = v.tb.rows.length;
      renderTableChart(ch, v.tb, ui, { width: 560, labelWidth: 190, compact: true });
      if (nRows > 16) { const svg = $('svg', ch); if (svg) { const h = +svg.getAttribute('height'); const sc = Math.min(1, 440 / h); svg.style.transformOrigin = 'top left'; svg.style.transform = `scale(${sc})`; ch.style.height = h * sc + 'px'; } }
    } else if (v.kind === 'spec') drawSpec(ch, v.spec, v.doc);
    else if (v.kind === 'mermaid') return renderMermaid(el);
    else if (v.kind === 'scenario') drawScenario($('.scn', el), v.sc, { static: !!document.body.classList.contains('printing'), startEnd: true, width: 1140, terms: v.doc.log.terms });
  }
  function viewSlides(main, docs) {
    const slides = buildSlides(docs);
    S.slide = Math.min(S.slide, slides.length - 1);
    main.innerHTML = `<div class="view wide"><div class="slides-view">
      <div class="slides-bar"><button class="btn" data-a="prev">◀</button><span class="count"></span><button class="btn" data-a="next">▶</button>
        <span class="spacer"></span><span class="meta">← → to move · F to present</span><button class="btn" data-a="present">Present</button><button class="btn primary" data-a="pdf">Export PDF</button></div>
      <div class="stage"><div class="stage-inner"></div></div>
      <div class="filmstrip">${slides.map((sl, i) => `<button data-i="${i}"><b>${i + 1} · ${sl.type}</b>${esc(slideTitle(sl).slice(0, 60))}</button>`).join('')}</div>
    </div></div>`;
    const stage = $('.stage', main), inner = $('.stage-inner', main);
    const fitStage = () => {
      const r = stage.getBoundingClientRect();
      const k = Math.min((r.width - 40) / 1280, (r.height - 40) / 720);
      inner.style.transform = `scale(${Math.max(0.1, k)})`;
      inner.style.margin = `${(720 * k - 720) / 2}px ${(1280 * k - 1280) / 2}px`;
    };
    const show = (i) => {
      S.slide = Math.max(0, Math.min(slides.length - 1, i));
      inner.innerHTML = '';
      const el = renderSlide(slides[S.slide], S.slide, slides.length);
      inner.appendChild(el);
      // mermaid measures labels on screen, so draw at 1:1 and scale the stage afterwards
      if (el._vis && el._vis.kind === 'mermaid') {
        inner.style.transform = 'none'; inner.style.visibility = 'hidden';
        Promise.resolve(hydrateSlide(el)).then(() => { inner.style.visibility = ''; fitStage(); });
      } else hydrateSlide(el);
      $('.count', main).textContent = `${S.slide + 1} / ${slides.length}`;
      $$('.filmstrip button', main).forEach((b) => b.classList.toggle('cur', +b.dataset.i === S.slide));
      const cur = $('.filmstrip .cur', main);
      if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    fitStage();
    show(S.slide);
    new ResizeObserver(fitStage).observe(stage);
    main.querySelector('.slides-view').addEventListener('click', (e) => {
      const a = e.target.dataset.a;
      if (a === 'prev') show(S.slide - 1);
      if (a === 'next') show(S.slide + 1);
      if (a === 'present') present(stage);
      if (a === 'pdf') printSlides();
      const fb = e.target.closest('.filmstrip button');
      if (fb) show(+fb.dataset.i);
    });
    S.slideKeys = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); show(S.slide + 1); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); show(S.slide - 1); }
      if (e.key === 'f' || e.key === 'F') present(stage);
      if (e.key === 'Home') show(0);
      if (e.key === 'End') show(slides.length - 1);
    };
  }
  function present(stage) {
    document.body.classList.add('presenting');
    (stage.requestFullscreen ? stage.requestFullscreen() : Promise.resolve()).catch(() => {});
    document.addEventListener('fullscreenchange', function off() { if (!document.fullscreenElement) { document.body.classList.remove('presenting'); document.removeEventListener('fullscreenchange', off); } });
  }

  // ======================================================================
  // Terms: hover a diagram node or an underlined word for a one-line explanation
  // ======================================================================
  function termsFor(root) {
    const d = root && root.closest && root.closest('[data-doc]') ? S.docs[+root.closest('[data-doc]').dataset.doc] : currentLog();
    return d && d.log ? d.log.terms : [];
  }
  const normT = (x) => String(x || '').toLowerCase().replace(/\s+/g, ' ').trim();
  function findTerm(terms, label) {
    const l = normT(label);
    if (!l) return null;
    for (const t of terms) for (const n of t.names) { const k = normT(n); if (l === k || l.startsWith(k + ' ') || l.startsWith(k + '\n')) return t; }
    for (const t of terms) for (const n of t.names) { const k = normT(n); if (k.length > 3 && new RegExp('(^|\\W)' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|\\W)').test(l)) return t; }
    return null;
  }
  const termTip = (t) => `<b>${esc(t.term)}</b><br><span class="tm">${inline(t.md)}</span>`;
  function termNodes(root) {
    const terms = termsFor(root);
    if (!terms.length) return;
    $$('.mm svg g.node, .mm svg .actor-top, .mm svg g[class*="actor"]', root).forEach((g) => {
      const label = (g.querySelector('.nodeLabel') || g).textContent;
      const t = findTerm(terms, label.split('\n')[0]) || findTerm(terms, label);
      if (!t) return;
      g.classList.add('mdv-term');
      g.addEventListener('mousemove', (e) => showTip(e, termTip(t)));
      g.addEventListener('mouseleave', hideTip);
    });
  }
  // underline the first mention of each term inside text blocks
  function termify(root, terms) {
    if (!terms || !terms.length) return;
    const seen = new Set();
    $$('.dec-b, .dec-t span, .sum, .scn-cap, .scn-note', root).forEach((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest('code,abbr,a') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach((n) => {
        for (const t of terms) {
          if (seen.has(t.term)) continue;
          for (const name of t.names) {
            if (name.length < 3) continue;
            const re = new RegExp('(^|[^\\w])(' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![\\w])', 'i');
            const m = re.exec(n.nodeValue);
            if (!m) continue;
            const at = m.index + m[1].length;
            const after = n.splitText(at);
            after.splitText(m[2].length);
            const ab = document.createElement('abbr');
            ab.className = 'term'; ab.dataset.term = t.term; ab.textContent = after.nodeValue;
            after.replaceWith(ab);
            seen.add(t.term);
            return;
          }
        }
      });
    });
    root.addEventListener('mousemove', (e) => {
      const ab = e.target.closest && e.target.closest('abbr.term');
      if (!ab) return;
      const t = terms.find((x) => x.term === ab.dataset.term);
      if (t) showTip(e, termTip(t));
    });
    root.addEventListener('mouseout', (e) => { if (e.target.closest && e.target.closest('abbr.term')) hideTip(); });
  }

  // ======================================================================
  // Scenario: lanes over time, Before vs After, with a playhead
  //   {"title", "unit", "lanes": [..], "illustrative": true,
  //    "before": {"caption", "result", "events": [{"lane","from","to"|"at","text","status": "bad"|"good"|"wait"}]},
  //    "after": {...}}
  // ======================================================================
  const SCN_STATUS = { bad: { c: 'var(--crit)', i: '✗' }, good: { c: 'var(--good)', i: '✓' }, wait: { c: 'var(--muted)', i: '⏸' } };
  function drawScenario(box, sc, opts) {
    opts = opts || {};
    const sides = ['before', 'after'].filter((k) => sc[k] && Array.isArray(sc[k].events));
    if (!sides.length) { box.innerHTML = '<div class="empty-note">Scenario has no events.</div>'; return; }
    const lanes = sc.lanes || [...new Set(sides.flatMap((k) => sc[k].events.map((e) => e.lane)))];
    const evs = (k) => sc[k].events.map((e) => ({ ...e, a: e.at != null ? +e.at : +e.from, b: e.at != null ? +e.at : +e.to, point: e.at != null }));
    const all = sides.flatMap(evs);
    const T0 = Math.min(0, ...all.map((e) => e.a)), T1 = Math.max(...all.map((e) => e.b)) + 0.5;
    const stops = [...new Set(all.flatMap((e) => (e.point ? [e.a] : [e.a, e.b])))].sort((x, y) => x - y);
    const st = { mode: opts.static ? 'both' : (sides.length > 1 ? 'both' : sides[0]), t: opts.static ? T1 : opts.startEnd ? stops[stops.length - 1] : stops[0], timer: null };
    const unit = sc.unit || 'cycle';
    // pack overlapping events of a lane into sub-rows
    const pack = (list) => {
      const rows = {};
      lanes.forEach((l) => { rows[l] = []; });
      list.slice().sort((x, y) => x.a - y.a).forEach((e) => {
        const r = rows[e.lane] || (rows[e.lane] = []);
        const w = e.point ? 0.6 : 0;
        let i = r.findIndex((end) => end <= e.a - (e.point ? 0.3 : 0) + 1e-9);
        if (i < 0) { i = r.length; r.push(0); }
        r[i] = e.b + w; e.sub = i;
      });
      return rows;
    };
    const panel = (k) => {
      const list = evs(k);
      const rows = pack(list);
      const W = Math.max(420, opts.width || box.clientWidth || 800), labW = 128, right = 18, rowH = 30, top = 22;
      const laneY = {}; let y = top;
      lanes.forEach((l) => { laneY[l] = y; y += Math.max(1, (rows[l] || []).length) * rowH + 8; });
      const H = y + 4;
      const x = (t) => labW + ((t - T0) / (T1 - T0)) * (W - labW - right);
      const ticks = niceTicks(T0, T1, 8).filter((t) => t <= T1);
      let svg = `<svg class="scn-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><pattern id="scn-hatch-${k}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--surface-2)"/><line x1="0" y1="0" x2="0" y2="6" stroke="var(--axis)" stroke-width="2"/></pattern></defs>`;
      ticks.forEach((t) => { svg += `<line class="gl" x1="${x(t)}" x2="${x(t)}" y1="${top - 6}" y2="${H}"/><text class="tk" x="${x(t)}" y="${top - 10}" text-anchor="middle">${fmtNum(t)}</text>`; });
      lanes.forEach((l) => { const h = Math.max(1, (rows[l] || []).length) * rowH; svg += `<rect class="lane-bg" x="${labW}" y="${laneY[l] - 2}" width="${W - labW - right}" height="${h + 4}" rx="6"/><text class="lane" x="${labW - 10}" y="${laneY[l] + h / 2 + 4}" text-anchor="end">${esc(l)}</text>`; });
      list.forEach((e, i) => {
        const yy = laneY[e.lane] + e.sub * rowH + 3, h = rowH - 6;
        const S2 = SCN_STATUS[e.status] || null;
        const col = S2 ? S2.c : 'var(--s1)';
        const cls = `ev ${e.status || ''}`;
        const data = `data-i="${i}" data-a="${e.a}" data-b="${e.b}"`;
        if (e.point) {
          const cx = x(e.a), cy = yy + h / 2;
          svg += `<g class="${cls}" ${data}><path d="M${cx},${cy - 9}L${cx + 9},${cy}L${cx},${cy + 9}L${cx - 9},${cy}Z" fill="${col}"/><text class="ev-t pt" x="${cx + 13}" y="${cy + 4}">${S2 ? S2.i + ' ' : ''}${esc(e.text || '')}</text></g>`;
        } else {
          const x0 = x(e.a), x1 = Math.max(x(e.b), x0 + 4);
          const fill = e.status === 'wait' ? `url(#scn-hatch-${k})` : col;
          svg += `<g class="${cls}" ${data}><rect x="${x0}" y="${yy}" width="${x1 - x0}" height="${h}" rx="6" fill="${fill}" ${e.status === 'wait' ? 'stroke="var(--axis)"' : ''}/><text class="ev-t ${e.status === 'wait' ? 'dark' : ''}" x="${x0 + 8}" y="${yy + h / 2 + 4}">${S2 && e.status !== 'wait' ? S2.i + ' ' : ''}${esc(e.text || '')}</text></g>`;
        }
      });
      svg += `<line class="playhead" x1="0" x2="0" y1="${top - 8}" y2="${H}"/></svg>`;
      return { svg, x, list };
    };
    const render = () => {
      const show = st.mode === 'both' ? sides : [st.mode];
      const parts = show.map((k) => ({ k, p: panel(k) }));
      box.innerHTML = `<div class="scn-h"><span class="scn-title">${esc(sc.title || 'Example')}</span>${sc.illustrative ? '<span class="badge" title="Timing is schematic: it shows the mechanism, not measured cycles">illustrative</span>' : ''}
          ${sides.length > 1 && !opts.static ? `<span class="seg">${['before', 'after', 'both'].map((m) => `<button data-mode="${m}" class="${st.mode === m ? 'on' : ''}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</span>` : ''}</div>
        ${parts.map(({ k, p }) => `<div class="scn-panel ${k}"><div class="scn-ph"><span class="scn-side ${k}">${k === 'before' ? 'Before' : 'After'}</span>${sc[k].result ? `<span class="scn-res">${inline(sc[k].result)}</span>` : ''}</div>
          ${sc[k].caption ? `<div class="scn-note">${inline(sc[k].caption)}</div>` : ''}<div class="scn-plot">${p.svg}</div></div>`).join('')}
        ${opts.static ? '' : `<div class="scn-ctrl"><button class="btn small" data-act="play">${st.timer ? '❚❚ Pause' : '▶ Play'}</button><button class="btn small" data-act="prev">◀</button><button class="btn small" data-act="next">▶</button>
          <input type="range" min="0" max="${stops.length - 1}" step="1" value="${Math.max(0, stops.indexOf(st.t))}"><span class="scn-t">${esc(unit)} <b>${fmtNum(st.t)}</b></span></div>
        <div class="scn-cap"></div>`}`;
      parts.forEach(({ k, p }) => {
        const svg = $(`.scn-panel.${k} svg`, box);
        const ph = $('.playhead', svg);
        ph.setAttribute('x1', p.x(st.t)); ph.setAttribute('x2', p.x(st.t));
        if (opts.static) ph.style.display = 'none';
        $$('.ev', svg).forEach((g) => {
          const a = +g.dataset.a, b = +g.dataset.b;
          g.classList.toggle('future', !opts.static && a > st.t + 1e-9);
          g.classList.toggle('now', !opts.static && a <= st.t + 1e-9 && (b >= st.t - 1e-9));
          const e = p.list[+g.dataset.i];
          g.addEventListener('mousemove', (ev) => showTip(ev, `<b>${esc(e.lane)}</b> · ${esc(unit)} ${e.point ? fmtNum(e.a) : fmtNum(e.a) + '–' + fmtNum(e.b)}<br>${SCN_STATUS[e.status] ? SCN_STATUS[e.status].i + ' ' : ''}${esc(e.text || '')}${e.note ? `<br><span class="tm">${esc(e.note)}</span>` : ''}`));
          g.addEventListener('mouseleave', hideTip);
        });
      });
      const cap = $('.scn-cap', box);
      if (cap) {
        const lines = parts.map(({ k, p }) => {
          const hits = p.list.filter((e) => Math.abs(e.a - st.t) < 1e-9 || (!e.point && Math.abs(e.b - st.t) < 1e-9 && false));
          if (!hits.length) return '';
          return `<div class="cap-row"><span class="scn-side ${k}">${k === 'before' ? 'Before' : 'After'}</span>${hits.map((e) => `<span class="cap-ev ${e.status || ''}">${SCN_STATUS[e.status] ? `<i>${SCN_STATUS[e.status].i}</i>` : ''}<b>${esc(e.lane)}</b> ${esc(e.text || '')}</span>`).join('')}</div>`;
        }).join('');
        cap.innerHTML = lines || `<span class="meta">Nothing starts at ${esc(unit)} ${fmtNum(st.t)}. Step or press Play.</span>`;
        termify(box, opts.terms);
      }
    };
    const step = (dir) => { const i = stops.indexOf(st.t); const j = Math.max(0, Math.min(stops.length - 1, (i < 0 ? 0 : i) + dir)); st.t = stops[j]; render(); return j; };
    const stopPlay = () => { clearInterval(st.timer); st.timer = null; };
    if (!opts.static) {
      box.addEventListener('click', (e) => {
        const m = e.target.closest('[data-mode]');
        if (m) { st.mode = m.dataset.mode; return render(); }
        const a = e.target.closest('[data-act]');
        if (!a) return;
        if (a.dataset.act === 'play') {
          if (st.timer) { stopPlay(); return render(); }
          if (stops.indexOf(st.t) === stops.length - 1) st.t = stops[0];
          st.timer = setInterval(() => { if (!document.body.contains(box)) return stopPlay(); if (step(1) >= stops.length - 1) { stopPlay(); render(); } }, 1100);
          render();
        }
        if (a.dataset.act === 'prev') { stopPlay(); step(-1); }
        if (a.dataset.act === 'next') { stopPlay(); step(1); }
      });
      box.addEventListener('input', (e) => { if (e.target.type === 'range') { stopPlay(); st.t = stops[+e.target.value]; render(); } });
    }
    render();
  }

  // ======================================================================
  // Project logs (template/project-log.md): Timeline · System · Decisions
  // ======================================================================
  const logDocs = () => activeDocs().filter((d) => d.log);
  function currentLog() {
    const logs = logDocs();
    const d = logs.find((x) => x.name === S.project) || logs[0];
    if (d) S.project = d.name;
    return d;
  }
  const mmBox = (src, cls) => `<div class="mm ${cls || ''}" title="Click to enlarge"><pre class="mdv-mm">${esc(src)}</pre></div>`;
  // diagrams keep their natural size up to the box; tall ones are capped by CSS
  // scale each rendered diagram to its box: small ones grow (up to 1.7×), wide or tall ones shrink
  function fitMermaid(root) {
    $$('.mm', root).forEach((box) => {
      const svg = $('svg', box);
      if (!svg) return;
      const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
      if (vb.length !== 4 || !vb[2] || !vb[3]) return;
      let mh = box.classList.contains('big') ? 600 : box.classList.contains('small') ? 300 : box.classList.contains('thumb') ? 150 : 440;
      if (box.closest('.es-ba')) mh = 300;
      else if (box.closest('.slide')) mh = 430;
      const cw = box.clientWidth || 600;
      const k = Math.min(cw / vb[2], mh / vb[3], 1.25);
      svg.style.maxWidth = 'none'; svg.style.maxHeight = 'none';
      svg.style.width = Math.round(vb[2] * k) + 'px'; svg.style.height = Math.round(vb[3] * k) + 'px';
    });
  }
  function wireZoom(root) {
    root.addEventListener('click', (e) => {
      const box = e.target.closest('.mm');
      if (!box) return;
      const svg = $('svg', box);
      if (!svg) return;
      const z = $('#zoom');
      z.innerHTML = '<div class="zoom-card"></div>';
      const c = svg.cloneNode(true);
      c.removeAttribute('style'); c.setAttribute('width', '100%'); c.setAttribute('height', '100%');
      $('.zoom-card', z).appendChild(c);
      z.hidden = false;
    });
  }
  const decTitle = (b) => { const m = /^\s*\*\*(.+?)\*\*/.exec(b.md); return (m ? m[1] : MDV.summarize(b.plain, 70)).replace(/[.:]\s*$/, ''); };
  function decCard(b) {
    const m = /^\s*\*\*(.+?)\*\*\s*([\s\S]*)$/.exec(b.md);
    const title = decTitle(b), body = m ? m[2] : (m ? '' : '');
    const rejected = /^rejected\b/i.test(title);
    return `<div class="dec ${rejected ? 'rej' : ''}" data-block="${b.id}"><div class="dec-t"><i>${rejected ? '✕' : '◆'}</i><span>${hl(inline(title))}</span></div>${body ? `<div class="dec-b">${hl(inline(body))}</div>` : ''}</div>`;
  }
  function projOpen(d) {
    const L = d.log, out = [];
    (L.now ? L.now.open : []).forEach((o) => out.push(Object.assign({ entry: null }, o)));
    L.entries.slice().reverse().forEach((e) => e.open.forEach((o) => out.push(Object.assign({ entry: e }, o))));
    return out;
  }
  const openList = (items) => `<ul class="open-list">${items.map((o) => `<li class="${o.done ? 'done' : ''}"><i>${o.done ? '☑' : '☐'}</i><span>${inline(o.md)}${o.entry ? ` <a href="#" class="entry-link" data-entry="${o.entry.index}">${esc(o.entry.date ? fmtDate(o.entry.date) : '#' + (o.entry.index + 1))} · ${esc(o.entry.title)}</a>` : ''}</span></li>`).join('')}</ul>`;
  function projHeader(d) {
    const L = d.log, logs = logDocs();
    const dates = L.entries.map((e) => e.date).filter(Boolean).sort();
    return `<header class="proj-h">
      ${logs.length > 1 ? `<div class="proj-switch">${logs.map((x) => `<button class="chip ${x === d ? 'on' : ''}" data-proj="${esc(x.name)}"><span class="dot" style="background:${docColor(x.index)}"></span>${esc(x.log.project)}</button>`).join('')}</div>` : ''}
      <div class="proj-title"><h1>${esc(L.project)}</h1>${L.status ? `<span class="status-chip">${esc(L.status)}</span>` : ''}</div>
      ${L.goal ? `<p class="goal">${inline(L.goal)}</p>` : ''}
      <div class="meta">${L.entries.length} entries${dates.length ? ` · ${fmtDate(dates[0])} → ${fmtDate(dates[dates.length - 1], { year: 'numeric' })}` : ''}${L.code ? ` · <span class="mono">${esc(L.code)}</span>` : ''}</div>
    </header>`;
  }
  function projWire(v, main, docs) {
    const dd = currentLog();
    if (dd) { v.dataset.doc = dd.index; termify(v, dd.log.terms); }
    v.addEventListener('click', (e) => {
      const p = e.target.closest('[data-proj]');
      if (p) { S.project = p.dataset.proj; return render(); }
      const en = e.target.closest('[data-entry]');
      if (en) { e.preventDefault(); (S.entryIdx = S.entryIdx || {})[S.project] = +en.dataset.entry; return setView('timeline'); }
    });
    wireZoom(v);
    renderMermaid(v);
    fitMermaid(v);
  }
  function diffLegend(df) {
    const clean = (x) => esc(String(x).split(/<br\s*\/?>/i)[0]);
    const part = (k, lbl, list) => (list.length ? `<span class="dl ${k}"><i></i>${lbl}: ${list.slice(0, 5).map(clean).join(', ')}${list.length > 5 ? ` +${list.length - 5}` : ''}</span>` : '');
    const html = part('added', 'added', df.added) + part('changed', 'changed', df.changed) + part('removed', 'removed', df.removed);
    return html ? `<div class="diff-legend">${html}</div>` : '';
  }

  function viewProject(main, docs) {
    const d = currentLog(), L = d.log, E = L.entries;
    S.entryIdx = S.entryIdx || {};
    if (S.entryArg != null) { S.entryIdx[d.name] = S.entryArg; S.entryArg = null; }
    let i = S.entryIdx[d.name];
    if (i == null || i >= E.length) i = E.length - 1;
    const v = document.createElement('div');
    v.className = 'view proj';
    main.appendChild(v);
    if (!E.length) { v.innerHTML = projHeader(d) + '<p class="empty-note">No log entries yet. Add one under <code>## Log</code>.</p>'; return projWire(v, main, docs); }
    let strip = '<div class="strip">';
    E.forEach((e, k) => {
      if (k > 0 && e.date && E[k - 1].date) {
        const gap = Math.round((Date.parse(e.date) - Date.parse(E[k - 1].date)) / 864e5);
        if (gap > 1) strip += `<div class="gap" title="${gap} days later">+${gap}d</div>`;
      }
      const dim = S.q && !matches(e.title, e.summary, e.decisions.map((b) => b.plain).join(' ')) ? 'dimmed' : '';
      strip += `<button class="stop ${k === i ? 'cur' : ''} ${dim}" data-k="${k}"><span class="dt">${e.date ? fmtDate(e.date) : '#' + (k + 1)}</span><span class="pin"></span><span class="tt">${esc(e.title)}</span></button>`;
    });
    strip += '</div>';
    const e = E[i];
    const df = MDV.diffDiagrams(e.before[0], e.after[0]);
    const fig = (cap, main1, rest) => `<figure><figcaption>${cap}</figcaption>${mmBox(main1)}${rest.map((x) => mmBox(x)).join('')}</figure>`;
    let html = projHeader(d) + strip + `<article class="entry">
      <div class="entry-h">
        <div class="entry-nav"><button class="btn small" data-step="-1" ${i === 0 ? 'disabled' : ''}>← Earlier</button><span class="meta">${i + 1} of ${E.length}</span><button class="btn small" data-step="1" ${i === E.length - 1 ? 'disabled' : ''}>Later →</button></div>
        <div class="kick">${e.date ? fmtDate(e.date, { weekday: 'long', year: 'numeric', month: 'long' }) : 'undated'}</div>
        <h2>${esc(e.title)}</h2>${e.summary ? `<p class="sum">${inline(e.summary)}</p>` : ''}
      </div>`;
    if (df.before || df.after) {
      html += `<div class="ba ${df.before && df.after ? 'two' : ''}">${df.before ? fig('Before', df.before, e.before.slice(1)) : ''}${df.before && df.after ? '<div class="ba-arrow">→</div>' : ''}${df.after ? fig('After', df.after, e.after.slice(1)) : ''}</div>${diffLegend(df)}`;
    }
    if (e.diagrams.length) html += `<div class="ba">${e.diagrams.map((x) => `<figure>${mmBox(x)}</figure>`).join('')}</div>`;
    if (e.scenarios.length) html += `<section class="eblock"><h3>Example: where it failed, and the fix</h3>${e.scenarios.map((x, j) => `<div class="scn" data-scn="${j}"></div>`).join('')}</section>`;
    if (e.decisions.length || e.decisionDiagrams.length) html += `<section class="eblock"><h3>Decisions</h3><div class="dec-grid">${e.decisions.map(decCard).join('')}</div>${e.decisionDiagrams.map((x) => mmBox(x, 'small')).join('')}</section>`;
    if (e.results.length || e.resultCharts.length) html += `<section class="eblock"><h3>Results</h3><div class="res"></div></section>`;
    if (e.open.length) html += `<section class="eblock"><h3>Open</h3>${openList(e.open)}</section>`;
    html += `<div class="entry-foot"><a href="#" data-sec="${e.id}">Read the full entry →</a></div></article>`;
    v.innerHTML = html;
    const res = $('.res', v);
    if (res) {
      e.resultCharts.forEach((c) => { const box = document.createElement('div'); box.className = 'chart'; res.appendChild(box); requestAnimationFrame(() => drawSpec(box, c, d)); });
      e.results.forEach((id) => {
        const tb = d.tables.find((t) => t.id === id);
        if (!tb) return;
        // a chart only when it says more than the table: percent errors, or several rows of numbers
        if (!S.tableUI[tb.id]) { const ui = tableUI(tb, d); if (ui.type !== 'diverging' && tb.rows.length < 4) ui.mode = 'table'; }
        res.appendChild(tableCard(tb, d, { width: Math.min(900, (res.clientWidth || 860)) }));
      });
    }
    $$('[data-scn]', v).forEach((b) => drawScenario(b, e.scenarios[+b.dataset.scn], { terms: L.terms, width: Math.min(1240, (v.clientWidth || 1200) - 56) }));
    const go = (k) => { S.entryIdx[d.name] = Math.max(0, Math.min(E.length - 1, k)); render(); };
    v.addEventListener('click', (ev) => {
      const st = ev.target.closest('.stop'); if (st) return go(+st.dataset.k);
      const nb = ev.target.closest('[data-step]'); if (nb) return go(i + +nb.dataset.step);
    });
    S.entryKeys = (dir) => go(i + dir);
    projWire(v, main, docs);
    requestAnimationFrame(() => { const cur = $('.stop.cur', v); if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center' }); });
  }

  function viewSystem(main, docs) {
    const d = currentLog(), L = d.log;
    const v = document.createElement('div');
    v.className = 'view proj';
    main.appendChild(v);
    let html = projHeader(d);
    if (L.now) {
      html += `<section class="eblock now">${L.now.summary ? `<p class="sum">${inline(L.now.summary)}</p>` : ''}${L.now.diagrams.map((x) => mmBox(x, 'big')).join('')}</section>`;
      if (L.now.tables.length) html += '<section class="eblock"><h3>Where it stands</h3><div class="res"></div></section>';
    } else html += '<p class="empty-note">No <code>## Now</code> section: add the current system diagram there.</p>';
    const open = projOpen(d).filter((o) => !o.done);
    if (open.length) html += `<section class="eblock"><h3>Open</h3>${openList(open)}</section>`;
    if (L.terms.length) html += `<section class="eblock"><h3>Terms</h3><div class="terms">${L.terms.map((t) => `<div class="term-card"><b>${esc(t.names.join(' / '))}</b><span>${inline(t.md)}</span></div>`).join('')}</div></section>`;
    const evo = L.entries.filter((e) => e.after[0] || e.diagrams[0]);
    if (evo.length) html += `<section class="eblock"><h3>How it got here</h3><div class="evo">${evo.map((e) => `<button class="evo-card" data-entry="${e.index}"><div class="evo-h"><span class="meta">${e.date ? fmtDate(e.date) : '#' + (e.index + 1)}</span> ${esc(e.title)}</div>${mmBox(MDV.diffDiagrams(e.before[0], e.after[0]).after || e.diagrams[0], 'thumb')}</button>`).join('')}</div></section>`;
    v.innerHTML = html;
    const res = $('.res', v);
    if (res) L.now.tables.forEach((id) => { const tb = d.tables.find((t) => t.id === id); if (tb) res.appendChild(tableCard(tb, d)); });
    projWire(v, main, docs);
  }

  function viewDecisions(main, docs) {
    const d = currentLog(), L = d.log;
    const v = document.createElement('div');
    v.className = 'view proj';
    main.appendChild(v);
    let html = projHeader(d), n = 0;
    L.entries.slice().reverse().forEach((e) => {
      const decs = e.decisions.filter((b) => matches(b.plain, e.title));
      if (!decs.length && !(e.decisionDiagrams.length && matches(e.title))) return;
      n += decs.length;
      html += `<section class="dgroup"><a href="#" class="dgroup-h" data-entry="${e.index}"><span class="meta">${e.date ? fmtDate(e.date, { year: 'numeric' }) : '#' + (e.index + 1)}</span> ${esc(e.title)}</a>
        <div class="dec-grid">${decs.map(decCard).join('')}</div>${e.decisionDiagrams.map((x) => mmBox(x, 'small')).join('')}</section>`;
    });
    if (!n) html += '<p class="empty-note">No decisions match.</p>';
    v.innerHTML = html;
    projWire(v, main, docs);
  }

  // ======================================================================
  // Read — the document, rendered, with TOC
  // ======================================================================
  function renderSectionBody(s, opts) {
    opts = opts || {};
    const d = docOf(s.id);
    const box = document.createElement('div');
    box.className = 'md';
    box.innerHTML = blockHtml(s.md);
    // classified statements get a colored rule and a tag
    const els = $$('p, li', box).filter((el) => !el.querySelector('p, li'));
    const norm = (t) => t.replace(/\s+/g, ' ').trim().slice(0, 50);
    s.blocks.forEach((b) => {
      const key = norm(b.plain);
      if (!key) return;
      const el = els.find((e) => norm(e.textContent).startsWith(key.slice(0, 40)) || norm(e.textContent).includes(key.slice(0, 40)));
      if (!el) return;
      el.dataset.block = el.dataset.block || b.id;
      if (b.kind && !el.classList.contains('k-mark')) {
        el.classList.add('k-mark');
        el.style.setProperty('--kc', `var(--k-${b.kind})`);
        el.insertAdjacentHTML('afterbegin', `<span class="k-tag"><i>${KINDS[b.kind].icon}</i>${KINDS[b.kind].label}</span>`);
      }
    });
    // tables -> interactive cards
    $$('table', box).forEach((t, i) => {
      const tb = d.tables.find((x) => x.id === s.tables[i]);
      if (!tb) { const w = document.createElement('div'); w.className = 'tablewrap'; t.replaceWith(w); w.appendChild(t); return; }
      const card = tableCard(tb, d, { width: opts.width });
      t.replaceWith(card);
    });
    // code blocks: mermaid + chart specs
    $$('pre > code', box).forEach((c) => {
      const lang = (c.className.match(/language-(\S+)/) || [])[1];
      if (lang === 'mermaid') {
        const div = document.createElement('div');
        div.className = 'mermaid-box';
        div.innerHTML = `<pre class="mdv-mm">${esc(c.textContent)}</pre>`;
        c.parentElement.replaceWith(div);
      } else if (lang === 'scenario') {
        let sc = null;
        try { sc = JSON.parse(c.textContent); } catch (err) { /* leave the code */ }
        if (sc) { const div = document.createElement('div'); div.className = 'scn'; c.parentElement.replaceWith(div); requestAnimationFrame(() => drawScenario(div, sc, { width: Math.min(900, (div.clientWidth || 860)), terms: d.log ? d.log.terms : [] })); }
      } else if (lang === 'chart' || lang === 'viz' || lang === 'mdviz') {
        const spec = s.charts.find((x) => JSON.stringify(x.series) === JSON.stringify((() => { try { return JSON.parse(c.textContent).series; } catch (e) { return null; } })()));
        if (spec) { const div = document.createElement('div'); div.className = 'chart card'; c.parentElement.replaceWith(div); requestAnimationFrame(() => drawSpec(div, spec, d)); }
      }
    });
    linkify(box, d);
    if (S.q) hlDom(box);
    setTimeout(() => renderMermaid(box), 0); // after the caller attaches it
    return box;
  }
  function linkify(root, d) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest('a,code,pre,svg') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    const nodes = [];
    while (walker.nextNode()) if (/§\s?\d/.test(walker.currentNode.nodeValue)) nodes.push(walker.currentNode);
    nodes.forEach((n) => {
      const span = document.createElement('span');
      span.innerHTML = esc(n.nodeValue).replace(/§\s?(\d+(?:\.\d+)*)/g, (m, num) => (d.byNum[num] ? `<a href="#" class="xr" data-sec="${d.byNum[num].id}">${m}</a>` : m));
      n.replaceWith(...span.childNodes);
    });
  }
  function hlDom(root) {
    const re = new RegExp(S.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest('svg,mark') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    const nodes = [];
    while (walker.nextNode()) if (re.test(walker.currentNode.nodeValue)) nodes.push(walker.currentNode);
    nodes.slice(0, 500).forEach((n) => {
      const span = document.createElement('span');
      span.innerHTML = esc(n.nodeValue).replace(new RegExp('(' + S.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark>$1</mark>');
      n.replaceWith(...span.childNodes);
    });
  }
  let mermaidLoading = null;
  // one quiet look for every diagram: soft cards, thin connectors, labels as pills
  const MM_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  const MM_LIGHT = {
    fontFamily: MM_FONT, fontSize: '14px', background: '#ffffff',
    primaryColor: '#ffffff', mainBkg: '#ffffff', primaryTextColor: '#1f2329', primaryBorderColor: '#c9ced6', nodeBorder: '#c9ced6',
    secondaryColor: '#f1f3f6', tertiaryColor: '#f6f7f9', lineColor: '#8c939e', textColor: '#3b4049',
    clusterBkg: '#f4f6f9', clusterBorder: '#dfe3e9', titleColor: '#5a616c', edgeLabelBackground: '#f4f5f7',
    actorBkg: '#ffffff', actorBorder: '#c9ced6', actorTextColor: '#1f2329', actorLineColor: '#c9ced6', signalColor: '#5a616c', signalTextColor: '#1f2329',
    noteBkgColor: '#fff6dc', noteTextColor: '#4a3d12', noteBorderColor: '#ecd48c', activationBkgColor: '#eef3fb', activationBorderColor: '#9db6dd',
    labelBoxBkgColor: '#f1f3f6', labelBoxBorderColor: '#c9ced6', loopTextColor: '#5a616c',
  };
  const MM_DARK = {
    fontFamily: MM_FONT, fontSize: '14px', background: '#1a1a19', darkMode: true,
    primaryColor: '#25272c', mainBkg: '#25272c', primaryTextColor: '#eceef1', primaryBorderColor: '#474c55', nodeBorder: '#474c55',
    secondaryColor: '#2c2f35', tertiaryColor: '#1f2125', lineColor: '#7d8592', textColor: '#c9ccd2',
    clusterBkg: '#1e2024', clusterBorder: '#34373d', titleColor: '#a7acb5', edgeLabelBackground: '#2a2c31',
    actorBkg: '#25272c', actorBorder: '#474c55', actorTextColor: '#eceef1', actorLineColor: '#474c55', signalColor: '#a7acb5', signalTextColor: '#eceef1',
    noteBkgColor: '#3a3320', noteTextColor: '#f3e6bd', noteBorderColor: '#6b5d2c', activationBkgColor: '#2b3446', activationBorderColor: '#4f6a96',
    labelBoxBkgColor: '#2c2f35', labelBoxBorderColor: '#474c55', loopTextColor: '#a7acb5',
  };
  const MM_CSS = `
    .node rect, .node polygon, .node path, .node circle, .node ellipse { stroke-width: 1.2px; filter: drop-shadow(0 1px 1.5px rgba(0,0,0,.10)); }
    .node rect { rx: 9px; ry: 9px; }
    .nodeLabel, .label { font-weight: 500; }
    .nodeLabel p { margin: 0; line-height: 1.3; }
    .flowchart-link, .edgePath .path { stroke-width: 1.4px; }
    .marker { stroke-width: 1px; }
    .edgeLabel, .edgeLabel p { font-size: 12px; font-weight: 500; }
    .edgeLabel rect, .labelBkg { rx: 6px; ry: 6px; opacity: 1; }
    .cluster rect { rx: 12px; ry: 12px; stroke-dasharray: 0; }
    .cluster .nodeLabel, .cluster-label .nodeLabel { font-size: 12px; font-weight: 600; letter-spacing: .02em; }
    .actor { rx: 9px; ry: 9px; }
    .messageText { font-size: 13px; }
    .note { rx: 6px; ry: 6px; }
    .mdv-term .nodeLabel { text-decoration: underline dotted; text-underline-offset: 3px; text-decoration-thickness: 1px; }
  `;
  // returns a promise that settles once the diagrams under root are drawn and sized
  let mermaidQueue = Promise.resolve();
  let mmSeq = 0;
  function renderMermaid(root) {
    if (!$$('pre.mdv-mm:not([data-processed])', root).length) return Promise.resolve();
    // mermaid 11 can't run two renders at once: queue them, and skip diagrams that left the page meanwhile
    const run = () => {
      const els = $$('pre.mdv-mm:not([data-processed])', root).filter((n) => document.body.contains(n));
      if (!els.length) return Promise.resolve();
      try {
        const dark = !document.body.classList.contains('printing') && getComputedStyle(document.documentElement).colorScheme === 'dark';
        window.mermaid.initialize({
          startOnLoad: false, securityLevel: 'strict', theme: 'base', layout: 'elk',
          elk: { mergeEdges: false, nodePlacementStrategy: 'BRANDES_KOEPF' },
          themeVariables: dark ? MM_DARK : MM_LIGHT, themeCSS: MM_CSS,
          flowchart: { curve: 'basis', padding: 14, nodeSpacing: 38, rankSpacing: 52, htmlLabels: true },
          sequence: { mirrorActors: false, actorMargin: 46, messageMargin: 34, boxMargin: 8, noteMargin: 10 },
        });
        // render() each source ourselves: steadier than run() on live nodes, and a bad diagram shows its source
        const one = (pre) => {
          const src = pre.textContent;
          pre.dataset.processed = 'true';
          return window.mermaid.render('mdv' + (++mmSeq), src).then(({ svg, bindFunctions }) => {
            pre.innerHTML = svg;
            if (bindFunctions) bindFunctions(pre);
          }, (err) => {
            pre.classList.add('mm-error');
            pre.innerHTML = `<div class="mm-err">Diagram error: ${esc(String(err && err.message || err).split('\n')[0])}</div><code>${esc(src)}</code>`;
            $$('#dmdv' + mmSeq + ', #mdv' + mmSeq).forEach((n) => n.remove());
          });
        };
        return els.reduce((p, pre) => p.then(() => one(pre)), Promise.resolve()).then(() => { fitMermaid(root); termNodes(root); });
      } catch (e) { return Promise.resolve(); /* leave source visible */ }
    };
    if (!window.mermaid && !mermaidLoading) mermaidLoading = new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = (window.MDV_VENDOR || 'vendor/') + 'mermaid.min.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
    const ready = window.mermaid ? Promise.resolve() : mermaidLoading;
    mermaidQueue = mermaidQueue.then(() => ready).then(() => { window.mermaid.initialize({ startOnLoad: false }); return run(); }, () => {});
    return mermaidQueue;
  }
  function sectionHeading(s) {
    const d = docOf(s.id);
    const lvl = Math.min(4, Math.max(1, s.level || 1));
    return `<h${lvl} id="sec-${s.id}" data-sec="${s.id}">${esc(s.level === 0 ? d.title : s.fullTitle)}</h${lvl}>
      <div class="sec-badges">${s.when ? `<span class="chip">${fmtDate(s.when, { year: 'numeric' })}</span>` : ''}${glyphs(s.kinds)}${s.entityKeys.length ? `<span class="meta">${s.entityKeys.length} refs</span>` : ''}</div>`;
  }
  function viewRead(main, docs) {
    main.innerHTML = '<div class="view wide"><div class="read"><nav class="toc"></nav><div class="read-body"></div></div></div>';
    const toc = $('.toc', main), body = $('.read-body', main);
    let tocHtml = '';
    for (const d of docs) {
      for (const s of d.sections) {
        if (s.level > 4) continue;
        const pad = s.level === 0 ? 0 : (s.level - 1) * 12;
        const dim = S.q && !matches(s.fullTitle, s.md) ? 'dimmed' : '';
        tocHtml += `<a href="#" data-goto="${s.id}" class="${dim}" style="padding-left:${6 + pad}px;${s.level <= 1 ? 'font-weight:600;color:var(--text)' : ''}">${esc(s.level === 0 ? d.title : s.fullTitle.replace(/\s*\(.*?\d{4}-\d{2}-\d{2}.*?\)/, ''))}${s.own && s.level ? `<span class="dt">${fmtDate(s.own)}</span>` : ''}</a>`;
        const wrap = document.createElement('section');
        wrap.innerHTML = sectionHeading(s);
        wrap.appendChild(renderSectionBody(s, { width: Math.min(900, (body.clientWidth || 900) - 20) }));
        wrap.firstElementChild.style.maxWidth = '900px';
        body.appendChild(wrap);
      }
    }
    toc.innerHTML = tocHtml;
    toc.addEventListener('click', (e) => { const a = e.target.closest('[data-goto]'); if (a) { e.preventDefault(); const t = $('#sec-' + a.dataset.goto, body); if (t) t.scrollIntoView({ behavior: 'smooth' }); } });
    body.addEventListener('click', (e) => { const a = e.target.closest('a.xr'); if (a) { e.preventDefault(); const t = $('#sec-' + a.dataset.sec, body); if (t) t.scrollIntoView({ behavior: 'smooth' }); } });
    const io = new IntersectionObserver((ents) => {
      ents.forEach((en) => { if (en.isIntersecting) { $$('a.active', toc).forEach((x) => x.classList.remove('active')); const a = $(`[data-goto="${en.target.dataset.sec}"]`, toc); if (a) { a.classList.add('active'); a.scrollIntoView({ block: 'nearest' }); } } });
    }, { root: body, rootMargin: '0px 0px -75% 0px' });
    $$('h1[data-sec],h2[data-sec],h3[data-sec],h4[data-sec]', body).forEach((h) => io.observe(h));
    if (S.readTarget) { const t = $('#sec-' + S.readTarget, body); S.readTarget = null; if (t) requestAnimationFrame(() => t.scrollIntoView()); }
  }

  // ======================================================================
  // Drawer — one section or one reference
  // ======================================================================
  function openDrawer(crumbs, build) {
    const dr = $('#drawer');
    dr.hidden = false;
    $('#drawer-crumbs').innerHTML = crumbs;
    const b = $('#drawer-body');
    b.innerHTML = '';
    b.scrollTop = 0;
    build(b);
  }
  function openSection(id, blockId) {
    const s = sec(id), d = docOf(id);
    S.drawer = { sec: id };
    const path = [];
    let p = s.parent;
    while (p) { path.unshift(d.byId[p]); p = d.byId[p].parent; }
    openDrawer(path.map((x) => `<a data-sec="${x.id}">${esc(shortLabel(x, 28))}</a>`).join(' › ') || esc(d.name), (b) => {
      b.innerHTML = `<h2>${s.num ? `<span class="meta" style="font-size:18px">${esc(s.num)}</span> ` : ''}${esc(s.level === 0 ? d.title : s.title)}</h2>
        <div class="sec-badges" style="margin:4px 0 0">${s.when ? `<span class="chip">${fmtDate(s.when, { year: 'numeric' })}</span>` : ''}${glyphs(s.kinds)}<span class="meta">${s.words} words</span></div>
        <div class="d-actions"><button class="btn small" data-go="read">Open in reader</button><button class="btn small" data-go="map">Show on map</button></div>`;
      b.appendChild(renderSectionBody(s, { width: 500 }));
      const kids = s.children.map((c) => d.byId[c]);
      if (kids.length) b.insertAdjacentHTML('beforeend', `<h3 class="sec" style="margin-top:22px">Subsections</h3><div class="list">${kids.map((k) => `<div class="li"><div class="f">${secChip(k, 60)}<span class="meta">${fmtDate(k.own)}</span>${glyphs(k.kinds)}</div></div>`).join('')}</div>`);
      const refs = s.entityKeys.map((k) => d.entities[k]).sort((a, b2) => b2.count - a.count).slice(0, 40);
      if (refs.length) b.insertAdjacentHTML('beforeend', `<h3 class="sec" style="margin-top:22px">References</h3><div style="display:flex;flex-wrap:wrap;gap:6px">${refs.map((e) => `<span class="chip mono" data-ent="${esc(e.id)}" data-doc="${d.index}"><span class="sw" style="background:var(--t-${e.type});border-radius:50%"></span>${esc(e.key)}</span>`).join('')}</div>`);
      $('[data-go="read"]', b).onclick = () => { S.readTarget = id; closeDrawer(); setView('read'); };
      $('[data-go="map"]', b).onclick = () => {
        let q = s.parent;
        while (q) { S.collapsed && S.collapsed.delete(q); q = d.byId[q].parent; }
        closeDrawer(); setView('map');
        requestAnimationFrame(() => { const n = $(`.node[data-sec="${id}"] rect.box`); if (n) { n.parentElement.classList.add('hit'); } });
      };
      if (blockId) {
        const el = $(`[data-block="${blockId}"]`, b);
        if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); }
      }
    });
  }
  function openEntity(docIndex, entId) {
    const d = S.docs[docIndex], e = d.entities[entId];
    if (!e) return;
    S.drawer = { ent: entId };
    openDrawer(`${esc(d.name)} › ${ETYPES[e.type]}`, (b) => {
      b.innerHTML = `<h2 class="mono" style="font-size:18px;word-break:break-all">${esc(e.key)}</h2>
        <div class="sec-badges" style="margin:6px 0 14px"><span class="chip"><span class="sw" style="background:var(--t-${e.type});border-radius:50%"></span>${ETYPES[e.type]}</span><span class="meta">${e.count} mentions in ${e.sections.length} sections</span></div>
        ${e.changes.length ? `<h3 class="sec">Value history</h3><div class="tablewrap"><table><thead><tr><th>Section</th><th>Value</th></tr></thead><tbody>${e.changes.map((c) => `<tr><td>${secChip(sec(c.sectionId), 40)}</td><td class="num mono">${esc(chgText(c))}</td></tr>`).join('')}</tbody></table></div>` : ''}
        <h3 class="sec">Mentions</h3>
        ${e.mentions.map((m) => `<div class="mention">${hlTerm(esc(m.snippet), m.hit)}<div class="f">${secChip(sec(m.sectionId), 50)}${m.loc ? ` <span class="meta mono">:${esc(m.loc)}</span>` : ''}</div></div>`).join('')}`;
    });
  }
  const hlTerm = (html, term) => { if (!term) return html; const t = esc(term); const i = html.indexOf(t); return i < 0 ? html : html.slice(0, i) + '<mark>' + t + '</mark>' + html.slice(i + t.length); };
  function closeDrawer() { $('#drawer').hidden = true; S.drawer = null; }

  // ======================================================================
  // Export / print
  // ======================================================================
  function download(name, text, type) {
    if (NATIVE) return host({ type: 'save', name, text });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const baseName = () => { const d = activeDocs(); return d.length === 1 ? d[0].name.replace(/\.\w+$/, '') : 'mdviz'; };
  function pageStyle(css) {
    let st = $('#page-style');
    if (!st) { st = document.createElement('style'); st.id = 'page-style'; document.head.appendChild(st); }
    st.textContent = css;
  }
  function afterPrint(cls) {
    const done = () => { document.body.classList.remove('printing', cls); $('#print-root').innerHTML = ''; pageStyle(''); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
  }
  function buildPrintSlides() {
    const root = $('#print-root');
    root.innerHTML = '';
    const slides = buildSlides(activeDocs());
    slides.forEach((sl, i) => { const el = renderSlide(sl, i, slides.length); root.appendChild(el); });
    document.body.classList.add('printing', 'print-slides');
    pageStyle('@page { size: 13.333in 7.5in; margin: 0 } .slide { width: 13.333in !important; height: 7.5in !important; }');
    $$('.slide', root).forEach(hydrateSlide);
  }
  function buildPrintRead() {
    const root = $('#print-root');
    root.innerHTML = '';
    for (const d of activeDocs()) for (const s of d.sections) {
      const wrap = document.createElement('section');
      wrap.innerHTML = sectionHeading(s);
      const body = renderSectionBody(s, { width: 680 });
      $$('select, .toolbar', body).forEach((n) => n.remove());
      wrap.appendChild(body);
      root.appendChild(wrap);
    }
    document.body.classList.add('printing', 'print-read');
    pageStyle('@page { size: letter; margin: 0.6in }');
  }
  function endPrint() { document.body.classList.remove('printing', 'print-slides', 'print-read'); $('#print-root').innerHTML = ''; pageStyle(''); }
  // print once every mermaid diagram in the print copy has rendered (or after 8 s)
  function whenDrawn(cb, delay) {
    const t0 = Date.now();
    const poll = () => (($('#print-root pre.mdv-mm:not([data-processed])') && Date.now() - t0 < 8000) ? setTimeout(poll, 120) : setTimeout(cb, delay));
    setTimeout(poll, 100);
  }
  function nativePrint(mode, delay) { whenDrawn(() => host({ type: 'print', mode, name: baseName() }), delay); }
  function printSlides() {
    buildPrintSlides();
    if (NATIVE) return nativePrint('slides', 400);
    afterPrint('print-slides'); whenDrawn(() => window.print(), 300);
  }
  function printRead() {
    buildPrintRead();
    const delay = window.mermaid || $('#print-root pre.mdv-mm') ? 1200 : 300;
    if (NATIVE) return nativePrint('read', delay);
    afterPrint('print-read'); whenDrawn(() => window.print(), delay);
  }
  function doExport(kind) {
    const docs = activeDocs();
    if (!docs.length) return;
    if (kind === 'drawio') download(baseName() + '.drawio', MDV.toDrawio(docs), 'application/xml');
    if (kind === 'json') download(baseName() + '.mdviz.json', JSON.stringify(docs.map(stripDoc), null, 1), 'application/json');
    if (kind === 'print' && NATIVE) return host({ type: 'print', mode: 'view', name: baseName() });
    if (kind === 'print') { pageStyle('@page { size: landscape; margin: 0.4in }'); window.print(); setTimeout(() => pageStyle(''), 1000); }
    if (kind === 'slides-pdf') printSlides();
    if (kind === 'read-pdf') printRead();
  }
  function stripDoc(d) {
    return {
      name: d.name, title: d.title, span: d.span, target: d.target, stats: MDV.stats(d),
      sections: d.sections.map((s) => ({ id: s.id, level: s.level, num: s.num, title: s.title, date: s.when, parent: s.parent, words: s.words, kinds: s.kinds, tables: s.tables })),
      items: d.items.map((b) => ({ kind: b.kind, section: b.sectionId, text: b.plain })),
      tables: d.tables.map((t) => ({ id: t.id, section: t.sectionId, header: t.header, columns: t.cols, rows: t.rows.map((r) => r.map((c) => c.plain)) })),
      references: Object.values(d.entities).map((e) => ({ key: e.key, type: e.type, count: e.count, sections: e.sections, changes: e.changes })),
      xrefs: d.xrefs,
    };
  }

  // ======================================================================
  // wiring
  // ======================================================================
  function applyTheme(t) {
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  }
  function init() {
    // mermaid renders every .mermaid on page load by default; we render ourselves, with our theme, one queue
    if (window.mermaid) window.mermaid.initialize({ startOnLoad: false });
    applyTheme(store.get('theme', null));
    if (innerWidth <= 860) document.body.classList.remove('side-open');
    let data = null;
    try { data = JSON.parse($('#mdviz-data').textContent); } catch (e) { data = null; }
    const [hView, hArg] = (location.hash || '').slice(1).split('/');
    if (hView === 'slides' && hArg) S.slide = Math.max(0, parseInt(hArg, 10) - 1 || 0);
    if (hView === 'timeline' && hArg) S.entryArg = Math.max(0, parseInt(hArg, 10) - 1 || 0);
    const startView = hView || (data && data.view) || store.get('view', 'overview');
    if (data && data.docs && data.docs.length) setDocs(data.docs);
    else {
      const raw = store.get('docs', []);
      if (raw.length) { setDocs(raw); const act = store.get('active', null); if (act) S.active = new Set(act.filter((n) => raw.some((r) => r.name === n))); }
    }
    S.view = allViews().includes(startView) ? startView : viewSets().primary[0];
    render();
    if (data && data.print) {
      // headless PDF export from the CLI
      document.title = baseName();
      requestAnimationFrame(() => setTimeout(() => {
        if (data.print === 'slides') buildPrintSlides(); else buildPrintRead();
        document.body.dataset.ready = '1';
      }, 50));
    }

    $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
    $('#more').addEventListener('click', (e) => {
      if (e.target.closest('[data-more]')) { e.stopPropagation(); const p = $('#more .menu-pop'); p.hidden = !p.hidden; return; }
      const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view);
    });
    $('#zoom').addEventListener('click', () => { $('#zoom').hidden = true; });
    $('#pick').onclick = pickFiles;
    $('#file').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
    $('#doclist').addEventListener('change', (e) => {
      const n = e.target.dataset.doc;
      if (!n) return;
      e.target.checked ? S.active.add(n) : S.active.delete(n);
      store.set('active', [...S.active]);
      S.collapsed = null;
      render();
    });
    $('#doclist').addEventListener('click', (e) => {
      const n = e.target.dataset.rm;
      if (!n) return;
      setDocs(S.raw.filter((r) => r.name !== n), true);
      render();
    });
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer.types || [])].includes('Files')) { dragDepth++; document.body.classList.add('dragging'); } });
    window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); addFiles(e.dataTransfer.files); });
    let qt;
    $('#search').addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value.trim().toLowerCase(); if (S.view !== 'slides') render(); }, 160); });
    $('#theme-btn').onclick = () => {
      const dark = getComputedStyle(document.documentElement).colorScheme === 'dark';
      const t = dark ? 'light' : 'dark';
      applyTheme(t); store.set('theme', t); render();
    };
    $('#toggle-side').onclick = () => document.body.classList.toggle(innerWidth <= 860 ? 'side-open' : 'side-hidden');
    $('#export-btn').onclick = (e) => { e.stopPropagation(); $('#export-menu').hidden = !$('#export-menu').hidden; };
    $('#export-menu').addEventListener('click', (e) => { const k = e.target.dataset.export; if (k) { $('#export-menu').hidden = true; doExport(k); } });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.menu')) { $('#export-menu').hidden = true; const mp = $('#more .menu-pop'); if (mp) mp.hidden = true; }
      if (e.target.closest('.tile, .filmstrip, .float-tools')) return;
      const c = e.target.closest('[data-sec]:not(.node):not(.tl-card):not([data-goto])');
      if (c && !e.target.closest('#main svg') && (c.classList.contains('chip') || c.tagName === 'A')) { e.preventDefault(); openSection(c.dataset.sec); return; }
      const en = e.target.closest('[data-ent]');
      if (en) openEntity(+en.dataset.doc, en.dataset.ent);
    });
    $('#drawer-close').onclick = closeDrawer;
    $('#drawer-crumbs').addEventListener('click', (e) => { const a = e.target.closest('[data-sec]'); if (a) openSection(a.dataset.sec); });
    document.addEventListener('keydown', (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if (e.key === 'Escape') { if (!$('#zoom').hidden) { $('#zoom').hidden = true; return; } if (!$('#drawer').hidden) closeDrawer(); else if (typing) document.activeElement.blur(); return; }
      if (typing) return;
      if (e.key === '/') { e.preventDefault(); $('#search').focus(); return; }
      if (S.view === 'slides' && S.slideKeys) return S.slideKeys(e);
      if (S.view === 'timeline' && S.entryKeys && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); return S.entryKeys(e.key === 'ArrowLeft' ? -1 : 1); }
      const n = parseInt(e.key, 10);
      const prim = viewSets().primary;
      if (n >= 1 && n <= prim.length && !e.metaKey && !e.ctrlKey) setView(prim[n - 1]);
    });
    window.addEventListener('hashchange', () => { const v = location.hash.slice(1).split('/')[0]; if (v && v !== S.view) setView(v); });
    let rt;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (['overview', 'data'].includes(S.view)) render(); }, 250); });
    window.addEventListener('beforeprint', () => { if (!document.body.classList.contains('printing')) { /* print current view as-is */ } });
  }
  window.MDVApp = {
    state: S, render, setView, openSection, buildPrintSlides, buildPrintRead, addDocs, endPrint,
    export: doExport,
    focusSearch: () => $('#search').focus(),
    toggleSide: () => document.body.classList.toggle(innerWidth <= 860 ? 'side-open' : 'side-hidden'),
    hasDocs: () => activeDocs().length > 0,
  };
  init();
})();
