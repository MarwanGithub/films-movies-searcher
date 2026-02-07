/* ===========================================================
   StreamFinder – Frontend Application
   =========================================================== */

const TMDB_IMG = 'https://image.tmdb.org/t/p';

// ───────────────────────── State ─────────────────────────

const state = {
    currentView: 'search',
    viewHistory: [],
    searchQuery: '',
    searchType: 'multi',
    searchResults: [],
    currentPage: 1,
    totalPages: 1,
    watchlist: [],
};

// ───────────────────────── Init ─────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initSearch();
    loadWatchlist();
});

// ───────────────────────── Navigation ─────────────────────────

function initNavigation() {
    document.querySelectorAll('.nav-links a').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            navigateTo(link.dataset.view);
        });
    });
}

function navigateTo(view, pushHistory = true) {
    if (pushHistory && state.currentView !== view) {
        state.viewHistory.push(state.currentView);
    }

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById(`view-${view}`);
    if (el) el.classList.add('active');

    // Highlight nav link (only for top-level views)
    document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
    const nav = document.querySelector(`.nav-links a[data-view="${view}"]`);
    if (nav) nav.classList.add('active');

    state.currentView = view;
    window.scrollTo(0, 0);

    // Show nav search bar on all views except the main search page
    const navSearch = document.getElementById('nav-search-wrapper');
    if (navSearch) navSearch.classList.toggle('hidden', view === 'search');

    if (view === 'watchlist') renderWatchlist();
    if (view === 'calendar') loadCalendar();
}

function goBack() {
    const prev = state.viewHistory.pop();
    navigateTo(prev || 'search', false);
}

// ───────────────────────── API helpers ─────────────────────────

async function api(endpoint) {
    const resp = await fetch(`/api${endpoint}`);
    if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${resp.status})`);
    }
    return resp.json();
}

async function apiPost(endpoint, data) {
    const resp = await fetch(`/api${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!resp.ok) throw new Error(`Request failed (${resp.status})`);
    return resp.json();
}

async function apiDelete(endpoint) {
    const resp = await fetch(`/api${endpoint}`, { method: 'DELETE' });
    if (!resp.ok) throw new Error(`Request failed (${resp.status})`);
    return resp.json();
}

// ───────────────────────── Search ─────────────────────────

let acDebounceTimer = null;
let acAbortController = null;
let acActiveIndex = -1;
let acActiveDropdown = null;  // tracks which dropdown is currently active

function initSearch() {
    const input = document.getElementById('search-input');
    const btn   = document.getElementById('search-btn');

    input.addEventListener('keydown', e => {
        const dd = document.getElementById('autocomplete-dropdown');
        const items = dd.querySelectorAll('.ac-item');

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            acActiveIndex = Math.min(acActiveIndex + 1, items.length - 1);
            updateAcHighlight(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            acActiveIndex = Math.max(acActiveIndex - 1, -1);
            updateAcHighlight(items);
        } else if (e.key === 'Enter') {
            if (acActiveIndex >= 0 && items[acActiveIndex]) {
                e.preventDefault();
                items[acActiveIndex].click();
            } else {
                closeAutocomplete();
                performSearch();
            }
        } else if (e.key === 'Escape') {
            closeAutocomplete();
        }
    });

    input.addEventListener('input', () => {
        const q = input.value.trim();
        if (q.length < 2) { closeAutocomplete(); return; }
        clearTimeout(acDebounceTimer);
        acDebounceTimer = setTimeout(() => fetchAutocomplete(q, 'autocomplete-dropdown'), 350);
    });

    // Close dropdown on outside click
    document.addEventListener('click', e => {
        if (!e.target.closest('.search-box-wrapper')) {
            const dd = document.getElementById('autocomplete-dropdown');
            if (dd && !dd.classList.contains('hidden')) {
                dd.classList.add('hidden');
                dd.innerHTML = '';
            }
        }
    });

    // Re-open on focus if there's text
    input.addEventListener('focus', () => {
        const q = input.value.trim();
        if (q.length >= 2) {
            clearTimeout(acDebounceTimer);
            acDebounceTimer = setTimeout(() => fetchAutocomplete(q, 'autocomplete-dropdown'), 200);
        }
    });

    btn.addEventListener('click', () => { closeAutocomplete(); performSearch(); });

    // Nav search bar (on non-search views)
    initNavSearch();

    // Filter tabs
    document.querySelectorAll('.filter-tabs button').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.filter-tabs button').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            state.searchType = tab.dataset.type;
            if (state.searchQuery) performSearch();
        });
    });

    // Load-more
    document.getElementById('load-more-btn').addEventListener('click', loadMore);
}

