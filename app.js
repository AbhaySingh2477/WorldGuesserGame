// ── World Guesser — Client ─────────────────────────────────────
const API_BASE = '';
const socket = io();

// ── State ───────────────────────────────────────────────────────
let mode = null;             // 'solo' | 'multi'
let sessionId = null;
let rounds = [];
let currentRoundIndex = 0;
let score = 0;
let gameState = 'idle';      // idle | guessing | reviewing | locked
let mySocketId = null;

// Map objects
let map = null;
let userGuess = null;
let userMarker = null;
let secretMarker = null;
let connectionLine = null;
let oppMarker = null;
let oppLine = null;

// ── Map Init ────────────────────────────────────────────────────
function initMap() {
    if (map) return;
    map = L.map('map', { zoomControl: true }).setView([20, 0], 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© <a href="https://carto.com/">CARTO</a> © <a href="https://www.openstreetmap.org/">OSM</a>',
        maxZoom: 19
    }).addTo(map);

    map.on('click', onMapClick);
}

function onMapClick(e) {
    if (gameState !== 'guessing') return;

    userGuess = e.latlng;
    if (userMarker) {
        userMarker.setLatLng(userGuess);
    } else {
        userMarker = L.circleMarker(userGuess, {
            radius: 9,
            fillColor: '#7c3aed',
            fillOpacity: 1,
            color: '#a78bfa',
            weight: 2,
        }).addTo(map);
    }

    document.getElementById('coordinates').innerText =
        `Your Guess: ${userGuess.lat.toFixed(4)}, ${userGuess.lng.toFixed(4)}`;

    const btn = document.getElementById('action-btn');
    btn.style.display = 'block';
    btn.innerText = 'Submit Guess';
    btn.disabled = false;
}

// ── Screen Manager ──────────────────────────────────────────────
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    const el = document.getElementById(screenId);
    if (el) el.classList.add('active');

    // Resize map when game screen is shown
    if (screenId === 'game-screen' && map) {
        setTimeout(() => map.invalidateSize(), 100);
    }
}

// ── Error Toast ─────────────────────────────────────────────────
let toastTimer = null;
function showError(msg) {
    const toast = document.getElementById('error-toast');
    toast.innerText = msg;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 4000);
}

// ── Helper: Points Toast ────────────────────────────────────────
function showPoints(text) {
    const el = document.getElementById('points-toast');
    el.innerText = text;
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 3000);
}

// ── Helper: Clean Map ───────────────────────────────────────────
function cleanMap() {
    if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
    if (secretMarker) { map.removeLayer(secretMarker); secretMarker = null; }
    if (connectionLine) { map.removeLayer(connectionLine); connectionLine = null; }
    if (oppMarker) { map.removeLayer(oppMarker); oppMarker = null; }
    if (oppLine) { map.removeLayer(oppLine); oppLine = null; }
    userGuess = null;
}

// ── Helper: Get Player Name ─────────────────────────────────────
function getPlayerName() {
    const input = document.getElementById('player-name-input');
    const name = (input.value || '').trim();
    return name || 'Player';
}

// ── Back To Menu ────────────────────────────────────────────────
function backToMenu() {
    document.getElementById('gameover-overlay').classList.remove('active');
    document.getElementById('mp-gameover-overlay').classList.remove('active');
    document.getElementById('loading-overlay').classList.remove('active');
    showScreen('menu-screen');
    mode = null;
    gameState = 'idle';
}

// ══════════════════════════════════════════════════════════════════
//  SOLO MODE
// ══════════════════════════════════════════════════════════════════

async function startSoloGame() {
    mode = 'solo';
    initMap();
    showScreen('game-screen');
    document.getElementById('loading-overlay').classList.add('active');
    document.getElementById('hud-timer').style.display = 'none';
    document.getElementById('mp-status-bar').classList.remove('visible');

    try {
        const res = await fetch(`${API_BASE}/api/new-game`);
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Server error');
        }
        const data = await res.json();
        sessionId = data.sessionId;
        rounds = data.rounds;
        currentRoundIndex = 0;
        score = 0;
        document.getElementById('hud-score').innerText = '0';
        document.getElementById('loading-overlay').classList.remove('active');
        loadSoloRound();
    } catch (err) {
        showError(err.message);
        document.getElementById('loading-overlay').classList.remove('active');
        backToMenu();
    }
}

function loadSoloRound() {
    if (currentRoundIndex >= rounds.length) {
        endSoloGame();
        return;
    }
    cleanMap();
    gameState = 'guessing';

    const data = rounds[currentRoundIndex];
    document.getElementById('mystery-image').src = data.image;
    document.getElementById('hud-round').innerText = `${currentRoundIndex + 1}/${rounds.length}`;
    document.getElementById('result-text').innerText = '';
    document.getElementById('coordinates').innerText = 'Click the map to place your guess!';
    document.getElementById('action-btn').style.display = 'none';
    document.getElementById('points-toast').classList.remove('visible');

    map.setView([20, 0], 2);
}

