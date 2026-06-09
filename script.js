// API Configuration
let currentPort = 5000; // Default port (Booth 1)
const POLL_INTERVAL = 1000; // Poll every 1 second
const FETCH_TIMEOUT = 4000; // Abort a single request after 4s so hung sockets don't pile up
const MAX_BACKOFF = 10000;  // Cap the reconnect backoff at 10s

// fetch() wrapper that aborts after FETCH_TIMEOUT, so a dropped/half-open
// socket can't leave a request hanging forever (which is what surfaces as
// "the socket connection was closed unexpectedly").
async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

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
    return `http://${getBaseHost()}:${currentPort}/video_feed`;
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

// Blink-green pending behavior: 3 lamp keys in front/rear only.
// When cycle_state > 0 and the lamp value is 0, show a pulsing green
// (test-in-progress) instead of the default red-fail indicator.
const BLINK_LAMP_KEYS = new Set(['Left Turn Signal', 'Right Turn Signal', 'Hazzard']);
const BLINK_LAMP_SECTIONS = new Set(['front', 'rear']);
let currentCycleState = 0;

// Sequential DEMO state: while sequentialDemoActive is true, exactly ONE pair
// is "active" (blinking + enlarged) at a time — activeBlinkPair holds its key.
// Pairs not yet reached show as normal pending; completed pairs as normal ✓.
// Outside the sequential DEMO (real backend / other mocks) these stay default
// and the original "any pending special lamp blinks" behavior is used.
let activeBlinkPair = null;
let sequentialDemoActive = false;

// Fixed row order so rows never jump when their status changes — rendering
// iterates these arrays instead of sorting by status. Any incoming key not
// listed here is appended after, in its original JSON order.
const FRONT_LAMP_ORDER = [
    'Left Turn Signal', 'Right Turn Signal', 'Hazzard',
    'DRL', 'Head High Beam', 'Head Low Beam', 'Parking'
];
const REAR_LAMP_ORDER = [
    'Left Turn Signal', 'Right Turn Signal', 'Hazzard',
    'Brake', 'License', 'Parking', 'Reverse', 'Fog'
];
// Parts have no canonical list — capture key order from the first JSON load
// once (per section) and reuse it forever so parts rows also stay put.
const partsKeyOrder = {};

// Return the rendering order of keys for a section: a fixed array for lamps,
// or the first-seen key order for parts. Keeps row positions stable.
function getRowOrder(sectionName, type, sectionData) {
    const keys = Object.keys(sectionData);
    if (type === 'lamps') {
        const fixed = sectionName === 'front' ? FRONT_LAMP_ORDER
            : sectionName === 'rear' ? REAR_LAMP_ORDER : null;
        if (!fixed) return keys;
        // Listed keys first (in fixed order), then any unlisted keys appended.
        const present = fixed.filter(k => k in sectionData);
        const extras = keys.filter(k => !fixed.includes(k));
        return [...present, ...extras];
    }
    // Parts: use the matched-pairs-first ordered list (matched pairs aligned at
    // the same index in left & right, standalones below) — locked at init.
    const fixedParts = sectionName === 'left' ? PARTS_ORDER_LEFT
        : sectionName === 'right' ? PARTS_ORDER_RIGHT : null;
    if (fixedParts) {
        const present = fixedParts.filter(k => k in sectionData);
        const extras = keys.filter(k => !fixedParts.includes(k));
        return [...present, ...extras];
    }
    // Fallback: lock in the key order on first sight of this section.
    if (!partsKeyOrder[sectionName]) {
        partsKeyOrder[sectionName] = keys.slice();
    }
    const locked = partsKeyOrder[sectionName];
    const extras = keys.filter(k => !locked.includes(k));
    return [...locked.filter(k => k in sectionData), ...extras];
}

// ───────────────────────── FOUR-STAGE PAIR LIFECYCLE ─────────────────────────
// The three synchronized front/rear pairs (Left Turn → Right Turn → Hazzard)
// each walk through four stages, processed strictly one pair at a time:
//   1 WAITING     — blinking red ✗, normal size (pair not started yet)
//   2 PROCESSING  — blinking green dot + 2× text + breathing (pair under test)
//   3 DELAY       — identical visuals to stage 2 but ✓ still WITHHELD, held for
//                   PAIR_HOLD_MS after BOTH sides are detected
//   4 DONE        — static green ✓, normal size (final resting state)
// Stages are DERIVED from the live data (front/rear pass values) by
// computePairStages(); only the pair currently under test is in stage 2/3, all
// earlier pairs are in stage 4 and all later pairs in stage 1.
const PAIR_SEQUENCE = ['Left Turn Signal', 'Right Turn Signal', 'Hazzard'];

// Stage-3 hold: once both sides of a pair are detected, hold the processing
// visuals (✓ withheld) this long before snapping to stage 4. Keyed by lamp
// type, storing the timestamp the hold expires.
const PAIR_HOLD_MS = 1500;
let pairHoldUntil = {};

// Last computed stage per pair key (1..4), recomputed each render in demo mode.
let currentPairStages = {};

function lampValue(section, key) {
    return cachedApiData && cachedApiData[section] ? cachedApiData[section][key] : undefined;
}
// 1 = pass, 3 = dim/partial also counts as a pass for these lamps.
function isLampPass(v) { return v === 1 || v === 3; }
function pairBothPass(key) {
    return isLampPass(lampValue('front', key)) && isLampPass(lampValue('rear', key));
}

// Global waiting-blink gate: a row showing a red ✗ (value 0) is "waiting"
// (blinking) rather than "failed" (static) while the dashboard is awaiting an
// inspection (idle, cycle_state 0) OR the sequential DEMO is actively
// processing rows. A static result snapshot (mock fail/pass, or a real
// in-progress snapshot) shows decided statuses without the waiting blink.
function isInspectionPending() {
    return sequentialDemoActive || currentCycleState === 0;
}

// Walk the three pairs in order and assign each a stage 1..4. The first pair
// that is not yet fully done "blocks" the sequence: it is the active pair
// (stage 2, or stage 3 while inside its completion-delay hold) and every pair
// after it stays in stage 1 (waiting). Pairs before it are stage 4 (done).
function computePairStages() {
    const now = Date.now();
    const cycleActive = currentCycleState > 0;
    const stages = {};
    let blocked = false;
    for (const key of PAIR_SEQUENCE) {
        if (blocked || !cycleActive) {
            stages[key] = 1;            // waiting (blink red)
            if (!cycleActive) delete pairHoldUntil[key];
            continue;
        }
        if (pairBothPass(key)) {
            if (pairHoldUntil[key] === undefined) {
                // Both sides just detected — start the stage-3 hold and schedule
                // one re-render at its end so this pair snaps to stage 4 and the
                // next pair advances to stage 2, all in the same frame.
                pairHoldUntil[key] = now + PAIR_HOLD_MS;
                setTimeout(() => { currentStructure = null; updateCheckboxes(); }, PAIR_HOLD_MS + 50);
            }
            if (now < pairHoldUntil[key]) {
                stages[key] = 3;        // completion delay, ✓ withheld, still active
                blocked = true;
            } else {
                stages[key] = 4;        // done — let the next pair proceed
            }
        } else {
            stages[key] = 2;            // processing (active pair)
            blocked = true;
        }
    }
    return stages;
}

