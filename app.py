import os
from datetime import datetime, timedelta
from itertools import combinations
from concurrent.futures import ThreadPoolExecutor

from flask import Flask, render_template, jsonify, request

from config import PROVIDER_PRICES, WATCH_REGION, MY_PLATFORMS
from services.tmdb import TMDBService, TMDBError
from db import load_watchlist, add_to_watchlist, remove_from_watchlist, migrate_json_watchlist

app = Flask(__name__)
tmdb = TMDBService()

# Migrate any existing JSON watchlist to SQLite on startup
migrate_json_watchlist()


# ---------------------------------------------------------------------------
# Error handlers — return JSON for all API errors
# ---------------------------------------------------------------------------

@app.errorhandler(TMDBError)
def handle_tmdb_error(e):
    return jsonify({'error': str(e)}), 502


@app.errorhandler(Exception)
def handle_generic_error(e):
    # Let Flask debugger work in debug mode
    if app.debug and not isinstance(e, TMDBError):
        raise e
    return jsonify({'error': str(e)}), 500


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    return render_template('index.html', my_platforms=MY_PLATFORMS)


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

@app.route('/api/search')
def search():
    query = request.args.get('q', '').strip()
    media_type = request.args.get('type', 'multi')
    page = request.args.get('page', 1, type=int)

    if not query:
        return jsonify({'results': [], 'total_pages': 0, 'page': 1})

    if media_type == 'movie':
        data = tmdb.search_movie(query, page)
        for r in data.get('results', []):
            r['media_type'] = 'movie'
    elif media_type == 'tv':
        data = tmdb.search_tv(query, page)
        for r in data.get('results', []):
            r['media_type'] = 'tv'
    else:
        data = tmdb.search_multi(query, page)

    # Filter to movies and TV only (drop "person" results from multi)
    results = [
        r for r in data.get('results', [])
        if r.get('media_type') in ('movie', 'tv')
    ]

    return jsonify({
        'results': results,
        'page': data.get('page', 1),
        'total_pages': data.get('total_pages', 0),
        'total_results': data.get('total_results', 0),
    })


# ---------------------------------------------------------------------------
# Title details (movie or TV)
# ---------------------------------------------------------------------------

@app.route('/api/details/<media_type>/<int:title_id>')
def get_details(media_type, title_id):
    if media_type not in ('movie', 'tv'):
        return jsonify({'error': 'Invalid media type'}), 400

    if media_type == 'movie':
        data = tmdb.get_movie_details(title_id)
    else:
        data = tmdb.get_tv_details(title_id)

    # Reshape watch/providers into a cleaner structure
    wp = data.pop('watch/providers', {}).get('results', {})
    data['watch_providers'] = {
        'eg': wp.get(WATCH_REGION, {}),
        'de': wp.get('DE', {}),
    }

    return jsonify(data)


# ---------------------------------------------------------------------------
# Person + filmography with availability
# ---------------------------------------------------------------------------

@app.route('/api/person/<int:person_id>')
def get_person(person_id):
    data = tmdb.get_person(person_id)
    cast_credits = data.get('combined_credits', {}).get('cast', [])
    cast_credits.sort(key=lambda x: x.get('vote_count', 0), reverse=True)

    return jsonify({
        'id': data['id'],
        'name': data['name'],
        'biography': data.get('biography', ''),
        'profile_path': data.get('profile_path'),
        'birthday': data.get('birthday'),
        'place_of_birth': data.get('place_of_birth'),
        'known_for_department': data.get('known_for_department'),
        'filmography': cast_credits[:30],
    })


