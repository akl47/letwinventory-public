# Letwinventory System Requirements

## Revision History

| Rev | Date | Author | Description |
|-----|------|--------|-------------|
| A | 2026-02-09 | Claude Code | Initial requirements generation from codebase analysis |
| B | 2026-02-09 | Claude Code | Restructured system requirements to align with 21 CFR 820 and ISO 13485:2016. Moved architecture, environment config, Docker, and CI/CD to Appendix A (Development Requirements). Added QMS, Design Controls, Purchasing Controls, Identification & Traceability, Production Controls, Labeling Controls, and Records & Data Integrity sections. Added Regulatory Traceability Matrix (Appendix B). |
| C | 2026-02-09 | Claude Code | Added AS9100D aerospace QMS requirements: Operational Risk Management (§8.1.1), Configuration Management (§8.1.2), Product Safety (§8.1.3), Counterfeit Parts Prevention (§8.1.4), External Provider Control (§8.4), Production Process Verification/FAI (§8.5.1.3), Nonconforming Product Control (§8.7). Updated existing section headers with AS9100D cross-references. Expanded traceability matrix with AS9100D column. |
| D | 2026-02-09 | Claude Code | Added Appendix C: Requirements Implementation Status. Assessed all 113 requirements against codebase. 108 Met, 5 Partial. Identified open items with recommended actions for the 5 partial requirements. |
| E | 2026-02-14 | Claude Code | Added Appendix D: Frontend Verification Test Matrix. Updated Verification fields on 45+ requirements to reference specific frontend unit test spec files with line numbers. Comprehensive frontend test coverage (50+ spec files, 1500+ test cases) provides automated verification of UI behavior, component logic, service interactions, and user workflows for all functional requirements. |

---

## 1. System-Level Requirements

### 1.1 General System

### REQ-SYS-001
- **Description:** The system shall provide a web-based enterprise resource application.
- **Rationale:** Centralized management of manufacturing workflow from procurement through assembly.
- **Parameters:** Web application accessible via modern browsers (Chrome, Firefox, Edge, Safari).
- **Parent Req:** None
- **Derived Reqs:** REQ-AUTH-001, REQ-INV-001, REQ-ORD-001, REQ-PRT-001, REQ-HAR-001, REQ-PLN-001, REQ-MOB-001, REQ-BAR-001, REQ-FILE-001, REQ-NOTIF-001
- **Verification:** All derived requirement verification criteria pass.
- **Validation:** User can log in and access all major functional areas.

### REQ-SYS-004
- **Description:** The system shall use soft deletion for all user-created data by setting `activeFlag = false` rather than removing records.
- **Rationale:** Preserves audit trail and enables data recovery per 21 CFR 820.184 (device history record) and ISO 13485:2016 §4.2.5 (control of records). Prevents accidental permanent data loss.
- **Parameters:** All models with `activeFlag` field (BOOLEAN, default: true). Queries filter by `activeFlag: true` unless explicitly including inactive.
- **Parent Req:** REQ-SYS-001
- **Derived Reqs:** None
- **Verification:** DELETE endpoints set activeFlag=false. Record remains in database after deletion. Backend tests verify soft delete behavior.
- **Validation:** Deleted items disappear from default views but can be recovered or shown via "Show Inactive" toggles.

### 1.2 Quality Management System (ISO 13485:2016 §4.1, §4.2 / 21 CFR 820.20)

### REQ-SYS-QMS-001
- **Description:** The system shall enforce a Quality Management System (QMS) by providing documented procedures for all quality-affecting processes including design, procurement, production, traceability, and corrective actions.
- **Rationale:** 21 CFR 820.20 requires each manufacturer to establish a quality system. ISO 13485:2016 §4.1 requires the organization to establish, document, implement, and maintain a QMS.
- **Parameters:** QMS scope covers: design controls (harness design), purchasing controls (orders), identification and traceability (barcodes, traces), production and process controls (task management), and records management. All quality records retained per defined retention policies.
- **Parent Req:** None
- **Derived Reqs:** REQ-SYS-QMS-002, REQ-SYS-QMS-003, REQ-SYS-QMS-004
- **Verification:** QMS documentation exists for each covered process. System enforces documented procedures via workflow constraints.
- **Validation:** Quality audit confirms all QMS processes are followed through the system.

### REQ-SYS-QMS-002
- **Description:** The system shall control all quality-related documents through version-controlled, reviewable, and approvable workflows.
- **Rationale:** 21 CFR 820.40 requires procedures for document controls including review, approval, distribution, and changes. ISO 13485:2016 §4.2.4 requires control of documents.
- **Parameters:** Harness designs use release workflow (Draft → Review → Released) per REQ-HAR-013. Released documents are immutable; changes create new revisions with full change history. All document changes recorded with user, timestamp, and change description.
- **Parent Req:** REQ-SYS-QMS-001
- **Derived Reqs:** REQ-HAR-013, REQ-HAR-014, REQ-HAR-015
- **Verification:** Released documents cannot be modified. All changes create new revisions. Change history is complete and unalterable.
- **Validation:** Auditor can trace any document to its complete revision history, including who approved each version.

### REQ-SYS-QMS-003
- **Description:** The system shall maintain quality records that are legible, readily identifiable, retrievable, and protected from damage, deterioration, or loss.
- **Rationale:** 21 CFR 820.180 requires general record-keeping. ISO 13485:2016 §4.2.5 requires control of records. Records must be available for regulatory inspection.
- **Parameters:** All records stored in PostgreSQL with automatic timestamps (createdAt, updatedAt). Soft deletion prevents accidental loss (REQ-SYS-004). Records include: barcode history, task history, harness revision history, order history. All records include user attribution (who performed the action).
- **Parent Req:** REQ-SYS-QMS-001
- **Derived Reqs:** REQ-BAR-004, REQ-PLN-008, REQ-SYS-004
- **Verification:** All history tables include userID, timestamp, and action type. No records can be permanently deleted through the application.
- **Validation:** For any inventory item, auditor can retrieve complete history from creation through current state.

### REQ-SYS-QMS-004
- **Description:** The system shall enforce user authentication and record the identity of all personnel performing quality-affecting actions.
- **Rationale:** 21 CFR 820.20(b)(1) requires defined responsibility, authority, and interrelation of personnel. ISO 13485:2016 §6.2 requires personnel competence and records. All quality records must be attributable to a specific user.
- **Parameters:** Google OAuth authentication (REQ-AUTH-001) provides unique user identity. All create, update, and delete operations record `userID` or `ownerUserID`. Barcode history records userID for all actions. Task history records userID. Harness revision history records userID and releasedBy.
- **Parent Req:** REQ-SYS-QMS-001
- **Derived Reqs:** REQ-AUTH-001, REQ-AUTH-004
- **Verification:** Every history record includes a non-null userID. All API endpoints require authentication.
- **Validation:** For any action in the system, auditor can identify which user performed it and when.

### 1.3 Design Controls (21 CFR 820.30 / ISO 13485:2016 §7.3 / AS9100D §8.3)

### REQ-SYS-DC-001
- **Description:** The system shall support design and development planning, including stages, review, verification, and validation activities for wire harness designs.
- **Rationale:** 21 CFR 820.30(b) requires design and development planning. ISO 13485:2016 §7.3.2 requires design and development planning with defined stages, review, verification, validation, and responsibilities.
- **Parameters:** Harness designs progress through defined lifecycle stages: Draft (active design), Review (design review), Released (design transfer). Each stage transition is recorded. Design changes after release require new revisions (REQ-HAR-015).
- **Parent Req:** REQ-SYS-QMS-001
- **Derived Reqs:** REQ-HAR-001, REQ-HAR-013
- **Verification:** Harness cannot transition from Draft to Released without passing through Review. All transitions recorded in history.
- **Validation:** Engineering team follows defined design stages from initial draft through release.

### REQ-SYS-DC-002
- **Description:** The system shall capture and maintain design inputs including component specifications, pin configurations, and wire parameters.
- **Rationale:** 21 CFR 820.30(c) requires documented design inputs including performance requirements, safety requirements, and applicable standards. ISO 13485:2016 §7.3.3 requires design and development inputs.
- **Parameters:** Design inputs stored in harnessData JSONB: connectors (type, pinCount, pins), cables (wireCount, gaugeAWG, wires), components (pinCount, pin groups), wire properties (color, gauge, length, termination types). All inputs linked to parts catalog (partID references).
- **Parent Req:** REQ-SYS-DC-001
- **Derived Reqs:** REQ-HAR-002, REQ-HAR-003, REQ-HAR-004, REQ-HAR-005, REQ-HAR-007
- **Verification:** Harness data includes all required design input fields. Parts references are valid.
- **Validation:** Design inputs are complete and sufficient to manufacture the harness.

### REQ-SYS-DC-003
- **Description:** The system shall produce design outputs that can be verified against design inputs and that contain acceptance criteria.
- **Rationale:** 21 CFR 820.30(d) requires design outputs in terms that allow adequate evaluation against design inputs. ISO 13485:2016 §7.3.4 requires design outputs in a form suitable for verification.
- **Parameters:** Design outputs: complete harness schematic with all connections, wire routing, and component placement. Exportable as JSON (REQ-HAR-017). Validation endpoint (REQ-HAR-018) verifies structural integrity. Released harnesses serve as manufacturing specifications.
- **Parent Req:** REQ-SYS-DC-001
- **Derived Reqs:** REQ-HAR-017, REQ-HAR-018
- **Verification:** Exported design contains all information needed for manufacturing. Validation catches structural errors.
- **Validation:** Manufacturing can build a harness from the released design output without additional information.

### REQ-SYS-DC-004
- **Description:** The system shall support design review at defined stages before transitioning to the next phase.
- **Rationale:** 21 CFR 820.30(e) requires formal documented reviews of design results at appropriate stages. ISO 13485:2016 §7.3.5 requires design and development review.
- **Parameters:** Review gate: Draft → Review transition (submit-review endpoint). Rejection returns to Draft with notes (reject endpoint). Approval proceeds to Released (release endpoint). Review participants recorded via userID. Sub-harnesses cascade to review state.
- **Parent Req:** REQ-SYS-DC-001
- **Derived Reqs:** REQ-HAR-013
- **Verification:** Design cannot be released without explicit review approval. Rejection notes are recorded.
- **Validation:** Design review meeting decisions are captured in the system as approve/reject with rationale.

### REQ-SYS-DC-005
- **Description:** The system shall maintain a complete design change history with the ability to revert to any previous design state.
- **Rationale:** 21 CFR 820.30(i) requires design changes to be identified, documented, validated, verified, reviewed, and approved before implementation. ISO 13485:2016 §7.3.9 requires control of design and development changes.
- **Parameters:** HarnessRevisionHistory model records all changes with: changeType, changedBy (userID), changedAt, notes, snapshotData (full design state). Revision letters increment (A→B→...→Z→AA). Revert endpoint restores from any snapshot. Released harness edits auto-create new revision (REQ-HAR-015).
- **Parent Req:** REQ-SYS-DC-001
- **Derived Reqs:** REQ-HAR-015, REQ-HAR-009
- **Verification:** Every design change creates a history entry with before-state snapshot. Revert restores exact previous state.
- **Validation:** Auditor can view complete design evolution and revert to any prior version.

### 1.4 Purchasing Controls (21 CFR 820.50 / ISO 13485:2016 §7.4 / AS9100D §8.4)

### REQ-SYS-PC-001
- **Description:** The system shall establish and maintain purchasing procedures to ensure purchased products and services conform to specified requirements.
- **Rationale:** 21 CFR 820.50 requires procedures for purchasing and receiving to ensure purchased products conform to specified requirements. ISO 13485:2016 §7.4.1 requires a purchasing process.
- **Parameters:** Orders include: vendor identification, part specifications (linked to parts catalog), quantities, pricing. Order status workflow tracks procurement lifecycle (Draft → Pending → Placed → Shipped → Received). Vendor parts require manufacturer and manufacturer part number (REQ-PRT-002).
- **Parent Req:** REQ-SYS-QMS-001
- **Derived Reqs:** REQ-ORD-001, REQ-PRT-002
- **Verification:** Orders require valid part references. Vendor parts have manufacturer traceability. Order status progression is enforced.
- **Validation:** Purchasing team can create, track, and receive orders with full vendor and part traceability.

### REQ-SYS-PC-002
- **Description:** The system shall maintain purchasing data that clearly describes the product or service ordered including specifications, quantities, and acceptance criteria.
- **Rationale:** 21 CFR 820.50(b) requires purchasing documents to include a description of the purchased product including requirements. ISO 13485:2016 §7.4.2 requires purchasing information.
- **Parameters:** OrderItem includes: partID (links to full part specification), quantity, price, orderLineTypeID. Part record includes: name, description, vendor, SKU, manufacturer, manufacturerPN, partCategory, serialNumberRequired, lotNumberRequired. Bulk import matches parts by name to ensure consistency.
- **Parent Req:** REQ-SYS-PC-001
- **Derived Reqs:** REQ-ORD-003, REQ-ORD-005, REQ-PRT-001
- **Verification:** Order items reference valid parts with complete specifications. Bulk import validates against existing parts catalog.
- **Validation:** Purchase order contains sufficient detail for supplier to provide correct product.

### REQ-SYS-PC-003
- **Description:** The system shall support receiving inspection by tracking received quantities against ordered quantities and recording receiving activities.
- **Rationale:** 21 CFR 820.80 requires acceptance activities including receiving acceptance. ISO 13485:2016 §7.4.3 requires verification of purchased product.
- **Parameters:** OrderItem tracks receivedQuantity vs quantity. Receiving creates Trace or Equipment records with RECEIVED barcode history action. Order status auto-advances when all items fully received (REQ-ORD-004). Receiving records user, timestamp, and location.
- **Parent Req:** REQ-SYS-PC-001
- **Derived Reqs:** REQ-ORD-004, REQ-ORD-006
- **Verification:** Received quantities recorded against each line item. Receiving creates inventory records with full traceability.
- **Validation:** Receiving personnel can verify and record incoming products against the purchase order.

### 1.5 Identification and Traceability (21 CFR 820.60, 820.65 / ISO 13485:2016 §7.5.3, §7.5.9 / AS9100D §8.5.2)

### REQ-SYS-IT-001
- **Description:** The system shall provide unique identification for all inventory items throughout their lifecycle using auto-generated barcodes.
- **Rationale:** 21 CFR 820.60 requires procedures for identifying product during all stages to prevent mixups. ISO 13485:2016 §7.5.3 requires identification and traceability. 21 CFR 820.65 requires traceability for products intended for surgical implantation or life-supporting/sustaining.
- **Parameters:** Every Location, Box, Trace, and Equipment receives a unique barcode (PREFIX-XXXXXX hex format). Categories: AKL (parts/traces), LOC (locations), BOX (boxes), EQP (equipment). Barcode is generated automatically and immutable once assigned.
- **Parent Req:** REQ-SYS-QMS-001
- **Derived Reqs:** REQ-BAR-001, REQ-BAR-002, REQ-BAR-007
- **Verification:** All inventory entities have unique, non-null barcodeID. No duplicate barcode strings exist.
- **Validation:** Any physical item can be identified by scanning its barcode label.

### REQ-SYS-IT-002
- **Description:** The system shall maintain a complete audit trail of all inventory movements, transformations, and status changes.
- **Rationale:** 21 CFR 820.184 requires a Device History Record (DHR) showing dates and personnel for manufacturing activities. ISO 13485:2016 §7.5.9 requires traceability records. Traceability from raw material receipt through final product is essential for recalls and investigations.
- **Parameters:** BarcodeHistory records: CREATED, MOVED, RECEIVED, SPLIT, MERGED, DELETED actions with userID, timestamp, fromID, toID, quantity, serialNumber, lotNumber. Each history record is immutable (insert-only). Chain queries reconstruct full item history.
- **Parent Req:** REQ-SYS-IT-001
- **Derived Reqs:** REQ-BAR-004, REQ-BAR-003
- **Verification:** Every inventory action creates a history record. History records cannot be modified or deleted. Complete chain from receipt to current state is reconstructable.
- **Validation:** For any inventory item, auditor can trace its complete history from receipt through all movements and transformations.

### REQ-SYS-IT-003
- **Description:** The system shall support serial number and lot number tracking for parts that require it.
- **Rationale:** 21 CFR 820.65 requires traceability by control number (lot/serial). ISO 13485:2016 §7.5.9.1 requires unique identification of each unit or batch of medical device. Enables targeted recalls and failure investigations.
- **Parameters:** Part model includes `serialNumberRequired` and `lotNumberRequired` flags. Trace records include optional `serialNumber` and `lotNumber` fields. Barcode history records include serialNumber and lotNumber for traceability. Parts with serialNumberRequired must have unique serial numbers per trace.
- **Parent Req:** REQ-SYS-IT-001
- **Derived Reqs:** REQ-INV-005, REQ-PRT-001
- **Verification:** Parts marked serialNumberRequired enforce serial number on trace creation. Serial/lot numbers recorded in barcode history.
- **Validation:** Auditor can trace a specific serial number or lot number through the complete supply chain within the system.

### 1.6 Production and Process Controls (21 CFR 820.70 / ISO 13485:2016 §7.5 / AS9100D §8.5)

### REQ-SYS-PP-001
- **Description:** The system shall support production planning through task management with defined workflows, scheduling, and time tracking.
- **Rationale:** 21 CFR 820.70 requires that production processes are developed, conducted, controlled, and monitored. ISO 13485:2016 §7.5.1 requires control of production and service provision.
- **Parameters:** Task management with Kanban workflow (REQ-PLN-001). Task types include: normal, tracking, critical_path, scheduled. Tasks linked to projects for work breakdown. Time tracking via calendar integration (REQ-PLN-011). Scheduled tasks for recurring operations (REQ-PLN-010).
- **Parent Req:** REQ-SYS-QMS-001
- **Derived Reqs:** REQ-PLN-001, REQ-PLN-002, REQ-PLN-010, REQ-PLN-011
- **Verification:** Tasks progress through defined workflow stages. Time tracking records are created for work activities.
- **Validation:** Production activities are planned, tracked, and completed through the task system.

### REQ-SYS-PP-002
- **Description:** The system shall provide controlled manufacturing specifications through released harness designs that are read-only and revision-controlled.
- **Rationale:** 21 CFR 820.70(a) requires production processes performed according to approved instructions and SOPs. ISO 13485:2016 §7.5.1(b) requires availability of documented procedures and work instructions.
- **Parameters:** Released harness designs are immutable (REQ-HAR-014). Only released designs are valid for manufacturing. Edits to released designs create new revisions (REQ-HAR-015). Complete revision history available (REQ-SYS-DC-005).
- **Parent Req:** REQ-SYS-PP-001
- **Derived Reqs:** REQ-HAR-014, REQ-HAR-015
- **Verification:** Released harness cannot be modified through any API endpoint. All edit controls disabled in UI.
- **Validation:** Manufacturing uses only released designs; any required change follows the revision control process.

### 1.7 Labeling Controls (21 CFR 820.120 / ISO 13485:2016 §7.5.1 / AS9100D §8.5.1)

### REQ-SYS-LC-001
- **Description:** The system shall generate and print standardized barcode labels with consistent formatting for all inventory items.
- **Rationale:** 21 CFR 820.120 requires labeling activities to be controlled. ISO 13485:2016 §7.5.1(d) requires the use of suitable monitoring and measurement equipment. Labels must be accurate, legible, and traceable to the correct item.
- **Parameters:** ZPL label generation with company branding, item name, description, and quantity. Two standardized sizes: 3"x1" and 1.5"x1". Preview before printing (REQ-UX-005). Printing to configured Zebra printers (REQ-BAR-006). Labels always generated from current database state to prevent stale labels.
- **Parent Req:** REQ-SYS-QMS-001
- **Derived Reqs:** REQ-BAR-005, REQ-BAR-006, REQ-CFG-001
- **Verification:** Generated ZPL contains correct item data. Label prints match preview.
- **Validation:** Printed labels are legible, accurately identify the item, and scan correctly.