// Single shared blink ticker. Toggling one class on <body> flips EVERY
// blinking lamp in the same tick, so each front/rear pair stays perfectly in
// sync — no per-element timers or animations that could drift apart.
const BLINK_HALF_CYCLE = 500; // ms (1s full on/off cycle)
let blinkTicker = null;

function startBlinkTicker() {
    if (blinkTicker) return; // single timer only
    blinkTicker = setInterval(() => {
        document.body.classList.toggle('blink-off-phase');
    }, BLINK_HALF_CYCLE);
}

// Mock states mirror the sample JSON files in the project folder.
// Used by the MOCK buttons so the dashboard can be demoed without a backend.
// Canonical part-name lists for the PARTS LEFT / PARTS RIGHT panels.
// Edit these arrays to change which parts appear. NOTE: in production the
// real /light_status backend must return matching keys under
// left_side_parts / right_side_parts — these arrays only drive the demo.
const LEFT_PARTS_NAMES = [
    "Bumper Grill", "Front License Plate", "Left Bumper Molding", "Left Fender Molding",
    "Left Front Wheel Hub Cap", "Left Driver Mirror", "Left Rear Bumper Molding",
    "Left Rear Wheel", "Front Bumper Skid", "Hyundai Logo Front", "Left Door Handle",
    "Left Front Wheel Nut", "Left Pillar Garnish", "Left Rear Door Handle",
    "Left Rear Wheel Hub Cap"
];
const RIGHT_PARTS_NAMES = [
    "Antenna", "Rear Hyundai Logo", "Right Door Handle", "Right Fender Molding",
    "Right Front Wheel Hub Cap", "Right Driver Mirror", "Right Rear Bumper Molding",
    "Right Rear Wheel", "Rear Bumper Skid", "Right Bumper Molding", "Right Fender Emblem",
    "Right Front Wheel Nut", "Right Pillar Garnish", "Right Rear Door Handle",
    "Right Rear Wheel Hub Cap"
];

// Parts-matching for the DEMO: a left and right part are the SAME component on
// opposite sides if their names match after stripping the leading "Left "/
// "Right ". (Front/Rear are NOT stripped, so they stay separate parts.)
function getMatchKey(name) {
    return name.replace(/^(Left|Right)\s+/i, '').trim();
}

// Reorder both parts lists ONCE so matched left/right pairs sit at the TOP,
// aligned at the SAME index in both lists (orderedLeft[i] ↔ orderedRight[i]),
// with standalone parts below. matchedCount marks where pairs end.
function buildOrderedPartsLists(leftParts, rightParts) {
    const rightByKey = {};
    rightParts.forEach(n => { rightByKey[getMatchKey(n)] = n; });

    const matchedLeft = [];
    const matchedRight = [];
    const usedRight = new Set();

    // Pass 1: matched pairs in original-left order (kept index-aligned).
    leftParts.forEach(leftName => {
        const key = getMatchKey(leftName);
        if (rightByKey[key]) {
            matchedLeft.push(leftName);
            matchedRight.push(rightByKey[key]);
            usedRight.add(rightByKey[key]);
        }
    });

    // Pass 2: standalones (no counterpart on the other side).
    const standaloneLeft = leftParts.filter(n => !rightByKey[getMatchKey(n)]);
    const standaloneRight = rightParts.filter(n => !usedRight.has(n));

    return {
        orderedLeft: [...matchedLeft, ...standaloneLeft],
        orderedRight: [...matchedRight, ...standaloneRight],
        matchedCount: matchedLeft.length
    };
}

// Built once at init (DO NOT TOUCH API structure — this is purely demo order).
// Used both as the fixed render order (getRowOrder) and the processing order.
const { orderedLeft: PARTS_ORDER_LEFT, orderedRight: PARTS_ORDER_RIGHT, matchedCount: PARTS_MATCHED_COUNT } =
    buildOrderedPartsLists(LEFT_PARTS_NAMES, RIGHT_PARTS_NAMES);

// Build a { partName: stateValue } map from a name list, where stateValue is
// produced per-index by valueFn. Part states: 0 missing (red), 1 present (blue),
// 2 N/A (grey), 3 mismatch (yellow).
function buildPartsState(names, valueFn) {
    const out = {};
    names.forEach((name, i) => { out[name] = valueFn(i); });
    return out;
}

const MOCK_STATES = {
    idle: {
        cycle_state: 0, vin: "",
        front: { "DRL": 0, "Hazzard": 0, "Head High Beam": 0, "Head Low Beam": 0, "Left Turn Signal": 0, "Parking": 0, "Right Turn Signal": 0 },
        rear: { "Fog": 0, "Hazzard": 0, "Left Turn Signal": 0, "License": 0, "Parking": 0, "Reverse": 0, "Right Turn Signal": 0 },
        left_side_parts: buildPartsState(LEFT_PARTS_NAMES, () => 0),
        right_side_parts: buildPartsState(RIGHT_PARTS_NAMES, () => 0)
    },
    cycleActive: {
        cycle_state: 2, vin: "HQW247823",
        front: { "DRL": 1, "Hazzard": 0, "Head High Beam": 0, "Head Low Beam": 1, "Left Turn Signal": 0, "Parking": 1, "Right Turn Signal": 0 },
        rear: { "Fog": 2, "Hazzard": 0, "Left Turn Signal": 0, "License": 1, "Parking": 1, "Reverse": 1, "Right Turn Signal": 0 },
        left_side_parts: buildPartsState(LEFT_PARTS_NAMES, i => (i % 5 === 0 ? 0 : i % 5 === 3 ? 2 : 1)),
        right_side_parts: buildPartsState(RIGHT_PARTS_NAMES, i => (i % 5 === 1 ? 0 : i % 5 === 4 ? 3 : 1))
    },
    allPassed: {
        cycle_state: 2, vin: "HQW247823",
        front: { "DRL": 1, "Hazzard": 1, "Head High Beam": 1, "Head Low Beam": 1, "Left Turn Signal": 1, "Parking": 1, "Right Turn Signal": 1 },
        rear: { "Fog": 2, "Hazzard": 1, "Left Turn Signal": 1, "License": 1, "Parking": 1, "Reverse": 1, "Right Turn Signal": 1 },
        left_side_parts: buildPartsState(LEFT_PARTS_NAMES, () => 1),
        right_side_parts: buildPartsState(RIGHT_PARTS_NAMES, () => 1)
    },
    failed: {
        cycle_state: 2, vin: "HQW247823",
        front: { "DRL": 1, "Hazzard": 1, "Head High Beam": 0, "Head Low Beam": 1, "Left Turn Signal": 1, "Parking": 1, "Right Turn Signal": 1 },
        rear: { "Fog": 2, "Hazzard": 1, "Left Turn Signal": 1, "License": 0, "Parking": 1, "Reverse": 1, "Right Turn Signal": 1 },
        left_side_parts: buildPartsState(LEFT_PARTS_NAMES, i => (i % 6 === 0 ? 0 : i % 7 === 0 ? 3 : 1)),
        right_side_parts: buildPartsState(RIGHT_PARTS_NAMES, i => (i % 6 === 2 ? 0 : i % 7 === 0 ? 3 : 1))
    }
};

