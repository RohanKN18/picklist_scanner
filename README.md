# Picklist Scanner System

A warehouse barcode scanning system built with Node.js, Express, EJS, MongoDB, and Python (pandas).

---

## Architecture

```
Upload Excel → Python parses → MongoDB stores → Scan barcodes → Real-time updates → Export Excel
```

---

## Folder Structure

```
picklist-scanner/
├── app.js                    # Express entry point
├── package.json
├── .env.example              # Copy to .env
│
├── routes/
│   ├── picklist.js           # All picklist routes
│   └── auth.js               # Auth routes
│
├── models/
│   ├── Picklist.js           # Picklist + items schema
│   └── User.js               # User schema (passport)
│
├── middlewares/
│   └── upload.js             # Multer file upload
│
├── services/
│   ├── pythonService.js      # Calls Python parser
│   └── exportService.js      # ExcelJS report generator
│
├── python/
│   ├── parser.py             # pandas Excel parser
│   └── requirements.txt
│
├── views/
│   ├── layouts/
│   │   └── boilerplate.ejs   # Base HTML layout
│   └── pages/
│       ├── home.ejs
│       ├── upload.ejs
│       ├── colmap.ejs        # Column mapping
│       ├── scan.ejs          # Scan dashboard
│       ├── error.ejs
│       └── 404.ejs
│
└── public/
    ├── css/style.css
    └── js/
        ├── main.js
        └── scanner.js        # Real-time scan logic
```

---

## Setup

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
# Edit .env with your MongoDB URI and session secret
```

### 4. Start MongoDB
```bash
mongod
```

### 5. Start the server
```bash
npm run dev      # Development (nodemon)
npm start        # Production
```

Visit: `http://localhost:3000`

---

## Routes

| Method | Route             | Description                        |
|--------|-------------------|------------------------------------|
| GET    | /                 | Home page                          |
| GET    | /upload           | Upload page                        |
| POST   | /upload           | Process Excel upload               |
| POST   | /scan/start       | Create picklist from mapped cols   |
| GET    | /scan             | Scan dashboard                     |
| POST   | /scan/api         | Real-time scan endpoint (JSON)     |
| POST   | /picklist/reset   | Reset all scanned quantities       |
| GET    | /picklist/export  | Download Excel report              |
| GET    | /demo             | Load demo picklist                 |

---

## Scanning Logic

| Scan Result       | Action                                    |
|-------------------|-------------------------------------------|
| Match found       | Increment `scannedQty`                    |
| Qty exceeds expected | Mark `OVER`, trigger alert             |
| Code not in list  | Log as `EXTRA`, trigger alert             |

---

## Data Flow

1. User uploads `.xlsx` file via Multer
2. File path sent to Python parser (`python/parser.py`)
3. pandas reads file, returns `{ columns, rows }` as JSON
4. Upload file deleted from disk immediately
5. User maps barcode + quantity columns
6. Picklist saved to MongoDB with `scannedQty: 0`
7. Each barcode scan hits `/scan/api` → updates MongoDB
8. UI refreshes via fetch (no page reload)
9. Export generates Excel via ExcelJS → download → file deleted

---

## MongoDB Schema

```js
Picklist {
  sessionId: String,
  userId: String,
  fileName: String,
  items: [{
    code: String,
    expectedQty: Number,
    scannedQty: Number (default: 0)
  }],
  extraScans: Map<String, Number>,
  isActive: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```
