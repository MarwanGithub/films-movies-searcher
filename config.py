import os
from dotenv import load_dotenv

load_dotenv()

# TMDB API Configuration
TMDB_API_KEY = os.getenv('TMDB_API_KEY', '')
TMDB_BASE_URL = 'https://api.themoviedb.org/3'
TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

# Primary watch region (ISO 3166-1 code)
WATCH_REGION = 'EG'

# Secondary region for German dub reference
GERMAN_REGION = 'DE'

# -------------------------------------------------------------------
# Provider prices in EGP/month (approximate, update as needed)
# To discover provider IDs for your region, visit /api/providers
# in the running app.
# -------------------------------------------------------------------
PROVIDER_PRICES = {
    8:   {'name': 'Netflix',              'price': 169},
    119: {'name': 'Amazon Prime Video',   'price': 45},
    337: {'name': 'Disney Plus',          'price': 100},
    350: {'name': 'Apple TV Plus',        'price': 30},
    283: {'name': 'Crunchyroll',          'price': 30},
    531: {'name': 'Paramount Plus',       'price': 50},
    # Add more providers and adjust prices as needed.
    # Run the app and visit /api/providers to see all available
    # provider IDs in Egypt.
}

# -------------------------------------------------------------------
# Platforms you're currently subscribed to (provider IDs).
# Used to highlight content on your existing platforms.
# -------------------------------------------------------------------
MY_PLATFORMS = []