function applyMockState(stateName) {
    const state = MOCK_STATES[stateName];
    if (!state) return;
    // Deep-clone so the warning sim (or any later mutation) doesn't poison the baseline.
    cachedApiData = JSON.parse(JSON.stringify(state));
    currentCycleState = cachedApiData.cycle_state || 0;
    pairHoldUntil = {}; // reset pair completion holds for the new state
    currentStructure = null; // force the gate in updateCheckboxes to rebuild
    updateVinDisplay(cachedApiData.vin ?? '');
    updateCheckboxes();
}

// The 6 lamps that "pass" one-by-one during the MOCK CAR ARRIVED sequence.
const MOCK_SEQUENCE_LAMPS = [
    { section: 'front', name: 'Left Turn Signal' },
    { section: 'front', name: 'Right Turn Signal' },
    { section: 'front', name: 'Hazzard' },
    { section: 'rear', name: 'Left Turn Signal' },
    { section: 'rear', name: 'Right Turn Signal' },
    { section: 'rear', name: 'Hazzard' }
];

let mockSequenceTimeouts = [];

function clearMockSequence() {
    if (mockSequenceTimeouts.length) {
        console.log('[MOCK SEQ] Cancelling in-progress sequence');
    }
    mockSequenceTimeouts.forEach(clearTimeout);
    mockSequenceTimeouts = [];
    // Leave sequential-demo mode so other mocks / the real backend fall back to
    // the default blink behavior.
    activeBlinkPair = null;
    sequentialDemoActive = false;
}

function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// VIN and status tracking
let currentVin = null;
// Use a unique sentinel to distinguish "not yet received any API response" from "received status 2"
// This is important because null could be confused with valid states in some edge cases
let lastOverallStatus = 'UNINITIALIZED';
let statusPopoverTimeout = null;
let countdownInterval = null;
const COUNTDOWN_DURATION = 5; // 5 seconds
const IS_MOCK_TEST_ENABLED = true; // Toggle this for deployment
let initialWarningFailures = null; // Track failures when warning first shows


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

// Parts state mapping — driven from the same value source as the lamps.
// 0 = fail (red ✕), 1 = pass (green ✓), 2 = n/a (grey), 3 = warning (orange ⚠)
const PARTS_STATES = {
    0: 'fail',     // red ✕
    1: 'pass',     // green ✓
    2: 'na',       // grey
    3: 'warning'   // orange ⚠
};