function handleAction() {
    if (mode === 'solo') {
        if (gameState === 'guessing') submitSoloGuess();
        else if (gameState === 'reviewing') { currentRoundIndex++; loadSoloRound(); }
    } else if (mode === 'multi') {
        if (gameState === 'guessing') submitMultiGuess();
    }
}

async function submitSoloGuess() {
    if (!userGuess || !sessionId) return;
    const btn = document.getElementById('action-btn');
    btn.disabled = true;
    btn.innerText = 'Calculating…';

    try {
        const res = await fetch(`${API_BASE}/api/guess`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId,
                roundIndex: currentRoundIndex,
                userLat: userGuess.lat,
                userLng: userGuess.lng,
            }),
        });
        if (!res.ok) throw new Error('Validation failed');
        const data = await res.json();

        gameState = 'reviewing';

        // Actual location marker
        secretMarker = L.circleMarker([data.actualLat, data.actualLng], {
            radius: 9,
            fillColor: '#f43f5e',
            fillOpacity: 1,
            color: '#fda4af',
            weight: 2,
        }).addTo(map);
        secretMarker.bindPopup('Actual Location').openPopup();

        // Connection line
        connectionLine = L.polyline([userGuess, [data.actualLat, data.actualLng]], {
            color: '#f43f5e',
            weight: 2,
            opacity: 0.7,
            dashArray: '8, 8',
        }).addTo(map);

        map.fitBounds(connectionLine.getBounds(), { padding: [60, 60] });

        score += data.points;
        document.getElementById('hud-score').innerText = score;
        document.getElementById('result-text').innerText = `You were ${data.distanceKm.toFixed(0)} km away!`;
        showPoints(`+${data.points} points`);

        btn.disabled = false;
        btn.innerText = currentRoundIndex === rounds.length - 1 ? 'View Results' : 'Next Round';
    } catch (err) {
        showError('Failed to reach server. Is backend running?');
        btn.disabled = false;
        btn.innerText = 'Submit Guess';
    }
}

function endSoloGame() {
    gameState = 'idle';
    document.getElementById('final-score').innerText = score;
    document.getElementById('gameover-overlay').classList.add('active');
}

// ══════════════════════════════════════════════════════════════════
//  MULTIPLAYER MODE
// ══════════════════════════════════════════════════════════════════

function createRoom() {
    const name = getPlayerName();
    socket.emit('create-room', { name });
}

function joinRoom() {
    const code = document.getElementById('room-code-input').value.trim().toUpperCase();
    if (code.length !== 6) {
        showError('Room code must be 6 characters.');
        return;
    }
    const name = getPlayerName();
    socket.emit('join-room', { code, name });
}

function leaveRoom() {
    socket.disconnect();
    socket.connect();
    showScreen('menu-screen');
}

function submitMultiGuess() {
    if (!userGuess || gameState !== 'guessing') return;
    socket.emit('submit-guess', { lat: userGuess.lat, lng: userGuess.lng });

    const btn = document.getElementById('action-btn');
    btn.disabled = true;
    btn.innerText = 'Guess Locked ✓';

    // Update your status
    document.getElementById('mp-you-indicator').className = 'status-indicator guessed';
}

// ── Socket Events ───────────────────────────────────────────────

socket.on('connect', () => {
    mySocketId = socket.id;
});

socket.on('error-msg', (data) => {
    showError(data.message);
});

socket.on('room-created', (data) => {
    document.getElementById('room-code-display').innerText = data.code;
    document.getElementById('wp-player1').innerText = data.playerName;
    document.getElementById('wp-player2').innerText = '???';
    // Make waiting badge empty
    const badges = document.querySelectorAll('#waiting-players .player-badge');
    if (badges[1]) badges[1].classList.add('empty');
    showScreen('waiting-screen');
});

socket.on('player-joined', (data) => {
    // Update waiting screen
    document.getElementById('wp-player1').innerText = data.players[0] || 'Player 1';
    document.getElementById('wp-player2').innerText = data.players[1] || 'Player 2';
    const badges = document.querySelectorAll('#waiting-players .player-badge');
    if (badges[1]) badges[1].classList.remove('empty');

    // Prep multiplayer HUD names
    // We figure out which name is ours vs opponent's when the game starts
});

socket.on('countdown', (data) => {
    const overlay = document.getElementById('countdown-overlay');
    const numEl = document.getElementById('countdown-number');
    overlay.classList.add('active');
    numEl.innerText = data.count;
    // Re-trigger animation
    numEl.style.animation = 'none';
    void numEl.offsetHeight; // reflow
    numEl.style.animation = '';
});

