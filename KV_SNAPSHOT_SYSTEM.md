# KV-Based PDF Snapshot System for DoR Progress Reports

## Overview
Enhanced KV-based snapshot system that captures PDF snapshots of DoR progress report data with date-based versioning, enabling historical tracking and rollback capabilities.

## System Components

### 1. Backend (index.ts)

#### New API Endpoints (Worker)
All snapshot endpoints require X-Admin-Secret header for authentication.

GET /api/snapshots
- Lists all available PDF snapshots with metadata
- Returns: { snapshots: [{ date, recordCount, checksum, createdAt, bsDate }] }

GET /api/snapshot?date=YYYY-MM-DD
- Retrieves a specific PDF snapshot by date
- Returns: PDF file (application/pdf)

POST /api/snapshot
- Creates a new PDF snapshot from current data
- Body: { records: [], meta: { lastUpdate, total } }
- Returns: { success: true, metadata }

DELETE /api/snapshot?date=YYYY-MM-DD
- Deletes a snapshot by date
- Returns: { success: true, deleted: date }

#### Key Features
- Server-side PDF Generation: Uses pdf-lib to create branded PDFs with DoR styling
- Nepali/Bikram Sambat Date Support: Displays dates in BS format
- Automatic Retention Policy: Keeps last 30 snapshots (configurable)
- Metadata Storage: Stores checksum, record count, and creation timestamp
- KV Storage: PDFs stored in TRANSLATION_KV

### 2. Frontend (src/main.js)

#### Settings Panel Integration
New PDF Snapshots section in settings modal with:
- Create Snapshot Now: Manually trigger snapshot creation
- List Available Snapshots: View all historical snapshots with metadata
- Download/Delete Actions: Per-snapshot operations

#### New Functions
- createSnapshotManual(): Creates snapshot from current data
- listSnapshots(): Fetches and displays snapshot list
- downloadSnapshot(date): Downloads specific snapshot PDF
- deleteSnapshot(date): Deletes snapshot with confirmation

## Use Cases

1. Historical Tracking: Monitor progress changes over time
2. Data Recovery: Restore previous state if data corrupted
3. Offline Access: Download PDFs for offline review
4. Version Control: Track exact data state at specific dates

## KV Storage Structure

snapshot:pdf:YYYY-MM-DD -> PDF binary (Uint8Array)
snapshot:meta:YYYY-MM-DD -> JSON metadata
snapshot:list -> Array of all snapshot metadata

## Configuration

SNAPSHOT_RETENTION_COUNT = 30 (in index.ts)
ADMIN_SECRET (in .dev.vars)

## API Examples

Create Snapshot:
curl -X POST https://your-worker.workers.dev/api/snapshot \
  -H "X-Admin-Secret: your-secret" \
  -H "Content-Type: application/json" \
  -d {"records": [...], "meta": {...}}

List Snapshots:
curl https://your-worker.workers.dev/api/snapshots \
  -H "X-Admin-Secret: your-secret"

## Security

All endpoints require admin secret. Secrets compared using timing-safe comparison.