### 1.8 Records and Data Integrity (21 CFR 820.180-186 / ISO 13485:2016 §4.2.5)

### REQ-SYS-RD-001
- **Description:** The system shall maintain a Device History Record (DHR) for all manufactured products by recording the complete history of design, procurement, manufacturing, and testing activities.
- **Rationale:** 21 CFR 820.184 requires a DHR including dates of manufacture, quantity, acceptance records, labeling, and primary identification. ISO 13485:2016 §7.5.1(e) requires records that provide evidence of conformity.
- **Parameters:** DHR is the composite of: harness revision history (design), order history (procurement), barcode history (manufacturing movements and transformations), task history (production activities). All records include userID, timestamp, and action type. Records are immutable (insert-only, no updates or deletes).
- **Parent Req:** REQ-SYS-QMS-001
- **Derived Reqs:** REQ-SYS-QMS-003, REQ-BAR-004, REQ-PLN-008
- **Verification:** All history tables are insert-only. No UPDATE or DELETE operations on history records. Complete DHR reconstructable for any product.
- **Validation:** For any manufactured item, a complete DHR can be assembled from system records spanning design through shipping.

### REQ-SYS-RD-002
- **Description:** The system shall maintain a Design History File (DHF) for each wire harness design by recording all design inputs, outputs, reviews, and changes.
- **Rationale:** 21 CFR 820.30(j) requires a Design History File (DHF) for each type of device. ISO 13485:2016 §7.3.10 requires design and development files.
- **Parameters:** DHF is the composite of: HarnessRevisionHistory (all snapshots and change records), release state transitions (submit-review, reject, release with notes and user), and revision chain (previousRevisionID links). `GET /:id/history` and `GET /:id/revisions` endpoints provide DHF data.
- **Parent Req:** REQ-SYS-QMS-001
- **Derived Reqs:** REQ-HAR-013, REQ-SYS-DC-005
- **Verification:** Complete design history exists for all released harness designs. History includes all review decisions and rationale.
- **Validation:** Auditor can reconstruct the complete design evolution for any harness from initial creation through current released version.

### REQ-SYS-RD-003
- **Description:** The system shall ensure data integrity through authentication, user attribution, and timestamping of all records.
- **Rationale:** 21 CFR 820.180 requires records to be maintained to demonstrate conformity and effective operation of the QMS. 21 CFR Part 11 (electronic records) principles require attributable, legible, contemporaneous, original, and accurate (ALCOA) records.
- **Parameters:** All records include `createdAt` and `updatedAt` timestamps (auto-generated by Sequelize). All user-facing actions record `userID` from authenticated session. JWT authentication ensures identity verification. Soft deletion (REQ-SYS-004) prevents data loss. Database backups provide disaster recovery.
- **Parent Req:** REQ-SYS-QMS-001
- **Derived Reqs:** REQ-SYS-QMS-004, REQ-SYS-004
- **Verification:** All records contain non-null createdAt, updatedAt. All action records contain non-null userID. No mechanism exists to modify timestamps retroactively.
- **Validation:** Records satisfy ALCOA principles: each record is attributable to a user, legible in the UI, contemporaneously timestamped, stored as original, and accurate to the action performed.

### 1.9 Operational Risk Management (AS9100D §8.1.1)

### REQ-SYS-ORM-001
- **Description:** The system shall support operational risk identification and mitigation by providing task types that distinguish risk-critical activities and scheduling controls for recurring risk-mitigation tasks.
- **Rationale:** AS9100D §8.1.1 requires planning and management of operational risks that could directly affect product or service realization. Risks must be identified, assessed, and mitigated throughout the product lifecycle.
- **Parameters:** Task `taskTypeEnum` includes `critical_path` for risk-critical activities requiring heightened oversight. Scheduled tasks (REQ-PLN-010) automate recurring risk-mitigation activities (e.g., inspections, calibrations). Project breakdown (REQ-PLN-005) enables risk categorization by work area. Task history (REQ-PLN-008) provides evidence of risk-mitigation execution.
- **Parent Req:** REQ-SYS-QMS-001
- **Derived Reqs:** REQ-PLN-002, REQ-PLN-010, REQ-PLN-008
- **Verification:** Critical path tasks are visually distinguished. Scheduled risk-mitigation tasks execute on schedule.
- **Validation:** Operational risks are tracked and mitigated through planned activities in the task system.

### 1.10 Configuration Management (AS9100D §8.1.2)

### REQ-SYS-CM-001
- **Description:** The system shall maintain configuration management for wire harness designs by tracking the identity, functional characteristics, and physical characteristics of each design baseline and all changes to it.
- **Rationale:** AS9100D §8.1.2 requires configuration management appropriate to the organization, ensuring product integrity from design through disposal. Configuration baselines must be established, controlled, and auditable.
- **Parameters:** Configuration identity: each harness has a unique part number (auto-generated via `getNextPartNumber()`) and revision letter (A→B→...→Z→AA). Configuration baseline: released harness designs are frozen (REQ-HAR-014). Configuration change control: edits to released designs create new revisions (REQ-HAR-015) with full change history (REQ-SYS-DC-005). Configuration status: releaseState (draft/review/released) visible in list view (REQ-HAR-016).
- **Parent Req:** REQ-SYS-QMS-001
- **Derived Reqs:** REQ-HAR-001, REQ-HAR-013, REQ-HAR-014, REQ-HAR-015, REQ-HAR-016
- **Verification:** Each harness has unique part number and revision. Released configurations are immutable. All configuration changes create revision history records.
- **Validation:** Auditor can identify the exact configuration baseline for any released harness and trace all changes from the original baseline.

### REQ-SYS-CM-002
- **Description:** The system shall maintain configuration management for parts by tracking part identity, vendor, manufacturer, and specification attributes.
- **Rationale:** AS9100D §8.1.2 requires configuration identification and control. Parts catalog serves as the configuration baseline for all purchased and manufactured components.
- **Parameters:** Part model includes: name (unique), vendor, SKU, manufacturer, manufacturerPN, partCategory, serial/lot requirements, default UoM, image. Part changes tracked via updatedAt timestamp and soft deletion. Parts linked to inventory traces, order items, and harness elements via partID foreign key.
- **Parent Req:** REQ-SYS-CM-001
- **Derived Reqs:** REQ-PRT-001, REQ-PRT-002
- **Verification:** Parts have unique names. Vendor parts have manufacturer traceability. Part changes update timestamp.
- **Validation:** Any part used in production can be traced to its complete specification including vendor and manufacturer data.

### 1.11 Product Safety (AS9100D §8.1.3)

### REQ-SYS-PS-001
- **Description:** The system shall support product safety by enforcing design review gates, maintaining traceability for safety-critical components, and ensuring manufacturing uses only approved (released) designs.
- **Rationale:** AS9100D §8.1.3 requires organizations to plan, implement, and control processes for assessing and managing product safety risks. Safety-critical products require additional controls throughout the lifecycle.
- **Parameters:** Design review gates (REQ-SYS-DC-004) prevent unapproved designs from reaching production. Released designs are read-only (REQ-HAR-014). Full traceability from part receipt through final assembly (REQ-SYS-IT-002). Serial/lot tracking for safety-critical parts (REQ-SYS-IT-003). Harness validation checks structural integrity before release (REQ-HAR-018).
- **Parent Req:** REQ-SYS-QMS-001
- **Derived Reqs:** REQ-SYS-DC-004, REQ-HAR-014, REQ-HAR-018, REQ-SYS-IT-002, REQ-SYS-IT-003
- **Verification:** No unapproved design can be used for production. All safety-critical parts have serial/lot traceability. Design validation catches structural errors.
- **Validation:** Safety audit confirms only released designs are used in production and all safety-critical parts are fully traceable.

### 1.12 Prevention of Counterfeit Parts (AS9100D §8.1.4)

### REQ-SYS-CP-001
- **Description:** The system shall support counterfeit parts prevention by maintaining manufacturer traceability for all vendor-sourced parts, tracking part provenance from receipt through inventory, and preserving complete procurement records.
- **Rationale:** AS9100D §8.1.4 requires processes for prevention of counterfeit or suspect counterfeit parts and their use. Organizations must ensure parts are procured from authorized sources with full traceability to the original manufacturer.
- **Parameters:** Vendor parts require manufacturer and manufacturer part number (REQ-PRT-002). Parts linked to vendor and SKU for authorized source verification. Order records track vendor, date placed, and receiving details (REQ-ORD-001). Receiving creates barcode history RECEIVED action linking part to order (REQ-SYS-PC-003). Complete chain: manufacturer → vendor → purchase order → receiving → inventory trace with serial/lot.
- **Parent Req:** REQ-SYS-QMS-001
- **Derived Reqs:** REQ-PRT-002, REQ-ORD-001, REQ-SYS-PC-003, REQ-SYS-IT-002
- **Verification:** No vendor part can be created without manufacturer data. All received parts link to a purchase order. Complete provenance chain is reconstructable.
- **Validation:** For any part in inventory, auditor can trace provenance from manufacturer through vendor, purchase order, receiving event, and current location.

### 1.13 Control of Externally Provided Products (AS9100D §8.4 / ISO 13485:2016 §7.4)

### REQ-SYS-EP-001
- **Description:** The system shall support evaluation and monitoring of external providers (suppliers) by maintaining vendor performance data through order status tracking and receiving inspection records.
- **Rationale:** AS9100D §8.4.1 requires determining and applying criteria for evaluation, selection, monitoring, and re-evaluation of external providers. ISO 13485:2016 §7.4.1 requires evaluation of suppliers based on their ability to supply conforming product.
- **Parameters:** Orders track vendor identity, order status progression, and receiving outcomes. Order items track ordered vs received quantities (short shipments visible). Vendor parts link to manufacturer data for authorized source verification. Order list view supports filtering by vendor for performance review. Historical order data enables vendor performance analysis.
- **Parent Req:** REQ-SYS-PC-001
- **Derived Reqs:** REQ-ORD-001, REQ-ORD-002, REQ-ORD-007
- **Verification:** Orders record vendor identity. Receiving discrepancies (ordered vs received) are tracked. Order history filterable by vendor.
- **Validation:** Quality team can review vendor order history, delivery performance, and receiving discrepancies.

### 1.14 Production Process Verification (AS9100D §8.5.1.3)

### REQ-SYS-PV-001
- **Description:** The system shall support first article inspection and production process verification by tracking initial production runs through the task and inventory system with full traceability.
- **Rationale:** AS9100D §8.5.1.3 requires production process verification activities including first article inspection (FAI) per AS9102 to validate that production processes produce conforming product. FAI is required for new parts, design changes, and process changes.
- **Parameters:** First article inspection tracked as critical_path task type linked to the relevant harness design revision. FAI task references the specific harness revision and part numbers under inspection. Inventory traces for FAI units carry serial/lot numbers (REQ-SYS-IT-003). Task history records FAI completion with user and timestamp. New harness revisions (REQ-HAR-015) trigger need for new FAI activities.
- **Parent Req:** REQ-SYS-PP-001
- **Derived Reqs:** REQ-PLN-002, REQ-SYS-IT-003, REQ-HAR-015
- **Verification:** FAI tasks created for new design revisions. FAI completion recorded with traceability to specific serial/lot numbers.
- **Validation:** For each released design revision, evidence of first article inspection is traceable through the task and inventory system.

### 1.15 Nonconforming Product Control (AS9100D §8.7 / 21 CFR 820.90 / ISO 13485:2016 §8.3)

### REQ-SYS-NC-001
- **Description:** The system shall support identification and control of nonconforming product through inventory status management, quarantine via location assignment, and soft deletion for disposition.
- **Rationale:** AS9100D §8.7 requires identification, documentation, segregation, and disposition of nonconforming outputs. 21 CFR 820.90 requires procedures for control of nonconforming product. ISO 13485:2016 §8.3 requires documented procedure for nonconforming product.
- **Parameters:** Nonconforming product identified through inventory system. Quarantine supported via barcode move to designated quarantine location (REQ-BAR-003). Disposition options: rework (move back to production), scrap (delete trace with DELETED history action), or use-as-is (no action). All disposition actions recorded in barcode history with user and timestamp (REQ-SYS-IT-002). Soft deletion preserves records for investigation (REQ-SYS-004).
- **Parent Req:** REQ-SYS-QMS-001
- **Derived Reqs:** REQ-BAR-003, REQ-SYS-IT-002, REQ-SYS-004, REQ-INV-005C
- **Verification:** Nonconforming items can be moved to quarantine locations. All disposition actions create history records. Scrapped items remain in database (soft delete).
- **Validation:** Auditor can trace any nonconforming product from identification through disposition, including who performed each action.

---

## 2. Authentication & Authorization

