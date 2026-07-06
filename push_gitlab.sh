#!/usr/bin/env bash
set -euo pipefail

remote_name="${GITLAB_REMOTE_NAME:-gitlab}"
remote_url="${GITLAB_REMOTE_URL:-https://gitlab.aigov.go.kr/dreamingw/draft_web_for_1row.git}"
local_branch="${1:-main}"
target_branch="${GITLAB_TARGET_BRANCH:-main}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Git 저장소 안에서 실행해 주세요." >&2
  exit 1
fi

if ! git show-ref --verify --quiet "refs/heads/${local_branch}"; then
  echo "로컬 브랜치를 찾을 수 없습니다: ${local_branch}" >&2
  exit 1
fi

if ! git remote get-url "${remote_name}" >/dev/null 2>&1; then
  git remote add "${remote_name}" "${remote_url}"
fi

printf "GitLab 토큰을 입력하세요: " >&2
IFS= read -r -s GITLAB_TOKEN
printf "\n" >&2

if [ -z "${GITLAB_TOKEN}" ]; then
  echo "토큰이 비어 있어 중단합니다." >&2
  exit 1
fi

export GITLAB_TOKEN
askpass_file="$(mktemp)"

cleanup() {
  rm -f "${askpass_file}"
  unset GITLAB_TOKEN
}

trap cleanup EXIT INT TERM

cat > "${askpass_file}" <<'ASKPASS'
#!/usr/bin/env bash
case "$1" in
  *Username*) printf '%s\n' 'oauth2' ;;
  *Password*) printf '%s\n' "${GITLAB_TOKEN}" ;;
  *) printf '\n' ;;
esac
ASKPASS

chmod 700 "${askpass_file}"

echo "GitLab 원격 최신 상태를 확인합니다..." >&2
GIT_ASKPASS="${askpass_file}" GIT_TERMINAL_PROMPT=0 \
  git fetch "${remote_name}" "${target_branch}"

echo "GitLab ${target_branch} 브랜치로 푸시합니다..." >&2
GIT_ASKPASS="${askpass_file}" GIT_TERMINAL_PROMPT=0 \
  git push --force-with-lease "${remote_name}" "${local_branch}:${target_branch}"

echo "완료했습니다." >&2
