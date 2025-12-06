// API Configuration
const STATUS_URL = 'http://localhost:5000/light_status'; // Single endpoint for both lamps and parts
const LIVE_VIDEO_URL = 'http://localhost:5000/live';
const POLL_INTERVAL = 1000; // Poll every 1 second

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
    // Extract lamps data (front and rear only have lamps in your API)
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
        const response = await fetch(STATUS_URL);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        cachedApiData = await response.json();
        updateCheckboxes();
    } catch (error) {
        console.error('Error fetching status:', error);
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
        const response = await fetch(LIVE_VIDEO_URL);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const html = await response.text();

        console.log('Received HTML length:', html.length);
        console.log('HTML preview:', html.substring(0, 200));

        // Extract body content from full HTML document
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

// Test/Mock data for development (matching your API structure)
const MOCK_MODE = true; // Set to false when APIs are ready

const mockApiData = {
    // Front lamps
    front: {
        "DRL Lamp": 0,
        "Front Hazzard Lamp": 0,
        "Front Left Turn Signal": 0,
        "Front Parking Lamp": 0,
        "Front Right Turn Signal": 0,
        "Head Lamp High Beam": 0,
        "Head Lamp Low Beam": 0
    },
    // Front parts
    front_parts: {
        "Bumper Grill": 1,
        "Front Bumper Skid": 0,
        "Front License Plate": 0,
        "Hyundai Logo Front": 0,
        "Toe Hook": 0
    },
    // Left side parts (no lamps for side views)
    left_side_parts: {
        "Bumper Molding": 1,
        "Door Handle": 1,
        "Door Molding": 1,
        "Fender Molding": 1,
        "Front Wheel": 1,
        "Left Front Wheel Hub Cap": 0,
        "Left Front Wheel Nut": 0,
        "Left Rear Door Moldingr": 0,
        "Left Rear Wheel Hub Cap": 0,
        "Left Rear Wheel Nut": 0,
        "ORVM Mirror": 1,
        "Piller Garnish": 1,
        "Rear Bumper Molding": 1,
        "Rear Door Handle": 1,
        "Rear Sill Molding": 1,
        "Rear Tape Frame": 1,
        "Rear Tape Sash": 1,
        "Rear Wheel": 1,
        "Sill Molding": 1,
        "Spoiler Garnish": 1,
        "Tape Frame": 1,
        "Tape Sash": 1
    },
    // Right side parts
    right_side_parts: {
        "Bumper Molding": 1,
        "Door Handle": 1,
        "Door Molding": 1,
        "Fender Molding": 1,
        "Front Wheel": 1,
        "ORVM Mirror": 1,
        "Piller Garnish": 1,
        "Rear Bumper Molding": 1,
        "Rear Door Handle": 1,
        "Rear Door Molding": 1,
        "Rear Piller Garnish": 1,
        "Rear Sill Molding": 1,
        "Rear Tape Frame": 1,
        "Rear Tape Sash": 1,
        "Rear Wheel": 1,
        "Right Fender Emblem": 0,
        "Right Front Wheel Hub Cap": 0,
        "Right Front Wheel Nut": 0,
        "Right Rear Wheel Hub Cap": 0,
        "Right Rear Wheel Nut": 0,
        "Right Sill Molding": 0,
        "Spoiler Garnish": 1,
        "Tape Frame": 1,
        "Tape Sash": 1
    },
    // Rear lamps
    rear: {
        "Hazzard Lamp": 0,
        "Left Turn Signal": 0,
        "License Lamp": 0,
        "Parking Lamp": 0,
        "Reverse Lamp": 0,
        "Right Turn Signal": 0
    },
    // Rear parts
    rear_parts: {
        "Antenna": 1,
        "Rear Bumper Skid": 0,
        "Rear Hyundai Logo": 1,
        "Rear Wiper": 1,
        "Roof Garnish Rack": 0,
        "Sunroof": 1,
        "Tail Gate Emblem": 1
    }
};

// Initialize on page load
console.log('Hyundai Quality Control Dashboard Initialized');
console.log('Mock Mode:', MOCK_MODE);

// Load live videos on initialization
loadLiveVideos();

if (MOCK_MODE) {
    // Use mock data for testing
    cachedApiData = mockApiData;
    updateCheckboxes();

    // Simulate dynamic updates every 3 seconds for testing
    setInterval(() => {
        // Randomly toggle some values to test dynamic sorting
        const lampSections = ['front', 'rear'];
        const partsSections = ['front_parts', 'left_side_parts', 'right_side_parts', 'rear_parts'];
        
        // 50% chance to toggle a lamp, 50% chance to toggle a part
        if (Math.random() > 0.5 && lampSections.length > 0) {
            const randomSection = lampSections[Math.floor(Math.random() * lampSections.length)];
            const sectionData = mockApiData[randomSection];
            if (sectionData) {
                const keys = Object.keys(sectionData);
                if (keys.length > 0) {
                    const randomKey = keys[Math.floor(Math.random() * keys.length)];
                    mockApiData[randomSection][randomKey] = mockApiData[randomSection][randomKey] === 1 ? 0 : 1;
                }
            }
        } else {
            const randomSection = partsSections[Math.floor(Math.random() * partsSections.length)];
            const sectionData = mockApiData[randomSection];
            if (sectionData) {
                const keys = Object.keys(sectionData);
                if (keys.length > 0) {
                    const randomKey = keys[Math.floor(Math.random() * keys.length)];
                    mockApiData[randomSection][randomKey] = mockApiData[randomSection][randomKey] === 1 ? 0 : 1;
                }
            }
        }

        cachedApiData = mockApiData;
        updateCheckboxes();
    }, 3000);
} else {
    // Start polling for status
    fetchStatus();
    setInterval(fetchStatus, POLL_INTERVAL);
}