// Dynamically create checkboxes from API data
function createChecklistColumn(container, sectionName, sectionData, type) {
    if (!container || !sectionData || typeof sectionData !== 'object') {
        if (container) {
            container.innerHTML = '<div class="no-items">No items</div>';
        }
        return;
    }

    // Iterate a FIXED row order (never status-sorted) so rows stay locked in
    // place — status changes only repaint icon/color, they never reorder.
    const items = getRowOrder(sectionName, type, sectionData)
        .map(key => [key, sectionData[key]]);

    if (items.length === 0) {
        container.innerHTML = '<div class="no-items">No items</div>';
        return;
    }

    container.innerHTML = '';

    items.forEach(([key, value]) => {
        // The 3 synchronized lamp types (Left/Right Turn Signal, Hazzard) in the
        // front/rear sections get the four-stage lifecycle. Everything else
        // (other lamps, all parts) goes through the unmodified logic below.
        const isBlinkPairLamp = type === 'lamps'
            && BLINK_LAMP_SECTIONS.has(sectionName)
            && BLINK_LAMP_KEYS.has(key);

        // Sanitize key for use in ID attribute (alphanumeric, hyphens, underscores only)
        const sanitizedKey = key.replace(/[^a-zA-Z0-9_-]/g, '-');
        const checkboxId = `${type}-${sectionName}-${sanitizedKey}`;
        const label = toTitleCase(key);

        // ───── Four-stage pair rows ─────
        // A value of 2 (N/A) is rendered with the normal grey indicator below;
        // every other state is driven purely by the pair's stage so that the ✓
        // can be withheld during the completion delay (stage 3).
        if (isBlinkPairLamp && value !== 2) {
            let stage;
            if (sequentialDemoActive) {
                // Sequencer is running — stage is derived for the whole sequence.
                stage = currentPairStages[key] || 1;
            } else {
                // Real backend / static mocks: show the truthful per-row status —
                // static green ✓ once this side passes, otherwise a blinking
                // red ✗ (stage 1). No green/breathing without a live sequencer.
                stage = isLampPass(value) ? 4 : 1;
            }

            const itemDiv = document.createElement('div');
            itemDiv.className = 'checklist-item lamp-pair-row';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = checkboxId;
            checkbox.className = 'checkbox';
            checkbox.checked = (stage === 4); // ✓ shown ONLY in the done stage

            if (stage === 1) {
                // Waiting — global blinking red ✗ (in unison with every other panel).
                itemDiv.classList.add('stage-waiting', 'is-waiting');
            } else if (stage === 2 || stage === 3) {
                // Identical visuals for stages 2 and 3 (✓ withheld in both):
                // blinking green dot + 2× text + breathing label.
                itemDiv.classList.add('stage-processing', 'lamp-state-blink-green', 'lamp-pair-enlarged');
            } else {
                itemDiv.classList.add('stage-done');
            }

            const labelEl = document.createElement('label');
            labelEl.htmlFor = checkboxId;
            labelEl.textContent = label;

            itemDiv.appendChild(checkbox);
            itemDiv.appendChild(labelEl);
            container.appendChild(itemDiv);
            return; // handled — skip the generic lamp/parts rendering below
        }

        // Create elements safely using DOM methods to prevent XSS
        const itemDiv = document.createElement('div');
        itemDiv.className = 'checklist-item';

        // Global waiting blink: any not-yet-decided row (red ✗, value 0) blinks
        // in unison while the inspection is pending. A decided 0 (real fail
        // snapshot) stays static so it reads as FAILED, not waiting.
        if (value === 0 && isInspectionPending()) {
            itemDiv.classList.add('is-waiting');
        }

        if (type === 'parts') {
            // Parts have 4 states: fail (0), pass (1), n/a (2), warning (3)
            const stateClass = PARTS_STATES[value] || 'na';
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
// Fill the overlay's table-like sub-data block (VIN / BOOTH / TIME).
function updatePopoverMeta() {
    const meta = document.getElementById('popover-meta');
    if (!meta) return;
    const booth = Object.keys(BOOTH_PORTS).find(k => BOOTH_PORTS[k] === currentPort) || '1';
    const vin = (currentVin && currentVin !== '--') ? currentVin : '—';
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const ts = `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    const card = (label, value, mono) =>
        `<div class="popover-meta-item"><span class="popover-meta-label">${label}</span><span class="popover-meta-value${mono ? ' mono' : ''}">${value}</span></div>`;
    meta.innerHTML = card('VIN', vin, true) + card('Booth', booth, false) + card('Time', ts, true);
}

function showStatusPopover(status) {
    console.log('[POPOVER] showStatusPopover called with status:', status);

    const popover = document.getElementById('status-popover');
    const popoverIcon = document.getElementById('popover-icon');
    const popoverText = document.getElementById('popover-text');
    const failedLampsContainer = document.getElementById('failed-lamps-container');

    if (!popover || !popoverIcon || !popoverText) {
        console.error('[POPOVER] ERROR: Missing DOM elements!');
        return;
    }

    // Clear any existing timeout
    if (statusPopoverTimeout) clearTimeout(statusPopoverTimeout);
    if (countdownInterval) clearInterval(countdownInterval);

    // Set icon and text based on status
    popoverIcon.className = 'popover-icon';
    popoverText.className = 'popover-text';

    let duration = 5; // Default 5s

    // Terminal-style status report: fill the VIN / BOOTH / TIME table block.
    updatePopoverMeta();

    if (status === 0) {
        popoverIcon.classList.add('success');
        popoverText.classList.add('success');
        popoverText.textContent = 'INSPECTION PASSED';
        if (failedLampsContainer) failedLampsContainer.style.display = 'none';
    } else if (status === 1) {
        popoverIcon.classList.add('failure');
        popoverText.classList.add('failure');
        popoverText.textContent = 'INSPECTION FAILED';
        updatePopoverFailedLamps(false);
    } else if (status === 3) {
        popoverIcon.classList.add('warning');
        popoverText.classList.add('warning');
        popoverText.textContent = 'PLEASE RETRY';
        duration = 10; // 10s for Warning

        // Capture initial failures to track live progress
        initialWarningFailures = getFailedLamps();
        updatePopoverFailedLamps(true);
    }

    // Show popover
    popover.classList.add('show');

    // Start countdown timer
    startCountdown(duration);

    // Auto-hide popover after countdown
    statusPopoverTimeout = setTimeout(() => {
        console.log('[POPOVER] Timer expired for status:', status);

        // Special case: If Warning (3) expires and we're still in Warning state, show NG (1) if failures persist
        if (status === 3 && lastOverallStatus === 3) {
            const currentFailures = getFailedLamps();
            if (currentFailures.length > 0) {
                console.log('[POPOVER] Warning timeout with failures - switching to FAILED state');
                handleStatusChange(1);
            } else {
                console.log('[POPOVER] Warning timeout but NO failures - switching to PASSED state');
                handleStatusChange(0);
            }
        } else {
            popover.classList.remove('show');
            if (countdownInterval) clearInterval(countdownInterval);
        }
    }, duration * 1000);
}

// Live-update the failed lamps list inside the popover
function updatePopoverFailedLamps(isWarningMode) {
    const failedLampsList = document.getElementById('failed-lamps-list');
    const failedLampsContainer = document.getElementById('failed-lamps-container');
    if (!failedLampsList || !failedLampsContainer) return;

    // Current failures from backend
    const currentFailures = getFailedLamps();
    console.log('[POPOVER] Updating failed lamps list. Current count:', currentFailures.length);

    // If we're in warning mode, we compare current failures with initial failures
    // to show green (passed) or red (failed)
    let displayItems = [];

    if (isWarningMode && initialWarningFailures) {
        // We want to show ALL items that were initially failed
        initialWarningFailures.forEach(initialItem => {
            const isStillFailing = currentFailures.some(f => f.name === initialItem.name && f.section === initialItem.section);
            displayItems.push({
                ...initialItem,
                status: isStillFailing ? 'failed' : 'passed'
            });
        });
    } else {
        // Normal mode (NG status 1 or first time status 3)
        displayItems = currentFailures.map(f => ({ ...f, status: 'failed' }));
    }

    if (displayItems.length > 0) {
        failedLampsList.innerHTML = '';

        displayItems.forEach(item => {
            const div = document.createElement('div');
            div.className = `failed-lamp-item status-${item.status}`;

            // If it's warning mode but not yet "passed", use orange
            if (isWarningMode && item.status === 'failed') {
                div.classList.remove('status-failed');
                div.classList.add('status-warning');
            }

            const xSpan = document.createElement('span');
            xSpan.className = 'failed-lamp-x';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'failed-lamp-name';
            nameSpan.textContent = item.name;

            const sectionSpan = document.createElement('span');
            sectionSpan.className = 'failed-lamp-section';
            sectionSpan.textContent = `(${item.section})`;

            div.appendChild(xSpan);
            div.appendChild(nameSpan);
            div.appendChild(sectionSpan);
            failedLampsList.appendChild(div);
        });

        failedLampsContainer.style.display = 'block';
    } else {
        failedLampsContainer.style.display = 'none';
    }
}

// Circular countdown timer logic
function startCountdown(duration) {
    const timerText = document.getElementById('timer-text');
    const timerProgress = document.getElementById('timer-progress');
    let timeLeft = duration;

    // Total circumference for r=45 is ~283
    const circumference = 2 * Math.PI * 45;

    if (timerText) timerText.textContent = timeLeft;
    if (timerProgress) {
        timerProgress.style.strokeDasharray = circumference;
        timerProgress.style.strokeDashoffset = 0;
    }

    if (countdownInterval) clearInterval(countdownInterval);

    countdownInterval = setInterval(() => {
        timeLeft -= 1;
        if (timeLeft < 0) timeLeft = 0;

        if (timerText) timerText.textContent = timeLeft;

        if (timerProgress) {
            const offset = circumference - (timeLeft / duration) * circumference;
            timerProgress.style.strokeDashoffset = offset;
        }

        if (timeLeft <= 0) {
            clearInterval(countdownInterval);
        }
    }, 1000);
}

// DEMO Pass banner helpers
function showPassBanner() {
    const banner = document.getElementById('pass-banner');
    if (banner) banner.classList.add('show');
}

function hidePassBanner() {
    const banner = document.getElementById('pass-banner');
    if (banner) banner.classList.remove('show');
}

// DEMO sequence: TWO concurrent tracks start together on click.
//   Track A (lamps): 3 special pairs strictly sequential (blink→tick→shrink),
//     then the non-special lamps pass one-by-one (no blink, no font change).
//   Track B (parts): name-matched left/right pairs (and standalone singles)
//     turn green one entry at a time (no blink, no font change).
// The PASS popup only fires 1s after BOTH tracks finish.
function triggerDemo() {
    console.log('[DEMO] Starting concurrent demo (Track A lamps + Track B parts)');
    clearMockSequence();
    hidePassBanner();

    // Enter sequential mode BEFORE the first render so no pending pair blinks
    // until it is explicitly activated.
    sequentialDemoActive = true;
    activeBlinkPair = null;

    // Car enters: cycle active.
    applyMockState('cycleActive');
    lastOverallStatus = 2;
    closeStatusPopover();
    updateCycleStatusBanner(2);

    // Reset all parts to pending(0) so Track B visibly processes them from red;
    // each part is then marked GREEN (✓) as its turn comes up.
    ['left_side_parts', 'right_side_parts'].forEach(sec => {
        const s = cachedApiData && cachedApiData[sec];
        if (!s) return;
        for (const k in s) { s[k] = 0; }
    });
    ['front', 'rear'].forEach(section => {
        const s = cachedApiData && cachedApiData[section];
        if (!s) return;
        for (const k in s) { if (s[k] !== 2) s[k] = 0; } // keep N/A (e.g. Fog) as-is
    });
    currentStructure = null;
    updateCheckboxes();

    // PASS popup waits for BOTH tracks. Each track flips its flag when done.
    let trackADone = false, trackBDone = false;
    const checkAllComplete = () => {
        if (!(trackADone && trackBDone)) return;
        const id = setTimeout(() => {
            sequentialDemoActive = false;
            activeBlinkPair = null;
            console.log('[DEMO] Both tracks complete → PASS');
            handleStatusChange(0);
        }, 1000);
        mockSequenceTimeouts.push(id);
    };

    // Each track gets its own INDEPENDENT timeline (both anchored at t=0) so the
    // two run concurrently; every step is cancellable via mockSequenceTimeouts.
    const makeTimeline = () => {
        let t = 0;
        return (delay, fn) => { t += delay; const id = setTimeout(fn, t); mockSequenceTimeouts.push(id); return t; };
    };

    // ─────────────── TRACK A — LAMPS (sequential within track) ───────────────
    const atA = makeTimeline();
    const PAIR_ORDER = ['Left Turn Signal', 'Right Turn Signal', 'Hazzard'];
    const BLINK_MS = 2200;            // blink duration before the pair ticks ✓
    const HOLD_MS = PAIR_HOLD_MS;     // keep ✓ + 2x visible, then shrink back
    const GAP_MS = 400;               // brief gap before a pair activates

    PAIR_ORDER.forEach((key) => {
        // Activate → front + rear blink green together (larger font).
        atA(GAP_MS, () => {
            activeBlinkPair = key;
            currentStructure = null;
            updateCheckboxes();
            console.log(`[DEMO/A] ${key} blinking (front + rear)`);
        });
        // Tick BOTH sides in the same frame → simultaneous ✓ (stays enlarged).
        atA(BLINK_MS, () => {
            if (!cachedApiData || !cachedApiData.front || !cachedApiData.rear) return;
            cachedApiData.front[key] = 1;
            cachedApiData.rear[key] = 1;
            currentStructure = null;
            updateCheckboxes();
            console.log(`[DEMO/A] ${key} passed (front + rear)`);
        });
        // Hold, then deactivate → pair shrinks to normal ✓ and the NEXT begins.
        atA(HOLD_MS, () => {
            activeBlinkPair = null;
            currentStructure = null;
            updateCheckboxes();
        });
    });

    // Step 4: non-special lamps pass one-by-one ~500ms apart (no blink/font).
    const otherLamps = [];
    [['front', FRONT_LAMP_ORDER], ['rear', REAR_LAMP_ORDER]].forEach(([section, order]) => {
        const s = cachedApiData && cachedApiData[section];
        if (!s) return;
        order.forEach(name => {
            if (BLINK_LAMP_KEYS.has(name)) return;     // specials handled above
            if (s[name] === 0) otherLamps.push({ section, name }); // skip N/A / missing
        });
    });
    otherLamps.forEach(({ section, name }) => {
        atA(500, () => {
            cachedApiData[section][name] = 1;
            currentStructure = null;
            updateCheckboxes();
            console.log(`[DEMO/A] ${section}.${name} passed`);
        });
    });
    atA(300, () => { trackADone = true; console.log('[DEMO/A] Track A done'); checkAllComplete(); });

    // ─────────────── TRACK B — PARTS (reordered: matched pairs first) ───────────────
    const atB = makeTimeline();
    const markLeft = (name) => { if (cachedApiData.left_side_parts) cachedApiData.left_side_parts[name] = 1; };  // green ✓
    const markRight = (name) => { if (cachedApiData.right_side_parts) cachedApiData.right_side_parts[name] = 1; }; // green ✓

    // Matched pairs first (top of both lists), one pair every ~400ms — left and
    // right of each pair turn green in the SAME frame.
    for (let i = 0; i < PARTS_MATCHED_COUNT; i++) {
        const left = PARTS_ORDER_LEFT[i], right = PARTS_ORDER_RIGHT[i];
        atB(400, () => {
            markLeft(left); markRight(right);
            currentStructure = null; updateCheckboxes();
            console.log(`[DEMO/B] pair: ${left} + ${right}`);
        });
    }
    // Then left-only standalones, one every ~300ms.
    for (let i = PARTS_MATCHED_COUNT; i < PARTS_ORDER_LEFT.length; i++) {
        const left = PARTS_ORDER_LEFT[i];
        atB(300, () => { markLeft(left); currentStructure = null; updateCheckboxes(); console.log(`[DEMO/B] single L: ${left}`); });
    }
    // Then right-only standalones, one every ~300ms.
    for (let i = PARTS_MATCHED_COUNT; i < PARTS_ORDER_RIGHT.length; i++) {
        const right = PARTS_ORDER_RIGHT[i];
        atB(300, () => { markRight(right); currentStructure = null; updateCheckboxes(); console.log(`[DEMO/B] single R: ${right}`); });
    }
    atB(300, () => { trackBDone = true; console.log('[DEMO/B] Track B done'); checkAllComplete(); });

    console.log(`[DEMO] Track A (${PAIR_ORDER.length} pairs + ${otherLamps.length} lamps) and Track B (${PARTS_MATCHED_COUNT} part pairs + standalones) running concurrently`);
}

// Mock test functionality for local testing
function triggerMockReset() {
    console.log('[MOCK] Triggering mock RESET (idle)');
    clearMockSequence();
    applyMockState('idle');
    lastOverallStatus = 'UNINITIALIZED';
    closeStatusPopover();
    updateCycleStatusBanner(2);
}

function triggerMockCarArrived() {
    console.log('[MOCK] Triggering mock CAR ARRIVED sequence');
    clearMockSequence();

    // Step 1: car enters, cycle starts, 6 lamps begin blinking green
    applyMockState('cycleActive');
    lastOverallStatus = 'UNINITIALIZED';
    closeStatusPopover();
    updateCycleStatusBanner(2);

    // Step 2: pass the 6 blinking lamps in random order, 1.5-2.5s between each
    const order = shuffleArray(MOCK_SEQUENCE_LAMPS);
    let cumulativeDelay = 0;

    order.forEach((lamp, idx) => {
        const stepDelay = 1500 + Math.random() * 1000; // 1.5-2.5s
        cumulativeDelay += stepDelay;
        const isLast = idx === order.length - 1;

        const tid = setTimeout(() => {
            if (!cachedApiData || !cachedApiData[lamp.section]) return;

            console.log(`[MOCK SEQ] ✓ ${lamp.section.toUpperCase()} ${lamp.name} PASSED (${idx + 1}/${order.length})`);
            cachedApiData[lamp.section][lamp.name] = 1;

            // Step 3 prep: on the last lamp, sweep any remaining failing
            // non-blink lamps to green so the PASS state is consistent.
            if (isLast) {
                ['front', 'rear'].forEach(section => {
                    if (!cachedApiData[section]) return;
                    for (const key in cachedApiData[section]) {
                        if (cachedApiData[section][key] === 0) {
                            cachedApiData[section][key] = 1;
                        }
                    }
                });
            }

            currentStructure = null;
            updateCheckboxes();

            // Step 3: fire the PASSED popover a beat after the last lamp turns green
            if (isLast) {
                console.log('[MOCK SEQ] All lamps verified — triggering PASS');
                const passTid = setTimeout(() => handleStatusChange(0), 600);
                mockSequenceTimeouts.push(passTid);
            }
        }, cumulativeDelay);

        mockSequenceTimeouts.push(tid);
    });

    console.log(`[MOCK SEQ] Scheduled ${order.length} lamps to pass over ~${(cumulativeDelay / 1000).toFixed(1)}s`);
}

function triggerMockPass() {
    console.log('[MOCK] Triggering mock PASS');
    clearMockSequence();
    applyMockState('allPassed');
    lastOverallStatus = 'UNINITIALIZED';
    handleStatusChange(0);
}

function triggerMockFail() {
    console.log('[MOCK] Triggering mock FAIL');
    clearMockSequence();
    applyMockState('failed');
    lastOverallStatus = 'UNINITIALIZED';
    handleStatusChange(1);
}

function triggerMockWarning() {
    console.log('[MOCK] Triggering mock WARNING (10s)');
    clearMockSequence();

    // Start from a state with several lamps still pending
    applyMockState('cycleActive');
    lastOverallStatus = 'UNINITIALIZED';
    handleStatusChange(3);

    // After 3 seconds, simulate Left Turn Signal passing
    setTimeout(() => {
        if (lastOverallStatus === 3) {
            console.log('[MOCK] Simulating Front Left Turn Signal PASSED');
            cachedApiData.front["Left Turn Signal"] = 1;
            currentStructure = null;
            updateCheckboxes();
            handleStatusChange(3);
        }
    }, 3000);

    // After 6 seconds, simulate Right Turn Signal passing
    setTimeout(() => {
        if (lastOverallStatus === 3) {
            console.log('[MOCK] Simulating Front Right Turn Signal PASSED');
            cachedApiData.front["Right Turn Signal"] = 1;
            currentStructure = null;
            updateCheckboxes();
            handleStatusChange(3);
        }
    }, 6000);

    // After 9 seconds, transition to success
    setTimeout(() => {
        if (lastOverallStatus === 3) {
            console.log('[MOCK] Simulating remaining lamps PASSED');
            cachedApiData.front["Hazzard"] = 1;
            cachedApiData.front["Head High Beam"] = 1;
            cachedApiData.rear["Hazzard"] = 1;
            cachedApiData.rear["Left Turn Signal"] = 1;
            cachedApiData.rear["Right Turn Signal"] = 1;
            currentStructure = null;
            updateCheckboxes();
            handleStatusChange(0);
        }
    }, 9000);
}

// Update persistent cycle status banner
function updateCycleStatusBanner(status) {
    const banner = document.getElementById('cycle-status-value');
    if (!banner) return;

    // Remove all state classes
    banner.classList.remove('waiting', 'passed', 'failed');

    if (status === 0) {
        banner.textContent = 'PASSED';
        banner.classList.add('passed');
    } else if (status === 1) {
        banner.textContent = 'FAILED';
        banner.classList.add('failed');
    } else {
        banner.textContent = 'WAITING';
        banner.classList.add('waiting');
    }
}

function reloadVideoStream() {
    document.querySelectorAll('.quadrant-stream').forEach(img => {
        const baseUrl = getLiveVideoUrl();
        img.src = baseUrl + '?t=' + Date.now();
    });
}

let lastSrcMap = new Map()

setInterval(()=> {
    document.querySelectorAll('.quadrant-stream').forEach(img=> {
        const current = img.src

        if (lastSrcMap.get(img) === current || img.naturalWidth === 0) {
            const baseUrl = getLiveVideoUrl();
            img.src = baseUrl + '?t=' + Date.now();
        }

        lastSrcMap.set(img, current)
    })
}, 5000);

// Status: 0 = OK (passed), 1 = NG (failed), 2 = Wait (no popover), 3 = Warning (retry)
function handleStatusChange(newStatus) {
    const statusNames = { 0: 'OK', 1: 'NG', 2: 'WAIT', 3: 'WARNING' };

    // Check if this is the first API response (before any status was received)
    const isFirstResponse = lastOverallStatus === 'UNINITIALIZED';

    console.log('[STATUS] handleStatusChange called:', {
        newStatus: newStatus,
        newStatusName: statusNames[newStatus] ?? 'UNKNOWN',
        lastOverallStatus: lastOverallStatus,
        lastStatusName: isFirstResponse ? 'UNINITIALIZED' : (statusNames[lastOverallStatus] ?? 'UNKNOWN'),
        isFirstResponse: isFirstResponse,
        statusChanged: !isFirstResponse && lastOverallStatus !== newStatus
    });

    // Always update the persistent banner regardless of status
    updateCycleStatusBanner(newStatus);

    const popover = document.getElementById('status-popover');
    const isPopoverVisible = popover && popover.classList.contains('show');

    // Status 2 means waiting
    if (newStatus === 2) {
        // If a popover is currently showing, DON'T close it early.
        // Let it finish its countdown (5s or 10s) even if backend goes to Wait.
        if (isPopoverVisible) {
            console.log('[STATUS] Wait state (2) ignored - popover is currently active');
            lastOverallStatus = newStatus;
            return;
        }

        console.log('[STATUS] Wait state (2) received - cleaning up popovers');
        closeStatusPopover();
        lastOverallStatus = newStatus;
        return;
    }

    // Logic for showing/updating popover
    const isSpecialStatus = newStatus === 0 || newStatus === 1 || newStatus === 3;

    // If we're already in Warning state (3), and receive 3 again, just update the list
    if (newStatus === 3 && lastOverallStatus === 3) {
        console.log('[STATUS] Continued Warning (3) - updating popup list');
        updatePopoverFailedLamps(true);
        return;
    }

    // If it's a stable status (0 or 1) and same as before, ignore to prevent restarts
    if ((newStatus === 0 || newStatus === 1) && lastOverallStatus === newStatus && isPopoverVisible) {
        console.log(`[STATUS] Stable status (${newStatus}) same as before - ignoring restart`);
        return;
    }

    if (isSpecialStatus) {
        console.log('[STATUS] >>> CALLING showStatusPopover with status:', newStatus);
        showStatusPopover(newStatus);
    }

    if (!isFirstResponse && lastOverallStatus !== newStatus) {
        reloadVideoStream();
    }

    lastOverallStatus = newStatus;
}

// Close popover and stop timers
function closeStatusPopover() {
    const popover = document.getElementById('status-popover');
    if (popover) popover.classList.remove('show');
    if (statusPopoverTimeout) clearTimeout(statusPopoverTimeout);
    if (countdownInterval) clearInterval(countdownInterval);
}

// Fetch VIN from separate endpoint
async function fetchVinNumber() {
    const url = getVinNumberUrl();
    console.log('[API] Fetching VIN:', url);

    try {
        const response = await fetchWithTimeout(url);
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
    // Send 2 (waiting) if we haven't received any status yet, otherwise send the last known status
    const statusToSend = (lastOverallStatus === 'UNINITIALIZED' || lastOverallStatus === null) ? 2 : lastOverallStatus;
    const payload = { value: statusToSend };

    console.log('[API] POST overall_status:', url, 'payload:', JSON.stringify(payload));

    try {
        const response = await fetchWithTimeout(url, {
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

        // Handle status change (0 = OK, 1 = NG, 2 = Wait)
        // Check multiple possible field names: overall_status, status, value
        const rawStatus = data.overall_status ?? data.status ?? data.value;
        console.log('[API] overall_status raw value:', rawStatus, '(type:', typeof rawStatus + ')');

        if (rawStatus !== undefined) {
            const statusValue = Number(rawStatus);
            console.log('[API] >>> Calling handleStatusChange with:', statusValue, '(converted from:', rawStatus, typeof rawStatus + ')');
            handleStatusChange(statusValue);
        } else {
            console.warn('[API] WARNING: status not found in response. Response keys:', Object.keys(data));
        }
    } catch (error) {
        console.error('[API] Error fetching overall_status:', error.message);
        console.error('[API] Full error:', error);
    }
}

// Fetch status from unified endpoint.
// Returns true if the primary /light_status call succeeded, false otherwise,
// so the poller can decide whether to back off.
async function fetchStatus() {
    const url = getStatusUrl();
    console.log('[API] Fetching:', url);

    let ok = false;
    try {
        const response = await fetchWithTimeout(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();

        // Log API response
        console.log('[API] Response received');

        cachedApiData = data;
        currentCycleState = Number(data.cycle_state) || 0;

        updateCheckboxes();
        ok = true;
    } catch (error) {
        console.error('[API] Error fetching status:', error);
    }

    // Fetch VIN from separate endpoint
    await fetchVinNumber();

    // Fetch overall_status from separate endpoint
    await fetchOverallStatus();

    return ok;
}

// Update checkboxes based on API data
function updateCheckboxes() {
    try {
        if (!cachedApiData) return;

        // Skip DOM rebuild when nothing changed — prevents the blink-green
        // CSS animation from restarting on every 1s poll.
        const newStructure = JSON.stringify(cachedApiData);
        if (currentStructure === newStructure) return;
        currentStructure = newStructure;

        // Recompute the four-stage lifecycle for the three synchronized pairs.
        // Only meaningful while the sequencer (DEMO) is running; otherwise rows
        // fall back to truthful per-row status and no holds are tracked.
        if (sequentialDemoActive) {
            currentPairStages = computePairStages();
        } else {
            currentPairStages = {};
            pairHoldUntil = {};
        }

        // Map API data to new sections (lamps top, parts bottom)
        const { frontLamps, rearLamps, leftParts, rightParts } = mapApiDataToSections(cachedApiData);

        createCheckboxesFromData(frontLamps, rearLamps, leftParts, rightParts);

        console.log('Structure updated');

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

// Fetch and load live video feed with quad-quadrant cropping
async function loadLiveVideos() {
    try {
        // 1. Fetch cropping coordinates for the current booth
        const boothId = getBoothFromUrl();
        const configResponse = await fetch(`/config?booth=${boothId}`);
        const config = await configResponse.json();

        // 2. Clear existing content in wrapper
        const wrapper = getVideoContentWrapper();
        wrapper.innerHTML = '';

        // 3. Define the quadrants we want to display
        const quadrants = ['front', 'rear', 'left', 'right'];
        const streamUrl = getLiveVideoUrl();
        // Original-style view labels (with spaces) for the placeholder.
        const VIEW_LABELS = { front: 'FRONT VIEW', rear: 'REAR VIEW', left: 'LEFT SIDE', right: 'RIGHT SIDE' };

        // 4. Create 4 quadrants
        quadrants.forEach(quad => {
            const quadContainer = document.createElement('div');
            quadContainer.className = `quadrant-container quad-${quad}`;

            // Camera placeholder (original look): dark tile, centered view label,
            // red ● LIVE pill top-right, timestamp bottom-left.
            const placeholder = document.createElement('div');
            placeholder.className = 'camera-placeholder';
            placeholder.innerHTML = `
                <span class="cam-live"><span class="cam-live-dot"></span>LIVE</span>
                <div class="cam-center">
                    <svg class="cam-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                        <circle cx="12" cy="13" r="4"/>
                    </svg>
                    <span class="cam-label">${VIEW_LABELS[quad] || quad.toUpperCase()}</span>
                </div>
                <span class="cam-timestamp">--/--/---- --:--:--</span>`;
            quadContainer.appendChild(placeholder);

            // Set CSS variables for cropping
            if (config[quad]) {
                const [x, y, w, h] = config[quad];
                quadContainer.style.setProperty('--crop-x', x);
                quadContainer.style.setProperty('--crop-y', y);
                quadContainer.style.setProperty('--crop-w', w);
                quadContainer.style.setProperty('--crop-h', h);
            } else {
                // Fallback to defaults if config is missing
                const defaults = {
                    front: [0, 0, 50, 50],
                    rear: [50, 0, 50, 50],
                    left: [0, 50, 50, 50],
                    right: [50, 50, 50, 50]
                };
                const [x, y, w, h] = defaults[quad];
                quadContainer.style.setProperty('--crop-x', x);
                quadContainer.style.setProperty('--crop-y', y);
                quadContainer.style.setProperty('--crop-w', w);
                quadContainer.style.setProperty('--crop-h', h);
            }

            const img = document.createElement('img');
            // img.src = streamUrl;
            img.src = streamUrl + '?t=' + Date.now();
            img.className = 'quadrant-stream';
            img.alt = `${quad.toUpperCase()} VIEW`;

            img.onerror = () => {
                console.log('[VIDEO] Stream lost. Retrying...');
                setTimeout(() => {
                    const baseUrl = getLiveVideoUrl();
                    img.src = baseUrl + '?t=' + Date.now();
                }, 1000);
            };

            quadContainer.appendChild(img);
            wrapper.appendChild(quadContainer);
        });

        isLiveVideoLoaded = true;
        console.log('Live video feed with quad-cropping loaded successfully');
    } catch (error) {
        console.error('Error loading live videos:', error);
        console.log('Falling back to static images');

        // Fallback to static images
        const wrapper = getVideoContentWrapper();
        if (isLiveVideoLoaded || !wrapper.innerHTML) {
            // If it was previously loaded but now failed, or no content, show static images
            wrapper.innerHTML = `
                <div class="video-wrapper">
                    <img src="/scene-1.png" alt="Front View" class="vehicle-image">
                </div>
                <div class="video-wrapper">
                    <img src="/scene-2.png" alt="Right View" class="vehicle-image">
                </div>
                <div class="video-wrapper">
                    <img src="/scene-3.png" alt="Left View" class="vehicle-image">
                </div>
                <div class="video-wrapper">
                    <img src="/scene-4.png" alt="Back View" class="vehicle-image">
                </div>
            `;
            isLiveVideoLoaded = false;
        }
    }
}

// Booth selector event handler
// Tick the camera placeholder timestamps once a second (presentational only).
let cameraClockStarted = false;
function startCameraClock() {
    if (cameraClockStarted) return;
    cameraClockStarted = true;
    const p = (n) => String(n).padStart(2, '0');
    const tick = () => {
        const d = new Date();
        const stamp = `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
        document.querySelectorAll('.cam-timestamp').forEach(el => { el.textContent = stamp; });
    };
    tick();
    setInterval(tick, 1000);
}

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
    lastOverallStatus = 'UNINITIALIZED';

    // Reset VIN display
    const vinCodeElement = document.getElementById('vin-code');
    if (vinCodeElement) {
        vinCodeElement.textContent = '--';
    }

    // Reload everything for the new booth — restart the poll loop so backoff
    // state resets and we don't leave a stale request in flight.
    loadLiveVideos();
    startPolling();
}

// Initialize booth selector
const boothSelect = document.getElementById('booth-select');
if (boothSelect) {
    boothSelect.addEventListener('change', (e) => {
        handleBoothChange(e.target.value);
    });
}

// Initialize DEMO button
const demoBtn = document.getElementById('demo-btn');
const mockTestContainer = document.querySelector('.mock-test-container');

if (demoBtn) demoBtn.addEventListener('click', triggerDemo);

if (mockTestContainer) {
    if (IS_MOCK_TEST_ENABLED) {
        mockTestContainer.classList.remove('hidden');
    } else {
        mockTestContainer.classList.add('hidden');
    }
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

// Start the single shared blink ticker (drives all synchronized lamp blinks)
startBlinkTicker();

// Start the camera placeholder timestamp clock
startCameraClock();

// In mock mode, seed the dashboard with the idle state so the lamp cards
// render immediately (instead of showing empty placeholders when the
// backend is unreachable).
if (IS_MOCK_TEST_ENABLED) {
    applyMockState('idle');
    updateCycleStatusBanner(2);
}

// Self-scheduling poll loop (replaces setInterval) so requests can never
// overlap — the next poll is only scheduled after the current one settles.
// On repeated failures (backend down / socket dropped) it backs off
// exponentially up to MAX_BACKOFF, then snaps back to POLL_INTERVAL once a
// request succeeds again — i.e. reconnect-on-close with backoff.
let pollTimer = null;
let pollInFlight = false;
let pollFailures = 0;

async function pollOnce() {
    if (pollInFlight) return; // guard: don't fire while one is still running
    pollInFlight = true;

    let ok = false;
    try {
        ok = await fetchStatus();
    } catch (error) {
        // fetchStatus already swallows its own errors; this is just a safety net.
        console.error('[POLL] Unexpected poll error:', error);
    } finally {
        pollInFlight = false;
    }

    if (ok) {
        if (pollFailures > 0) {
            console.log('[POLL] Connection restored — resuming normal interval');
        }
        pollFailures = 0;
    } else {
        pollFailures++;
    }

    // Exponential backoff on failure: 1s, 2s, 4s, 8s, capped at MAX_BACKOFF.
    const delay = ok
        ? POLL_INTERVAL
        : Math.min(POLL_INTERVAL * (2 ** pollFailures), MAX_BACKOFF);

    if (pollFailures > 0) {
        console.log(`[POLL] Retry in ${delay}ms (consecutive failures: ${pollFailures})`);
    }

    pollTimer = setTimeout(pollOnce, delay);
}

function startPolling() {
    if (pollTimer) clearTimeout(pollTimer);
    pollFailures = 0;
    pollInFlight = false;
    pollOnce();
}

// Start polling for status from API
// Small delay on first fetch to ensure DOM and CSS are fully rendered
// This prevents the popup from showing before the page is visually ready
setTimeout(() => {
    console.log('[INIT] Starting first status fetch after DOM stabilization delay');
    startPolling();
}, 100);
