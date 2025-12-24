// API Configuration
let currentPort = 5000; // Default port (Booth 1)
const POLL_INTERVAL = 1000; // Poll every 1 second

// Booth to port mapping
const BOOTH_PORTS = {
    1: 5000,
    2: 5005,
    3: 5010
};

// Get booth from URL path (/dashboard/1, /dashboard/2, /dashboard/3)
function getBoothFromUrl() {
    const path = window.location.pathname;
    const match = path.match(/\/dashboard\/(\d+)/);
    if (match) {
        const booth = parseInt(match[1]);
        if (BOOTH_PORTS[booth]) {
            return booth;
        }
    }
    return 1; // Default to booth 1
}

// Update URL without page reload
function updateUrlWithBooth(booth) {
    const newPath = `/dashboard/${booth}`;
    window.history.pushState({}, '', newPath);
}

// Dynamic URL getters
function getStatusUrl() {
    return `http://localhost:${currentPort}/light_status`;
}

function getLiveVideoUrl() {
    return `http://localhost:${currentPort}/live`;
}

function getVinUrl() {
    return `http://localhost:${currentPort}/car_vin`;
}

// Convert snake_case or space-separated to Title Case
function toTitleCase(str) {
    return str
        .split(/[_\s]+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

// Store current checkboxes structure
let currentStructure = null;

// DOM Elements
const checkboxes = document.querySelectorAll('.checkbox');
const videosContainer = document.querySelector('.videos-container');
const vinDisplay = document.getElementById('vin-display');
let totalCheckboxes = checkboxes.length;
let isLiveVideoLoaded = false;

// Update completed count
function updateCompletedCount() {
    const checkedCount = document.querySelectorAll('.checkbox:checked').length;
    console.log(`Checked: ${checkedCount}/${totalCheckboxes}`);
}

// Dynamically create checkboxes from API data
function createChecklistColumn(container, sectionName, sectionData, type) {
    if (!container || !sectionData || typeof sectionData !== 'object') {
        if (container) {
            container.innerHTML = '<div class="no-items">No items</div>';
        }
        return;
    }

    // Convert to array and sort: unchecked (0) first, checked (1) last
    const items = Object.entries(sectionData).sort((a, b) => a[1] - b[1]);

    if (items.length === 0) {
        container.innerHTML = '<div class="no-items">No items</div>';
        return;
    }

    container.innerHTML = '';

    items.forEach(([key, value]) => {
        const checkboxId = `${type}-${sectionName}-${key.replace(/\s+/g, '-')}`;
        const label = toTitleCase(key);
        const isChecked = value === 1;

        const itemHTML = `
            <div class="checklist-item">
                <input type="checkbox" id="${checkboxId}" class="checkbox" ${isChecked ? 'checked' : ''}>
                <label for="${checkboxId}">${label}</label>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', itemHTML);
    });
}

// Map API response to UI sections
function mapApiDataToSections(apiData) {
    // Extract lamps data (front and rear only have lamps in the API)
    const lampsData = {
        front: apiData.front || null,
        left_side: null, // No lamps for left side in the API
        right_side: null, // No lamps for right side in the API
        rear: apiData.rear || null
    };

    // Extract parts data
    const partsData = {
        front: apiData.front_parts || null,
        left_side: apiData.left_side_parts || null,
        right_side: apiData.right_side_parts || null,
        rear: apiData.rear_parts || null
    };

    return { lampsData, partsData };
}

function createCheckboxesFromData(lampsData, partsData) {
    const sections = {
        front: {
            card: document.querySelector('.left-column .inspection-card:nth-child(1)'),
            partsContainer: null,
            lightsContainer: null
        },
        left_side: {
            card: document.querySelector('.left-column .inspection-card:nth-child(2)'),
            partsContainer: null,
            lightsContainer: null
        },
        right_side: {
            card: document.querySelector('.right-column .inspection-card:nth-child(1)'),
            partsContainer: null,
            lightsContainer: null
        },
        rear: {
            card: document.querySelector('.right-column .inspection-card:nth-child(2)'),
            partsContainer: null,
            lightsContainer: null
        }
    };

    for (const sectionName in sections) {
        const section = sections[sectionName];
        if (!section.card) continue;

        // Check if we have data for this section
        const hasParts = partsData && partsData[sectionName] && Object.keys(partsData[sectionName]).length > 0;
        const hasLamps = lampsData && lampsData[sectionName] && Object.keys(lampsData[sectionName]).length > 0;

        // Find or create the dual checklist container
        let dualContainer = section.card.querySelector('.dual-checklist-container');
        if (!dualContainer) {
            // Remove old single container if exists
            const oldContainer = section.card.querySelector('.checklist-container');
            if (oldContainer) oldContainer.remove();

            // Create new dual container structure
            dualContainer = document.createElement('div');
            dualContainer.className = 'dual-checklist-container';

            // Only show columns that have data
            if (hasParts && hasLamps) {
                dualContainer.innerHTML = `
                    <div class="checklist-column">
                        <h3 class="checklist-heading">Parts Check</h3>
                        <div class="checklist-container parts-checklist"></div>
                    </div>
                    <div class="checklist-column">
                        <h3 class="checklist-heading">Lamp Check</h3>
                        <div class="checklist-container lights-checklist"></div>
                    </div>
                `;
            } else if (hasParts) {
                dualContainer.innerHTML = `
                    <div class="checklist-column single-column">
                        <h3 class="checklist-heading">Parts Check</h3>
                        <div class="checklist-container parts-checklist"></div>
                    </div>
                `;
            } else if (hasLamps) {
                dualContainer.innerHTML = `
                    <div class="checklist-column single-column">
                        <h3 class="checklist-heading">Lamp Check</h3>
                        <div class="checklist-container lights-checklist"></div>
                    </div>
                `;
            } else {
                dualContainer.innerHTML = `
                    <div class="checklist-column single-column">
                        <div class="no-items">No inspection items</div>
                    </div>
                `;
            }

            section.card.appendChild(dualContainer);
        }

        section.partsContainer = section.card.querySelector('.parts-checklist');
        section.lightsContainer = section.card.querySelector('.lights-checklist');

        // Populate parts checklist
        if (section.partsContainer && partsData && partsData[sectionName]) {
            createChecklistColumn(section.partsContainer, sectionName, partsData[sectionName], 'parts');
        }

        // Populate lights checklist
        if (section.lightsContainer && lampsData && lampsData[sectionName]) {
            createChecklistColumn(section.lightsContainer, sectionName, lampsData[sectionName], 'lamps');
        }
    }

    // Update total checkboxes count
    totalCheckboxes = document.querySelectorAll('.checkbox').length;
}

// Cached API data
let cachedApiData = null;

// Fetch status from unified endpoint
async function fetchStatus() {
    try {
        const response = await fetch(getStatusUrl());
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        cachedApiData = await response.json();
        updateCheckboxes();
    } catch (error) {
        console.error('Error fetching status:', error);
    }
}

// Fetch and display VIN
async function fetchVin() {
    try {
        const response = await fetch(getVinUrl());
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const vin = await response.text();
        updateVinDisplay(vin.trim());
    } catch (error) {
        console.error('Error fetching VIN:', error);
        updateVinDisplay('');
    }
}

// Update VIN display element
function updateVinDisplay(vin) {
    if (!vinDisplay) return;

    if (vin && vin.length > 0) {
        vinDisplay.innerHTML = `<span class="vin-label">VIN:</span><span class="vin-value">${vin}</span>`;
        vinDisplay.classList.add('visible');
    } else {
        vinDisplay.innerHTML = '';
        vinDisplay.classList.remove('visible');
    }
}

// Update checkboxes based on API data
function updateCheckboxes() {
    try {
        if (!cachedApiData) return;

        // Map API data to sections
        const { lampsData, partsData } = mapApiDataToSections(cachedApiData);

        // Always recreate to ensure proper sorting based on current state
        createCheckboxesFromData(lampsData, partsData);

        // Update the structure tracking
        const newStructure = JSON.stringify(cachedApiData);
        if (currentStructure !== newStructure) {
            currentStructure = newStructure;
            console.log('Structure updated');
        }

        updateCompletedCount();
    } catch (error) {
        console.error('Error updating checkboxes:', error);
    }
}

// Fetch and load live video feed
async function loadLiveVideos() {
    try {
        const response = await fetch(getLiveVideoUrl());
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const html = await response.text();

        console.log('Received HTML length:', html.length);
        console.log('HTML preview:', html.substring(0, 200));

        // Extract body content from full HTML document
        // Create a temporary DOM parser to extract body content
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const bodyContent = doc.body ? doc.body.innerHTML : html;

        // Insert the extracted body content
        videosContainer.innerHTML = bodyContent;
        isLiveVideoLoaded = true;

        console.log('Live video feed loaded successfully');
        console.log('Videos container children:', videosContainer.children.length);
        console.log('Container display:', window.getComputedStyle(videosContainer).display);
        console.log('Container height:', window.getComputedStyle(videosContainer).height);
    } catch (error) {
        console.error('Error loading live videos:', error);
        console.log('Falling back to static images');

        // Fallback to static images
        if (isLiveVideoLoaded) {
            // If it was previously loaded but now failed, revert to static images
            videosContainer.innerHTML = `
                <div class="video-wrapper">
                    <img src="scene-1.png" alt="Front View" class="vehicle-image">
                </div>
                <div class="video-wrapper">
                    <img src="scene-2.png" alt="Right View" class="vehicle-image">
                </div>
                <div class="video-wrapper">
                    <img src="scene-3.png" alt="Left View" class="vehicle-image">
                </div>
                <div class="video-wrapper">
                    <img src="scene-4.png" alt="Back View" class="vehicle-image">
                </div>
            `;
            isLiveVideoLoaded = false;
        }
    }
}

// Booth selector event handler
function handleBoothChange(port, updateUrl = true) {
    currentPort = parseInt(port);
    console.log(`Switched to Booth on port ${currentPort}`);

    // Find booth number from port
    const boothNumber = Object.keys(BOOTH_PORTS).find(key => BOOTH_PORTS[key] === currentPort);

    // Update URL if needed
    if (updateUrl && boothNumber) {
        updateUrlWithBooth(boothNumber);
    }

    // Reset cached data and structure
    cachedApiData = null;
    currentStructure = null;
    isLiveVideoLoaded = false;

    // Reload everything for the new booth
    loadLiveVideos();
    fetchStatus();
    fetchVin();
}

// Initialize booth selector
const boothSelect = document.getElementById('booth-select');
if (boothSelect) {
    boothSelect.addEventListener('change', (e) => {
        handleBoothChange(e.target.value);
    });
}

// Handle browser back/forward navigation
window.addEventListener('popstate', () => {
    const booth = getBoothFromUrl();
    const port = BOOTH_PORTS[booth];
    if (boothSelect) {
        boothSelect.value = port;
    }
    handleBoothChange(port, false);
});

// Initialize on page load
console.log('Hyundai Quality Control Dashboard Initialized');

// Set initial booth from URL
const initialBooth = getBoothFromUrl();
currentPort = BOOTH_PORTS[initialBooth];
if (boothSelect) {
    boothSelect.value = currentPort;
}
console.log(`Starting with Booth ${initialBooth} (port ${currentPort})`);

// Load live videos on initialization
loadLiveVideos();

// Start polling for status from API
fetchStatus();
setInterval(fetchStatus, POLL_INTERVAL);

// Fetch VIN on initialization and poll for updates
fetchVin();
setInterval(fetchVin, POLL_INTERVAL);
