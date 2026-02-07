import requests
from config import TMDB_API_KEY, TMDB_BASE_URL, WATCH_REGION, GERMAN_REGION


class TMDBError(Exception):
    """Raised when a TMDB API call fails."""
    pass


class TMDBService:
    """Wrapper around The Movie Database (TMDB) API v3."""

    def __init__(self):
        self.base = TMDB_BASE_URL
        self.session = requests.Session()
        self.session.params = {'api_key': TMDB_API_KEY}

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    def search_multi(self, query, page=1):
        """Search movies, TV shows, and people in one call."""
        return self._get('/search/multi', {
            'query': query,
            'page': page,
            'include_adult': False,
        })

    def search_movie(self, query, page=1):
        return self._get('/search/movie', {
            'query': query,
            'page': page,
            'include_adult': False,
        })

    def search_tv(self, query, page=1):
        return self._get('/search/tv', {
            'query': query,
            'page': page,
            'include_adult': False,
        })

    # ------------------------------------------------------------------
    # Details (with appended sub-requests for efficiency)
    # ------------------------------------------------------------------

    def get_movie_details(self, movie_id):
        return self._get(f'/movie/{movie_id}', {
            'append_to_response': 'watch/providers,credits,external_ids',
        })

    def get_tv_details(self, tv_id):
        return self._get(f'/tv/{tv_id}', {
            'append_to_response': 'watch/providers,credits,external_ids',
        })

    # ------------------------------------------------------------------
    # People
    # ------------------------------------------------------------------

    def get_person(self, person_id):
        return self._get(f'/person/{person_id}', {
            'append_to_response': 'combined_credits',
        })

    # ------------------------------------------------------------------
    # Watch providers
    # ------------------------------------------------------------------

    def get_watch_providers(self, media_type, title_id):
        """Return EG and DE provider data for a single title."""
        data = self._get(f'/{media_type}/{title_id}/watch/providers')
        results = data.get('results', {})
        return {
            'eg': results.get(WATCH_REGION, {}),
            'de': results.get(GERMAN_REGION, {}),
        }

    def get_available_providers(self, media_type):
        """List every provider available in the watch region."""
        return self._get(f'/watch/providers/{media_type}', {
            'watch_region': WATCH_REGION,
        })

    # ------------------------------------------------------------------
    # Seasons / Episodes
    # ------------------------------------------------------------------

    def get_tv_basic(self, tv_id):
        """Light TV details — just enough to find upcoming episodes."""
        return self._get(f'/tv/{tv_id}')

    def get_season(self, tv_id, season_number):
        """Get all episodes for a specific season."""
        return self._get(f'/tv/{tv_id}/season/{season_number}')

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _get(self, path, params=None):
        if not TMDB_API_KEY or TMDB_API_KEY == 'your_api_key_here':
            raise TMDBError(
                'TMDB API key not configured. '
                'Get a free key at https://www.themoviedb.org/settings/api '
                'and add it to your .env file.'
            )
        resp = self.session.get(f'{self.base}{path}', params=params or {})
        if resp.status_code == 401:
            raise TMDBError(
                'Invalid TMDB API key. Check your .env file and make sure '
                'the key is correct.'
            )
        resp.raise_for_status()
        return resp.json()
