const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(__dirname));

const DATASET_CACHE = [];
let isDatasetReady = false;

// 1. Dataset Loader - Load Local Monuments JSON
function initializeDataset() {
    const filePath = 'monuments.json';
    
    if (!fs.existsSync(filePath)) {
        console.error(`Critical Error: ${filePath} not found. Please run 'node fetch.js' first!`);
        return;
    }

    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        DATASET_CACHE.push(...data);
        isDatasetReady = true;
        console.log(`Dataset ready! Lightning fast load of ${DATASET_CACHE.length} beautiful monuments.`);
    } catch(err) {
        console.error("Failed to parse monument dataset:", err);
    }
}

// Start loading the dataset
initializeDataset();

// Keep track of active games to hide coordinates from the frontend
const activeSessions = new Map();

// 2. Endpoint to start a new game
app.get('/api/new-game', (req, res) => {
    if (!isDatasetReady) {
        return res.status(503).json({ error: "Dataset is still downloading. Please try again in a few seconds." });
    }
    
    if (DATASET_CACHE.length < 5) {
        return res.status(500).json({ error: "Not enough locations loaded from the dataset." });
    }

    // Randomly select 5 unique rows (images)
    const selected = [];
    const usedIndices = new Set();
    while (selected.length < 5) {
        const idx = Math.floor(Math.random() * DATASET_CACHE.length);
        if (!usedIndices.has(idx)) {
            usedIndices.add(idx);
            selected.push(DATASET_CACHE[idx]);
        }
    }

    const sessionId = uuidv4();
    activeSessions.set(sessionId, selected);

    // KEEPS the Latitude/Longitude hidden on the server. Send ONLY the image URLs.
    const clientRounds = selected.map(loc => ({ image: loc.url }));
    res.json({ sessionId, rounds: clientRounds });
});

// Haversine formula (6371km radius)
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the Earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// 3. Endpoint to validate a guess
app.post('/api/guess', (req, res) => {
    const { sessionId, roundIndex, userLat, userLng } = req.body;

    if (!activeSessions.has(sessionId)) {
        return res.status(404).json({ error: "Game session not found or expired." });
    }

    const sessionData = activeSessions.get(sessionId);
    if (roundIndex < 0 || roundIndex >= sessionData.length) {
        return res.status(400).json({ error: "Invalid round index." });
    }

    const actualLocation = sessionData[roundIndex];
    
    // Calculates the real distance
    const distanceKm = getDistance(userLat, userLng, actualLocation.lat, actualLocation.lng);
    
    // Simple point decay logic (max 5000)
    const points = Math.max(0, 5000 - Math.floor(distanceKm));

    // Cleanup session if game is over (optional for memory management)
    if (roundIndex === 4) {
        activeSessions.delete(sessionId);
    }

    // Returns data to frontend for map drawing
    res.json({
        distanceKm,
        points,
        actualLat: actualLocation.lat,
        actualLng: actualLocation.lng
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`World Guesser backend running on http://localhost:${PORT}`);
});
