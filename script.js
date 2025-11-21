// API Configuration
const API_URL = 'http://localhost:5000/light_status';
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
let currentCheckboxStructure = null;

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
function createCheckboxesFromData(data) {
    const sections = {
        front: document.querySelector('.left-column .inspection-card:nth-child(1) .checklist-container'),
        left_side: document.querySelector('.left-column .inspection-card:nth-child(2) .checklist-container'),
        right_side: document.querySelector('.right-column .inspection-card:nth-child(1) .checklist-container'),
        rear: document.querySelector('.right-column .inspection-card:nth-child(2) .checklist-container')
    };

    for (const sectionName in sections) {
        const container = sections[sectionName];
        const sectionData = data[sectionName];

        if (container && sectionData && typeof sectionData === 'object') {
            container.innerHTML = '';

            for (const key in sectionData) {
                const checkboxId = `${sectionName}-${key}`;
                const label = snakeToTitleCase(key);
                const isChecked = sectionData[key] === 1;

                const itemHTML = `
                    <div class="checklist-item">
                        <input type="checkbox" id="${checkboxId}" class="checkbox" ${isChecked ? 'checked' : ''}>
                        <label for="${checkboxId}">${label}</label>
                    </div>
                `;
                container.insertAdjacentHTML('beforeend', itemHTML);
            }
        }
    }

    // Update total checkboxes count
    totalCheckboxes = document.querySelectorAll('.checkbox').length;
}

// Update checkboxes based on API data
function updateCheckboxes(data) {
    try {
        // Check if structure has changed, if so recreate checkboxes
        const dataStructure = JSON.stringify(Object.keys(data).reduce((acc, section) => {
            acc[section] = data[section] ? Object.keys(data[section]) : [];
            return acc;
        }, {}));

        if (currentCheckboxStructure !== dataStructure) {
            createCheckboxesFromData(data);
            currentCheckboxStructure = dataStructure;
        } else {
            // Just update checkbox states
            for (const sectionName in data) {
                const sectionData = data[sectionName];
                if (sectionData && typeof sectionData === 'object') {
                    for (const key in sectionData) {
                        const checkboxId = `${sectionName}-${key}`;
                        const checkbox = document.getElementById(checkboxId);
                        if (checkbox) {
                            checkbox.checked = sectionData[key] === 1;
                        }
                    }
                }
            }
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

// Fetch light status from API
async function fetchLightStatus() {
    try {
        const response = await fetch(API_URL);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        updateCheckboxes(data);
    } catch (error) {
        console.error('Error fetching light status:', error);
    }
}

// Handle checkbox change
checkboxes.forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
        updateCompletedCount();
    });
});

// Initialize on page load
updateCompletedCount();

console.log('Hyundai Quality Control Dashboard Initialized');
console.log(`Total Checkboxes: ${totalCheckboxes}`);

// Load live videos on initialization
loadLiveVideos();

// Start polling for light status
fetchLightStatus(); // Initial fetch
setInterval(fetchLightStatus, POLL_INTERVAL);
