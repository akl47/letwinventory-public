# Database Schema

This document describes the PostgreSQL database schema for LetWinInventory.

## Overview

The database is managed using Sequelize ORM with migrations for schema changes and seeders for initial data.

## Entity Relationship Diagram

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────┐
│    User     │     │  BarcodeCategory│     │ PartCategory│
└─────────────┘     └─────────────────┘     └─────────────┘
       │                    │                      │
       │                    ▼                      ▼
       │            ┌─────────────┐         ┌─────────────┐
       │            │   Barcode   │         │    Part     │
       │            └─────────────┘         └─────────────┘
       │                 │    │                    │
       │          ┌──────┘    └──────┐            │
       │          ▼                  ▼            │
       │    ┌─────────────┐    ┌─────────────┐   │
       │    │   Location  │◄───│     Box     │   │
       │    └─────────────┘    └─────────────┘   │
       │          │                  │           │
       │          └────────┬─────────┘           │
       │                   ▼                     │
       │            ┌─────────────┐              │
       │            │    Trace    │◄─────────────┘
       │            └─────────────┘
       │
       │    ┌─────────────┐     ┌───────────────┐
       │    │ OrderStatus │     │ OrderLineType │
       │    └─────────────┘     └───────────────┘
       │          │                    │
       │          ▼                    │
       │    ┌─────────────┐            │
       │    │    Order    │            │
       │    └─────────────┘            │
       │          │                    │
       │          ▼                    │
       │    ┌─────────────┐            │
       │    │  OrderItem  │◄───────────┘
       │    └─────────────┘
       │          │
       │          ▼
       │    ┌─────────────┐
       └───►│   Project   │◄──┐
            └─────────────┘   │ (self-reference)
                  │           │
                  ▼           │
            ┌─────────────┐   │
            │    Task     │───┘
            └─────────────┘
                  │
                  ▼
            ┌─────────────┐
            │ TaskHistory │
            └─────────────┘
