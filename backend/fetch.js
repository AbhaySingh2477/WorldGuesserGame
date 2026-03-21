const fs = require('fs');

async function fetchMonuments() {
    console.log("Fetching up to 300 UNESCO World Heritage Sites & Monuments from Wikidata...");
    
    // Wikidata SPARQL query for Tourist Attractions with coordinates and images
    const query = `
        SELECT ?itemLabel ?pic ?coord WHERE {
            ?item wdt:P31 wd:Q570116. 
            ?item wdt:P18 ?pic.
            ?item wdt:P625 ?coord.
            SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }
        LIMIT 300
    `;
    
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
    
    try {
        const response = await fetch(url, { headers: { 'User-Agent': 'WorldGuesserBot/1.0 (Node.js)' } });
        const data = await response.json();
        
        const monuments = [];
        for (const bind of data.results.bindings) {
            const name = bind.itemLabel.value;
            let image = bind.pic.value;
            // Convert wikipedia image URLs to direct hotlinkable HTTPS thumbnails if necessary, but Wikidata gives commons links
            // typically like http://commons.wikimedia.org/wiki/Special:FilePath/Image.jpg
            if (image.includes("http://")) {
                image = image.replace("http://", "https://");
            }

            const coordStr = bind.coord.value;
            const match = coordStr.match(/Point\(([^ ]+) ([^ ]+)\)/);
            if (match) {
                const lng = parseFloat(match[1]);
                const lat = parseFloat(match[2]);
                monuments.push({ name, url: image, lat, lng });
            }
        }
        
        fs.writeFileSync('monuments.json', JSON.stringify(monuments, null, 2));
        console.log(`Successfully generated own dataset: Saved ${monuments.length} majestic monuments to monuments.json!`);
    } catch(err) {
        console.error("Failed to fetch custom dataset:", err);
    }
}
fetchMonuments();
