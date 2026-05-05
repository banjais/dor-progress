# Snapshot Management Agent

## Purpose
Manages PDF snapshot creation, listing, download, and deletion for DoR Progress Reports.

## Commands

### Create Snapshot
`ash
# Trigger via UI: Settings -> PDF Snapshots -> Create Snapshot Now
# Or programmatically:
await fetch(WORKER_BASE + "/api/snapshot", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Admin-Secret": adminKey
  },
  body: JSON.stringify({
    records: store.rows || [],
    meta: { lastUpdate: store.lastUpdate, total: store.rows?.length || 0 }
  })
});
`

### List Snapshots
`ash
GET /api/snapshots
Headers: { "X-Admin-Secret": adminKey }
`

### Download Snapshot
`ash
GET /api/snapshot?date=YYYY-MM-DD
Headers: { "X-Admin-Secret": adminKey }
`

### Delete Snapshot
`ash
DELETE /api/snapshot?date=YYYY-MM-DD
Headers: { "X-Admin-Secret": adminKey }
`

## Configuration

- SNAPSHOT_RETENTION_COUNT: Number of snapshots to keep (default: 30)
- ADMIN_SECRET: Secret key for authentication

## Storage

- KV namespace: TRANSLATION_KV
- Key pattern: snapshot:pdf:YYYY-MM-DD, snapshot:meta:YYYY-MM-DD, snapshot:list

## UI Location

Settings panel -> PDF Snapshots section
- Create Snapshot Now button
- List Available Snapshots button
- Download/Delete actions per snapshot
