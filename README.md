# Smart Budget Application

A versatile financial planning application with features for budgeting, expense tracking, and forecasting.

## Features

- Financial Overview Dashboard: High-level view of income, expenses, and net worth.
- Spending Dashboard: Breakdown of expenses by category.
- Planning Dashboard: View and manage budgets.
- What-If Purchase Tool Forecaster: Simulate the impact of potential purchases.
- Budget Forecaster: Predict future expenses.
- Financial Planning Tool: Set and track financial goals.
- Transaction Entry Tool: Manually enter expenses with categories.
- Fixed Cost Entry Tool: Enter recurring fixed expenses.
- Income Entry Tool: Enter income sources.

## Tech Stack

- Backend: Python with FastAPI
- Frontend: React
- Database: SQLite
- Forecasting: Scikit-learn for ML-based predictions

## Setup

### Prerequisites
- Docker and Docker Compose

### Running with Docker

1. Build and run the services: `docker-compose up --build`
2. Access the app at http://localhost:3001
3. API docs at http://localhost:8001/docs

### Manual Setup (Alternative)

#### Prerequisites
- Python 3.11+
- Node.js 16+ and npm

#### Backend

1. Install Python dependencies: `pip install -r requirements.txt`
2. Initialize database: `python init_db.py`
3. Run server: `uvicorn app.main:app`

#### Frontend

1. Install Node.js from https://nodejs.org
2. Install dependencies: `npm install`
3. Run app: `npm start`

## Usage

- Access the app at http://localhost:3001
- Use the navigation to access different tools and dashboards.