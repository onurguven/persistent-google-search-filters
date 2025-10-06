// ==UserScript==
// @name         Google Search Advanced Filters
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Advanced Google Search Filters with language, time, and site filtering
// @author       Advanced Search Tools
// @match        https://www.google.com/*
// @match        https://www.google.com.tr/*
// @match        https://www.google.co.uk/*
// @match        https://www.google.ca/*
// @match        https://www.google.de/*
// @match        https://www.google.fr/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        DEBOUNCE_DELAY: 150,
        TOAST_DURATION: 3000,
        ANIMATION_DURATION: 300,
        WIDGET_TOP_OFFSET: 85,
        PANEL_WIDTH: 320,
        PANEL_MAX_SITES_BEFORE_SCROLL: 5,
        MAX_CUSTOM_SITES: 50,
        MAX_SITE_NAME_LENGTH: 20,
        INITIALIZATION_DELAY: 200,
        SITE_FILTER_COLUMNS: 2,
        URL_VALIDATION_REGEX: /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
    };

    const SELECTORS = {
        GOOGLE_APPS: '[aria-label="Google apps"], [title="Google apps"], [aria-label="Google uygulamaları"], [title="Google uygulamaları"]',
        PROFILE_BUTTON: '[aria-label*="Google Account"], a[href*="accounts.google.com"], [aria-label*="Google Hesabı"]',
        SEARCH_FORM: 'form[role="search"], form[action="/search"]'
    };

    const DEFAULT_SITES = ['reddit', 'github', 'eksisozluk', 'donanimhaber'];

    const globalState = {
        isOpen: false,
        settingsCollapsed: true,
        mutationObserver: null,
        mediaQueryListener: null,
        eventListeners: new Set(),
        timeouts: new Set(),
        intervals: new Set()
    };

    function safeExecute(fn, context = 'unknown', fallback = null) {
        try {
            return fn();
        } catch (error) {
            console.warn(`[Advanced Search] Error in ${context}:`, error);
            return fallback;
        }
    }

    function debounce(func, wait = CONFIG.DEBOUNCE_DELAY) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                globalState.timeouts.delete(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            globalState.timeouts.delete(timeout);
            timeout = setTimeout(later, wait);
            globalState.timeouts.add(timeout);
        };
    }

    function isValidNonEmptyString(value) {
        return typeof value === 'string' && value.trim() !== '';
    }

    function cleanURLDomain(url) {
        if (!isValidNonEmptyString(url)) return '';
        return url.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
    }

    function sanitizeHTML(str) {
        if (!isValidNonEmptyString(str)) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function isValidURL(url) {
        if (!isValidNonEmptyString(url)) return false;
        try {
            const cleanUrl = cleanURLDomain(url);
            return cleanUrl !== '' && CONFIG.URL_VALIDATION_REGEX.test(cleanUrl);
        } catch {
            return false;
        }
    }

    function isValidSiteData(siteData) {
        return siteData &&
               typeof siteData === 'object' &&
               siteData !== null &&
               isValidNonEmptyString(siteData.name) &&
               isValidNonEmptyString(siteData.domain) &&
               isValidNonEmptyString(siteData.query);
    }

    function addTrackedEventListener(element, event, handler, options = false) {
        if (!element || typeof handler !== 'function') return;
        element.addEventListener(event, handler, options);
        globalState.eventListeners.add({ element, event, handler, options });
    }

    function cleanup() {
        globalState.timeouts.forEach(timeout => clearTimeout(timeout));
        globalState.intervals.forEach(interval => clearInterval(interval));
        globalState.timeouts.clear();
        globalState.intervals.clear();

        globalState.eventListeners.forEach(({ element, event, handler, options }) => {
            if (element && element.removeEventListener) {
                element.removeEventListener(event, handler, options);
            }
        });
        globalState.eventListeners.clear();

        if (typeof clearAllToasts === 'function') {
            clearAllToasts();
        }

        if (globalState.mutationObserver) {
            globalState.mutationObserver.disconnect();
            globalState.mutationObserver = null;
        }

        if (globalState.mediaQueryListener && window.matchMedia) {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            if (mediaQuery.removeListener) {
                mediaQuery.removeListener(globalState.mediaQueryListener);
            }
        }
    }

    function handleUnload() {
        cleanup();
        console.log('[Advanced Search] Cleanup completed');
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', handleUnload);
        window.addEventListener('unload', handleUnload);
    }

    const filters = {
        searchLang: {
            'all': { name: 'All Languages', short: 'ALL', icon: 'globe', description: 'Search results in any language' },
            'tr': { name: 'Turkish Only', short: 'TR', icon: '🇹🇷', description: 'Only Turkish language search results' },
            'en': { name: 'English Only', short: 'EN', icon: '🇺🇸', description: 'Only English language search results' }
        },
        interfaceLang: {
            'auto': { name: 'Auto Detect', short: 'AUTO', icon: 'globe', googleLang: null, description: 'Google automatically detects interface language' },
            'tr': { name: 'Turkish UI', short: 'TR', icon: '🇹🇷', googleLang: 'tr', description: 'Display Google interface in Turkish' },
            'en': { name: 'English UI', short: 'EN', icon: '🇺🇸', googleLang: 'en', description: 'Display Google interface in English' }
        },
        region: {
            'auto': { name: 'Auto Detect', short: 'AUTO', icon: 'globe', googleRegion: null, description: 'Google automatically detects your location' },
            'tr': { name: 'Turkey', short: 'TR', icon: '🇹🇷', googleRegion: 'TR', description: 'Show Turkey-specific results and local content' },
            'us': { name: 'United States', short: 'US', icon: '🇺🇸', googleRegion: 'US', description: 'Show US-specific results and local content' }
        },
        time: {
            'all': { name: 'All Time', short: 'ALL', param: '' },
            'day': { name: 'Today', short: 'TODAY', param: 'd' },
            'week': { name: 'This Week', short: 'WEEK', param: 'w' },
            'month': { name: 'This Month', short: 'MONTH', param: 'm' },
            'year': { name: 'This Year', short: 'YEAR', param: 'y' },
            '2year': { name: 'Last 2 Years', short: '2 YEARS', param: 'custom:2y' }
        },
        site: {
            'reddit': { name: 'Reddit', short: 'REDDIT', query: 'site:reddit.com', domain: 'reddit.com', icon: 'https://reddit.com/favicon.ico' },
            'github': { name: 'GitHub', short: 'GITHUB', query: 'site:github.com', domain: 'github.com', icon: 'https://github.com/favicon.ico' },
            'eksisozluk': { name: 'Ekşi Sözlük', short: 'EKŞİ', query: 'site:eksisozluk.com', domain: 'eksisozluk.com', icon: 'https://eksisozluk.com/favicon.ico' },
            'donanimhaber': { name: 'DONANIMHABER', short: 'DH', query: 'site:forum.donanimhaber.com', domain: 'forum.donanimhaber.com', icon: 'https://donanimhaber.com/favicon.ico' }
        }
    };

    function loadCustomSites() {
        return safeExecute(() => {
            const customSites = localStorage.getItem('googleSearchCustomSites');
            if (!customSites) {
                return;
            }

            try {
                const parsed = JSON.parse(customSites);
                if (typeof parsed === 'object' && parsed !== null) {
                    // Validate and sanitize loaded sites
                    const validatedSites = {};
                    Object.entries(parsed).forEach(([key, value]) => {
                        if (isValidNonEmptyString(key) && isValidSiteData(value)) {
                            validatedSites[sanitizeHTML(key)] = {
                                name: sanitizeHTML(value.name),
                                short: sanitizeHTML(value.short || value.name.toUpperCase().substring(0, 12)),
                                query: value.query,
                                domain: value.domain,
                                icon: value.icon || `https://${value.domain}/favicon.ico`
                            };
                        }
                    });
                    Object.assign(filters.site, validatedSites);
                } else {
                    console.warn('[Advanced Search] Invalid custom sites data format');
                }
            } catch (error) {
                console.warn('[Advanced Search] Failed to load custom sites:', error);
                localStorage.removeItem('googleSearchCustomSites');
            }
        }, 'loadCustomSites');
    }

    function saveCustomSites() {
        return safeExecute(() => {
            const customSites = {};
            Object.entries(filters.site).forEach(([key, value]) => {
                if (!DEFAULT_SITES.includes(key)) {
                    customSites[key] = value;
                }
            });

            try {
                const serialized = JSON.stringify(customSites);
                localStorage.setItem('googleSearchCustomSites', serialized);
            } catch (error) {
                console.error('[Advanced Search] Failed to save custom sites:', error);
                showToast('Error saving custom sites', 'warning');
            }
        }, 'saveCustomSites');
    }

    loadCustomSites();

    const persistenceSettings = {
        searchLang: localStorage.getItem('googleSearchPersistSearchLang') !== 'false',
        interfaceLang: localStorage.getItem('googleSearchPersistInterfaceLang') !== 'false',
        region: localStorage.getItem('googleSearchPersistRegion') === 'true',
        time: localStorage.getItem('googleSearchPersistTime') === 'true',
        site: localStorage.getItem('googleSearchPersistSite') === 'true'
    };

    let autoOpenPanel = localStorage.getItem('googleSearchAutoOpen') !== 'false';

    const currentFilters = {
        searchLang: persistenceSettings.searchLang ? (localStorage.getItem('googleSearchSearchLang') || 'all') : 'all',
        interfaceLang: persistenceSettings.interfaceLang ? (localStorage.getItem('googleSearchInterfaceLang') || 'auto') : 'auto',
        region: persistenceSettings.region ? (localStorage.getItem('googleSearchRegion') || 'auto') : 'auto',
        site: persistenceSettings.site ? (localStorage.getItem('googleSearchSite') || 'all') : 'all',
        time: persistenceSettings.time ? (localStorage.getItem('googleSearchTime') || 'all') : 'all'
    };


    function getStorageKey(filterType) {
        return `googleSearch${filterType.charAt(0).toUpperCase() + filterType.slice(1)}`;
    }

    function getPersistStorageKey(filterType) {
        return `googleSearchPersist${filterType.charAt(0).toUpperCase() + filterType.slice(1)}`;
    }

    function isDarkMode() {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ||
               getComputedStyle(document.body).backgroundColor.includes('rgb(32, 33, 36)');
    }

    function getColors() {
        const dark = isDarkMode();
        return {
            primary: dark ? '#6b9eff' : '#2563eb',
            primaryHover: dark ? '#8bb4ff' : '#1d4ed8',
            primaryLight: dark ? 'rgba(107, 158, 255, 0.15)' : 'rgba(37, 99, 235, 0.1)',

            bg: dark ? 'rgba(15, 15, 17, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            bgHeader: dark ? 'rgba(24, 25, 28, 0.98)' : 'rgba(248, 250, 252, 0.98)',
            bgSection: dark ? 'rgba(32, 34, 37, 0.92)' : 'rgba(241, 245, 249, 0.92)',
            bgCard: dark ? 'rgba(40, 42, 46, 0.88)' : 'rgba(236, 242, 248, 0.88)',
            bgInput: dark ? 'rgba(48, 51, 56, 0.85)' : 'rgba(226, 232, 240, 0.85)',
            bgOverlay: dark ? 'rgba(56, 59, 64, 0.8)' : 'rgba(203, 213, 225, 0.8)',

            text: dark ? '#f1f5f9' : '#0f172a',
            textSoft: dark ? '#cbd5e1' : '#334155',
            textMuted: dark ? '#94a3b8' : '#64748b',
            textFaint: dark ? '#64748b' : '#94a3b8',
            textAccent: dark ? '#6b7280' : '#4b5563',

            hover: dark ? 'rgba(248, 250, 252, 0.06)' : 'rgba(15, 23, 42, 0.04)',
            hoverStrong: dark ? 'rgba(248, 250, 252, 0.12)' : 'rgba(15, 23, 42, 0.08)',
            active: dark ? 'rgba(107, 158, 255, 0.2)' : 'rgba(37, 99, 235, 0.15)',
            selected: dark ? 'rgba(107, 158, 255, 0.25)' : 'rgba(37, 99, 235, 0.2)',
            pressed: dark ? 'rgba(107, 158, 255, 0.3)' : 'rgba(37, 99, 235, 0.25)',

            border: dark ? 'rgba(71, 85, 105, 0.4)' : 'rgba(203, 213, 225, 0.6)',
            borderSoft: dark ? 'rgba(71, 85, 105, 0.25)' : 'rgba(203, 213, 225, 0.4)',
            borderLight: dark ? 'rgba(71, 85, 105, 0.15)' : 'rgba(203, 213, 225, 0.25)',
            divider: dark ? 'rgba(71, 85, 105, 0.3)' : 'rgba(203, 213, 225, 0.5)',

            success: dark ? '#9ca3af' : '#6b7280',
            successBg: dark ? 'rgba(156, 163, 175, 0.15)' : 'rgba(107, 114, 128, 0.1)',
            warning: dark ? '#9ca3af' : '#6b7280',
            warningBg: dark ? 'rgba(156, 163, 175, 0.15)' : 'rgba(107, 114, 128, 0.1)',
            error: dark ? '#9ca3af' : '#6b7280',
            errorBg: dark ? 'rgba(156, 163, 175, 0.15)' : 'rgba(107, 114, 128, 0.1)',
            info: dark ? '#9ca3af' : '#6b7280',
            infoBg: dark ? 'rgba(156, 163, 175, 0.15)' : 'rgba(107, 114, 128, 0.1)',

            shadowDeep: dark ? '0 20px 40px rgba(0, 0, 0, 0.6)' : '0 20px 40px rgba(15, 23, 42, 0.15)',
            shadow: dark ? '0 10px 25px rgba(0, 0, 0, 0.4)' : '0 10px 25px rgba(15, 23, 42, 0.1)',
            shadowMedium: dark ? '0 6px 20px rgba(0, 0, 0, 0.3)' : '0 6px 20px rgba(15, 23, 42, 0.08)',
            shadowSoft: dark ? '0 3px 12px rgba(0, 0, 0, 0.2)' : '0 3px 12px rgba(15, 23, 42, 0.06)',
            shadowInner: dark ? 'inset 0 2px 4px rgba(0, 0, 0, 0.3)' : 'inset 0 2px 4px rgba(15, 23, 42, 0.1)',

            glowPrimary: dark ? '0 0 20px rgba(107, 158, 255, 0.3)' : '0 0 20px rgba(37, 99, 235, 0.2)',
            glowSuccess: dark ? '0 0 16px rgba(156, 163, 175, 0.25)' : '0 0 16px rgba(107, 114, 128, 0.15)'
        };
    }

    function getSVGIcon(type, size = 16, color = '#666') {
        const icons = {
            filter: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="22,3 2,3 10,12.46 10,19 14,21 14,12.46 22,3"/>
            </svg>`,

            chevronDown: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6,9 12,15 18,9"/>
            </svg>`,

            x: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>`,

            flagTR: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5">
                <rect x="3" y="5" width="18" height="12" rx="2" fill="#e30a17"/>
                <circle cx="9" cy="11" r="2.5" fill="none" stroke="white" stroke-width="1.5"/>
                <polygon points="13,9 15,10.5 13,12 13.8,10.5" fill="white"/>
            </svg>`,

            flagUS: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5">
                <rect x="3" y="5" width="18" height="12" rx="2" fill="#b22234"/>
                <rect x="3" y="5" width="7" height="7" fill="#3c3b6e"/>
                <path d="M4 6h1 M6 6h1 M8 6h1 M4 7h1 M6 7h1 M8 7h1 M4 8h1 M6 8h1 M8 8h1" stroke="white" stroke-width="0.3"/>
                <rect x="3" y="9" width="18" height="1" fill="white"/>
                <rect x="3" y="11" width="18" height="1" fill="white"/>
                <rect x="3" y="13" width="18" height="1" fill="white"/>
                <rect x="3" y="15" width="18" height="1" fill="white"/>
            </svg>`,

            globe: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>`,

            location: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
            </svg>`,

            clock: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12,6 12,12 16,14"/>
            </svg>`,

            eyeOpen: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
            </svg>`,

            pin: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="9" y1="9" x2="20" y2="20"/>
                <path d="M16 8 8 16l-4-4 4-4m0 0 7-7 4 4-7 7"/>
            </svg>`,

            flag: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
                <line x1="4" y1="22" x2="4" y2="15"/>
            </svg>`,

            world: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>`
        };

        return icons[type] || '';
    }


    function setupKeyboardShortcuts() {
        return safeExecute(() => {
            const keydownHandler = (e) => {
                safeExecute(() => {
                    if (e.altKey && e.key === 'f') {
                        e.preventDefault();
                        togglePanel();
                        return;
                    }

                    if (globalState.isOpen && e.altKey) {
                        // Keyboard shortcut mappings
                        const keyMappings = {
                            'c': () => clearAllFilters()
                        };

                        const handler = keyMappings[e.key];
                        if (handler) {
                            e.preventDefault();
                            handler();
                        }
                    }

                    if (globalState.isOpen && e.key === 'Escape') {
                        e.preventDefault();
                        togglePanel();
                    }
                }, 'keydownHandler');
            };

            addTrackedEventListener(document, 'keydown', keydownHandler);

        }, 'setupKeyboardShortcuts');
    }

    function getOptimalPosition() {
        const appsButton = document.querySelector(SELECTORS.GOOGLE_APPS);
        const profileButton = document.querySelector(SELECTORS.PROFILE_BUTTON);

        if (profileButton || appsButton) {
            const rightmostElement = profileButton || appsButton;
            const rect = rightmostElement.getBoundingClientRect();
            return Math.max(CONFIG.WIDGET_TOP_OFFSET, rect.bottom + 16);
        }

        return CONFIG.WIDGET_TOP_OFFSET;
    }

    function getAvailableHeight() {
        const topPosition = getOptimalPosition();
        return window.innerHeight - topPosition - 40 - 20;
    }


    function syncFiltersFromURL() {
        safeExecute(() => {
            const { searchParams } = new URL(window.location.href);
            const [query, lr, tbs, hl, gl] = ['q', 'lr', 'tbs', 'hl', 'gl'].map(p => searchParams.get(p) || '');

            if (hl) {
                currentFilters.interfaceLang = Object.entries(filters.interfaceLang).find(([, data]) => data.googleLang === hl)?.[0] || 'auto';
            }

            if (gl) {
                currentFilters.region = Object.entries(filters.region).find(([, data]) => data.googleRegion === gl)?.[0] || 'auto';
            }

            if (!isSearchPage()) return;

            // Sync site filters
            const siteEntry = Object.entries(filters.site).find(([, data]) => data?.query && query.includes(data.query));
            if (siteEntry) currentFilters.site = siteEntry[0];

            // Sync search language
            if (lr) {
                const langCode = lr.replace('lang_', '');
                if (filters.searchLang[langCode]) currentFilters.searchLang = langCode;
            }

            // Sync time filters
            if (tbs) {
                if (tbs.startsWith('cdr:1,cd_min:')) {
                    syncCustomDateRange(tbs);
                } else {
                    const timeParam = tbs.replace('qdr:', '');
                    const timeEntry = Object.entries(filters.time).find(([, data]) => data?.param === timeParam);
                    if (timeEntry) currentFilters.time = timeEntry[0];
                }
            }
        }, 'syncFiltersFromURL');
    }

    function syncCustomDateRange(tbs) {
        const dateMatch = tbs.match(/cd_min:(\d{1,2}\/\d{1,2}\/\d{4}),cd_max:(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (!dateMatch?.[1] || !dateMatch[2]) return;

        const parseDate = (dateStr) => {
            const [month, day, year] = dateStr.split('/').map(Number);
            return (isNaN(year) || isNaN(month) || isNaN(day)) ? null : new Date(year, month - 1, day);
        };

        const [startDate, endDate] = [parseDate(dateMatch[1]), parseDate(dateMatch[2])];
        if (startDate && endDate) {
            const yearsDiff = (endDate - startDate) / (365.25 * 24 * 60 * 60 * 1000);
            if (yearsDiff >= 1.8 && yearsDiff <= 2.2) currentFilters.time = '2year';
        }
    }

    function applyInterfaceLanguage(langCode) {
        return safeExecute(() => {
            if (!langCode) return;

            const currentUrl = new URL(window.location.href);
            const filterName = filters.interfaceLang[langCode].name;

            if (langCode === 'auto') {
                // Remove interface language parameter to use Google's auto-detection
                currentUrl.searchParams.delete('hl');
                showToast(`Switching to ${filterName}...`, 'info');
            } else {
                const interfaceData = filters.interfaceLang[langCode];
                if (!interfaceData || !interfaceData.googleLang) return;

                const googleLang = interfaceData.googleLang;

                // Set ONLY interface language parameter (hl)
                currentUrl.searchParams.set('hl', googleLang);
                showToast(`Switching to ${filterName}...`, 'info');
            }

            // Small delay for better UX, then navigate
            setTimeout(() => {
                window.location.href = currentUrl.toString();
            }, 800);

        }, 'applyInterfaceLanguage');
    }

    function applyRegionChange(regionCode) {
        return safeExecute(() => {
            if (!regionCode) return;

            const currentUrl = new URL(window.location.href);
            const filterName = filters.region[regionCode].name;

            if (regionCode === 'auto') {
                // Remove region parameter to use Google's auto-detection
                currentUrl.searchParams.delete('gl');
                showToast(`Switching to ${filterName}...`, 'info');
            } else {
                const regionData = filters.region[regionCode];
                if (!regionData || !regionData.googleRegion) return;

                const googleRegion = regionData.googleRegion;

                // Set ONLY region parameter (gl)
                currentUrl.searchParams.set('gl', googleRegion);
                showToast(`Switching to ${filterName}...`, 'info');
            }

            // Small delay for better UX, then navigate
            setTimeout(() => {
                window.location.href = currentUrl.toString();
            }, 800);

        }, 'applyRegionChange');
    }


    function createWidget() {
        return safeExecute(() => {
            // Check if widget already exists
            const existingWidget = document.getElementById('advanced-search-widget');
            if (existingWidget) {
                console.log('[Advanced Search] Widget already exists');
                return;
            }

            if (!document.body) {
                console.warn('[Advanced Search] Document body not ready for widget creation');
                return;
            }

            const colors = getColors();
            const topPosition = getOptimalPosition();
            const availableHeight = getAvailableHeight();

            syncFiltersFromURL();

            const container = document.createElement('div');
            container.id = 'advanced-search-widget';
            container.style.cssText = `
                position: fixed;
                top: ${topPosition}px;
                right: 24px;
                z-index: 10000;
                font-family: -apple-system, BlinkMacSystemFont, "Google Sans", Roboto, arial, sans-serif;
                opacity: 0;
                transform: translateY(10px);
                transition: all ${CONFIG.ANIMATION_DURATION * 1.3}ms cubic-bezier(0.16, 1, 0.3, 1);
            `;

            const button = document.createElement('button');
            button.id = 'filter-btn';
            try {
                button.innerHTML = createButtonContent();
            } catch (error) {
                console.error('[Advanced Search] Error creating button content:', error);
                button.textContent = 'Filters';
            }

            button.className = 'advanced-filter-btn';

            const panel = document.createElement('div');
            panel.id = 'filter-panel';
            try {
                panel.innerHTML = createPanelContent();
            } catch (error) {
                console.error('[Advanced Search] Error creating panel content:', error);
                panel.innerHTML = '<div style="padding: 20px; text-align: center;">Error loading filters</div>';
            }

            panel.style.cssText = `
                position: absolute;
                top: calc(100% + 6px);
                right: 0;
                background: linear-gradient(180deg, ${isDarkMode() ? 'rgba(32, 33, 36, 0.95)' : 'rgba(255, 255, 255, 0.55)'}, ${isDarkMode() ? 'rgba(24, 25, 28, 0.90)' : 'rgba(250, 251, 252, 0.60)'});
                backdrop-filter: blur(24px);
                border: 1px solid ${isDarkMode() ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)'};
                border-radius: 12px;
                width: ${CONFIG.PANEL_WIDTH}px;
                max-height: ${availableHeight}px;
                overflow-y: auto;
                opacity: 0;
                visibility: hidden;
                transform: translateY(-12px) scale(0.96);
                transition: all ${CONFIG.ANIMATION_DURATION}ms cubic-bezier(0.16, 1, 0.3, 1);
                box-shadow: ${colors.shadow};
            `;

            // Add tracked event listeners for proper cleanup
            const mouseEnterHandler = () => {
                if (!globalState.isOpen) {
                    button.classList.add('hover-active');
                }
            };

            const mouseLeaveHandler = () => {
                if (!globalState.isOpen) {
                    button.classList.remove('hover-active');
                }
            };

            const buttonClickHandler = (e) => {
                e.stopPropagation();
                togglePanel();
            };

            const documentClickHandler = () => {
                if (globalState.isOpen && !autoOpenPanel) togglePanel();
            };

            const panelClickHandler = (e) => e.stopPropagation();

            addTrackedEventListener(button, 'mouseenter', mouseEnterHandler);
            addTrackedEventListener(button, 'mouseleave', mouseLeaveHandler);
            addTrackedEventListener(button, 'click', buttonClickHandler);
            addTrackedEventListener(document, 'click', documentClickHandler);
            addTrackedEventListener(panel, 'click', panelClickHandler);

            container.appendChild(button);
            container.appendChild(panel);
            document.body.appendChild(container);

            // Setup additional components with error handling
            safeExecute(() => setupPanelEvents(), 'setupPanelEvents');
            safeExecute(() => setupKeyboardShortcuts(), 'setupKeyboardShortcuts');

            // Setup media query listener with cleanup tracking
            if (window.matchMedia) {
                const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
                const mediaQueryHandler = updateTheme;
                globalState.mediaQueryListener = mediaQueryHandler;

                if (mediaQuery.addListener) {
                    mediaQuery.addListener(mediaQueryHandler);
                } else if (mediaQuery.addEventListener) {
                    mediaQuery.addEventListener('change', mediaQueryHandler);
                }
            }

            // Animate widget appearance
            const appearTimeoutId = setTimeout(() => {
                container.style.opacity = '1';
                container.style.transform = 'translateY(0)';

                if (autoOpenPanel) {
                    const openTimeoutId = setTimeout(() => {
                        globalState.isOpen = true;
                        panel.classList.add('panel-open');
                        button.classList.add('button-active');
                        const chevron = button.querySelector('.filter-btn-chevron svg');
                        if (chevron) chevron.style.transform = 'rotate(180deg)';
                        globalState.timeouts.delete(openTimeoutId);
                    }, 200);
                    globalState.timeouts.add(openTimeoutId);
                }
                globalState.timeouts.delete(appearTimeoutId);
            }, 100);
            globalState.timeouts.add(appearTimeoutId);

            console.log('[Advanced Search] Widget created successfully');

        }, 'createWidget');
    }

    function updatePanelHeight() {
        const panel = document.getElementById('filter-panel');
        if (panel) {
            const availableHeight = getAvailableHeight();
            panel.style.maxHeight = `${availableHeight}px`;
        }
    }

    function createButtonContent() {
        const colors = getColors();
        const activeFilters = getActiveFiltersInfo();

        if (activeFilters.count === 0) {
            return `<span class="filter-btn-icon">${getSVGIcon('filter', 16, colors.textMuted)}</span>
                    <span class="filter-btn-text">Filters</span>
                    <span class="filter-btn-chevron">${getSVGIcon('chevronDown', 12, colors.textMuted)}</span>`;
        }

        return `<span class="filter-btn-icon">${getSVGIcon('filter', 16, colors.primary)}</span>
                <span class="filter-btn-text">Filters</span>
                <span class="filter-btn-count">${activeFilters.count}</span>
                <span class="filter-btn-chevron">${getSVGIcon('chevronDown', 12, colors.textMuted)}</span>`;
    }

    function getActiveFiltersInfo() {
        const active = [];

        Object.entries(currentFilters).forEach(([key, val]) => {
            const defaultVal = (key === 'interfaceLang' || key === 'region') ? 'auto' : 'all';
            if (val !== defaultVal && filters[key] && filters[key][val]) {
                active.push(filters[key][val].short);
            }
        });

        return { count: active.length, text: active.join(' + ') };
    }

    function createCSS() {
        const colors = getColors();
        const dark = isDarkMode();

        return `<style>
                .panel-header {
                    padding: 16px 16px 12px 16px;
                    background: linear-gradient(135deg, ${colors.bgHeader}, ${colors.bgSection});
                    border-bottom: 1px solid ${colors.divider};
                    position: relative;
                }
                .panel-header::before {
                    content: '';
                    position: absolute;
                    top: 0; left: 0; right: 0; height: 1px;
                    background: linear-gradient(90deg, transparent, ${colors.primary}, transparent);
                    opacity: 0.3;
                }
                .panel-content { padding: 18px 16px; }
                .panel-footer {
                    padding: 12px 16px;
                    background: linear-gradient(135deg, ${colors.bgSection}, ${colors.bgCard});
                    border-top: 1px solid ${colors.divider};
                }
                .settings-section {
                    margin-top: 18px; padding: 0; border-radius: 12px;
                    background: linear-gradient(135deg, ${dark ? 'rgba(20,22,25,0.75)' : 'rgba(248,250,252,0.75)'}, ${dark ? 'rgba(28,31,35,0.65)' : 'rgba(241,245,249,0.65)'});
                    border: 1px solid ${dark ? 'rgba(71,85,105,0.15)' : 'rgba(203,213,225,0.2)'};
                    box-shadow: ${colors.shadowMedium}; position: relative; backdrop-filter: blur(12px);
                }
                .settings-header {
                    padding: 12px 16px; display: flex; justify-content: space-between; align-items: center;
                    cursor: pointer; user-select: none; transition: all 0.2s ease;
                    border-radius: 12px 12px 0 0;
                }
                .settings-header:hover {
                    background: ${dark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)'};
                }
                .settings-content {
                    padding: 0 16px 16px 16px; overflow: hidden;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .settings-content.collapsed {
                    padding-top: 0; padding-bottom: 0; max-height: 0; opacity: 0;
                }
                .settings-toggle {
                    width: 20px; height: 20px; border-radius: 50%; background: ${colors.bgInput};
                    border: 1px solid ${colors.borderSoft}; display: flex; align-items: center; justify-content: center;
                    transition: all 0.3s ease; cursor: pointer;
                }
                .settings-toggle:hover {
                    background: ${colors.hoverStrong}; border-color: ${colors.primary};
                }
                .settings-toggle svg {
                    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .settings-toggle.collapsed svg {
                    transform: rotate(180deg);
                }
                .settings-section::before {
                    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
                    background: linear-gradient(90deg, transparent, ${colors.primary}, transparent); opacity: 0.2;
                }
                .filter-section { margin-bottom: 16px; }
                .section-header {
                    font-size: 12px; font-weight: 600; color: ${colors.text}; margin-bottom: 10px;
                    display: flex; align-items: center; gap: 6px; justify-content: space-between;
                }
                .section-title { display: flex; align-items: center; gap: 6px; }
                .filter-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(75px, 1fr)); gap: 8px; }
                .time-controls {
                    display: flex; background: ${colors.bgCard}; border-radius: 8px; padding: 4px; gap: 4px;
                    border: 1px solid ${colors.borderLight}; box-shadow: ${colors.shadowSoft}; backdrop-filter: blur(12px); position: relative;
                }
                .time-controls::before {
                    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
                    background: linear-gradient(90deg, transparent, ${colors.primary}, transparent); opacity: 0.1; border-radius: 8px 8px 0 0;
                }
                .time-filter {
                    flex: 1; padding: 4px 6px; cursor: pointer; font-weight: 600; border-radius: 6px; user-select: none;
                    text-align: center; font-size: 10px; margin: 0; min-height: 28px; display: flex; align-items: center; justify-content: center;
                    background: ${colors.bgInput}; color: ${colors.textSoft}; border: 1px solid ${colors.borderSoft}; box-shadow: 0 2px 4px rgba(0,0,0,0.03);
                    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                }
                .time-filter:hover:not(.active) {
                    background: ${colors.hoverStrong}; color: ${colors.text}; border-color: ${colors.border};
                    transform: translateY(-1px); box-shadow: 0 4px 8px rgba(0,0,0,0.08);
                }
                .time-filter.active {
                    background: ${colors.primary}; color: white; border-color: ${colors.primary};
                    transform: translateY(-1px); box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25), ${colors.glowPrimary};
                }
                .site-container {
                    display: ${CONFIG.SITE_FILTER_COLUMNS === 1 ? 'flex' : 'grid'};
                    ${CONFIG.SITE_FILTER_COLUMNS === 1 ? 'flex-direction: column;' : `grid-template-columns: repeat(${CONFIG.SITE_FILTER_COLUMNS}, 1fr);`}
                    gap: 4px; width: 100%; box-sizing: border-box;
                }
                .site-container.scrollable { max-height: 200px; overflow-y: auto; overflow-x: hidden; }
                .filter-option.site-filter { ${CONFIG.SITE_FILTER_COLUMNS > 2 ? 'padding: 8px 10px;' : ''} }
                .filter-option.site-filter .site-name {
                    font-size: ${CONFIG.SITE_FILTER_COLUMNS >= 4 ? '9px' : CONFIG.SITE_FILTER_COLUMNS >= 3 ? '10px' : '11px'};
                    max-width: ${CONFIG.SITE_FILTER_COLUMNS >= 4 ? '40px' : CONFIG.SITE_FILTER_COLUMNS >= 3 ? '55px' : CONFIG.SITE_FILTER_COLUMNS === 2 ? '70px' : '100px'};
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .filter-option.site-filter .site-content { gap: ${CONFIG.SITE_FILTER_COLUMNS >= 3 ? '4px' : '6px'}; }
                .filter-option.site-filter .remove-btn {
                    font-size: ${CONFIG.SITE_FILTER_COLUMNS >= 4 ? '9px' : CONFIG.SITE_FILTER_COLUMNS >= 3 ? '10px' : '11px'};
                    padding: ${CONFIG.SITE_FILTER_COLUMNS >= 4 ? '2px 4px' : CONFIG.SITE_FILTER_COLUMNS >= 3 ? '2px 5px' : '3px 5px'};
                }

                .header-content { display: flex; justify-content: space-between; align-items: center; }
                .header-left { display: flex; align-items: center; gap: 10px; }
                .header-icon { background: ${colors.primaryLight}; padding: 8px; border-radius: 10px; box-shadow: ${colors.shadowSoft}; }
                .header-text h3 { margin: 0; font-size: 16px; font-weight: 700; color: ${colors.text}; letter-spacing: -0.2px; }
                .header-text p { margin: 2px 0 0 0; font-size: 11px; color: ${colors.textMuted}; font-weight: 500; }
                .keyboard-badge {
                    background: ${colors.bgCard}; color: ${colors.textAccent}; padding: 4px 8px; border-radius: 6px;
                    font-size: 9px; font-weight: 700; letter-spacing: 0.8px; border: 1px solid ${colors.borderLight}; box-shadow: ${colors.shadowSoft};
                }
                .status-dot { background: ${colors.primary}; color: white; width: 5px; height: 5px; border-radius: 50%; animation: pulse 2s infinite; }
                .persistent-badge {
                    background: ${dark ? 'linear-gradient(135deg, #52525b, #374151)' : colors.success};
                    color: white; padding: 2px 6px; border-radius: 6px;
                    font-size: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;
                    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
                }
                .active-indicator { position: absolute; top: -1px; right: -1px; width: 6px; height: 6px; background: white; border-radius: 50%; box-shadow: 0 0 0 1px ${colors.primary}; }
                .btn {
                    border: none; border-radius: 8px; cursor: pointer; font-weight: 600; display: inline-flex;
                    align-items: center; gap: 4px; font-family: inherit; text-decoration: none; user-select: none;
                    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .btn-xs { padding: 5px 10px; font-size: 10px; border-radius: 6px; gap: 3px; min-height: 26px; }
                .btn-sm { padding: 6px 12px; font-size: 10px; gap: 4px; min-height: 28px; }
                .btn-md { padding: 6px 12px; font-size: 11px; }
                .btn-danger { background: #ff4757; color: white; box-shadow: 0 1px 3px rgba(255, 71, 87, 0.2); }
                .btn-danger:hover { background: #ff3742; transform: translateY(-1px); box-shadow: 0 2px 6px rgba(255, 71, 87, 0.3); }
                .btn-warning {
                    background: linear-gradient(135deg, ${dark ? '#64748b' : '#94a3b8'}, ${dark ? '#475569' : '#64748b'});
                    color: white; border: 1px solid ${dark ? 'rgba(71, 85, 105, 0.4)' : 'rgba(100, 116, 139, 0.3)'};
                    box-shadow: 0 2px 6px ${dark ? 'rgba(0, 0, 0, 0.3)' : 'rgba(100, 116, 139, 0.2)'};
                }
                .btn-warning:hover {
                    background: linear-gradient(135deg, ${dark ? '#475569' : '#64748b'}, ${dark ? '#334155' : '#475569'});
                    transform: translateY(-1px); box-shadow: 0 4px 10px ${dark ? 'rgba(0, 0, 0, 0.4)' : 'rgba(100, 116, 139, 0.3)'};
                }
                .btn-ghost { background: ${colors.hover}; color: ${colors.text}; border: 1px solid ${colors.border}; }
                .btn-ghost:hover { background: ${colors.hoverStrong}; border-color: ${colors.primary}; color: ${colors.primary}; }
                .filter-option {
                    padding: 9px 11px; border-radius: 8px; cursor: pointer; font-weight: 500; position: relative;
                    user-select: none; display: flex; align-items: center; gap: 7px; background: ${colors.bgCard}; color: ${colors.text};
                    border: 1px solid ${dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)'};
                    box-shadow: 0 1px 3px rgba(0, 0, 0, ${dark ? '0.15' : '0.05'}); transition: all 0.2s ease;
                }
                .filter-option.active { background: ${colors.primary}; color: white; border-color: ${colors.primary}; box-shadow: 0 2px 6px rgba(37, 99, 235, 0.25); }
                .filter-option:not(.active):hover {
                    background: ${colors.hoverStrong}; border-color: ${dark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)'};
                    box-shadow: 0 2px 6px rgba(0, 0, 0, ${dark ? '0.2' : '0.08'});
                }
                .filter-option.site-filter { padding: 10px 12px; border: 1px solid transparent; gap: 10px; width: 100%; box-sizing: border-box; min-width: 0; }
                .filter-option.site-filter.active { border-color: ${colors.primary}; }
                .filter-option.site-filter:not(.active):hover { background: ${colors.hoverStrong}; }
                .filter-option.language-filter { text-align: center; flex-direction: column; gap: 2px; }

                .segment-control-container {
                    background: ${colors.bgCard}; border-radius: 12px; padding: 4px; border: 1px solid ${colors.borderLight};
                    box-shadow: ${colors.shadowSoft}; backdrop-filter: blur(12px); margin-bottom: 16px;
                }
                .segment-control-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid ${colors.divider}; margin-bottom: 8px; }
                .segment-control-title { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: ${colors.text}; }
                .segment-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; margin-bottom: 8px; }
                .segment-row:last-child { margin-bottom: 0; }
                .segment-label-container { display: flex; flex-direction: column; align-items: flex-start; min-width: 70px; flex-shrink: 0; }
                .segment-label { font-size: 10px; font-weight: 600; color: ${colors.textSoft}; text-align: left; margin-bottom: 2px; }
                .segment-persistent-badge { font-size: 7px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.2px; }
                .segment-buttons { display: flex; background: ${colors.bgInput}; border-radius: 8px; padding: 2px; gap: 2px; flex: 1; box-shadow: ${colors.shadowInner}; border: 1px solid ${colors.borderSoft}; }
                .segment-button {
                    flex: 1; padding: 6px 8px; border: none; border-radius: 6px; cursor: pointer; font-size: 9px; font-weight: 600;
                    background: transparent; color: ${colors.textSoft}; display: flex; align-items: center; justify-content: center;
                    gap: 4px; user-select: none; position: relative; min-height: 28px; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .segment-button:hover:not(.active) { background: ${colors.hover}; color: ${colors.text}; }
                .segment-button.active { background: ${colors.primary}; color: white; box-shadow: 0 2px 8px rgba(37, 99, 235, 0.25); }
                .segment-button .flag-icon { font-size: 12px; }
                .segment-button .text-content { font-size: 9px; font-weight: 600; letter-spacing: 0.2px; }
                @media (max-width: 450px) {
                    .segment-label { min-width: 60px; font-size: 9px; }
                    .segment-button { padding: 5px 6px; font-size: 8px; min-height: 22px; }
                    .segment-button .text-content { font-size: 8px; }
                }
                .site-content { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
                .site-actions { display: flex; align-items: center; gap: 6px; }
                .site-name { font-size: 11px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .site-indicator { width: 6px; height: 6px; background: white; border-radius: 50%; opacity: 0.9; }
                .remove-btn { border: none; cursor: pointer; font-size: 10px; padding: 3px 5px; border-radius: 4px; font-weight: 700; line-height: 1; z-index: 10; position: relative; transition: all 0.2s ease; }
                .remove-btn:hover { background: #ff4444 !important; color: white !important; }
                .toggle-switch {
                    position: relative; display: inline-block; width: 34px; height: 18px; cursor: pointer; border-radius: 18px;
                    background: ${dark ? 'rgba(16, 17, 19, 0.7)' : 'rgba(156, 163, 175, 0.5)'}; box-shadow: ${colors.shadowInner}; transition: background-color 0.3s ease;
                }
                .toggle-switch.active { background: ${colors.success}; }
                .toggle-switch.auto-open { background: ${colors.warning}; }
                .toggle-knob {
                    position: absolute; height: 14px; width: 14px; top: 2px; left: 2px; background-color: white; border-radius: 50%;
                    box-shadow: ${colors.shadowSoft}; border: 1px solid ${colors.borderLight}; transition: left 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.2s ease;
                }
                .toggle-switch.active .toggle-knob { left: 18px; }
                .toggle-switch:hover .toggle-knob { transform: scale(1.05); box-shadow: ${colors.shadow}; }
                .settings-card { background: ${colors.bgCard}; border-radius: 8px; padding: 12px; border: 1px solid ${colors.borderLight}; }
                .settings-row {
                    display: flex; justify-content: space-between; align-items: center; padding: 4px 6px; border-radius: 8px; margin-bottom: 8px;
                    background: ${dark ? 'rgba(56, 59, 64, 0.3)' : 'rgba(203, 213, 225, 0.3)'}; border: 1px solid ${colors.borderLight}; transition: all 0.2s ease;
                }
                .settings-row:last-child { margin-bottom: 0; }
                .settings-row:hover { background: ${colors.hoverStrong}; border-color: ${colors.borderSoft}; }
                .settings-label { display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 500; color: ${colors.text}; }
                .settings-title { font-size: 13px; font-weight: 700; color: ${colors.text}; letter-spacing: -0.1px; }
                .settings-subtitle { font-size: 10px; color: ${colors.textMuted}; margin-top: 1px; }
                .settings-note {
                    font-size: 10px; color: ${colors.textSoft}; margin-top: 12px; line-height: 1.4; padding: 8px; border-radius: 8px;
                    background: ${dark ? 'rgba(71, 85, 105, 0.25)' : 'rgba(156, 163, 175, 0.15)'};
                    border: 1px solid ${dark ? 'rgba(71, 85, 105, 0.2)' : 'rgba(156, 163, 175, 0.2)'};
                }
                .settings-divider { border-top: 1px solid ${colors.divider}; margin: 8px 0; padding-top: 12px; }
                .action-buttons { display: flex; gap: 8px; padding-top: 16px; border-top: 1px solid ${colors.borderLight}; }
                .clear-btn { opacity: 0; visibility: hidden; transform: scale(0.8); transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
                .clear-btn.visible { opacity: 1; visibility: visible; transform: scale(1); }
                .clear-all-container { margin-bottom: 16px; text-align: center; }
                .text-xs { font-size: 8px; } .text-sm { font-size: 10px; } .text-base { font-size: 12px; } .text-lg { font-size: 14px; }
                .font-medium { font-weight: 500; } .font-semibold { font-weight: 600; } .font-bold { font-weight: 700; }
                .uppercase { text-transform: uppercase; } .tracking-wide { letter-spacing: 0.3px; } .tracking-wider { letter-spacing: 0.5px; }
                .flex { display: flex; } .flex-col { display: flex; flex-direction: column; }
                .flex-center { display: flex; align-items: center; justify-content: center; }
                .flex-between { display: flex; align-items: center; justify-content: space-between; }
                .gap-1 { gap: 4px; } .gap-2 { gap: 8px; } .gap-3 { gap: 12px; }
                .p-1 { padding: 4px; } .p-2 { padding: 8px; } .px-2 { padding-left: 8px; padding-right: 8px; }
                .py-1 { padding-top: 4px; padding-bottom: 4px; } .m-0 { margin: 0; }
                .mb-2 { margin-bottom: 8px; } .mb-3 { margin-bottom: 12px; } .mb-4 { margin-bottom: 16px; }
                kbd {
                    background: ${colors.bgInput}; color: ${colors.text}; padding: 2px 6px; border-radius: 4px; font-size: 9px;
                    font-weight: 700; font-family: 'Courier New', monospace; border: 1px solid ${colors.borderLight}; box-shadow: ${colors.shadowSoft}; margin-right: 4px;
                }
                .shortcuts-text { font-size: 10px; color: ${colors.textSoft}; text-align: center; line-height: 1.4; }
                .shortcuts-container { margin-top: 6px; display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; }
                .shortcuts-label { opacity: 0.7; }
                .site-filters-container::-webkit-scrollbar { width: 8px; }
                .site-filters-container::-webkit-scrollbar-track { background: ${colors.bgInput}; border-radius: 4px; }
                .site-filters-container::-webkit-scrollbar-thumb { background: ${colors.borderSoft}; border-radius: 4px; border: 1px solid ${colors.borderLight}; }
                .site-filters-container::-webkit-scrollbar-thumb:hover { background: ${colors.border}; }
                .panel-open { opacity: 1 !important; visibility: visible !important; transform: translateY(0) scale(1) !important; }
                .button-active { transform: translateY(-2px) !important; box-shadow: ${colors.shadow} !important; border-color: ${colors.primary} !important; }
                .advanced-filter-btn {
                    background: linear-gradient(135deg, ${dark ? 'rgba(75, 85, 99, 0.3)' : 'rgba(156, 163, 175, 0.25)'}, ${dark ? 'rgba(55, 65, 81, 0.2)' : 'rgba(107, 114, 128, 0.15)'});
                    backdrop-filter: blur(20px); border: 1px solid ${dark ? 'rgba(156, 163, 175, 0.15)' : 'rgba(203, 213, 225, 0.3)'};
                    color: ${colors.textSoft}; padding: 10px 16px; border-radius: 12px; cursor: pointer; display: flex; align-items: center;
                    gap: 8px; font-size: 12px; font-weight: 500; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); outline: none;
                    box-shadow: 0 2px 8px ${dark ? 'rgba(0, 0, 0, 0.2)' : 'rgba(107, 114, 128, 0.1)'}, 0 1px 3px ${dark ? 'rgba(0, 0, 0, 0.1)' : 'rgba(107, 114, 128, 0.05)'};
                    position: relative; user-select: none; min-width: 120px;
                }
                .advanced-filter-btn:hover {
                    background: linear-gradient(135deg, ${dark ? 'rgba(75, 85, 99, 0.4)' : 'rgba(156, 163, 175, 0.35)'}, ${dark ? 'rgba(55, 65, 81, 0.3)' : 'rgba(107, 114, 128, 0.25)'});
                    border-color: ${dark ? 'rgba(156, 163, 175, 0.25)' : 'rgba(203, 213, 225, 0.4)'};
                    box-shadow: 0 4px 12px ${dark ? 'rgba(0, 0, 0, 0.25)' : 'rgba(107, 114, 128, 0.15)'}, 0 2px 6px ${dark ? 'rgba(0, 0, 0, 0.15)' : 'rgba(107, 114, 128, 0.08)'};
                    transform: translateY(-1px);
                }
                .advanced-filter-btn.button-active {
                    background: linear-gradient(135deg, ${dark ? 'rgba(75, 85, 99, 0.5)' : 'rgba(156, 163, 175, 0.4)'}, ${dark ? 'rgba(55, 65, 81, 0.35)' : 'rgba(107, 114, 128, 0.3)'});
                    border-color: ${colors.primary}; color: ${colors.text}; transform: translateY(-2px);
                    box-shadow: 0 6px 16px ${dark ? 'rgba(0, 0, 0, 0.3)' : 'rgba(107, 114, 128, 0.2)'}, 0 2px 8px ${dark ? 'rgba(0, 0, 0, 0.2)' : 'rgba(107, 114, 128, 0.1)'};
                }
                .filter-btn-icon, .filter-btn-text, .filter-btn-chevron { display: flex; align-items: center; }
                .filter-btn-text { color: ${colors.textSoft}; font-weight: 500; }
                .filter-btn-count {
                    position: absolute; top: -2px; right: -2px; min-width: 16px; height: 16px; background: ${colors.primary}; color: white;
                    border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2), 0 0 0 2px ${dark ? 'rgba(75, 85, 99, 0.5)' : 'rgba(255, 255, 255, 0.8)'};
                }
                .advanced-filter-btn.hover-active {
                    background: linear-gradient(135deg, ${dark ? 'rgba(75, 85, 99, 0.4)' : 'rgba(156, 163, 175, 0.35)'}, ${dark ? 'rgba(55, 65, 81, 0.3)' : 'rgba(107, 114, 128, 0.25)'});
                    border-color: ${dark ? 'rgba(156, 163, 175, 0.25)' : 'rgba(203, 213, 225, 0.4)'};
                    box-shadow: 0 4px 12px ${dark ? 'rgba(0, 0, 0, 0.25)' : 'rgba(107, 114, 128, 0.15)'}, 0 2px 6px ${dark ? 'rgba(0, 0, 0, 0.15)' : 'rgba(107, 114, 128, 0.08)'};
                    transform: translateY(-1px);
                }
                @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
                @keyframes buttonPress { 0% { transform: scale(1); } 50% { transform: scale(0.98); } 100% { transform: scale(1); } }
                .button-press { animation: buttonPress 200ms ease-out; }
            </style>`;
    }

    function createPanelContent() {
        const colors = getColors();

        return `
            ${createCSS()}

            <div class="panel-header">
                <div class="header-content">
                    <div class="header-left">
                        <div class="header-text">
                            <h3>Search Filters</h3>
                            <p>Advanced search controls</p>
                        </div>
                    </div>
                    <div class="keyboard-badge">ALT+F</div>
                </div>
            </div>

            <div class="panel-content">
                ${createLanguageRegionSection(colors)}
                ${createFilterSection('time', 'Time Filter', colors)}
                ${createFilterSection('site', 'Site Filter', colors)}

                <div class="settings-section">
                    <div class="settings-header" id="settings-toggle">
                        <div>
                            <div class="settings-title">Persistence Settings</div>
                            <div class="settings-subtitle">Control filter memory behavior</div>
                        </div>
                        <div class="settings-toggle ${globalState.settingsCollapsed ? 'collapsed' : ''}">
                            ${getSVGIcon('chevronDown', 12, colors.textSoft)}
                        </div>
                    </div>

                    <div class="settings-content ${globalState.settingsCollapsed ? 'collapsed' : ''}">
                        <div class="flex-col">
                            ${Object.keys(persistenceSettings).map(filterType => {
                                const isEnabled = persistenceSettings[filterType];
                                const filterName = getFilterName(filterType);

                                return `
                                    <div class="settings-row">
                                        <div class="settings-label">
                                            ${filterName}
                                        </div>
                                        <div class="toggle-switch ${isEnabled ? 'active' : ''}" data-filter="${filterType}" data-enabled="${isEnabled}">
                                            <div class="toggle-knob"></div>
                                        </div>
                                    </div>
                                `;
                            }).join('')}

                            <div class="settings-divider">
                                <div class="settings-row">
                                    <div class="settings-label">
                                        Always Open Panel
                                    </div>
                                    <div class="toggle-switch ${autoOpenPanel ? 'active auto-open' : ''}" data-filter="autoOpen" data-enabled="${autoOpenPanel}">
                                        <div class="toggle-knob"></div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="settings-note">
                            <strong style="color: ${colors.text};">Note:</strong> Enabled filters persist across searches, disabled ones reset after each search
                        </div>
                    </div>
                </div>
            </div>

            <div class="panel-footer">
                ${hasActiveFilters() ? `
                    <div class="clear-all-container">
                        <button id="clear-filters" class="btn btn-md btn-danger uppercase tracking-wider">
                            ${getSVGIcon('x', 12, 'white')}
                            Clear All
                        </button>
                    </div>
                ` : ''}
                <div class="shortcuts-text">
                    <strong>Keyboard Shortcuts:</strong><br>
                    <div class="shortcuts-container">
                        <kbd>Alt+F</kbd><span class="shortcuts-label">Toggle</span>
                        <kbd>Alt+C</kbd><span class="shortcuts-label">Clear</span>
                        <kbd>Esc</kbd><span class="shortcuts-label">Close</span>
                    </div>
                </div>
            </div>
        `;
    }

    function getFilterName(filterType) {
        const names = {
            searchLang: 'Results Language',
            interfaceLang: 'Interface Language',
            region: 'Geographic Region',
            site: 'Site Filter',
            time: 'Time Filter'
        };
        return names[filterType];
    }


    function createFaviconImg(iconUrl, domain) {
        const colors = getColors();
        const fallbackIcon = iconUrl && iconUrl !== 'null' ? iconUrl : `https://${domain}/favicon.ico`;
        const iconSize = CONFIG.SITE_FILTER_COLUMNS >= 3 ? 12 : 14;

        return `<img src="${fallbackIcon}"
                     style="width: ${iconSize}px; height: ${iconSize}px; border-radius: 3px; object-fit: cover;"
                     onerror="this.style.display='none'; this.nextElementSibling.style.display='inline';"
                     loading="lazy" />
                <span style="display: none;">${getSVGIcon('globe', iconSize, colors.textMuted)}</span>`;
    }

    function addCustomSite() {
        return safeExecute(() => {
            // Check if we've reached the maximum number of custom sites
            const customSiteCount = Object.keys(filters.site).length - DEFAULT_SITES.length;
            if (customSiteCount >= CONFIG.MAX_CUSTOM_SITES) {
                showToast('Maximum number of custom sites reached', 'warning');
                return;
            }

            const siteName = prompt('Enter site name (e.g., Twitter):');
            if (!siteName || siteName.trim() === '') {
                return;
            }

            // Validate site name
            if (!isValidNonEmptyString(siteName)) return;

            const trimmedName = siteName.trim();
            if (trimmedName.length > CONFIG.MAX_SITE_NAME_LENGTH) {
                showToast('Site name too long', 'warning');
                return;
            }

            // Sanitize site name to prevent XSS
            const sanitizedName = sanitizeHTML(trimmedName);
            if (sanitizedName !== trimmedName) {
                showToast('Invalid characters in site name', 'warning');
                return;
            }

            const siteUrl = prompt('Enter site URL (e.g., twitter.com):');
            if (!isValidNonEmptyString(siteUrl)) return;

            const cleanUrl = cleanURLDomain(siteUrl);
            if (!isValidURL(siteUrl)) {
                showToast('Invalid URL format', 'warning');
                return;
            }

            const siteKey = cleanUrl.replace(/\./g, '_').replace(/[^a-zA-Z0-9_]/g, '');

            // Check if site already exists
            if (filters.site[siteKey]) {
                showToast('Site already exists', 'warning');
                return;
            }

            // Create site object with sanitized data
            const siteData = {
                name: sanitizedName,
                short: sanitizedName.toUpperCase().substring(0, 12),
                query: `site:${cleanUrl}`,
                domain: cleanUrl,
                icon: `https://${cleanUrl}/favicon.ico`
            };

            filters.site[siteKey] = siteData;
            saveCustomSites();
            addSiteToDOM(siteKey, siteData);
            showToast(`${sanitizedName} added successfully`, 'success');

        }, 'addCustomSite');
    }

    function addSiteToDOM(siteKey, siteData) {
        const colors = getColors();
        const siteContainer = document.querySelector('.site-container.site-filters-container');

        if (!siteContainer) return;

        const isActive = currentFilters.site === siteKey;
        const defaultSites = ['reddit', 'github', 'eksisozluk', 'donanimhaber'];
        const isCustomSite = !defaultSites.includes(siteKey);

        const siteElement = document.createElement('div');
        siteElement.className = `filter-option site-filter ${isActive ? 'active' : ''}`;
        siteElement.dataset.type = 'site';
        siteElement.dataset.value = siteKey;

        siteElement.innerHTML = `
            <div class="site-content">
                ${createFaviconImg(siteData.icon, siteData.domain)}
                <span class="site-name">${siteData.short}</span>
            </div>
            <div class="site-actions">
                ${isActive ? `<div class="site-indicator"></div>` : ''}
                ${isCustomSite ? `
                    <button class="remove-btn" data-site="${siteKey}"
                           style="background: ${isActive ? 'rgba(255,255,255,0.2)' : colors.borderLight}; color: ${isActive ? 'white' : colors.textMuted};"
                           title="Remove" onclick="event.stopPropagation();">×</button>
                ` : ''}
            </div>
        `;

        siteContainer.appendChild(siteElement);

        // Check if container needs scrollable class
        const siteElements = siteContainer.querySelectorAll('.filter-option.site-filter');
        if (siteElements.length > 5) {
            siteContainer.classList.add('scrollable');
        }
    }

    function removeCustomSite(siteKey) {
        if (!siteKey || typeof siteKey !== 'string') {
            console.warn('[Advanced Search] Invalid site key for removal');
            return;
        }

        safeExecute(() => {
            const site = filters.site[siteKey];
            if (!site) {
                showToast('Site not found', 'warning');
                return;
            }

            // Prevent removal of default sites
            if (DEFAULT_SITES.includes(siteKey)) {
                showToast('Cannot remove default sites', 'warning');
                return;
            }

            const siteName = sanitizeHTML(site.name || 'Unknown Site');
            if (confirm(`Are you sure you want to remove ${siteName}?`)) {
                delete filters.site[siteKey];

                // Reset current filter if removing active site
                if (currentFilters.site === siteKey) {
                    currentFilters.site = 'all';
                    if (persistenceSettings.site) {
                        localStorage.setItem('googleSearchSite', 'all');
                    }
                }

                saveCustomSites();

                // Remove the site element from DOM
                const siteElement = document.querySelector(`[data-value="${siteKey}"]`);
                if (siteElement && siteElement.parentNode) {
                    siteElement.parentNode.removeChild(siteElement);
                }

                // Update scrollable class if needed
                const siteContainer = document.querySelector('.site-container.site-filters-container');
                if (siteContainer) {
                    const remainingSites = siteContainer.querySelectorAll('.filter-option.site-filter');
                    if (remainingSites.length <= CONFIG.PANEL_MAX_SITES_BEFORE_SCROLL) {
                        siteContainer.classList.remove('scrollable');
                    }
                }

                updateButton();
                showToast('Site removed successfully', 'success');
            }
        }, 'removeCustomSite');
    }

    function clearFilter(filterType) {
        const defaultValue = (filterType === 'interfaceLang' || filterType === 'region') ? 'auto' : 'all';

        currentFilters[filterType] = defaultValue;

        if (persistenceSettings[filterType]) {
            localStorage.setItem(getStorageKey(filterType), defaultValue);
        }

        updateButton();
        updateFilterSelection(filterType, defaultValue);

        if (isSearchPage()) {
            setTimeout(() => {
                applyFilters();
            }, 200);
        }

        const filterName = getFilterName(filterType);
        showToast(`${filterName} cleared`, 'success');
    }

    function clearSiteFilter() { clearFilter('site'); }
    function clearTimeFilter() { clearFilter('time'); }

    function createFilterSection(filterType, title, colors) {
        const sectionGenerators = {
            searchLang: () => createLanguageFilterSection(filterType, title, colors, 'flag', 'all'),
            interfaceLang: () => createLanguageFilterSection(filterType, title, colors, 'world', 'auto'),
            region: () => createLanguageFilterSection(filterType, title, colors, 'location', 'auto'),
            time: () => createTimeFilterSection(filterType, title, colors),
            site: () => createSiteFilterSection(filterType, title, colors)
        };

        return sectionGenerators[filterType]?.() || '';
    }

    function createLanguageFilterSection(filterType, title, colors, icon, defaultValue) {
        const isPersistent = persistenceSettings[filterType];
        const isActive = currentFilters[filterType] !== defaultValue;
        const sectionData = Object.entries(filters[filterType]);

        return `
            <div class="filter-section">
                ${createSectionHeader(title, icon, colors, isPersistent, isActive)}
                <div class="filter-grid">
                    ${sectionData.map(([code, filter]) =>
                        createLanguageFilterOption(filterType, code, filter, colors)
                    ).join('')}
                </div>
            </div>
        `;
    }

    function createTimeFilterSection(filterType, title, colors) {
        const isPersistent = persistenceSettings[filterType];
        const hasTimeFilter = currentFilters[filterType] !== 'all';
        const sectionData = Object.entries(filters[filterType]);

        return `
            <div class="filter-section" data-filter-type="time">
                <div class="section-header">
                    ${createSectionTitle(title, 'clock', colors, isPersistent, hasTimeFilter)}
                    <button id="clear-time-filter" class="btn btn-xs btn-warning clear-btn ${hasTimeFilter ? 'visible' : ''}" title="Clear time filter">
                        ${getSVGIcon('x', 8, 'white')}
                    </button>
                </div>
                <div class="time-controls">
                    ${sectionData.slice(1).map(([code, filter]) => {
                        const isActive = currentFilters[filterType] === code;
                        return `<div class="time-filter ${isActive ? 'active' : ''}" data-type="${filterType}" data-value="${code}">
                                    <span class="font-semibold">${filter.short}</span>
                                </div>`;
                    }).join('')}
                </div>
            </div>
        `;
    }

    function createSiteFilterSection(filterType, title, colors) {
        const isPersistent = persistenceSettings[filterType];
        const hasSiteFilter = currentFilters.site !== 'all';
        const sectionData = Object.entries(filters.site);
        const defaultSites = ['reddit', 'github', 'eksisozluk', 'donanimhaber'];
        const shouldScroll = sectionData.length > 5;

        return `
            <div class="filter-section" data-filter-type="site">
                <div class="section-header">
                    ${createSectionTitle(title, 'location', colors, isPersistent, hasSiteFilter)}
                    <div class="flex gap-1">
                        <button id="clear-site-filter" class="btn btn-xs btn-warning clear-btn ${hasSiteFilter ? 'visible' : ''}" title="Clear site filter">
                            ${getSVGIcon('x', 8, 'white')}
                        </button>
                        <button id="add-site-btn" class="btn btn-xs btn-ghost" title="Add new site">+</button>
                    </div>
                </div>
                <div class="site-container ${shouldScroll ? 'scrollable' : ''} site-filters-container">
                    ${sectionData.map(([code, filter]) =>
                        createSiteFilterOption(code, filter, colors, defaultSites)
                    ).join('')}
                </div>
            </div>
        `;
    }

    function createSectionHeader(title, icon, colors, isPersistent, isActive) {
        return `<div class="section-header">${createSectionTitle(title, icon, colors, isPersistent, isActive)}</div>`;
    }

    function createSectionTitle(title, icon, colors, isPersistent, isActive) {
        return `<div class="section-title">
            ${getSVGIcon(icon, 16, colors.textSoft)}
            <span>${title}</span>
            ${isActive ? '<div class="status-dot"></div>' : ''}
            ${isPersistent ? '<div class="persistent-badge" title="This filter is persistently remembered">Persistent</div>' : ''}
        </div>`;
    }

    function createLanguageFilterOption(filterType, code, filter, colors) {
        const isActive = currentFilters[filterType] === code;
        const icon = (filter.icon === '🇹🇷' || filter.icon === '🇺🇸') ?
            filter.icon : getSVGIcon(filter.icon, 14, isActive ? 'white' : colors.primary);

        return `<div class="filter-option language-filter ${isActive ? 'active' : ''}" data-type="${filterType}" data-value="${code}">
            <div class="text-base">${icon}</div>
            <div class="text-xs font-semibold">${filter.short}</div>
            ${isActive ? '<div class="active-indicator"></div>' : ''}
        </div>`;
    }

    function createSiteFilterOption(code, filter, colors, defaultSites) {
        const isActive = currentFilters.site === code;
        const isCustomSite = !defaultSites.includes(code);

        return `<div class="filter-option site-filter ${isActive ? 'active' : ''}" data-type="site" data-value="${code}">
            <div class="site-content">
                ${createFaviconImg(filter.icon, filter.domain)}
                <span class="site-name">${filter.short}</span>
            </div>
            <div class="site-actions">
                ${isActive ? '<div class="site-indicator"></div>' : ''}
                ${isCustomSite ? `<button class="remove-btn" data-site="${code}"
                       style="background: ${isActive ? 'rgba(255,255,255,0.2)' : colors.borderLight}; color: ${isActive ? 'white' : colors.textMuted};"
                       title="Remove" onclick="event.stopPropagation();">×</button>` : ''}
            </div>
        </div>`;
    }

    function createLanguageRegionSection(colors) {
        const hasActiveLanguageFilters = (
            currentFilters.searchLang !== 'all' ||
            currentFilters.interfaceLang !== 'auto' ||
            currentFilters.region !== 'auto'
        );

        return `
            <div class="segment-control-container">
                <div class="segment-control-header">
                    <div class="segment-control-title">
                        ${getSVGIcon('globe', 16, colors.textMuted)}
                        <span>Language & Region</span>
                        ${hasActiveLanguageFilters ? `<div class="status-dot"></div>` : ''}
                    </div>
                </div>

                <!-- Search Results Language Row -->
                <div class="segment-row" data-filter-type="searchLang">
                    <div class="segment-label-container">
                        <div class="segment-label">Search Results</div>
                        ${persistenceSettings.searchLang ? '<div class="persistent-badge segment-persistent-badge" title="This filter is persistently remembered">Persistent</div>' : ''}
                    </div>
                    <div class="segment-buttons">
                        ${Object.entries(filters.searchLang).map(([code, filter]) => {
                            const isActive = currentFilters.searchLang === code;
                            return `
                                <button class="segment-button ${isActive ? 'active' : ''}"
                                        data-type="searchLang"
                                        data-value="${code}"
                                        title="${filter.name}">
                                    <span class="flag-icon">
                                        ${filter.icon === '🇹🇷' || filter.icon === '🇺🇸' ?
                                          filter.icon :
                                          getSVGIcon(filter.icon, 10, isActive ? 'white' : colors.textSoft)}
                                    </span>
                                    <span class="text-content">${filter.short}</span>
                                </button>
                            `;
                        }).join('')}
                    </div>
                </div>

                <!-- Interface Language Row -->
                <div class="segment-row" data-filter-type="interfaceLang">
                    <div class="segment-label-container">
                        <div class="segment-label">Interface</div>
                        ${persistenceSettings.interfaceLang ? '<div class="persistent-badge segment-persistent-badge" title="This filter is persistently remembered">Persistent</div>' : ''}
                    </div>
                    <div class="segment-buttons">
                        ${Object.entries(filters.interfaceLang).map(([code, filter]) => {
                            const isActive = currentFilters.interfaceLang === code;
                            return `
                                <button class="segment-button ${isActive ? 'active' : ''}"
                                        data-type="interfaceLang"
                                        data-value="${code}"
                                        title="${filter.name}">
                                    <span class="flag-icon">
                                        ${filter.icon === '🇹🇷' || filter.icon === '🇺🇸' ?
                                          filter.icon :
                                          getSVGIcon(filter.icon, 10, isActive ? 'white' : colors.textSoft)}
                                    </span>
                                    <span class="text-content">${filter.short}</span>
                                </button>
                            `;
                        }).join('')}
                    </div>
                </div>

                <!-- Geolocation Row -->
                <div class="segment-row" data-filter-type="region">
                    <div class="segment-label-container">
                        <div class="segment-label">Geolocation</div>
                        ${persistenceSettings.region ? '<div class="persistent-badge segment-persistent-badge" title="This filter is persistently remembered">Persistent</div>' : ''}
                    </div>
                    <div class="segment-buttons">
                        ${Object.entries(filters.region).map(([code, filter]) => {
                            const isActive = currentFilters.region === code;
                            return `
                                <button class="segment-button ${isActive ? 'active' : ''}"
                                        data-type="region"
                                        data-value="${code}"
                                        title="${filter.name}">
                                    <span class="flag-icon">
                                        ${filter.icon === '🇹🇷' || filter.icon === '🇺🇸' ?
                                          filter.icon :
                                          getSVGIcon(filter.icon, 10, isActive ? 'white' : colors.textSoft)}
                                    </span>
                                    <span class="text-content">${filter.short}</span>
                                </button>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    function setupPanelEvents() {
        const panel = document.getElementById('filter-panel');

        panel.addEventListener('click', (e) => {
            // Handle filter selections (segment buttons, options, time filters)
            const filterElement = e.target.closest('.segment-button, .filter-option, .time-filter');
            if (filterElement?.dataset.type && filterElement?.dataset.value) {
                selectFilter(filterElement.dataset.type, filterElement.dataset.value);
                return;
            }

            // Handle specific buttons
            const buttonHandlers = {
                '.remove-btn': (el) => { e.stopPropagation(); removeCustomSite(el.dataset.site); },
                '#clear-filters': clearAllFilters,
                '#clear-site-filter': clearSiteFilter,
                '#clear-time-filter': clearTimeFilter,
                '#add-site-btn': () => { e.stopPropagation(); e.preventDefault(); addCustomSite(); },
                '#settings-toggle': () => { e.stopPropagation(); toggleSettingsCollapse(); }
            };

            for (const [selector, handler] of Object.entries(buttonHandlers)) {
                const element = e.target.closest(selector);
                if (element) {
                    handler(element);
                    return;
                }
            }

            // Handle toggle switches
            const toggleSwitch = e.target.closest('.toggle-switch');
            if (toggleSwitch?.dataset.filter) {
                const filterType = toggleSwitch.dataset.filter;
                filterType === 'autoOpen' ? toggleAutoOpen() : togglePersistence(filterType);
            }
        });
    }

    function toggleAutoOpen() {
        autoOpenPanel = !autoOpenPanel;
        localStorage.setItem('googleSearchAutoOpen', autoOpenPanel.toString());

        // Update only the specific toggle switch
        const toggleSwitch = document.querySelector('[data-filter="autoOpen"]');
        if (toggleSwitch) {
            if (autoOpenPanel) {
                toggleSwitch.classList.add('active', 'auto-open');
            } else {
                toggleSwitch.classList.remove('active', 'auto-open');
            }
        }

        const status = autoOpenPanel ? 'enabled' : 'disabled';
        showToast(`Auto-open panel ${status}`, 'success');

        if (autoOpenPanel && !globalState.isOpen) {
            togglePanel();
        } else if (!autoOpenPanel && globalState.isOpen) {
            togglePanel();
        }
    }

    function togglePersistence(filterType) {
        persistenceSettings[filterType] = !persistenceSettings[filterType];
        localStorage.setItem(getPersistStorageKey(filterType), persistenceSettings[filterType].toString());

        if (!persistenceSettings[filterType]) {
            const defaultValue = (filterType === 'interfaceLang' || filterType === 'region') ? 'auto' : 'all';
            currentFilters[filterType] = defaultValue;
            localStorage.removeItem(getStorageKey(filterType));
        } else {
            const currentValue = currentFilters[filterType];
            localStorage.setItem(getStorageKey(filterType), currentValue);
        }

        // Update only the specific toggle switch instead of recreating entire panel
        const toggleSwitch = document.querySelector(`[data-filter="${filterType}"]`);
        if (toggleSwitch) {
            if (persistenceSettings[filterType]) {
                toggleSwitch.classList.add('active');
            } else {
                toggleSwitch.classList.remove('active');
            }
        }

        // Update persistent badges for this filter type
        updatePersistentBadges(filterType, persistenceSettings[filterType]);

        updateButton();

        const filterName = getFilterName(filterType);
        const status = persistenceSettings[filterType] ? 'enabled' : 'disabled';
        showToast(`${filterName} persistence ${status}`, 'success');

        // Only apply filters if user explicitly wants to (don't auto-refresh)
        // User can manually apply by selecting a filter or using Clear All
    }

    function updatePersistentBadges(filterType, isEnabled) {
        // Find the container for this filter type
        const filterContainer = document.querySelector(`[data-filter-type="${filterType}"]`);
        if (!filterContainer) return;

        // Remove any existing badges first to prevent duplicates
        const existingBadges = filterContainer.querySelectorAll('.persistent-badge, .segment-persistent-badge');
        existingBadges.forEach(badge => badge.remove());

        if (isEnabled) {
            // Find the appropriate container for the badge
            const labelContainer = filterContainer.querySelector('.segment-label-container');
            const sectionTitle = filterContainer.querySelector('.section-title');
            const targetContainer = labelContainer || sectionTitle;

            if (targetContainer) {
                // Create and add new badge
                const badge = document.createElement('div');
                badge.className = labelContainer ? 'persistent-badge segment-persistent-badge' : 'persistent-badge';
                badge.title = 'This filter is persistently remembered';
                badge.textContent = 'Persistent';
                targetContainer.appendChild(badge);
            }
        }
    }

    function toggleSettingsCollapse() {
        globalState.settingsCollapsed = !globalState.settingsCollapsed;

        const settingsContent = document.querySelector('.settings-content');
        const settingsToggle = document.querySelector('.settings-toggle');

        if (settingsContent && settingsToggle) {
            if (globalState.settingsCollapsed) {
                settingsContent.classList.add('collapsed');
                settingsToggle.classList.add('collapsed');
                showToast('Settings collapsed', 'info');
            } else {
                settingsContent.classList.remove('collapsed');
                settingsToggle.classList.remove('collapsed');
                showToast('Settings expanded', 'info');
            }
        }
    }

    function selectFilter(filterType, value) {
        if (currentFilters[filterType] === value) return;

        const btn = document.getElementById('filter-btn');
        if (btn) {
            btn.classList.add('button-press');
            setTimeout(() => btn.classList.remove('button-press'), 200);
        }

        currentFilters[filterType] = value;

        // Handle interface language changes with simple approach
        if (filterType === 'interfaceLang') {
            if (persistenceSettings[filterType]) {
                localStorage.setItem(getStorageKey(filterType), value);
            }
            applyInterfaceLanguage(value);
            return;
        }

        if (filterType === 'region') {
            if (persistenceSettings[filterType]) {
                localStorage.setItem(getStorageKey(filterType), value);
            }
            applyRegionChange(value);
            return;
        }

        if (persistenceSettings[filterType]) {
            localStorage.setItem(getStorageKey(filterType), value);
        }

        updateButton();
        updateFilterSelection(filterType, value);

        if (isSearchPage()) {
            setTimeout(() => {
                applyFilters();
            }, 200);
        }

        const filterName = filters[filterType][value].name;
        showToast(`${filterName} selected`, 'success');
    }

    function clearAllFilters() {
        if (!hasActiveFilters()) return;

        // Clear ALL filters regardless of persistence settings
        Object.keys(currentFilters).forEach(filterType => {
            const defaultValue = (filterType === 'interfaceLang' || filterType === 'region') ? 'auto' : 'all';
            currentFilters[filterType] = defaultValue;

            if (persistenceSettings[filterType]) {
                localStorage.setItem(getStorageKey(filterType), defaultValue);
            }

            updateFilterSelection(filterType, defaultValue);
        });

        updateButton();

        if (isSearchPage()) {
            setTimeout(() => {
                applyFilters();
            }, 200);
        }

        showToast('All filters cleared', 'success');
    }

    function hasActiveFilters() {
        return Object.entries(currentFilters).some(([key, val]) => {
            const defaultVal = (key === 'interfaceLang' || key === 'region') ? 'auto' : 'all';
            return val !== defaultVal;
        });
    }

    function togglePanel() {
        const button = document.getElementById('filter-btn');
        const panel = document.getElementById('filter-panel');
        const chevron = button.querySelector('.filter-btn-chevron svg');

        globalState.isOpen = !globalState.isOpen;

        if (globalState.isOpen) {
            panel.classList.add('panel-open');
            button.classList.add('button-active');
            if (chevron) chevron.style.transform = 'rotate(180deg)';
        } else {
            panel.classList.remove('panel-open');
            button.classList.remove('button-active');
            if (chevron) chevron.style.transform = 'rotate(0deg)';
        }
    }

    function updateButton() {
        const button = document.getElementById('filter-btn');
        if (button) {
            button.innerHTML = createButtonContent();
        }
    }

    function updateFilterSelection(filterType, value) {
        const colors = getColors();

        // Update filter options to reflect new selection - handle all button types
        let filterSelector = `[data-type="${filterType}"]`;
        if (filterType === 'time') {
            filterSelector = `.time-filter[data-type="${filterType}"], .filter-option[data-type="${filterType}"], .segment-button[data-type="${filterType}"]`;
        } else {
            filterSelector = `.filter-option[data-type="${filterType}"], .segment-button[data-type="${filterType}"]`;
        }

        const filterOptions = document.querySelectorAll(filterSelector);
        filterOptions.forEach(option => {
            const isActive = option.dataset.value === value;
            if (isActive) {
                option.classList.add('active');
            } else {
                option.classList.remove('active');
            }
        });

        // Update status dots and clear buttons visibility
        updateSectionIndicators(filterType, value);
        updateClearButtons();
    }

    function updateSectionIndicators(filterType, value) {
        const isActive = (filterType === 'interfaceLang' || filterType === 'region') ? (value !== 'auto') : (value !== 'all');
        const sectionHeader = document.querySelector(`[data-type="${filterType}"]`)?.closest('.filter-section')?.querySelector('.section-header');

        if (sectionHeader) {
            const statusDot = sectionHeader.querySelector('.status-dot');
            if (isActive && !statusDot) {
                const dot = document.createElement('div');
                dot.className = 'status-dot';
                sectionHeader.querySelector('.section-title').appendChild(dot);
            } else if (!isActive && statusDot) {
                statusDot.remove();
            }
        }
    }

    function updateClearButtons() {
        const timeFilter = currentFilters.time !== 'all';
        const siteFilter = currentFilters.site !== 'all';

        const timeClearBtn = document.getElementById('clear-time-filter');
        const siteClearBtn = document.getElementById('clear-site-filter');

        if (timeClearBtn) {
            if (timeFilter) {
                timeClearBtn.classList.add('visible');
            } else {
                timeClearBtn.classList.remove('visible');
            }
        }

        if (siteClearBtn) {
            if (siteFilter) {
                siteClearBtn.classList.add('visible');
            } else {
                siteClearBtn.classList.remove('visible');
            }
        }

        // Update Clear All button
        const clearAllBtn = document.getElementById('clear-filters');
        const clearAllContainer = document.querySelector('.clear-all-container');
        const hasActiveFilters = Object.entries(currentFilters).some(([key, val]) => {
            return (key === 'interfaceLang' || key === 'region') ? (val !== 'auto') : (val !== 'all');
        });

        if (hasActiveFilters && !clearAllBtn) {
            // Need to add Clear All button
            if (clearAllContainer) {
                const colors = getColors();
                clearAllContainer.innerHTML = `
                    <button id="clear-filters" class="btn btn-md btn-danger uppercase tracking-wider">
                        ${getSVGIcon('x', 12, 'white')}
                        Clear All
                    </button>
                `;
            }
        } else if (!hasActiveFilters && clearAllContainer) {
            // Remove Clear All button
            clearAllContainer.innerHTML = '';
        }
    }

    function updatePanel() {
        const panel = document.getElementById('filter-panel');
        if (panel) {
            panel.innerHTML = createPanelContent();
            setupPanelEvents();
        }
    }

    function updatePosition() {
        const container = document.getElementById('advanced-search-widget');
        if (container) {
            const newTop = getOptimalPosition();
            container.style.top = `${newTop}px`;
        }
    }

    function updateTheme() {
        safeExecute(() => {
            const panel = document.getElementById('filter-panel');
            if (panel) {
                const dark = isDarkMode();

                // Update panel background colors
                const bgGradient = `linear-gradient(180deg, ${dark ? 'rgba(32, 33, 36, 0.95)' : 'rgba(255, 255, 255, 0.55)'}, ${dark ? 'rgba(24, 25, 28, 0.90)' : 'rgba(250, 251, 252, 0.60)'})`;
                const borderColor = dark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)';
                const colors = getColors();

                // Update panel styling
                panel.style.background = bgGradient;
                panel.style.borderColor = borderColor;
                panel.style.boxShadow = colors.shadow;

                // Update panel content with new theme colors
                updatePanel();
            }
        }, 'updateTheme');
    }

    // Toast management state
    const toastState = {
        activeToasts: new Set(),
        lastMessage: null,
        lastTimestamp: 0
    };

    function showToast(message, type = 'info') {
        if (!isValidNonEmptyString(message)) return;

        safeExecute(() => {
            const sanitizedMessage = sanitizeHTML(message.trim());
            const now = Date.now();

            // Prevent duplicate messages
            if (toastState.lastMessage === sanitizedMessage && now - toastState.lastTimestamp < 1000) return;

            toastState.lastMessage = sanitizedMessage;
            toastState.lastTimestamp = now;

            const colors = getColors();
            const bgColor = { success: colors.success, warning: colors.warning, error: colors.error, info: colors.primary }[type] || colors.primary;
            const activeCount = toastState.activeToasts.size;

            const toast = document.createElement('div');
            toast.className = 'advanced-search-toast';
            toast.style.cssText = `position: fixed; bottom: ${32 + (activeCount * 60)}px; left: 50%; transform: translateX(-50%) translateY(40px);
                background: ${bgColor}; color: white; padding: 10px 20px; border-radius: 20px; font-size: 13px;
                font-family: -apple-system, BlinkMacSystemFont, "Google Sans", Roboto, sans-serif; font-weight: 500;
                z-index: ${10001 + activeCount}; opacity: 0; transition: all ${CONFIG.ANIMATION_DURATION}ms cubic-bezier(0.16, 1, 0.3, 1);
                box-shadow: 0 6px 24px rgba(0,0,0,0.2); pointer-events: none; backdrop-filter: blur(8px); max-width: 90vw; text-align: center;`;
            toast.textContent = sanitizedMessage;

            if (!document.body) return;

            document.body.appendChild(toast);
            toastState.activeToasts.add(toast);

            requestAnimationFrame(() => {
                toast.style.opacity = '1';
                toast.style.transform = 'translateX(-50%) translateY(0)';
            });

            const timeoutId = setTimeout(() => {
                removeToast(toast);
                globalState.timeouts.delete(timeoutId);
            }, CONFIG.TOAST_DURATION);
            globalState.timeouts.add(timeoutId);

        }, 'showToast');
    }

    function removeToast(toast) {
        if (!toast || !toast.parentNode) return;

        safeExecute(() => {
            toastState.activeToasts.delete(toast);

            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(40px)';

            const removeTimeoutId = setTimeout(() => {
                if (toast && toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }

                // Reposition remaining toasts
                const remainingToasts = Array.from(document.querySelectorAll('.advanced-search-toast'));
                remainingToasts.forEach((remainingToast, index) => {
                    remainingToast.style.bottom = `${32 + (index * 60)}px`;
                    remainingToast.style.zIndex = `${10001 + index}`;
                });

                globalState.timeouts.delete(removeTimeoutId);
            }, CONFIG.ANIMATION_DURATION);

            globalState.timeouts.add(removeTimeoutId);

        }, 'removeToast');
    }

    function clearAllToasts() {
        safeExecute(() => {
            toastState.activeToasts.forEach(toast => removeToast(toast));
            toastState.activeToasts.clear();
            toastState.lastMessage = null;
            toastState.lastTimestamp = 0;
        }, 'clearAllToasts');
    }

    function isSearchPage() {
        return window.location.pathname === '/search' && window.location.search.includes('q=');
    }

    function formatSearchDate(date) {
        const month = date.getMonth() + 1;
        const day = date.getDate();
        const year = date.getFullYear();
        return `${month}/${day}/${year}`;
    }

    function createTimeFilterValue(timeParam) {
        if (timeParam.startsWith('custom:')) {
            const customType = timeParam.split(':')[1];
            if (customType === '2y') {
                const today = new Date();
                const twoYearsAgo = new Date();
                twoYearsAgo.setFullYear(today.getFullYear() - 2);

                const startDate = formatSearchDate(twoYearsAgo);
                const endDate = formatSearchDate(today);

                return `cdr:1,cd_min:${startDate},cd_max:${endDate}`;
            }
        }
        return `qdr:${timeParam}`;
    }

    function applyFilters() {
        const currentUrl = new URL(window.location.href);
        const params = currentUrl.searchParams;
        let searchQuery = params.get('q') || '';

        // Clean existing site: queries from the search
        const cleanQuery = searchQuery
            .replace(/\s*site:\S+/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        // Add selected site filter
        if (currentFilters.site !== 'all') {
            const siteQuery = filters.site[currentFilters.site].query;
            searchQuery = `${cleanQuery} ${siteQuery}`.trim();
        } else {
            searchQuery = cleanQuery;
        }

        params.set('q', searchQuery);

        // Apply search language filter
        if (currentFilters.searchLang !== 'all') {
            params.set('lr', `lang_${currentFilters.searchLang}`);
        } else {
            params.delete('lr');
        }

        // Apply time filter
        if (currentFilters.time !== 'all') {
            params.set('tbs', createTimeFilterValue(filters.time[currentFilters.time].param));
        } else {
            params.delete('tbs');
        }

        // Apply interface language filter
        if (currentFilters.interfaceLang !== 'auto') {
            const interfaceData = filters.interfaceLang[currentFilters.interfaceLang];
            if (interfaceData && interfaceData.googleLang) {
                params.set('hl', interfaceData.googleLang);
            }
        } else {
            params.delete('hl');
        }

        // Apply geolocation filter
        if (currentFilters.region !== 'auto') {
            const regionData = filters.region[currentFilters.region];
            if (regionData && regionData.googleRegion) {
                params.set('gl', regionData.googleRegion);
            }
        } else {
            params.delete('gl');
        }

        window.location.href = currentUrl.toString();
    }

    function interceptSearchForm() {
        const searchForm = document.querySelector('form[role="search"]') ||
                          document.querySelector('form[action="/search"]');

        if (searchForm && !searchForm.hasAttribute('data-filter-intercepted')) {
            searchForm.setAttribute('data-filter-intercepted', 'true');
            searchForm.addEventListener('submit', function(e) {
                const searchInput = this.querySelector('input[name="q"]');
                if (searchInput && currentFilters.site !== 'all') {
                    const currentQuery = searchInput.value;
                    const siteQuery = filters.site[currentFilters.site].query;

                    if (!currentQuery.includes('site:')) {
                        searchInput.value = `${currentQuery} ${siteQuery}`.trim();
                    }
                }

                if (currentFilters.searchLang !== 'all') {
                    const existingLr = this.querySelector('input[name="lr"]');
                    if (existingLr) existingLr.remove();

                    const lrInput = document.createElement('input');
                    lrInput.type = 'hidden';
                    lrInput.name = 'lr';
                    lrInput.value = `lang_${currentFilters.searchLang}`;
                    this.appendChild(lrInput);
                }

                if (currentFilters.time !== 'all') {
                    const existingTbs = this.querySelector('input[name="tbs"]');
                    if (existingTbs) existingTbs.remove();

                    const tbsInput = document.createElement('input');
                    tbsInput.type = 'hidden';
                    tbsInput.name = 'tbs';
                    tbsInput.value = createTimeFilterValue(filters.time[currentFilters.time].param);

                    this.appendChild(tbsInput);
                }
            });
        }
    }

    function checkCurrentFilters(url) {
        const params = url.searchParams;
        const query = params.get('q') || '';
        const lr = params.get('lr') || '';
        const tbs = params.get('tbs') || '';
        const hl = params.get('hl') || '';
        const gl = params.get('gl') || '';

        if (currentFilters.site !== 'all') {
            const expectedSite = filters.site[currentFilters.site].query;
            if (!query.includes(expectedSite)) return false;
        }

        if (currentFilters.searchLang !== 'all') {
            const expectedLr = `lang_${currentFilters.searchLang}`;
            if (lr !== expectedLr) return false;
        }

        if (currentFilters.time !== 'all') {
            const timeParam = filters.time[currentFilters.time].param;
            if (timeParam.startsWith('custom:')) {
                const customType = timeParam.split(':')[1];
                if (customType === '2y') {
                    // For custom 2-year range, just check if tbs contains custom date range
                    if (!tbs.startsWith('cdr:1,cd_min:')) return false;
                }
            } else {
                const expectedTbs = `qdr:${timeParam}`;
                if (tbs !== expectedTbs) return false;
            }
        }

        // Check interface language filter
        if (currentFilters.interfaceLang !== 'auto') {
            const interfaceData = filters.interfaceLang[currentFilters.interfaceLang];
            if (interfaceData && interfaceData.googleLang) {
                const expectedHl = interfaceData.googleLang;
                if (hl !== expectedHl) return false;
            }
        } else {
            // If filter is set to auto, URL should not have hl parameter
            if (hl !== '') return false;
        }

        // Check geolocation filter
        if (currentFilters.region !== 'auto') {
            const regionData = filters.region[currentFilters.region];
            if (regionData && regionData.googleRegion) {
                const expectedGl = regionData.googleRegion;
                if (gl !== expectedGl) return false;
            }
        } else {
            // If filter is set to auto, URL should not have gl parameter
            if (gl !== '') return false;
        }

        return true;
    }

    function init() {
        return safeExecute(() => {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', init);
                return;
            }

            // Only run on Google search pages
            if (!window.location.hostname.includes('google.')) {
                console.log('[Advanced Search] Not a Google domain, skipping initialization');
                return;
            }

            // Check if already initialized
            if (window.advancedSearchInitialized) {
                console.log('[Advanced Search] Already initialized, skipping');
                return;
            }

            window.advancedSearchInitialized = true;
            console.log('[Advanced Search] Initializing script');

            // Setup cleanup handler for page unload
            const cleanupHandler = () => {
                console.log('[Advanced Search] Cleaning up on page unload');
                cleanup();
            };
            addTrackedEventListener(window, 'beforeunload', cleanupHandler);

            // Wait for Google's interface to load with timeout protection
            const timeoutId = setTimeout(() => {
                safeExecute(() => {
                    createWidget();
                    setupResponsiveHandlers();

                    if (isSearchPage()) {
                        const currentUrl = new URL(window.location.href);
                        const hasCorrectFilters = checkCurrentFilters(currentUrl);

                        if (!hasCorrectFilters) {
                            applyFilters();
                            return;
                        }
                    }

                    interceptSearchForm();

                    // System is now ready - interface language changes are handled simply through URL parameters
                    console.log('[Advanced Search] Interface language system initialized with clean approach');
                }, 'delayedInitialization');
                globalState.timeouts.delete(timeoutId);
            }, CONFIG.INITIALIZATION_DELAY || 800);

            globalState.timeouts.add(timeoutId);

        }, 'init');
    }

    function setupResponsiveHandlers() {
        return safeExecute(() => {
            // Debounced resize handler for responsive positioning
            const debouncedResize = debounce(() => {
                safeExecute(() => {
                    updatePosition();
                    updatePanelHeight();
                }, 'resizeHandler');
            }, CONFIG.DEBOUNCE_DELAY);

            // Debounced scroll handler for sticky behavior
            const debouncedScroll = debounce(() => {
                safeExecute(() => {
                    updatePosition();
                }, 'scrollHandler');
            }, CONFIG.DEBOUNCE_DELAY / 2);

            addTrackedEventListener(window, 'resize', debouncedResize);
            addTrackedEventListener(window, 'scroll', debouncedScroll);

        }, 'setupResponsiveHandlers');
    }

    // Initialize the script when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Handle URL changes for single-page app navigation
    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            setTimeout(() => {
                interceptSearchForm();
                updatePosition();
            }, 200);
        }
    }).observe(document, { subtree: true, childList: true });

})();
