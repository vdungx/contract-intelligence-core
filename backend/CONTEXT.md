# backend/CONTEXT.md
> **Hub ngữ cảnh backend.** Đọc file này trước; runtime = code + ORM + migration Alembic, không phải tài liệu thiết kế.
> **Canonical:** [DOC-04b SQL design](../docs/DOC-04b-postgres-schema.sql), [DOC-04c ERD](../docs/DOC-04c-database-erd.md), [DOC-04d layering](../docs/DOC-04d-backend-architecture.md), [DOC-05b FE↔BE](../docs/DOC-05b-frontend-backend-api-contract.md), [BE-AI2 HTTP](../docs/contracts/BE-AI2-PROCESSING-CONTRACT.vi.md).
> **Vận hành:** [backend README](README.md), [backend CONTRIBUTING](CONTRIBUTING.md), [CONTRIBUTING gốc](../CONTRIBUTING.md), [docs index](../docs/README.md).

## 1. Tổng quan
Backend là **modular monolith** cho Contract Intelligence: nhận hồ sơ, điều phối OCR/IDP, lưu kết quả có citation, phục vụ HITL review/approve và Q&A. FE chỉ gọi backend; AI1/AI2 chỉ nhận việc và trả kết quả.

| Hạng mục | Hiện trạng |
|---|---|
| API | Python 3.11+, FastAPI, Pydantic v2; `contract_intelligence.main:app` |
| Worker | `python -m contract_intelligence.worker`; pipeline chạy ở đây, không ở API process |
| DB / ORM | PostgreSQL, SQLAlchemy 2 async + asyncpg; migration Alembic (`backend/alembic/versions/`) |
| File | S3/MinIO (`aioboto3`), bucket PDF `dossiers`, render `ci-render` |
| Hàng đợi | Thiết kế: PostgreSQL lease trên `job` (`lease_owner`, `lease_expires_at`; claim `FOR UPDATE SKIP LOCKED`) — pipeline hiện chạy trong Kafka worker, chưa có lease consumer; **không Redis/Celery** |
| AI | AI1 OCR qua Kafka; AI2 IDP/compare qua HTTP submit + poll; Q&A qua `/query` HTTP đồng bộ |
| Auth | Keycloak Bearer JWT (RS256/JWKS) + `X-Tenant-Id` |

## 2. Vai trò backend
**Trong phạm vi:** validate upload, lưu dossier/document/job, điều phối pipeline, persist kết quả AI, state machine, ACL/tenant, review/approve, audit/cost, tombstone/purge, API cho FE.

**Ngoài phạm vi:** model OCR/IDP, giao diện, hạ tầng AI. Không tạo repo mới. Backend sở hữu ACL và persistence; AI không tự quyết quyền, không đọc DB backend.

## 3. Kiến trúc

### 3.1 Quyết định kiến trúc

| Quyết định | Giá trị |
|---|---|
| Deployment | Modular monolith, không microservices trong giai đoạn này |
| Design | DDD + Clean Architecture, 4 layer mỗi bounded context |
| Bounded context | 5 BC: `contract`, `extraction`, `conflict`, `review`, `identity` + `shared` kernel |
| Domain | Pure Python: dataclass, enum, Protocol; không framework/ORM |
| Dependency | `interfaces → application → domain`; `infrastructure → domain`; cross-BC qua `shared` hoặc domain event |
| Database | PostgreSQL; tenant isolation trên bảng nghiệp vụ |
| Tích hợp AI | AI1 Kafka, AI2 HTTP (DOC-05e Kafka AI2 accepted nhưng chưa chạy) |
| Bảo mật | Keycloak OIDC, RBAC + tenant + ACL hồ sơ |

Chi tiết layering/ADR: [DOC-04d](../docs/DOC-04d-backend-architecture.md). Bản đồ current-state: [system-architecture](../docs/system-architecture.md). FE chỉ gọi backend; AI1 nhận việc qua Kafka, AI2 qua HTTP submit/poll; backend giữ ACL/persistence, AI không đọc DB backend và không có webhook AI→backend.

### 3.2 Bounded Context

