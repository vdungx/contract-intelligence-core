# docs

Index canonical cho tài liệu sản phẩm và kỹ thuật. Mọi tài liệu khác là tham chiếu hoặc lịch sử;
khi mâu thuẫn, authority nằm ở mục tương ứng dưới đây. Thay đổi tài liệu đi qua PR như code
(2 approval).

## Phạm vi sản phẩm

- [DOC-01 — Product Vision](DOC-01-product-vision.md): vấn đề, người dùng, giá trị.
- [DOC-02 — BRD](DOC-02-brd.md): business rules và disposition.
- [DOC-03 — PRD](DOC-03-prd.md): hành vi sản phẩm, UX, acceptance.

## Kiến trúc

- Kiến trúc mục tiêu: [DOC-04](DOC-04-architecture.md) (Draft, design baseline — không phải bằng
  chứng mọi phần đã chạy), [DOC-04b schema PostgreSQL](DOC-04b-postgres-schema.sql),
  [DOC-04c ERD](DOC-04c-database-erd.md), [DOC-04d backend layering](DOC-04d-backend-architecture.md).
- Cấu trúc và luồng tích hợp hiện tại: [README của repo](../README.md),
  [backend/README.md](../backend/README.md) và [ai-service/README.md](../ai-service/README.md).
  Một capability chỉ coi là implemented khi có code wiring và test tương ứng.
- Luồng end-to-end và ranh giới subsystem: [DOC-07](DOC-07-khung-project.md).

## Contract giao tiếp

- **FE ↔ BE:** [DOC-05b](DOC-05b-frontend-backend-api-contract.md) `v5.1.0` là spec hành vi
  canonical. [frontend/API-BE.md](../frontend/API-BE.md) là bảng tra endpoint/shape khi nối
  frontend, **không phải spec**; [frontend/BE-OVERVIEW.md](../frontend/BE-OVERVIEW.md) liệt kê
  phần tổng quan backend chưa có.
- **BE ↔ AI1:** [DOC-05d](DOC-05d-kafka-ai1-ocr-contract.md) — Kafka là đường runtime chính.
  [DOC-05c](DOC-05c-backend-ai-service-contract.md) giữ HTTP job shape dùng lại làm payload;
  JSON Schema và wire contract ở [contracts/](contracts/README.md).
- **BE ↔ AI2:** runtime hiện tại là HTTP submit + poll, canonical payload/lifecycle ở
  [contracts/BE-AI2-PROCESSING-CONTRACT.vi.md](contracts/BE-AI2-PROCESSING-CONTRACT.vi.md).
  [DOC-05e](DOC-05e-kafka-ai2-idp-contract.md) là hướng Kafka **đã accepted nhưng chưa chạy**;
  `/query` vẫn là HTTP đồng bộ. Schema ở [contracts/](contracts/README.md).
- **AI1:** [ai-service/docs/architecture_ai1.md](../ai-service/docs/architecture_ai1.md); snapshot
  schema [ai1.snapshot.v1.schema.json](contracts/ai1.snapshot.v1.schema.json).
- **AI2 workspace/demo:** kiến trúc và pipeline đã hợp nhất ở
  [ai2/AI2-DOC-04-architecture.vi.md](ai2/AI2-DOC-04-architecture.vi.md) và
  [ai2/AI2-07-full-pipeline.vi.md](ai2/AI2-07-full-pipeline.vi.md).
- [DOC-05-api-spec.yaml](DOC-05-api-spec.yaml) là OpenAPI snapshot cũ, không phải contract sống;
  dùng `/openapi.json` của backend và DOC-05b.

## Vận hành và setup

- Chạy full stack local: [AI2-LOCAL-SETUP.md](AI2-LOCAL-SETUP.md).
- Test E2E Upload → AI1 → AI2: [HUONG-DAN-TEST-E2E-UPLOAD.md](HUONG-DAN-TEST-E2E-UPLOAD.md).
- Keycloak/SSO và quản lý người dùng: [KEYCLOAK-SETUP.md](KEYCLOAK-SETUP.md).
- Giám sát: [MONITORING.md](MONITORING.md).
- Deploy production: [deploy/README.md](../deploy/README.md); script kiểm tra release/E2E ở
  [scripts/](../scripts/) và [docker-compose.golive-e2e.yml](../docker-compose.golive-e2e.yml).

## Quy trình

- [CONTRIBUTING.md](../CONTRIBUTING.md): nhánh, PR, workflow hằng ngày, hotfix, checklist trước push.
- [governance/README.md](governance/README.md): quy ước tài liệu.
- [decisions.md](decisions.md): decision register.
- [code-standards.md](code-standards.md): quy ước code và boundary hiện có.
- [contracts/README.md](contracts/README.md): quy tắc version và authority của wire contract.
- [backlog.yaml](backlog.yaml): backlog kỹ thuật.

## Lịch sử và evidence

Các mục dưới đây là bản ghi, không phải authority hiện hành.

- [system-architecture.md](system-architecture.md): snapshot boundary AI2 ngày 25/09/2026;
  chỉ mặc định graph flag được đối chiếu lại ngày 23/10, không phải bản đồ full stack hiện tại.
- [DOC-06](DOC-06-eval-report.md): protocol/template đánh giá; chỉ số thật phải có evidence,
  không suy ra từ template.
- `DOC-09` → `DOC-15`: SAD Sprint 2, báo cáo sửa backend, định hướng Sprint 3, kế hoạch deploy,
  quy trình tách 4 phần, checklist commit và CI/CD.
- [plans/](../plans/): plan thực thi theo ngày.
- [reviews/](reviews/README.md): artifact review tài liệu.
- [evidence/](evidence/): evidence test cho từng task.
- [nghiem-thu/EPIC-08.md](nghiem-thu/EPIC-08.md): biên bản nghiệm thu.
- [evals/](../evals/): harness/gate đánh giá deterministic, không phải business ground truth đã duyệt.
- [output/](../output/): artifact sinh khi chạy local, không phải source.