@app.route('/api/person/<int:person_id>/availability')
def get_person_availability(person_id):
    """Filmography with Egyptian streaming availability (parallelised)."""
    data = tmdb.get_person(person_id)
    credits = data.get('combined_credits', {}).get('cast', [])
    credits.sort(key=lambda x: x.get('vote_count', 0), reverse=True)
    credits = credits[:20]

    def _fetch(credit):
        mt = credit.get('media_type', 'movie')
        try:
            providers = tmdb.get_watch_providers(mt, credit['id'])
            eg = providers.get('eg', {})
        except Exception:
            eg = {}
        return {
            'id': credit['id'],
            'media_type': mt,
            'title': credit.get('title') or credit.get('name', ''),
            'poster_path': credit.get('poster_path'),
            'vote_average': credit.get('vote_average', 0),
            'release_date': credit.get('release_date') or credit.get('first_air_date', ''),
            'character': credit.get('character', ''),
            'eg_providers': eg,
            'available_in_egypt': bool(eg.get('flatrate')),
        }

    with ThreadPoolExecutor(max_workers=5) as pool:
        filmography = list(pool.map(_fetch, credits))

    return jsonify({
        'person': {
            'id': data['id'],
            'name': data['name'],
            'profile_path': data.get('profile_path'),
            'biography': data.get('biography', ''),
            'birthday': data.get('birthday'),
            'place_of_birth': data.get('place_of_birth'),
        },
        'filmography': filmography,
    })


# ---------------------------------------------------------------------------
# Watchlist CRUD
# ---------------------------------------------------------------------------

@app.route('/api/watchlist', methods=['GET'])
def get_watchlist_route():
    return jsonify(load_watchlist())


@app.route('/api/watchlist', methods=['POST'])
def add_to_watchlist_route():
    item = request.json
    watchlist = add_to_watchlist(item)
    return jsonify({'success': True, 'watchlist': watchlist})


@app.route('/api/watchlist/<media_type>/<int:title_id>', methods=['DELETE'])
def remove_from_watchlist_route(media_type, title_id):
    watchlist = remove_from_watchlist(media_type, title_id)
    return jsonify({'success': True, 'watchlist': watchlist})


# ---------------------------------------------------------------------------
# Subscription Optimizer
# ---------------------------------------------------------------------------

@app.route('/api/optimize')
def optimize():
    watchlist = load_watchlist()
    if not watchlist:
        return jsonify({'error': 'Watchlist is empty'}), 400

    all_providers = {}
    title_providers = {}

    def _fetch(item):
        try:
            prov = tmdb.get_watch_providers(item['media_type'], item['id'])
            return item, prov.get('eg', {}).get('flatrate', [])
        except Exception:
            return item, []

    with ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(_fetch, watchlist))

    for item, flatrate in results:
        key = f"{item['media_type']}_{item['id']}"
        pids = []
        for p in flatrate:
            pid = p['provider_id']
            pids.append(pid)
            if pid not in all_providers:
                price_info = PROVIDER_PRICES.get(pid, {})
                all_providers[pid] = {
                    'id': pid,
                    'name': p['provider_name'],
                    'logo_path': p['logo_path'],
                    'price': price_info.get('price') if price_info else None,
                }
        title_providers[key] = {
            'title': item.get('title', 'Unknown'),
            'providers': pids,
        }

    # --- Set-cover optimisation (brute-force, fine for <=15 platforms) ---
    platform_ids = list(all_providers.keys())
    total = len(title_providers)
    combos = []
    max_n = min(5, len(platform_ids))

    for n in range(1, max_n + 1):
        best_combo = None
        best_coverage = 0
        best_cost = float('inf')
        best_covered = []

        for combo in combinations(platform_ids, n):
            covered = [
                d['title'] for d in title_providers.values()
                if any(p in combo for p in d['providers'])
            ]
            cost = sum(all_providers[p].get('price') or 0 for p in combo)

            if len(covered) > best_coverage or (
                len(covered) == best_coverage and cost < best_cost
            ):
                best_combo = combo
                best_coverage = len(covered)
                best_cost = cost
                best_covered = covered

        if best_combo:
            combos.append({
                'num_platforms': n,
                'platforms': [all_providers[p] for p in best_combo],
                'coverage': best_coverage,
                'total': total,
                'percentage': round(best_coverage / total * 100, 1) if total else 0,
                'monthly_cost': best_cost,
                'covered_titles': best_covered,
            })

    not_available = [
        d['title'] for d in title_providers.values() if not d['providers']
    ]

    return jsonify({
        'total_titles': total,
        'combinations': combos,
        'not_available': not_available,
        'all_platforms': list(all_providers.values()),
    })


