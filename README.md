# RythuBandhu

**RythuBandhu** is an agricultural incident-response platform designed to streamline communication between farmers and Agricultural Extension Officers (AEOs). In later phases, farmers will be able to submit agricultural incidents (pests, crop diseases, irrigation issues) via photo, voice, and GPS location. The backend will analyze, cluster, and prioritize these incidents to route them to local AEOs for rapid field response and advisory.

---

## Current Status: Phase 1 — Foundation Setup

This repository is currently at **Phase 1: Foundation Setup**. It establishes the core structural skeleton, configuration management, minimal white UI frontend, and FastAPI backend foundation.

> **Note**: No AI, ML models, spatial clustering, mapping, notifications, authentication, speech/vision processing, or agricultural diagnosis are included in Phase 1.

---

## Technology Stack

- **Frontend**: React + Vite + React Router DOM (Vanilla CSS, clean white UI)
- **Backend**: Python 3.11+ + FastAPI + Uvicorn
- **Database**: Supabase PostgreSQL with PostGIS capabilities
- **Version Control**: Git + GitHub

---

## Project Structure

```text
rythubandhu/
├── frontend/                # React + Vite application
│   ├── src/
│   │   ├── pages/
│   │   │   ├── FarmerPage.jsx       # Route: /farmer
│   │   │   └── AeoDashboard.jsx     # Route: /aeo
│   │   ├── services/
│   │   │   └── api.js               # FastAPI client service
│   │   ├── App.jsx                  # Main routing & layout
│   │   ├── index.css                # Clean white design system
│   │   └── main.jsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── backend/                 # Python FastAPI backend
│   ├── app/
│   │   ├── api/
│   │   │   └── v1/
│   │   │       └── health.py        # GET /api/v1/health
│   │   ├── core/
│   │   │   └── config.py            # Environment configuration
│   │   ├── database/
│   │   │   └── session.py           # Supabase client session
│   │   ├── models/                  # (Prepared for Phase 2)
│   │   ├── services/                # (Prepared for Phase 2)
│   │   └── main.py                  # FastAPI app & GET /health
│   └── requirements.txt
├── ai/                      # AI/ML modules (Reserved for Phase 3)
│   └── README.md
├── database/                # Database schemas & PostGIS scripts
│   └── README.md
├── docs/                    # Architecture and documentation
│   └── architecture.md
├── .env.example             # Example environment variables
├── .gitignore               # Multi-environment ignore rules
└── README.md
```

---

## Getting Started

### 1. Environment Configuration

Copy `.env.example` to `.env` in the root (or `backend/.env`):

```bash
cp .env.example .env
```

Update credentials when connecting to Supabase:
```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_KEY=your-supabase-key
DATABASE_URL=postgresql://postgres:password@db.your-project-id.supabase.co:5432/postgres
```

---

### 2. Backend Setup (FastAPI)

1. Navigate to the `backend` directory:
   ```bash
   cd backend
   ```

2. Create and activate a Python virtual environment:
   ```bash
   # Windows (PowerShell)
   python -m venv venv
   .\venv\Scripts\Activate.ps1

   # Linux/macOS
   python3 -m venv venv
   source venv/bin/activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Start the FastAPI development server:
   ```bash
   uvicorn app.main:app --reload --port 8000
   ```

5. Verify the health endpoint:
   - URL: `http://localhost:8000/health`
   - Expected Response: `{"status": "ok"}`

---

### 3. Frontend Setup (React + Vite)

1. Navigate to the `frontend` directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open `http://localhost:5173` in your browser.

---

## Available Routes & Endpoints

### Frontend Routes
| Route | Component | Purpose |
|---|---|---|
| `/farmer` | `FarmerPage.jsx` | Farmer incident reporting placeholder |
| `/aeo` | `AeoDashboard.jsx` | AEO incident management dashboard placeholder |

### Backend Endpoints
| Method | Endpoint | Description | Sample Response |
|---|---|---|---|
| `GET` | `/health` | Primary health check | `{"status": "ok"}` |
| `GET` | `/api/v1/health` | Versioned health check | `{"status": "ok"}` |
| `GET` | `/docs` | Interactive Swagger API documentation | Swagger UI |
