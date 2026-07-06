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

print_push_permission_help() {
  cat >&2 <<'HELP'

GitLab에서 push를 거부했습니다.

확인할 것:
- 토큰에 write_repository 권한이 있는지 확인하세요.
- 토큰 주인이 이 프로젝트의 Developer 또는 Maintainer 이상인지 확인하세요.
- main 브랜치가 보호 브랜치라면 Maintainer만 push 가능할 수 있습니다.
- 권한이 애매하면 GitLab 프로젝트의 Settings > Repository > Protected branches를 확인하세요.

이 문제는 로컬 스크립트가 아니라 GitLab 서버 권한 설정에서 해결해야 합니다.
HELP
}

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
fetch_output="$(GIT_ASKPASS="${askpass_file}" GIT_TERMINAL_PROMPT=0 \
  git fetch "${remote_name}" "${target_branch}" 2>&1)" || {
  printf '%s\n' "${fetch_output}" >&2
  exit 1
}

printf '%s\n' "${fetch_output}" >&2

echo "GitLab ${target_branch} 브랜치로 푸시합니다..." >&2
push_output="$(GIT_ASKPASS="${askpass_file}" GIT_TERMINAL_PROMPT=0 \
  git push --force-with-lease "${remote_name}" "${local_branch}:${target_branch}" 2>&1)" || {
  printf '%s\n' "${push_output}" >&2

  if printf '%s\n' "${push_output}" | grep -qiE 'not allowed to push|403|protected branch'; then
    print_push_permission_help
  fi

  exit 1
}

printf '%s\n' "${push_output}" >&2

echo "완료했습니다." >&2
