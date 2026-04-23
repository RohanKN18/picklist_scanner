# Picklist Scanner

A warehouse barcode scanning system built for real-world picklist operations. Upload an Excel picklist, scan barcodes in real time, track progress with a live dashboard, and export a full audit report.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | Node.js + Express 5 |
| Templating | EJS + express-ejs-layouts |
| Database | MongoDB + Mongoose |
| Auth | Passport.js (local strategy) |
| File parsing | Python 3 + pandas |
| Excel export | ExcelJS |
| File uploads | Multer |
| Sessions | express-session + connect-mongo |

---

## Folder Structure

```
picklist-scanner/
├── app.js                          # Express entry point, passport setup, route registration
├── package.json
├── .env                            # Your environment variables (never commit this)
├── .env.example                    # Template — copy to .env
│
├── routes/
│   ├── auth.js                     # Register, login, logout
│   ├── picklist.js                 # Upload, scan dashboard, scan API, reset, export
│   ├── history.js                  # Scan history per user
│   ├── codemap.js                  # Code remapping (admin only)
│   └── admin.js                    # Admin panel — user management + column config
│
├── models/
│   ├── User.js                     # User schema (passport-local-mongoose, isAdmin, columnMap)
│   ├── Picklist.js                 # Picklist + items + firstRowData + columnConfig
│   ├── ScanLog.js                  # Immutable audit log of every scan event
│   └── CodeMap.js                  # Barcode → real code remapping table
│
├── middlewares/
│   └── upload.js                   # Multer config for Excel uploads
│
├── services/
│   ├── pythonService.js            # Spawns Python parser, returns { columns, rows }
│   ├── exportService.js            # Generates multi-sheet Excel report via ExcelJS
│   └── cleanupService.js           # Auto-deletes old exports on a schedule
│
├── python/
│   ├── parser.py                   # pandas-based Excel parser (handles .xlsx, .xls, .csv)
│   └── requirements.txt
│
├── views/
│   ├── layouts/
│   │   └── boilerplate.ejs         # Base HTML layout with global nav
│   ├── includes/
│   │   ├── head.ejs
│   │   └── header.ejs
│   └── pages/
│       ├── home.ejs                # Landing page
│       ├── upload.ejs              # File upload page
│       ├── scan.ejs                # Live scan dashboard
│       ├── history.ejs             # Scan history
│       ├── codemap.ejs             # Code map manager (admin only)
│       ├── login.ejs
│       ├── register.ejs
│       ├── error.ejs
│       ├── 404.ejs
│       └── admin/
│           ├── index.ejs           # Admin — all users list
│           └── colmap.ejs          # Admin — configure columns per user
│
├── public/
│   ├── css/style.css
│   └── js/
│       ├── app.js
│       └── scanner.js              # Real-time scan logic, donut ring, table render
│
├── exports/                        # Temp folder for generated Excel reports (auto-cleaned)
└── uploads/                        # Temp folder for uploaded files (deleted after parsing)
```

---

## Setup

### Prerequisites
- Node.js v18+
- Python 3.8+
- MongoDB running locally or a MongoDB Atlas URI

---

### 1. Install Node dependencies
```bash
npm install
```

### 2. Install Python dependencies
```bash
pip install -r python/requirements.txt
```

### 3. Configure environment
```bash
cp .env.example .env
```

Edit `.env`:
```env
MONGO_URI=mongodb://localhost:27017/picklist_db
SESSION_SECRET=your_secret_here
PORT=3000
```

### 4. Start MongoDB
```bash
mongod
```

### 5. Start the server
```bash
npm start        # Production
npm run dev      # Development with nodemon (if configured)
```

Visit: `http://localhost:3000`

---

### 6. Make yourself an Admin

After registering your account, open MongoDB shell or Compass and run:

```js
db.users.updateOne(
  { username: "your_username_here" },
  { $set: { isAdmin: true } }
)
```

This gives you access to the Admin panel and Code Maps.

---

## Roles & Access

| Feature | Regular User | Admin |
|---------|-------------|-------|
| Upload picklist | ✅ | ✅ |
| Scan dashboard | ✅ | ✅ |
| View own history | ✅ | ✅ |
| Export report | ✅ | ✅ |
| Configure columns for users | ❌ | ✅ |
| Manage code maps | ❌ | ✅ |
| Admin panel | ❌ | ✅ |
| Toggle admin on other users | ❌ | ✅ |

---

## Admin — Column Configuration

The admin configures **5 things** per user at `/admin/users/:id/colmap`:

| Setting | Count | Purpose |
|---------|-------|---------|
| Code column | 1 | The barcode / item code column from the Excel file |
| Quantity column | 1 | The expected quantity column |
| Major columns | Up to 2 | Shown as blue highlighted chips in the dashboard file bar and in the export |
| Minor columns | Any number | Shown as plain chips in the dashboard file bar and in the export |

Once configured, the user uploads a file and goes **straight to the scan dashboard** — no column selection step ever shown to users.

If no column config exists for a user, they see a "contact your admin" message after upload.

---

## Routes Reference

