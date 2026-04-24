# Training Management System - Technical Documentation

> [!NOTE]
> This documentation is intended for developers taking over development, maintenance, and deployment of the Training Management System.

## 1. System Overview

**Project Name**: Training Management System  
**Project Type**: Web Application  
**Tech Stack**: 
- **Frontend**: React.js
- **Backend**: Node.js, Express.js
- **Database**: PostgreSQL
- **Additional Tools**: Google OAuth for Auth, Nodemailer for Emails, Node Cron for Job Scheduling, Multer for CSV uploads, XLSX for parsing

**Purpose of the System**:  
The Training Management System is a full-stack application designed to automate and streamline employee training workflows for HR departments. It manages employee/manager records, training programs, batch assignments, and automated collection of feedback from both employees and their managers through scheduled email delivery.

**Core Functionalities**:
- Bulk CSV data upload for employees and managers.
- Creation of training programs and assignment of employee batches.
- Automated scheduling and sending of email feedback forms.
- Data collection from employees and managers regarding training performance.
- Role-based dashboard (Admin, HR, Employee, Manager) with analytics and reporting.

**Target Users**:
- **Admin**: Configures the system and bulk uploads hierarchy data.
- **HR**: Creates trainings, assigns batches, and reviews performance reports.
- **Employees**: Participate in trainings and submit initial feedback.
- **Managers**: Evaluate employee performance post-training.

---

## 2. Architecture Overview

The system uses a traditional **Client-Server Architecture** with scheduled background jobs.

**Component Interaction**:
1. **Frontend (React)**: Interacts with the backend via REST APIs. Authorized via Google OAuth & JWT.
2. **Backend API (Express.js)**: Handles business logic, CSV parsing, and database transactions.
3. **Database (PostgreSQL)**: Serves as the central repository for users, hierarchies, trainings, batches, and feedback.
4. **Cron Scheduler**: Runs continuously on the server, polling the database for pending emails and triggering Nodemailer.

**Architecture Diagram**
```mermaid
graph TD
    UI[Frontend: React] -->|HTTPS / REST| API[Backend: Express.js]
    API -->|Read/Write| DB[(PostgreSQL)]
    
    Multer[CSV Upload/Multer] -->|Parse| API
    
    Cron[Background Jobs: Node Cron] -->|Polls| DB
    Cron -->|Triggers| Nodemailer[Email Service]
    Nodemailer -->|SMTP| Gmail(Users' Gmail)
```

---

## 3. Project Structure

```
training_management/
├── frontend/                 # React UI application
│   ├── src/
│   │   ├── components/       # Reusable UI widgets
│   │   └── pages/            # View components (AdminUpload, CreateTraining, etc.)
│   └── package.json          
├── backend/                  # Node.js/Express API server
│   ├── controllers/          # Business logic handlers (hrController, etc.)
│   ├── routes/               # Express route definitions
│   ├── middlewares/          # Auth and upload middlewares
│   ├── services/             # Email services and 3rd party integrations
│   ├── jobs/                 # Cron jobs and schedulers (Scheduler.js)
│   ├── uploads/              # Temporary storage for Multer CSVs
│   ├── server.js             # Application entry point
│   └── db.js                 # PostgreSQL connection setup
└── database/
    └── postgreSQL.sql        # Database schema definitions and views
```

**Key Directories**:
- `backend/controllers`: Contains the core logic separated by role (`adminController`, `hrController`, etc.).
- `backend/jobs`: Contains the periodic scheduling logic that tracks when feedback emails must be sent.

---

## 4. Module Breakdown

### User Management & Admin Module
- **Logic**: Handles parsing CSV files with Multer and XLSX. Validates structures (`employee_id`, `name`, `email`, `manager_id`).
- **Data flow**: Ingests bulk records and inserts them into PostgreSQL via batch operations. Prevents duplication.

### HR Management Module
- **Logic**: Orchestrates the core business flows. HR creates a `Training Program` (linking external feedback forms) and creates a `Batch`. HR then maps employees to the batch.
- **Data flow**: Maintains the many-to-many relationship in `batch_employees`.

### Feedback & Email Module
- **Logic**: Triggered dynamically when a batch ends or when an employee completes their feedback.
- **Workflow**:
  1. Employee submits feedback.
  2. If manager feedback is required, a record is inserted into `scheduled_emails`.
  3. `jobs/Scheduler.js` polls every minute (`* * * * *`) for records where `scheduled_time <= NOW()`.
  4. Emails sent dynamically using HTML templates and tracked (maximum attempt retries: 2).

---

## 5. Database Design

**Primary Entities & Relationships**:

- `app_users`: RBAC identity (roles).
- `employees` & `managers`: Tracks organizational hierarchy setup by the Admin. `managers_id` acts as a foreign key on the `employees` table.
- `training_programs`: Template for trainings (includes config, form links, delay rules).
- `training_batches`: Specific instances of a training bound by start and end dates.
- `batch_employees`: Junction table linking employees to batches.
- `employee_feedback` & `manager_feedback`: Form submission data.
- `scheduled_emails`: Email job queue tracking trigger times and success states.

> [!CAUTION]
> Avoid dropping the `scheduled_emails` table without flushing queue jobs to prevent silent missed email deliveries. 

---

## 6. API Documentation

