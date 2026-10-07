#!/bin/bash
# Vercel "Ignored Build Step" for the apps in this repo (each app's
# vercel.json runs it as its ignoreCommand, from the app's own folder).
#
# Vercel already skips a project when a change only touches other workspace
# packages, but any change outside the workspaces (supabase/, .github/, the
# readme, ...) makes it build every project. This decides from the app's own
# inputs instead: the paths given as arguments, relative to the repo root.
#
# Exit 0 skips the build; exit 1 builds. Anything unexpected builds.

cd "$(git rev-parse --show-toplevel)" || exit 1

# What this branch last deployed for this project. Empty on a branch's first
# deployment, and it can be missing from Vercel's shallow clone.
base="$VERCEL_GIT_PREVIOUS_SHA"
if [ -n "$base" ] && ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  git fetch --quiet --depth=1 origin "$base" 2>/dev/null || base=""
fi

# Otherwise compare with where the branch left main.
if [ -z "$base" ]; then
  git fetch --quiet --depth=200 origin main 2>/dev/null || exit 1
  main="$(git rev-parse FETCH_HEAD)"
  # The clone is shallow: reach far enough back on this branch to meet main.
  git fetch --quiet --deepen=200 origin "${VERCEL_GIT_COMMIT_SHA:-HEAD}" 2>/dev/null
  base="$(git merge-base "$main" HEAD 2>/dev/null)"
  [ -z "$base" ] && exit 1
  # On main itself with no earlier deployment, there is nothing to compare.
  [ "$base" = "$(git rev-parse HEAD)" ] && exit 1
fi

if git diff --quiet "$base" HEAD -- "$@"; then
  echo "No changes in: $*. Skipping the build."
  exit 0
fi

echo "Changes in: $*. Building."
exit 1
