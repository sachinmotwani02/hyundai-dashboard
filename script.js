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

function getOverallStatusUrl() {
    return `http://${getBaseHost()}:${currentPort}/overall_status`;
}

function getVinNumberUrl() {
    return `http://${getBaseHost()}:${currentPort}/vin_number`;
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
    // For lamps: failed (0) first, then passed (1), then not-applicable (2) at bottom
    const items = Object.entries(sectionData).sort((a, b) => {
        if (type === 'parts') {
            // Sort order: 2 (required/yellow) first, then 1 (present/blue), then 0 (not-eligible/grey)
            const order = { 2: 0, 1: 1, 0: 2 };
            return (order[a[1]] ?? 3) - (order[b[1]] ?? 3);
        }
        // Lamps sort order: 0 (failed/red) first, then 1 (passed/green), then 2 (N/A/grey) at bottom
        const lampOrder = { 0: 0, 1: 1, 2: 2 };
        return (lampOrder[a[1]] ?? 3) - (lampOrder[b[1]] ?? 3);
    });

    if (items.length === 0) {
        container.innerHTML = '<div class="no-items">No items</div>';
        return;
    }

    container.innerHTML = '';

    items.forEach(([key, value]) => {
        // Sanitize key for use in ID attribute (alphanumeric, hyphens, underscores only)
        const sanitizedKey = key.replace(/[^a-zA-Z0-9_-]/g, '-');
        const checkboxId = `${type}-${sectionName}-${sanitizedKey}`;
        const label = toTitleCase(key);

        // Create elements safely using DOM methods to prevent XSS
        const itemDiv = document.createElement('div');
        itemDiv.className = 'checklist-item';

        if (type === 'parts') {
            // Parts have 3 states: grey (0), blue (1), yellow (2)
            const stateClass = PARTS_STATES[value] || 'not-eligible';
            itemDiv.classList.add(`parts-state-${stateClass}`);
            itemDiv.dataset.state = value;

            const indicator = document.createElement('span');
            indicator.className = 'parts-indicator';

            const labelEl = document.createElement('label');
            labelEl.textContent = label;

            itemDiv.appendChild(indicator);
            itemDiv.appendChild(labelEl);
        } else {
            // Lamps: 0 = failed (red), 1 = passed (green), 2 = not applicable (grey)
            if (value === 2) {
                // Not applicable - grey indicator
                itemDiv.classList.add('lamp-state-na');
                itemDiv.dataset.state = value;

                const indicator = document.createElement('span');
                indicator.className = 'lamp-na-indicator';

                const labelEl = document.createElement('label');
                labelEl.textContent = label;

                itemDiv.appendChild(indicator);
                itemDiv.appendChild(labelEl);
            } else {
                // Lamps use checkbox (checked/unchecked)
                const isChecked = value === 1;

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = checkboxId;
                checkbox.className = 'checkbox';
                checkbox.checked = isChecked;

                const labelEl = document.createElement('label');
                labelEl.htmlFor = checkboxId;
                labelEl.textContent = label;

                itemDiv.appendChild(checkbox);
                itemDiv.appendChild(labelEl);
            }
        }

        container.appendChild(itemDiv);
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
    if (vinCodeElement && typeof vin === 'string') {
        if (currentVin !== vin) {
            console.log('[VIN] Updated:', vin);
        }
        // Show placeholder for empty string, otherwise show the VIN
        vinCodeElement.textContent = vin || '--';
        currentVin = vin;
    }
}

// Get failed lamps from cached API data (lamps with value 0)
function getFailedLamps() {
    const failedLamps = [];
    if (!cachedApiData) return failedLamps;

    // Check front lamps
    if (cachedApiData.front) {
        for (const [name, value] of Object.entries(cachedApiData.front)) {
            if (value === 0) {
                failedLamps.push({ name: toTitleCase(name), section: 'Front' });
            }
        }
    }

    // Check rear lamps
    if (cachedApiData.rear) {
        for (const [name, value] of Object.entries(cachedApiData.rear)) {
            if (value === 0) {
                failedLamps.push({ name: toTitleCase(name), section: 'Rear' });
            }
        }
    }

    return failedLamps;
}

// Show status popover
function showStatusPopover(status) {
    console.log('[POPOVER] showStatusPopover called with status:', status);

    const popover = document.getElementById('status-popover');
    const popoverIcon = document.getElementById('popover-icon');
    const popoverText = document.getElementById('popover-text');
    const failedLampsContainer = document.getElementById('failed-lamps-container');
    const failedLampsList = document.getElementById('failed-lamps-list');

    console.log('[POPOVER] DOM elements found:', {
        popover: !!popover,
        popoverIcon: !!popoverIcon,
        popoverText: !!popoverText
    });

    if (!popover || !popoverIcon || !popoverText) {
        console.error('[POPOVER] ERROR: Missing DOM elements! Cannot show popover.');
        return;
    }

    // Clear any existing timeout
    if (statusPopoverTimeout) {
        console.log('[POPOVER] Clearing existing timeout');
        clearTimeout(statusPopoverTimeout);
    }

    // Set icon and text based on status
    // 0 = OK (passed), 1 = NG (failed)
    const isSuccess = status === 0;

    console.log('[POPOVER] Setting up popover display:', isSuccess ? 'PASSED (0)' : 'FAILED (1)');

    popoverIcon.className = 'popover-icon ' + (isSuccess ? 'success' : 'failure');
    popoverText.className = 'popover-text ' + (isSuccess ? 'success' : 'failure');
    popoverText.textContent = isSuccess ? 'PASSED' : 'FAILED';

    // Handle failed lamps display
    if (failedLampsContainer && failedLampsList) {
        if (!isSuccess) {
            // Get failed lamps and display them
            const failedLamps = getFailedLamps();
            console.log('[POPOVER] Failed lamps:', failedLamps);

            if (failedLamps.length > 0) {
                // Clear existing content safely
                failedLampsList.innerHTML = '';

                // Create elements safely using textContent to prevent XSS
                failedLamps.forEach(lamp => {
                    const item = document.createElement('div');
                    item.className = 'failed-lamp-item';

                    const xSpan = document.createElement('span');
                    xSpan.className = 'failed-lamp-x';
                    xSpan.textContent = 'X';

                    const nameSpan = document.createElement('span');
                    nameSpan.className = 'failed-lamp-name';
                    nameSpan.textContent = lamp.name;

                    const sectionSpan = document.createElement('span');
                    sectionSpan.className = 'failed-lamp-section';
                    sectionSpan.textContent = `(${lamp.section})`;

                    item.appendChild(xSpan);
                    item.appendChild(nameSpan);
                    item.appendChild(sectionSpan);
                    failedLampsList.appendChild(item);
                });
                failedLampsContainer.style.display = 'block';
            } else {
                failedLampsContainer.style.display = 'none';
            }
        } else {
            // Hide failed lamps for success
            failedLampsContainer.style.display = 'none';
        }
    }

    // Show popover
    console.log('[POPOVER] Adding "show" class to popover');
    popover.classList.add('show');
    console.log('[POPOVER] Popover classList after adding show:', popover.classList.toString());
    console.log('[POPOVER] Popover computed visibility:', window.getComputedStyle(popover).visibility);
    console.log('[POPOVER] Popover computed opacity:', window.getComputedStyle(popover).opacity);

    // Hide after 8 seconds
    statusPopoverTimeout = setTimeout(() => {
        console.log('[POPOVER] Auto-hiding popover after 8 seconds');
        popover.classList.remove('show');
    }, 8000);
}

// Check if status changed and show popover
// Status: 0 = OK (passed), 1 = NG (failed), 2 = Wait (no popover)
function handleStatusChange(newStatus) {
    const statusNames = { 0: 'OK', 1: 'NG', 2: 'WAIT' };

    console.log('[STATUS] handleStatusChange called:', {
        newStatus: newStatus,
        newStatusName: statusNames[newStatus] ?? 'UNKNOWN',
        lastOverallStatus: lastOverallStatus,
        lastStatusName: statusNames[lastOverallStatus] ?? 'null',
        statusChanged: lastOverallStatus !== newStatus
    });

    // Status 2 means waiting - don't show popover
    if (newStatus === 2) {
        console.log('[STATUS] Wait state (2) received - no popover will be shown');
        lastOverallStatus = newStatus;
        return;
    }

    // Only show popover if status changed to 0 or 1
    const shouldShowPopover = lastOverallStatus !== newStatus && (newStatus === 0 || newStatus === 1);
    console.log('[STATUS] Should show popover?', shouldShowPopover, {
        statusChanged: lastOverallStatus !== newStatus,
        isValidStatus: newStatus === 0 || newStatus === 1
    });

    if (shouldShowPopover) {
        console.log('[STATUS] >>> CALLING showStatusPopover with status:', newStatus);
        showStatusPopover(newStatus);
    } else {
        console.log('[STATUS] NOT showing popover. Reasons:', {
            sameAsPrevious: lastOverallStatus === newStatus,
            invalidStatus: newStatus !== 0 && newStatus !== 1
        });
    }
    lastOverallStatus = newStatus;
}

// Fetch VIN from separate endpoint
async function fetchVinNumber() {
    const url = getVinNumberUrl();
    console.log('[API] Fetching VIN:', url);

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        console.log('[API] VIN response:', data);

        // Update VIN display - response format: { "vin": "..." }
        // Use typeof check to allow empty strings to clear the VIN
        if (typeof data.vin === 'string') {
            updateVinDisplay(data.vin);
        }
    } catch (error) {
        console.error('[API] Error fetching VIN:', error);
    }
}

// Fetch overall_status from separate endpoint via POST
async function fetchOverallStatus() {
    const url = getOverallStatusUrl();
    const payload = { value: lastOverallStatus ?? 2 };

    console.log('[API] POST overall_status:', url, 'payload:', JSON.stringify(payload));

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        console.log('[API] overall_status response status:', response.status, response.statusText);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log('[API] overall_status response data:', JSON.stringify(data));
        console.log('[API] overall_status value in response:', data.overall_status, '(type:', typeof data.overall_status + ')');

        // Handle status change (0 = OK, 1 = NG, 2 = Wait)
        if (data.overall_status !== undefined) {
            console.log('[API] >>> Calling handleStatusChange with:', data.overall_status);
            handleStatusChange(data.overall_status);
        } else {
            console.warn('[API] WARNING: overall_status not found in response. Response keys:', Object.keys(data));
        }
    } catch (error) {
        console.error('[API] Error fetching overall_status:', error.message);
        console.error('[API] Full error:', error);
    }
}

// Fetch status from unified endpoint
async function fetchStatus() {
    const url = getStatusUrl();
    console.log('[API] Fetching:', url);

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();

        // Log API response
        console.log('[API] Response received');

        cachedApiData = data;

        updateCheckboxes();
    } catch (error) {
        console.error('[API] Error fetching status:', error);
    }

    // Fetch VIN from separate endpoint
    await fetchVinNumber();

    // Fetch overall_status from separate endpoint
    await fetchOverallStatus();
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

// Verify popover DOM elements exist at startup
const popoverCheck = {
    popover: document.getElementById('status-popover'),
    icon: document.getElementById('popover-icon'),
    text: document.getElementById('popover-text')
};
console.log('[INIT] Status popover DOM check:', {
    popoverExists: !!popoverCheck.popover,
    iconExists: !!popoverCheck.icon,
    textExists: !!popoverCheck.text
});
if (!popoverCheck.popover || !popoverCheck.icon || !popoverCheck.text) {
    console.error('[INIT] ERROR: Status popover elements missing from DOM!');
}

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
