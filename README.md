# Hyundai Quality Control Dashboard

A real-time vehicle inspection monitoring system designed for automotive manufacturing environments. This web-based dashboard displays live inspection data from quality control booths, optimized for TV display (1920x1080) in factory settings.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Deployment](#deployment)
- [Browser Support](#browser-support)
- [Troubleshooting](#troubleshooting)

---

## Overview

The Hyundai Quality Control Dashboard provides real-time visibility into vehicle inspection processes. It connects to inspection booth APIs to display:

- **Lamp Inspection Results** - Front and rear lamp status checks
- **Parts Verification** - Left and right side parts presence confirmation
- **Live Video Feed** - Real-time camera feed from inspection booth
- **Vehicle Identification** - VIN display for tracking
- **Pass/Fail Status** - Prominent visual feedback for inspection results

The interface is designed for high visibility in factory environments with large text, high-contrast colors, and full-screen status notifications.

---

## Features

### Multi-Booth Support
| Booth | API Port | URL Path |
|-------|----------|----------|
| Booth 1 | 5000 | `/dashboard/1` |
| Booth 2 | 5005 | `/dashboard/2` |
| Booth 3 | 5010 | `/dashboard/3` |

### Inspection Panels

**Lamp Inspection (Front & Rear)**
| Status | Indicator | Meaning |
|--------|-----------|---------|
| 0 | Red X | Failed |
| 1 | Green Checkmark | Passed |
| 2 | Grey Dash | Not Applicable |

**Parts Verification (Left & Right)**
| Status | Color | Meaning |
|--------|-------|---------|
| 0 | Grey | Not Eligible - not required for this vehicle |
| 1 | Blue | Present - available on vehicle |
| 2 | Orange | Required - should be present but missing |

### Real-Time Updates
- 1-second polling interval for live data
- Automatic UI refresh on status changes
- Persistent cycle status banner (WAITING / PASSED / FAILED)

### Status Notifications
- Full-screen overlay on pass/fail transitions
- Large animated icons for quick recognition
- Lists all failed items for easy troubleshooting
- Auto-hides after 8 seconds

### Visual Design
- Aurora gradient background effect
- Glassmorphism UI components
- Color-coded status indicators
- Optimized for distance viewing on factory TVs

---

## Quick Start

### Prerequisites

- Python 3.x
- Modern web browser (Chrome, Firefox, Edge)
- Backend API server running on the appropriate port(s)

### Running the Dashboard

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd hyundai-dashboard
   ```

2. **Start the development server**
   ```bash
   python server.py
   ```

3. **Access the dashboard**

   Open your browser and navigate to:
   ```
   http://localhost:8000/dashboard/1
   ```

   Replace `1` with `2` or `3` to access different booths.

---

## Project Structure

```
hyundai-dashboard/
├── index.html          # Main dashboard interface
├── booth2.html         # Alternative booth layout
├── script.js           # Core application logic & API handling
├── styles.css          # Styling with animations
├── server.py           # Python HTTP server for local deployment
├── serve.json          # URL rewriting configuration
│
├── Assets/
│   ├── FrontView.svg   # Vehicle front view diagram
│   ├── BackView.svg    # Vehicle rear view diagram
│   ├── SideView.svg    # Vehicle side view diagram
│   ├── PartsIcon.svg   # Parts indicator icon
│   ├── Hyundai.png     # Hyundai logo
│   ├── DefectScanner.png  # Scanner logo
│   └── scene-1.png ... scene-4.png  # Fallback images
│
└── README.md           # This file
```

---

## Configuration

### Booth Ports

Booth-to-port mapping is configured in `script.js`:

```javascript
const BOOTH_PORTS = {
    1: 5000,
    2: 5005,
    3: 5010
};
```

### Polling Interval

The dashboard fetches updated data every second:

```javascript
const POLL_INTERVAL = 1000; // milliseconds
```

### API Host

By default, the dashboard connects to APIs on the same hostname as the frontend:

```javascript
const apiHost = window.location.hostname;
```

To connect to a different API server, modify the `getApiBaseUrl()` function in `script.js`.

---

## API Reference

The dashboard communicates with the backend through the following endpoints:

### GET `/light_status`

Returns lamp and parts inspection data.

**Response:**
```json
{
  "front": {
    "High Beam LH": 1,
    "High Beam RH": 1,
    "Low Beam LH": 0,
    "Low Beam RH": 1
  },
  "rear": {
    "Tail Lamp LH": 1,
    "Tail Lamp RH": 1,
    "Brake Light": 1
  },
  "left_side_parts": {
    "Side Mirror": 1,
    "Door Handle": 2
  },
  "right_side_parts": {
    "Side Mirror": 1,
    "Door Handle": 1
  }
}
```

### POST `/overall_status`

Sends and receives the overall inspection status.

**Request:**
```json
{
  "value": 0
}
```

**Response:**
```json
{
  "overall_status": 0
}
```

| Value | Status |
|-------|--------|
| 0 | OK / Passed |
| 1 | NG / Failed |
| 2 | Waiting |

> **Note:** The response may use `overall_status`, `status`, or `value` as the field name. The dashboard handles all three formats.

### GET `/vin_number`

Returns the Vehicle Identification Number.

**Response:**
```json
{
  "vin": "KMHD35LH5KU123456"
}
```

### GET `/live`

Returns an HTML page with the live video feed from the inspection camera.

---

## Deployment

### Local Development

Use the included Python server:

```bash
python server.py
```

The server runs on port 8000 and handles SPA routing for `/dashboard/*` paths.

### Production Deployment

For production environments, consider:

1. **Static File Server**

   Use nginx, Apache, or any static file server with URL rewriting:

   ```nginx
   # nginx configuration example
   location /dashboard {
       try_files $uri /index.html;
   }
   ```

2. **Docker Deployment**

   Create a Dockerfile with your preferred web server:

   ```dockerfile
   FROM nginx:alpine
   COPY . /usr/share/nginx/html
   COPY nginx.conf /etc/nginx/conf.d/default.conf
   ```

3. **Cloud Hosting**

   Deploy to services like Vercel, Netlify, or AWS S3 + CloudFront with appropriate redirect rules.

### Display Configuration

For factory TV displays:

- **Resolution:** 1920x1080 (Full HD)
- **Screen Size:** Optimized for 24" displays
- **Browser:** Run in fullscreen mode (F11)
- **Kiosk Mode:** Consider using Chrome kiosk mode for production displays:

  ```bash
  chrome --kiosk http://localhost:8000/dashboard/1
  ```

---

## Browser Support

| Browser | Minimum Version |
|---------|-----------------|
| Chrome | 80+ |
| Firefox | 75+ |
| Edge | 80+ |
| Safari | 13+ |

The dashboard uses modern CSS features including:
- CSS Grid and Flexbox
- CSS Custom Properties
- Glassmorphism effects (backdrop-filter)
- CSS Animations

---

## Troubleshooting

### Dashboard shows "WAITING" indefinitely

- Verify the backend API server is running on the correct port
- Check browser console for network errors
- Confirm the API host/port configuration matches your backend

### Live video feed not displaying

- Ensure the `/live` endpoint is accessible
- Check for CORS issues if the API is on a different domain
- Fallback images will display if the live feed fails

### Status popover not appearing

- Status popover only shows on status transitions (0 to 1, 1 to 0, or first valid status)
- Status 2 (WAITING) updates the banner but doesn't trigger the popover
- Check browser console for JavaScript errors

### Items not updating

- Verify the polling interval hasn't been modified
- Check network tab for successful API responses
- Ensure the response format matches the expected structure

### Booth selector not working

- URL must follow the pattern `/dashboard/{booth_number}`
- Valid booth numbers are 1, 2, and 3
- Check that the serve.json or server.py routing is configured correctly

---

## Technical Details

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Web Browser (Dashboard)                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    index.html                        │   │
│  │  ┌─────────┐  ┌─────────────┐  ┌─────────┐        │   │
│  │  │ Front   │  │  Live Video │  │  Rear   │        │   │
│  │  │ Lamps   │  │    Feed     │  │  Lamps  │        │   │
│  │  ├─────────┤  ├─────────────┤  ├─────────┤        │   │
│  │  │ Left    │  │     VIN     │  │  Right  │        │   │
│  │  │ Parts   │  │   Display   │  │  Parts  │        │   │
│  │  └─────────┘  └─────────────┘  └─────────┘        │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                  │
│                    Polls every 1s                           │
│                           ▼                                  │
└───────────────────────────┼─────────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
     ┌──────────┐    ┌──────────┐    ┌──────────┐
     │ Booth 1  │    │ Booth 2  │    │ Booth 3  │
     │ API:5000 │    │ API:5005 │    │ API:5010 │
     └──────────┘    └──────────┘    └──────────┘
```

### Data Flow

1. Dashboard loads and determines booth from URL path
2. Initializes live video feed in iframe
3. Starts 1-second polling interval
4. Each poll cycle:
   - Fetches `/light_status` for lamp and parts data
   - Fetches `/vin_number` for vehicle identification
   - POSTs to `/overall_status` to sync status
   - Updates UI components with new data
5. On status change (pass/fail), shows full-screen notification

### Security Considerations

- XSS prevention: DOM methods used instead of innerHTML for user data
- No sensitive data stored in browser storage
- API communication over HTTP (use HTTPS in production)
- No authentication implemented (assumes secure factory network)

---

## License

Proprietary - Hyundai Motor Company

---

## Support

For issues and feature requests, please contact your system administrator or submit an issue through the internal ticketing system.
