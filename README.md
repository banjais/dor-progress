# DoR Progress Report Dashboard

A comprehensive dashboard for tracking Department of Roads (Nepal) infrastructure projects with real-time data, multi-language support, and comprehensive reporting.

## Features

- **Real-time Progress Tracking**: Monitor infrastructure projects with live data
- **Multi-language Support**: English and Nepali interfaces with dynamic translation
- **PDF Reporting**: Generate and manage historical PDF snapshots
- **Data Visualization**: Charts, cards, and table views
- **Offline Support**: Service worker caching for offline access
- **Authentication**: Firebase App Check for API security
- **KV-based Snapshots**: Historical data versioning with Cloudflare KV

## Architecture

- **Frontend**: Vanilla JavaScript, Vite build system
- **Backend**: Cloudflare Workers (TypeScript)
- **Database**: IndexedDB (local), Cloudflare KV (remote snapshots)
- **Authentication**: Firebase App Check
- **Translation**: Gemini AI with local dictionary fallback

## Quick Start

### Development
`ash
# Install dependencies
npm install

# Start dev server
npm run dev

# Start worker in dev mode
npm run dev:worker

# Run both concurrently
npm run dev:all
`

### Build
`ash
npm run build
`

### Deploy
`ash
npm run deploy
`

## PDF Snapshot System

### Overview
The KV-based snapshot system captures PDF snapshots of report data with date-based versioning, enabling historical tracking and rollback capabilities.

### API Endpoints

All snapshot endpoints require X-Admin-Secret header for authentication.

#### Create Snapshot
`
POST /api/snapshot
Body: { records: [], meta: { lastUpdate, total } }
`

#### List Snapshots
`
GET /api/snapshots
Returns: { snapshots: [{ date, recordCount, checksum, createdAt, bsDate }] }
`

#### Download Snapshot
`
GET /api/snapshot?date=YYYY-MM-DD
Returns: PDF file
`

#### Delete Snapshot
`
DELETE /api/snapshot?date=YYYY-MM-DD
`

### Frontend Integration

Access snapshot management from the Settings panel:
- Create snapshots manually
- List all historical snapshots
- Download PDF versions
- Delete old snapshots

### Storage

- **KV Namespace**: REPORTS_KV
- **Keys**:
  - snapshot:pdf:YYYY-MM-DD - PDF binary
  - snapshot:meta:YYYY-MM-DD - JSON metadata
  - snapshot:list - All snapshots array
- **Retention**: Last 30 snapshots (configurable)

### Configuration

- SNAPSHOT_RETENTION_COUNT in index.ts (default: 30)

## Environment Variables

Create .dev.vars file:

`
# Cloudflare

# Firebase
FIREBASE_API_KEY=your-key
FIREBASE_AUTH_DOMAIN=your-domain
FIREBASE_PROJECT_ID=your-project

# Google Sheets
PUBLISHED_SHEET_ID=your-sheet-id

# Optional
GOOGLE_GENAI_API_KEY=your-gemini-key
UPSTASH_REDIS_REST_URL=your-redis-url
UPSTASH_REDIS_REST_TOKEN=your-redis-token
`

## Scripts

- 
pm run sync-sheets - Sync translations from Google Sheets
- 
pm run build - Build frontend and worker
- 
pm run deploy - Deploy to production
- 
pm run lint - Type check

## Historical Snapshots (Technical Details)

The snapshot system utilizes Cloudflare KV to store point-in-time versions of the road network status.

### Data Lifecycle
1. **Capture**: Triggered manually via `AdminManager` or automatically via a scheduled Worker task.
2. **Extraction**: The Gemini AI processes the published PDF to extract structured project rows.
3. **Verification**: Data is validated against Zod schemas.
4. **Storage**: Binary PDF and JSON metadata are stored in `REPORTS_KV` with a 30-day retention policy.

### Manual Controls
Access the Snapshot Management panel in Settings to:
- **Create**: Manually force a new archive entry.
- **Download**: Retrieve historical PDF versions with Devanagari font support.
- **Maintenance**: Delete specific snapshots or trigger metadata migrations.

### Authentication
All administrative actions require a `X-Snapshot-Key`. In production, this key is validated against the environment secret; in development, a "dev-bypass" is allowed if not configured.

## License

MIT
