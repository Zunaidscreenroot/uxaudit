#!/usr/bin/env bash
set -eu

# Netlify sets SITE_NAME for build and Deploy Preview contexts.
# Allow only the canonical preview project; skip builds from duplicate sites.
if [ "${SITE_NAME:-}" = "uxaudit-preview" ]; then
  echo "Allowed Netlify project: uxaudit-preview. Continuing build."
  exit 1
fi

echo "Skipping Netlify project '${SITE_NAME:-unknown}': this repository is configured to deploy only to uxaudit-preview."
exit 0
