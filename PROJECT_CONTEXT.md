# StreamFinder — Project Context for LLMs

## What This Is

A personal streaming platform searcher focused on Egypt. Search for any movie, TV show, or anime and see which Egyptian streaming platforms have it, with TMDB ratings, cast info, and direct links to each platform. Built with Flask + vanilla HTML/CSS/JS as a single-page app.

## Tech Stack

- **Backend:** Python 3.12, Flask (serves API + HTML template)
- **Frontend:** Vanilla HTML/CSS/JS — single `index.html` template, no build step, no framework
- **Database:** SQLite via Python's `sqlite3` (file at `data/streamfinder.db`)
- **External API:** TMDB (The Movie Database) v3 — free API key, provides all movie/TV/provider data
- **Hosting:** PythonAnywhere (free tier, always on) at `marwanus21.pythonanywhere.com`
- **CSS:** Custom dark cinema theme with CSS variables, no framework

## File Structure

```
films-movies-searcher/
├── app.py                  # Flask app — all API routes
├── config.py               # TMDB key, watch region (EG), provider prices in EGP
├── db.py                   # SQLite database layer (watchlist CRUD)
├── wsgi.py                 # WSGI entry point for production (gunicorn/PythonAnywhere)
├── Procfile                # For Render deployment (gunicorn wsgi:app)
├── requirements.txt        # flask, requests, python-dotenv, gunicorn
├── .env                    # TMDB_API_KEY=... (not in git)
├── .env.example            # Template for .env
├── services/
│   ├── __init__.py
│   └── tmdb.py             # TMDBService class — wraps all TMDB API calls
├── templates/
│   └── index.html          # Single-page app shell (nav, view containers)
├── static/
│   ├── css/style.css       # Full dark theme (~950 lines)
│   └── js/app.js           # Frontend SPA logic (~770 lines)
└── data/
    └── streamfinder.db     # SQLite database (auto-created, gitignored)
```

## Features (Current)

### 1. Search
- Multi-search across movies and TV shows via TMDB
- Filter tabs: All / Movies / TV Shows
- Pagination with "Load More"
- Route: `GET /api/search?q=...&type=multi|movie|tv&page=1`

### 2. Detail View
- Poster, backdrop, overview, genres, runtime/seasons, TMDB rating, IMDb link
- **Egyptian streaming providers** (stream/rent/buy) from TMDB's JustWatch data with `watch_region=EG`
- **German dub hint** — shows German providers (`watch_region=DE`) as a secondary section
- **Clickable provider badges** — link directly to the platform's search page for that title (e.g., clicking Disney+ opens `disneyplus.com/search/TITLE`). Falls back to TMDB watch page for unknown providers.
- Cast carousel — clickable, leads to person view
- "Add to Watchlist" button
- Route: `GET /api/details/<movie|tv>/<id>`

### 3. Cast/Director Discovery
- Click any cast member to see their full filmography
- Each title shows Egyptian streaming availability (fetched in parallel via ThreadPoolExecutor)
- Filter: "All" vs "Available in Egypt"
- Shows "X of Y titles streamable in Egypt" stats
- Route: `GET /api/person/<id>/availability`

### 4. Watchlist
- Add/remove titles, persisted in SQLite
- Card grid with remove buttons
- Routes: `GET/POST /api/watchlist`, `DELETE /api/watchlist/<type>/<id>`

### 5. Subscription Optimizer
- Analyses watchlist to find the cheapest N-platform combination that covers the most titles
- Brute-force set-cover algorithm (fine for <=15 platforms)
- Shows coverage bar, monthly cost in EGP, which titles are covered
- Lists titles not streamable in Egypt
- Prices configured in `config.py` → `PROVIDER_PRICES`
- Route: `GET /api/optimize`

### 6. Episode Calendar
- Shows upcoming episodes (next 150 days) for all TV shows in watchlist
- Timeline grouped by month and day, with sticky date headers
- Countdown badges: TODAY (gold), this week (amber outline), later (gray)
- Summary stats: total episodes, this week, this month, show count
- Filter pills to show one specific show
- Skips ended/cancelled shows automatically
- Parallel fetching of season data
- Route: `GET /api/calendar`

## Architecture Notes

### Frontend (SPA pattern)
- All views are `<main class="view">` divs toggled by `navigateTo(viewName)`
- State managed in a global `state` object
- API calls go through `api()`, `apiPost()`, `apiDelete()` helpers
- Provider badges link to platform search URLs via `PROVIDER_SEARCH_URLS` mapping in JS (provider_id → URL template)
- Navigation history stack for back button support

### Backend
- All API routes return JSON
- `TMDBError` is caught by Flask error handler → returns `{error: "..."}` with 502
- TMDB responses for watch/providers are reshaped: `watch/providers.results.EG` → `watch_providers.eg`
- Parallel API calls use `ThreadPoolExecutor(max_workers=5)` for person availability and calendar
- SQLite auto-creates tables on first `get_db()` call
- Auto-migrates any existing `data/watchlist.json` to SQLite on startup

### Key TMDB Endpoints Used
- `/search/multi`, `/search/movie`, `/search/tv`
- `/movie/{id}` and `/tv/{id}` with `append_to_response=watch/providers,credits,external_ids`
- `/person/{id}` with `append_to_response=combined_credits`
- `/{type}/{id}/watch/providers` — returns per-country provider data
- `/tv/{id}/season/{n}` — episode air dates for calendar
- `/watch/providers/{type}?watch_region=EG` — all providers in Egypt

### Provider Search URL Mapping (in app.js)
Known platform IDs and their search URL templates are defined in `PROVIDER_SEARCH_URLS`. For platforms not in the map, the TMDB watch page link is used as fallback. To add a new platform: find its `provider_id` via `/api/providers`, then add an entry to the JS mapping.

## Configuration

### config.py
- `WATCH_REGION = 'EG'` — primary region for provider lookups
- `GERMAN_REGION = 'DE'` — secondary region for German dub hints
- `PROVIDER_PRICES` — dict of `provider_id: {name, price}` for the optimizer (prices in EGP)
- `MY_PLATFORMS` — list of provider IDs the user is subscribed to (not yet used in UI)

### Environment Variables
- `TMDB_API_KEY` — required, from .env or host environment
- `DATABASE_PATH` — optional, overrides default `data/streamfinder.db` location

## Deployment

### PythonAnywhere (current)
- Username: `marwanus21`
- WSGI file points to `/home/marwanus21/films-movies-searcher`
- `.env` file on server contains the TMDB API key
- SQLite database lives on persistent filesystem
- Update process: `cd films-movies-searcher && git pull` then reload web app

### Local Development
- `python app.py` → runs on `http://localhost:5000` with debug mode
- Flask auto-reloads on file changes

## Database Schema

```sql
CREATE TABLE watchlist (
    id           INTEGER NOT NULL,   -- TMDB title ID
    media_type   TEXT    NOT NULL,   -- 'movie' or 'tv'
    title        TEXT,
    poster_path  TEXT,
    vote_average REAL DEFAULT 0,
    release_date TEXT,
    added_at     TEXT,               -- ISO timestamp
    PRIMARY KEY (id, media_type)
);
```

## Potential Future Features
- Platform rotation planner (subscribe/cancel monthly based on what's available)
- Availability change alerts
- Trending in Egypt section
- pywebview wrapper for desktop app mode (code is already compatible — just wrap Flask in pywebview)
