FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code (includes existing db/tiendapago.db)
COPY . .

# Expose WebSocket port
EXPOSE 8765

# Run the application
CMD ["python", "main.py"]
