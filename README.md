**Everything in this repo was written by an agent, except for this sentence.**

# mdviz

**Drop in long markdown files and get interactive diagrams, slides, and PDFs.**

Agents like Claude write long `.md` files: plans, calibration logs, design docs, investigation reports.
After a few hundred lines they are hard to take in. mdviz parses the structure that is already in them
(numbered headings, dates, bold lead-ins, tables, backticked names, `§` references) and turns it into eight
linked views. It runs locally in your browser. Nothing is uploaded.

| View | What you get |
|---|---|
| **Overview** | Status line, counts, writing activity by date, plan-step progress, latest open items, decisions, findings, most-referenced names |
| **Map** | Collapsible mind map of the heading tree. Each node shows its date, statement counts, tables, and size. Dashed arcs mark `§` cross-references |
| **Timeline** | One column per date, with "N days later" gaps. Undated subsections nest under their dated parent |
| **Board** | Kanban of **Decision / Finding / Result / Open / Caveat** statements, filterable and sortable by date |
| **Data** | A chart for every numeric table: grouped bars (auto log scale), diverging ± % bars against a target band, line charts. Sortable tables |
| **Graph** | Force graph of files, parameters, symbols, and env vars linked to the sections that mention them. Click a node for every mention and a parameter's value history (`20 → 24`) |
| **Slides** | Auto-built deck: a title slide, a slide per section (key points plus one visual), divider slides, and closing Decisions and Open-items slides. Present full screen or export a PDF |
| **Read** | The rendered document with a table of contents. Statements are color-tagged, tables are interactive, mermaid diagrams are drawn, and `§` links work |

Search (`/`) filters every view. Click any section chip to open it in the side drawer. The `1`–`8` keys
switch views, and a light/dark toggle sits top right.

## Project logs (recommended format)

For ongoing work, keep **your logs per project** ([`skills/project-log/template.md`](skills/project-log/template.md), rules in
[`skills/project-log/SKILL.md`](skills/project-log/SKILL.md)). A log is a `## Now` snapshot (the current system diagram, the key numbers, open
items) followed by `## Log`, a dated list of entries. Each entry has a one-line summary, **Before** and **After**
diagrams, 1–3 decisions, and optional results and open items. mdviz opens these in a focused mode:

- **Timeline:** a strip of dated entries. Each entry shows Before → After side by side. Parts added, changed, or
  removed between the two diagrams are colored automatically, matched by node id.
- **System:** the current architecture, where the project stands against its goal, the open items, and a strip
  of how the system evolved.
- **Decisions:** every decision, newest first.
- **Slides:** one slide per entry.

The other views stay available under **More**. Example:
[`examples/checkout-latency.log.md`](examples/checkout-latency.log.md), a made-up project.

## Quick start

```bash
cd mdviz
open app/index.html                      # the app; drag .md files onto the window
./bin/mdviz open examples/*.md           # opens the desktop app if installed (--browser to force the browser)
```

Three ways to use it:

1. **Desktop app (macOS).** Run `./macos/build-app.sh --install` to build a native app (Swift + WebKit, about
   1 MB plus the UI) and install it as `~/Applications/mdviz.app`. It opens its own window and doesn't need a
   browser or Node. You can drop `.md` files or folders on the window or the Dock icon, use **File → Open**
   (⌘O) or **Open Recent**, or right-click a file in Finder and choose **Open With → mdviz**. The menus cover
   the views (⌘1–⌘8), Find (⌘F), and export: **Slides as PDF** (⇧⌘E), **Document as PDF** (⌥⌘E),
   **draw.io**, **JSON**, and **Print**. Files you open show on their own. Earlier ones stay in the sidebar,
   where you can check them back in. Rebuild after changing anything in `app/`.
2. **CLI**, for exports and scripts:
   ```bash
   ./bin/mdviz build plan.md -o plan.html          # one self-contained, shareable HTML file
   ./bin/mdviz pdf plan.md                         # slides → plan.slides.pdf (16:9)
   ./bin/mdviz pdf plan.md --doc                   # whole document → plan.pdf
   ./bin/mdviz drawio plan.md                      # editable draw.io (Outline / Timeline / Board pages)
   ./bin/mdviz json plan.md                        # the parsed model
   ```
   To put it on your PATH: `ln -s "$PWD/bin/mdviz" /opt/homebrew/bin/mdviz`.
3. **Agent skill on every machine**, so every Claude Code session logs work in this format:
   ```bash
   git clone <this repo> ~/src/mdviz && ~/src/mdviz/install.sh        # add --app on a Mac for the desktop app
   ```
   `install.sh` links `skills/project-log` into `~/.claude/skills/`. It also adds a short rule (between
   `project-log:begin/end` markers) to `~/.claude/CLAUDE.md`, telling every session to log work there instead of in
   free-form markdown, and creates `~/project-logs/`. To update, run `git pull`. To undo, run `install.sh --remove`.
   It's also a Claude Code plugin, if you'd rather install just the skill:
   `/plugin install mdviz --marketplace <owner>/<repo>`. Plugins can't edit `CLAUDE.md`, so add the rule
   yourself or run `install.sh`.
   Other agents that read the Agent Skills format can use `skills/project-log/` directly.

