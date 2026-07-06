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

## 실행 범위

현재는 여러 기안기 환경에서 바로 확인할 수 있도록 모든 사이트에서 실행됩니다.
필요하면 `draft_web_for_1row.user.js`의 아래 줄을 실제 기안기 주소로 좁힐 수 있습니다.

```js
// @match        *://*/*
```