| Module | Trách nhiệm chính |
|---|---|
| `contract` | Dossier, document, job, manifest/membership, batch, xoá 2 bước, optimization |
| `extraction` | Pipeline run/step, page, OCR line, text, bảng, clause tree, fact, citation, re-OCR, SSE |
| `conflict` | Finding, finding side, annex link; “conflict” là projection finding cần reviewer, không có bảng riêng |
| `review` | Review item/action, khoá hồ sơ, approve, external approval |
| `identity` | `app_user`, đồng bộ user từ Keycloak, Keycloak admin client |
| `shared` | Auth/tenant/ACL, persistence, response/error, audit, query policy, AI adapters, storage |

Ngoài DDD: `api/v1/` (users, admin, dossier query/ask), `admin/activity_feed.py`, `infrastructure/`, `schemas/`.

### 3.3 Nguyên tắc Dependency Rule
- **Domain thuần:** chỉ stdlib + `shared/`; không FastAPI, SQLAlchemy, Pydantic, httpx, JWT, MinIO, và không import BC khác.
- **Application** chỉ phụ thuộc `domain/` + `shared/`; không import `infrastructure/`/`interfaces/` (ngoại lệ tạm thời: ApprovalService, ReOcrService — xem `.importlinter`).
- **Infrastructure** cài đặt Protocol của domain; được dùng framework nhưng không import router/API DTO.
- **Interfaces** là composition root duy nhất được wire implementation vào Protocol.
- **Cross-BC** chỉ qua `shared/`, domain event hoặc public application service; không gọi repository/implementation của BC khác.
- Enforce bởi `import-linter` ([.importlinter](.importlinter)) và test architecture; CI fail nếu vi phạm.

### 3.4 Cấu trúc thư mục

```text
backend/
├── src/contract_intelligence/{contract,extraction,conflict,review,identity}/{domain,application,infrastructure,interfaces}
├── src/contract_intelligence/{shared,config,infrastructure,schemas,admin,api/v1,monitoring}  main.py  worker.py
├── alembic/versions/  tests/{unit,integration,architecture}/
├── pyproject.toml  .importlinter  alembic.ini  Dockerfile
└── README.md  CONTRIBUTING.md  CONTEXT.md
```

## 4. Vòng đời hồ sơ

### 4.1 Luồng trạng thái chính
`JobStatus` (`contract/domain/entities/job.py`): `uploaded`, `processing`, `extracted`, `pending_review`, `reviewed`, `approved`, `failed`, `cancelled`.

| Từ | Đến hợp lệ |
|---|---|
| `uploaded` | `processing`, `failed`, `cancelled` |
| `processing` | `extracted`, `pending_review`, `failed`, `cancelled` |
| `extracted` | `pending_review`, `failed` |
| `pending_review` | `reviewed`, `failed`, `processing` |
| `reviewed` | `approved`, `failed` |
| `approved` | — (terminal) |
| `failed` | `processing` (retry thường); `extracted` (ngoại lệ AI2-only bên dưới) |
| `cancelled` | — (terminal, do xoá hồ sơ) |

**Bước do người thực hiện** (`contract/infrastructure/persistence/dossier_status.py`):

- `pending_review → reviewed`: action đóng item mở cuối cùng; `open` và `awaiting_evidence` đều tính là mở. Action giữ row lock dossier nên hai reviewer đóng hai item cuối cùng vẫn chỉ chuyển một lần.
- `reviewed → approved`: `POST /dossiers/{id}/approve` (ADMINISTRATOR), khi không còn item `open`/`awaiting_evidence`; hồ sơ `pending_review` không còn item mở được chuyển `reviewed → approved` trong cùng request. Ghi `dossier_approval` + checksum.
- Mỗi bước đổi dossier và job mới nhất, ghi `audit_event` (`dossier.reviewed`, `dossier.approved`). Khoá hồ sơ là cờ `is_locked` (`dossier.locked`), không phải `JobStatus`; hồ sơ khoá/đã duyệt/đã xoá từ chối review.
- Xoá hồ sơ huỷ job `uploaded`/`processing` thành `cancelled`; trạng thái khác giữ vỏ.