Requirements: a modern browser for the app. Node 18+ for the CLI. Chrome, Chromium, Edge, or Brave for
`pdf`. `CHROME=/path` overrides the browser.

## Use case: a project log

[`examples/checkout-latency.log.md`](examples/checkout-latency.log.md) is a made-up project. Everything in it is
invented. It shows the format end to end:

- **Now:** the current service diagram, the p95 for each scenario against a ±10 % target (charted, with the one
  row over target flagged), and two open items.
- **Terms:** seven one-liners, such as *cache stampede* and *miss coalescer*. Hover any diagram box with the
  same name to see its line.
- **Four dated entries.** Each has Before → After diagrams (the coalescer and cache show up as *added*), one or
  two decisions, a rejected alternative, and a results table.
- **Two interactive examples:** "three items, three round trips" and "three checkouts miss the same key". Press
  Play to watch the failure, then the fix, on one time axis.

```bash
./bin/mdviz open examples/checkout-latency.log.md
./bin/mdviz pdf examples/checkout-latency.log.md          # one slide per entry and example
```

mdviz also reads any long markdown, not just project logs. `examples/conventions_demo.md` uses the free-form
features: a mermaid diagram, a `chart` block, a `<!-- viz: -->` table directive, a task list, and a parameter
change. Several documents can be checked at once, and the views combine them, colored by document.

## How it reads a document

| Markdown | Becomes |
|---|---|
| `## 3.2 Cache layer (2026-09-26)` | a Map node numbered 3.2, placed on the Timeline at Sep 26 |
| `**Decision (user):** …`, `**Found:** …`, `**Result:** …`, `Open: …`, `**Caveat:** …` | Board cards and slide bullets (several per paragraph are fine) |
| `\| test \| baseline \| now \| err \|` with `410`, `−2.8 %`, `455 (+11 %)` | bar / diverging charts. Value plus delta cells give both |
| `` `services/pricing/rules.go` ``, `` `cache.ttl_s` 30 -> 60 ``, `` `evaluate()` ``, `Cart.java:120` | Graph nodes and parameter value history |
| `§6`, `(3.2)`, `see 4.1` | links in the reader and dashed arcs on the Map |
| an ordered or task list under *Steps / Plan / TODO* | a progress track |
| `≤5 %` anywhere | the default target band for percent charts |
| ` ```mermaid `, ` ```chart {json} `, `<!-- viz: chart=bars series="a,b" -->` | explicit diagrams and charts ([conventions](skills/project-log/SKILL.md)) |

Classification uses heuristics and is tuned for the way Claude writes. Run `mdviz json` to see what was
extracted. When it guesses wrong, add a bold lead-in or a `<!-- viz: kind=… -->` hint.

## draw.io / drawio-skill integration

`mdviz drawio` writes a native, editable `.drawio` with three pages: **Outline** (the heading tree plus
cross-reference arcs), **Timeline** (date columns), and **Board** (a swimlane per statement kind). It passes
the validator from [drawio-skill](https://github.com/Agents365-ai/drawio-skill):

```bash
./bin/mdviz drawio examples/checkout-latency.log.md -o checkout.drawio
python3 <drawio-skill>/skills/drawio-skill/scripts/validate.py checkout.drawio     # 0 errors, 0 warnings
# with the draw.io desktop app (brew install --cask drawio):
python3 <drawio-skill>/skills/drawio-skill/scripts/drawiohtml.py checkout.drawio   # pan/zoom HTML viewer
python3 <drawio-skill>/skills/drawio-skill/scripts/drawio2pptx.py checkout.drawio  # PowerPoint, one page per slide
```

In the other direction, an agent that needs a real architecture diagram inside a document can author it with
drawio-skill, export SVG, and embed it as `![](arch.drawio.svg)`. `mdviz build` and `mdviz pdf` inline
local images, so the output stays one file.

## Layout

```
mdviz/
  app/index.html, app.css, app.js   the app (plain JS, no build step; opens from file://)
  app/core.js                       the parser and draw.io writer, shared with the CLI
  app/vendor/                       marked 12.0.2, mermaid 11.17.2 + ELK layout (see app/vendor/README.md)
  bin/mdviz                         CLI (Node, no npm install)
  skills/project-log/SKILL.md       agent skill: the project-log format and render commands
  skills/project-log/template.md    blank project log
  .claude-plugin/                   Claude Code plugin + marketplace manifests
  install.sh                        per-machine setup: skill link, global rule, ~/project-logs
  macos/MDViz.swift                 the native macOS app (window, menus, file opening, save/print)
  macos/make-icon.swift             draws the app icon
  macos/build-app.sh                builds macos/build/mdviz.app (--install copies it to ~/Applications)
  examples/                         checkout-latency.log.md (made up), conventions_demo.md
```

Dropped documents are kept in the browser's local storage, so they are still there on the next open. Remove
them with ✕ in the sidebar. Built HTML files carry their documents inside them.

## License

MIT, see [LICENSE](LICENSE). Vendored libraries keep their own licenses (MIT; elkjs is EPL-2.0).