### REQ-AUTH-001
- **Description:** The system shall authenticate users via Google OAuth 2.0.
- **Rationale:** Leverages existing Google accounts for SSO. No custom password management required.
- **Parameters:** Google OAuth with `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Callback URL configurable per environment. Passport.js GoogleStrategy.
- **Parent Req:** REQ-SYS-001
- **Derived Reqs:** REQ-AUTH-002, REQ-AUTH-003, REQ-AUTH-004, REQ-AUTH-005
- **Verification:** `GET /api/auth/google` redirects to Google OAuth consent screen. `GET /api/auth/google/callback` processes OAuth token.
- **Validation:** User can click "Login with Google", authenticate, and be redirected back to the application.

### REQ-AUTH-002
- **Description:** The system shall issue JWT access tokens upon successful authentication.
- **Rationale:** Stateless authentication for API requests. Token contains user identity.
- **Parameters:** JWT signed with `JWT_SECRET`. Payload: `{ id, displayName, email }`. Token sent in `Authorization: Bearer <token>` header.
- **Parent Req:** REQ-AUTH-001
- **Derived Reqs:** None
- **Verification:** `GET /api/auth/user/checkToken` returns 200 for valid token, 401 for invalid/expired. Backend test: `auth.test.js` checkToken tests.
- **Validation:** Authenticated requests succeed. Unauthenticated requests return 401.

### REQ-AUTH-003
- **Description:** The system shall support JWT token refresh using httpOnly refresh tokens stored as cookies.
- **Rationale:** Extends session duration without requiring re-login. httpOnly cookie prevents XSS theft.
- **Parameters:** Refresh token: 64-char random string stored in `RefreshTokens` table. Sent as httpOnly cookie. `POST /api/auth/user/refresh` exchanges refresh token for new access token.
- **Parent Req:** REQ-AUTH-001
- **Derived Reqs:** None
- **Verification:** `POST /api/auth/user/refresh` returns new accessToken. Backend test: `auth.test.js` refresh token test.
- **Validation:** When access token expires, frontend interceptor automatically refreshes and retries the failed request.

### REQ-AUTH-004
- **Description:** The system shall protect all API endpoints (except auth) with token authentication middleware.
- **Rationale:** Prevents unauthorized access to application data.
- **Parameters:** `checkToken` middleware on all non-auth routes. Validates JWT, loads user from database, verifies `activeFlag: true`. Sets `req.user` with user data.
- **Parent Req:** REQ-AUTH-001
- **Derived Reqs:** None
- **Verification:** Requests without Authorization header return 401. Requests with invalid token return 401. Backend tests verify 401 for unauthenticated requests.
- **Validation:** All protected pages redirect to login when not authenticated.

### REQ-AUTH-005
- **Description:** The system shall allow users to view and update their profile information.
- **Rationale:** Users may need to update display preferences.
- **Parameters:** `GET /api/auth/user` returns user profile. `PUT /api/auth/user` updates user fields.
- **Parent Req:** REQ-AUTH-001
- **Derived Reqs:** None
- **Verification:** Backend test: `auth.test.js` getUser and updateUser tests.
- **Validation:** User can see their name and email. User can update display name.

### REQ-AUTH-006
- **Description:** The system shall support a Google Add-on token exchange for calendar integration.
- **Rationale:** Enables Google Workspace Add-on to authenticate against the API.
- **Parameters:** `POST /api/auth/addon/token` accepts Google ID token, verifies with Google, returns Letwinventory JWT.
- **Parent Req:** REQ-AUTH-001
- **Derived Reqs:** None
- **Verification:** Endpoint accepts valid Google ID token and returns JWT.
- **Validation:** Google Add-on can authenticate and create task time tracking entries.

### REQ-AUTH-007
- **Description:** The frontend shall provide an auth guard that redirects unauthenticated users to the login page.
- **Rationale:** Prevents access to protected routes without valid session.
- **Parameters:** `authGuard` checks `AuthService.isAuthenticated()` signal. On page refresh, calls `checkAuthStatus()`. Redirects to `/home` if not authenticated.
- **Parent Req:** REQ-AUTH-001
- **Derived Reqs:** None
- **Verification:** Unit test: guard returns false and navigates to /home when not authenticated. Frontend test: `auth.guard.spec.ts` lines 22–48 (allow when authenticated, check auth status, redirect on failure).
- **Validation:** Manually navigating to a protected URL without login redirects to home page.

### REQ-AUTH-008
- **Description:** The frontend shall automatically retry failed requests after token refresh on 401 responses.
- **Rationale:** Seamless user experience when tokens expire during active session.
- **Parameters:** `authInterceptor` catches 401, calls refresh endpoint, queues concurrent requests, retries all after refresh succeeds. 403 responses clear token and redirect to home.
- **Parent Req:** REQ-AUTH-003
- **Derived Reqs:** None
- **Verification:** Unit test: interceptor retries request after successful refresh. Frontend test: `auth.interceptor.spec.ts` lines 37–192 (add auth header, skip for refresh endpoint, 401 token refresh retry, redirect on null/error refresh, request queuing during active refresh, 403 clear token + redirect, non-401/403 passthrough).
- **Validation:** User does not see login prompt during normal usage when refresh token is valid.

---

## 3. Inventory Management

### REQ-INV-001
- **Description:** The system shall provide a hierarchical inventory structure of Locations, Boxes, Traces (parts), and Equipment, each identified by a unique barcode.
- **Rationale:** Physical warehouse organization requires nested container structure with barcode tracking.
- **Parameters:** Hierarchy: Locations contain Boxes/Traces/Equipment. Each entity has a `barcodeID` linking to a unique Barcode record. Parent-child relationships via `parentBarcodeID`.
- **Parent Req:** REQ-SYS-001
- **Derived Reqs:** REQ-INV-002, REQ-INV-003, REQ-INV-004, REQ-INV-005, REQ-INV-006, REQ-INV-007
- **Verification:** Backend tests verify Location, Box, Trace, Equipment CRUD operations. Frontend test: `inventory-higherarchy-view.spec.ts` lines 56–178 (tree building from flat tags, nested children, deep nesting, search by name/barcode, equipment filter toggle, barcode selection).
- **Validation:** User can navigate the inventory tree view, expanding locations to see contained items.

### REQ-INV-002
- **Description:** The system shall display inventory in a tree view with expand/collapse navigation.
- **Rationale:** Intuitive visualization of physical warehouse layout.
- **Parameters:** Frontend `InventoryHierarchyView` component. Recursive `InventoryHierarchyItem` nodes. Backend `GET /api/inventory/location/higherarchy` returns tree data. Search filters by name/barcode/part number. Toggle to show/hide equipment. Deep linking via `?barcode=<id>` auto-expands path.
- **Parent Req:** REQ-INV-001
- **Derived Reqs:** None
- **Verification:** Backend test: location hierarchy endpoint returns tree structure (PostgreSQL-specific, requires integration test). Frontend test: `inventory-higherarchy-view.spec.ts` lines 60–112 (tree building, child nesting, deep nesting, search filtering, barcode search), `inventory-higherarchy-item.spec.ts` (toggle expand, dialog integrations, child event propagation).
- **Validation:** User can expand locations, see nested boxes and parts, search for items, and click to view details.

### REQ-INV-003
- **Description:** The system shall support CRUD operations for Locations.
- **Rationale:** Users need to create and manage physical storage locations.
- **Parameters:** Location model: name (STRING 16), description (STRING 62), barcodeID (FK, unique). Create auto-generates barcode with LOC prefix. Body validator enforces field types. `GET /:id`, `POST /`, `PUT /:id` endpoints.
- **Parent Req:** REQ-INV-001
- **Derived Reqs:** None
- **Verification:** Backend tests: `location.test.js` - get by ID, update location.
- **Validation:** User can create a new location in the inventory dialog and see it in the tree.

### REQ-INV-004
- **Description:** The system shall support CRUD operations for Boxes.
- **Rationale:** Boxes are containers within locations for organizing smaller items.
- **Parameters:** Box model: name (STRING 16), description (STRING 62), barcodeID (FK, unique). Create auto-generates barcode with BOX prefix. Body validator enforces field types. `GET /:id`, `POST /`, `PUT /:id` endpoints.
- **Parent Req:** REQ-INV-001
- **Derived Reqs:** None
- **Verification:** Backend tests: `box.test.js` - get by ID, update box.
- **Validation:** User can create a box within a location and see it nested in the tree.

### REQ-INV-005
- **Description:** The system shall support CRUD operations for Traces (inventory items with quantity tracking).
- **Rationale:** Traces represent physical stock of parts with quantities, serial numbers, and lot numbers.
- **Parameters:** Trace model: partID (FK, not null), quantity (FLOAT, not null), unitOfMeasureID (FK), serialNumber (STRING), lotNumber (STRING), barcodeID (FK, unique). Create auto-generates barcode with AKL prefix. Supports split (divide quantity), merge (combine two traces of same part), and partial deletion.
- **Parent Req:** REQ-INV-001
- **Derived Reqs:** REQ-INV-005A, REQ-INV-005B, REQ-INV-005C
- **Verification:** Backend tests: `trace.test.js` - get by part ID, get by ID, update, delete by barcode.
- **Validation:** User can see part quantities in the tree, split a trace, merge traces, and delete inventory.

### REQ-INV-005A
- **Description:** The system shall allow splitting a trace into two separate traces.
- **Rationale:** Enables dividing inventory when moving partial quantities to different locations.
- **Parameters:** `POST /api/inventory/trace/split/:barcodeId` with `{ splitQuantity }`. Creates new barcode and trace with split quantity. Reduces source trace quantity. Records SPLIT action in barcode history.
- **Parent Req:** REQ-INV-005
- **Derived Reqs:** None
- **Verification:** Backend test: split trace (PostgreSQL-specific due to barcode generation).
- **Validation:** User can split a trace and see two separate items with correct quantities.

### REQ-INV-005B
- **Description:** The system shall allow merging two traces of the same part.
- **Rationale:** Consolidates inventory when combining stock from different locations.
- **Parameters:** `POST /api/inventory/trace/merge/:barcodeId` with `{ mergeBarcodeId }`. Adds source quantity to target. Deactivates source trace and barcode. Validates same partID. Records MERGED action in barcode history.
- **Parent Req:** REQ-INV-005
- **Derived Reqs:** None
- **Verification:** Test: merge endpoint combines quantities and deactivates source.
- **Validation:** User can merge two traces of the same part into one.

### REQ-INV-005C
- **Description:** The system shall allow partial or full deletion of trace inventory.
- **Rationale:** Accounts for consumed, damaged, or lost inventory.
- **Parameters:** `DELETE /api/inventory/trace/barcode/:barcodeId` with optional `{ deleteQuantity }`. If deleteQuantity provided: reduces quantity (must be less than current). If null: full deletion (deactivates trace and barcode). Records DELETED action in barcode history.
- **Parent Req:** REQ-INV-005
- **Derived Reqs:** None
- **Verification:** Backend test: delete trace by barcode.
- **Validation:** User can reduce or fully remove inventory from the system.

### REQ-INV-006
- **Description:** The system shall support CRUD operations for Equipment with serial number and commission date tracking.
- **Rationale:** Equipment requires individual tracking beyond simple quantity counts.
- **Parameters:** Equipment model: name (STRING, not null), description, serialNumber, commissionDate (DATEONLY), barcodeID (FK, unique), partID (FK), orderItemID (FK). `GET /`, `GET /:id`, `POST /`, `POST /receive`, `PUT /:id`, `DELETE /:id` endpoints. Receive endpoint creates equipment from order item with barcode history.
- **Parent Req:** REQ-INV-001
- **Derived Reqs:** None
- **Verification:** Backend tests: `equipment.test.js` - list, get by ID, update, delete. Frontend test: `equipment-table-view.spec.ts` (loading, filtering, pagination, sorting, dialog integration), `equipment-edit-dialog.spec.ts` (create/edit modes, validation, delete confirmation).
- **Validation:** User can create equipment, assign serial numbers, track commission dates, and link to parts/orders.

### REQ-INV-007
- **Description:** The system shall maintain reference data for Units of Measure.
- **Rationale:** Parts can be measured in different units (each, grams, gallons, etc.).
- **Parameters:** Seeded values: ea (Each), gal (Gallon), g (Gram), kg (Kilogram). `GET /api/inventory/unitofmeasure` returns all active UoMs.
- **Parent Req:** REQ-INV-001
- **Derived Reqs:** None
- **Verification:** Backend test: `unitOfMeasure.test.js` - list returns seeded values.
- **Validation:** UoM dropdown in part/trace forms shows available units.

---

## 4. Barcode Management

### REQ-BAR-001
- **Description:** The system shall auto-generate unique barcode strings in the format PREFIX-XXXXXX (hex) for each new barcode-tracked entity.
- **Rationale:** Unique machine-readable identifiers for all physical items.
- **Parameters:** Barcode model: barcode (STRING, unique), barcodeCategoryID (FK), parentBarcodeID (INT). Categories: AKL (parts/traces), LOC (locations), BOX (boxes), EQP (equipment). Barcode generation via PostgreSQL sequence in `beforeValidate` hook.
- **Parent Req:** REQ-INV-001
- **Derived Reqs:** REQ-BAR-002, REQ-BAR-003, REQ-BAR-004, REQ-BAR-005, REQ-BAR-006
- **Verification:** Backend tests: `barcode.test.js` - list barcodes, categories, location barcodes, lookup by string.
- **Validation:** Each new location/box/trace/equipment receives a unique barcode string.

### REQ-BAR-002
- **Description:** The system shall support barcode lookup by barcode string.
- **Rationale:** Scanning a barcode needs to resolve to the associated item.
- **Parameters:** `GET /api/inventory/barcode/lookup/:barcode` returns barcode with category. Returns 404 for nonexistent barcode.
- **Parent Req:** REQ-BAR-001
- **Derived Reqs:** None
- **Verification:** Backend test: lookup returns barcode data, 404 for nonexistent.
- **Validation:** Scanning or entering a barcode string retrieves the correct item.

### REQ-BAR-003
- **Description:** The system shall support moving barcodes between parent locations.
- **Rationale:** Items are physically moved between locations in the warehouse.
- **Parameters:** `POST /api/inventory/barcode/move/:id` with `{ newLocationID }`. Validates barcode exists, prevents self-move. Updates `parentBarcodeID`. Records MOVED action in barcode history with from/to IDs.
- **Parent Req:** REQ-BAR-001
- **Derived Reqs:** None
- **Verification:** Backend test: move barcode (PostgreSQL-specific raw SQL). Frontend test: `barcode-movement-dialog.spec.ts` lines 44–122 (move action: canSubmit requires destination, executeMove API call, self-move prevention, close on success, error handling for lookup 404 and move failure).
- **Validation:** User can move an item to a different location and see it in the new location's tree.

### REQ-BAR-004
- **Description:** The system shall maintain a complete history of barcode actions.
- **Rationale:** Audit trail for inventory movement, receipt, split, merge, and deletion.
- **Parameters:** BarcodeHistory model: barcodeID, userID, actionID (FK to action type), fromID, toID, serialNumber, lotNumber, qty, unitOfMeasureID. Action types: CREATED, MOVED, RECEIVED, SPLIT, MERGED, DELETED. `GET /api/inventory/barcodehistory`, `GET /actiontypes`, `GET /barcode/:barcodeId`.
- **Parent Req:** REQ-BAR-001
- **Derived Reqs:** None
- **Verification:** Backend tests: `barcodeHistory.test.js` - list all, action types, by barcode. Frontend test: `barcode-history.spec.ts` lines 84–365 (route param loading, barcode map building, column switching for trace/non-trace, date sorting, search by action/user/barcode, action labels and icons, barcode string resolution, action dialog handlers).
- **Validation:** User can view the full movement/action history timeline for any barcode.

### REQ-BAR-005
- **Description:** The system shall generate ZPL label code for barcode printing in 3x1 and 1.5x1 inch label sizes.
- **Rationale:** Physical barcode labels needed for warehouse items. Multiple label sizes for different use cases.
- **Parameters:** `GET /api/inventory/barcode/display/:id?labelSize=3x1` returns ZPL string. Includes QR code, company branding, item name, description, and quantity (for traces). Two label sizes: 3"x1" (default) and 1.5"x1". Frontend previews via Labelary API rendering.
- **Parent Req:** REQ-BAR-001
- **Derived Reqs:** None
- **Verification:** Endpoint returns valid ZPL string for each barcode type (LOC, BOX, AKL, EQP). Frontend test: `barcode-dialog.spec.ts` lines 54–239 (initialization with barcode data, ZPL fetch, image rendering, preview size change re-fetch, print options toggle, label size toggle, print error handling, move and history navigation).
- **Validation:** User can preview barcode labels in the dialog and they render correctly at both sizes.

### REQ-BAR-006
- **Description:** The system shall support printing barcodes to Zebra label printers via direct TCP or WebSocket print agent.
- **Rationale:** Automated label printing reduces manual label creation.
- **Parameters:** `POST /api/inventory/barcode/print/:id` with `{ labelSize, printerIP }`. Printer selection: 3x1 → 10.50.20.91, 1.5x1 → 10.50.20.92, or custom IP. Prefers WebSocket print agent if connected, falls back to direct TCP on port 9100. Print agent authenticates with `PRINT_AGENT_API_KEY`.
- **Parent Req:** REQ-BAR-001
- **Derived Reqs:** REQ-BAR-006A
- **Verification:** Print endpoint generates ZPL and sends to printer via TCP or WebSocket.
- **Validation:** User clicks "Print" in barcode dialog and physical label prints on Zebra printer.

### REQ-BAR-006A
- **Description:** The system shall support a WebSocket-based print agent for remote printing.
- **Rationale:** Enables printing when the server is not on the same network as the printer.
- **Parameters:** WebSocket endpoint at `/ws/print-agent`. Agent authenticates with API key (10s timeout). Heartbeat every 60s (stale threshold: 2 min). Print jobs have 30s timeout. Agent reports job results (success/failure).
- **Parent Req:** REQ-BAR-006
- **Derived Reqs:** None
- **Verification:** Print agent connects, authenticates, receives print jobs, reports results.
- **Validation:** Labels print successfully via the print agent from a remote network.

### REQ-BAR-007
- **Description:** The system shall provide a barcode tag system that resolves barcodes to their associated items with type information.
- **Rationale:** Enables displaying human-readable information for any scanned barcode.
- **Parameters:** `GET /api/inventory/barcode/tag/:id` returns `{ id, barcodeID, barcode, type, name, description }`. `GET /api/inventory/barcode/tag/chain/:id` returns chain of parent tags up to root. `GET /api/inventory/barcode/tag/` returns all tags across types.
- **Parent Req:** REQ-BAR-001
- **Derived Reqs:** None
- **Verification:** Tag endpoint resolves barcode to item with correct type. Frontend test: `barcode-tag.spec.ts` (input binding, output emissions, dialog interaction).
- **Validation:** Scanning a barcode displays the item name, type, and location chain.

---

## 5. Parts Management

### REQ-PRT-001
- **Description:** The system shall support CRUD operations for parts with categories, vendor information, and manufacturer details.
- **Rationale:** Parts catalog is the foundation of inventory — every trace and order item references a part.
- **Parameters:** Part model: name (STRING 32, unique, not null), description (STRING 62), internalPart (BOOLEAN, not null), vendor (STRING, not null), sku, link, minimumOrderQuantity (INT, not null), partCategoryID (FK, not null), serialNumberRequired, lotNumberRequired, defaultUnitOfMeasureID, manufacturer, manufacturerPN, imageFileID (FK).
- **Parent Req:** REQ-SYS-001
- **Derived Reqs:** REQ-PRT-002, REQ-PRT-003, REQ-PRT-004, REQ-PRT-005
- **Verification:** Backend tests: `part.test.js` - list, categories, get by ID, create, update, delete. Frontend test: `parts-table-view.spec.ts` lines 80–361 (data loading, category/type/search/inactive filtering, computed properties, pagination, sorting, navigation, color utilities, middle-click), `part-edit-page.spec.ts` (form validation, category detection, pin group management, image management), `part-edit-dialog.spec.ts` (create/edit modes, validation, image management).
- **Validation:** User can browse, create, edit, and delete parts with all fields.

### REQ-PRT-002
- **Description:** The system shall require manufacturer and manufacturer part number for vendor (non-internal) parts.
- **Rationale:** Vendor parts must be traceable to their manufacturer for procurement and quality purposes.
- **Parameters:** Controller validates `!internalPart → manufacturer && manufacturerPN required`. Returns 400 if missing.
- **Parent Req:** REQ-PRT-001
- **Derived Reqs:** None
- **Verification:** Backend test: create part with internalPart=false requires manufacturer fields.
- **Validation:** Creating a vendor part without manufacturer info shows validation error.

### REQ-PRT-003
- **Description:** The system shall support part categories with color-coded tags.
- **Rationale:** Categorization helps organize and filter the parts catalog.
- **Parameters:** PartCategory model: name (STRING, unique), tagColorHex (STRING 7, default #808080). Seeded categories include at least General and one other. `GET /api/inventory/part/categories` returns all categories.
- **Parent Req:** REQ-PRT-001
- **Derived Reqs:** None
- **Verification:** Backend test: categories endpoint returns seeded values.
- **Validation:** Parts table shows colored category chips. Category filter dropdown works.

### REQ-PRT-004
- **Description:** The system shall support part image uploads and hover preview in the parts table.
- **Rationale:** Visual identification of parts speeds up inventory operations.
- **Parameters:** Part has `imageFileID` FK to UploadedFile. Frontend parts table shows image icon column. Hover shows fixed-position tooltip with image preview.
- **Parent Req:** REQ-PRT-001
- **Derived Reqs:** None
- **Verification:** Part with imageFileID returns image data in API response.
- **Validation:** User can upload an image to a part and see it in the hover preview on the parts table.

### REQ-PRT-005
- **Description:** The system shall validate part request bodies against the model schema using body validator middleware.
- **Rationale:** Prevents invalid data from reaching the database.
- **Parameters:** `bodyValidator.part` middleware on POST and PUT routes. Validates type (INTEGER, STRING, BOOLEAN) and presence of non-nullable fields. Ignores id, activeFlag, createdAt, updatedAt.
- **Parent Req:** REQ-PRT-001
- **Derived Reqs:** None
- **Verification:** Backend test: create/update with valid data succeeds, invalid data returns 400.
- **Validation:** Submitting a part form with invalid data shows appropriate error messages.

### REQ-PRT-006
- **Description:** The parts table shall support search, filtering, sorting, pagination, and URL query parameter persistence.
- **Rationale:** Large parts catalogs need efficient navigation. URL persistence enables shareable/bookmarkable views.
- **Parameters:** Search across name/description/vendor/SKU. Filter by category (multi-select), type (internal/vendor). Toggle show inactive. Sortable columns including createdAt. URL syncs: search, inactive, sort, dir, page, pageSize.
- **Parent Req:** REQ-PRT-001
- **Derived Reqs:** None
- **Verification:** Frontend test: `parts-table-view.spec.ts` lines 101–178 (search across name/vendor/category, category multi-select filter, internal/vendor type filter, inactive toggle), lines 290–321 (pagination, sorting, getTotalCount with filters).
- **Validation:** User can search, filter by category, sort by column, paginate, and share the URL.

### REQ-PRT-007
- **Description:** The part edit page shall remain on the current part after saving (not navigate away).
- **Rationale:** Users often make iterative edits and navigating away breaks the workflow.
- **Parameters:** Update success handler calls `loadPart(partId)` and exits edit mode. Creating a new part still navigates to `/parts`.
- **Parent Req:** REQ-PRT-001
- **Derived Reqs:** None
- **Verification:** After PUT request, page remains on the same part ID.
- **Validation:** User edits a part, clicks save, and remains on the same part page.

---

## 6. Order Management

### REQ-ORD-001
- **Description:** The system shall support CRUD operations for purchase orders with status workflow, line items, and vendor tracking.
- **Rationale:** Procurement workflow from order placement through receiving.
- **Parameters:** Order model: description (TEXT), vendor (STRING), trackingNumber, link, notes (TEXT), placedDate (DATE), receivedDate (DATE), orderStatusID (FK, default: 1). Status progression via `nextStatusID` self-reference on OrderStatus.
- **Parent Req:** REQ-SYS-001
- **Derived Reqs:** REQ-ORD-002, REQ-ORD-003, REQ-ORD-004, REQ-ORD-005, REQ-ORD-006, REQ-ORD-007
- **Verification:** Backend tests: `order.test.js` - list, statuses, line types, get by ID, create, update, delete. Frontend test: `orders-list-view.spec.ts` lines 77–315 (status loading, status toggle filtering, search, pagination, sorting, status chip classes, contrast color, item count/total price calculation, middle-click), `order-view.spec.ts` lines 78–392 (status navigation, receive mode, line item editing, pricing, date formatting, line type checks).
- **Validation:** User can create orders, track status, and manage the full procurement lifecycle.

### REQ-ORD-002
- **Description:** The system shall maintain order statuses with workflow progression.
- **Rationale:** Orders progress through defined stages: Draft → Pending → Placed → Shipped → Received.
- **Parameters:** OrderStatus model: name (STRING, unique), tagColor (STRING 7), nextStatusID (FK self-reference). Seeded with at least 4 statuses. `GET /api/inventory/order/statuses` returns all.
- **Parent Req:** REQ-ORD-001
- **Derived Reqs:** None
- **Verification:** Backend test: statuses endpoint returns >= 4 statuses with Draft first.
- **Validation:** Order status chips display with correct colors. Status progression follows defined workflow.

### REQ-ORD-003
- **Description:** The system shall support order line items with quantity, price, and part linkage.
- **Rationale:** Orders contain multiple items, each referencing a part with pricing.
- **Parameters:** OrderItem model: orderID (FK, not null), partID (FK), orderLineTypeID (FK, default: 1), lineNumber (INT, default: 1), quantity (INT, default: 1), price (DECIMAL 10,5, default: 0), receivedQuantity (INT, default: 0). Body validator with POST/PUT distinction (PUT allows partial updates).
- **Parent Req:** REQ-ORD-001
- **Derived Reqs:** None
- **Verification:** Backend tests: `orderItem.test.js` - list by order, create, update, delete.
- **Validation:** User can add, edit, and remove line items from an order.

### REQ-ORD-004
- **Description:** The system shall auto-recalculate order status based on received quantities of line items.
- **Rationale:** Order status should reflect actual receiving progress.
- **Parameters:** `recalculateOrderStatus()` called on orderItem update. Checks if all items fully received → advance to next status.
- **Parent Req:** REQ-ORD-001
- **Derived Reqs:** None
- **Verification:** After updating receivedQuantity to match quantity for all items, order status advances.
- **Validation:** Receiving all items on an order automatically updates the order status.

### REQ-ORD-005
- **Description:** The system shall support bulk CSV import of orders with dry-run preview.
- **Rationale:** Large orders from vendors can be imported from spreadsheet exports rather than manual entry.
- **Parameters:** `POST /api/inventory/order/bulk-import` with `{ csvContent, vendor }`. `?dryRun=true` returns preview without creating records. CSV columns: name, vendor, qty, price. Matches existing parts by name. Creates new parts for unmatched names. Returns: partsToCreate, partsExisting, partsSkipped, orderItems, orderTotal.
- **Parent Req:** REQ-ORD-001
- **Derived Reqs:** None
- **Verification:** Backend tests: `order.test.js` - dry run preview, execute import, recognizes existing parts, 400 with no content. Frontend test: `bulk-upload.spec.ts` lines 43–290 (computed totals, dry-run preview, inline row editing with save/cancel, quantity/price parsing, remove item, status labels, price/total formatting, category helpers).
- **Validation:** User uploads CSV, sees preview with existing/new parts, confirms to create order.

### REQ-ORD-006
- **Description:** The system shall support receiving order items into inventory with barcode and location assignment.
- **Rationale:** Incoming parts need to be added to inventory with physical location tracking.
- **Parameters:** Frontend `ReceiveLineItemDialog` enables scanning barcode, selecting location, entering quantity. Creates Trace (for parts) or Equipment (for equipment items) with RECEIVED barcode history action.
- **Parent Req:** REQ-ORD-001
- **Derived Reqs:** None
- **Verification:** After receiving, Trace/Equipment record exists with correct barcode and parent location. Frontend test: `receive-line-item-dialog.spec.ts` lines 62–235 (part receiving: full/partial receipt type, receivedQuantity computation, canSubmit validation for location/quantity, submit result structure; equipment receiving: pre-fill name, quantity 1, serial number, canSubmit requires name; barcode size options).
- **Validation:** User clicks "Receive" on an order item, assigns location, and item appears in inventory tree.

### REQ-ORD-007
- **Description:** The orders list view shall support search, status filtering, sorting, pagination, and URL query parameter persistence.
- **Rationale:** Efficient navigation and shareable views for order management.
- **Parameters:** Search across order fields. Filter by status (multi-select). Default sort: placedDate descending. URL syncs: search, inactive, statuses (comma-separated IDs), sort, dir, page, pageSize.
- **Parent Req:** REQ-ORD-001
- **Derived Reqs:** None
- **Verification:** Frontend test: `orders-list-view.spec.ts` lines 94–167 (status selection/deselection, allStatusesSelected, someStatusesSelected, hiddenStatusCount, search with page reset, status filter with empty result), lines 177–241 (pagination, sorting, getTotalCount with filters).
- **Validation:** User can filter orders by status, search, and share the URL with filters applied.

---

## 7. Wire Harness Design

### REQ-HAR-001
- **Description:** The system shall provide a canvas-based wire harness schematic editor for designing cable assemblies.
- **Rationale:** Wire harness design requires visual placement of connectors, cables, and wiring between pins.
- **Parameters:** HTML5 Canvas 2D rendering. Elements: Connectors, Cables, Components, Sub-harnesses. Connections: Wire type (between pins) and Mating type (connector-to-connector). Data stored as JSONB `harnessData` field on WireHarness model.
- **Parent Req:** REQ-SYS-001
- **Derived Reqs:** REQ-HAR-002 through REQ-HAR-015
- **Verification:** Backend tests: `harness.test.js` - list, get by ID, create, update, delete, next part number. Frontend test: `harness-canvas.spec.ts` lines 80–362 (inputs, outputs, zoom, addConnector/addCable/addComponent, deleteSelected guards, group/ungroup guards, export guards), `harness-page.spec.ts` lines 83–635 (initial state, computed properties, createNewHarness, tool/selection/data changes, connector/connection/pin property changes, copy/paste, undo/redo, layer ordering, element moves, export JSON, loadHarness).
- **Validation:** User can open the harness editor, place elements, draw wires, and save the design.

### REQ-HAR-002
- **Description:** The harness editor shall support adding, positioning, rotating, and flipping connectors.
- **Rationale:** Connectors are the primary elements in a harness design and need flexible placement.
- **Parameters:** ElectricalConnector model: label (STRING 50), type (ENUM: male/female/terminal/splice), pinCount (INT), pins (JSONB array), partID (FK). Canvas rendering with wire points (circles) and mating points (squares) on opposite sides. Rotation in 90° increments. Horizontal/vertical flip.
- **Parent Req:** REQ-HAR-001
- **Derived Reqs:** None
- **Verification:** Backend tests: `connector.test.js` - list, pin types, get by ID/part, create, update, delete. Frontend test: `harness-connector-dialog.spec.ts` lines 38–330 (create mode: form defaults, displayPart, type labels, color hex/name, isValid, clearSelectedPart, save; edit mode: form population, preserved properties; locked mode; onPartSelected with linked/unlinked parts; duplicate label detection), `harness-canvas.spec.ts` lines 198–224 (addConnector to harnessData).
- **Validation:** User can add a connector, rotate it, and see pins rendered with correct positions.

### REQ-HAR-003
- **Description:** The harness editor shall support adding and editing multi-wire cables.
- **Rationale:** Cables bundle multiple wires and need visual representation.
- **Parameters:** Cable model: label (STRING 50), wireCount (INT), gaugeAWG, wires (JSONB array of {id, color, colorCode}), partID (FK). Canvas renders cable as bundle with individual wire endpoints.
- **Parent Req:** REQ-HAR-001
- **Derived Reqs:** None
- **Verification:** Backend tests: `cable.test.js` - list, get by ID/part, create, update, delete. Frontend test: `harness-add-cable-dialog.spec.ts` lines 18–310 (create mode: form defaults, displayPart, wireHex, isValid, clearSelectedPart, wire drag reorder, save; edit mode: form population, preserved IDs; duplicate label detection; onPartSelected), `harness-cable-dialog.spec.ts` (deep-cloned cables, addCable/removeCable, addWire/removeWire, quickAdd, save).
- **Validation:** User can add a cable and see individual wire endpoints for connection.

### REQ-HAR-004
- **Description:** The harness editor shall support adding electrical components with pin groups.
- **Rationale:** Components like ICs, resistors need pin representation for wiring.
- **Parameters:** ElectricalComponent model: label (STRING 50), pinCount (INT), pins (JSONB array of pin groups with pins), partID (FK).
- **Parent Req:** REQ-HAR-001
- **Derived Reqs:** None
- **Verification:** Backend tests: `component.test.js` - list, get by ID/part, create, update, delete. Frontend test: `harness-component-dialog.spec.ts` lines 18–315 (create mode: form defaults, displayPart, totalPinCount, toggleGroupHidden/togglePinHidden, isValid, clearSelectedPart, save; edit mode: form population, preserved position/rotation; duplicate label detection; onPartSelected).
- **Validation:** User can add a component and wire to its pins.

### REQ-HAR-005
- **Description:** The harness editor shall support drawing wire connections between element pins with orthogonal routing.
- **Rationale:** Wires must visually connect pins with clean right-angle paths.
- **Parameters:** Wire drawing mode activated by tool selection. Click start pin, click end pin to create connection. Orthogonal path calculation with lead-out direction based on element center. Obstacle avoidance. Waypoints for manual path adjustment via node edit mode. Wire properties: color, gauge, length, termination types (from WireEnd reference data).
- **Parent Req:** REQ-HAR-001
- **Derived Reqs:** None
- **Verification:** Connection data stored in harnessData.connections JSONB array. Frontend test: `harness-property-panel.spec.ts` lines 287–317 (updateConnection emission, updateConnectionInput for string/integer fields, lengthMm parsing), lines 428–477 (getEndpointDescription for connector/cable/component endpoints, getEndpointType).
- **Validation:** User can draw a wire from connector pin A to connector pin B and see an orthogonal path.

### REQ-HAR-006
- **Description:** The harness editor shall support connector mating connections (direct connector-to-connector).
- **Rationale:** Mating connectors connect directly without individual wire routing.
- **Parameters:** Each connector pin has wire point (circle) and mating point (square on opposite side). Mating connections: `connectionType: 'mating'`. Backend validates mating connections are between two connectors only.
- **Parent Req:** REQ-HAR-001
- **Derived Reqs:** None
- **Verification:** Backend validation rejects mating connections to non-connector elements.
- **Validation:** User can create a mating connection between two connectors via mating points.

### REQ-HAR-007
- **Description:** The harness editor shall support wire termination types from the WireEnd database.
- **Rationale:** Wire ends have specific termination types (pin, spade, ring, ferrule, etc.) that must be specified.
- **Parameters:** WireEnd model: code (STRING 20, unique), name (STRING 50), description (TEXT). Seeded: f-pin, m-pin, f-spade, m-spade, ring, fork, ferrule, soldered, bare. `GET /api/parts/wire-end`, `GET /by-code/:code`. Connection has from/to termination references.
- **Parent Req:** REQ-HAR-001
- **Derived Reqs:** None
- **Verification:** Backend tests: `wireEnd.test.js` - list, by code, by ID, create, update, delete. Frontend test: `harness-property-panel.spec.ts` lines 113–120 (loadWireEnds from service on init), lines 601–653 (getCurrentEndpointTermination from/to, updateEndpointTermination emission).
- **Validation:** Property panel shows termination type dropdowns populated from the database.

### REQ-HAR-008
- **Description:** The harness editor shall support sub-harness references (nested assemblies).
- **Rationale:** Complex harnesses reuse sub-assemblies and need hierarchical composition.
- **Parameters:** SubHarnessRef stored in `harnessData.subHarnesses` JSONB. `GET /api/parts/harness/sub-harness-data?ids=1,2,3` batch fetch. `GET /:id/parents` finds parent harnesses. Canvas renders collapsed/expanded views. Backend validates: cycle detection (`wouldCreateCycle`), reference validation, delete protection (cannot delete harness used as sub-harness).
- **Parent Req:** REQ-HAR-001
- **Derived Reqs:** None
- **Verification:** Backend tests: sub-harness data fetch, parent harnesses, cycle detection in validation.
- **Validation:** User can add a sub-harness and see it rendered on the canvas with expandable view.

### REQ-HAR-009
- **Description:** The harness editor shall support undo/redo with maximum 50 history entries.
- **Rationale:** Design operations need to be reversible for efficient editing.
- **Parameters:** HarnessHistoryService with past/future stacks. `push(state)` for instant operations. `beginTransaction()/commitTransaction()` for drag operations. Keyboard: Ctrl+Z (undo), Ctrl+Y/Ctrl+Shift+Z (redo). Toolbar buttons disabled when stack empty.
- **Parent Req:** REQ-HAR-001
- **Derived Reqs:** None
- **Verification:** Service unit test: push/undo/redo maintain correct stack state. Frontend test: `harness-page.spec.ts` lines 433–470 (onUndo restores previous state, nothing-to-undo guard, onRedo restores next state), lines 146–155 (canUndo/canRedo computed from history service), lines 417–432 (drag start begins transaction, drag end commits transaction).
- **Validation:** User makes changes, presses Ctrl+Z to undo, Ctrl+Y to redo.

### REQ-HAR-010
- **Description:** The harness editor shall auto-save changes with a 1.5-second debounce.
- **Rationale:** Prevents data loss from unsaved work while avoiding excessive API calls.
- **Parameters:** Auto-save triggers on any data change after 1.5s idle. Calls `updateHarness()` API.
- **Parent Req:** REQ-HAR-001
- **Derived Reqs:** None
- **Verification:** After data change, API call fires within debounce window.
- **Validation:** User makes a change, waits, navigates away, returns — changes are persisted.

### REQ-HAR-011
- **Description:** The harness editor shall support element grouping and ungrouping via context menu.
- **Rationale:** Groups allow moving related elements together.
- **Parameters:** Context menu: "Group Selected" (multiple items selected), "Ungroup" (grouped item selected). ElementGroup stored in harnessData.groups with relative offsets.
- **Parent Req:** REQ-HAR-001
- **Derived Reqs:** None
- **Verification:** Grouping stores group data in harnessData. Ungrouping removes it.
- **Validation:** User selects multiple elements, right-clicks, groups them, then moves them together.

### REQ-HAR-012
- **Description:** The harness editor canvas shall support pan, zoom, grid display, and snap-to-grid.
- **Rationale:** Navigation and alignment tools for schematic editing.
- **Parameters:** Tools: Pan (drag canvas), Zoom (scroll wheel). Grid toggle. Snap-to-grid toggle. Canvas renders grid lines when enabled.
- **Parent Req:** REQ-HAR-001
- **Derived Reqs:** None
- **Verification:** Canvas renders grid lines when enabled. Element positions snap to grid increments. Frontend test: `harness-canvas.spec.ts` lines 138–174 (default zoom, zoomIn/zoomOut, resetZoom, max/min zoom caps), lines 84–108 (default grid enabled, grid size, tool inputs).
- **Validation:** User can pan/zoom the canvas, toggle grid, and elements snap to grid positions.

### REQ-HAR-013
- **Description:** The harness system shall enforce a release workflow: Draft → Review → Released.
- **Rationale:** Engineering change control requires formal review before designs are frozen.
- **Parameters:** WireHarness.releaseState: 'draft' | 'review' | 'released'. Endpoints: `POST /:id/submit-review` (draft→review, cascades to sub-harnesses), `POST /:id/reject` (review→draft, with notes), `POST /:id/release` (review→released). Released harnesses record releasedAt and releasedBy. HarnessRevisionHistory tracks all state changes with changeType and optional snapshotData.
- **Parent Req:** REQ-HAR-001
- **Derived Reqs:** REQ-HAR-014, REQ-HAR-015
- **Verification:** Backend tests: `harness.test.js` - submit for review, reject, release, history, revisions.
- **Validation:** User clicks "Release" button, harness transitions through review states, released harness locks editing.

### REQ-HAR-014
- **Description:** Released harnesses shall be read-only with all editing tools disabled.
- **Rationale:** Released designs are frozen for manufacturing use and must not be modified.
- **Parameters:** `isReleased` signal disables: wire tool, node edit, add elements, rotate, flip, delete, undo/redo, import. Keeps enabled: select, pan, zoom, export, grid toggle. Canvas prevents dragging. Property panel disables all form fields. Selection still works for viewing properties.
- **Parent Req:** REQ-HAR-013
- **Derived Reqs:** None
- **Verification:** All editing operations are no-ops when isReleased=true. Frontend test: `harness-page.spec.ts` lines 157–188 (isReleased computed true for released, isInReview for review, isLocked for released/review, isLocked false for draft), `harness-canvas.spec.ts` lines 101–105 (isLocked input), `harness-property-panel.spec.ts` lines 130–134 (isReleased/isLocked inputs), `harness-toolbar.spec.ts` lines 29–76 (isReleased input binding).
- **Validation:** User cannot modify a released harness. All edit controls appear disabled.

### REQ-HAR-015
- **Description:** The system shall create a new revision when editing a released harness.
- **Rationale:** Design updates to released harnesses must be tracked as new revisions.
- **Parameters:** Revisions increment alphabetically: A → B → C → ... → Z → AA → AB. "New Revision" button appears when harness is released. `updateHarness()` on a released harness auto-creates new revision with incremented letter, previousRevisionID link. `GET /:id/revisions` returns all revisions in family. `POST /:id/revert/:historyId` restores from snapshot.
- **Parent Req:** REQ-HAR-013
- **Derived Reqs:** None
- **Verification:** Backend tests: revision history, all revisions, revert to snapshot.
- **Validation:** User clicks "New Revision", new harness created as Rev B (or next letter), linked to previous.

### REQ-HAR-016
- **Description:** The harness list view shall display release status with color-coded chips and support search, sorting, and pagination.
- **Rationale:** Users need to see design status at a glance and efficiently navigate harness designs.
- **Parameters:** Columns include releaseState with status chips: draft (gray #424242), review (orange #f57c00), released (green #388e3c). Search, sort, pagination. Default sort: updatedAt descending. URL query param persistence.
- **Parent Req:** REQ-HAR-001
- **Derived Reqs:** None
- **Verification:** Frontend test: `harness-list-view.spec.ts` lines 52–205 (initial data loading, inactive filtering, search by name/partNumber/description, sorting by name/updatedAt, pagination, getTotalCount with filters, formatDate, middle-click new tab, error handling, displayedColumns including releaseState).
- **Validation:** User sees harness list with color-coded status and can filter/sort.

### REQ-HAR-017
- **Description:** The harness editor shall support import/export of harness designs as JSON.
- **Rationale:** Enables backup, sharing, and migration of harness designs.
- **Parameters:** Export: serializes harnessData to JSON file. Import: loads JSON via HarnessImportDialog, replaces current canvas data.
- **Parent Req:** REQ-HAR-001
- **Derived Reqs:** None
- **Verification:** Exported JSON can be re-imported to produce identical canvas. Frontend test: `harness-import-dialog.spec.ts` lines 39–254 (initial state, drag events, clearFile, JSON paste, validation for invalid syntax/missing name/non-array fields, backend validation success/failure/fallback, useSample, import with/without parsed data, non-JSON file rejection), `harness-page.spec.ts` lines 573–593 (onExportJSON null guard, download link creation).
- **Validation:** User exports a harness, imports it into a new harness, and sees identical design.

### REQ-HAR-018
- **Description:** The harness backend shall validate harness data for structural integrity.
- **Rationale:** Prevents invalid designs from being saved.
- **Parameters:** `POST /api/parts/harness/validate` checks: sub-harness cycle detection, reference validation (all referenced IDs exist), mating connections between connectors only.
- **Parent Req:** REQ-HAR-001
- **Derived Reqs:** None
- **Verification:** Backend test: validate endpoint with valid/invalid data.
- **Validation:** Saving a harness with circular sub-harness references shows validation error.

### REQ-HAR-019
- **Description:** The system shall strip base64-encoded image data from harness JSON before saving to the database and re-fetch images from the parts database on load.
- **Rationale:** Inline base64 images bloat the harnessData JSONB column. Images are already stored in the parts database (UploadedFile table) and can be re-fetched on demand.
- **Parameters:** Fields stripped before save: `connectorImage`, `pinoutDiagramImage` (connectors), `cableDiagramImage` (cables), `componentImage`, `pinoutDiagramImage` (components). On load, `syncPartsFromDatabase()` fetches images via `getConnectorByPartId`, `getCableByPartId`, `getComponentByPartId` endpoints. Image show/hide toggle flags (`showPinoutDiagram`, `showConnectorImage`, etc.) are preserved in JSON. Stripping also applies to JSON export.
- **Parent Req:** REQ-HAR-001
- **Derived Reqs:** REQ-HAR-020
- **Verification:** Backend test: saved harnessData does not contain base64 image strings. E2E test: export JSON contains no image data fields. Frontend: images display correctly after save and reload.
- **Validation:** User saves a harness with connector images, reloads the page, and images are still visible.

### REQ-HAR-020
- **Description:** The system shall synchronize harness element properties from the parts database on load, detecting structural changes and silently refreshing images.
- **Rationale:** Parts may be updated independently of harness designs. The sync ensures harness elements reflect current part definitions.
- **Parameters:** On harness load, for each connector/cable/component with a `partId`, the system fetches the current part record. Structural changes (type, pinCount, color, pins, gaugeAWG, wireCount, wires, pinGroups) are presented to the user in a sync dialog for acceptance/rejection. Image data is always refreshed silently. The `by-part` backend endpoints include nested `Part.imageFile` association for fallback image resolution.
- **Parent Req:** REQ-HAR-019
- **Derived Reqs:** None
- **Verification:** Backend test: `getConnectorByPartId`, `getCableByPartId`, `getComponentByPartId` include `Part.imageFile` in response. Frontend test: `harness-sync-dialog.spec.ts` lines 69–145 (receive changes from data, getTypeIcon for connector/cable/component/unknown, acceptSelected closes with current state and preserves accepted flags, keepAll sets all to not accepted, empty changes handling).
- **Validation:** User updates a connector's pin count in the parts library, opens a harness using that connector, and sees a sync prompt with the change.

### REQ-HAR-021
- **Description:** The harness editor shall display images and pinout diagrams for elements within sub-harnesses, with interactive expand/collapse buttons.
- **Rationale:** Sub-harness child elements (connectors, cables, components) should display their part images just like main harness elements.
- **Parameters:** After sub-harness data loads, images are fetched from the parts database for all child elements with a `partId`. The [+]/[-] expand buttons on sub-harness child elements are clickable to toggle image visibility. Button hit testing transforms world coordinates to sub-harness local space, then to child element local space. Toggled state is kept in the sub-harness data cache (not persisted to the parent harness).
- **Parent Req:** REQ-HAR-008
- **Derived Reqs:** None
- **Verification:** E2E test: sub-harness elements with linked parts display images after load. Canvas renders expand buttons on sub-harness children.
- **Validation:** User opens a harness containing a sub-harness with imaged connectors; images appear and [+] buttons toggle them.

---

## 8. Planning & Task Management

### REQ-PLN-001
- **Description:** The system shall provide a Kanban-style task board with drag-and-drop between columns.
- **Rationale:** Visual task management with column-based workflow (e.g., Backlog → In Progress → Done).
- **Parameters:** TaskList model: name (STRING 20), order (INT). Task model: name (STRING 100), description (TEXT), doneFlag, dueDate, timeEstimate, taskTypeEnum (normal/tracking/critical_path/scheduled), rank (DOUBLE for ordering), parentTaskID (self-reference for subtasks). CDK DragDrop for cross-list movement.
- **Parent Req:** REQ-SYS-001
- **Derived Reqs:** REQ-PLN-002 through REQ-PLN-012
- **Verification:** Backend tests: `task.test.js`, `taskList.test.js` - full CRUD and move operations. Frontend test: `task-list-view.spec.ts` lines 40–222 (initial state, toggleHistory, toggleEditMode with refresh, startAddingList/cancelAddingList, confirmAddList, onListRenamed/onListDeleted, filter handlers, saveAsDefault/revertToDefault, URL param parsing), `task-list.spec.ts` lines 37–181 (filtered tasks excluding done, project/noProject/childTask filtering, add/cancel task, confirmAddTask, title editing, confirmDelete, dragDelay).
- **Validation:** User sees columns with task cards, can drag cards between columns.

### REQ-PLN-002
- **Description:** The system shall support task CRUD operations with project assignment, type, priority, due date, and time estimate.
- **Rationale:** Tasks need rich metadata for planning and tracking.
- **Parameters:** `POST /api/planning/task`, `GET /`, `GET /:id`, `PUT /:id`, `DELETE /:id`. Task includes: ownerUserID (from auth), projectID, taskListID, taskTypeEnum, timeEstimate, parentTaskID. Creates CREATED history entry. Auto-completes parent task when `completeWithChildren=true` and all subtasks done.
- **Parent Req:** REQ-PLN-001
- **Derived Reqs:** None
- **Verification:** Backend tests: task types, list, filter, get by ID, create (with history), update, delete. Frontend test: `task-card-dialog.spec.ts` lines 49–378 (checklist computed properties, currentListName/currentProject, filteredAvailableTasks, addChecklistItem/toggleChecklistItem/deleteChecklistItem, title editing/updating, description editing, formatEstimate/formatReminder, isDueToday/isOverdue, moveToList, selectProject, toggleSubtasks/toggleChecklist, addSubtask), `task-card.spec.ts` lines 40–279 (checklistProgress, formatEstimate, displayDone, projectColor, sortedProjects, isDueToday/isOverdue, toggleComplete with optimistic update and error revert).
- **Validation:** User can create, edit, and delete tasks with all fields populated.

### REQ-PLN-003
- **Description:** The system shall support moving tasks between lists with rank-based ordering.
- **Rationale:** Drag-and-drop requires flexible ordering without renumbering all tasks.
- **Parameters:** `PUT /api/planning/task/:taskId/move` with `{ taskListId, targetIndex }`. Rank calculation: between adjacent tasks, or +1000 at end. Records MOVE_LIST history action.
- **Parent Req:** REQ-PLN-001
- **Derived Reqs:** None
- **Verification:** Backend test: move task changes taskListID and rank.
- **Validation:** User drags task from one column to another, it appears in correct position.

### REQ-PLN-004
- **Description:** The system shall support task list CRUD with reordering.
- **Rationale:** Users need to create workflow columns and arrange their order.
- **Parameters:** `POST /api/planning/tasklist` auto-assigns order as (max order + 1). `PUT /reorder` with `{ orderedIds }` array. Lists include nested tasks ordered by rank.
- **Parent Req:** REQ-PLN-001
- **Derived Reqs:** None
- **Verification:** Backend tests: `taskList.test.js` - list, order, create with auto-order, update, reorder, delete.
- **Validation:** User can create new columns, drag to reorder, rename, and delete.

### REQ-PLN-005
- **Description:** The system shall support project management with color-coded tags and keyboard shortcuts.
- **Rationale:** Projects group related tasks and enable quick visual identification and assignment.
- **Parameters:** Project model: name (STRING 100), shortName (STRING 6), tagColorHex (STRING 6, stored without #), keyboardShortcut (STRING 1, unique, digits 1-9, 0 reserved for "no project"), parentProjectID. `GET /top` returns root projects. Colors display as chips on task cards.
- **Parent Req:** REQ-PLN-001
- **Derived Reqs:** REQ-PLN-006
- **Verification:** Backend tests: `project.test.js` - list, top-level, get by ID, create, update, delete. Frontend test: `projects-list-view.spec.ts` lines 47–179 (load projects, inactive filtering, search by name/shortName/description, sorting, pagination, goBack), `project-edit-dialog.spec.ts` lines 54–227 (create mode: form defaults, availableShortcuts excluding used, color change, form validation errors, save with # stripping; edit mode: form population, shortcut availability for current project, update/delete with confirmation).
- **Validation:** User can create projects with colors and keyboard shortcuts, see colored chips on tasks.

### REQ-PLN-006
- **Description:** The task board shall support keyboard shortcut project assignment on hover.
- **Rationale:** Rapid project assignment without opening dialogs speeds up task triage.
- **Parameters:** Hover over task card + press number key 1-9: assigns project with matching `keyboardShortcut`. Press 0: clears project. Toggle behavior: pressing same shortcut again removes project. Requires mouse hover (tracks `isHovered` state).
- **Parent Req:** REQ-PLN-005
- **Derived Reqs:** None
- **Verification:** Frontend test: `task-card.spec.ts` lines 224–279 (ignore key events when not hovered, toggle complete on 'c', clear project on '0', assign project by keyboard shortcut, toggle project off when same shortcut pressed).
- **Validation:** User hovers over task, presses "1", task shows project 1's color chip.

### REQ-PLN-007
- **Description:** The task board shall support filtering by projects, showing/hiding tasks without projects, and showing/hiding subtasks.
- **Rationale:** Users need to focus on specific projects or task subsets.
- **Parameters:** Sub-toolbar with project chips (multi-select), "No Project" filter, subtasks toggle. Filters persist as URL query params. Save as default view (cookie-based via TaskViewPreferencesService).
- **Parent Req:** REQ-PLN-001
- **Derived Reqs:** None
- **Verification:** Frontend test: `sub-toolbar.spec.ts` lines 35–202 (initial state with all projects selected, allProjectsSelected/someProjectsSelected, activeFilterCount, isProjectSelected, toggleProject, toggleAllProjects, toggleNoProject, onShowChildTasksChange, selectedProjects, navigation to /projects and /scheduled-tasks, menuExpanded, initial values from URL), `task-list.spec.ts` lines 41–74 (filter by project IDs, hide no-project tasks, hide subtasks), `task-list-view.spec.ts` lines 156–174 (onProjectFilterChanged, onShowNoProjectChanged, onShowChildTasksChanged), lines 176–201 (onSaveAsDefault, onRevertToDefault).
- **Validation:** User selects projects to filter, saves default view, reloads and sees saved filters applied.

### REQ-PLN-008
- **Description:** The system shall maintain task history for all state changes.
- **Rationale:** Audit trail for task lifecycle events.
- **Parameters:** TaskHistory model: taskID, userID, actionID (FK), fromID, toID. Action types: CREATED, ADD_TO_PROJECT, ADD_PRIORITY, CHANGE_STATUS, MOVE_LIST. `GET /api/planning/taskhistory`, `GET /actiontypes`, `GET /task/:taskId`.
- **Parent Req:** REQ-PLN-001
- **Derived Reqs:** None
- **Verification:** Backend tests: `taskHistory.test.js` - list, action types, by task. Frontend test: `history-drawer.spec.ts` lines 36–117 (isCreatedAction, getActionLabel for MOVE_LIST/ADD_TO_PROJECT/ADD_PRIORITY/CHANGE_STATUS/CREATED/unknown, getLabel for list names/projects/priorities/status, loadMoreHistory guards for loading/noMore, hasMore detection).
- **Validation:** History drawer shows timeline of task movements and changes.

### REQ-PLN-009
- **Description:** The task detail dialog shall support subtasks, calendar date picker with 15-minute rounding, and time estimates.
- **Rationale:** Detailed task management requires sub-task breakdown and scheduling.
- **Parameters:** TaskCardDialogComponent: subtask list, due date with time picker (rounds to nearest 15 minutes on open), time estimate input. Subtasks reference parentTaskID.
- **Parent Req:** REQ-PLN-001
- **Derived Reqs:** None
- **Verification:** Date picker defaults to current time rounded to 15-min interval.
- **Validation:** User opens task dialog, sets due date (pre-rounded time), adds subtasks, sets time estimate.

### REQ-PLN-010
- **Description:** The system shall support scheduled task creation from cron expressions.
- **Rationale:** Recurring tasks (maintenance, reporting) need automated creation on a schedule.
- **Parameters:** ScheduledTask model: name, description, taskListID, projectID, taskTypeEnum, timeEstimate, cronExpression (validated by cron-parser), timezone (default: America/Los_Angeles), dueDateOffsetHours, nextRunAt, lastRunAt. Backend service checks every minute, creates Task when `nextRunAt <= NOW()`, advances nextRunAt (no backfilling). `GET /?includeInactive=true` includes deactivated.
- **Parent Req:** REQ-PLN-001
- **Derived Reqs:** None
- **Verification:** Backend tests: `scheduledTask.test.js` - CRUD operations. `scheduledTaskService.test.js` - creates task, advances nextRunAt, skips inactive/future. Frontend test: `scheduled-tasks-list-view.spec.ts` lines 66–227 (data loading, inactive filtering, search by name/cron/taskList/project, sorting, pagination, cronToEnglish translation for hourly/specific time/minutes/every-minute/day-of-month/month/day-of-week/Sunday/invalid), `scheduled-task-edit-dialog.spec.ts` lines 66–257 (create mode: form defaults, timezone list, cronDescription updates, save with validation; edit mode: form population, update, delete with confirmation; ngOnDestroy unsubscribe).
- **Validation:** User creates a scheduled task with cron "0 9 * * 1" (Mon 9am), task appears in target list on Monday morning.

### REQ-PLN-011
- **Description:** The system shall support task time tracking linked to calendar events.
- **Rationale:** Integrates with Google Calendar Add-on for time tracking.
- **Parameters:** TaskTimeTracking model: taskID, userID, calendarEventID, calendarID. `POST /` creates entry (requires task exists). `GET /task/:taskId` and `GET /user` list entries. `DELETE /:id` with ownership validation. `DELETE /event/:calendarEventId` for calendar cleanup.
- **Parent Req:** REQ-PLN-001
- **Derived Reqs:** None
- **Verification:** Backend tests: `taskTimeTracking.test.js` - create, delete by ID, delete by event ID.
- **Validation:** Add-on creates time tracking entries visible in the application.

### REQ-PLN-012
- **Description:** The task board shall support mobile-responsive layout with snap-scroll columns and long-press drag.
- **Rationale:** Warehouse users need task management on mobile devices.
- **Parameters:** `@media (max-width: 768px)`: columns snap-scroll (`scroll-snap-type: x mandatory`), each column 100vw centered. CDK drag delay: 500ms touch (long-press), 0ms mouse. Auto-scroll during drag (48px edge zone, speed scales with proximity). Sub-toolbar collapsible on mobile. Sidebar auto-collapsed on mobile.
- **Parent Req:** REQ-PLN-001
- **Derived Reqs:** None
- **Verification:** Mobile viewport renders single column with snap-scroll. Long-press initiates drag. Frontend test: `task-list.spec.ts` lines 175–179 (dragDelay: touch 500ms, mouse 0ms).
- **Validation:** On mobile, user swipes between columns, long-presses to drag tasks.

### REQ-PLN-013
- **Description:** Tasks shall support an inline checklist stored as a JSONB column on the Task model.
- **Rationale:** Lightweight checklists enable task decomposition without creating full subtask objects.
- **Parameters:** `ChecklistItem { id: string (UUID), text: string, checked: boolean }`. Stored as `checklist` JSONB column, nullable, default null. Task card shows progress badge (`checked/total`). Task dialog provides add, toggle, delete operations with progress bar.
- **Parent Req:** REQ-PLN-002
- **Derived Reqs:** None
- **Verification:** Backend tests: `task.test.js` checklist describe block. Frontend test: `task-card.spec.ts` lines 44–67 (checklistProgress returns progress string, null for no/empty checklist), `task-card-dialog.spec.ts` lines 53–168 (checklist computed properties, checklistProgress/checklistProgressPercent, addChecklistItem with clear draft and empty guard, toggleChecklistItem, deleteChecklistItem). E2E: `tasks.spec.ts` Task Checklist describe block.
- **Validation:** User opens task dialog, clicks Checklist, adds items, checks/unchecks them, sees progress badge on task card.

---

## 9. File Management

### REQ-FILE-001
- **Description:** The system shall support file upload, storage, and retrieval with base64 encoding.
- **Rationale:** Parts, connectors, and components need associated images and diagrams.
- **Parameters:** UploadedFile model: filename (STRING 255), mimeType (STRING 100), fileSize (INT), data (TEXT, base64), uploadedBy (FK to User). `GET /`, `GET /:id`, `GET /:id/data`, `POST /`, `PUT /:id`, `DELETE /:id` (soft delete).
- **Parent Req:** REQ-SYS-001
- **Derived Reqs:** None
- **Verification:** Backend tests: `files.test.js` - upload, list, get by ID, get data, update, delete.
- **Validation:** User uploads an image to a part, image displays in hover preview and edit page.

---

## 10. Mobile Scanner

### REQ-MOB-001
- **Description:** The system shall provide a mobile camera-based barcode scanner for warehouse operations.
- **Rationale:** Hands-free scanning of physical barcodes for inventory operations in the warehouse.
- **Parameters:** Uses BarcodeDetector API (Chrome). Camera feed displayed full-screen. State machine: scanning → loading → display → action states.
- **Parent Req:** REQ-SYS-001
- **Derived Reqs:** REQ-MOB-002, REQ-MOB-003, REQ-MOB-004, REQ-MOB-005, REQ-MOB-006
- **Verification:** Component renders camera feed and detects barcodes. Frontend test: `mobile-scanner.spec.ts` lines 37–279 (initial state defaults, isTrace computed, locationChain reversal, startMove/startMerge/startSplit/startTrash state transitions, toggleTrashAll, cancelAction/cancelSecondScan/cancelSecondAction, scanAgain/tryAgain reset, goBack, getTypeBadgeClass for all types, BarcodeDetector absence handling, ngOnDestroy).
- **Validation:** User opens scanner on phone, points camera at barcode, item info displays.

### REQ-MOB-002
- **Description:** The mobile scanner shall support the Move action (scan item, scan destination).
- **Rationale:** Moving items between locations is the most common warehouse operation.
- **Parameters:** Two-scan workflow: scan source item barcode → display info → select "Move" → scan destination location barcode → confirm → execute move API call.
- **Parent Req:** REQ-MOB-001
- **Derived Reqs:** None
- **Verification:** After two scans and confirm, moveBarcode API is called with correct IDs. Frontend test: `mobile-scanner.spec.ts` lines 115–131 (startMove sets scanning_second state with move action), `barcode-movement-dialog.spec.ts` lines 44–122 (move action: title/icon, canSubmit requires destination, executeMove call, self-move prevention, close on success, error handling for lookup 404 and move failure).
- **Validation:** User scans a part, scans a shelf location, item moves to that location.

### REQ-MOB-003
- **Description:** The mobile scanner shall support the Merge action (scan target, scan source).
- **Rationale:** Consolidating inventory of the same part into one location/trace.
- **Parameters:** Two-scan workflow: scan target trace → display info → select "Merge" → scan source trace → confirm → execute merge API call. Validates same part.
- **Parent Req:** REQ-MOB-001
- **Derived Reqs:** None
- **Verification:** After merge, target trace has combined quantity, source is deactivated. Frontend test: `mobile-scanner.spec.ts` lines 124–131 (startMerge sets scanning_second state with merge action), `barcode-movement-dialog.spec.ts` lines 123–159 (merge action: title/icon, canSubmit requires mergeBarcode, mergeTrace call, close on success).
- **Validation:** User scans two traces of the same part, merges them, one trace has combined quantity.

### REQ-MOB-004
- **Description:** The mobile scanner shall support the Split action with quantity input.
- **Rationale:** Dividing inventory when moving partial quantities.
- **Parameters:** Single-scan workflow: scan trace → display info → select "Split" → enter split quantity → confirm → execute split API call.
- **Parent Req:** REQ-MOB-001
- **Derived Reqs:** None
- **Verification:** After split, original trace reduced, new trace created with split quantity. Frontend test: `mobile-scanner.spec.ts` lines 133–141 (startSplit sets confirm action and confirming_action state), `barcode-movement-dialog.spec.ts` lines 159–192 (split action: title/icon, canSubmit requires positive quantity, splitTrace call, null quantity guard).
- **Validation:** User scans a trace of 100 items, splits 25, sees two traces (75 and 25).

### REQ-MOB-005
- **Description:** The mobile scanner shall support the Trash action with optional partial quantity.
- **Rationale:** Removing damaged or consumed inventory.
- **Parameters:** Single-scan workflow: scan trace → display info → select "Trash" → optionally enter quantity → confirm → execute delete API call.
- **Parent Req:** REQ-MOB-001
- **Derived Reqs:** None
- **Verification:** After trash, trace quantity reduced or trace deactivated. Frontend test: `mobile-scanner.spec.ts` lines 142–175 (startTrash sets confirm action, toggleTrashAll sets quantity to tag quantity or resets), `barcode-movement-dialog.spec.ts` lines 193–265 (delete action: title/icon for non-trace/trace-full/trace-partial, canSubmit requires confirmation matching barcode or quantity, deleteItem/deleteTrace calls).
- **Validation:** User scans a trace, trashes 5 items, trace quantity decremented by 5.

### REQ-MOB-006
- **Description:** The mobile scanner shall include a back button for navigation.
- **Rationale:** Mobile users need to exit the scanner without using browser navigation.
- **Parameters:** Circular semi-transparent back button (arrow_back icon) in top-left corner. Uses `Location.back()`. z-index: 10, always visible over camera feed.
- **Parent Req:** REQ-MOB-001
- **Derived Reqs:** None
- **Verification:** Button renders and navigates back. Frontend test: `mobile-scanner.spec.ts` lines 226–232 (goBack calls location.back).
- **Validation:** User taps back button and returns to previous page.

---

## 11. Configuration & Printer Management

### REQ-CFG-001
- **Description:** The system shall support printer configuration for label printing.
- **Rationale:** Multiple printers may be available for different label sizes.
- **Parameters:** Printer model: name (STRING, not null), ipAddress (STRING, unique, not null), description, isDefault (BOOLEAN, default: false). `GET /api/config/printers` returns all printers.
- **Parent Req:** REQ-BAR-006
- **Derived Reqs:** None
- **Verification:** Printers endpoint returns configured printers.
- **Validation:** Printer selection available in barcode print dialog.

---

## 12. UI/UX Requirements

### REQ-UX-001
- **Description:** All list views shall support search, sorting, pagination, and URL query parameter persistence.
- **Rationale:** Consistent navigation patterns and shareable/bookmarkable views.
- **Parameters:** Applies to: Parts, Orders, Equipment, Harness, Projects, Scheduled Tasks. URL syncs: search, inactive, sort, dir, page, pageSize (plus view-specific params like statuses).
- **Parent Req:** REQ-SYS-001
- **Derived Reqs:** None
- **Verification:** Each list view syncs state to URL query params on change. Frontend test: `parts-table-view.spec.ts` lines 290–321 (pagination, sorting), `orders-list-view.spec.ts` lines 168–241 (search/page/sort changes), `equipment-table-view.spec.ts` (pagination, sorting), `harness-list-view.spec.ts` lines 107–144 (page reset on search, pagination), `projects-list-view.spec.ts` lines 106–128 (search resets page, pagination, sorting), `scheduled-tasks-list-view.spec.ts` lines 132–148 (search resets page, pagination).
- **Validation:** User applies filters, copies URL, opens in new tab, sees same filtered view.

### REQ-UX-002
- **Description:** The sidebar navigation shall be collapsible and auto-collapse on mobile devices.
- **Rationale:** Maximize content area on small screens while maintaining navigation access.
- **Parameters:** Sidebar checks `window.innerWidth <= 768` on init. Collapsed: `width: 0; min-width: 0; overflow: hidden`. Toggle button always accessible.
- **Parent Req:** REQ-SYS-001
- **Derived Reqs:** None
- **Verification:** Sidebar collapses on mobile viewport. Frontend test: `nav.component.spec.ts` lines 50–65 (toggleSidenav toggles collapsed state and toggles back).
- **Validation:** On mobile, sidebar starts collapsed. User can expand/collapse via toggle.

### REQ-UX-003
- **Description:** The system shall display error notifications using Material snackbar.
- **Rationale:** Consistent error/success feedback across the application.
- **Parameters:** ErrorNotificationService with methods for error, success, warning notifications. Auto-dismiss with configurable duration.
- **Parent Req:** REQ-SYS-001
- **Derived Reqs:** None
- **Verification:** Service displays snackbar with correct type styling.
- **Validation:** User sees snackbar notifications for API errors and successful operations.

### REQ-UX-004
- **Description:** The harness editor shall support keyboard shortcuts for common operations.
- **Rationale:** Power users need fast access to editing tools.
- **Parameters:** V: select tool, H: pan tool, C: copy, V (with Ctrl): paste, Delete: delete selected, Arrow keys: nudge selected, Ctrl+Z: undo, Ctrl+Y/Ctrl+Shift+Z: redo.
- **Parent Req:** REQ-HAR-001
- **Derived Reqs:** None
- **Verification:** Key press activates correct tool or operation. Frontend test: `harness-toolbar.spec.ts` lines 77–108 (setTool emits toolChanged for select/pan/nodeEdit/connector tools), `harness-page.spec.ts` lines 236–254 (onToolChanged/onCanvasToolChangeRequest updates active tool).
- **Validation:** User presses V to switch to select, H to pan, Ctrl+Z to undo.

### REQ-UX-005
- **Description:** The barcode dialog shall support independent preview and print size selection.
- **Rationale:** Users may want to preview at one size but print at another.
- **Parameters:** Separate "Preview Size" and "Print Label Size" dropdowns. Preview updates dynamically on size change (re-fetches ZPL and renders via Labelary API). Print options collapsible: hidden by default, shown on "Print Label" click, two-step confirmation workflow.
- **Parent Req:** REQ-BAR-005
- **Derived Reqs:** None
- **Verification:** Preview re-renders when size changed. Print sends correct size to API. Frontend test: `barcode-dialog.spec.ts` lines 108–181 (default preview/label sizes, onPreviewSizeChange re-fetches ZPL, no-op without barcodeId, togglePrintOptions, onLabelSizeToggle for 3x1/1.5x1), lines 182–239 (printLabel error guard, printBarcode service call, print error handling).
- **Validation:** User selects 1.5x1 preview, sees small label. Selects 3x1 for print, prints large label.

### REQ-UX-006
- **Description:** Table rows in list views shall support middle-click to open items in a new browser tab.
- **Rationale:** Power users need to open multiple items simultaneously for comparison or batch review.
- **Parameters:** `(auxclick)` and `(mousedown)` event handlers on table rows in parts, orders, and harness list views. Middle-click (button === 1) opens the item's edit/detail page in a new tab via `window.open()` with hash routing URL. Default middle-click scroll behavior prevented via mousedown handler.
- **Parent Req:** REQ-UX-001
- **Derived Reqs:** None
- **Verification:** E2E test: middle-click dispatched on table row triggers `window.open`. Mousedown handler prevents default for button 1. Frontend test: `parts-table-view.spec.ts` lines 348–361 (onRowMouseDown prevents default for middle click, onRowAuxClick opens new tab), `orders-list-view.spec.ts` lines 302–315 (middle-click prevent default, open new tab), `harness-list-view.spec.ts` lines 169–195 (onRowMouseDown prevents default for middle click, onRowAuxClick opens in new tab).
- **Validation:** User middle-clicks a part row, new tab opens with the part edit page.

---

## 13. Push Notifications

### REQ-NOTIF-001
- **Description:** The system shall support web push notifications via the Web Push API with VAPID authentication.
- **Rationale:** Users need real-time alerts for task due dates and scheduled task creation without keeping the app open.
- **Parameters:** VAPID keys configured per environment (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL` in .env). Backend uses `web-push` library. Service worker (`sw.js`) handles push events and notification click navigation. PWA manifest (`manifest.webmanifest`) enables Add to Home Screen. `GET /api/config/vapid-public-key` returns public key (no auth required). `POST /api/config/test-notification` sends test push (auth required).
- **Parent Req:** REQ-SYS-001
- **Derived Reqs:** REQ-NOTIF-002, REQ-NOTIF-003
- **Verification:** Backend test: vapid-public-key endpoint returns key when configured, 500 when not. Push subscription CRUD endpoints function correctly. Service worker registered in browser. Frontend test: `notification.service.spec.ts` lines 24–245 (getVapidPublicKey GET, getSubscriptions GET, saveSubscription POST with toJSON payload, deleteSubscription DELETE, sendTestNotification POST, getPermissionState, subscribeToPush: denied permission, granted with save, existing subscription cleanup, null vapid key; unsubscribeFromPush: existing sub, no sub), `settings-page.spec.ts` lines 47–178 (load permission state, load subscriptions, getDeviceLabel for iOS/Android/Windows/macOS/Linux/unknown, removeDevice, sendTestNotification success/zero/failure, enableNotifications with loading state).
- **Validation:** User enables notifications in browser, receives push notification when a task is due.

