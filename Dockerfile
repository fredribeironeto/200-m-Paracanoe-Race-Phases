# Use an official lightweight Python image
FROM python:3.11-slim

# Set working directory to /app
WORKDIR /app

# Install system dependencies (gcc and python3-dev for C extensions needed by scientific packages)
RUN apt-get update && apt-get install -y --no-install-recommends gcc python3-dev && rm -rf /var/lib/apt/lists/*

# Copy backend requirements first to leverage Docker cache
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy all application source code (backend and frontend)
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Set working directory to backend so analyzer.py imports resolve correctly
WORKDIR /app/backend

# Expose the default port for the public app
EXPOSE 8003

# Start FastAPI server on port 8003
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8003"]