**Lỗi và retry:** `failed` lưu `error_code`/`error_detail` trên job. Retry thường quay về `processing`; riêng `_reopen_for_ai2_retry` trong `worker.py` cho `failed → extracted` để chạy lại AI2 mà không OCR lại, khi lỗi là `AI2_PROCESSING_FAILED` hoặc `AI2_TIMEOUT` và mọi document đã có extraction lưu trên run. Router/worker hiện kiểm mã lỗi, không kiểm `errors[].retryable`; không coi trường retryability trong [BE-AI2](../docs/contracts/BE-AI2-PROCESSING-CONTRACT.vi.md) là enforcement đã có trong backend.

### 4.3 Upload và an toàn file
- Mỗi file PDF tối đa 50 MiB (`413`); dossier tối đa 6 tài liệu (`422 DOSSIER_TOO_MANY_DOCUMENTS`). PDF phải đọc được/đếm được trang (`422`); kiểm tra trước khi stage để không để lại dossier dở.
- Tên file client gửi chỉ lấy basename, bỏ `../`/backslash, lọc ký tự lạ, cắt 255, có fallback. Download dùng `Content-Disposition` fallback ASCII + `filename*=UTF-8''...` cho tên tiếng Việt.
- Text lưu DB chuẩn hoá NFC trước khi so khớp/lưu.

### 4.4 Quyền trên hồ sơ (ACL)
Một quyết định duy nhất: `shared/acl.py::dossier_access_decision`. Mặc định từ chối; phải đồng thời:

1. cùng tenant (`principal.tenant_id == dossier_tenant_id`);
2. đúng role cho `AclAction`;
3. là chủ hồ sơ (`created_by`) **hoặc** có grant còn hiệu lực trong `shared_with`.

Grant `read` chỉ xem; không review, approve, sửa. Grant `disabled`, hết `expires_at`, hoặc `expires_at` không đọc được → không có quyền. `access_scope: "mine"` chặn mọi share. Grant có thể giới hạn thêm `roles`/`actions`.

**ADMINISTRATOR cùng tenant, không phải chủ, không có grant:** không đọc nội dung (hồ sơ, document, fact, finding, citation, Q&A, review), nhưng được xoá hồ sơ và đổi quyền chia sẻ (`DOSSIER_MANAGE`). Lý do: dọn/thu hồi quyền khi chủ vắng, không cần đọc hợp đồng; mọi thao tác ghi activity kèm người thực hiện.

Deny trả `detail.code`: `ROLE_DENIED`, `READ_ONLY`, `ACL_DENIED`. Test: `tests/unit/test_dossier_acl_consistency.py`, `tests/integration/test_tenant_isolation.py`.

## 5. Data model / Database schema
> **Không chép DDL, số bảng/index hay phiên bản migration vào đây.** Runtime: ORM từng BC + Alembic. Thiết kế/DDL: [DOC-04b](../docs/DOC-04b-postgres-schema.sql); ERD/quan hệ: [DOC-04c](../docs/DOC-04c-database-erd.md).

- Mọi bảng nghiệp vụ có `tenant_id`; query luôn lọc tenant.
- ID ULID có tiền tố (`dos_`, `doc_`, `job_`, `run_`, `ri_`, `ra_`...).
- Bbox CPS `[x0,y0,x1,y1]` chuẩn hoá `0..1`, gốc trên-trái sau `/Rotate`.
- Thời gian `TIMESTAMPTZ` UTC; ngày nghiệp vụ `DATE`.
- Kết quả máy, review action, approval, audit, cost ledger append-only; sửa qua action mới.
- “Conflict” không phải bảng: projection finding cần reviewer. Giá trị hiệu lực của fact lấy theo action review mới nhất.

### 5.1 Nhóm bảng theo BC

| Nhóm | Bảng tiêu biểu |
|---|---|
| `contract` | `batch`, `dossier`, `document`, `job`, `manifest`/`manifest_item`/`manifest_relation`, `optimization_*` |
| `extraction` | `pipeline_run`, `pipeline_step`, `page`, `document_text`, `ocr_line`, `doc_table`/`table_cell`, `clause_node`/`clause_region`, `citation`, `fact`, `reocr_request` |
| `conflict` | `finding`, `finding_side`, `annex_link` |
| `review` | `review_item`, `review_action`, `dossier_approval`, `external_approval_grant` |
| `identity` | `app_user` |
| `shared`/vận hành | `audit_event`, `usage_ledger`, `deletion_ledger`, `query_answer`/`query_trace`, `run_event` |