async function fetchAutocomplete(query, dropdownId) {
    // Cancel any in-flight request
    if (acAbortController) acAbortController.abort();
    acAbortController = new AbortController();
    acActiveDropdown = dropdownId;

    try {
        const resp = await fetch(
            `/api/search?q=${encodeURIComponent(query)}&type=${state.searchType}&page=1`,
            { signal: acAbortController.signal }
        );
        if (!resp.ok) return;
        const data = await resp.json();
        renderAutocomplete(data.results.slice(0, 6), dropdownId);
    } catch (err) {
        if (err.name !== 'AbortError') console.error('Autocomplete error:', err);
    }
}

function renderAutocomplete(results, dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;
    acActiveIndex = -1;

    if (!results.length) {
        dropdown.innerHTML = '<div class="ac-hint">No results found</div>';
        dropdown.classList.remove('hidden');
        return;
    }

    dropdown.innerHTML = results.map((item, i) => {
        const title  = item.title || item.name || 'Unknown';
        const date   = item.release_date || item.first_air_date || '';
        const year   = date ? date.substring(0, 4) : '';
        const type   = item.media_type === 'movie' ? 'Movie' : 'TV';
        const rating = item.vote_average ? item.vote_average.toFixed(1) : '';
        const poster = item.poster_path ? `${TMDB_IMG}/w92${item.poster_path}` : '';

        return `
            <div class="ac-item" data-index="${i}"
                 onclick="acSelect('${item.media_type}', ${item.id})"
                 onmouseenter="acActiveIndex=${i};updateAcHighlight(document.querySelectorAll('#${dropdownId} .ac-item'))">
                <div class="ac-poster">
                    ${poster
                        ? `<img src="${poster}" alt="${escapeAttr(title)}" loading="lazy">`
                        : `<div class="ac-poster-empty">${escapeHtml(title.charAt(0))}</div>`}
                </div>
                <div class="ac-info">
                    <div class="ac-title">${escapeHtml(title)}</div>
                    <div class="ac-meta">
                        <span class="ac-type-badge">${type}</span>
                        ${year ? `<span>${year}</span>` : ''}
                        ${rating ? `<span class="ac-rating">${rating}</span>` : ''}
                    </div>
                </div>
            </div>`;
    }).join('');

    dropdown.classList.remove('hidden');
}

function updateAcHighlight(items) {
    items.forEach((el, i) => el.classList.toggle('ac-active', i === acActiveIndex));
    if (acActiveIndex >= 0 && items[acActiveIndex]) {
        items[acActiveIndex].scrollIntoView({ block: 'nearest' });
    }
}

function acSelect(mediaType, id) {
    closeAutocomplete();
    showDetail(mediaType, id);
}

function closeAutocomplete() {
    ['autocomplete-dropdown', 'nav-autocomplete-dropdown'].forEach(id => {
        const dd = document.getElementById(id);
        if (dd) { dd.classList.add('hidden'); dd.innerHTML = ''; }
    });
    acActiveIndex = -1;
    acActiveDropdown = null;
    if (acAbortController) { acAbortController.abort(); acAbortController = null; }
    clearTimeout(acDebounceTimer);
}

function initNavSearch() {
    const input = document.getElementById('nav-search-input');
    if (!input) return;
    const dropdownId = 'nav-autocomplete-dropdown';

    input.addEventListener('keydown', e => {
        const dropdown = document.getElementById(dropdownId);
        const items = dropdown.querySelectorAll('.ac-item');

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            acActiveIndex = Math.min(acActiveIndex + 1, items.length - 1);
            updateAcHighlight(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            acActiveIndex = Math.max(acActiveIndex - 1, -1);
            updateAcHighlight(items);
        } else if (e.key === 'Enter') {
            if (acActiveIndex >= 0 && items[acActiveIndex]) {
                e.preventDefault();
                items[acActiveIndex].click();
            } else {
                // Switch to search view and perform a full search
                const q = input.value.trim();
                if (q) {
                    closeAutocomplete();
                    document.getElementById('search-input').value = q;
                    navigateTo('search');
                    performSearch();
                }
            }
        } else if (e.key === 'Escape') {
            closeAutocomplete();
            input.blur();
        }
    });

    input.addEventListener('input', () => {
        const q = input.value.trim();
        if (q.length < 2) { closeAutocomplete(); return; }
        clearTimeout(acDebounceTimer);
        acDebounceTimer = setTimeout(() => fetchAutocomplete(q, dropdownId), 350);
    });

    input.addEventListener('focus', () => {
        const q = input.value.trim();
        if (q.length >= 2) {
            clearTimeout(acDebounceTimer);
            acDebounceTimer = setTimeout(() => fetchAutocomplete(q, dropdownId), 200);
        }
    });

    // Close on outside click
    document.addEventListener('click', e => {
        if (!e.target.closest('#nav-search-wrapper')) {
            const dd = document.getElementById(dropdownId);
            if (dd && !dd.classList.contains('hidden')) {
                dd.classList.add('hidden');
                dd.innerHTML = '';
            }
        }
    });
}