# ---------------------------------------------------------------------------
# Episode Calendar — upcoming episodes for watchlist TV shows
# ---------------------------------------------------------------------------

CALENDAR_DAYS = 150

@app.route('/api/calendar')
def calendar():
    """Return upcoming episodes (next 150 days) for all TV shows in watchlist."""
    watchlist = load_watchlist()
    tv_shows = [w for w in watchlist if w.get('media_type') == 'tv']

    if not tv_shows:
        return jsonify({'episodes': [], 'shows': 0,
                        'message': 'No TV shows in your watchlist.'})

    today = datetime.now().date()
    cutoff = today + timedelta(days=CALENDAR_DAYS)

    def _fetch_episodes(item):
        """Get upcoming episodes for a single show."""
        episodes = []
        try:
            show = tmdb.get_tv_basic(item['id'])
            show_name = show.get('name', item.get('title', 'Unknown'))
            poster = show.get('poster_path') or item.get('poster_path')
            status = show.get('status', '')

            # Skip ended / cancelled shows
            if status in ('Ended', 'Canceled'):
                return episodes

            # Determine which seasons might have future episodes.
            # Check next_episode_to_air first — fastest path.
            next_ep = show.get('next_episode_to_air')
            seasons_to_check = set()

            if next_ep and next_ep.get('season_number'):
                seasons_to_check.add(next_ep['season_number'])

            # Also check the last season listed — it may have future eps
            all_seasons = show.get('seasons', [])
            if all_seasons:
                # Grab the last 2 real seasons (season_number > 0)
                real = [s for s in all_seasons if s.get('season_number', 0) > 0]
                for s in real[-2:]:
                    seasons_to_check.add(s['season_number'])

            for sn in seasons_to_check:
                try:
                    season_data = tmdb.get_season(item['id'], sn)
                except Exception:
                    continue

                for ep in season_data.get('episodes', []):
                    air = ep.get('air_date')
                    if not air:
                        continue
                    try:
                        air_date = datetime.strptime(air, '%Y-%m-%d').date()
                    except ValueError:
                        continue

                    if today <= air_date <= cutoff:
                        episodes.append({
                            'show_id': item['id'],
                            'show_name': show_name,
                            'show_poster': poster,
                            'season_number': ep.get('season_number', sn),
                            'episode_number': ep.get('episode_number', 0),
                            'name': ep.get('name', ''),
                            'overview': ep.get('overview', ''),
                            'air_date': air,
                            'still_path': ep.get('still_path'),
                        })
        except Exception:
            pass
        return episodes

    all_episodes = []
    with ThreadPoolExecutor(max_workers=5) as pool:
        results = pool.map(_fetch_episodes, tv_shows)
        for eps in results:
            all_episodes.extend(eps)

    # Sort by air date
    all_episodes.sort(key=lambda e: e['air_date'])

    return jsonify({
        'episodes': all_episodes,
        'shows': len(tv_shows),
        'days': CALENDAR_DAYS,
    })


# ---------------------------------------------------------------------------
# Provider catalogue (helper to discover IDs & configure prices)
# ---------------------------------------------------------------------------

@app.route('/api/providers')
def list_providers():
    """List all streaming providers available in Egypt."""
    movie_p = tmdb.get_available_providers('movie').get('results', [])
    tv_p = tmdb.get_available_providers('tv').get('results', [])

    merged = {}
    for p in movie_p + tv_p:
        merged[p['provider_id']] = p

    result = []
    for pid, p in sorted(merged.items()):
        price_info = PROVIDER_PRICES.get(pid, {})
        result.append({
            'provider_id': pid,
            'provider_name': p['provider_name'],
            'logo_path': p.get('logo_path'),
            'price': price_info.get('price') if price_info else None,
            'configured': pid in PROVIDER_PRICES,
        })

    return jsonify(result)


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    app.run(debug=True, port=5000)