### 5.2 Optimistic Concurrency — luồng & ràng buộc
- `review_item.version` bắt đầu `1`, tăng mỗi action. `POST /review-items/{id}/actions` bắt buộc `base_version >= 1`; review theo clause/finding dùng `0` khi chưa có item.
- Transaction review action lấy row lock theo thứ tự **job → review_item → dossier**, kiểm tra hồ sơ không khoá/approved/deleted, rồi so `version` với `base_version`.
- Khớp: tăng version, insert `review_action` (`base_version`), ghi audit, đóng item (`needs_more_evidence` → `awaiting_evidence`, còn lại → `resolved`).
- Lệch: `409`. Unique `(review_item_id, base_version)` là chốt chặn race; request thua cũng map 409.
- Domain code `REVIEW_VERSION_CONFLICT`; response review dùng `code: "VERSION_CONFLICT"` (khác tên, cùng nghĩa 409).
- `Idempotency-Key` review là optional, **chưa có replay store**; response `idempotent_replay` luôn `false`. `POST /dossiers/{id}/reprocess` bắt buộc key: gắn actor + dossier + base run + source digest; cùng binding replay run cũ, khác binding 409.

### 5.3 Ngày hiệu lực & `annex_sequence` — denormalize
- `document.signing_date`, `document.effective_date` nullable, lưu trực tiếp khi pipeline có fact ngày (S7); query không join `fact` để tính lại.
- `annex_link.annex_sequence`, `annex_link.effective_date` lưu cùng link theo kết quả AI2; đọc/sort theo cột này, không suy từ filename/upload order.

### 5.4 Bộ Indexes bắt buộc
Danh mục đầy đủ ở DOC-04b/DOC-04c; runtime do ORM + Alembic tạo. Index hiện có cho hot path: tenant trên bảng nghiệp vụ; `document (dossier_id, order_index)`; `page`/`ocr_line` theo `document_id`; `job (status, created_at)` + `lease_expires_at`; `review_item` theo `dossier_id`/`run_id`; `review_action (review_item_id, base_version)` unique; `finding` theo `dossier_id`/`run_id`; `citation`/`fact` theo `document_id`. Query mới phải đo `EXPLAIN` trước khi thêm index.

### 5.5 Bất biến & xoá dữ liệu
- Bảng kết quả máy và audit chỉ INSERT; sửa bằng bản ghi mới.
- Xoá 2 bước: tombstone đồng bộ (ẩn, chặn file, huỷ job, ghi `deletion_ledger`) rồi purge nội dung bất đồng bộ.
- Purge xoá PDF/render/OCR/clause/citation/table/fact/finding, làm rỗng tên; **giữ** `usage_ledger`, `review_action`, `job_event`, `deletion_ledger` và vỏ `dossier`/`job`/`pipeline_run`.
- Purge gọi AI2 xoá dữ liệu; lỗi ghi `failed`, sweep retry. Ledger cũ đã purge nội dung nhưng thiếu evidence AI2 chỉ retry pha AI2.

## 6. API

### 6.1 Auth và tenant
- `Authorization: Bearer <access_token>` do Keycloak cấp; verify RS256 qua JWKS, không dùng session cookie.
- Request nghiệp vụ có `X-Tenant-Id` khớp claim `tenant_id`; thiếu → `400`, lệch → `403 TENANT_MISMATCH`.
- Role: `OPERATOR`, `REVIEWER`, `ADMINISTRATOR`; quyền hồ sơ vẫn qua ACL §4.4.

### 6.2 Nhóm endpoint
Nhóm nghiệp vụ: upload/dossier, pipeline/extraction, conflict/citation, review/approval, query/ask; cộng admin/users. **Không chép endpoint map ở đây.** Hợp đồng hành vi: [DOC-05b](../docs/DOC-05b-frontend-backend-api-contract.md); OpenAPI sống: `/openapi.json`, `/docs`; [DOC-05 YAML](../docs/DOC-05-api-spec.yaml) là snapshot cũ. Base `/api/v1`; breaking change sang `/api/v2`.

