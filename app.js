const API_BASE = '';

let sessionId = null;
let rounds = [];
let currentRoundIndex = 0;
let score = 0;
let gameState = 'waiting'; // waiting, guessing, reviewing

// Map Setup
const map = L.map('map').setView([20, 0], 2);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
}).addTo(map);

let userGuess = null;
let userMarker = null;
let secretMarker = null;
let connectionLine = null;

map.on('click', function(e) {
    if (gameState !== 'guessing') return;

    userGuess = e.latlng;
    
    if (userMarker) {
        userMarker.setLatLng(userGuess);
    } else {
        userMarker = L.marker(userGuess).addTo(map);
    }
    
    document.getElementById('coordinates').innerText = `Your Guess: ${userGuess.lat.toFixed(4)}, ${userGuess.lng.toFixed(4)}`;
    document.getElementById('action-btn').style.display = 'block';
    document.getElementById('action-btn').innerText = 'Submit Guess';
});

async function startGame() {
    document.getElementById('loading').style.display = 'flex';
    document.getElementById('game-over').style.display = 'none';
    
    try {
        const response = await fetch(`${API_BASE}/api/new-game`);
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Server error');
        }
        
        const data = await response.json();
        
        sessionId = data.sessionId;
        rounds = data.rounds;
        
        // Reset Game Data
        currentRoundIndex = 0;
        score = 0;
        document.getElementById('score-display').innerText = '0';
        
        loadRound();
        document.getElementById('loading').style.display = 'none';

    } catch (err) {
        document.getElementById('loading').innerHTML = `
            <h2>Error loading game</h2>
            <p style="color:#ef4444">${err.message}</p>
            <button style="margin-top:20px" onclick="startGame()">Retry</button>
        `;
    }
}

function loadRound() {
    if (currentRoundIndex >= rounds.length) {
        endGame();
        return;
    }

    const currentData = rounds[currentRoundIndex];
    document.getElementById('mystery-image').src = currentData.image;
    
    // UI Resets
    document.getElementById('result').innerText = "";
    document.getElementById('coordinates').innerText = "Make your guess on the map!";
    document.getElementById('action-btn').style.display = 'none';
    document.getElementById('round-display').innerText = `${currentRoundIndex + 1}/${rounds.length}`;
    document.getElementById('round-points').style.opacity = '0';
    
    // Map Resets
    if (secretMarker) {
        map.removeLayer(secretMarker);
        secretMarker = null;
    }
    if (connectionLine) {
        map.removeLayer(connectionLine);
        connectionLine = null;
    }
    if (userMarker) {
        map.removeLayer(userMarker);
        userMarker = null;
    }
    userGuess = null;
    gameState = 'guessing';
    map.setView([20, 0], 2);
}

function handleAction() {
    if (gameState === 'guessing') {
        submitGuess();
    } else if (gameState === 'reviewing') {
        currentRoundIndex++;
        loadRound();
    }
}

async function submitGuess() {
    if (!userGuess || !sessionId) return;
    
    // Lock controls
    document.getElementById('action-btn').disabled = true;
    document.getElementById('action-btn').innerText = "Calculating...";
    
    try {
        const response = await fetch(`${API_BASE}/api/guess`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sessionId,
                roundIndex: currentRoundIndex,
                userLat: userGuess.lat,
                userLng: userGuess.lng
            })
        });

        if (!response.ok) throw new Error("Validation failed");

        const data = await response.json();
        
        gameState = 'reviewing';

        // Draw actual location
        secretMarker = L.circleMarker([data.actualLat, data.actualLng], {
            color: '#ef4444',
            fillColor: '#ef4444',
            fillOpacity: 1,
            radius: 8
        }).addTo(map);
        secretMarker.bindPopup("Actual Location").openPopup();

        // Draw Line
        connectionLine = L.polyline([userGuess, [data.actualLat, data.actualLng]], {
            color: '#ef4444',
            weight: 3,
            opacity: 0.8,
            dashArray: '10, 10'
        }).addTo(map);

        map.fitBounds(connectionLine.getBounds(), { padding: [50, 50] });

        // Update Score
        score += data.points;
        document.getElementById('score-display').innerText = score;
        
        document.getElementById('result').innerText = `You were ${data.distanceKm.toFixed(0)} km away!`;
        
        const ptDisplay = document.getElementById('round-points');
        ptDisplay.innerText = `+${data.points} points`;
        ptDisplay.style.opacity = '1';

        document.getElementById('action-btn').disabled = false;
        document.getElementById('action-btn').innerText = currentRoundIndex === 4 ? "View Results" : "Next Round";

    } catch (err) {
        console.error(err);
        alert("Failed to reach server. Make sure backend is running!");
        document.getElementById('action-btn').disabled = false;
        document.getElementById('action-btn').innerText = "Submit Guess";
    }
}

function endGame() {
    gameState = 'waiting';
    document.getElementById('final-score').innerText = score;
    document.getElementById('game-over').style.display = 'flex';
}

// Kick off
startGame();
