"""
WSGI entry point for production servers (gunicorn, PythonAnywhere, etc.)
Usage:  gunicorn wsgi:app
"""
from app import app

if __name__ == '__main__':
    app.run()