async function performSearch() {
    const query = document.getElementById('search-input').value.trim();
    if (!query) return;

    state.searchQuery = query;
    state.currentPage = 1;
    state.searchResults = [];

    toggleEl('loading', true);
    toggleEl('no-results', false);
    toggleEl('load-more-container', false);
    document.getElementById('results-grid').innerHTML = '';

    try {
        const data = await api(
            `/search?q=${encodeURIComponent(query)}&type=${state.searchType}&page=1`
        );
        state.searchResults = data.results;
        state.totalPages = data.total_pages;
        state.currentPage = 1;

        toggleEl('loading', false);

        if (data.results.length === 0) {
            toggleEl('no-results', true);
            return;
        }
        renderSearchResults(false);
        if (state.currentPage < state.totalPages) toggleEl('load-more-container', true);
    } catch (err) {
        toggleEl('loading', false);
        document.getElementById('results-grid').innerHTML =
            `<div class="error-msg">${escapeHtml(err.message)}</div>`;
    }
}

async function loadMore() {
    if (state.currentPage >= state.totalPages) return;
    state.currentPage++;

    try {
        const data = await api(
            `/search?q=${encodeURIComponent(state.searchQuery)}&type=${state.searchType}&page=${state.currentPage}`
        );
        state.searchResults.push(...data.results);
        renderSearchResults(true);
        if (state.currentPage >= state.totalPages) toggleEl('load-more-container', false);
    } catch (_) { /* silent */ }
}

function renderSearchResults(append) {
    const grid = document.getElementById('results-grid');
    const html = (append ? state.searchResults.slice(-20) : state.searchResults)
        .map(createCardHTML).join('');
    if (append) grid.insertAdjacentHTML('beforeend', html);
    else grid.innerHTML = html;
}

// ───────────────────────── Card HTML ─────────────────────────

function createCardHTML(item) {
    const title = item.title || item.name || 'Unknown';
    const date  = item.release_date || item.first_air_date || '';
    const year  = date ? date.substring(0, 4) : '';
    const type  = item.media_type === 'movie' ? 'Movie' : 'TV';
    const rating = item.vote_average ? item.vote_average.toFixed(1) : '';
    const poster = item.poster_path ? `${TMDB_IMG}/w342${item.poster_path}` : '';

    return `
        <div class="card" onclick="showDetail('${item.media_type}', ${item.id})">
            <div class="card-poster ${poster ? '' : 'no-poster'}">
                ${poster
                    ? `<img src="${poster}" alt="${escapeAttr(title)}" loading="lazy">`
                    : `<span class="no-poster-text">${escapeHtml(title)}</span>`}
                <span class="card-type">${type}</span>
                ${rating ? `<span class="card-rating">${rating}</span>` : ''}
            </div>
            <div class="card-info">
                <h3 class="card-title" title="${escapeAttr(title)}">${escapeHtml(title)}</h3>
                <p class="card-year">${year}</p>
            </div>
        </div>`;
}

// ───────────────────────── Detail View ─────────────────────────

async function showDetail(mediaType, id) {
    navigateTo('detail');
    const container = document.getElementById('detail-content');
    container.innerHTML = '<div class="loading-spinner">Loading details...</div>';

    try {
        const data = await api(`/details/${mediaType}/${id}`);
        renderDetail(data, mediaType);
    } catch (err) {
        container.innerHTML = `<div class="error-msg">Failed to load: ${escapeHtml(err.message)}</div>`;
    }
}

