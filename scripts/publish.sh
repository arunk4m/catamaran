#!/usr/bin/env bash
# One-shot publisher for Catamaran: creates the GitHub repo, pushes all
# branches, opens the stacked feature PRs, and (optionally) merges them and
# cuts the v0.1.0 release with the DMG + updater artifacts.
#
#   bash scripts/publish.sh              # create repo, push, open PRs
#   bash scripts/publish.sh --merge-all  # ...then merge the stack in order
#   bash scripts/publish.sh --release    # ...then create the v0.1.0 release
#
# Requires: gh (authenticated), and a completed `pnpm tauri build`.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO_NAME="catamaran"
MERGE_ALL=false
RELEASE=false
for arg in "$@"; do
  case "$arg" in
    --merge-all) MERGE_ALL=true ;;
    --release) MERGE_ALL=true; RELEASE=true ;;
  esac
done

BRANCHES=(
  feat/split-view
  feat/logs-superpowers
  feat/columns-everywhere
  feat/palette-actions
  chore/release-0.1.0
  feat/ui-refresh
  fix/exec-env-hardening
)

# 1. Create the repo (private; flip to public whenever you like) and push.
if ! git remote get-url origin >/dev/null 2>&1; then
  gh repo create "$REPO_NAME" --private --source . --remote origin \
    --description "Twin-hull Kubernetes workspace: split-screen dual-context views, pure-Rust core, MCP-native"
fi
git push -u origin main
for b in "${BRANCHES[@]}"; do git push -u origin "$b"; done

# 2. Open the stacked PRs (each based on the previous branch, so every PR
#    shows only its own diff; GitHub retargets to main as the stack merges).
pr() { # pr <head> <base> <title> <body>
  gh pr create --head "$1" --base "$2" --title "$3" --body "$4" || true
}

pr feat/split-view main \
  "Split View: two cluster contexts side by side" \
"The flagship feature: ⌘\\ splits the workspace into port and starboard panes — each a full workspace with its own context, namespace, tabs, and log dock. Compare prod beside staging, tail two pods' logs at once, and enable Link panes to mirror kind+namespace navigation while each pane keeps its own cluster.

- lib/panes.ts: pure deck model (split/close/focus/swap/ratio/link), unit-tested
- Per-pane tab + dock state; the focused pane drives sidebar/hotbar/palette/status bar
- Pane headers with port/starboard identity and link/swap/close controls
- Divider drag to resize, double-click to recenter, ⌘⌥←/→ to move focus
- Deck layout (split/ratio/linked) persists across launches"

pr feat/logs-superpowers feat/split-view \
  "Logs: previous instance, timestamps, since/tail windows" \
"Implements the upstream logs wishlist (srelens/srelens#20) end to end.

- k8s.podLogs + live streams accept previous / timestamps / since_seconds / tail_lines (a since window wins over tail, matching kubectl; reconnects still tail 0)
- LogsView: window picker (100–5,000 lines, 5m–24h), timestamps toggle, previous-instance toggle (pauses follow), multi-container export keeps source labels
- klog level colouriser skips RFC3339 prefixes so error/warn detection works with timestamps on
- IconButton gains an active (toggle) state"

pr feat/columns-everywhere feat/logs-superpowers \
  "Show/hide columns on every resource table" \
"Rolls the nodes-only column picker out everywhere (srelens/srelens#89).

- ResourceBrowser: picker on every kind's toolbar; per-kind persistence; identifying column pinned; a hidden column can't stay the active search filter
- CustomResourceBrowser: same picker for CRD tables, persisted per CRD name"

pr feat/palette-actions feat/columns-everywhere \
  "Command palette: action commands and fuzzy + frecency ranking" \
"Implements the palette wishlist (srelens/srelens#22).

- lib/paletteRank: fuzzy subsequence scorer (prefix ≫ word-boundary ≫ scattered, run bonus, gap/length penalties) + frecency boost from recents; stable sort keeps curated order on ties
- Actions group: Split the Deck / Close Split View, Focus Other Pane, Link/Unlink/Swap Panes, Toggle Theme, New Resource — with keyword aliases"

pr chore/release-0.1.0 feat/palette-actions \
  "Release prep: v0.1.0 metadata" \
"Product name/window title/About menu capitalization, version 0.1.0 across tauri.conf and the cargo workspace (About menu + MCP banner), CONTRIBUTING prose polish."

pr feat/ui-refresh chore/release-0.1.0 \
  "Regatta chrome: Catamaran's own design language" \
"Retires the inherited Lens-style chrome in every surface: a labeled circular-avatar cluster rail with gradient active ring, aboard dots, and brand mast; a floating rounded content card over an aurora backdrop; pill deck tabs; pill nav rows with small-caps headings; tinted table hover/selection with blurred sticky headers; pill dock tabs; borderless status bar; unified avatar treatment; eased motion across the chrome."

pr fix/exec-env-hardening feat/ui-refresh \
  "fix(auth): ambient AWS creds can't override a profile-pinned exec" \
"A GUI app can inherit stale AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_SESSION_TOKEN from the terminal that launched it; those outrank AWS_PROFILE in the credential chain, so kubeconfig exec plugins mint tokens as the wrong (expired) identity and EKS answers 401 even though kubectl works elsewhere. When an exec block pins its own env, Catamaran now asks kube-rs to drop the ambient credential trio for that exec (never dropping a var the block pins itself). Unit-tested; verified live against EKS with a poisoned environment."

# 3. Optionally merge the stack bottom-up (GitHub retargets as bases merge).
if $MERGE_ALL; then
  for b in "${BRANCHES[@]}"; do
    gh pr merge "$b" --squash --delete-branch
  done
  git checkout main && git pull --ff-only
fi

# 4. Optionally cut the release with the locally-built artifacts.
if $RELEASE; then
  DMG=$(ls target/release/bundle/dmg/Catamaran_*_aarch64.dmg | head -1)
  TARBALL=$(ls target/release/bundle/macos/Catamaran.app.tar.gz 2>/dev/null | head -1 || true)
  SIG=$(ls target/release/bundle/macos/Catamaran.app.tar.gz.sig 2>/dev/null | head -1 || true)

  # Compose the updater manifest the app polls (Settings → Updates).
  if [[ -n "$TARBALL" && -n "$SIG" ]]; then
    OWNER=$(gh repo view --json owner --jq .owner.login)
    python3 - "$SIG" "$OWNER" <<'PY'
import json, sys, datetime
sig, owner = open(sys.argv[1]).read().strip(), sys.argv[2]
url = f"https://github.com/{owner}/catamaran/releases/download/v0.1.0/Catamaran.app.tar.gz"
manifest = {
    "version": "0.1.0",
    "notes": "Catamaran 0.1.0 — first release",
    "pub_date": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "platforms": {"darwin-aarch64": {"signature": sig, "url": url}},
}
json.dump(manifest, open("latest.json", "w"), indent=2)
PY
    gh release create v0.1.0 --title "Catamaran 0.1.0" \
      --notes "Twin-hull Kubernetes workspace: Split View (dual contexts, dual log docks, linked cruising), log windows/timestamps/previous-instance, column visibility on every table, fuzzy+frecency command palette with workspace actions, MCP-native core. See README for details." \
      "$DMG" "$TARBALL" "$SIG" latest.json
    rm -f latest.json
  else
    gh release create v0.1.0 --title "Catamaran 0.1.0" \
      --notes "Twin-hull Kubernetes workspace — first release." "$DMG"
  fi
fi

echo "Done. Repo: $(gh repo view --json url --jq .url 2>/dev/null || echo '<pending>')"
