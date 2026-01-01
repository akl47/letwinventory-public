# API Reference

This document describes the REST API endpoints for LetWinInventory.

## Base URL

```
http://localhost:3000/api
```

## Authentication

Most endpoints require authentication via JWT token. Include the token in the Authorization header:

```
Authorization: Bearer <token>
```

### Obtaining a Token

Authenticate via Google OAuth to receive a JWT token.

---

## Authentication Endpoints

### Google OAuth

#### Initiate Login
```http
GET /auth/google
```
Redirects to Google OAuth consent screen.

#### OAuth Callback
```http
GET /auth/google/callback
```
Handles the OAuth callback and returns a JWT token.

#### Get Current User
```http
GET /auth/google/me
```
Returns the currently authenticated user.

**Response:**
```json
{
  "id": 1,
  "email": "user@example.com",
  "name": "John Doe"
}
```

#### Logout
```http
POST /auth/google/logout
```
Invalidates the current session.

---

## Inventory Endpoints

### Parts

#### Get All Parts
```http
GET /inventory/part
```
Returns all parts in the system.

**Response:**
```json
[
  {
    "id": 1,
    "name": "Widget A",
    "description": "A standard widget",
    "internalPart": true,
    "vendor": "ACME Corp",
    "sku": "WGT-001",
    "link": "https://example.com/widget",
    "activeFlag": true,
    "minimumOrderQuantity": 10,
    "partCategoryID": 1,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
]
```

#### Create Part
```http
POST /inventory/part
```

**Request Body:**
```json
{
  "name": "Widget A",
  "description": "A standard widget",
  "internalPart": true,
  "vendor": "ACME Corp",
  "sku": "WGT-001",
  "link": "https://example.com/widget",
  "minimumOrderQuantity": 10,
  "partCategoryID": 1
}
```

#### Update Part
```http
PUT /inventory/part/:id
```

**Request Body:** Same as Create Part

#### Delete Part
```http
DELETE /inventory/part/:id
```

---

### Boxes

#### Get Box by ID
```http
GET /inventory/box/:id
```

**Response:**
```json
{
  "id": 1,
  "name": "Box A",
  "description": "Storage box",
  "barcodeID": 1,
  "locationID": 1,
  "activeFlag": true
}
```

#### Create Box
```http
POST /inventory/box
```

**Request Body:**
```json
{
  "name": "Box A",
  "description": "Storage box",
  "barcodeID": 1,
  "locationID": 1
}
```

#### Update Box
```http
PUT /inventory/box/:id
```

---

### Locations

#### Get Location Hierarchy
```http
GET /inventory/location/higherarchy
```
Returns all locations in a hierarchical tree structure.

#### Get Location by ID
```http
GET /inventory/location/:id
```

#### Create Location
```http
POST /inventory/location
```

**Request Body:**
```json
{
  "name": "Warehouse A",
  "description": "Main warehouse",
  "barcodeID": 1,
  "parentLocationID": null
}
```

#### Update Location
```http
PUT /inventory/location/:id
```

---

### Barcodes

#### Get All Barcodes
```http
GET /inventory/barcode
```

#### Get Barcode Categories
```http
GET /inventory/barcode/category
```

#### Get All Tags
```http
GET /inventory/barcode/tag
```

#### Get Tag by ID
```http
GET /inventory/barcode/tag/:id
```

#### Get Tag Chain by ID
```http
GET /inventory/barcode/tag/chain/:id
```
Returns the full chain of parent locations for a tag.

#### Display Barcode
```http
GET /inventory/barcode/display/:id
```

#### Print Barcode
```http
POST /inventory/barcode/print
```

#### Move Barcode
```http
POST /inventory/barcode/move/:id
```
Moves a barcode (box/location) to a new parent location.

#### Delete Barcode
```http
DELETE /inventory/barcode/:id
```

---

### Traces

Traces track the quantity of parts at specific locations/boxes.

#### Get Traces
```http
GET /inventory/trace
```

---

## Order Endpoints

### Orders

#### Get All Orders
```http
GET /inventory/order
```