### REQ-NOTIF-002
- **Description:** The system shall manage push notification subscriptions per user.
- **Rationale:** Each user/device combination requires a unique push subscription for targeted notifications.
- **Parameters:** PushSubscription model: userID (FK to Users, ON DELETE CASCADE), endpoint (TEXT, unique), p256dh (TEXT), auth (TEXT), userAgent (STRING 255). `POST /api/config/push-subscription` upserts by endpoint. `GET /api/config/push-subscription` lists current user's subscriptions. `DELETE /api/config/push-subscription/:id` removes subscription (ownership validated). Expired subscriptions (410 Gone) cleaned up automatically.
- **Parent Req:** REQ-NOTIF-001
- **Derived Reqs:** None
- **Verification:** Backend test: subscribe creates record, list returns user's subscriptions, unsubscribe removes record, 404 for wrong user's subscription. Frontend test: `notification.service.spec.ts` lines 38–85 (getSubscriptions GET, saveSubscription POST, deleteSubscription DELETE), `settings-page.spec.ts` lines 103–114 (removeDevice calls deleteSubscription and updates list).
- **Validation:** User subscribes on two devices, sees both in notification settings, removes one.

### REQ-NOTIF-003
- **Description:** The system shall send push notifications for task due date reminders and scheduled task creation.
- **Rationale:** Proactive reminders prevent missed deadlines and inform users of auto-created tasks.
- **Parameters:** Notification service checks every minute for tasks with `dueDate` within reminder window where `dueDateNotifiedAt IS NULL`. After notification, sets `dueDateNotifiedAt = NOW()` to prevent duplicates. `dueDateNotifiedAt` column added to Tasks table. Scheduled task service calls `sendScheduledTaskNotification()` after creating a task. Notification payload: `{ title, body, url }`.
- **Parent Req:** REQ-NOTIF-001
- **Derived Reqs:** None
- **Verification:** Backend test: due date reminder finds eligible tasks and marks them notified. Scheduled task creation triggers notification call.
- **Validation:** User sets task due in 30 minutes, receives push notification at the configured reminder time.