```

---

## Tables

### Users

Stores user account information.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PK, AUTO_INCREMENT | Unique identifier |
| email | STRING | NOT NULL, UNIQUE | User email address |
| name | STRING | NOT NULL | Display name |
| googleId | STRING | UNIQUE | Google OAuth ID |
| createdAt | TIMESTAMP | NOT NULL | Record creation time |
| updatedAt | TIMESTAMP | NOT NULL | Last update time |

---

### BarcodeCategories

Categories for organizing barcodes with prefixes.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PK, AUTO_INCREMENT | Unique identifier |
| name | STRING | NOT NULL | Category name |
| prefix | STRING(2) | NOT NULL, UNIQUE | 2-character prefix for barcode generation |
| createdAt | TIMESTAMP | NOT NULL | Record creation time |
| updatedAt | TIMESTAMP | NOT NULL | Last update time |

---

### Barcodes

Auto-generated barcodes for tracking physical items.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PK, AUTO_INCREMENT | Unique identifier |
| barcode | STRING | NOT NULL, UNIQUE | Generated barcode value (prefix + hex sequence) |
| barcodeCategoryID | INTEGER | FK → BarcodeCategories | Category reference |
| createdAt | TIMESTAMP | NOT NULL | Record creation time |
| updatedAt | TIMESTAMP | NOT NULL | Last update time |

**Barcode Format:** `{prefix}{hexadecimal_sequence}` (e.g., `BX0001A3`)

---

### PartCategories

Categories for organizing parts.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PK, AUTO_INCREMENT | Unique identifier |
| name | STRING | NOT NULL | Category name |
| createdAt | TIMESTAMP | NOT NULL | Record creation time |
| updatedAt | TIMESTAMP | NOT NULL | Last update time |

---

### Parts

Components and products in inventory.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PK, AUTO_INCREMENT | Unique identifier |
| name | STRING(16) | NOT NULL, UNIQUE | Part name |
| description | STRING(62) | | Part description |
| internalPart | BOOLEAN | NOT NULL | Is this an internal part? |
| vendor | STRING | NOT NULL | Vendor/supplier name |
| sku | STRING | | Vendor SKU |
| link | STRING | | Product URL |
| activeFlag | BOOLEAN | NOT NULL, DEFAULT true | Is part active? |
| minimumOrderQuantity | INTEGER | NOT NULL | Minimum order quantity |
| partCategoryID | INTEGER | NOT NULL, FK → PartCategories | Category reference |
| createdAt | TIMESTAMP | NOT NULL | Record creation time |
| updatedAt | TIMESTAMP | NOT NULL | Last update time |

---

### Locations

Physical storage locations (hierarchical).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PK, AUTO_INCREMENT | Unique identifier |
| name | STRING | NOT NULL | Location name |
| description | STRING | | Location description |
| barcodeID | INTEGER | NOT NULL, FK → Barcodes | Barcode reference |
| parentLocationID | INTEGER | FK → Locations (self) | Parent location (null = root) |
| activeFlag | BOOLEAN | NOT NULL, DEFAULT true | Is location active? |
| createdAt | TIMESTAMP | NOT NULL | Record creation time |
| updatedAt | TIMESTAMP | NOT NULL | Last update time |

---

### Boxes

Physical containers stored within locations.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PK, AUTO_INCREMENT | Unique identifier |
| name | STRING | NOT NULL | Box name |
| description | STRING | | Box description |
| barcodeID | INTEGER | NOT NULL, FK → Barcodes | Barcode reference |
| locationID | INTEGER | FK → Locations | Current location |
| activeFlag | BOOLEAN | NOT NULL, DEFAULT true | Is box active? |
| createdAt | TIMESTAMP | NOT NULL | Record creation time |
| updatedAt | TIMESTAMP | NOT NULL | Last update time |

---

### Traces

Tracks part quantities at specific locations/boxes.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PK, AUTO_INCREMENT | Unique identifier |
| partID | INTEGER | NOT NULL, FK → Parts | Part reference |
| boxID | INTEGER | FK → Boxes | Box reference (if in box) |
| locationID | INTEGER | FK → Locations | Location reference |
| quantity | INTEGER | NOT NULL | Quantity at location |
| orderItemID | INTEGER | FK → OrderItems | Linked order item |
| createdAt | TIMESTAMP | NOT NULL | Record creation time |
| updatedAt | TIMESTAMP | NOT NULL | Last update time |

---

### OrderStatuses

Order status workflow definitions.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PK, AUTO_INCREMENT | Unique identifier |
| name | STRING | NOT NULL | Status name |
| color | STRING | | Display color (hex) |
| sortOrder | INTEGER | | Display order |
| createdAt | TIMESTAMP | NOT NULL | Record creation time |
| updatedAt | TIMESTAMP | NOT NULL | Last update time |

**Default Statuses:** Pending, Ordered, Shipped, Received, Cancelled

---

### OrderLineTypes

Types of order line items.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PK, AUTO_INCREMENT | Unique identifier |
| name | STRING | NOT NULL | Type name |
| createdAt | TIMESTAMP | NOT NULL | Record creation time |
| updatedAt | TIMESTAMP | NOT NULL | Last update time |

---

### Orders

Purchase orders.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PK, AUTO_INCREMENT | Unique identifier |
| description | TEXT | | Order description |
| vendor | STRING | | Vendor name |
| trackingNumber | STRING | | Shipping tracking number |
| link | STRING | | Order/tracking URL |
| notes | TEXT | | Additional notes |
| placedDate | DATE | | Date order was placed |
| receivedDate | DATE | | Date order was received |
| orderStatusID | INTEGER | NOT NULL, FK → OrderStatuses, DEFAULT 1 | Status reference |
| activeFlag | BOOLEAN | NOT NULL, DEFAULT true | Is order active? |
| createdAt | TIMESTAMP | NOT NULL | Record creation time |
| updatedAt | TIMESTAMP | NOT NULL | Last update time |

---

### OrderItems

Line items within orders.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PK, AUTO_INCREMENT | Unique identifier |
| orderID | INTEGER | NOT NULL, FK → Orders | Order reference |
| partID | INTEGER | FK → Parts | Part reference |
| quantity | INTEGER | | Quantity ordered |
| unitPrice | DECIMAL(10,2) | | Price per unit |
| orderLineTypeID | INTEGER | FK → OrderLineTypes | Line type reference |
| createdAt | TIMESTAMP | NOT NULL | Record creation time |
| updatedAt | TIMESTAMP | NOT NULL | Last update time |

---

### Projects

Project definitions.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PK, AUTO_INCREMENT | Unique identifier |
| name | STRING | NOT NULL | Project name |
| description | TEXT | | Project description |
| color | STRING | | Display color (hex) |
| parentProjectID | INTEGER | FK → Projects (self) | Parent project |
| ownerID | INTEGER | FK → Users | Project owner |
| activeFlag | BOOLEAN | NOT NULL, DEFAULT true | Is project active? |
| createdAt | TIMESTAMP | NOT NULL | Record creation time |
| updatedAt | TIMESTAMP | NOT NULL | Last update time |

---

### Tasks

Tasks within projects.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PK, AUTO_INCREMENT | Unique identifier |
| title | STRING | NOT NULL | Task title |
| description | TEXT | | Task description |
| status | STRING | | Task status |
| dueDate | DATE | | Due date |
| projectID | INTEGER | FK → Projects | Project reference |
| assigneeID | INTEGER | FK → Users | Assigned user |
| parentTaskID | INTEGER | FK → Tasks (self) | Parent task (subtask) |
| sortOrder | INTEGER | | Display order |
| createdAt | TIMESTAMP | NOT NULL | Record creation time |
| updatedAt | TIMESTAMP | NOT NULL | Last update time |

---

### TaskLists

Collections of tasks.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PK, AUTO_INCREMENT | Unique identifier |
| name | STRING | NOT NULL | List name |
| projectID | INTEGER | FK → Projects | Project reference |
| createdAt | TIMESTAMP | NOT NULL | Record creation time |
| updatedAt | TIMESTAMP | NOT NULL | Last update time |

---

### TaskHistories

Audit trail for task changes.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PK, AUTO_INCREMENT | Unique identifier |
| taskID | INTEGER | NOT NULL, FK → Tasks | Task reference |
| userID | INTEGER | FK → Users | User who made change |
| action | STRING | NOT NULL | Action performed |
| oldValue | TEXT | | Previous value |
| newValue | TEXT | | New value |
| createdAt | TIMESTAMP | NOT NULL | Record creation time |
| updatedAt | TIMESTAMP | NOT NULL | Last update time |

---

## Migrations

Migrations are located in `backend/migrations/`. Run them using:

```bash
# Inside the backend container
sequelize db:migrate          # Run all pending migrations
sequelize db:migrate:undo     # Undo last migration
sequelize db:migrate:undo:all # Undo all migrations
```

## Seeders

Seeders are located in `backend/seeders/`. Run them using:

```bash
# Inside the backend container
sequelize db:seed:all         # Run all seeders
sequelize db:seed:undo:all    # Undo all seeders
```

### Default Seeded Data

- **User:** admin@admin.com
- **Barcode Categories:** Box (BX), Location (LC), Part (PT)
- **Part Categories:** Electronics, Hardware, Consumables
- **Order Statuses:** Pending, Ordered, Shipped, Received, Cancelled
- **Order Line Types:** Standard, Shipping, Tax, Note
- Sample parts, boxes, locations, and orders

---

## Indexes

The following indexes are automatically created:

- Primary keys on all `id` columns
- Unique indexes on `Users.email`, `Users.googleId`
- Unique indexes on `Parts.name`, `Barcodes.barcode`
- Foreign key indexes on all FK columns

---

## Cascading Deletes

The following cascading deletes are configured:

- Deleting a **Part** → Deletes associated **Traces**
- Deleting a **Order** → Deletes associated **OrderItems**
- Deleting a **OrderStatus** → Cascades to **Orders**
- Deleting a **PartCategory** → Cascades to **Parts**
