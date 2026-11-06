# FORM3D 외부 API (온이 연동) v1

- 주소: `http://127.0.0.1:8765/api/v1` — 같은 컴퓨터에서만 접근 가능 (다른 IP·다른 Host·브라우저 외부 Origin 거부)
- 인증: `Authorization: Bearer <토큰>` — 토큰은 `문서\FORM3D\oni-token.txt` (서버에는 해시만 저장)
- 권한(scope): `scene:read`(씬·프로젝트 조회) · `scene:write`(편집 명령) · `view`(카메라) · `project:read`(저장 목록)
- 명령 표준: `packages/model-types/src/commands.json` (protocol `form3d.command` 1.0). AI는 코드를 실행할 수 없고 이 목록의 명령만 보낼 수 있습니다.
- 실행 위치: 서버는 명령을 직접 실행하지 않고, 열려 있는 편집기로 전달합니다. 편집기 정책(거부/확인 후 실행/자동 실행)에 따라 처리됩니다.

## 엔드포인트
| 메서드 | 경로 | 권한 | 설명 |
| --- | --- | --- | --- |
| GET | /capabilities | (토큰) | 명령 목록·제한·엔진 목록·편집기 연결 상태 |
| GET | /project | scene:read | 열린 프로젝트 정보 (이름, 변경 여부, 선택 등) |
| GET | /scene | scene:read | 씬 요약 (오브젝트 트리, 위치, 색상) |
| GET | /projects | project:read | 저장소의 프로젝트 목록 |
| POST | /jobs | 명령별 | 작업 실행 `{ "steps": [...], "summary"?, "request"?, "id"?, "wait"? }` (wait:false → 202 + 작업 ID) |
| POST | /objects | scene:write | 도형 생성 `{ shape, name?, position?, color?, count? }` |
| PATCH | /objects/{id} | scene:write | 수정 `{ position?, rotation_deg?, scale?, translate?, color?, metalness?, roughness?, visible?, name? }` |
| DELETE | /objects/{id} | scene:write | 삭제 |
| GET | /ai/models | (토큰) | 사용 가능한 AI 모델·상태 (키 미포함) |
| POST | /assist | scene:read + scene:write | 자연어 요청 `{ text, conversation?, wait? }` → AI 계획 → 편집기 정책대로 실행. 질문/답변이면 실행 안 함 |

**대화 이어가기 (v0.4.5):** `/assist`에 같은 `conversation` 값을 보내면 AI가 이전 요청과 실행 결과를 기억합니다. 실행 결과에는 만든 오브젝트의 id도 포함됩니다. `conversation`을 생략하면 토큰마다 대화 하나를 씁니다.
- 응답과 `GET /jobs/{id}`에는 `conversation`, `plan.message`(AI가 사용자에게 하는 말), `result.created`([{id, name}])가 들어 있습니다.
- 예시: `{"text":"원기둥 하나 만들어 줘","conversation":"oni-1"}`를 보낸 뒤 `{"text":"조금 더 크게 해줘","conversation":"oni-1"}`를 보내면, 방금 만든 원기둥을 1.25배로 키우는 계획이 나옵니다.
- 현재 장면 상태는 `GET /scene`으로 확인합니다.
| GET | /jobs/{id} | (토큰) | 진행 상태: queued · planning · awaiting_confirmation · running · done · failed · rejected · cancelled · answered · error |
| GET | /engines | (토큰) | 생성 엔진 목록 (이미지·애니메이션·영상·3D: 모두 "planned", 사용 불가) |
| POST | /engines/{id}/jobs | (토큰) | 현재 항상 501 (구현 안 됨) |

## 작업 예
```json
POST /api/v1/jobs
{ "summary": "빨간 구 2개", "steps": [
  { "command": "create_primitive", "params": { "shape": "sphere", "count": 2, "color": "#e53935" } },
  { "command": "transform", "params": { "target": "created", "translate": [0, 1, 0] } }
] }
```
결과(JobResult): `{ "jobId": "job_...", "status": "success|failed|invalid|rejected", "message": "...", "steps": [...], "created": [{ "id", "name" }] }`
- 한 단계라도 실패하면 전체 취소(부분 실행 없음), 성공하면 편집기에서 Ctrl+Z 한 번으로 되돌릴 수 있습니다.

## 오류 코드
401 토큰 없음/틀림 · 403 권한 부족·정책 거부·외부 접근 · 409 사용자가 취소 · 422 명령 검증 실패(이유 목록 포함) · 501 엔진 미구현 · 503 편집기 미연결 · 504 응답 시간 초과(확인 대기 최대 5분)

## curl 예 (Windows cmd)
```
curl -H "Authorization: Bearer 토큰" http://127.0.0.1:8765/api/v1/scene
curl -X POST -H "Authorization: Bearer 토큰" -H "Content-Type: application/json" -d "{\"shape\":\"box\"}" http://127.0.0.1:8765/api/v1/objects
```