### Auth
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/auth/login` | Login page |
| POST | `/auth/login` | Authenticate |
| GET | `/auth/register` | Register page |
| POST | `/auth/register` | Create account |
| POST | `/auth/logout` | Log out |

### Picklist
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/upload` | Upload page |
| POST | `/upload` | Parse Excel and redirect to scan |
| GET | `/scan` | Live scan dashboard |
| POST | `/scan/api` | Real-time scan endpoint (JSON) |
| POST | `/picklist/reset` | Reset all scanned quantities |
| GET | `/picklist/export` | Download Excel report |
| GET | `/demo` | Load a demo picklist |

### Admin
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/admin` | All users list |
| GET | `/admin/users/:id/colmap` | Column config form for a user |
| POST | `/admin/users/:id/colmap` | Save column config for a user |
| POST | `/admin/users/:id/toggle-admin` | Grant or revoke admin role |

### Other
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/history` | Current user's scan history |
| GET | `/codemap` | Code map list (admin only) |
| POST | `/codemap/add` | Add a code mapping (admin only) |
| POST | `/codemap/delete/:id` | Delete a code mapping (admin only) |

---

## Scanning Logic

### Barcode format supported
Plain codes or pipe-delimited scanner strings:
```
BSNXT26BK00005
72800205253421988|BSNXT26BK00005|2|U
```
Field breakdown: `serial|code|qty|flag` — the system extracts `code` and `qty` automatically.

### Scan outcomes

| Outcome | What happened |
|---------|--------------|
| `match` | Code found, qty incremented |
| `complete` | Code fully scanned (scanned = expected) |
| `over` | Scanned more than expected — alert shown |
| `extra` | Code not in picklist at all — alert shown |
| `unscanned` | Unscan mode — qty decremented |
| `unscanned-extra` | Unscan mode — extra item qty decremented |

### Code Map resolution
Before matching, every scanned code is looked up in the CodeMap collection. If a mapping exists, the real code is used for matching. This handles scanners that emit different barcodes than what's in the picklist.

---

## Data Models

### User
```js
{
  username: String,
  displayName: String,
  isAdmin: Boolean,
  columnMap: {
    barcode:  String,   // scan col — code
    quantity: String,   // scan col — qty
    major:    [String], // up to 2 highlighted columns
    minor:    [String], // any number of plain columns
  }
}
```

### Picklist
```js
{
  userId: String,
  sessionId: String,
  fileName: String,
  items: [{
    code: String,
    expectedQty: Number,
    scannedQty: Number,
  }],
  extraScans: Map<String, Number>,
  firstRowData: Mixed,      // first row values for major+minor cols
  columnConfig: {
    major: [String],
    minor: [String],
  },
  isActive: Boolean,
}
```

### ScanLog
```js
{
  picklistId: ObjectId,
  userId: String,
  username: String,
  rawInput: String,       // original scanner string
  parsedCode: String,     // code extracted from raw
  resolvedCode: String,   // after CodeMap lookup
  isRemapped: Boolean,
  qty: Number,
  direction: Number,      // +1 scan / -1 unscan
  scanType: String,       // match | complete | over | extra | unscanned | ...
  scannedAt: Date,
}
```

### CodeMap
```js
{
  scannedCode: String,   // what the scanner emits
  realCode: String,      // what it maps to in the picklist
  addedBy: String,
  note: String,
}
```

---

## Export Report

The downloaded Excel file has 4 sheets:

| Sheet | Contents |
|-------|---------|
| Picklist Report | One row per item — Code, Expected, Scanned, Boxes, Remaining, Status, Original Scans + major cols (blue header) + minor cols (amber header) |
| Raw Scan Log | Every individual scan event with timestamp, direction, raw string, resolved code, user |
| Extra Scans | Items scanned that were not in the picklist |
| Summary | File info, column configuration with first-row values, scan performance stats, quantities, alerts |

---

## Data Flow

```
User uploads .xlsx
       ↓
Multer saves file to /uploads/
       ↓
pythonService.js spawns python/parser.py
       ↓
pandas reads file → returns { columns, rows } as JSON
       ↓
Upload file deleted from disk immediately
       ↓
Admin's column config read from User.columnMap
       ↓
firstRowData captured (major + minor values from row 1)
       ↓
Picklist created in MongoDB (items with scannedQty: 0)
       ↓
User redirected to /scan dashboard
       ↓
Each barcode scan → POST /scan/api
       ↓
MongoDB updated + ScanLog written
       ↓
JSON response → scanner.js updates UI + animates donut
       ↓
Export → ExcelJS builds report → download → file deleted
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGO_URI` | Yes | MongoDB connection string |
| `SESSION_SECRET` | Yes | Secret for signing session cookies |
| `PORT` | No | Server port (default: 3000) |

---

## Common Issues

**"Column mapping has not been configured"**
→ Admin needs to configure columns for this user at `/admin/users/:id/colmap`

**"No valid items found"**
→ The column names set by admin don't match the columns in the uploaded file. Column names are case-sensitive — admin should double-check the exact names from the file.

**Python not found**
→ Make sure Python 3 is installed and accessible in your PATH. Check `pythonService.js` for the exact command used (`python` vs `python3`).

**MongoDB connection error**
→ Ensure MongoDB is running and `MONGO_URI` in `.env` is correct.