---

## 14. Design Requirements

### REQ-DES-001
- **Description:** The system shall provide CRUD operations for design requirements (create, read, update, soft-delete).
- **Rationale:** 21 CFR 820.30 and ISO 13485:2016 §7.3 require documented design inputs, outputs, and traceability. First-class design requirement management enables regulatory compliance.
- **Parameters:** `DesignRequirements` table with fields: id, description (TEXT, required), rationale (TEXT), parameter (TEXT), verification (TEXT), validation (TEXT), ownerUserID (FK → Users), approved (BOOLEAN, default false), approvedByUserID (FK → Users), activeFlag (BOOLEAN, default true). API endpoints: `POST /api/design/requirement`, `GET /api/design/requirement`, `GET /api/design/requirement/:id`, `PUT /api/design/requirement/:id`, `DELETE /api/design/requirement/:id` (soft delete).
- **Parent Req:** REQ-SYS-DC-001
- **Derived Reqs:** REQ-DES-002, REQ-DES-003, REQ-DES-006, REQ-DES-007, REQ-DES-008
- **Verification:** Verified by: `backend/tests/__tests__/design/design-requirement.test.js` (POST create, GET getAll, GET getById, PUT update, DELETE soft delete, 401 without auth).
- **Validation:** User can create, view, edit, and delete design requirements through the UI.

