# draft_web_for_1row

Tampermonkey에서 한글 웹 기안기 선택 텍스트의 자간을 빠르게 조정하는 userscript입니다.

## 현재 기능

- `4칸 단축`: 선택한 텍스트에 HWP `CharShapeSpacingDecrease` 액션을 최대 4회 실행하고, 줄 변화가 감지되면 중간에 멈춥니다.
- `2칸 늘리기`: 선택한 텍스트에 HWP `CharShapeSpacingIncrease` 액션을 최대 2회 실행하고, 줄 변화가 감지되면 중간에 멈춥니다.
- 웹 기안기가 iframe 안에 있어도 접근 가능한 HWP 컨트롤 객체를 찾아 실행합니다.
- 실행 결과와 대상 정보는 콘솔 로그에 남기고, 화면에는 버튼만 표시합니다.

## 파일

- `draft_web_for_1row.user.js`: Tampermonkey에 넣을 userscript

## 설치

1. Tampermonkey 대시보드에서 새 스크립트를 만듭니다.
2. `draft_web_for_1row.user.js` 내용을 붙여넣고 저장합니다.
3. 한글 웹 기안기 페이지를 새로고침합니다.
4. 텍스트를 드래그한 뒤 오른쪽 아래의 `4칸 단축` 또는 `2칸 늘리기` 버튼을 누릅니다.

## 설정

기본 횟수는 파일 상단 `CONFIG`에서 조정할 수 있습니다.

```js
apiFallbackPresses: 4, // 4칸 단축
apiExpandPresses: 2,   // 2칸 늘리기
```

## GitLab 등록

GitLab 저장소에 올릴 때는 아래 명령을 실행한 뒤 토큰만 입력합니다.

```bash
./push_gitlab.sh
```

GitLab Personal Access Token에는 `write_repository` 권한이 필요합니다.
403 오류가 나면 토큰 주인이 프로젝트의 Developer/Maintainer 권한을 갖고 있는지, `main` 브랜치가 보호 브랜치인지 확인해야 합니다.

## 메모

0.8.4에서 실행 중 `2칸 늘리기` 버튼을 눌러도 중지 요청이 동작하도록 고쳤습니다.
0.8.3에서 `4칸 단축` 중 줄 변화 감지 시 자동으로 멈추는 동작을 복구했습니다.
0.8.2부터 상태문구를 화면에 표시하지 않습니다.
0.8.1부터 실사용 버튼 실행 결과 패널을 화면에 표시하지 않습니다.
0.8.0부터 UI를 실사용 버튼 2개로 정리했습니다.
이전 진단/디버그 함수는 내부에 남아 있지만 화면에는 표시하지 않습니다.

초기 검증을 쉽게 하려고 현재는 모든 사이트에서 실행되도록 되어 있습니다.
동작이 확인되면 `draft_web_for_1row.user.js`의 아래 줄을 실제 기안기 주소로 좁히는 것이 좋습니다.

```js
// @match        *://*/*
```
