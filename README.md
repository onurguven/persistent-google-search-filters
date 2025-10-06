# Persistent Google Search Filters - Userscript

A powerful UserScript that enhances Google Search with advanced filtering capabilities. Designed to solve location and language issues when using VPN by allowing persistent filter settings.

**[View Screenshot](assets/screenshot.png)**

## Purpose

When using VPN, Google automatically adjusts location and language settings based on your IP address. This script allows you to:
- Set preferred language and region settings permanently
- Apply chosen filters automatically to every Google search
- Get consistent results regardless of VPN location
- Maintain preferences across all search sessions

## Features

### Language & Location Control
- **Search Results Language**: Filter results by content language (Turkish/English/All)
- **Google Interface Language**: Control Google's UI language (Turkish/English/Auto)
- **Geographic Location**: Set regional targeting (Turkey/US/Auto)

### Additional Filters
- **Time Filters**: Today, Week, Month, Year, Last 2 Years
- **Site Filters**: Built-in popular sites + custom site management
- **Persistence Settings**: Individual control for each filter type

### Interface
- Clean, responsive design with dark/light theme support
- Keyboard shortcuts (Alt+F to toggle, Alt+C to clear, Esc to close)
- Real-time filter synchronization

## Installation

1. Install a UserScript manager:
   - [Violentmonkey](https://violentmonkey.github.io/) (recommended)
   - [Greasemonkey](https://addons.mozilla.org/firefox/addon/greasemonkey/)
   - [Tampermonkey](https://tampermonkey.net/)

2. [Install the script](google-search-filters.user.js) - click to open installation page

3. Navigate to Google Search and configure your preferences

## Usage

### Quick Setup
1. Open Google Search
2. Click the "Filters" button (top right corner)
3. Configure your settings:
   - Set search results language
   - Choose interface language
   - Select geographic region
4. Enable persistence for filters you want to remember
5. Your settings will now apply to every search automatically

### Persistence Settings
Control which filters are remembered across sessions:
- **Enabled**: Filter applies automatically to every Google search
- **Disabled**: Filter applies only to current session

## Supported Sites

- google.com
- google.com.tr
- google.co.uk
- google.ca
- google.de
- google.fr

## Browser Compatibility

- Chrome/Chromium-based browsers
- Firefox
- Safari (with UserScript manager)
- Microsoft Edge

## License

MIT License

---

Enhance your Google Search experience with consistent, reliable filtering.
