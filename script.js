// API Configuration
const LIGHT_STATUS_URL = 'http://localhost:5000/light_status';
const PARTS_STATUS_URL = 'http://localhost:5000/parts_status';
const LIVE_VIDEO_URL = 'http://localhost:5000/live';
const POLL_INTERVAL = 1000; // Poll every 1 second

// Convert snake_case to Title Case
function snakeToTitleCase(str) {
    return str
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

// Store current checkboxes structure
let currentLightStructure = null;
let currentPartsStructure = null;

// DOM Elements
const checkboxes = document.querySelectorAll('.checkbox');
const videosContainer = document.querySelector('.videos-container');
let totalCheckboxes = checkboxes.length;
let isLiveVideoLoaded = false;

// Update completed count
function updateCompletedCount() {
    const checkedCount = document.querySelectorAll('.checkbox:checked').length;
    console.log(`Checked: ${checkedCount}/${totalCheckboxes}`);
}

// Dynamically create checkboxes from API data
function createChecklistColumn(container, sectionName, sectionData, type) {
    if (!container || !sectionData || typeof sectionData !== 'object') return;

    // Convert to array and sort: unchecked (0) first, checked (1) last
    const items = Object.entries(sectionData).sort((a, b) => a[1] - b[1]);

    container.innerHTML = '';

    items.forEach(([key, value]) => {
        const checkboxId = `${type}-${sectionName}-${key}`;
        const label = snakeToTitleCase(key);
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

function createCheckboxesFromData(lightData, partsData) {
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

        // Find or create the dual checklist container
        let dualContainer = section.card.querySelector('.dual-checklist-container');
        if (!dualContainer) {
            // Remove old single container if exists
            const oldContainer = section.card.querySelector('.checklist-container');
            if (oldContainer) oldContainer.remove();

            // Create new dual container structure
            dualContainer = document.createElement('div');
            dualContainer.className = 'dual-checklist-container';
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
            section.card.appendChild(dualContainer);
        }

        section.partsContainer = section.card.querySelector('.parts-checklist');
        section.lightsContainer = section.card.querySelector('.lights-checklist');

        // Populate parts checklist
        if (partsData && partsData[sectionName]) {
            createChecklistColumn(section.partsContainer, sectionName, partsData[sectionName], 'parts');
        }

        // Populate lights checklist
        if (lightData && lightData[sectionName]) {
            createChecklistColumn(section.lightsContainer, sectionName, lightData[sectionName], 'lights');
        }
    }

    // Update total checkboxes count
    totalCheckboxes = document.querySelectorAll('.checkbox').length;
}

// Fetch and update light status
let cachedLightData = null;
let cachedPartsData = null;

async function fetchLightStatus() {
    try {
        const response = await fetch(LIGHT_STATUS_URL);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        cachedLightData = await response.json();
        updateCheckboxes();
    } catch (error) {
        console.error('Error fetching light status:', error);
    }
}

async function fetchPartsStatus() {
    try {
        const response = await fetch(PARTS_STATUS_URL);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        cachedPartsData = await response.json();
        updateCheckboxes();
    } catch (error) {
        console.error('Error fetching parts status:', error);
    }
}

// Update checkboxes based on API data
function updateCheckboxes() {
    try {
        if (!cachedLightData && !cachedPartsData) return;

        // Always recreate to ensure proper sorting based on current state
        createCheckboxesFromData(cachedLightData, cachedPartsData);

        // Update the structure tracking
        if (cachedLightData) {
            const lightStructure = JSON.stringify(Object.keys(cachedLightData).reduce((acc, section) => {
                acc[section] = cachedLightData[section] ? Object.keys(cachedLightData[section]) : [];
                return acc;
            }, {}));
            currentLightStructure = lightStructure;
        }

        if (cachedPartsData) {
            const partsStructure = JSON.stringify(Object.keys(cachedPartsData).reduce((acc, section) => {
                acc[section] = cachedPartsData[section] ? Object.keys(cachedPartsData[section]) : [];
                return acc;
            }, {}));
            currentPartsStructure = partsStructure;
        }

        updateCompletedCount();
    } catch (error) {
        console.error('Error updating checkboxes:', error);
    }
}

// Fetch and load live video feed
async function loadLiveVideos() {
    try {
        const response = await fetch(LIVE_VIDEO_URL);
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

// Test/Mock data for development
const MOCK_MODE = true; // Set to false when APIs are ready

const mockLightData = {
    front: {
        head_lamp_low: 0,
        head_lamp_high: 1,
        drl: 0,
        front_fog_lamp: 1,
        turn_signal: 1,
        license_lamp: 0
    },
    left_side: {
        left_position_lamp: 0,
        left_turn_signal: 1
    },
    right_side: {
        right_position_lamp: 1,
        right_turn_signal: 0
    },
    rear: {
        left_brake_lamp: 0,
        right_brake_lamp: 1,
        mid_brake_lamp: 1,
        reverse_lamp: 1,
        rear_fog_lamp: 0,
        left_turn_signal: 0,
        right_turn_signal: 0,
        license_lamp: 1
    }
};

const mockPartsData = {
    front: {
        fender_molding_lf: 1,
        fender_molding_rs: 0,
        fender_emblem_rs: 1,
        bumper_molding_lf: 0
    },
    left_side: {
        wheel_lf: 1,
        wheel_hub_cap_lf: 1,
        wheel_nut_lf: 0,
        brake_caliper_lf: 1,
        orvm_mirror_ls: 1,
        door_handle_lf: 0,
        door_molding_lf: 1,
        pillar_garnish_ls: 1
    },
    right_side: {
        wheel_rf: 1,
        wheel_hub_cap_rf: 0,
        wheel_nut_rf: 1,
        brake_caliper_rf: 1,
        orvm_mirror_rs: 1,
        door_handle_rf: 1,
        fender_molding_rs: 0,
        fender_emblem_rs: 1
    },
    rear: {
        spoiler_garnish_lb: 1,
        spoiler_garnish_rb: 0,
        bumper_garnish_lb: 1,
        bumper_garnish_rb: 1,
        tape_sash_lb: 0,
        tape_sash_rb: 1
    }
};

// Initialize on page load
console.log('Hyundai Quality Control Dashboard Initialized');
console.log('Mock Mode:', MOCK_MODE);

// Load live videos on initialization
loadLiveVideos();

if (MOCK_MODE) {
    // Use mock data for testing
    cachedLightData = mockLightData;
    cachedPartsData = mockPartsData;
    updateCheckboxes();

    // Simulate dynamic updates every 3 seconds for testing
    setInterval(() => {
        // Randomly change some values to test dynamic sorting
        const sections = ['front', 'left_side', 'right_side', 'rear'];
        const randomSection = sections[Math.floor(Math.random() * sections.length)];
        const sectionData = mockLightData[randomSection];
        const keys = Object.keys(sectionData);
        const randomKey = keys[Math.floor(Math.random() * keys.length)];
        mockLightData[randomSection][randomKey] = mockLightData[randomSection][randomKey] === 1 ? 0 : 1;

        cachedLightData = mockLightData;
        updateCheckboxes();
    }, 3000);
} else {
    // Start polling for both light and parts status
    fetchLightStatus();
    fetchPartsStatus();
    setInterval(() => {
        fetchLightStatus();
        fetchPartsStatus();
    }, POLL_INTERVAL);
}