### Key Endpoints

| Method | Endpoint | Authorization | Description |
|--------|----------|---------------|-------------|
| POST | `/admin/upload-employees` | Admin | Parses CSV file payload (`multipart/form-data`) and creates users |
| POST | `/hr/create-training` | HR | Registers a new training curriculum |
| POST | `/hr/create-batch` | HR | Instantiates a batch attached to a manager |
| POST | `/hr/assign-employee` | HR | Bulk assigns employee arrays to `batch_id` |
| POST | `/employee/submit-feedback`| Employee | Logs employee ratings and initiates manager email trigger if configured |
| POST | `/manager/submit-feedback` | Manager | Logs performance review against employee batch instance |
| GET | `/hr/training-report/:id` | HR | Returns joined feedback metrics and completion stats |

*Note: All endpoints require JWT Bearer authorization passed in headers unless explicitly handled in `authRoutes`.*

---

## 7. Setup and Configuration

### Prerequisites
- Node.js (v16+)
- PostgreSQL (v12+)
- Gmail App Password for NodeMailer configuration

### Step-by-Step Installation

1. **Database Setup**
```bash
psql -U postgres -c "CREATE DATABASE training_db;"
psql -U postgres -d training_db -f database/postgreSQL.sql
```

2. **Backend Setup**
```bash
cd backend
npm install
```
Create a `.env` file in the `backend/` directory:
```env
DB_URL=postgresql://user:pass@localhost/training_db
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
JWT_SECRET=your-secure-jwt-secret
EMAIL_USER=your_sending_account@gmail.com
EMAIL_PASS=your_gmail_app_password
```

3. **Frontend Setup**
```bash
cd frontend
npm install
```
Configure frontend `.env_target` to point `REACT_APP_API_URL` to `http://localhost:5000`.

4. **Running Application**
- Backend: `npm start` (Runs on port 5000)
- Frontend: `npm start` (Runs on port 3000)

---

## 8. Code Explanation

### The Email Scheduler (`backend/jobs/Scheduler.js`)
This is the heart of the automated feedback workflow.
- **Workflow**: `node-cron` evaluates a loop every minute. It runs `SELECT * FROM scheduled_emails WHERE scheduled_time <= NOW() AND attempts < 2`.
- **Handling Emails**: Passes queried data to `services/emailService.js` to parse Google Form links specific to the `training_program`. Success deletes or flags the job row; failure increments the `attempt` count to prevent infinite loop errors.

### Bulk Importer (`backend/controllers/adminController.js`)
- Exposes `uploadEmployees()`. Wraps `Multer` buffers into `xlsx.read`.
- Includes duplicate catching by first polling `SELECT email FROM employees`. 
- Leverages SQL bulk inserts mapping values: `INSERT INTO employees (id, name, email, manager_id) VALUES ...`. Generates response logs containing insertion counts.

---

## 9. Error Handling and Edge Cases

- **Duplicate Batch Assignment**: `assignEmployee` protects against unique database constraints. A failed constraint returns skipped members safely without crashing the transaction.
- **Failed Scheduled Emails**: Controlled by the `attempts` integer column. If rate limits are breached or SMTP rejects the request, the job pauses and queues for the next minute interval until it aborts at `max_attempts`.
- **Invalid CSV formatting**: Throws a graceful error to the frontend if columns `employee_id`, `name`, `email`, and `department` are missing or improperly cased.

**Known Issues to Watch**:
- Current bugs document `hrController.js` querying a non-existent `position` column.
- Table schema mismatch where code uses `batches` but database declares `training_batches`. (See `FIXES.md` if available).

---

## 10. Performance and Limitations

- **System Constraints**: The current CSV parser (`xlsx`) stores the entire file buffer in RAM. Uploads larger than 20MB may pause the Node Event Loop. 
- **Cron Jobs**: Polling the database every minute across thousands of pending emails could create bottleneck contention.
- **Rate Limiting**: Gmail App limits restrict outbound traffic (usually around 500 emails/day). High volume enterprise usage requires migrating Nodemailer to services like AWS SES or SendGrid.

---

## 11. Future Enhancements

1. **Email Provider Migration**: Swap raw Gmail SMTP with SendGrid/AWS SES.
2. **Streaming CSV Parser**: Implement a stream-based parser (like `csv-parser`) instead of buffering entirely in memory to support files exceeding 100K rows.
3. **Queueing System**: Move the DB-polled Cron methodology to **Redis/BullMQ** for distributed, reliable job processing.
4. **Automated Reminders**: Expand scheduling capabilities to notify stragglers dynamically based on relative feedback lag times rather than fixed intervals.

---

## 12. Maintenance Guidelines

- **Extending the DB**: Always generate incremental SQL diffs. Modify the codebase model schemas synchronously when adjusting columns.
- **Debugging Emails**: Check the `scheduled_emails` table. If jobs appear stalled, cross-reference SMTP logs and ensure the worker thread inside `server.js` hasn't crashed.
- **Dependency Upgrades**: React and Express upgrades should be tested end-to-end to verify multipart form data (Multer compatibility) hasn't broken file buffers.
- **Code Style**: Stick to Promises and `async/await` inside Express route handlers, wrapped inside `try/catch` to bubble internal server errors globally via the Error Middleware.
