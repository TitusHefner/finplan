# Smart Budget App – Setup Guide

A full-stack personal finance application featuring:

- **Dashboard** with income, expenses, and net-worth overview
- **Spending & Budget** tracking with categories
- **Balance Tracker** with projection and forecasting
- **Plaid Integration** – connect real bank accounts (optional)
- **AI Chat Advisor** powered by OpenAI (optional)
- **What-If Forecaster** – simulate purchases / life events
- **Mobile-friendly** React frontend

---

## Prerequisites

| Tool | Minimum version | Download |
|------|----------------|----------|
| Python | 3.11 | https://www.python.org/downloads/ |
| Node.js | 18 | https://nodejs.org |
| npm | 9 | (bundled with Node.js) |
| Git | any | https://git-scm.com |
| Miniconda *(optional but recommended)* | any | https://docs.conda.io/en/latest/miniconda.html |

---

## 1 · Get the code

```bash
git clone <repo-url>
cd fin
```

Or unzip the archive your friend gave you and open a terminal in that folder.

---

## 2 · Configure credentials

The app works without any API keys — you can enter transactions manually.  
Optional integrations (Plaid bank sync, AI advisor) require free accounts:

```bash
cp backend/.env.example backend/.env
```

Open `backend/.env` in any text editor and fill in your own keys:

```
PLAID_CLIENT_ID=   ← from https://dashboard.plaid.com → Team Settings → Keys
PLAID_SECRET=      ← same page, pick "Sandbox" secret for testing
PLAID_ENV=sandbox  ← use "sandbox" while testing, "production" for real banks

OPENAI_API_KEY=    ← from https://platform.openai.com/api-keys
```

> **Plaid tiers**
> - `sandbox` – fake data, completely free, no bank required
> - `development` – up to 100 real bank items, free
> - `production` – real banks, requires Plaid approval

---

## 3 · Backend setup

### Option A – Conda (recommended)

```bash
conda create -n fin python=3.11 -y
conda activate fin
cd backend
pip install -r requirements.txt
python init_db.py
```

### Option B – Plain Python venv

```bash
cd backend
python -m venv venv
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt
python init_db.py
```

### Start the backend

```bash
# still inside backend/ with your env active:
uvicorn app.main:app --reload --port 5000
```

Leave this terminal open. You should see:
```
INFO:     Uvicorn running on http://127.0.0.1:5000
```

---

## 4 · Frontend setup

Open a **second terminal** at the project root:

```bash
cd frontend
npm install
```

### Start the frontend

```bash
# Windows:
set PORT=3001 && npm start

# macOS/Linux:
PORT=3001 npm start
```

Your browser will open automatically at **http://localhost:3001**.

---

## 5 · Quick-start script (Windows)

If you have Conda with an env named `fin`, you can use the included script:

```bat
start.bat
```

This opens both the backend and frontend in separate terminal windows.

To use a different conda env name, open `start.bat` and change `fin` to your env name.

---

## 6 · Docker (alternative to steps 3–5)

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
# Copy and fill in your .env first (step 2 above), then:
docker-compose up --build
```

Access the app at http://localhost:3001.

> Note: Docker compose does **not** automatically read `backend/.env` —
> add your keys to the `environment:` section in `docker-compose.yml`
> or use a Docker secrets approach for production.

---

## 7 · First run walkthrough

1. Open http://localhost:3001
2. Go to **Income Entry** and add your income sources
3. Go to **Fixed Cost Entry** and add bills / subscriptions
4. Go to **Transaction Entry** to log expenses
5. Visit **Dashboard** to see your financial overview

### Connecting a bank (Plaid)

1. Fill in Plaid keys in `backend/.env` (step 2)
2. Navigate to **Bank Connect** in the app
3. Click **Connect a Bank Account** and follow the Plaid Link flow
4. Use credentials `user_good` / `pass_good` in sandbox mode
5. Once connected, go to **Balance Tracker → Live Bank Balances** and click
   **Use as balance source** on the account you want to track

---

## 8 · Project structure

```
fin/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI application entry point
│   │   ├── models.py        # SQLAlchemy ORM models
│   │   ├── database.py      # DB connection (SQLite, stored in AppData)
│   │   ├── routes/          # API route handlers
│   │   └── services/        # AI, analytics, forecast logic
│   ├── init_db.py           # One-time DB initialisation
│   ├── migrate.py           # Safe column-addition migrations
│   ├── requirements.txt
│   └── .env.example         # ← copy to .env and fill in keys
├── frontend/
│   ├── src/
│   │   ├── App.js
│   │   ├── api.js           # Axios base config (proxies to :5000)
│   │   ├── pages/           # One file per page/feature
│   │   └── components/
│   └── package.json
├── docker-compose.yml
├── start.bat                # Windows quick-start
└── SETUP.md                 # ← you are here
```

---

## 9 · Ports

| Service | Default port | Change it in |
|---------|-------------|--------------|
| Backend (FastAPI) | 5000 | `start.bat` and `frontend/package.json` proxy |
| Frontend (React) | 3001 | `start.bat` (set PORT=3001) |

If port 5000 is taken, change it in `start.bat` **and** update the `"proxy"` value in `frontend/package.json` to match.

---

## 10 · Troubleshooting

| Symptom | Fix |
|---------|-----|
| `uvicorn: command not found` | Activate your conda/venv env before running |
| Frontend shows "Network Error" | Make sure the backend is running on port 5000 |
| Plaid Link doesn't open | Check `PLAID_CLIENT_ID` / `PLAID_SECRET` in `.env` |
| AI features return errors | Check `OPENAI_API_KEY` in `.env` |
| Database errors on first run | Run `python init_db.py` from the `backend/` folder |
| Column-not-found crash after update | Run `python migrate.py` from the `backend/` folder |

---

## 11 · Security notes

- **Never share your `.env` file.** It contains private API keys.
- The database is stored locally at `%LOCALAPPDATA%\SmartBudget\budget.db` (Windows) or `~/.local/share/SmartBudget/budget.db` (macOS/Linux).
- Plaid access tokens are stored in plain text in the local SQLite database — this is fine for personal/local use.
- This app is designed for **local use only**. Do not expose the backend port to the internet without adding authentication.

---

## License

MIT — use freely, no warranty.
