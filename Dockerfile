FROM python:3.12-slim

# Set working directory
WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Create the data directory (will be overridden by a persistent volume in production)
RUN mkdir -p /app/data

# Expose port
EXPOSE 8000

# Start gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "2", "--timeout", "120", "wsgi:app"]