function renderDetail(data, mediaType) {
    const container = document.getElementById('detail-content');
    const title    = data.title || data.name || 'Unknown';
    const date     = data.release_date || data.first_air_date || '';
    const year     = date ? date.substring(0, 4) : '';
    const backdrop = data.backdrop_path ? `${TMDB_IMG}/w1280${data.backdrop_path}` : '';
    const poster   = data.poster_path ? `${TMDB_IMG}/w500${data.poster_path}` : '';
    const rating   = data.vote_average ? data.vote_average.toFixed(1) : '';
    const imdbId   = data.external_ids?.imdb_id;
    const genres   = (data.genres || []).map(g => g.name).join(', ');
    const runtime  = data.runtime
        ? `${data.runtime} min`
        : data.number_of_seasons
            ? `${data.number_of_seasons} season${data.number_of_seasons > 1 ? 's' : ''}`
            : '';

    const egProv = data.watch_providers?.eg || {};
    const deProv = data.watch_providers?.de || {};
    const cast   = (data.credits?.cast || []).slice(0, 20);
    const inWL   = isInWatchlist(mediaType, data.id);

    container.innerHTML = `
        <div class="detail-backdrop" ${backdrop ? `style="background-image:url('${backdrop}')"` : ''}>
            <div class="detail-overlay">
                <div class="detail-header">
                    ${poster ? `<img class="detail-poster" src="${poster}" alt="${escapeAttr(title)}">` : ''}
                    <div class="detail-info">
                        <h1>${escapeHtml(title)} ${year ? `<span class="year">(${year})</span>` : ''}</h1>
                        <p class="genres">${escapeHtml(genres)}${runtime ? ` &middot; ${runtime}` : ''}</p>
                        <div class="ratings">
                            ${rating ? `<span class="rating-badge">TMDB ${rating} / 10</span>` : ''}
                            ${imdbId ? `<a class="imdb-link" href="https://www.imdb.com/title/${imdbId}" target="_blank" rel="noopener">View on IMDb</a>` : ''}
                        </div>
                        <p class="overview">${escapeHtml(data.overview || 'No overview available.')}</p>
                        <button class="btn-watchlist ${inWL ? 'in-watchlist' : ''}"
                                id="wl-toggle"
                                data-media="${mediaType}"
                                data-id="${data.id}"
                                data-title="${escapeAttr(title)}"
                                data-poster="${data.poster_path || ''}"
                                data-rating="${data.vote_average || 0}"
                                data-date="${date}">
                            ${inWL ? 'In Watchlist' : 'Add to Watchlist'}
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <div class="detail-section">
            <h2>Where to Watch in Egypt</h2>
            ${renderProviders(egProv, title, egProv.link)}
        </div>

        ${hasProviders(deProv) ? `
        <div class="detail-section de-section">
            <h2>Available in Germany <span class="hint">(likely has German dub)</span></h2>
            ${renderProviders(deProv, title, deProv.link)}
        </div>` : ''}

        ${cast.length ? `
        <div class="detail-section">
            <h2>Cast</h2>
            <div class="cast-scroll">
                ${cast.map(p => `
                    <div class="cast-card" onclick="showPerson(${p.id})">
                        <div class="cast-photo">
                            ${p.profile_path
                                ? `<img src="${TMDB_IMG}/w185${p.profile_path}" alt="${escapeAttr(p.name)}" loading="lazy">`
                                : `<div class="cast-placeholder">${p.name.charAt(0)}</div>`}
                        </div>
                        <p class="cast-name">${escapeHtml(p.name)}</p>
                        <p class="cast-character">${escapeHtml(p.character || '')}</p>
                    </div>`).join('')}
            </div>
        </div>` : ''}
    `;

    // Bind watchlist toggle via event delegation
    document.getElementById('wl-toggle').addEventListener('click', handleWatchlistToggle);
}

function handleWatchlistToggle(e) {
    const btn = e.currentTarget;
    toggleWatchlist(
        btn.dataset.media,
        parseInt(btn.dataset.id),
        btn.dataset.title,
        btn.dataset.poster,
        parseFloat(btn.dataset.rating),
        btn.dataset.date,
    );
}

// ───────────────────────── Providers ─────────────────────────

