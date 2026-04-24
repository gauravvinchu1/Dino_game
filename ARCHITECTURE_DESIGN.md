# Architecture, Database, and API Design Document

> [!NOTE]
> This documentation provides the comprehensive technical design of the Training Management System. It is intended for software architects, backend engineers, and developers taking over the project maintenance.

---

## 1. System Architecture

**Architecture Style**: **MVC-based Client-Server Monolith** with Asynchronous Background Workers.

The application follows a modern monolithic approach separated logically into tiers:
- **Frontend Layer**: A React SPA (Single Page Application) functioning as the Client.
- **Backend API Layer**: Node.js/Express.js server handling internal routing, business logic, authorization, and data processing.
- **Database Layer**: PostgreSQL relational database holding persisted records, relations, and the email scheduling queue.
- **Background Worker Layer**: A Node `cron` service running in the background of the Express process, polling the DB queue and dispatching emails via Nodemailer.

**Component Interaction Summary**:
1. Users authenticate via Google OAuth. 
2. The Client sends RESTful HTTP requests with JWT tokens to the Express backend.
3. Express parses requests (and CSVs via Multer) and queries against PostgreSQL.
4. When a feedback event requires future action, Express queues an entry in the database.
5. The Cron job polls PostgreSQL continuously and pushes emails via Gmail SMTP when conditions are met.

**Architecture Diagram**:
```text
  [Client Browser (React SPA)]
             │
             │ (HTTPS / REST) + JWT
             ↓
  [Backend Server (Node.js/Express)] ─── (Multer) ───> [Filesystem Memory Buffer]
             │         │
             │         ├──> [Jobs: Node Cron Tracker]
             │         │             │
        (pg Pool)      │             │ (SMTP)
             │         │             ↓
             ↓         │      [External API: Gmail SMTP] ──> (End Users)
 [Database (PostgreSQL)] 
```

---

## 2. Data Flow Design

Data predominantly flows from the Client through the HTTP controllers and into the Database.

**Key Feature Flow: Training & Feedback Setup**
1. **Admin Config**: Admin uploads CSV → Backend parses XLSX → Database stores users and hierarchies.
2. **HR Config**: HR creates a `Training Program` (linking external feedback URLs).
3. **Batch Linking**: HR assigns an array of `employee_id`s to a `Training Batch`.
4. **Trigger Flow**:
   - `Batch` timestamp expires -> Employee receives email.
   - Employee submits feedback through `/employee/submit-feedback`.
   - Backend evaluates `requires_manager_feedback`. If true, an exact timestamp is computed and logged into `scheduled_emails`.
   - Cron Job evaluates `scheduled_time <= NOW()` -> Fires manager feedback email linking to the batch context.

**Data Flow Diagram (Textual)**:
```text
(Admin CSV) ──> [Upload Endpoint] ──> [XLSX Parser] ──> (Employees DB)
                                                              │
(HR Config) ──> [Batch Endpoints] ──> (Training Programs DB) ─┘
                                              │
                      ┌───────────────────────┘
                      ↓
[Cron Scheduler] <──> (Scheduled Emails Queue DB)
      │
      ↓
(Nodemailer Engine) ──> [End User Inbox] ──> [Employee/Manager Form] ──> (Feedback DB)
```

---

## 3. Database Design

**Database Type**: Relational (SQL) - PostgreSQL

**Entity Relationship Overview**:
The schema heavily relies on normalized foreign key constraints linking users to specific training milestones.

### Tables

**1. `app_users`** (Role tracking)
- `id` (UUID, PK): Primary user ID identifier
- `email` (VARCHAR, UNIQUE): Associated Google account
- `role` (VARCHAR): Enum (`admin`, `hr`, `employee`, `manager`)

**2. `employees`**
- `employee_id` (VARCHAR, PK): HR's internal identifier constraint
- `name` (VARCHAR): Full name
- `email` (VARCHAR, UNIQUE): Contact address
- `department` (VARCHAR): Organization group
- `manager_id` (VARCHAR, FK): References `managers.manager_id`

**3. `managers`**
- `manager_id` (VARCHAR, PK): Unique manager ID constraint
- `name` (VARCHAR): Full name
- `email` (VARCHAR, UNIQUE): Contact address

**4. `training_programs`**
- `id` (UUID, PK): Auto-generated unique ID
- `name` (VARCHAR): Display name of training
- `employee_form_link` (TEXT): URL for employee survey
- `manager_form_link` (TEXT): URL for manager evaluation
- `requires_manager_feedback` (BOOLEAN): Flag triggering secondary cron jobs

**5. `training_batches`**
- `id` (UUID, PK): Batch ID
- `training_id` (UUID, FK): References `training_programs.id`
- `manager_id` (VARCHAR, FK): Approving manager for the batch
- `start_date` (TIMESTAMP)
- `end_date` (TIMESTAMP)

**6. `batch_employees`** (Many-to-Many Link)
- `batch_id` (UUID, FK): References `training_batches.id`
- `employee_id` (VARCHAR, FK): References `employees.employee_id`