**Response:**
```json
[
  {
    "id": 1,
    "description": "Monthly supplies",
    "vendor": "ACME Corp",
    "trackingNumber": "1Z999AA10123456784",
    "link": "https://tracking.example.com",
    "notes": "Rush order",
    "placedDate": "2024-01-15T00:00:00.000Z",
    "receivedDate": null,
    "orderStatusID": 1,
    "activeFlag": true,
    "OrderStatus": {
      "id": 1,
      "name": "Pending"
    },
    "OrderItems": [...]
  }
]
```

#### Get Order by ID
```http
GET /inventory/order/:id
```

#### Create Order
```http
POST /inventory/order
```

**Request Body:**
```json
{
  "description": "Monthly supplies",
  "vendor": "ACME Corp",
  "trackingNumber": "1Z999AA10123456784",
  "link": "https://tracking.example.com",
  "notes": "Rush order",
  "placedDate": "2024-01-15",
  "orderStatusID": 1
}
```

#### Update Order
```http
PUT /inventory/order/:id
```

#### Delete Order
```http
DELETE /inventory/order/:id
```

---

### Order Items

#### Get Order Items by Order ID
```http
GET /inventory/orderitem/order/:orderID
```

#### Create Order Item
```http
POST /inventory/orderitem
```

**Request Body:**
```json
{
  "orderID": 1,
  "partID": 1,
  "quantity": 10,
  "unitPrice": 5.99,
  "orderLineTypeID": 1
}
```

#### Update Order Item
```http
PUT /inventory/orderitem/:id
```

#### Delete Order Item
```http
DELETE /inventory/orderitem/:id
```

---

## Planning Endpoints

### Projects

#### Get All Projects
```http
GET /planning/project
```

#### Get Top Level Projects
```http
GET /planning/project/top
```
Returns projects without a parent project.

#### Get Project by ID
```http
GET /planning/project/:id
```

#### Create Project
```http
POST /planning/project
```

**Request Body:**
```json
{
  "name": "Website Redesign",
  "description": "Complete website overhaul",
  "color": "#3498db",
  "parentProjectID": null
}
```

#### Update Project
```http
PUT /planning/project/:id
```

#### Delete Project
```http
DELETE /planning/project/:id
```

---

### Tasks

#### Get All Tasks
```http
GET /planning/task
```

#### Get Task by ID
```http
GET /planning/task/:id
```

#### Create Task
```http
POST /planning/task
```

**Request Body:**
```json
{
  "title": "Design mockups",
  "description": "Create initial design mockups",
  "status": "pending",
  "dueDate": "2024-02-01",
  "projectID": 1,
  "assigneeID": 1,
  "parentTaskID": null
}
```

#### Update Task
```http
PUT /planning/task/:id
```

#### Delete Task
```http
DELETE /planning/task/:id
```

#### Move Task
```http
PUT /planning/task/:taskId/move
```
Moves a task to a different parent or position.

---

### Task Lists

#### Get All Task Lists
```http
GET /planning/tasklist
```

#### Create Task List
```http
POST /planning/tasklist
```

---

### Task History

#### Get Task History
```http
GET /planning/taskhistory
```

#### Create Task History Entry
```http
POST /planning/taskhistory
```

---

## Error Responses

All endpoints return errors in the following format:

```json
{
  "error": {
    "status": 400,
    "message": "Validation error message"
  }
}
```

### Common Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Missing or invalid token |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource doesn't exist |
| 500 | Internal Server Error |

---

## Request Validation

The API validates request bodies for the following endpoints:

### Part Validation
- `name` (string, required): Max 16 characters
- `description` (string, optional): Max 62 characters
- `internalPart` (boolean, required)
- `vendor` (string, required)
- `minimumOrderQuantity` (integer, required)
- `partCategoryID` (integer, required)

### Box Validation
- `name` (string, required)
- `description` (string, optional)
- `barcodeID` (integer, required)
- `locationID` (integer, optional)

### Location Validation
- `name` (string, required)
- `description` (string, optional)
- `barcodeID` (integer, required)
- `parentLocationID` (integer, optional)

### Order Validation
- `description` (string, optional)
- `vendor` (string, optional)
- `orderStatusID` (integer, required)
