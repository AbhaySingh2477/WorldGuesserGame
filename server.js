const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ── Dataset ──────────────────────────────────────────────────
const DATASET_CACHE = [];
let isDatasetReady = false;

function initializeDataset() {
    const filePath = path.join(__dirname, 'monuments.json');
    if (!fs.existsSync(filePath)) {
        console.error(`Critical Error: ${filePath} not found. Please run 'node fetch.js' first!`);
        return;
    }
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        DATASET_CACHE.push(...data);
        isDatasetReady = true;
        console.log(`Dataset ready! ${DATASET_CACHE.length} monuments loaded.`);
    } catch (err) {
        console.error('Failed to parse monument dataset:', err);
    }
}
initializeDataset();

// ── Helpers ──────────────────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pickRandom(count) {
    const selected = [];
    const used = new Set();
    while (selected.length < count && selected.length < DATASET_CACHE.length) {
        const idx = Math.floor(Math.random() * DATASET_CACHE.length);
        if (!used.has(idx)) {
            used.add(idx);
            selected.push(DATASET_CACHE[idx]);
        }
    }
    return selected;
}

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

// ── Solo Game (existing REST endpoints) ──────────────────────
const activeSessions = new Map();

app.get('/api/new-game', (req, res) => {
    if (!isDatasetReady) return res.status(503).json({ error: 'Dataset is still loading.' });
    if (DATASET_CACHE.length < 5) return res.status(500).json({ error: 'Not enough locations.' });

    const selected = pickRandom(5);
    const sessionId = uuidv4();
    activeSessions.set(sessionId, selected);

    const clientRounds = selected.map((loc) => ({ image: loc.url }));
    res.json({ sessionId, rounds: clientRounds });
});

app.post('/api/guess', (req, res) => {
    const { sessionId, roundIndex, userLat, userLng } = req.body;
    if (!activeSessions.has(sessionId)) return res.status(404).json({ error: 'Session not found.' });

    const sessionData = activeSessions.get(sessionId);
    if (roundIndex < 0 || roundIndex >= sessionData.length) return res.status(400).json({ error: 'Invalid round.' });

    const actual = sessionData[roundIndex];
    const distanceKm = haversine(userLat, userLng, actual.lat, actual.lng);
    const points = Math.max(0, 5000 - Math.floor(distanceKm));

    if (roundIndex === 4) activeSessions.delete(sessionId);

    res.json({ distanceKm, points, actualLat: actual.lat, actualLng: actual.lng });
});

// ── Multiplayer Room System ──────────────────────────────────
const ROUND_COUNT = 5;
const ROUND_TIMER = 30;       // seconds per round
const RESULTS_DELAY = 6000;   // ms to show results before next round

const rooms = new Map();

function createRoom(hostSocket) {
    let code = generateRoomCode();
    while (rooms.has(code)) code = generateRoomCode();

    const locations = pickRandom(ROUND_COUNT);
    const room = {
        code,
        locations,
        players: new Map(),
        state: 'waiting',     // waiting | countdown | playing | results | gameover
        currentRound: 0,
        timer: null,
        timerValue: 0,
        timerInterval: null,
    };
    room.players.set(hostSocket.id, {
        socket: hostSocket,
        name: 'Player 1',
        score: 0,
        guess: null,
        confirmed: false,
    });
    rooms.set(code, room);
    return room;
}

function broadcastToRoom(room, event, data) {
    for (const [, p] of room.players) {
        p.socket.emit(event, data);
    }
}

function startCountdown(room) {
    room.state = 'countdown';
    let count = 3;
    broadcastToRoom(room, 'countdown', { count });
    room.timer = setInterval(() => {
        count--;
        if (count > 0) {
            broadcastToRoom(room, 'countdown', { count });
        } else {
            clearInterval(room.timer);
            room.timer = null;
            startRound(room);
        }
    }, 1000);
}

function startRound(room) {
    room.state = 'playing';
    const loc = room.locations[room.currentRound];

    // Reset player guesses
    for (const [, p] of room.players) {
        p.guess = null;
        p.confirmed = false;
    }

    // Send only the image URL (NEVER coordinates)
    broadcastToRoom(room, 'round-start', {
        round: room.currentRound + 1,
        totalRounds: ROUND_COUNT,
        imageUrl: loc.url,
        timer: ROUND_TIMER,
    });

    // Start timer
    room.timerValue = ROUND_TIMER;
    room.timerInterval = setInterval(() => {
        room.timerValue--;
        broadcastToRoom(room, 'timer-tick', { remaining: room.timerValue });
        if (room.timerValue <= 0) {
            clearInterval(room.timerInterval);
            room.timerInterval = null;
            endRound(room);
        }
    }, 1000);
}

