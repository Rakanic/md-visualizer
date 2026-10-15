/* mdviz core — markdown text -> document model (+ .drawio export).
 * Shared by the browser app (classic <script>) and the node CLI (require). No DOM use here. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./vendor/marked.min.js'));
  else root.MDV = factory(root.marked);
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  const KIND_ORDER = ['decision', 'finding', 'result', 'open', 'caveat'];
  const KIND_RULES = [
    ['decision', /\bdecision|\bdecided\b|\bdecide\b|user chose|\bchose\b|\bapproved\b|user-approved|\bagreed\b/],
    ['open', /^open\b|\bopen:|\bopen \(|\btodo\b|^pending:|decision pending|\(pending|\bnot yet\b|^next\b|next step|\bdeferred\b|waiting on|\bunresolved|open question|open item|\bblocked\b|\bfollow[- ]up\b/],
    ['caveat', /\bcaveat|\brisk\b|\bwarning\b|\blimitation|\bgotcha|\bbeware|^note\b|\bapproximation\b/],
    ['finding', /^found\b|\bfinding|\bcause\b|root cause|\bbug\b|\bdiscovered|\bobserved|turns out|\bdiagnosis|\brejected\b|\binsight\b/],
    ['result', /^result|\beffect\b|^results\b|\bmeasured\b|\bvalidated\b|\bpasses\b|^speed\b|^done\b|^fixed\b|\bimplemented\b|^checks?\b|^outcome/],
  ];
  // Markers that start a new classified segment inside one paragraph ("... unchanged. Open: nc4 ...").
  const SEGMENT_RE = /(^|[.!?)]\s+|\n)((?:\*\*)?(?:Open|Next|Decision|Result|Results|Effect|Cause|Finding|Found|Caveat|Bug|Gate|Checks?|Status|Risk|Note)\b[^.:\n]{0,40}:)/g;

  const CODE_EXT = 'c|cc|cpp|cxx|h|hpp|hh|py|scala|sv|v|vh|js|mjs|cjs|ts|tsx|jsx|rs|go|java|kt|rb|sh|bash|zsh|md|json|yaml|yml|toml|ini|cfg|csv|html|css|sql|proto|mk|cmake|so|elf|log|ipynb|lua|swift|mm|tcl|xml|drawio|fsdb|dump|txt';
  const FILE_EXT_RE = new RegExp('\\.(?:' + CODE_EXT + ')$|\\.\\{[\\w,]+\\}$', 'i');
  const BARE_FILE_RE = /(^|[^\w/.`-])((?:[\w-]+\/)*[\w-]+\.(?:scala|cc|cpp|h|hpp|py|c|js|ts|rs|go|sv|sh|md))(?::(\d+)(?:-\d+)?)?(?![\w`])/g;
  const DATE_RE = /\b(20\d{2})-(\d{2})-(\d{2})\b/;
  const DATE_RE_G = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;

  // ---------- small text helpers ----------
  function toPlain(md) {
    return String(md || '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1$2')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }
  function slug(s) {
    return String(s).toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'x';
  }
  function firstDate(s) {
    const m = DATE_RE.exec(s || '');
    return m ? m[0] : null;
  }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Shorten markdown at a sentence boundary without leaving ** or ` unbalanced.
  function summarize(md, max) {
    md = String(md || '').replace(/\s+/g, ' ').trim();
    if (md.length <= max) return md;
    let cut = md.slice(0, max);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '), cut.lastIndexOf(': '));
    cut = end > max * 0.45 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + ' …';
    if ((cut.match(/`/g) || []).length % 2) cut += '`';
    if ((cut.match(/\*\*/g) || []).length % 2) cut += '**';
    return cut;
  }

  function classify(md) {
    const lead = (/^\s*\*\*(.+?)\*\*/.exec(md) || [])[1];
    const head = toPlain(lead || md).slice(0, lead ? 120 : 55).toLowerCase();
    if (/^status\b/.test(head)) return null;
    for (const [kind, re] of KIND_RULES) if (re.test(head)) return kind;
    return null;
  }

  function splitSegments(md) {
    const cuts = [];
    let m;
    SEGMENT_RE.lastIndex = 0;
    while ((m = SEGMENT_RE.exec(md))) {
      const at = m.index + m[1].length;
      if (at > 0) cuts.push(at);
    }
    if (!cuts.length) return [md];
    const out = [];
    let prev = 0;
    for (const c of cuts) { out.push(md.slice(prev, c)); prev = c; }
    out.push(md.slice(prev));
    return out.map((s) => s.trim()).filter(Boolean);
  }

  // ---------- numbers in table cells ----------
  function parseCell(md) {
    const plain = toPlain(md);
    const cell = { md, plain, num: null, pct: null, delta: null, unit: '', approx: false };
    const s = plain.replace(/[−–]/g, '-').replace(/ /g, ' ').trim();
    if (!s || /^[-—–?]+$|^n\/?a$/i.test(s)) { cell.blank = true; return cell; }
    let m = /^([<>≈~≤≥]?)\s*([-+]?\d[\d,]*(?:\.\d+)?)\s*%$/.exec(s);
    if (m) { cell.pct = cell.num = parseFloat(m[2].replace(/,/g, '')); cell.unit = '%'; cell.approx = !!m[1]; return cell; }
    m = /^([<>≈~≤≥]?)\s*([-+]?\d[\d,]*(?:\.\d+)?)\s*([a-zA-Zµ×x/]{0,4})\.?\s*(?:\(([^)]*)\))?\s*$/.exec(s);
    if (m && !/^\d{4}-\d{2}/.test(s)) {
      cell.num = parseFloat(m[2].replace(/,/g, ''));
      cell.unit = m[3] || '';
      cell.approx = !!m[1];
      if (m[4]) {
        const d = /([-+]\d+(?:\.\d+)?)\s*%/.exec(m[4]);
        if (d) cell.delta = parseFloat(d[1]);
        else if (/timeout|approx|est/i.test(m[4])) cell.approx = true;
      }
    }
    return cell;
  }

  function analyzeTable(tok, section, directive, idx) {
    const header = tok.header.map((h) => toPlain(h.text));
    const rows = [];
    // "a / b / c" in every cell of a row -> k rows (compact comparison tables)
    for (const r of tok.rows) {
      const parts = r.map((c) => {
        const p = toPlain(c.text) ? c.text.split(/\s+\/\s+/) : [''];
        if (p.length > 1 && /%\s*$/.test(p[p.length - 1])) return p.map((x) => (/%\s*$/.test(x) ? x : x + '%'));
        return p;
      });
      const k = Math.max(...parts.map((p) => p.length));
      const numericParts = parts.some((p) => p.length === k && p.every((x) => parseCell(x).num !== null));
      if (k > 1 && k <= 12 && numericParts && parts.every((p) => p.length === 1 || p.length === k)) {
        for (let i = 0; i < k; i++) rows.push(parts.map((p) => parseCell(p.length === k ? p[i] : p[0])));
      } else rows.push(r.map((c) => parseCell(c.text)));
    }
    const cols = header.map((name, ci) => {
      const cells = rows.map((r) => r[ci]).filter((c) => c && !c.blank);
      const nums = cells.filter((c) => c.num !== null);
      const pcts = nums.filter((c) => c.pct !== null);
      const deltas = cells.filter((c) => c.delta !== null);
      const units = {};
      nums.forEach((c) => { units[c.unit] = (units[c.unit] || 0) + 1; });
      const unit = Object.keys(units).sort((a, b) => units[b] - units[a])[0] || '';
      let type = 'text';
      if (cells.length && nums.length / cells.length >= 0.6) type = pcts.length / nums.length >= 0.6 ? 'pct' : 'num';
      return { name: name || `col ${ci + 1}`, index: ci, type, unit, hasDelta: deltas.length >= Math.max(1, cells.length * 0.3) };
    });
    const textCols = cols.filter((c) => c.type === 'text').slice(0, 2).map((c) => c.index);
    const labels = rows.map((r, ri) => {
      const parts = textCols.map((ci) => r[ci] && r[ci].plain).filter(Boolean);
      return parts.join(' · ') || `row ${ri + 1}`;
    });
    return {
      id: `${section.id}-t${idx}`, sectionId: section.id, header, rows, cols, labels,
      align: tok.align, directive: directive || null,
      numeric: cols.some((c) => c.type !== 'text' || c.hasDelta),
    };
  }

  // ---------- inline code / file references ----------
  function classifyEntity(raw) {
    let s = raw.trim();
    if (s.length < 2 || s.length > 90) return null;
    if (/^[-+\d.,x×%\s/]+$/.test(s) || /^0x[\da-f]+$/i.test(s)) return null;
    if (/\s/.test(s) && /^(python3?|node|npm|npx|make|git|bash|sh|\.\/|cd |pip|cargo|go |spike|gcc|clang|brew|docker|kubectl)\b/.test(s))
      return { type: 'command', key: s };
    if (/^[A-Z][A-Z0-9_]{2,}(=.*)?$/.test(s)) return { type: 'env', key: s.split('=')[0] };
    const lm = /^(.*?)(?::(\d+)(?:-\d+)?)$/.exec(s);
    let loc = null;
    if (lm && !/\s/.test(lm[1]) && lm[1]) { s = lm[1]; loc = lm[2]; }
    if (!/\s/.test(s) && (s.includes('/') || (FILE_EXT_RE.test(s) && /[\w-]\.[\w{]/.test(s))) && /[a-z]/i.test(s)) {
      return { type: 'file', key: s.replace(/^(\.\.?\/)+/, ''), loc };
    }
    const pm = /^([a-z_][\w]*\.[a-z_][\w.]*)\s*(?:=\s*(.+))?$/.exec(s);
    if (pm) return { type: 'param', key: pm[1], value: pm[2] ? pm[2].split(/[,;\s]/)[0] : null };
    const fm = /^([\w:~.<>]+)\(.*\)$/.exec(s);
    if (fm) return { type: 'symbol', key: fm[1] + '()' };
    if (!/\s/.test(s) && /^[A-Za-z_][\w:.<>-]*$/.test(s)) return { type: 'symbol', key: s };
    return null;
  }

  function findEntities(md) {
    const found = [];
    const code = /`([^`\n]+)`/g;
    let m;
    while ((m = code.exec(md))) {
      const e = classifyEntity(m[1]);
      if (e) { e.at = m.index; e.end = m.index + m[0].length; e.inner = m[1]; found.push(e); }
    }
    const bare = md.replace(/`[^`\n]*`/g, (x) => ' '.repeat(x.length));
    BARE_FILE_RE.lastIndex = 0;
    while ((m = BARE_FILE_RE.exec(bare))) {
      const at = m.index + m[1].length;
      found.push({ type: 'file', key: m[2], loc: m[3] || null, at, end: at + m[0].length - m[1].length, inner: m[2] });
    }
    return found;
  }

  // "`mem.dram_latency` 20 -> **24**", "`x = 2`", "(`mem.host_l1_kib` 16, LRU)"
  function paramChange(md, e) {
    if (e.value != null) return { value: e.value.trim() };
    const win = toPlain(md.slice(e.end, e.end + 48)).replace(/[−–]/g, '-');
    let m = /^\s*\(?\s*([-\d.]+)\s*\)?\s*(?:->|→)\s*([-\d.]+)/.exec(win);
    const num = (x) => x.replace(/\.$/, '');
    if (m) return { from: num(m[1]), to: num(m[2]) };
    m = /^\s*(?:->|→)\s*([-\d.]+)/.exec(win);
    if (m) return { to: num(m[1]) };
    m = /^\s*\(?([-\d.]+)\b(?!\s*%|\s*\.\d)/.exec(win);
    if (m && /\d/.test(m[1])) return { value: num(m[1]) };
    return null;
  }

  // ---------- directives ----------
  function parseDirective(html) {
    const m = /<!--\s*(?:viz|mdviz)\s*:?\s*([\s\S]*?)-->/i.exec(html || '');
    if (!m) return null;
    const out = {};
    const re = /([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g;
    let p;
    while ((p = re.exec(m[1]))) out[p[1].toLowerCase()] = p[2] ?? p[3] ?? p[4] ?? true;
    return out;
  }

  // ---------- the parser ----------
  // "---\nkey: value\n---" at the top of a file
  function frontMatter(text) {
    const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
    if (!m) return { meta: {}, body: text };
    const meta = {};
    m[1].split('\n').forEach((line) => {
      const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
      if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, '');
    });
    return { meta, body: text.slice(m[0].length) };
  }

  // a heading named "Decisions", "Open", ... makes every statement under it that kind
  const HEADING_KIND = [[/^decisions?$/i, 'decision'], [/^(open|open items|open questions|todo|next)$/i, 'open'],
    [/^(results?|measurements?)$/i, 'result'], [/^findings?$/i, 'finding'], [/^(caveats?|risks?)$/i, 'caveat']];
  const headingKind = (title) => { for (const [re, k] of HEADING_KIND) if (re.test(title.trim())) return k; return null; };

  function parseDoc(name, text, docIndex) {
    const fm = frontMatter(String(text || '').replace(/\r\n?/g, '\n'));
    const tokens = M.lexer(fm.body);
    const id = `d${docIndex || 0}`;
    const doc = {
      id, name, index: docIndex || 0, title: null, sections: [], tables: [], items: [], blocks: [],
      entities: {}, xrefs: [], charts: [], mermaid: 0, target: null, status: null, wordCount: 0,
      meta: fm.meta, log: null,
    };
    let n = 0;
    const mk = (level, rawTitle, parent) => {
      const title = toPlain(rawTitle);
      const nm = /^((?:\d+\.)*\d+)\.?\s+(.*)$/.exec(title);
      const s = {
        id: `${id}s${n++}`, docId: id, level, rawTitle, num: nm ? nm[1] : null, title: nm ? nm[2] : title,
        fullTitle: title, date: firstDate(title), bodyDate: null, parent: parent ? parent.id : null, children: [],
        tokens: [], md: '', words: 0, tables: [], blocks: [], code: [], mermaid: [], charts: [], scenarios: [], steps: [],
        kinds: {}, entityKeys: [],
      };
      doc.sections.push(s);
      if (parent) parent.children.push(s.id);
      return s;
    };
    const root = mk(0, name.replace(/\.md$/i, ''), null);
    let cur = root;
    const stack = [root];
    for (const t of tokens) {
      if (t.type === 'heading') {
        while (stack.length > 1 && stack[stack.length - 1].level >= t.depth) stack.pop();
        if (t.depth === 1 && !doc.title && root.children.length === 0) {
          // the document's H1 is the root itself
          root.rawTitle = t.text; root.fullTitle = toPlain(t.text); root.title = root.fullTitle;
          root.date = firstDate(root.fullTitle);
          doc.title = root.title;
          cur = root;
          continue;
        }
        cur = mk(t.depth, t.text, stack[stack.length - 1]);
        stack.push(cur);
      } else {
        cur.tokens.push(t);
      }
    }
    if (!doc.title) doc.title = root.title;
    const byId = {};
    doc.sections.forEach((s) => { byId[s.id] = s; });
    doc.byId = byId;
    const byNum = {};
    doc.sections.forEach((s) => { if (s.num && !byNum[s.num]) byNum[s.num] = s; });
    doc.byNum = byNum;

    // second pass: blocks, tables, entities per section
    const addEntity = (e, s, block, md) => {
      const key = `${e.type}:${e.key}`;
      const ent = doc.entities[key] || (doc.entities[key] = { id: key, key: e.key, type: e.type, count: 0, sections: [], mentions: [], changes: [] });
      ent.count++;
      if (!ent.sections.includes(s.id)) ent.sections.push(s.id);
      if (!s.entityKeys.includes(key)) s.entityKeys.push(key);
      const plain = toPlain(md);
      const inner = toPlain(e.inner || e.key);
      const at = Math.max(0, plain.indexOf(inner));
      const a = Math.max(0, at - 110), b = Math.min(plain.length, at + inner.length + 140);
      ent.mentions.push({ sectionId: s.id, blockId: block ? block.id : null, loc: e.loc || null,
        snippet: (a ? '…' : '') + plain.slice(a, b) + (b < plain.length ? '…' : ''), hit: inner });
      if (e.type === 'param') {
        const ch = paramChange(md, e);
        if (ch) ent.changes.push(Object.assign({ sectionId: s.id }, ch));
      }
    };
    let bn = 0;
    const addBlock = (s, md, kindHint, listInfo) => {
      const segs = splitSegments(md);
      segs.forEach((seg, i) => {
        const kind = (i === 0 && kindHint) || classify(seg);
        const b = { id: `${s.id}b${bn++}`, sectionId: s.id, docId: id, md: seg, plain: toPlain(seg), kind, list: listInfo || null };
        s.blocks.push(b);
        doc.blocks.push(b);
        if (kind) { doc.items.push(b); s.kinds[kind] = (s.kinds[kind] || 0) + 1; }
        for (const e of findEntities(seg)) addEntity(e, s, b, seg);
      });
    };

    for (const s of doc.sections) {
      let pending = null; // directive from a preceding <!-- viz: --> comment
      let tableIdx = 0;
      const md = s.tokens.map((t) => t.raw || '').join('');
      s.md = md;
      s.words = (toPlain(md).match(/\S+/g) || []).length;
      doc.wordCount += s.words;
      s.bodyDate = firstDate(md.replace(/```[\s\S]*?```/g, ''));
      const walk = (toks, inList) => {
        for (const t of toks) {
          if (t.type === 'html') {
            const d = parseDirective(t.text);
            if (d) pending = d;
            continue;
          }
          if (t.type === 'space' || t.type === 'hr') continue;
          if (t.type === 'paragraph' || t.type === 'text') {
            addBlock(s, t.text, (pending && pending.kind) || headingKind(s.title), inList);
            pending = null;
          } else if (t.type === 'list') {
            t.items.forEach((it, i) => {
              const own = (it.tokens || []).filter((x) => x.type === 'text' || x.type === 'paragraph').map((x) => x.text).join('\n');
              const info = { ordered: !!t.ordered, n: (t.start || 1) + i, task: !!it.task, checked: !!it.checked };
              if (own) addBlock(s, own, (pending && pending.kind) || (!inList && headingKind(s.title)), info);
              pending = null;
              walk((it.tokens || []).filter((x) => x.type === 'list' || x.type === 'code' || x.type === 'table'), info);
            });
          } else if (t.type === 'blockquote') {
            walk(t.tokens || [], inList);
          } else if (t.type === 'table') {
            const tb = analyzeTable(t, s, pending, tableIdx++);
            pending = null;
            s.tables.push(tb.id);
            doc.tables.push(tb);
            tb.rows.forEach((r) => r.forEach((c) => findEntities(c.md).forEach((e) => addEntity(e, s, null, r.map((x) => x.md).join(' | ')))));
          } else if (t.type === 'code') {
            const lang = (t.lang || '').trim().toLowerCase();
            if (lang === 'mermaid') { s.mermaid.push(t.text); doc.mermaid++; }
            else if (lang === 'scenario') {
              try { const sc = JSON.parse(t.text); sc.id = `${s.id}-x${s.scenarios.length}`; sc.sectionId = s.id; s.scenarios.push(sc); }
              catch (err) { s.code.push({ lang, text: t.text, error: 'scenario JSON: ' + err.message }); }
            }
            else if (lang === 'chart' || lang === 'mdviz' || lang === 'viz') {
              try {
                const spec = JSON.parse(t.text);
                spec.id = `${s.id}-c${s.charts.length}`; spec.sectionId = s.id;
                s.charts.push(spec); doc.charts.push(spec);
              } catch (err) { s.code.push({ lang, text: t.text, error: 'chart JSON: ' + err.message }); }
            } else s.code.push({ lang, text: t.text });
            pending = null;
          }
        }
      };
      walk(s.tokens, null);

      // ordered steps under a plan-like heading
      if (/step|plan|roadmap|todo|phase|milestone|next|tasks?/i.test(s.fullTitle)) {
        const plain = toPlain(md);
        const firsts = {};
        s.steps = s.blocks.filter((b) => b.list && (b.list.ordered || b.list.task) && !firsts[b.list.n] && (firsts[b.list.n] = 1)).map((b) => {
          const re = new RegExp('step\\s*' + b.list.n + '\\b[^.\\n]{0,40}?(implemented|done|complete|finished|shipped)', 'i');
          const done = b.list.checked || re.test(plain) || /^\s*(✅|\[x\])/i.test(b.md);
          return { n: b.list.n, md: b.md, done, blockId: b.id };
        });
      }
    }

    // effective date: own heading date, else first date in own body, else parent's
    for (const s of doc.sections) {
      const p = s.parent ? byId[s.parent] : null;
      s.own = s.date || s.bodyDate || null;
      s.when = s.own || (p ? p.when : null);
    }

    // cross references: §6, (13.5), "see 4.2"
    const seen = new Set();
    for (const b of doc.blocks) {
      const res = [/§\s?(\d+(?:\.\d+)*)/g, /\((\d+\.\d+(?:\.\d+)?)\)(?!\s*%)/g, /\b(?:see|in|per|from|section|sections)\s+(\d+\.\d+(?:\.\d+)?)\b(?!\s*%)/gi];
      for (const re of res) {
        let m;
        while ((m = re.exec(b.plain))) {
          const tgt = byNum[m[1]];
          if (!tgt || tgt.id === b.sectionId) continue;
          const k = b.sectionId + '>' + tgt.id;
          if (seen.has(k)) continue;
          seen.add(k);
          doc.xrefs.push({ from: b.sectionId, to: tgt.id, label: m[0] });
        }
      }
    }

    const all = toPlain(text);
    const tm = /(?:≤|<=|within|under)\s*±?\s*(\d+(?:\.\d+)?)\s*%/i.exec(all);
    if (tm) doc.target = parseFloat(tm[1]);
    const firstPara = doc.blocks.find((b) => b.plain.length > 20);
    doc.status = firstPara ? firstPara.md : null;
    const dates = (text.match(DATE_RE_G) || []).sort();
    doc.span = dates.length ? [dates[0], dates[dates.length - 1]] : null;
    if (doc.meta.project) doc.title = doc.meta.project;
    doc.log = buildLog(doc);
    return doc;
  }

  // ---------- draw.io export ----------
  function escXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  const label = (s) => escXml(escXml(s)); // html=1 labels: escape for HTML, then for the XML attribute
  const DIO_FILLS = ['#dae8fc', '#d5e8d4', '#fff2cc', '#f8cecc', '#e1d5e7', '#ffe6cc', '#f5f5f5'];
  const DIO_STROKES = ['#6c8ebf', '#82b366', '#d6b656', '#b85450', '#9673a6', '#d79b00', '#666666'];
  const KIND_DIO = { decision: 0, finding: 4, result: 1, open: 5, caveat: 3 };

  function toDrawio(docs) {
    let cid = 2;
    const pages = [];
    const page = (name, cells) => pages.push(
      `<diagram id="${slug(name)}-${pages.length}" name="${escXml(name)}"><mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel></diagram>`);
    const vertex = (value, x, y, w, h, style, parent, isHtml) => {
      const id = 'c' + cid++;
      const v = isHtml ? escXml(value) : label(value).replace(/\n/g, '&lt;br&gt;');
      return { id, xml: `<mxCell id="${id}" value="${v}" style="${style}" vertex="1" parent="${parent || 1}"><mxGeometry x="${Math.round(x)}" y="${Math.round(y)}" width="${w}" height="${h}" as="geometry"/></mxCell>` };
    };
    const edge = (src, dst, style) => `<mxCell id="c${cid++}" style="${style}" edge="1" parent="1" source="${src}" target="${dst}"><mxGeometry relative="1" as="geometry"/></mxCell>`;

    // Page 1: outline tree, left to right
    {
      const cells = [];
      const W = 230, H = 46, GX = 70, GY = 14;
      let y = 0;
      for (const doc of docs) {
        const pos = {};
        const place = (s, depth) => {
          const kids = s.children.map((c) => doc.byId[c]).filter((k) => k.level <= 3);
          if (!kids.length) { pos[s.id] = { x: depth * (W + GX), y }; y += H + GY; return; }
          kids.forEach((k) => place(k, depth + 1));
          const ys = kids.map((k) => pos[k.id].y);
          pos[s.id] = { x: depth * (W + GX), y: (ys[0] + ys[ys.length - 1]) / 2 };
        };
        const root = doc.sections[0];
        place(root, 0);
        const ids = {};
        for (const s of doc.sections) {
          if (!pos[s.id]) continue;
          const lvl = Math.min(s.level, 6);
          const counts = KIND_ORDER.filter((k) => s.kinds[k]).map((k) => `${s.kinds[k]} ${k}`).join(', ');
          const text = (s.num ? s.num + ' ' : '') + s.title + (s.own ? '\n' + s.own : '') + (counts ? '\n' + counts : '');
          const style = `rounded=1;whiteSpace=wrap;html=1;align=left;spacingLeft=8;fontSize=${s.level <= 1 ? 14 : 11};fontStyle=${s.level <= 2 ? 1 : 0};fillColor=${DIO_FILLS[lvl % DIO_FILLS.length]};strokeColor=${DIO_STROKES[lvl % DIO_STROKES.length]};`;
          const v = vertex(text, pos[s.id].x, pos[s.id].y, W, H, style);
          ids[s.id] = v.id;
          cells.push(v.xml);
        }
        for (const s of doc.sections) {
          if (s.parent && ids[s.id] && ids[s.parent])
            cells.push(edge(ids[s.parent], ids[s.id], 'edgeStyle=entityRelationEdgeStyle;rounded=1;html=1;endArrow=none;strokeColor=#999999;'));
        }
        for (const x of doc.xrefs) {
          if (ids[x.from] && ids[x.to])
            cells.push(edge(ids[x.from], ids[x.to], 'curved=1;html=1;dashed=1;strokeColor=#6c8ebf;endArrow=open;opacity=60;'));
        }
        y += 60;
      }
      page('Outline', cells);
    }

    // Page 2: timeline, one column per date
    {
      const cells = [];
      const secs = [];
      docs.forEach((d) => d.sections.forEach((s) => { if (s.own && s.level > 0) secs.push(s); }));
      const dates = [...new Set(secs.map((s) => s.own))].sort();
      const CW = 250;
      dates.forEach((dt, i) => {
        cells.push(vertex(dt, i * (CW + 30), 0, CW, 36, 'rounded=1;html=1;fillColor=#333333;fontColor=#ffffff;strokeColor=none;fontStyle=1;').xml);
        let y = 50;
        secs.filter((s) => s.own === dt).forEach((s) => {
          const h = 64;
          const first = s.blocks[0] ? summarize(s.blocks[0].plain, 90) : '';
          const html = `<b>${escXml((s.num ? s.num + ' ' : '') + s.title)}</b><br>${escXml(first)}`;
          cells.push(vertex(html, i * (CW + 30), y, CW, h,
            'rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=6;fontSize=10;fillColor=#dae8fc;strokeColor=#6c8ebf;', null, true).xml);
          y += h + 10;
        });
      });
      page('Timeline', cells);
    }

    // Page 3: board, one swimlane per kind
    {
      const cells = [];
      const LW = 280;
      KIND_ORDER.forEach((kind, i) => {
        const items = [];
        docs.forEach((d) => d.items.forEach((b) => { if (b.kind === kind) items.push({ b, d }); }));
        const h = 40 + items.length * 78 + 10;
        const k = KIND_DIO[kind];
        const lane = vertex(`${kind[0].toUpperCase() + kind.slice(1)} (${items.length})`, i * (LW + 20), 0, LW, h,
          `swimlane;html=1;startSize=30;fillColor=${DIO_FILLS[k]};strokeColor=${DIO_STROKES[k]};fontStyle=1;`);
        cells.push(lane.xml);
        items.forEach(({ b, d }, j) => {
          const s = d.byId[b.sectionId];
          const t = summarize(b.plain, 150) + `\n— ${s.num ? '§' + s.num : s.title}`;
          cells.push(vertex(t, 10, 40 + j * 78, LW - 20, 70,
            'rounded=1;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=4;fontSize=10;fillColor=#ffffff;strokeColor=' + DIO_STROKES[k] + ';', lane.id).xml);
        });
      });
      page('Board', cells);
    }
    return `<mxfile host="mdviz" agent="mdviz">${pages.join('')}</mxfile>\n`;
  }

  function stats(doc) {
    const c = { sections: doc.sections.length - 1, tables: doc.tables.length, entities: Object.keys(doc.entities).length, words: doc.wordCount };
    KIND_ORDER.forEach((k) => { c[k] = doc.items.filter((b) => b.kind === k).length; });
    return c;
  }

  // ---------- project log: ## Now + ## Log with dated entries (see template/project-log.md) ----------
  function buildLog(doc) {
    const L2 = doc.sections.filter((s) => s.level === 2);
    const nowSec = L2.find((s) => /^(now|current( system| state)?|system)$/i.test(s.title));
    const logSec = L2.find((s) => /^(log|timeline|change ?log|history)$/i.test(s.title));
    if (!logSec && !doc.meta.project) return null;
    const kids = (s) => s.children.map((c) => doc.byId[c]);
    const part = (e, re) => kids(e).find((k) => re.test(k.title.trim()));
    const own = (s) => (s ? s.blocks : []);
    const subtree = (s) => [s].concat(...kids(s).map(subtree));
    const entries = (logSec ? kids(logSec) : []).map((e, i) => {
      const date = firstDate(e.fullTitle);
      const title = e.fullTitle.replace(/\b20\d{2}-\d{2}-\d{2}(?:\/\d{2})?\b/, '').replace(/^\s*[·•\-–—:|]\s*|\s*[·•\-–—:|]\s*$/g, '').trim() || e.title;
      const before = part(e, /^before$/i), after = part(e, /^after$/i);
      const dec = part(e, /^decisions?$/i), res = part(e, /^(results?|measurements?)$/i), open = part(e, /^(open|open items|next)$/i);
      const summaryTok = e.tokens.find((t) => t.type === 'blockquote') || e.tokens.find((t) => t.type === 'paragraph');
      return {
        id: e.id, index: i, date, title, summary: summaryTok ? (summaryTok.text || '').replace(/^>\s?/gm, '').trim() : '',
        before: before ? before.mermaid : [], after: after ? after.mermaid : [],
        diagrams: e.mermaid, // diagrams directly under the entry heading
        decisions: own(dec).filter((b) => b.list || b.kind === 'decision'),
        decisionDiagrams: dec ? dec.mermaid : [],
        results: res ? res.tables : [], resultCharts: res ? res.charts : [],
        open: own(open).map((b) => ({ md: b.md, done: !!(b.list && b.list.checked), blockId: b.id })),
        scenarios: subtree(e).flatMap((k) => k.scenarios),
        notes: kids(e).filter((k) => ![before, after, dec, res, open].includes(k) && !/^(example|scenario|walkthrough)s?$/i.test(k.title.trim())).map((k) => k.id),
      };
    });
    // ## Terms: "- **term**: explanation" (also "—"); hovering a diagram node or a word shows it
    const termSec = L2.find((s) => /^(terms|glossary)$/i.test(s.title));
    const terms = (termSec ? termSec.blocks : []).map((b) => {
      const m = /^\s*\*\*(.+?)\*\*\s*[:—–-]?\s*([\s\S]+)$/.exec(b.md);
      if (!m) return null;
      const names = toPlain(m[1]).split(/\s*[\/,]\s*/).map((x) => x.trim()).filter(Boolean);
      return { term: names[0], names, md: m[2].trim() };
    }).filter(Boolean);
    const nowOpen = nowSec ? part(nowSec, /^(open|open items)$/i) : null;
    return {
      project: doc.meta.project || doc.title, goal: doc.meta.goal || '', status: doc.meta.status || '',
      code: doc.meta.code || doc.meta.repos || '',
      now: nowSec ? {
        id: nowSec.id, summary: (nowSec.tokens.find((t) => t.type === 'paragraph') || {}).text || '',
        diagrams: nowSec.mermaid, tables: nowSec.tables,
        open: own(nowOpen).map((b) => ({ md: b.md, done: !!(b.list && b.list.checked), blockId: b.id })),
      } : null,
      entries, terms,
    };
  }

  // ---------- before/after diagram diff (mermaid flowcharts) ----------
  const MM_KEYWORDS = new Set(['flowchart', 'graph', 'subgraph', 'end', 'direction', 'style', 'classDef', 'class', 'click', 'linkStyle', 'TB', 'TD', 'BT', 'LR', 'RL']);
  function flowNodes(src) {
    if (!/^\s*(flowchart|graph)\b/.test(src)) return null;
    const nodes = {}, groups = new Set();
    for (let line of src.split('\n')) {
      line = line.replace(/%%.*$/, '');
      const sg = /^\s*subgraph\s+([A-Za-z_][\w-]*)/.exec(line);
      if (sg) { groups.add(sg[1]); continue; }
      if (/^\s*(classDef|class|style|linkStyle|click|direction)\b/.test(line)) continue;
      const def = /([A-Za-z_][\w-]*)\s*(\(\(|\(\[|\[\(|\[\[|\{\{|\[\/|\[\\|\[|\(|\{|>)\s*("([^"]*)"|[^\]\)\}]*)/g;
      let m;
      while ((m = def.exec(line))) nodes[m[1]] = (m[4] != null ? m[4] : m[3]).trim();
      // bare references in edges: strip labels, strings and edge text first
      const bare = line.replace(/"[^"]*"/g, '').replace(/\|[^|]*\|/g, '').replace(/(\(\(|\(\[|\[\(|\[\[|\{\{|\[|\(|\{)[^\]\)\}]*[\]\)\}]+/g, '')
        .replace(/--\s[^-]*?--?>|-\.\s.*?\.->|==\s.*?==>/g, ' --> ').replace(/:::\w+/g, '');
      (bare.match(/[A-Za-z_][\w-]*/g) || []).forEach((id) => { if (!MM_KEYWORDS.has(id) && !(id in nodes)) nodes[id] = nodes[id] ?? null; });
    }
    groups.forEach((g) => delete nodes[g]);
    return nodes;
  }
  const DIFF_STYLE = {
    added: 'fill:#1baf7a2e,stroke:#1baf7a,stroke-width:2.5px',
    changed: 'fill:#eda10029,stroke:#eda100,stroke-width:2.5px',
    removed: 'fill:#e3494824,stroke:#e34948,stroke-width:2px,stroke-dasharray:5 3',
  };
  const styleClasses = (src, marks) => {
    let out = src.replace(/\s+$/, '');
    for (const k of Object.keys(DIFF_STYLE)) {
      const ids = marks[k] || [];
      const used = new RegExp(':::' + k + '\\b').test(src);
      if (!ids.length && !used) continue;
      out += `\n  classDef ${k} ${DIFF_STYLE[k]}`;
      if (ids.length) out += `\n  class ${ids.join(',')} ${k}`;
    }
    return out;
  };
  // returns sources with added / changed / removed nodes styled, plus the lists
  function diffDiagrams(before, after) {
    const a = before ? flowNodes(before) : null, b = after ? flowNodes(after) : null;
    if (!a || !b) return { before: before && styleClasses(before, {}), after: after && styleClasses(after, {}), added: [], changed: [], removed: [] };
    const norm = (x) => String(x || '').replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const added = Object.keys(b).filter((k) => !(k in a));
    const removed = Object.keys(a).filter((k) => !(k in b));
    const changed = Object.keys(b).filter((k) => k in a && a[k] != null && b[k] != null && norm(a[k]) !== norm(b[k]));
    return {
      before: styleClasses(before, { removed }), after: styleClasses(after, { added, changed }),
      added: added.map((k) => b[k] || k), changed: changed.map((k) => b[k] || k), removed: removed.map((k) => a[k] || k),
    };
  }

  return { parseDoc, diffDiagrams, styleClasses, toDrawio, toPlain, summarize, parseCell, classify, stats, KIND_ORDER, slug };
});
