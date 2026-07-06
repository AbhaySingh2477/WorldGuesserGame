# World Guesser Game

World Guesser is a full-stack, real-time web application where players test their geography knowledge by attempting to pinpoint the location of famous monuments on a world map. It features both a solo mode and a real-time, synchronized 1v1 multiplayer mode.

**Live Website:** https://worldguessergame.onrender.com

**Development Journal:** https://docs.google.com/document/d/1mzG-1sO7C_DuoI-cmlqvB0tLBWkxjhAqMpVugaRJwkk/edit?usp=sharing

## Features

- **Solo Play:** A standard 5-round game where players score points based on the proximity of their guess to the actual location.
- **Online 1v1 Multiplayer:** Players can create or join private rooms using a 6-character room code to compete against a friend in real time.
- **Synchronized Rounds:** In multiplayer, rounds advance automatically when both players lock in their guesses, or when the 30-second server-enforced timer expires.
- **Anti-Cheat Security:** Strict server authoritative architecture ensures coordinates are never leaked to the client until a round concludes.
- **Minimalist UI:** A clean, dark-themed, and responsive interface designed to keep the focus on the imagery and the map.

## Architecture

The application is built using a lightweight Node.js architecture where a single server handles both static file serving and real-time WebSocket communication.

### 1. Backend (Server)
- **Framework:** Node.js with Express.js.
- **Real-time Communication:** Socket.IO handles the multiplayer room system, event broadcasting, and round timers.
- **Game State Management:** The server maintains game state entirely in-memory using JavaScript Maps (`activeSessions` for solo play, `rooms` for multiplayer). This allows for extremely fast read/write operations without the overhead of a database query.
- **Routing:** 
  - Express serves the static frontend assets (`index.html`, `style.css`, `app.js`).
  - REST endpoints (`/api/new-game`, `/api/guess`) manage the solo mode.
  - WebSocket events (`create-room`, `join-room`, `submit-guess`) manage the multiplayer flow.

### 2. Frontend (Client)
- **Framework:** Vanilla HTML, CSS, and JavaScript. No heavy frontend frameworks are used, ensuring rapid load times.
- **Mapping:** Integrates Leaflet.js rendering CARTO dark map tiles to provide an interactive, zoomable world map.
- **State Management:** The client maintains a simple local state machine (`idle`, `guessing`, `reviewing`, `locked`) to determine which UI elements to display.
- **Event Handling:** In multiplayer mode, the client listens for server-dispatched Socket.IO events (e.g., `round-start`, `timer-tick`, `round-results`) to update the DOM and draw map markers dynamically.

### 3. Anti-Cheat & Security Model
The game relies on a strict server-authoritative model to prevent cheating:
- When a round starts, the server sends **only the image URL** to the clients.
- The actual latitude and longitude coordinates are kept strictly in the server's memory.
- When a client submits a guess, the coordinates of the guess are sent to the server.
- The server uses the Haversine formula to calculate the distance and awards points.
- The actual coordinates are only broadcasted back to the clients during the `round-results` phase, strictly after both players have locked their guesses or the timer has reached zero.

### 4. Dataset Generation
- The game relies on a static JSON file (`monuments.json`).
- `fetch.js` is a utility script that runs a SPARQL query against Wikidata to dynamically fetch and generate a dataset of UNESCO World Heritage Sites, complete with names, coordinates, and image URLs.

## Tech Stack

- **Backend:** Node.js, Express, Socket.IO, UUID
- **Frontend:** HTML5, CSS3, Vanilla JavaScript
- **Maps:** Leaflet.js, OpenStreetMap, CARTO

## Installation & Running

### Prerequisites
- Node.js (v14 or higher)
- npm (Node Package Manager)

### Setup Instructions

1. Clone the repository:
   ```bash
   git clone https://github.com/AbhaySingh2477/WorldGuesserGame.git
   cd WorldGuesserGame
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Generate the dataset:
   ```bash
   node fetch.js
   ```

4. Start the server:
   ```bash
   npm start
   ```

5. Play the game:
   Open a web browser and navigate to `http://localhost:3000`. To test the multiplayer feature locally, simply open a second tab or window and join the room code generated in the first tab.