function checkAllConfirmed(room) {
    let allConfirmed = true;
    for (const [, p] of room.players) {
        if (!p.confirmed) { allConfirmed = false; break; }
    }
    if (allConfirmed) {
        clearInterval(room.timerInterval);
        room.timerInterval = null;
        endRound(room);
    }
}

function endRound(room) {
    if (room.state !== 'playing') return; // prevent double-trigger
    room.state = 'results';

    const actual = room.locations[room.currentRound];
    const results = {};

    for (const [id, p] of room.players) {
        if (p.confirmed && p.guess) {
            const dist = haversine(p.guess.lat, p.guess.lng, actual.lat, actual.lng);
            const pts = Math.max(0, 5000 - Math.floor(dist));
            p.score += pts;
            results[id] = {
                name: p.name,
                guessLat: p.guess.lat,
                guessLng: p.guess.lng,
                distanceKm: dist,
                points: pts,
                totalScore: p.score,
                didGuess: true,
            };
        } else {
            results[id] = {
                name: p.name,
                guessLat: null,
                guessLng: null,
                distanceKm: null,
                points: 0,
                totalScore: p.score,
                didGuess: false,
            };
        }
    }

    broadcastToRoom(room, 'round-results', {
        round: room.currentRound + 1,
        totalRounds: ROUND_COUNT,
        actualLat: actual.lat,
        actualLng: actual.lng,
        locationName: actual.name,
        players: results,
    });

    room.currentRound++;

    if (room.currentRound >= ROUND_COUNT) {
        // Game over
        setTimeout(() => {
            room.state = 'gameover';
            const finalScores = {};
            for (const [id, p] of room.players) {
                finalScores[id] = { name: p.name, score: p.score };
            }
            broadcastToRoom(room, 'game-over', { scores: finalScores });
            rooms.delete(room.code);
        }, RESULTS_DELAY);
    } else {
        // Next round after delay
        setTimeout(() => {
            if (rooms.has(room.code)) startRound(room);
        }, RESULTS_DELAY);
    }
}

// ── Socket.IO Events ────────────────────────────────────────
io.on('connection', (socket) => {
    let currentRoom = null;

    socket.on('create-room', (data) => {
        if (!isDatasetReady) {
            socket.emit('error-msg', { message: 'Dataset is still loading. Try again shortly.' });
            return;
        }
        const room = createRoom(socket);
        const player = room.players.get(socket.id);
        player.name = data?.name || 'Player 1';
        currentRoom = room.code;
        socket.join(room.code);
        socket.emit('room-created', { code: room.code, playerName: player.name });
    });

    socket.on('join-room', (data) => {
        const code = (data.code || '').toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) {
            socket.emit('error-msg', { message: 'Room not found. Check the code and try again.' });
            return;
        }
        if (room.players.size >= 2) {
            socket.emit('error-msg', { message: 'Room is full.' });
            return;
        }
        if (room.state !== 'waiting') {
            socket.emit('error-msg', { message: 'Game already in progress.' });
            return;
        }
        const name = data?.name || 'Player 2';
        room.players.set(socket.id, {
            socket,
            name,
            score: 0,
            guess: null,
            confirmed: false,
        });
        currentRoom = room.code;
        socket.join(room.code);

        // Notify both players
        const playerNames = [];
        for (const [, p] of room.players) playerNames.push(p.name);
        broadcastToRoom(room, 'player-joined', { players: playerNames, code: room.code });

        // Start countdown
        setTimeout(() => {
            if (rooms.has(code) && room.players.size === 2) {
                startCountdown(room);
            }
        }, 1500);
    });

    socket.on('submit-guess', (data) => {
        if (!currentRoom) return;
        const room = rooms.get(currentRoom);
        if (!room || room.state !== 'playing') return;

        const player = room.players.get(socket.id);
        if (!player || player.confirmed) return;

        player.guess = { lat: data.lat, lng: data.lng };
        player.confirmed = true;

        // Tell the other player this one has guessed
        for (const [id, p] of room.players) {
            if (id !== socket.id) {
                p.socket.emit('opponent-guessed', { name: player.name });
            }
        }

        socket.emit('guess-locked', {});
        checkAllConfirmed(room);
    });

    socket.on('disconnect', () => {
        if (!currentRoom) return;
        const room = rooms.get(currentRoom);
        if (!room) return;

        room.players.delete(socket.id);

        if (room.timer) clearInterval(room.timer);
        if (room.timerInterval) clearInterval(room.timerInterval);

        if (room.players.size === 0) {
            rooms.delete(room.code);
        } else {
            broadcastToRoom(room, 'opponent-left', { message: 'Your opponent disconnected.' });
            // Clean up the room after notifying
            setTimeout(() => rooms.delete(room.code), 2000);
        }
    });
});

// ── Start Server ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`World Guesser running on http://localhost:${PORT}`);
});