### REQ-DES-002
- **Description:** Design requirements shall support hierarchical parent-child relationships via `parentRequirementID`.
- **Rationale:** Requirements naturally decompose into sub-requirements; hierarchy enables traceability from high-level to detailed requirements per ISO 13485:2016 §7.3.3.
- **Parameters:** `parentRequirementID` (INTEGER, nullable, FK → DesignRequirements.id). Self-referencing: `belongsTo` parent, `hasMany` children. GET endpoint includes parent and child associations.
- **Parent Req:** REQ-DES-001
- **Derived Reqs:** None
- **Verification:** Verified by: `backend/tests/__tests__/design/design-requirement.test.js` — "Hierarchy" describe block (creates child with parentRequirementID, GET returns parent association).
- **Validation:** User creates parent and child requirements; tree view displays hierarchy with expand/collapse.

### REQ-DES-003
- **Description:** The system shall provide an approval workflow for design requirements (approve/unapprove with user tracking).
- **Rationale:** 21 CFR 820.30(c) requires design input review and approval. ISO 13485:2016 §7.3.2 requires review at suitable stages.
- **Parameters:** `approved` (BOOLEAN, default false), `approvedByUserID` (INTEGER, nullable, FK → Users). Endpoints: `PUT /api/design/requirement/:id/approve` sets approved=true and records approver, `PUT /api/design/requirement/:id/unapprove` resets approval. Any authenticated user can approve.
- **Parent Req:** REQ-DES-001
- **Derived Reqs:** None
- **Verification:** Verified by: `backend/tests/__tests__/design/design-requirement.test.js` — "Approval" describe block (approve sets approved=true and approvedByUserID, unapprove clears both, GET includes approvedBy association, 404 for nonexistent).
- **Validation:** User approves a requirement; approval status and approver name display in the UI.

### REQ-DES-004
- **Description:** The frontend shall display design requirements in a tree table with expandable/collapsible hierarchy.
- **Rationale:** Tree view enables users to see requirement decomposition at a glance and navigate complex hierarchies.
- **Parameters:** `mat-table` with flat data source built from hierarchical data. Rows indented by nesting level. Expand/collapse toggle for rows with children. Columns: expand toggle, description (indented), project, category, owner, approved status, actions. Project filter dropdown in toolbar.
- **Parent Req:** REQ-DES-001
- **Derived Reqs:** None
- **Verification:** Frontend tests verify tree building from flat array, expand/collapse state management, project filtering, navigation on row click.
- **Validation:** User sees hierarchical requirement list, expands/collapses nodes, filters by project, clicks to navigate to edit page.

### REQ-DES-005
- **Description:** The system shall provide separate create and edit pages for design requirements with form validation.
- **Rationale:** Dedicated pages allow focused requirement authoring with full validation context.
- **Parameters:** Routes: `/requirements/new` (create mode), `/requirements/:id/edit` (edit mode with view-first pattern). Form fields: Project (required dropdown), Category (optional dropdown), Description (required textarea), Rationale, Parameter, Parent Requirement (dropdown), Verification, Validation. Edit mode shows read-only view first with Edit button. Header buttons: Back, Edit/Cancel, Save/Create, Delete, Approve/Unapprove.
- **Parent Req:** REQ-DES-001
- **Derived Reqs:** None
- **Verification:** Frontend tests verify create vs edit mode detection, form validation (description and project required), save/cancel/delete actions, approve/unapprove button behavior.
- **Validation:** User creates a new requirement with required fields, edits an existing one, approves it.

### REQ-DES-006
- **Description:** Each design requirement must belong to a project (`projectID` FK → Projects).
- **Rationale:** Project association enables filtering and organization of requirements per product/project, supporting ISO 13485:2016 §7.3.1 planning.
- **Parameters:** `projectID` (INTEGER, NOT NULL, FK → Projects.id). GET endpoint supports `?projectID=` query filter. Project displayed in list view and required in create/edit form.
- **Parent Req:** REQ-DES-001
- **Derived Reqs:** None
- **Verification:** Verified by: `backend/tests/__tests__/design/design-requirement.test.js` — "rejects missing projectID", "filters by projectID", "includes owner, project, and category associations".
- **Validation:** User selects project when creating requirement; list view filters by project.

### REQ-DES-007
- **Description:** The system shall support user-defined requirement categories via a `RequirementCategories` lookup table with CRUD.
- **Rationale:** Categories enable grouping requirements by type (e.g., functional, performance, safety) for organized review.
- **Parameters:** `RequirementCategories` table: id, name (STRING 100, NOT NULL, UNIQUE), description (TEXT), activeFlag (BOOLEAN, default true). API: `POST /api/design/requirement-category`, `GET /api/design/requirement-category`, `PUT /api/design/requirement-category/:id`, `DELETE /api/design/requirement-category/:id`. Each DesignRequirement has optional `categoryID` (FK → RequirementCategories.id). Category management via dialog from edit page.
- **Parent Req:** REQ-DES-001
- **Derived Reqs:** None
- **Verification:** Verified by: `backend/tests/__tests__/design/requirement-category.test.js` (POST create, duplicate name rejection, missing name rejection, GET list active, PUT update, DELETE soft delete, 401 without auth).
- **Validation:** User creates categories via manage dialog, assigns category to requirement, sees category in list view.

### REQ-DES-008
- **Description:** The system shall maintain an immutable audit trail (`RequirementHistory` table) for all design requirement mutations.
- **Rationale:** 21 CFR 820.30 and ISO 13485:2016 §7.3 require traceable change history for design inputs. An immutable audit trail ensures QMS compliance with ALCOA principles.
- **Parameters:** `RequirementHistory` table: id (PK), requirementID (FK → DesignRequirements, CASCADE), changedByUserID (FK → Users, CASCADE), changeType (STRING 20, enum: created/updated/approved/unapproved/deleted), changes (JSONB, field-level diffs as `{field: {from, to}}`), changeNotes (TEXT, nullable), createdAt (DATE). No updatedAt. Immutable — no update or delete operations.
- **Parent Req:** REQ-DES-001
- **Derived Reqs:** REQ-DES-009, REQ-DES-010, REQ-DES-011
- **Verification:** Verified by: `backend/tests/__tests__/design/requirement-history.test.js` (table creation, association with User FK).
- **Validation:** History records persist and cannot be modified after creation.

### REQ-DES-009
- **Description:** The system shall automatically record history entries on all design requirement mutations: create, update, approve, unapprove, and delete.
- **Rationale:** Automated recording ensures no mutation goes untracked, eliminating human error in audit trail maintenance.
- **Parameters:** `create` logs initial field values as `{field: {from: null, to: value}}`. `update` logs field-level from/to diffs for tracked fields (description, rationale, parameter, verification, validation, parentRequirementID, projectID, categoryID); no record if nothing changed; supports optional changeNotes. `approve` logs `{approved: {from: false, to: true}, approvedByUserID: {from: null, to: id}}`. `unapprove` logs `{approved: {from: true, to: false}, approvedByUserID: {from: id, to: null}}`. `delete` logs `{activeFlag: {from: true, to: false}}`.
- **Parent Req:** REQ-DES-008
- **Derived Reqs:** None
- **Verification:** Verified by: `backend/tests/__tests__/design/requirement-history.test.js` (history on create, update with diffs, no record when nothing changed, changeNotes support, approve/unapprove history, delete history, full lifecycle audit trail).
- **Validation:** User creates, edits, approves, unapproves, and deletes a requirement; each action produces a corresponding history entry.

### REQ-DES-010
- **Description:** The system shall provide a `GET /api/design/requirement/:id/history` endpoint returning all history entries ordered by createdAt DESC, including the changedBy user association.
- **Rationale:** Enables frontend display and external audit review of requirement change history.
- **Parameters:** Returns array of RequirementHistory entries with `changedBy` user association (id, displayName, email, photoURL). Ordered by `createdAt DESC`. Returns 404 for nonexistent requirement. Returns 401 without authentication.
- **Parent Req:** REQ-DES-008
- **Derived Reqs:** None
- **Verification:** Verified by: `backend/tests/__tests__/design/requirement-history.test.js` (GET returns entries DESC, includes changedBy user, 404 for missing, 401 without auth).
- **Validation:** API returns complete, ordered history with user attribution for a given requirement.