socket.on('round-start', (data) => {
    mode = 'multi';
    initMap();

    // Hide countdown
    document.getElementById('countdown-overlay').classList.remove('active');

    showScreen('game-screen');

    // Clean up from previous round
    cleanMap();
    gameState = 'guessing';

    // Set image
    document.getElementById('mystery-image').src = data.imageUrl;
    document.getElementById('hud-round').innerText = `${data.round}/${data.totalRounds}`;
    document.getElementById('hud-score').innerText = score;
    document.getElementById('result-text').innerText = '';
    document.getElementById('coordinates').innerText = 'Click the map to place your guess!';
    document.getElementById('action-btn').style.display = 'none';
    document.getElementById('points-toast').classList.remove('visible');

    // Timer
    const timerEl = document.getElementById('hud-timer');
    timerEl.style.display = 'flex';
    document.getElementById('timer-display').innerText = data.timer;
    timerEl.classList.remove('urgent');

    // Multiplayer status bar
    const mpBar = document.getElementById('mp-status-bar');
    mpBar.classList.add('visible');
    document.getElementById('mp-you-indicator').className = 'status-indicator thinking';
    document.getElementById('mp-opp-indicator').className = 'status-indicator thinking';

    map.setView([20, 0], 2);
});

socket.on('timer-tick', (data) => {
    const timerEl = document.getElementById('timer-display');
    timerEl.innerText = data.remaining;
    const ring = document.getElementById('hud-timer');
    if (data.remaining <= 5) {
        ring.classList.add('urgent');
    } else {
        ring.classList.remove('urgent');
    }
});

socket.on('opponent-guessed', () => {
    document.getElementById('mp-opp-indicator').className = 'status-indicator guessed';
});

socket.on('guess-locked', () => {
    gameState = 'locked';
});

socket.on('round-results', (data) => {
    gameState = 'reviewing';

    const timerEl = document.getElementById('hud-timer');
    timerEl.style.display = 'none';

    // Draw actual location
    secretMarker = L.circleMarker([data.actualLat, data.actualLng], {
        radius: 10,
        fillColor: '#fbbf24',
        fillOpacity: 1,
        color: '#fef3c7',
        weight: 2,
    }).addTo(map);
    secretMarker.bindPopup(`📍 ${data.locationName}`).openPopup();

    const bounds = L.latLngBounds([[data.actualLat, data.actualLng]]);

    // Draw each player's guess
    for (const [playerId, pData] of Object.entries(data.players)) {
        const isMe = playerId === mySocketId;
        const color = isMe ? '#7c3aed' : '#06b6d4';
        const borderColor = isMe ? '#a78bfa' : '#67e8f9';

        if (pData.didGuess) {
            const marker = L.circleMarker([pData.guessLat, pData.guessLng], {
                radius: 8,
                fillColor: color,
                fillOpacity: 1,
                color: borderColor,
                weight: 2,
            }).addTo(map);
            marker.bindPopup(`${pData.name}: ${pData.distanceKm.toFixed(0)} km`);

            const line = L.polyline(
                [[pData.guessLat, pData.guessLng], [data.actualLat, data.actualLng]],
                { color, weight: 2, opacity: 0.6, dashArray: '6, 6' }
            ).addTo(map);

            bounds.extend([pData.guessLat, pData.guessLng]);

            if (isMe) {
                userMarker = marker;
                connectionLine = line;
            } else {
                oppMarker = marker;
                oppLine = line;
            }
        }

        if (isMe) {
            score = pData.totalScore;
            document.getElementById('hud-score').innerText = score;
            if (pData.didGuess) {
                document.getElementById('result-text').innerText =
                    `You were ${pData.distanceKm.toFixed(0)} km away!`;
                showPoints(`+${pData.points} points`);
            } else {
                document.getElementById('result-text').innerText = 'You ran out of time! +0 points';
            }
        }
    }

    map.fitBounds(bounds, { padding: [60, 60] });

    // Hide action button during results
    document.getElementById('action-btn').style.display = 'none';
    document.getElementById('coordinates').innerText = `Round ${data.round} of ${data.totalRounds} complete`;
});

socket.on('game-over', (data) => {
    gameState = 'idle';
    mode = null;

    const overlay = document.getElementById('mp-gameover-overlay');
    const board = document.getElementById('mp-scoreboard');
    const title = document.getElementById('mp-result-title');

    // Build scoreboard
    const entries = Object.entries(data.scores);
    entries.sort((a, b) => b[1].score - a[1].score);

    const isTie = entries.length === 2 && entries[0][1].score === entries[1][1].score;
    const winnerId = entries[0]?.[0];
    const isWinner = winnerId === mySocketId;

    if (isTie) {
        title.innerText = "It's a Tie!";
    } else if (isWinner) {
        title.innerText = '🏆 You Win!';
    } else {
        title.innerText = 'You Lost!';
    }

    board.innerHTML = '';
    for (const [id, pData] of entries) {
        const isTop = id === winnerId && !isTie;
        const row = document.createElement('div');
        row.className = 'scoreboard-row' + (isTop ? ' winner' : '');
        row.innerHTML = `
            <span class="scoreboard-name">${pData.name}${id === mySocketId ? ' (You)' : ''}${isTop ? '<span class="winner-label">WINNER</span>' : ''}</span>
            <span class="scoreboard-score">${pData.score}</span>
        `;
        board.appendChild(row);
    }

    overlay.classList.add('active');
});

socket.on('opponent-left', (data) => {
    showError(data.message);
    setTimeout(() => backToMenu(), 2000);
});
