// State to hold the current border polygon so we can remove it on new search
let currentSearchBorder = null;

// Initialize the map (Centered on New York by default)
const map = L.map('map', {
    zoomControl: false // Move zoom control if needed, or disable
}).setView([40.7128, -74.0060], 10);

// Add custom zoom control to the bottom right
L.control.zoom({
    position: 'bottomright'
}).addTo(map);

// Use a premium-looking map tile layer (CartoDB Voyager)
const baseMapLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
}).addTo(map);

// Store pins mapping so we can reference them
// Structure: { id: { marker, circle } }
const pins = {};

// Helper: Generate Unique ID
const generateId = () => Math.random().toString(36).substr(2, 9);

// DOM Elements
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const loadingSpinner = document.getElementById('loading-spinner');
const errorMsg = document.getElementById('search-error');
const exportBtn = document.getElementById('export-btn');

function updateExportButtonVisibility() {
    if (Object.keys(pins).length > 0) {
        exportBtn.classList.remove('hidden');
    } else {
        exportBtn.classList.add('hidden');
    }
}

// Handle creating a new pin on the map
function createPin(lat, lng, locationName = "Dropped Pin") {
    const id = generateId();
    
    // Create the Marker (draggable)
    const marker = L.marker([lat, lng], { draggable: true }).addTo(map);
    
    // Create the Radius Circle (Default 100km)
    // Leaflet circle radius is in METERS, so 100km = 100,000m
    const defaultRadiusKm = 100;
    const circle = L.circle([lat, lng], {
        color: '#06b6d4',
        fillColor: '#06b6d4',
        fillOpacity: 0.15,
        weight: 2,
        radius: defaultRadiusKm * 1000 
    }).addTo(map);

    pins[id] = { marker, circle, locationName, radiusKm: defaultRadiusKm };
    updateExportButtonVisibility();

    // Setup Popup content
    const popupContent = document.createElement('div');
    popupContent.className = 'popup-content';
    popupContent.innerHTML = `
        <h3 class="popup-title">${locationName}</h3>
        <p class="popup-coords" id="coords-val-${id}">${lat.toFixed(5)}, ${lng.toFixed(5)}</p>
        <div class="slider-container">
            <label>Radius (km): <input type="number" id="radius-val-${id}" class="radius-number-input" value="${defaultRadiusKm}" min="1" max="5000"></label>
            <input type="range" id="radius-slider-${id}" min="1" max="5000" value="${defaultRadiusKm}">
        </div>
        <button class="remove-btn" id="remove-btn-${id}">Remove Pin</button>
    `;

    marker.bindPopup(popupContent);

    // Update circle and popup coordinates on marker drag
    marker.on('drag', (e) => {
        const newLatLng = e.latlng;
        circle.setLatLng(newLatLng);
        const coordsText = document.getElementById(`coords-val-${id}`);
        if (coordsText) {
            coordsText.textContent = `${newLatLng.lat.toFixed(5)}, ${newLatLng.lng.toFixed(5)}`;
        }
    });

    // Event listener for the slider needs to be attached after popup opens
    marker.on('popupopen', () => {
        const slider = document.getElementById(`radius-slider-${id}`);
        const valDisplay = document.getElementById(`radius-val-${id}`);
        const removeBtn = document.getElementById(`remove-btn-${id}`);
        
        const updateRadius = (newRadiusKm) => {
            if (isNaN(newRadiusKm) || newRadiusKm <= 0) return;
            pins[id].radiusKm = newRadiusKm;
            slider.value = newRadiusKm;
            valDisplay.value = newRadiusKm;
            circle.setRadius(newRadiusKm * 1000);
        };

        slider.addEventListener('input', (e) => updateRadius(parseInt(e.target.value)));
        valDisplay.addEventListener('input', (e) => updateRadius(parseInt(e.target.value)));

        removeBtn.addEventListener('click', () => {
            map.removeLayer(marker);
            map.removeLayer(circle);
            delete pins[id];
            updateExportButtonVisibility();
        });
    });

    return { marker, circle, id };
}

// Map Click Event - Drop a pin
map.on('click', async (e) => {
    const { lat, lng } = e.latlng;
    
    // Optional: Try to reverse geocode to get a name
    let locationName = "Dropped Pin";
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`);
        const data = await res.json();
        if (data && data.display_name) {
            locationName = data.display_name;
        } else if (data && data.name) {
            locationName = data.name;
        }
    } catch(err) {
        console.warn("Reverse geocoding failed", err);
    }
    
    createPin(lat, lng, locationName);
});

// Search Feature
async function performSearch() {
    const query = searchInput.value.trim();
    if (!query) return;

    // Show loading, hide error
    loadingSpinner.classList.remove('hidden');
    errorMsg.classList.add('hidden');

    try {
        // Query Nominatim API with polygon_geojson=1 to get borders
        const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&polygon_geojson=1&limit=1`);
        const results = await response.json();

        if (results.length === 0) {
            errorMsg.classList.remove('hidden');
            loadingSpinner.classList.add('hidden');
            return;
        }

        const result = results[0];
        const lat = parseFloat(result.lat);
        const lon = parseFloat(result.lon);
        const name = result.display_name || result.name || "Unknown Location";

        // 1. Remove previous border if it exists
        if (currentSearchBorder) {
            map.removeLayer(currentSearchBorder);
            currentSearchBorder = null;
        }

        // 2. Draw new border if geojson is available
        if (result.geojson) {
            currentSearchBorder = L.geoJSON(result.geojson, {
                style: {
                    color: '#06b6d4', // Cyan border for contrast
                    weight: 3,
                    opacity: 0.8,
                    fillOpacity: 0.05,
                    dashArray: '5, 10' // Stylish dashed border
                }
            }).addTo(map);
            
            // Adjust map view to fit the bounds of the border
            map.fitBounds(currentSearchBorder.getBounds());
        } else {
            // Fallback view centering if no border
            map.setView([lat, lon], 12);
        }

        // 3. Create a pin at the location with a 100km radius
        const { marker } = createPin(lat, lon, name);
        
        // Open the popup automatically
        marker.openPopup();

    } catch (error) {
        console.error("Search Error:", error);
        errorMsg.textContent = "An error occurred while searching.";
        errorMsg.classList.remove('hidden');
    } finally {
        loadingSpinner.classList.add('hidden');
    }
}

// Search interactions
searchBtn.addEventListener('click', performSearch);
searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        performSearch();
    }
});

// CSV Export Feature
exportBtn.addEventListener('click', () => {
    const pinIds = Object.keys(pins);
    if (pinIds.length === 0) return;

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Location Name,Latitude,Longitude,Radius (km)\n";

    pinIds.forEach(id => {
        const pin = pins[id];
        const latLng = pin.marker.getLatLng();
        // Escape quotes in location name
        const safeName = pin.locationName.replace(/"/g, '""');
        csvContent += `"${safeName}",${latLng.lat.toFixed(5)},${latLng.lng.toFixed(5)},${pin.radiusKm}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "pinned_locations.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

// Theme Toggle Logic
const themeToggleBtn = document.getElementById('theme-toggle');
const themeIcon = document.getElementById('theme-icon');

const sunIconPath = '<path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />';
const moonIconPath = '<path stroke-linecap="round" stroke-linejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />';

themeToggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('light-mode');
    
    if (document.body.classList.contains('light-mode')) {
        themeIcon.innerHTML = moonIconPath;
    } else {
        themeIcon.innerHTML = sunIconPath;
    }
});