### REQ-DES-011
- **Description:** The frontend shall display a collapsible history timeline on the requirement edit page showing change type, user, timestamp, notes, and field-level diffs.
- **Rationale:** In-context history display enables quick review of requirement evolution without leaving the edit page.
- **Parameters:** Collapsible section below metadata on edit page. Each entry shows: change type icon and label, user display name, timestamp, optional change notes, and field-level from/to diffs for update entries. Toggle button to show/hide history.
- **Parent Req:** REQ-DES-008
- **Derived Reqs:** None
- **Verification:** Frontend component includes history signal, toggle, load method, and timeline rendering.
- **Validation:** User expands history section on edit page and sees chronological list of all changes with details.

---

## Appendix A: Development Requirements

These requirements support the design, build, and implementation of the software system. They are not system-level QMS requirements but are necessary for efficient development and deployment.

### REQ-DEV-001
- **Description:** The system shall use a client-server architecture with an Angular frontend and Node.js/Express backend communicating via REST API.
- **Rationale:** Separation of concerns enables independent frontend/backend development and deployment.
- **Parameters:** Frontend: Angular with standalone components and signals. Backend: Express.js with Sequelize ORM. Database: PostgreSQL.
- **Parent Req:** REQ-SYS-001
- **Derived Reqs:** None
- **Verification:** Backend API responds to HTTP requests. Frontend loads and renders in browser.
- **Validation:** Application functions end-to-end across network boundary.

### REQ-DEV-002
- **Description:** The system shall support environment-specific configuration for development and production deployments.
- **Rationale:** Different database hosts, OAuth callbacks, and API URLs per environment.
- **Parameters:** `.env.development` for local dev (localhost), `.env.production` for production server. `NODE_ENV` variable determines which file loads. Frontend uses Angular `fileReplacements` for environment-specific API URLs.
- **Parent Req:** REQ-SYS-001
- **Derived Reqs:** None
- **Verification:** Backend loads correct .env file based on NODE_ENV. Frontend build substitutes environment files.
- **Validation:** Application connects to correct database and API endpoints in each environment.

### REQ-DEV-003
- **Description:** The system shall containerize the production deployment using Docker with automatic rebuilds on file changes.
- **Rationale:** Consistent deployment environment and developer experience.
- **Parameters:** `docker-compose.prod.yml` with backend Dockerfile. Build context at project root. Image pushed to DockerHub (`akl47/letwinventory`).
- **Parent Req:** REQ-SYS-001
- **Derived Reqs:** REQ-DEV-004
- **Verification:** Docker build succeeds. Container starts and serves application.
- **Validation:** Production deployment accessible at configured URL.

### REQ-DEV-004
- **Description:** The system shall deploy via GitHub Actions on version tag push.
- **Rationale:** Automated CI/CD reduces manual deployment steps and human error.
- **Parameters:** Trigger: `v*` tag push. Action: build Docker image, push to DockerHub with version and `latest` tags. Requires `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` secrets.
- **Parent Req:** REQ-DEV-003
- **Derived Reqs:** None
- **Verification:** GitHub Actions workflow runs on tag push. Image appears on DockerHub.
- **Validation:** New version deploys successfully via CI/CD pipeline.

### REQ-DEV-005
- **Description:** The system shall provide automated PostgreSQL database backups with change detection, email notifications, and off-site pull.
- **Rationale:** Data loss prevention requires regular, verified backups stored in multiple locations.
- **Parameters:** VPS script (`scripts/backup-db.sh`): daily `pg_dump -Fc` compressed backup. Change detection via `pg_stat_user_tables` hash (skips backup if no changes). Disk usage check (skips if >= 90% full). Email notifications via Gmail SMTP for success/failure. Off-site script (`scripts/pull-backup.sh`): pulls all `.dump` files from VPS via SCP. Successfully pulled files deleted from VPS. Skips already-downloaded files. Email notifications for pull status. VPS cron: daily at 2 AM. Off-site cron: daily at 2:10 AM.
- **Parent Req:** REQ-SYS-RD-003
- **Derived Reqs:** None
- **Verification:** Backup script creates `.dump` file when data changes. Pull script downloads and removes remote files.
- **Validation:** Database can be restored from a backup file using `pg_restore`.

---

## Appendix B: Regulatory Traceability Matrix

This matrix maps system requirements to their corresponding 21 CFR 820 subparts, ISO 13485:2016 clauses, and AS9100D clauses.

| Requirement | 21 CFR 820 | ISO 13485:2016 | AS9100D | Description |
|-------------|-----------|----------------|---------|-------------|
| REQ-SYS-QMS-001 | §820.20 | §4.1, §4.2 | §4.4, §5.1 | Quality Management System |
| REQ-SYS-QMS-002 | §820.40 | §4.2.4 | §7.5 | Document control workflow |
| REQ-SYS-QMS-003 | §820.180 | §4.2.5 | §7.5 | Quality records management |
| REQ-SYS-QMS-004 | §820.20(b)(1) | §6.2 | §7.1.2 | User identity and attribution |
| REQ-SYS-DC-001 | §820.30(b) | §7.3.2 | §8.3.2 | Design lifecycle stages |
| REQ-SYS-DC-002 | §820.30(c) | §7.3.3 | §8.3.3 | Design input capture |
| REQ-SYS-DC-003 | §820.30(d) | §7.3.4 | §8.3.5 | Design output generation |
| REQ-SYS-DC-004 | §820.30(e) | §7.3.5 | §8.3.4 | Design review gates |
| REQ-SYS-DC-005 | §820.30(i) | §7.3.9 | §8.3.6 | Design change control |
| REQ-SYS-PC-001 | §820.50 | §7.4.1 | §8.4.1 | Purchasing procedures |
| REQ-SYS-PC-002 | §820.50(b) | §7.4.2 | §8.4.2 | Purchasing data |
| REQ-SYS-PC-003 | §820.80 | §7.4.3 | §8.4.3 | Receiving inspection |
| REQ-SYS-IT-001 | §820.60 | §7.5.3 | §8.5.2 | Unique identification |
| REQ-SYS-IT-002 | §820.184 | §7.5.9 | §8.5.2 | Audit trail |
| REQ-SYS-IT-003 | §820.65 | §7.5.9.1 | §8.5.2 | Serial/lot tracking |
| REQ-SYS-PP-001 | §820.70 | §7.5.1 | §8.5.1 | Production planning |
| REQ-SYS-PP-002 | §820.70(a) | §7.5.1(b) | §8.5.1 | Manufacturing specifications |
| REQ-SYS-LC-001 | §820.120 | §7.5.1(d) | §8.5.1 | Labeling controls |
| REQ-SYS-RD-001 | §820.184 | §7.5.1(e) | §7.5 | Device History Record |
| REQ-SYS-RD-002 | §820.30(j) | §7.3.10 | §8.3.6 | Design History File |
| REQ-SYS-RD-003 | §820.180, Part 11 | §4.2.5 | §7.5 | Data integrity (ALCOA) |
| REQ-SYS-ORM-001 | — | — | §8.1.1 | Operational risk management |
| REQ-SYS-CM-001 | — | — | §8.1.2 | Configuration management (designs) |
| REQ-SYS-CM-002 | — | — | §8.1.2 | Configuration management (parts) |
| REQ-SYS-PS-001 | — | — | §8.1.3 | Product safety |
| REQ-SYS-CP-001 | — | — | §8.1.4 | Counterfeit parts prevention |
| REQ-SYS-EP-001 | §820.50 | §7.4.1 | §8.4.1 | External provider control |
| REQ-SYS-PV-001 | — | — | §8.5.1.3 | Production process verification / FAI |
| REQ-SYS-NC-001 | §820.90 | §8.3 | §8.7 | Nonconforming product control |

---

## Appendix C: Requirements Implementation Status

Status key:
- **Met** — Feature fully implemented as described in the requirement parameters and verification criteria
- **Partial** — Core functionality exists but specific aspects described in the requirement are not yet implemented
- **Not Met** — Feature not yet implemented

### 1. System-Level Requirements

| Req ID | Description | Status | Notes |
|--------|-------------|--------|-------|
| REQ-SYS-001 | Web-based enterprise resource application | Met | All major functional areas implemented |
| REQ-SYS-004 | Soft deletion with activeFlag | Met | All models use activeFlag; "Show Inactive" toggles in UI |
| REQ-SYS-QMS-001 | Quality Management System | Partial | System provides workflows but no formal QMS documentation or retention policies defined in the system |
| REQ-SYS-QMS-002 | Document control via release workflow | Met | Harness Draft/Review/Released workflow with immutable releases and revision history |
| REQ-SYS-QMS-003 | Quality records retention | Met | All history tables have userID, timestamps; soft deletion prevents permanent loss |
| REQ-SYS-QMS-004 | User authentication and attribution | Met | Google OAuth; all actions record userID |
| REQ-SYS-DC-001 | Design lifecycle stages | Met | Draft/Review/Released transitions enforced and recorded |
| REQ-SYS-DC-002 | Design inputs captured | Met | harnessData JSONB stores all component specs |
| REQ-SYS-DC-003 | Design outputs | Met | JSON export; validation endpoint; released designs serve as manufacturing specs |
| REQ-SYS-DC-004 | Design review gates | Met | submit-review, reject (with notes), release endpoints |
| REQ-SYS-DC-005 | Design change history | Met | HarnessRevisionHistory with snapshots; revert endpoint |
| REQ-SYS-PC-001 | Purchasing procedures | Partial | Order workflow exists but status progression not enforced at API level (can skip statuses) |
| REQ-SYS-PC-002 | Purchasing data | Met | OrderItems reference parts with full specifications |
| REQ-SYS-PC-003 | Receiving inspection | Met | receivedQuantity tracked; receiving creates Trace/Equipment with RECEIVED barcode history |
| REQ-SYS-IT-001 | Unique barcode identification | Met | Auto-generated PREFIX-XXXXXX barcodes for all entities |
| REQ-SYS-IT-002 | Complete audit trail | Met | BarcodeHistory records all actions (CREATED, MOVED, RECEIVED, SPLIT, MERGED, DELETED) |
| REQ-SYS-IT-003 | Serial/lot number tracking | Partial | Fields exist on Part and Trace models but serialNumberRequired/lotNumberRequired not enforced during trace creation |
| REQ-SYS-PP-001 | Production planning via tasks | Met | Kanban board with task types, scheduling, time tracking |
| REQ-SYS-PP-002 | Manufacturing specifications | Met | Released harnesses are immutable; edits create new revisions |
| REQ-SYS-LC-001 | Barcode labeling controls | Met | ZPL generation with 2 sizes, preview, and Zebra printer integration |
| REQ-SYS-RD-001 | Device History Record | Partial | History data exists across tables (barcode, task, harness, order) but no unified DHR report/view |
| REQ-SYS-RD-002 | Design History File | Met | HarnessRevisionHistory with snapshots; history and revisions endpoints |
| REQ-SYS-RD-003 | Data integrity (ALCOA) | Met | Timestamps auto-generated; userID on all actions; soft deletion; no retroactive modification |
| REQ-SYS-ORM-001 | Operational risk management | Met | critical_path task type; scheduled tasks for recurring risk-mitigation |
| REQ-SYS-CM-001 | Configuration management (designs) | Met | Part numbers, revision letters, release freeze, change history |
| REQ-SYS-CM-002 | Configuration management (parts) | Met | Parts catalog with vendor, manufacturer, SKU, category attributes |
| REQ-SYS-PS-001 | Product safety | Met | Design review gates, traceability, serial/lot tracking, validation |
| REQ-SYS-CP-001 | Counterfeit parts prevention | Met | Manufacturer traceability, vendor tracking, procurement records |
| REQ-SYS-EP-001 | External provider control | Met | Vendor tracking on orders; order history filterable by vendor |
| REQ-SYS-PV-001 | Production process verification / FAI | Partial | critical_path tasks can be used for FAI but no automatic FAI task creation on new harness revision release |
| REQ-SYS-NC-001 | Nonconforming product control | Met | Quarantine via location move; disposition via delete/move; all actions recorded in barcode history |

### 2. Authentication & Authorization

| Req ID | Description | Status | Notes |
|--------|-------------|--------|-------|
| REQ-AUTH-001 | Google OAuth 2.0 authentication | Met | |
| REQ-AUTH-002 | JWT access tokens | Met | |
| REQ-AUTH-003 | JWT token refresh via httpOnly cookie | Met | |
| REQ-AUTH-004 | Protected API endpoints | Met | checkToken middleware on all non-auth routes |
| REQ-AUTH-005 | User profile view/update | Met | |
| REQ-AUTH-006 | Google Add-on token exchange | Met | |
| REQ-AUTH-007 | Frontend auth guard | Met | |
| REQ-AUTH-008 | Auto-retry on 401 with token refresh | Met | |

### 3. Inventory Management

| Req ID | Description | Status | Notes |
|--------|-------------|--------|-------|
| REQ-INV-001 | Hierarchical inventory structure | Met | |
| REQ-INV-002 | Tree view with expand/collapse | Met | |
| REQ-INV-003 | Location CRUD | Met | |
| REQ-INV-004 | Box CRUD | Met | |
| REQ-INV-005 | Trace CRUD with quantity tracking | Met | |
| REQ-INV-005A | Split trace | Met | |
| REQ-INV-005B | Merge traces | Met | |
| REQ-INV-005C | Partial/full trace deletion | Met | |
| REQ-INV-006 | Equipment CRUD | Met | |
| REQ-INV-007 | Units of Measure reference data | Met | |

### 4. Barcode Management

| Req ID | Description | Status | Notes |
|--------|-------------|--------|-------|
| REQ-BAR-001 | Auto-generate unique barcodes | Met | |
| REQ-BAR-002 | Barcode lookup by string | Met | |
| REQ-BAR-003 | Move barcodes between locations | Met | |
| REQ-BAR-004 | Barcode action history | Met | |
| REQ-BAR-005 | ZPL label generation (3x1, 1.5x1) | Met | |
| REQ-BAR-006 | Print to Zebra printers | Met | |
| REQ-BAR-006A | WebSocket print agent | Met | |
| REQ-BAR-007 | Barcode tag system | Met | |

### 5. Parts Management

| Req ID | Description | Status | Notes |
|--------|-------------|--------|-------|
| REQ-PRT-001 | Part CRUD with categories | Met | |
| REQ-PRT-002 | Manufacturer required for vendor parts | Met | |
| REQ-PRT-003 | Part categories with color tags | Met | |
| REQ-PRT-004 | Part image upload and hover preview | Met | |
| REQ-PRT-005 | Body validator middleware | Met | |
| REQ-PRT-006 | Parts table search/sort/pagination/URL sync | Met | |
| REQ-PRT-007 | Stay on part after save | Met | |

### 6. Order Management

| Req ID | Description | Status | Notes |
|--------|-------------|--------|-------|
| REQ-ORD-001 | Order CRUD with status workflow | Met | |
| REQ-ORD-002 | Order statuses with workflow progression | Met | nextStatusID defined; UI follows progression |
| REQ-ORD-003 | Order line items | Met | |
| REQ-ORD-004 | Auto-recalculate status on receiving | Met | |
| REQ-ORD-005 | Bulk CSV import with dry-run | Met | |
| REQ-ORD-006 | Receive items into inventory | Met | |
| REQ-ORD-007 | Orders list search/filter/sort/URL sync | Met | |

### 7. Wire Harness Design

| Req ID | Description | Status | Notes |
|--------|-------------|--------|-------|
| REQ-HAR-001 | Canvas-based harness editor | Met | |
| REQ-HAR-002 | Connector placement/rotation/flip | Met | |
| REQ-HAR-003 | Multi-wire cables | Met | |
| REQ-HAR-004 | Components with pin groups | Met | |
| REQ-HAR-005 | Wire connections with orthogonal routing | Met | |
| REQ-HAR-006 | Connector mating connections | Met | |
| REQ-HAR-007 | Wire termination types from WireEnd DB | Met | |
| REQ-HAR-008 | Sub-harness references | Met | |
| REQ-HAR-009 | Undo/redo (50 entries max) | Met | |
| REQ-HAR-010 | Auto-save with 1.5s debounce | Met | |
| REQ-HAR-011 | Element grouping/ungrouping | Met | |
| REQ-HAR-012 | Pan, zoom, grid, snap-to-grid | Met | |
| REQ-HAR-013 | Release workflow (Draft/Review/Released) | Met | |
| REQ-HAR-014 | Released harnesses read-only | Met | |
| REQ-HAR-015 | New revision on editing released harness | Met | |
| REQ-HAR-016 | Harness list view with status chips | Met | |
| REQ-HAR-017 | Import/export as JSON | Met | |
| REQ-HAR-018 | Backend validation for structural integrity | Met | |
| REQ-HAR-019 | Image data stripping on save/export | Met | |
| REQ-HAR-020 | Parts sync on harness load | Met | |
| REQ-HAR-021 | Sub-harness image display and toggle buttons | Met | |

### 8. Planning & Task Management

| Req ID | Description | Status | Notes |
|--------|-------------|--------|-------|
| REQ-PLN-001 | Kanban task board with drag-and-drop | Met | |
| REQ-PLN-002 | Task CRUD with project/type/priority | Met | |
| REQ-PLN-003 | Move tasks between lists | Met | |
| REQ-PLN-004 | Task list CRUD with reordering | Met | |
| REQ-PLN-005 | Project management with color tags and shortcuts | Met | |
| REQ-PLN-006 | Keyboard shortcut project assignment | Met | |
| REQ-PLN-007 | Task filtering by project/subtask | Met | |
| REQ-PLN-008 | Task history for state changes | Met | |
| REQ-PLN-009 | Task detail dialog (subtasks, date picker, time) | Met | |
| REQ-PLN-010 | Scheduled tasks from cron expressions | Met | |
| REQ-PLN-011 | Task time tracking (calendar integration) | Met | |
| REQ-PLN-012 | Mobile responsive layout | Met | |
| REQ-PLN-013 | Task inline checklist (JSONB) | Met | |

### 9. File Management

| Req ID | Description | Status | Notes |
|--------|-------------|--------|-------|
| REQ-FILE-001 | File upload/storage/retrieval | Met | |

### 10. Mobile Scanner

| Req ID | Description | Status | Notes |
|--------|-------------|--------|-------|
| REQ-MOB-001 | Mobile camera-based barcode scanner | Met | |
| REQ-MOB-002 | Move action (scan item, scan destination) | Met | |
| REQ-MOB-003 | Merge action (scan target, scan source) | Met | |
| REQ-MOB-004 | Split action with quantity input | Met | |
| REQ-MOB-005 | Trash action with optional partial quantity | Met | |
| REQ-MOB-006 | Back button for navigation | Met | |

### 11. Configuration & Printer Management

| Req ID | Description | Status | Notes |
|--------|-------------|--------|-------|
| REQ-CFG-001 | Printer configuration | Met | |

### 12. UI/UX Requirements

| Req ID | Description | Status | Notes |
|--------|-------------|--------|-------|
| REQ-UX-001 | List views: search/sort/pagination/URL sync | Met | All 6 list views implemented |
| REQ-UX-002 | Collapsible sidebar, auto-collapse on mobile | Met | |
| REQ-UX-003 | Error notifications via Material snackbar | Met | |
| REQ-UX-004 | Harness editor keyboard shortcuts | Met | |
| REQ-UX-005 | Independent barcode preview and print sizes | Met | |
| REQ-UX-006 | Middle-click opens in new tab | Met | Parts, orders, harness list views |

### 13. Push Notifications

