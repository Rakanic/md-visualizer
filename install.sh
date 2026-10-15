#!/bin/bash
# Set up this machine so every Claude Code session keeps project logs in the mdviz format.
#   ./install.sh           link the project-log skill, add the global rule, create ~/project-logs
#   ./install.sh --app     also build and install the macOS app (needs Xcode command line tools)
#   ./install.sh --remove  undo the skill link and the rule
# Safe to re-run; update later with `git pull` (the skill is a link into this checkout).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$HOME/.claude/skills/project-log"
RULES="$HOME/.claude/CLAUDE.md"
BEGIN="<!-- project-log:begin -->"
END="<!-- project-log:end -->"

strip_rule() { [ -f "$RULES" ] && python3 - "$RULES" "$BEGIN" "$END" <<'PY'
import sys, re
p, b, e = sys.argv[1:4]
s = open(p).read()
s = re.sub(r"\n?" + re.escape(b) + r".*?" + re.escape(e) + r"\n?", "\n", s, flags=re.S)
open(p, "w").write(s.rstrip("\n") + "\n" if s.strip() else "")
PY
}

if [ "${1:-}" = "--remove" ]; then
  [ -L "$SKILL_DIR" ] && rm "$SKILL_DIR" && echo "removed $SKILL_DIR"
  strip_rule || true
  echo "removed the project-log rule from $RULES"
  exit 0
fi

mkdir -p "$HOME/.claude/skills" "$HOME/project-logs"
if [ -e "$SKILL_DIR" ] && [ ! -L "$SKILL_DIR" ]; then
  echo "$SKILL_DIR exists and is not a link; move it aside first" >&2; exit 1
fi
ln -sfn "$ROOT/skills/project-log" "$SKILL_DIR"
echo "linked $SKILL_DIR -> $ROOT/skills/project-log"

touch "$RULES"
strip_rule
cat >> "$RULES" <<RULE

$BEGIN
## Project logs

When you record work on a project (a plan, design notes, a status update, a calibration or debugging round), write it into
that project's log using the \`project-log\` skill, instead of a new free-form markdown file:

- One log per project: the path named in the repo's CLAUDE.md (\`Project log: <path>\`), otherwise \`~/project-logs/<project>.md\`.
- \`## Now\` (current system diagram, key numbers, open items), \`## Terms\`, then dated \`## Log\` entries with Before/After
  diagrams, 1-3 one-sentence decisions, and an interactive \`scenario\` example when a decision depends on timing or a failure mode.
- Diagrams first, very little prose. Never invent numbers; mark schematic timing \`"illustrative": true\`.
$END
RULE
echo "added the project-log rule to $RULES"
echo "logs go in $HOME/project-logs"

if [ "${1:-}" = "--app" ]; then
  if [ "$(uname)" = "Darwin" ]; then "$ROOT/macos/build-app.sh" --install; else echo "--app is macOS only; use bin/mdviz (Node 18+) elsewhere"; fi
fi
