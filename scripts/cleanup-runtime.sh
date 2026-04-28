#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

PIDS=()

log() {
  printf '[cleanup-runtime] %s\n' "$*"
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

add_pid() {
  local pid="$1"
  [[ -n "${pid}" ]] || return 0
  [[ "${pid}" =~ ^[0-9]+$ ]] || return 0
  if [[ "${pid}" -eq $$ ]]; then
    return 0
  fi

  local existing
  for existing in "${PIDS[@]:-}"; do
    if [[ "${existing}" == "${pid}" ]]; then
      return 0
    fi
  done
  PIDS+=("${pid}")
}

collect_descendants() {
  local parent_pid="$1"
  local child_pid

  while read -r child_pid; do
    [[ -n "${child_pid}" ]] || continue
    add_pid "${child_pid}"
    collect_descendants "${child_pid}"
  done < <(ps -o pid= --ppid "${parent_pid}" 2>/dev/null | awk '{print $1}')
}

collect_port_pids() {
  local port="$1"
  if has_cmd lsof; then
    while read -r pid; do
      add_pid "${pid}"
    done < <(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)
  fi
}

collect_matching_pids() {
  local pattern="$1"
  while read -r pid; do
    add_pid "${pid}"
  done < <(ps -axo pid=,command= | awk -v pat="${pattern}" '$0 ~ pat { print $1 }')
}

collect_project_node_pids() {
  collect_matching_pids "${PROJECT_ROOT//\//\\/}.*node .*index\\.js"
  collect_matching_pids "${PROJECT_ROOT//\//\\/}.*next dev"
  collect_matching_pids "${PROJECT_ROOT//\//\\/}.*next start"
  collect_matching_pids "${PROJECT_ROOT//\//\\/}.*concurrently"
  collect_matching_pids "${PROJECT_ROOT//\//\\/}.*npm (start|run dev|run start:prod)"
}

collect_project_mihomo_pids() {
  collect_matching_pids "${PROJECT_ROOT//\//\\/}/bin/mihomo"
  collect_matching_pids "${PROJECT_ROOT//\//\\/}/bin/workdir_"
}

collect_project_chrome_pids() {
  collect_matching_pids "(chrome|chromium).*--headless=new.*--disable-blink-features=AutomationControlled"
  collect_matching_pids "(chrome|chromium).*--proxy-server=http://127\\.0\\.0\\.1:"
}

kill_pid_group() {
  local signal="$1"
  shift
  local pid
  for pid in "$@"; do
    if kill -0 "${pid}" 2>/dev/null; then
      kill "-${signal}" "${pid}" 2>/dev/null || true
    fi
  done
}

cleanup_workdirs() {
  if [[ -d "${PROJECT_ROOT}/bin" ]]; then
    find "${PROJECT_ROOT}/bin" -maxdepth 1 -type d -name 'workdir_*' -empty -exec rmdir {} + 2>/dev/null || true
  fi
}

main() {
  log "Project root: ${PROJECT_ROOT}"

  collect_port_pids 9060
  collect_port_pids 3000
  collect_project_node_pids
  collect_project_mihomo_pids
  collect_project_chrome_pids

  local root_pids=("${PIDS[@]:-}")
  local pid
  for pid in "${root_pids[@]:-}"; do
    collect_descendants "${pid}"
  done

  if [[ "${#PIDS[@]}" -eq 0 ]]; then
    log "No matching runtime processes found."
    cleanup_workdirs
    exit 0
  fi

  log "Stopping PIDs: ${PIDS[*]}"
  kill_pid_group TERM "${PIDS[@]}"
  sleep 2

  local remaining=()
  for pid in "${PIDS[@]}"; do
    if kill -0 "${pid}" 2>/dev/null; then
      remaining+=("${pid}")
    fi
  done

  if [[ "${#remaining[@]}" -gt 0 ]]; then
    log "Force killing remaining PIDs: ${remaining[*]}"
    kill_pid_group KILL "${remaining[@]}"
    sleep 1
  fi

  cleanup_workdirs
  log "Runtime cleanup complete."
}

main "$@"
