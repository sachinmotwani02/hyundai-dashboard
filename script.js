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
function getBaseHost() {
    return window.location.hostname;
}

function getStatusUrl() {
    return `http://${getBaseHost()}:${currentPort}/light_status`;
    // return `http://192.168.1.245:5000/light_status`;
}

function getLiveVideoUrl() {
    return `http://${getBaseHost()}:${currentPort}/live`;
    // return `http://192.168.1.245:5000/live`;
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

// VIN and status tracking
let currentVin = null;
let lastOverallStatus = null;
let statusPopoverTimeout = null;


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

// Parts state mapping
// 0 = grey (not eligible for current car)
// 1 = blue (present in current car)
// 2 = yellow (required but not present)
const PARTS_STATES = {
    0: 'not-eligible',  // grey
    1: 'present',       // blue
    2: 'required'       // yellow
};

// Dynamically create checkboxes from API data
function createChecklistColumn(container, sectionName, sectionData, type) {
    if (!container || !sectionData || typeof sectionData !== 'object') {
        if (container) {
            container.innerHTML = '<div class="no-items">No items</div>';
        }
        return;
    }

    // Convert to array and sort by state for parts (required first, then present, then not-eligible)
    // For lamps: unchecked (0) first, checked (1) last
    const items = Object.entries(sectionData).sort((a, b) => {
        if (type === 'parts') {
            // Sort order: 2 (required/yellow) first, then 1 (present/blue), then 0 (not-eligible/grey)
            const order = { 2: 0, 1: 1, 0: 2 };
            return (order[a[1]] ?? 3) - (order[b[1]] ?? 3);
        }
        return a[1] - b[1];
    });

    if (items.length === 0) {
        container.innerHTML = '<div class="no-items">No items</div>';
        return;
    }

    container.innerHTML = '';

    items.forEach(([key, value]) => {
        const checkboxId = `${type}-${sectionName}-${key.replace(/\s+/g, '-')}`;
        const label = toTitleCase(key);

        if (type === 'parts') {
            // Parts have 3 states: grey (0), blue (1), yellow (2)
            const stateClass = PARTS_STATES[value] || 'not-eligible';
            const itemHTML = `
                <div class="checklist-item parts-state-${stateClass}" data-state="${value}">
                    <span class="parts-indicator"></span>
                    <label>${label}</label>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', itemHTML);
        } else {
            // Lamps use checkbox (checked/unchecked)
            const isChecked = value === 1;
            const itemHTML = `
                <div class="checklist-item">
                    <input type="checkbox" id="${checkboxId}" class="checkbox" ${isChecked ? 'checked' : ''}>
                    <label for="${checkboxId}">${label}</label>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', itemHTML);
        }
    });
}

// Map API response to UI sections (new layout: lamps top, parts bottom)
function mapApiDataToSections(apiData) {
    // Front lamps only (top left card)
    const frontLamps = apiData.front || null;

    // Rear lamps only (top right card)
    const rearLamps = apiData.rear || null;

    // Left side parts
    const leftParts = apiData.left_side_parts || null;

    // Right side parts
    const rightParts = apiData.right_side_parts || null;

    return { frontLamps, rearLamps, leftParts, rightParts };
}

function createCheckboxesFromData(frontLamps, rearLamps, leftParts, rightParts) {
    // New layout: 4 cards with specific content
    const cards = {
        frontLamps: {
            card: document.getElementById('front-lamps-card'),
            data: frontLamps,
            type: 'lamps',
            name: 'front'
        },
        rearLamps: {
            card: document.getElementById('rear-lamps-card'),
            data: rearLamps,
            type: 'lamps',
            name: 'rear'
        },
        leftParts: {
            card: document.getElementById('left-parts-card'),
            data: leftParts,
            type: 'parts',
            name: 'left'
        },
        rightParts: {
            card: document.getElementById('right-parts-card'),
            data: rightParts,
            type: 'parts',
            name: 'right'
        }
    };

    for (const cardKey in cards) {
        const { card, data, type, name } = cards[cardKey];
        if (!card) continue;

        const hasData = data && Object.keys(data).length > 0;

        // Find or create the checklist container
        let checklistContainer = card.querySelector('.checklist-container');
        if (!checklistContainer) {
            // Remove old dual container if exists
            const oldContainer = card.querySelector('.dual-checklist-container');
            if (oldContainer) oldContainer.remove();

            // Create new single checklist container
            checklistContainer = document.createElement('div');
            checklistContainer.className = `checklist-container ${type}-checklist`;
            card.appendChild(checklistContainer);
        }

        // Populate checklist
        if (hasData) {
            createChecklistColumn(checklistContainer, name, data, type);
        } else {
            checklistContainer.innerHTML = '<div class="no-items">No inspection items</div>';
        }
    }

    // Update total checkboxes count
    totalCheckboxes = document.querySelectorAll('.checkbox').length;
}

// Cached API data
let cachedApiData = null;

// Update VIN display
function updateVinDisplay(vin) {
    const vinCodeElement = document.getElementById('vin-code');
    if (vinCodeElement && vin) {
        if (currentVin !== vin) {
            console.log('[VIN] Updated:', vin);
        }
        vinCodeElement.textContent = vin;
        currentVin = vin;
    }
}

// Show status popover
function showStatusPopover(status) {
    const popover = document.getElementById('status-popover');
    const popoverIcon = document.getElementById('popover-icon');
    const popoverText = document.getElementById('popover-text');

    if (!popover || !popoverIcon || !popoverText) return;

    // Clear any existing timeout
    if (statusPopoverTimeout) {
        clearTimeout(statusPopoverTimeout);
    }

    // Set icon and text based on status
    // 0 = OK (passed), 1 = NG (failed)
    const isSuccess = status === 0;

    console.log('[STATUS] Showing popover:', isSuccess ? 'PASSED (0)' : 'FAILED (1)');

    popoverIcon.className = 'popover-icon ' + (isSuccess ? 'success' : 'failure');
    popoverText.className = 'popover-text ' + (isSuccess ? 'success' : 'failure');
    popoverText.textContent = isSuccess ? 'Test Passed' : 'Test Failed';

    // Show popover
    popover.classList.add('show');

    // Hide after 8 seconds
    statusPopoverTimeout = setTimeout(() => {
        console.log('[STATUS] Hiding popover');
        popover.classList.remove('show');
    }, 8000);
}

// Check if status changed and show popover
// Status: 0 = OK (passed), 1 = NG (failed), 2 = Wait (no popover)
function handleStatusChange(newStatus) {
    const statusNames = { 0: 'OK', 1: 'NG', 2: 'WAIT' };

    // Log status change
    if (lastOverallStatus !== newStatus) {
        console.log(`[STATUS] Changed: ${statusNames[lastOverallStatus] ?? 'null'} → ${statusNames[newStatus] ?? newStatus}`);
    }

    // Status 2 means waiting - don't show popover
    if (newStatus === 2) {
        console.log('[STATUS] Wait state - no popover');
        lastOverallStatus = newStatus;
        return;
    }

    // Only show popover if status changed to 0 or 1
    if (lastOverallStatus !== newStatus && (newStatus === 0 || newStatus === 1)) {
        showStatusPopover(newStatus);
    }
    lastOverallStatus = newStatus;
}

// Fetch status from unified endpoint
async function fetchStatus() {
    try {
        const response = await fetch(getStatusUrl());
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();

        // Log API response for VIN and status
        console.log('[API] Response:', {
            vin: data.vin,
            overall_status: data.overall_status,
            url: getStatusUrl()
        });

        cachedApiData = data;

        // Update VIN display
        if (data.vin) {
            updateVinDisplay(data.vin);
        }

        // Handle status change (0 = OK, 1 = NG, 2 = Wait)
        if (data.overall_status !== undefined) {
            handleStatusChange(data.overall_status);
        }

        updateCheckboxes();
    } catch (error) {
        console.error('[API] Error fetching status:', error);
    }
}

// Update checkboxes based on API data
function updateCheckboxes() {
    try {
        if (!cachedApiData) return;

        // Map API data to new sections (lamps top, parts bottom)
        const { frontLamps, rearLamps, leftParts, rightParts } = mapApiDataToSections(cachedApiData);

        // Always recreate to ensure proper sorting based on current state
        createCheckboxesFromData(frontLamps, rearLamps, leftParts, rightParts);

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

// Get or create video content wrapper (preserves VIN display and popover)
function getVideoContentWrapper() {
    let wrapper = videosContainer.querySelector('.video-content-wrapper');
    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.className = 'video-content-wrapper';
        videosContainer.appendChild(wrapper);
    }
    return wrapper;
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

        // Insert the extracted body content into wrapper (preserves VIN and popover)
        const wrapper = getVideoContentWrapper();
        wrapper.innerHTML = bodyContent;
        isLiveVideoLoaded = true;

        console.log('Live video feed loaded successfully');
        console.log('Videos container children:', videosContainer.children.length);
        console.log('Container display:', window.getComputedStyle(videosContainer).display);
        console.log('Container height:', window.getComputedStyle(videosContainer).height);
    } catch (error) {
        console.error('Error loading live videos:', error);
        console.log('Falling back to static images');

        // Fallback to static images
        const wrapper = getVideoContentWrapper();
        if (isLiveVideoLoaded || !wrapper.innerHTML) {
            // If it was previously loaded but now failed, or no content, show static images
            wrapper.innerHTML = `
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
    currentVin = null;
    lastOverallStatus = null;

    // Reset VIN display
    const vinCodeElement = document.getElementById('vin-code');
    if (vinCodeElement) {
        vinCodeElement.textContent = '--';
    }

    // Reload everything for the new booth
    loadLiveVideos();
    fetchStatus();
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