| Req ID | Description | Status | Notes |
|--------|-------------|--------|-------|
| REQ-NOTIF-001 | Web push via VAPID/service worker | Met | On `pwa` branch, pending merge to master |
| REQ-NOTIF-002 | Push subscription management per user | Met | On `pwa` branch, pending merge to master |
| REQ-NOTIF-003 | Due date reminders and scheduled task notifications | Met | On `pwa` branch, pending merge to master |

### Appendix A: Development Requirements

| Req ID | Description | Status | Notes |
|--------|-------------|--------|-------|
| REQ-DEV-001 | Angular + Node.js/Express architecture | Met | |
| REQ-DEV-002 | Environment-specific configuration | Met | |
| REQ-DEV-003 | Docker containerized deployment | Met | |
| REQ-DEV-004 | GitHub Actions deploy on version tag | Met | |
| REQ-DEV-005 | Automated database backups with off-site pull | Met | |

### Summary

| Status | Count | Percentage |
|--------|-------|------------|
| Met | 114 | 93% |
| Partial | 5 | 4% |
| Not Met | 0 | 0% |
| **Total** | **119** | |

### Open Items (Partial Requirements)

| Req ID | Gap | Recommended Action |
|--------|-----|-------------------|
| REQ-SYS-QMS-001 | No formal QMS documentation or retention policies defined in the system | Define retention policy configuration; consider adding QMS document storage |
| REQ-SYS-PC-001 | Order status progression not enforced at API level | Add validation in `updateOrderByID` to check `currentStatus.nextStatusID` before allowing status change |
| REQ-SYS-IT-003 | serialNumberRequired / lotNumberRequired not enforced during trace creation | Add validation in `createNewTrace` to check Part's serial/lot flags and reject traces missing required fields |
| REQ-SYS-RD-001 | DHR data exists across tables but no unified view/report | Create a DHR report endpoint or UI page that aggregates barcode history, task history, order history, and harness revision history for a given product |
| REQ-SYS-PV-001 | No automatic FAI task creation when a new harness revision is released | Add trigger in harness release workflow to auto-create a critical_path task for FAI linked to the new revision |

---

## Appendix D: Frontend Verification Test Matrix

This appendix maps system requirements to their frontend unit test spec files. These tests verify UI component behavior, service interactions, and user workflow logic. All spec files use Angular TestBed with Jasmine and are located under `frontend/src/app/`.

**Rationale:** Frontend tests provide automated verification that UI components correctly implement the behaviors specified in each requirement. They verify computed properties, user interactions, service calls, form validation, state management, and error handling. Combined with backend API tests and E2E tests, they form the verification triad ensuring requirements are met at every layer.

### D.1 Authentication & Authorization

| Req ID | Spec File | Lines | What is Verified |
|--------|-----------|-------|------------------|
| REQ-AUTH-007 | `guards/auth.guard.spec.ts` | 10–48 | Allow access when authenticated; check auth status on page refresh; redirect to /home on failure |
| REQ-AUTH-008 | `interceptors/auth.interceptor.spec.ts` | 9–192 | Add Authorization header; skip for refresh endpoint; 401 triggers token refresh + retry; redirect on null/error refresh; request queuing during active refresh; 403 clears token + redirects; non-auth error passthrough |

### D.2 Inventory Management

| Req ID | Spec File | Lines | What is Verified |
|--------|-----------|-------|------------------|
| REQ-INV-001 | `components/inventory/inventory-higherarchy-view/inventory-higherarchy-view.spec.ts` | 56–178 | Tree building from flat tags, nested children, deep nesting, search, equipment filter, barcode selection |
| REQ-INV-002 | `components/inventory/inventory-higherarchy-view/inventory-higherarchy-view.spec.ts` | 60–112 | Tree building, child nesting, search by name/barcode, expand matching paths |
| REQ-INV-002 | `components/inventory/inventory-higherarchy-item/inventory-higherarchy-item.spec.ts` | all | Toggle expand, dialog integrations, child event propagation |
| REQ-INV-003, REQ-INV-004, REQ-INV-005 | `components/inventory/inventory-item-dialog/inventory-item-dialog.spec.ts` | all | Create/edit modes, part filtering, validators, delete confirmation |
| REQ-INV-006 | `components/inventory/equipment-table-view/equipment-table-view.spec.ts` | all | Loading, filtering, pagination, sorting, dialog integration |
| REQ-INV-006 | `components/inventory/equipment-edit-dialog/equipment-edit-dialog.spec.ts` | all | Create/edit modes, validation, delete confirmation |

### D.3 Barcode Management

| Req ID | Spec File | Lines | What is Verified |
|--------|-----------|-------|------------------|
| REQ-BAR-003 | `components/inventory/barcode-movement-dialog/barcode-movement-dialog.spec.ts` | 44–122 | Move action: canSubmit validation, executeMove API call, self-move prevention, error handling |
| REQ-BAR-004 | `components/inventory/barcode-history/barcode-history.spec.ts` | 84–365 | Route param loading, barcode map, column switching, date sorting, search, action labels/icons, barcode resolution |
| REQ-BAR-005 | `components/inventory/barcode-dialog/barcode-dialog.spec.ts` | 54–239 | Initialization, ZPL fetch, image rendering, preview size change, print options, label size toggle, print/move/history actions |
| REQ-BAR-007 | `components/inventory/barcode-tag/barcode-tag.spec.ts` | all | Input binding, output emissions, dialog interaction |
| REQ-INV-005A | `components/inventory/barcode-movement-dialog/barcode-movement-dialog.spec.ts` | 159–192 | Split action: canSubmit requires positive quantity, splitTrace call, null guard |
| REQ-INV-005B | `components/inventory/barcode-movement-dialog/barcode-movement-dialog.spec.ts` | 123–159 | Merge action: canSubmit requires mergeBarcode, mergeTrace call, close on success |
| REQ-INV-005C | `components/inventory/barcode-movement-dialog/barcode-movement-dialog.spec.ts` | 193–265 | Delete action: non-trace/trace-full/trace-partial modes, confirmation validation, deleteItem/deleteTrace calls |

### D.4 Parts Management

| Req ID | Spec File | Lines | What is Verified |
|--------|-----------|-------|------------------|
| REQ-PRT-001 | `components/inventory/parts-table-view/parts-table-view.spec.ts` | 80–361 | Data loading, category/type/search/inactive filtering, pagination, sorting, navigation, color utilities |
| REQ-PRT-001 | `components/inventory/part-edit-page/part-edit-page.spec.ts` | all | Form validation, category detection, pin group management, image management |
| REQ-PRT-001 | `components/inventory/part-edit-dialog/part-edit-dialog.spec.ts` | all | Create/edit modes, validation, image management |
| REQ-PRT-003 | `components/inventory/parts-table-view/parts-table-view.spec.ts` | 95–262 | Category selection/deselection, toggleAllCategories, selectedCategories, hiddenCategoryCount |
| REQ-PRT-006 | `components/inventory/parts-table-view/parts-table-view.spec.ts` | 101–321 | Search across fields, category multi-select, type filter, pagination, sorting, getTotalCount |

### D.5 Order Management

| Req ID | Spec File | Lines | What is Verified |
|--------|-----------|-------|------------------|
| REQ-ORD-001 | `components/orders/orders-list-view/orders-list-view.spec.ts` | 77–315 | Status loading, toggle filtering, search, pagination, sorting, status classes, pricing calculations |
| REQ-ORD-001 | `components/orders/order-view/order-view.spec.ts` | 78–392 | Status navigation, receive mode, line item editing, pricing, date formatting, line type checks |
| REQ-ORD-001 | `components/orders/order-edit-dialog/order-edit-dialog.spec.ts` | all | Create/edit modes |
| REQ-ORD-003 | `components/orders/order-item-dialog/order-item-dialog.spec.ts` | all | Part selection, line total computation |
| REQ-ORD-005 | `components/orders/bulk-upload/bulk-upload.spec.ts` | 43–290 | Computed totals, dry-run preview, inline editing, quantity/price parsing, category helpers |
| REQ-ORD-006 | `components/orders/receive-line-item-dialog/receive-line-item-dialog.spec.ts` | 62–235 | Part/equipment receiving, receipt types, canSubmit validation, quantity computation |
| REQ-ORD-007 | `components/orders/orders-list-view/orders-list-view.spec.ts` | 94–241 | Status selection, search, pagination, sorting, getTotalCount |

### D.6 Wire Harness Design

| Req ID | Spec File | Lines | What is Verified |
|--------|-----------|-------|------------------|
| REQ-HAR-001 | `components/harness/harness-canvas/harness-canvas.spec.ts` | 80–362 | Inputs, outputs, zoom, add elements, delete/group/ungroup guards, export guards |
| REQ-HAR-001 | `components/harness/harness-page/harness-page.spec.ts` | 83–635 | Initial state, computed properties, create/load harness, tool/selection/data changes, property changes, copy/paste, undo/redo, layer ordering, export |
| REQ-HAR-002 | `components/harness/harness-connector-dialog/harness-connector-dialog.spec.ts` | 38–330 | Create/edit/locked modes, type labels, color hex/name, isValid, part selection, duplicate label detection |
| REQ-HAR-003 | `components/harness/harness-add-cable-dialog/harness-add-cable-dialog.spec.ts` | 18–310 | Create/edit modes, wire hex, drag reorder, part selection, duplicate label detection |
| REQ-HAR-003 | `components/harness/harness-cable-dialog/harness-cable-dialog.spec.ts` | all | Deep-cloned cables, add/remove cables and wires, quickAdd, min wire protection |
| REQ-HAR-004 | `components/harness/harness-component-dialog/harness-component-dialog.spec.ts` | 18–315 | Create/edit modes, pin count, group/pin visibility toggle, part selection, duplicate label detection |
| REQ-HAR-005 | `components/harness/harness-property-panel/harness-property-panel.spec.ts` | 287–477 | Connection property updates, endpoint descriptions and types |
| REQ-HAR-007 | `components/harness/harness-property-panel/harness-property-panel.spec.ts` | 113–120, 601–653 | Wire ends loading, termination get/update for from/to endpoints |
| REQ-HAR-009 | `components/harness/harness-page/harness-page.spec.ts` | 146–155, 417–470 | canUndo/canRedo computed, drag transactions, undo restores, redo restores, nothing-to-undo guard |
| REQ-HAR-012 | `components/harness/harness-canvas/harness-canvas.spec.ts` | 84–174 | Grid default, zoom in/out/reset, zoom min/max caps |
| REQ-HAR-014 | `components/harness/harness-page/harness-page.spec.ts` | 157–188 | isReleased, isInReview, isLocked computed properties for draft/review/released states |
| REQ-HAR-014 | `components/harness/harness-toolbar/harness-toolbar.spec.ts` | 29–76 | isReleased input binding |
| REQ-HAR-016 | `components/harness/harness-list-view/harness-list-view.spec.ts` | 52–205 | Data loading, filtering, sorting, pagination, formatDate, middle-click, displayedColumns with releaseState |
| REQ-HAR-017 | `components/harness/harness-import-dialog/harness-import-dialog.spec.ts` | 39–254 | Drag events, JSON paste, validation (syntax, schema, backend), useSample, import with/without data, file type rejection |
| REQ-HAR-017 | `components/harness/harness-page/harness-page.spec.ts` | 573–593 | Export JSON null guard, download link creation |
| REQ-HAR-020 | `components/harness/harness-sync-dialog/harness-sync-dialog.spec.ts` | 69–145 | Type icons, acceptSelected with preserved flags, keepAll, empty changes |
| REQ-HAR-005, REQ-HAR-007 | `components/harness/harness-property-panel/harness-property-panel.spec.ts` | 139–730 | All computed properties, update methods, label getters, endpoint methods, bulk wire editing |
| REQ-HAR-002, REQ-HAR-003, REQ-HAR-004 | `components/harness/harness-add-part-dialog/harness-add-part-dialog.spec.ts` | all | Tab switching, connector/wire/cable CRUD, color helpers, validation for all tabs, unique label generation |

### D.7 Planning & Task Management

| Req ID | Spec File | Lines | What is Verified |
|--------|-----------|-------|------------------|
| REQ-PLN-001 | `components/tasks/task-list-view/task-list-view.spec.ts` | 40–222 | Initial state, toggle history/edit mode, add/rename/delete lists, filter handlers, save/revert defaults, URL params |
| REQ-PLN-001 | `components/tasks/task-list/task-list.spec.ts` | 37–181 | Filtered tasks exclude done, project/noProject/childTask filters, add/cancel task, title editing, delete, dragDelay |
| REQ-PLN-002 | `components/tasks/task-card-dialog/task-card-dialog.spec.ts` | 49–378 | Checklist, list name, project, tasks filter, title/description editing, formatEstimate/Reminder, due date, move list, select project, subtasks |
| REQ-PLN-002 | `components/tasks/task-card/task-card.spec.ts` | 40–279 | checklistProgress, formatEstimate, displayDone, projectColor, sortedProjects, isDueToday/isOverdue, toggleComplete |
| REQ-PLN-005 | `components/projects/projects-list-view/projects-list-view.spec.ts` | 47–179 | Load projects, inactive filter, search, sorting, pagination, goBack |
| REQ-PLN-005 | `components/projects/project-edit-dialog/project-edit-dialog.spec.ts` | 54–227 | Create/edit modes, shortcuts, color picker, validation, save with # stripping, delete with confirmation |
| REQ-PLN-006 | `components/tasks/task-card/task-card.spec.ts` | 224–279 | Ignore when not hovered, 'c' toggles complete, '0' clears project, number assigns project, toggle off |
| REQ-PLN-007 | `components/tasks/sub-toolbar/sub-toolbar.spec.ts` | 35–202 | Project selection, all/some/none selected, filter count, toggle project/all/noProject, showChildTasks, navigation |
| REQ-PLN-007 | `components/tasks/task-list/task-list.spec.ts` | 41–74 | Filter by project IDs, hide no-project tasks, hide subtasks |
| REQ-PLN-007 | `components/tasks/task-list-view/task-list-view.spec.ts` | 156–201 | Filter handlers, saveAsDefault, revertToDefault |
| REQ-PLN-008 | `components/tasks/history-drawer/history-drawer.spec.ts` | 36–117 | isCreatedAction, action labels for 6 types, getLabel for lists/projects/priorities/status, loadMoreHistory guards |
| REQ-PLN-010 | `components/scheduled-tasks/scheduled-tasks-list-view/scheduled-tasks-list-view.spec.ts` | 66–227 | Data loading, filtering, sorting, pagination, cronToEnglish for 11 expression patterns |
| REQ-PLN-010 | `components/scheduled-tasks/scheduled-task-edit-dialog/scheduled-task-edit-dialog.spec.ts` | 66–257 | Create/edit modes, timezone, cronDescription, save/delete, form population |
| REQ-PLN-012 | `components/tasks/task-list/task-list.spec.ts` | 175–179 | dragDelay: touch 500ms, mouse 0ms |
| REQ-PLN-013 | `components/tasks/task-card/task-card.spec.ts` | 44–67 | checklistProgress string, null for no/empty checklist |
| REQ-PLN-013 | `components/tasks/task-card-dialog/task-card-dialog.spec.ts` | 53–168 | Checklist properties, progress/percent, add/toggle/delete items |

### D.8 Mobile Scanner

| Req ID | Spec File | Lines | What is Verified |
|--------|-----------|-------|------------------|
| REQ-MOB-001 | `components/mobile/mobile-scanner/mobile-scanner.spec.ts` | 37–279 | Initial state, isTrace computed, locationChain, state transitions, badge classes, BarcodeDetector absence |
| REQ-MOB-002 | `components/mobile/mobile-scanner/mobile-scanner.spec.ts` | 115–131 | startMove sets scanning_second with move action |
| REQ-MOB-003 | `components/mobile/mobile-scanner/mobile-scanner.spec.ts` | 124–131 | startMerge sets scanning_second with merge action |
| REQ-MOB-004 | `components/mobile/mobile-scanner/mobile-scanner.spec.ts` | 133–141 | startSplit sets confirm action and confirming_action state |
| REQ-MOB-005 | `components/mobile/mobile-scanner/mobile-scanner.spec.ts` | 142–175 | startTrash, toggleTrashAll with quantity logic |
| REQ-MOB-006 | `components/mobile/mobile-scanner/mobile-scanner.spec.ts` | 226–232 | goBack calls location.back |

### D.9 Push Notifications

| Req ID | Spec File | Lines | What is Verified |
|--------|-----------|-------|------------------|
| REQ-NOTIF-001 | `services/notification.service.spec.ts` | 24–245 | VAPID key fetch, subscription CRUD, push permission, subscribeToPush (4 scenarios), unsubscribeFromPush |
| REQ-NOTIF-001 | `components/settings/settings-page/settings-page.spec.ts` | 47–178 | Permission state, subscriptions, device labels, removeDevice, testNotification, enableNotifications |
| REQ-NOTIF-002 | `services/notification.service.spec.ts` | 38–85 | getSubscriptions, saveSubscription, deleteSubscription |
| REQ-NOTIF-002 | `components/settings/settings-page/settings-page.spec.ts` | 103–114 | Remove device from subscription list |

### D.10 UI/UX

| Req ID | Spec File | Lines | What is Verified |
|--------|-----------|-------|------------------|
| REQ-UX-001 | Multiple list view specs (see §D.4–D.7) | — | Search, sort, pagination, URL param persistence across all 6 list views |
| REQ-UX-002 | `components/common/nav/nav.component.spec.ts` | 50–65 | toggleSidenav toggles collapsed state |
| REQ-UX-004 | `components/harness/harness-toolbar/harness-toolbar.spec.ts` | 77–108 | Tool switching for select/pan/nodeEdit/connector |
| REQ-UX-005 | `components/inventory/barcode-dialog/barcode-dialog.spec.ts` | 108–239 | Preview/label size defaults, preview size change, print options toggle, label size toggle, print execution |
| REQ-UX-006 | `components/inventory/parts-table-view/parts-table-view.spec.ts` | 348–361 | Middle-click prevent default + open new tab |
| REQ-UX-006 | `components/orders/orders-list-view/orders-list-view.spec.ts` | 302–315 | Middle-click prevent default + open new tab |
| REQ-UX-006 | `components/harness/harness-list-view/harness-list-view.spec.ts` | 169–195 | Middle-click prevent default + open new tab |

### D.11 Services & Common

| Req ID | Spec File | Lines | What is Verified |
|--------|-----------|-------|------------------|
| REQ-FILE-001 | `services/harness-parts.service.spec.ts` | uploadFile test | File upload reads base64 and POSTs data |
| REQ-UX-002 | `components/common/nav/nav.component.spec.ts` | 46–150 | Create, toggleSidenav, navigateToTasks, login redirect, logout, openSettings, mobile route detection |
| REQ-AUTH-001 | `components/common/home/home.component.spec.ts` | all | Login redirect to home page |

### D.12 Test Coverage Summary

| Domain | Spec Files | Test Cases | Key Requirements Covered |
|--------|-----------|------------|--------------------------|
| Auth & Guards | 3 | ~25 | REQ-AUTH-007, REQ-AUTH-008 |
| Tasks | 6 | ~120 | REQ-PLN-001–013 |
| Inventory | 12 | ~300 | REQ-INV-001–007, REQ-BAR-003–007, REQ-INV-005A–C |
| Harness | 13 | ~559 | REQ-HAR-001–020 |
| Orders/Projects | 14 | ~200 | REQ-ORD-001–007, REQ-PLN-005–006, REQ-PLN-010 |
| Notifications | 2 | ~30 | REQ-NOTIF-001–003 |
| Mobile | 1 | ~30 | REQ-MOB-001–006 |
| **Total** | **~51** | **~1264** | **All functional requirements with UI components** |
