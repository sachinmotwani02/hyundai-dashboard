// API Configuration
const API_URL = 'http://localhost:5000/light_status';
const LIVE_VIDEO_URL = 'http://localhost:5000/live';
const POLL_INTERVAL = 1000; // Poll every 1 second

// Checkbox sequences matching the frontend layout
const checkboxSequence = {
    front: [
        'headlamp-low',
        'headlamp-high',
        'drl',
        'front-fog',
        'turn-signal-front',
        'license-plate-front'
    ],
    left_side: [
        'door-handle-left',
        'repeater-lamp-left',
        'wheel-nuts-left',
        'hub-cap-left',
        'fender-left'
    ],
    right_side: [
        'door-handle-right',
        'repeater-lamp-right',
        'wheel-nuts-right',
        'hub-cap-right',
        'fender-right'
    ],
    rear: [
        'brake-lamp',
        'reverse-lamp',
        'rear-fog',
        'turn-signal-rear',
        'license-lamp',
        'license-plate-rear'
    ]
};

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

// Update checkboxes based on API data
function updateCheckboxes(data) {
    try {
        // Update Front checkboxes
        if (data.front && Array.isArray(data.front)) {
            checkboxSequence.front.forEach((id, index) => {
                const checkbox = document.getElementById(id);
                if (checkbox && index < data.front.length) {
                    checkbox.checked = data.front[index] === 1;
                }
            });
        }

        // Update Left side checkboxes
        if (data.left_side && Array.isArray(data.left_side)) {
            checkboxSequence.left_side.forEach((id, index) => {
                const checkbox = document.getElementById(id);
                if (checkbox && index < data.left_side.length) {
                    checkbox.checked = data.left_side[index] === 1;
                }
            });
        }

        // Update Right side checkboxes
        if (data.right_side && Array.isArray(data.right_side)) {
            checkboxSequence.right_side.forEach((id, index) => {
                const checkbox = document.getElementById(id);
                if (checkbox && index < data.right_side.length) {
                    checkbox.checked = data.right_side[index] === 1;
                }
            });
        }

        // Update Rear checkboxes
        if (data.rear && Array.isArray(data.rear)) {
            checkboxSequence.rear.forEach((id, index) => {
                const checkbox = document.getElementById(id);
                if (checkbox && index < data.rear.length) {
                    checkbox.checked = data.rear[index] === 1;
                }
            });
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

        // Successfully fetched live video HTML
        console.log('Received HTML length:', html.length);
        console.log('HTML preview:', html.substring(0, 200));

        videosContainer.innerHTML = html;
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