// Search URL templates for known platforms (provider_id → URL builder)
const PROVIDER_SEARCH_URLS = {
    8:    q => `https://www.netflix.com/search?q=${q}`,
    337:  q => `https://www.disneyplus.com/search/${q}`,
    119:  q => `https://www.amazon.eg/s?k=${q}&i=instant-video`,
    9:    q => `https://www.amazon.com/s?k=${q}&i=instant-video`,
    350:  q => `https://tv.apple.com/search?term=${q}`,
    283:  q => `https://www.crunchyroll.com/search?q=${q}`,
    531:  q => `https://www.paramountplus.com/search?q=${q}`,
    1899: q => `https://www.max.com/search?q=${q}`,
    2:    q => `https://tv.apple.com/search?term=${q}`,
    3:    q => `https://play.google.com/store/search?q=${q}&c=movies`,
    192:  q => `https://www.youtube.com/results?search_query=${q}+full+movie`,
    73:   q => `https://www.tubi.tv/search/${q}`,
    386:  q => `https://www.peacocktv.com/search?q=${q}`,
    1773: q => `https://shahid.mbc.net/en/search?q=${q}`,
};

function getProviderUrl(providerId, title) {
    const q = encodeURIComponent(title);
    const builder = PROVIDER_SEARCH_URLS[providerId];
    return builder ? builder(q) : null;
}

function hasProviders(p) {
    return !!(p.flatrate || p.rent || p.buy);
}

function renderProviders(providers, title, tmdbLink) {
    if (!hasProviders(providers)) {
        return '<p class="no-providers">Not available on any streaming platform in this region.</p>';
    }
    let html = '';
    if (providers.flatrate) html += providerGroup('Stream', providers.flatrate, title, tmdbLink);
    if (providers.rent)     html += providerGroup('Rent', providers.rent, title, tmdbLink);
    if (providers.buy)      html += providerGroup('Buy', providers.buy, title, tmdbLink);
    return html;
}

function providerGroup(label, list, title, tmdbLink) {
    return `
        <div class="provider-group">
            <h3>${label}</h3>
            <div class="provider-list">
                ${list.map(p => {
                    const url = getProviderUrl(p.provider_id, title || '') || tmdbLink || '#';
                    return `
                    <a href="${url}" target="_blank" rel="noopener"
                       class="provider-badge" onclick="event.stopPropagation()"
                       title="Search on ${escapeAttr(p.provider_name)}">
                        <img src="${TMDB_IMG}/original${p.logo_path}" alt="${escapeAttr(p.provider_name)}">
                        <span>${escapeHtml(p.provider_name)}</span>
                        <span class="provider-link-icon">&#8599;</span>
                    </a>`;
                }).join('')}
            </div>
        </div>`;
}

// ───────────────────────── Person View ─────────────────────────

async function showPerson(personId) {
    navigateTo('person');
    const container = document.getElementById('person-content');
    container.innerHTML = '<div class="loading-spinner">Loading filmography &amp; availability...</div>';

    try {
        const data = await api(`/person/${personId}/availability`);
        renderPerson(data);
    } catch (err) {
        container.innerHTML = `<div class="error-msg">Failed to load: ${escapeHtml(err.message)}</div>`;
    }
}

function renderPerson(data) {
    const container = document.getElementById('person-content');
    const p = data.person;
    const films = data.filmography;
    const photo = p.profile_path ? `${TMDB_IMG}/w300${p.profile_path}` : '';
    const bio = p.biography
        ? (p.biography.length > 600 ? p.biography.substring(0, 600) + '...' : p.biography)
        : '';
    const available = films.filter(f => f.available_in_egypt).length;

    container.innerHTML = `
        <div class="person-header">
            ${photo ? `<img class="person-photo" src="${photo}" alt="${escapeAttr(p.name)}">` : ''}
            <div class="person-info">
                <h1>${escapeHtml(p.name)}</h1>
                ${p.birthday ? `<p class="muted">${p.birthday}${p.place_of_birth ? ` &middot; ${escapeHtml(p.place_of_birth)}` : ''}</p>` : ''}
                ${bio ? `<p class="person-bio">${escapeHtml(bio)}</p>` : ''}
                <p class="person-stats">${available} of ${films.length} titles streamable in Egypt</p>
            </div>
        </div>

        <div class="detail-section">
            <div class="person-filter">
                <button class="filter-btn active" onclick="filterFilmography('all', this)">All (${films.length})</button>
                <button class="filter-btn" onclick="filterFilmography('available', this)">Available in Egypt (${available})</button>
            </div>
            <div id="filmography-grid" class="card-grid">
                ${films.map(createFilmCard).join('')}
            </div>
        </div>
    `;
}

