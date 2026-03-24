# 교재 링크 데이터

- **런타임 소스:** MongoDB 컬렉션 `textbook_links` (`GET /api/textbooks/links`)
- **이 폴더의 `textbook-links.json`:** DB가 비어 있을 때 **최초 API 요청 시 자동으로 시드**되는 백업/초기값입니다.
- **관리자 API:** `GET/POST/DELETE /api/admin/textbook-links` — 단건 upsert(`textbookKey`, `kyoboUrl`, `description`) 또는 `POST { "links": { ... } }` 일괄 upsert

JSON을 수정한 뒤 DB에 반영하려면: 관리자 `POST`로 `links` 객체를 보내거나, 개발 중에는 DB를 비운 뒤 다시 `GET /api/textbooks/links`로 시드를 트리거하세요.