**Quy ước chung:** JSON UTF-8, thời gian ISO 8601 UTC; phân trang `limit`/`offset` (mặc định 50, tối đa 200), response danh sách dùng `meta.page`, `meta.page_size`, `meta.total`. Không dùng cursor/page-total kiểu khác.

### 6.4 Format response chuẩn
Thành công: `ApiMeta` (`shared/responses.py`) có đúng các field nullable `trace_id`, `request_id`, `page`, `page_size`, `total`; không có `timestamp`; `extra="forbid"`.

```json
{"data": {}, "meta": {"trace_id": "…", "request_id": "…", "page": 1, "page_size": 50, "total": 120}}
```

Lỗi nghiệp vụ mặc định:

```json
{"error": {"code": "INVALID_STATE_TRANSITION", "message": "…", "details": {}}, "meta": {"trace_id": "…", "request_id": "…", "page": null, "page_size": null, "total": null}}
```

**Không phải RFC 9457 toàn cục.** Một số lỗi upload (`404`, `413`, `422`) vẫn trả `{"detail": …}` của FastAPI; `409` review có shape riêng `{"error": {"code", "message"}, "current_state": …, "your_submitted_action": …}` và không có `meta`. Đừng giả định mọi lỗi cùng envelope.

### 6.5 Ví dụ review action

```http
POST /api/v1/review-items/<review_item_id>/actions
Idempotency-Key: <optional; accepted, no replay store>

{"action": "correct", "base_version": 3, "corrected_value": {"field": "<new value>"}}
```

`200` trả `data`: `review_action_id`, `item_status`, `new_version`, `effective_value`, `machine_value`, `job_status`, `open_items_remaining`, `idempotent_replay`. `base_version` cũ → `409` với `code: "VERSION_CONFLICT"` + `current_state`.

## 7. Contract backend ↔ AI
- **AI1:** upload commit phát `dossier.uploaded`; orchestrator publish `ci.ai1.ocr.commands`; AI1 trả `ci.ai1.ocr.results`. At-least-once, handler idempotent theo DB (stale run, result đã ghi, failed sau result). Backend persist snapshot, cập nhật job/dossier. [DOC-05d](../docs/DOC-05d-kafka-ai1-ocr-contract.md).
- **AI2 hiện tại:** worker `POST {AI2_BASE_URL}/jobs/idp` rồi poll `GET /jobs/{id}`; persist finding/result và chuyển review. `/query` HTTP đồng bộ. [BE-AI2](../docs/contracts/BE-AI2-PROCESSING-CONTRACT.vi.md).
- **AI2 tương lai:** [DOC-05e](../docs/DOC-05e-kafka-ai2-idp-contract.md) là Kafka **đã accepted nhưng chưa chạy** — không mô tả như implemented.

## 8. Quality gates và way of working

```bash
cd backend
uv sync
uv run pytest tests/ -v
uv run ruff format src tests && uv run ruff check src tests
uv run mypy src/ && uv run lint-imports
```

- CI: import-linter (Dependency Rule), Ruff, MyPy strict, unit + architecture, integration.
- Test dirs: `tests/unit/` logic, `tests/architecture/` boundary, `tests/integration/` API/auth/pipeline.
- Không commit secret; dùng env/pydantic-settings. Nhánh/PR/checklist: [CONTRIBUTING gốc](../CONTRIBUTING.md), [backend CONTRIBUTING](CONTRIBUTING.md).

## 9. Trạng thái
- **Đang chạy:** modular monolith 5 BC + shared, Keycloak Bearer + tenant, Kafka AI1, AI2 HTTP submit/poll, review optimistic concurrency, tombstone + purge async, ACL fail-closed.
- **Chưa chạy:** Kafka AI2 (DOC-05e accepted), các phần target trong DOC-04/DOC-04b/DOC-04c chưa có code wiring.
- **Cách đọc:** schema hiện tại = ORM + Alembic; hành vi = code + test; hợp đồng = DOC-05b/BE-AI2. Tài liệu thiết kế không tự động là implemented. Quyết định mới ghi [decisions.md](../docs/decisions.md); việc mở theo [backlog](../docs/backlog.yaml).

*Hub ngữ cảnh backend. Cập nhật: 2026-10-23.*