function createFilmCard(item) {
    const title   = item.title || 'Unknown';
    const date    = item.release_date || '';
    const year    = date ? date.substring(0, 4) : '';
    const type    = item.media_type === 'movie' ? 'Movie' : 'TV';
    const rating  = item.vote_average ? item.vote_average.toFixed(1) : '';
    const poster  = item.poster_path ? `${TMDB_IMG}/w342${item.poster_path}` : '';
    const avail   = item.available_in_egypt;
    const provs   = item.eg_providers?.flatrate || [];

    return `
        <div class="card ${avail ? '' : 'card-unavailable'}" data-available="${avail}"
             onclick="showDetail('${item.media_type}', ${item.id})">
            <div class="card-poster ${poster ? '' : 'no-poster'}">
                ${poster
                    ? `<img src="${poster}" alt="${escapeAttr(title)}" loading="lazy">`
                    : `<span class="no-poster-text">${escapeHtml(title)}</span>`}
                <span class="card-type">${type}</span>
                ${rating ? `<span class="card-rating">${rating}</span>` : ''}
                ${avail ? '<span class="card-available">EG</span>' : ''}
            </div>
            <div class="card-info">
                <h3 class="card-title" title="${escapeAttr(title)}">${escapeHtml(title)}</h3>
                <p class="card-year">${year}${item.character ? ` &middot; ${escapeHtml(item.character)}` : ''}</p>
                ${provs.length ? `
                    <div class="card-providers">
                        ${provs.slice(0, 3).map(pr =>
                            `<img src="${TMDB_IMG}/original${pr.logo_path}" alt="${escapeAttr(pr.provider_name)}" title="${escapeAttr(pr.provider_name)}">`
                        ).join('')}
                    </div>` : ''}
            </div>
        </div>`;
}

function filterFilmography(filter, btn) {
    document.querySelectorAll('.person-filter .filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('#filmography-grid .card').forEach(card => {
        card.style.display = (filter === 'all' || card.dataset.available === 'true') ? '' : 'none';
    });
}

// ───────────────────────── Watchlist ─────────────────────────

async function loadWatchlist() {
    try { state.watchlist = await api('/watchlist'); }
    catch (_) { state.watchlist = []; }
    updateBadge();
}

function isInWatchlist(mediaType, id) {
    return state.watchlist.some(w => w.id === id && w.media_type === mediaType);
}

function updateBadge() {
    const el = document.getElementById('watchlist-count');
    el.textContent = state.watchlist.length;
    el.style.display = state.watchlist.length ? '' : 'none';
}

async function toggleWatchlist(mediaType, id, title, posterPath, voteAvg, date) {
    const exists = isInWatchlist(mediaType, id);
    try {
        let res;
        if (exists) {
            res = await apiDelete(`/watchlist/${mediaType}/${id}`);
        } else {
            res = await apiPost('/watchlist', {
                id, media_type: mediaType, title,
                poster_path: posterPath,
                vote_average: voteAvg,
                release_date: date,
            });
        }
        state.watchlist = res.watchlist;
        updateBadge();

        // Update button state
        const btn = document.getElementById('wl-toggle');
        if (btn) {
            const now = isInWatchlist(mediaType, id);
            btn.classList.toggle('in-watchlist', now);
            btn.textContent = now ? 'In Watchlist' : 'Add to Watchlist';
        }
    } catch (err) { console.error('Watchlist error:', err); }
}

function renderWatchlist() {
    const grid  = document.getElementById('watchlist-grid');
    const empty = document.getElementById('watchlist-empty');

    if (!state.watchlist.length) {
        grid.innerHTML = '';
        toggleEl('watchlist-empty', true);
        return;
    }

    toggleEl('watchlist-empty', false);
    grid.innerHTML = state.watchlist.map(item => {
        const title  = item.title || item.name || 'Unknown';
        const date   = item.release_date || item.first_air_date || '';
        const year   = date ? date.substring(0, 4) : '';
        const type   = item.media_type === 'movie' ? 'Movie' : 'TV';
        const rating = item.vote_average ? item.vote_average.toFixed(1) : '';
        const poster = item.poster_path ? `${TMDB_IMG}/w342${item.poster_path}` : '';

        return `
            <div class="card" onclick="showDetail('${item.media_type}', ${item.id})">
                <div class="card-poster ${poster ? '' : 'no-poster'}">
                    ${poster
                        ? `<img src="${poster}" alt="${escapeAttr(title)}" loading="lazy">`
                        : `<span class="no-poster-text">${escapeHtml(title)}</span>`}
                    <span class="card-type">${type}</span>
                    ${rating ? `<span class="card-rating">${rating}</span>` : ''}
                    <button class="card-remove"
                            onclick="event.stopPropagation(); removeFromWatchlist('${item.media_type}', ${item.id})"
                            title="Remove">&times;</button>
                </div>
                <div class="card-info">
                    <h3 class="card-title" title="${escapeAttr(title)}">${escapeHtml(title)}</h3>
                    <p class="card-year">${year}</p>
                </div>
            </div>`;
    }).join('');
}