**7. `scheduled_emails`** (Job Queue Table)
- `id` (UUID, PK): Queue tracking ID
- `batch_id` (UUID, FK): Contextual tag
- `recipient_email` (VARCHAR): Target address
- `email_type` (VARCHAR): `initial_employee`, `initial_manager`, `reminder_manager`
- `scheduled_time` (TIMESTAMP): Expected execution clock
- `attempts` (INT): Default `0`. Prevents infinite loops.
- `status` (VARCHAR): `pending`, `sent`, `failed`

**ER Diagram (Textual)**
```text
  [managers] 1────* [employees] 
       │                   │
       │ 1                 │ *
       *                   │
[training_batches] *──* [batch_employees]
       *
       │ 1
[training_programs]
```

---

## 4. API Documentation

Base URL: `/api/v1`

### Authentication Endpoints
- **URL**: `/auth/google` | **Method**: POST
  - **Purpose**: Validates Google OAuth Identity and returns JWT.
  - **Request Body**: `{ "token": "google_oauth_jwt_string" }`
  - **Response**: `200 OK` `{ "token": "app_jwt", "role": "admin" }`

### Admin Endpoints
- **URL**: `/admin/upload-employees` | **Method**: POST
  - **Purpose**: Batch insert from CSV buffer.
  - **Request**: `multipart/form-data` attaching file `employees.csv`
  - **Auth**: Bearer Token (Role: Admin)
  - **Response**: `200 OK` `{ "message": "Uploaded 150 employees successfully", "errors": [] }`

### HR Endpoints
- **URL**: `/hr/create-training` | **Method**: POST
  - **Purpose**: Creates a template training.
  - **Request Body**: JSON `{ "name": "Security 101", "employee_form_link": "http...", "requires_manager_feedback": true }`
  - **Response**: `201 Created` `{ "training_id": "uuid-xxx" }`

- **URL**: `/hr/create-batch` | **Method**: POST
  - **Purpose**: Generates a batch context.
  - **Request Body**: JSON `{ "training_id": "uuid-xxx", "manager_id": "M101", "start_date": "2024-01-01", "end_date": "2024-01-05" }`
  - **Response**: `201 Created` `{ "batch_id": "uuid-yyy" }`

- **URL**: `/hr/assign-employee` | **Method**: POST
  - **Purpose**: Links employees to active batches.
  - **Request Body**: JSON `{ "batch_id": "uuid-yyy", "employee_ids": ["E101", "E102"] }`
  - **Response**: `200 OK` `{ "assigned_count": 2, "skipped": [] }`

### Employee & Manager Interaction Endpoints
- **URL**: `/employee/submit-feedback` | **Method**: POST
  - **Purpose**: Submits completion details and triggers manager queue pipeline.
  - **Request Body**: JSON `{ "batch_id": "uuid-yyy", "employee_id": "E101", "rating": 5, "comments": "Great!" }`
  - **Response**: `201 Created` `{ "message": "Feedback recorded." }`
  
- **URL**: `/manager/submit-feedback` | **Method**: POST
  - **Purpose**: Submits final performance ratings.
  - **Request Body**: JSON `{ "batch_id": "uuid-yyy", "employee_id": "E101", "performance_rating": 4 }`
  - **Response**: `201 Created` `{ "message": "Evaluation recorded." }`

---

## 5. Integration Points

1. **Google OAuth API (SSO)**
   - **Data Format**: JWT / JSON
   - **Failure Strategy**: Deny access. Fallback to session expiration prompt.
2. **Gmail SMTP / Nodemailer**
   - **Data Format**: MIME encoded HTML payloads via TLS (Port 465/587).
   - **Failure Strategy**: Express handles rejection asynchronously. The `scheduled_emails.attempts` integer increments by +1. After `max_attempts` (2), the status switches to `failed` to prevent account bans from Gmail's brute-force trackers.

---

## 6. Scalability & Performance Considerations

- **CSV Memory Bottlenecks**: `Multer` buffers the entire CSV into RAM.
  - *Mitigation*: Cap file sizes at 5MB using Multer middleware configurations. 
- **Database Connection Contention**: Rapid HR batch assignments cause massive insertion spikes.
  - *Mitigation*: Ensure `pg.Pool` connection size is optimized (min 10 max 50). Use `pg-format` for single-query bulk inserts (`INSERT INTO ... VALUES (...) (...)`).
- **Cron Polling**: Querying the entire job table every minute via `node-cron` consumes continuous compute.
  - *Mitigation*: Ensure an INDEX is present on `scheduled_time` and `status='pending'` columns to guarantee rapid B-Tree lookups.

---

## 7. Security Design

- **Authentication & Authorization**: Handled via Google OAuth verification verifying registered domain origins. Custom middleware applies role-based guards.
- **SQL Injection Prevention**: Forced reliance on `pg` parameterized queries (`$1, $2`) for all queries, neutralizing injection.
- **Data Protection**: `JWT_SECRET` keys kept aggressively out of source code via `.env`. Database uses enforced SSL connections inside internal networks (`ssl: { rejectUnauthorized: false }`).
- **Rate-Limiting & Email SPAM Protection**: Capped at `attempts < 2` maximum to prevent infinite failure loops triggering AWS SES or Gmail blocks.

> [!WARNING]
> Due to the inclusion of external URL links dynamically populated by end-users (Google Forms), strict URL sanitization mapping `http://` or `https://` schemas is critical before returning templates from `/hr/create-training` to prevent Cross Site Scripting (XSS).