async function removeFromWatchlist(mediaType, id) {
    try {
        const res = await apiDelete(`/watchlist/${mediaType}/${id}`);
        state.watchlist = res.watchlist;
        updateBadge();
        renderWatchlist();
    } catch (err) { console.error('Remove error:', err); }
}

// ───────────────────────── Optimizer ─────────────────────────

async function runOptimizer() {
    navigateTo('optimizer');
    toggleEl('optimizer-loading', true);
    document.getElementById('optimizer-results').innerHTML = '';

    try {
        const data = await api('/optimize');
        toggleEl('optimizer-loading', false);
        renderOptimizer(data);
    } catch (err) {
        toggleEl('optimizer-loading', false);
        document.getElementById('optimizer-results').innerHTML =
            `<div class="error-msg">${escapeHtml(err.message)}</div>`;
    }
}

function renderOptimizer(data) {
    const el = document.getElementById('optimizer-results');

    if (!data.combinations?.length) {
        el.innerHTML = '<p class="no-providers">No streaming platforms found for your watchlist titles in Egypt.</p>';
        return;
    }

    let html = `<p class="optimizer-summary">Analysing <strong>${data.total_titles}</strong> titles from your watchlist</p>`;

    data.combinations.forEach(combo => {
        const platforms = combo.platforms.map(p => `
            <div class="optimizer-platform">
                <img src="${TMDB_IMG}/original${p.logo_path}" alt="${escapeAttr(p.name)}">
                <span>${escapeHtml(p.name)}</span>
                ${p.price ? `<span class="price">${p.price} EGP</span>` : ''}
            </div>`).join('');

        html += `
            <div class="optimizer-combo">
                <h3>${combo.num_platforms} Platform${combo.num_platforms > 1 ? 's' : ''}</h3>
                <div class="optimizer-platforms">${platforms}</div>
                <div class="coverage-bar">
                    <div class="coverage-fill" style="width:${combo.percentage}%"></div>
                </div>
                <div class="optimizer-stats">
                    <span>Coverage: ${combo.coverage} / ${combo.total} titles (${combo.percentage}%)</span>
                    ${combo.monthly_cost ? `<span>Cost: ~${combo.monthly_cost} EGP/month</span>` : ''}
                </div>
                <details class="covered-details">
                    <summary>Show covered titles</summary>
                    <ul>${combo.covered_titles.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>
                </details>
            </div>`;
    });

    if (data.not_available?.length) {
        html += `
            <div class="optimizer-combo not-available">
                <h3>Not Streamable in Egypt</h3>
                <p class="muted" style="margin-bottom:.5rem">These titles aren't on any Egyptian streaming platform.</p>
                <ul>${data.not_available.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>
            </div>`;
    }

    el.innerHTML = html;
}

// ───────────────────────── Episode Calendar ─────────────────────────

let calendarLoaded = false;

async function loadCalendar() {
    // Reload each time to catch watchlist changes
    const content = document.getElementById('calendar-content');
    toggleEl('calendar-loading', true);
    toggleEl('calendar-empty', false);
    content.innerHTML = '';

    try {
        const data = await api('/calendar');
        toggleEl('calendar-loading', false);

        if (!data.episodes.length) {
            toggleEl('calendar-empty', true);
            return;
        }
        renderCalendar(data);
        calendarLoaded = true;
    } catch (err) {
        toggleEl('calendar-loading', false);
        content.innerHTML = `<div class="error-msg">${escapeHtml(err.message)}</div>`;
    }
}

function renderCalendar(data) {
    const container = document.getElementById('calendar-content');
    const episodes = data.episodes;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Collect unique shows for filter pills
    const shows = new Map();
    episodes.forEach(ep => {
        if (!shows.has(ep.show_id)) {
            shows.set(ep.show_id, ep.show_name);
        }
    });

    // Summary stats
    const thisWeek = episodes.filter(ep => {
        const d = new Date(ep.air_date + 'T00:00:00');
        const diff = (d - today) / 86400000;
        return diff >= 0 && diff < 7;
    }).length;

    const thisMonth = episodes.filter(ep => {
        const d = new Date(ep.air_date + 'T00:00:00');
        const diff = (d - today) / 86400000;
        return diff >= 0 && diff < 30;
    }).length;

    let html = `
        <div class="cal-summary">
            <div class="cal-stat">
                <div class="cal-stat-value">${episodes.length}</div>
                <div class="cal-stat-label">Total Episodes</div>
            </div>
            <div class="cal-stat">
                <div class="cal-stat-value">${thisWeek}</div>
                <div class="cal-stat-label">This Week</div>
            </div>
            <div class="cal-stat">
                <div class="cal-stat-value">${thisMonth}</div>
                <div class="cal-stat-label">This Month</div>
            </div>
            <div class="cal-stat">
                <div class="cal-stat-value">${shows.size}</div>
                <div class="cal-stat-label">Shows</div>
            </div>
        </div>`;

    // Show filter pills
    if (shows.size > 1) {
        html += `<div class="cal-show-filters">
            <button class="filter-btn active" onclick="filterCalendar('all', this)">All</button>
            ${Array.from(shows.entries()).map(([id, name]) =>
                `<button class="filter-btn" onclick="filterCalendar(${id}, this)">${escapeHtml(name)}</button>`
            ).join('')}
        </div>`;
    }

    // Group by month, then by day
    let currentMonth = '';
    let currentDay = '';

    episodes.forEach(ep => {
        const airDate = new Date(ep.air_date + 'T00:00:00');
        const diffDays = Math.round((airDate - today) / 86400000);

        // Month header
        const monthKey = airDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
        if (monthKey !== currentMonth) {
            if (currentDay) html += '</div>'; // close previous day group
            currentMonth = monthKey;
            currentDay = '';
            html += `<div class="cal-month-label">${monthKey}</div>`;
        }

        // Day header
        const dayKey = ep.air_date;
        if (dayKey !== currentDay) {
            if (currentDay) html += '</div>'; // close previous day group
            currentDay = dayKey;
            const dayName = airDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
            const isToday = diffDays === 0;
            const relText = isToday ? 'Today'
                : diffDays === 1 ? 'Tomorrow'
                : diffDays < 7 ? `In ${diffDays} days`
                : '';
            html += `<div class="cal-day-group" data-date="${dayKey}">`;
            html += `<div class="cal-day-label ${isToday ? 'cal-today' : ''}">${dayName}${relText ? `<span class="cal-relative">${relText}</span>` : ''}</div>`;
        }

        // Episode card
        const poster = ep.show_poster ? `${TMDB_IMG}/w92${ep.show_poster}` : '';
        const epCode = `S${String(ep.season_number).padStart(2, '0')}E${String(ep.episode_number).padStart(2, '0')}`;
        const badgeClass = diffDays === 0 ? 'cal-days-today'
            : diffDays <= 7 ? 'cal-days-soon'
            : 'cal-days-later';
        const badgeText = diffDays === 0 ? 'TODAY'
            : diffDays === 1 ? '1 day'
            : `${diffDays} days`;

        html += `
            <div class="cal-episode" data-show-id="${ep.show_id}" onclick="showDetail('tv', ${ep.show_id})">
                <div class="cal-episode-poster">
                    ${poster ? `<img src="${poster}" alt="${escapeAttr(ep.show_name)}" loading="lazy">` : ''}
                </div>
                <div class="cal-episode-info">
                    <div class="cal-show-name">${escapeHtml(ep.show_name)}</div>
                    <div class="cal-ep-number">${epCode}</div>
                    ${ep.name ? `<div class="cal-ep-title">${escapeHtml(ep.name)}</div>` : ''}
                </div>
                <div class="cal-episode-countdown">
                    <span class="cal-days-badge ${badgeClass}">${badgeText}</span>
                </div>
            </div>`;
    });

    if (currentDay) html += '</div>'; // close last day group

    container.innerHTML = html;
}

function filterCalendar(showId, btn) {
    document.querySelectorAll('.cal-show-filters .filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    document.querySelectorAll('.cal-episode').forEach(el => {
        el.style.display = (showId === 'all' || parseInt(el.dataset.showId) === showId) ? '' : 'none';
    });

    // Also show/hide day groups that become empty
    document.querySelectorAll('.cal-day-group').forEach(group => {
        const visible = group.querySelectorAll('.cal-episode:not([style*="display: none"])');
        group.style.display = visible.length ? '' : 'none';
    });
}

// ───────────────────────── Utilities ─────────────────────────

function escapeHtml(str) {
    if (!str) return '';
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
}

function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function toggleEl(id, show) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !show);
}
