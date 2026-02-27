// ==UserScript==
// @name         WME Väylävirasto
// @namespace    https://waze.com
// @version      2.3.2
// @description  Suomen Väyläviraston WMS- ja WFS-tasot Waze Map Editoria varten
// @author       Stemmi
// @match        https://*.waze.com/*editor*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      avoinapi.vaylapilvi.fi
// @license      MIT
// @run-at       document-idle
// @require      https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.9.0/proj4.js
// ==/UserScript==

(function () {
    'use strict';

    let availableLayers = [];
    let activeLayers = new Map(); // WMS layers
    let activeWfsLayers = new Map(); // WFS vector layers
    let quickAccessLayers = new Set();
    let floatingButton = null;
    let sidebarPanel = null;
    let selectedProvider = null; // Provider filter state (null = all providers)
    let wmeSDK = null; // SDK instance

    // WFS/Tooltip mode toggle - when true, layers activate in WFS mode with tooltips
    let wfsTooltipMode = false;

    // Interaction-based WFS fetching state
    let interactionTimeout = null;           // Debounce timer for interaction fetch
    let interactionHandlersRegistered = false; // Track if handlers are registered
    const HOVER_DEBOUNCE_MS = 1000;          // Visual tooltips: slower rate per CONTEXT.md
    const FETCH_RADIUS_METERS = 25;          // Fetch radius per context
    const BUFFER_METERS = 5;                 // Small buffer for smoother movement

    // Road name tooltip state
    let currentTooltip = null;               // Current tooltip element
    let tooltipTimeout = null;               // Auto-hide timeout
    let lastHoverAreaKey = null;             // Track last hover for re-entry detection
    let lastHoverTime = 0;                   // Track last hover time for re-entry detection

    // Visual tooltip DOM element
    let tooltipElement = null;               // Floating tooltip DOM element

    // LRU cache for geographic areas
    const MAX_CACHED_AREAS = 10;              // Maximum areas to cache (per context)
    const featureAreaCache = new Map();       // { areaKey: { timestamp, features: Map, layers: Set } }

    const WMS_CONFIG = {
        baseUrl: 'https://avoinapi.vaylapilvi.fi/vaylatiedot/wms',
        version: '1.3.0',
        crs: 'EPSG:3857'
    };

    const WFS_CONFIG = {
        baseUrl: 'https://avoinapi.vaylapilvi.fi/vaylatiedot/ows',
        version: '2.0.0',
        outputFormat: 'application/json',  // GeoJSON
        sourceCRS: 'EPSG:3067',            // Finnish ETRS-TM35FIN
        targetCRS: 'EPSG:3857',            // Web Mercator (WME)
        defaultCount: 50,                  // Max features per request
        timeout: 10000                     // Request timeout (ms)
    };

    // Fallback WFS layers if GetCapabilities fails
    const FALLBACK_WFS_LAYERS = [
        {
            name: 'digiroad:dr_nopeusrajoitus',
            title: 'Nopeusrajoitukset',
            abstract: 'Speed limits from Digiroad',
            crs: 'EPSG:3067',
            supportsWFS: true,
            visible: false,
            opacity: 0.8,
            properties: [],
            propertiesLoaded: false
        },
        {
            name: 'digiroad:dr_talvinopeusrajoitus',
            title: 'Talvinopeusrajoitukset',
            abstract: 'Winter speed limits from Digiroad',
            crs: 'EPSG:3067',
            supportsWFS: true,
            visible: false,
            opacity: 0.8,
            properties: [],
            propertiesLoaded: false
        },
        {
            name: 'digiroad:dr_leveys',
            title: 'Tien leveys',
            abstract: 'Road width from Digiroad',
            crs: 'EPSG:3067',
            supportsWFS: true,
            visible: false,
            opacity: 0.8,
            properties: [],
            propertiesLoaded: false
        }
    ];

    const STORAGE_KEYS = {
        quickAccess: 'wme-vaylavirasto-quickaccess',
        activeLayers: 'wme-vaylavirasto-active',
        activeWfsLayers: 'wme-vaylavirasto-active-wfs',
        layerOpacity: 'wme-vaylavirasto-opacity',
        buttonPosition: 'wme-vaylavirasto-position',
        initialized: 'wme-vaylavirasto-initialized'
    };

    const DEFAULT_QUICK_ACCESS_LAYERS = [
        'digiroad:dr_leveys',              // Road width
        'digiroad:dr_nopeusrajoitus',      // Speed limits
        'digiroad:dr_talvinopeusrajoitus', // Winter speed limits
        'digiroad:dr_tielinkki_tielinkin_tyyppi', // Junction types
        'digiroad:tiekunnalliset_yksityistiet' // Private roads
    ];

    function createElem(tag, attrs = {}) {
        const elem = document.createElement(tag);
        Object.entries(attrs).forEach(([key, value]) => {
            if (key === 'style') {
                elem.setAttribute(key, value);
            } else if (key === 'textContent') {
                elem.textContent = value;
            } else if (key === 'innerHTML') {
                elem.innerHTML = value;
            } else {
                elem.setAttribute(key, value);
            }
        });
        return elem;
    }

    let saveTimeout;
    function savePreferences() {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            try {
                // Save quick access layers
                localStorage.setItem(STORAGE_KEYS.quickAccess, JSON.stringify(Array.from(quickAccessLayers)));

                // Save active layers
                localStorage.setItem(STORAGE_KEYS.activeLayers, JSON.stringify(Array.from(activeLayers.keys())));

                // Save layer opacities
                const opacities = {};
                availableLayers.forEach(layer => {
                    if (layer.opacity !== 0.8) { // Only save if different from default
                        opacities[layer.name] = layer.opacity;
                    }
                });
                localStorage.setItem(STORAGE_KEYS.layerOpacity, JSON.stringify(opacities));

                // Save button position
                if (floatingButton) {
                    const position = {
                        top: floatingButton.style.top,
                        left: floatingButton.style.left
                    };
                    localStorage.setItem(STORAGE_KEYS.buttonPosition, JSON.stringify(position));
                }

                // Save WFS tooltip mode preference
                localStorage.setItem('wme-vaylavirasto-wfs-mode', JSON.stringify(wfsTooltipMode));

                // Save active WFS layers
                localStorage.setItem(STORAGE_KEYS.activeWfsLayers, JSON.stringify(Array.from(activeWfsLayers.keys())));

            } catch (error) {
                console.warn('WME Väylävirasto: Failed to save preferences:', error);
            }
        }, 500); // Debounce for 500ms
    }

    function loadPreferences() {
        try {
            // Check if user has used the script before
            const hasUsedBefore = localStorage.getItem(STORAGE_KEYS.initialized);

            // Load quick access layers
            const savedQuickAccess = localStorage.getItem(STORAGE_KEYS.quickAccess);
            if (savedQuickAccess) {
                const quickAccessArray = JSON.parse(savedQuickAccess);
                quickAccessLayers = new Set(quickAccessArray);
            } else if (!hasUsedBefore) {
                // First time user - add default quick-access layers

                DEFAULT_QUICK_ACCESS_LAYERS.forEach(layerName => {
                    // Only add if layer exists in available layers
                    if (availableLayers.some(l => l.name === layerName)) {
                        quickAccessLayers.add(layerName);
                    } else {
                        console.warn(`  ✗ Default layer not found: ${layerName}`);
                    }
                });

                // Mark as initialized and save
                localStorage.setItem(STORAGE_KEYS.initialized, 'true');
                savePreferences();

            }
            // If hasUsedBefore is true but no saved quick access, user intentionally cleared them - don't re-add

            // Load layer opacities
            const savedOpacities = localStorage.getItem(STORAGE_KEYS.layerOpacity);
            if (savedOpacities) {
                const opacities = JSON.parse(savedOpacities);
                availableLayers.forEach(layer => {
                    if (opacities[layer.name]) {
                        layer.opacity = opacities[layer.name];
                    }
                });
            }

            // Load and restore active layers
            const savedActiveLayers = localStorage.getItem(STORAGE_KEYS.activeLayers);
            if (savedActiveLayers) {
                const activeLayerNames = JSON.parse(savedActiveLayers);

                // Restore layers after a short delay to ensure map is ready
                setTimeout(() => {
                    activeLayerNames.forEach(layerName => {
                        const layerConfig = availableLayers.find(l => l.name === layerName);
                        if (layerConfig) {
                            toggleLayer(layerConfig, true);
                        }
                    });
                }, 1000);
            }

            // Load and restore active WFS layers
            const savedActiveWfsLayers = localStorage.getItem(STORAGE_KEYS.activeWfsLayers);
            if (savedActiveWfsLayers) {
                const activeWfsLayerNames = JSON.parse(savedActiveWfsLayers);

                // Restore WFS layers after WMS layers (same 1s delay)
                setTimeout(() => {
                    activeWfsLayerNames.forEach(layerName => {
                        const layerConfig = availableLayers.find(l => l.name === layerName);
                        if (layerConfig) {
                            toggleWfsLayer(layerConfig, true);
                        }
                    });
                }, 1000);
            }

        } catch (error) {
            console.warn('WME Väylävirasto: Failed to load preferences:', error);
        }
    }

    function loadButtonPosition() {
        try {
            const savedPosition = localStorage.getItem(STORAGE_KEYS.buttonPosition);
            if (savedPosition && floatingButton) {
                const position = JSON.parse(savedPosition);
                if (position.top && position.left) {
                    floatingButton.style.top = position.top;
                    floatingButton.style.left = position.left;
                } else {
                    // Use default positions if saved values are invalid
                    floatingButton.style.top = '64px';
                    floatingButton.style.left = '415px';
                }
            }
        } catch (error) {
            console.warn('WME Väylävirasto: Failed to load button position:', error);
        }
    }

    function loadWfsModePreference() {
        try {
            const savedWfsMode = localStorage.getItem('wme-vaylavirasto-wfs-mode');
            if (savedWfsMode !== null) {
                wfsTooltipMode = JSON.parse(savedWfsMode);
            }
        } catch (error) {
            console.warn('WME Väylävirasto: Failed to load WFS mode preference:', error);
        }
    }

    async function fetchWMSCapabilities() {
        try {
            const capabilitiesUrl = `${WMS_CONFIG.baseUrl}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=${WMS_CONFIG.version}`;

            // Use GM_xmlhttpRequest if available, otherwise fetch
            if (typeof GM_xmlhttpRequest !== 'undefined') {
                return new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: capabilitiesUrl,
                        onload: function (response) {
                            try {
                                parseCapabilities(response.responseText);
                                resolve();
                            } catch (error) {
                                reject(error);
                            }
                        },
                        onerror: reject
                    });
                });
            } else {
                const response = await fetch(capabilitiesUrl, {
                    mode: 'cors',
                    credentials: 'omit'
                });
                const xmlText = await response.text();
                parseCapabilities(xmlText);
            }

        } catch (error) {
            console.error('WME Väylävirasto: Failed to fetch capabilities:', error);
            // Fallback to hardcoded layers if fetch fails
            availableLayers = getDefaultLayers();
            loadPreferences();
            initializeUI();
            throw error; // Re-throw to ensure Promise rejection propagates
        }
    }

    function parseCapabilities(xmlText) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

        // Parse layers from capabilities - Use original working querySelector
        const layers = xmlDoc.querySelectorAll('Layer[queryable="1"]');

        availableLayers = Array.from(layers).map(layer => {
            const name = layer.querySelector('Name')?.textContent;
            const title = layer.querySelector('Title')?.textContent;
            const abstract = layer.querySelector('Abstract')?.textContent;

            if (name && title) {
                return {
                    name: name,
                    title: title,
                    abstract: abstract || '',
                    visible: false,
                    opacity: 0.8
                };
            }
            return null;
        }).filter(Boolean);

        // Load saved preferences
        loadPreferences();

        // Initialize UI after layers are loaded
        initializeUI();
    }

    function getDefaultLayers() {
        return [
            {
                name: 'tiestotiedot:liikennemaarat_2023',
                title: 'Liikennemäärät 2023',
                abstract: 'Liikennemäärätiedot vuodelta 2023',
                visible: false,
                opacity: 0.7
            },
            {
                name: 'digiroad:dr_nopeusrajoitus',
                title: 'Nopeusrajoitukset',
                abstract: 'Teiden nopeusrajoitukset',
                visible: false,
                opacity: 0.8
            },
            {
                name: 'digiroad:dr_liikennemerkit',
                title: 'Liikennemerkit',
                abstract: 'Liikennemerkkien sijainnit',
                visible: false,
                opacity: 0.9
            }
        ];
    }

    function getProvider(layerName) {
        const parts = layerName.split(':');
        return parts.length > 1 ? parts[0] : 'Other';
    }

    function getUniqueProviders() {
        const providers = new Set();
        availableLayers.forEach(layer => {
            const provider = getProvider(layer.name);
            providers.add(provider);
        });
        return Array.from(providers).sort();
    }

    function populateProviderFilter() {
        if (!sidebarPanel || !sidebarPanel.providerFilter) {
            return;
        }

        const providerFilter = sidebarPanel.providerFilter;

        while (providerFilter.options.length > 1) {
            providerFilter.remove(1);
        }

        const providers = getUniqueProviders();
        providers.forEach(provider => {
            const option = createElem('option', {
                value: provider,
                textContent: provider.charAt(0).toUpperCase() + provider.slice(1)
            });
            providerFilter.appendChild(option);
        });
    }

    /**
     * Create the visual tooltip DOM element (v2.3.2)
     * Creates a floating tooltip with WME-themed styling
     * Element is appended to document.body to avoid clipping
     */
    function createTooltipElement() {
        if (tooltipElement !== null) {
            return; // Already created
        }

        try {
            tooltipElement = document.createElement('div');
            tooltipElement.id = 'wme-vaylavirasto-tooltip';

            // Apply WME-themed styling per CONTEXT.md decisions
            tooltipElement.style.cssText = `
                background: rgba(26, 26, 26, 0.9);
                color: #ffffff;
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 4px;
                padding: 8px 12px;
                max-width: 200px;
                position: absolute;
                z-index: 1000;
                pointer-events: none;
                font-family: system-ui, -apple-system, sans-serif;
                font-size: 13px;
                line-height: 1.4;
                opacity: 0;
                transition: opacity 150ms ease-out;
                display: none;
            `;

            // Try to append to map container if available, otherwise body
            // Appending to map container simplifies positioning since getPixelFromLonLat()
            // returns coordinates relative to the map container
            if (typeof W !== 'undefined' && W.map && W.map.getOLMap) {
                const olMap = W.map.getOLMap();
                olMap.div.appendChild(tooltipElement);
            } else {
                // Fallback to body if map not ready yet
                document.body.appendChild(tooltipElement);
            }
        } catch (error) {
            console.error('WME Väylävirasto: Failed to create tooltip element:', error);
        }
    }

    function initializeUI() {
        // No need to check W.userscripts.state.isReady
        createSidebarPanel();
        createFloatingButton();

        // Create tooltip element
        createTooltipElement();
    }

    async function createSidebarPanel() {
        if (!wmeSDK) {
            console.error('WME Väylävirasto: SDK not initialized');
            return;
        }

        let tabLabel, tabPane;

        try {
            const result = await wmeSDK.Sidebar.registerScriptTab();
            tabLabel = result.tabLabel;
            tabPane = result.tabPane;

            if (!tabLabel || !tabPane) {
                console.error('WME Väylävirasto: tabLabel or tabPane is undefined!');
                return;
            }

            tabLabel.textContent = '🇫🇮';
            tabLabel.title = 'Väylävirasto WMS + WFS Layers';
        } catch (error) {
            console.error('WME Väylävirasto: Failed to register sidebar tab:', error);
            return;
        }

        const divRoot = createElem('div', { style: 'padding: 8px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 12px;' });

        // Header
        const header = createElem('h4', {
            style: 'font-weight: bold; margin: 0 0 8px 0; color: #0052A5; font-size: 14px;',
            textContent: 'Väylävirasto WMS + WFS'
        });
        divRoot.appendChild(header);

        const version = createElem('div', {
            style: 'margin: 0 0 8px 0; font-size: 10px; color: #999;',
            textContent: 'Version 2.3.2'
        });
        divRoot.appendChild(version);

        // Search box
        const searchContainer = createElem('div', { style: 'margin-bottom: 8px;' });
        const searchInput = createElem('input', {
            type: 'text',
            placeholder: 'Hae tasoja...',
            style: 'width: 100%; padding: 4px 6px; border: 1px solid #ddd; border-radius: 3px; font-size: 11px;'
        });
        searchContainer.appendChild(searchInput);
        divRoot.appendChild(searchContainer);

        // Provider filter dropdown
        const filterContainer = createElem('div', { style: 'margin-bottom: 8px;' });
        const filterLabel = createElem('label', {
            style: 'font-size: 10px; color: #666; margin-right: 4px;',
            textContent: 'Tarjoaja:'
        });
        const providerFilter = createElem('select', {
            style: 'width: 100%; padding: 4px 6px; border: 1px solid #ddd; border-radius: 3px; font-size: 11px; background: white;'
        });

        // Add "All providers" option
        const allOption = createElem('option', {
            value: '',
            textContent: 'Kaikki tarjoajat'
        });
        providerFilter.appendChild(allOption);

        // Provider options will be added after layers are loaded

        // Handle filter change
        providerFilter.addEventListener('change', (e) => {
            selectedProvider = e.target.value || null;
            renderLayerList(sidebarPanel.searchInput.value);
        });

        filterContainer.appendChild(filterLabel);
        filterContainer.appendChild(providerFilter);
        divRoot.appendChild(filterContainer);

        // Store providerFilter in sidebarPanel for later refresh

        // Active layers section header row (with WFS mode toggle)
        const activeLayersHeaderRow = createElem('div', {
            style: 'display: flex; justify-content: space-between; align-items: center; margin: 8px 0 4px 0;'
        });

        const activeLayersHeader = createElem('h5', {
            style: 'margin: 0; color: #d32f2f; font-size: 12px;',
            textContent: 'Aktiiviset tasot'
        });
        activeLayersHeaderRow.appendChild(activeLayersHeader);

        // Compact WFS/Tooltip mode toggle button
        const wfsModeToggle = createElem('button', {
            id: 'wfs-mode-toggle',
            style: 'padding: 2px 8px; background: #ccc; color: #333; border: 1px solid #999; border-radius: 3px; font-size: 10px; font-weight: bold; cursor: pointer; white-space: nowrap;',
            textContent: 'WFS: Ei käytössä'
        });
        wfsModeToggle.onclick = () => {
            wfsTooltipMode = !wfsTooltipMode;
            updateWfsModeButton();

            if (!wfsTooltipMode) {
                hideRoadNameTooltip();
            }

            savePreferences();
        };
        activeLayersHeaderRow.appendChild(wfsModeToggle);
        divRoot.appendChild(activeLayersHeaderRow);

        // Initialize WFS mode button state
        updateWfsModeButton();

        // Layer count info
        const layerInfo = createElem('div', {
            style: 'margin-bottom: 6px; font-size: 10px; color: #666;',
            textContent: `${availableLayers.length} tasoa saatavilla`
        });
        divRoot.appendChild(layerInfo);

        // Active layers info (header is in the header row above)
        const activeLayersInfo = createElem('div', {
            style: 'font-size: 10px; color: #666; margin-bottom: 6px;',
            textContent: 'Tällä hetkellä näkyvissä olevat tasot:'
        });
        divRoot.appendChild(activeLayersInfo);

        const activeLayersList = createElem('div', {
            style: 'max-height: 120px; overflow-y: auto; border: 1px solid #d32f2f; border-radius: 3px; padding: 3px; margin-bottom: 8px; background: #fff5f5;'
        });
        divRoot.appendChild(activeLayersList);

        // Layer list container
        const layerList = createElem('div', {
            style: 'max-height: 300px; overflow-y: auto; border: 1px solid #ddd; border-radius: 3px; margin-bottom: 8px;'
        });
        divRoot.appendChild(layerList);

        // Quick access section
        const quickAccessHeader = createElem('h5', {
            style: 'margin: 8px 0 4px 0; color: #0052A5; font-size: 12px;',
            textContent: 'Pika-aktivointi'
        });
        divRoot.appendChild(quickAccessHeader);

        const quickAccessInfo = createElem('div', {
            style: 'font-size: 10px; color: #666; margin-bottom: 6px;',
            textContent: 'Valitse tasot kelluvaan painikkeeseen:'
        });
        divRoot.appendChild(quickAccessInfo);

        // Calculate dynamic height for quick access section
        const headerHeight = 250; // Approximate height of header elements
        const minAvailableHeight = 200;
        const availableHeight = Math.max(minAvailableHeight, window.innerHeight - headerHeight);
        const quickAccessList = createElem('div', {
            style: `max-height: ${availableHeight}px; overflow-y: auto; border: 1px solid #ddd; border-radius: 3px; padding: 3px;`
        });
        divRoot.appendChild(quickAccessList);

        try {
            tabPane.appendChild(divRoot);
        } catch (appendError) {
            console.error('WME Väylävirasto: FAILED to append divRoot to tabPane:', appendError);
            return;
        }

        tabPane.id = 'sidepanel-vaylavirasto';

        // The Promise from registerScriptTab() resolves only after elements are in DOM

        sidebarPanel = {
            searchInput,
            providerFilter,
            layerList,
            quickAccessList,
            activeLayersList,
            layerInfo,
            activeLayersInfo
        };

        // Setup event listeners
        setupSidebarEvents();
        renderLayerList();

        // Populate provider filter if layers are already loaded
        populateProviderFilter();
    }

    function setupSidebarEvents() {
        // Search functionality
        sidebarPanel.searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            renderLayerList(searchTerm);
        });
    }

    function renderLayerList(searchTerm = '') {
        if (!sidebarPanel) {
            return;
        }

        // Apply both search and provider filters
        let filteredLayers = availableLayers.filter(layer => {
            // Search filter
            const matchesSearch = !searchTerm ||
                layer.title.toLowerCase().includes(searchTerm) ||
                layer.name.toLowerCase().includes(searchTerm) ||
                (layer.abstract || '').toLowerCase().includes(searchTerm);

            // Provider filter
            const matchesProvider = !selectedProvider ||
                getProvider(layer.name) === selectedProvider;

            return matchesSearch && matchesProvider;
        });

        // Update layer count info to show active filters
        let countText = `${filteredLayers.length} tasoa`;
        if (searchTerm || selectedProvider) {
            countText += ` / ${availableLayers.length} tasoa`;
        }
        sidebarPanel.layerInfo.textContent = countText;

        // Clear existing content
        sidebarPanel.layerList.innerHTML = '';
        sidebarPanel.quickAccessList.innerHTML = '';
        sidebarPanel.activeLayersList.innerHTML = '';

        // Render active layers section (always visible, regardless of search)
        const activeLayersArray = availableLayers.filter(layer => activeLayers.has(layer.name));

        if (activeLayersArray.length === 0) {
            const emptyMsg = createElem('div', {
                style: 'color: #999; font-size: 10px; text-align: center; padding: 8px; font-style: italic;',
                textContent: 'Ei aktiivisia tasoja'
            });
            sidebarPanel.activeLayersList.appendChild(emptyMsg);
        } else {
            activeLayersArray.forEach((layer, index) => {
                const activeItem = createLayerItem(layer, index, false, true); // true for isActiveSection
                sidebarPanel.activeLayersList.appendChild(activeItem);
            });
        }

        // Update active layers info
        sidebarPanel.activeLayersInfo.textContent = activeLayersArray.length === 0 ?
            'Ei aktiivisia tasoja' :
            `${activeLayersArray.length} tasoa aktiivinen${activeLayersArray.length !== 1 ? 'a' : ''}`;

        // Render main layer list
        filteredLayers.forEach((layer, index) => {
            const layerItem = createLayerItem(layer, index, false, false);
            sidebarPanel.layerList.appendChild(layerItem);
        });

        // Render quick access list (only layers that are in quick access)
        availableLayers.filter(layer => quickAccessLayers.has(layer.name)).forEach((layer, index) => {
            const quickItem = createLayerItem(layer, index, true, false);
            sidebarPanel.quickAccessList.appendChild(quickItem);
        });

        updateFloatingButton(document.getElementById('vayla-floating-panel'));
    }

    function openLegendWindow(layerConfig) {
        if (!layerConfig || !layerConfig.name) {
            console.warn('Invalid layer config for legend window');
            return;
        }

        const legendUrl = `${WMS_CONFIG.baseUrl}?service=WMS&version=${WMS_CONFIG.version}&request=GetLegendGraphic&format=image/png&layer=${layerConfig.name}`;

        // Check if window already exists for this layer
        const windowId = 'legend-' + layerConfig.name.replace(/[^a-zA-Z0-9]/g, '-');
        const existingWindow = document.getElementById(windowId);

        if (existingWindow) {
            // Bring existing window to front
            existingWindow.style.zIndex = '10001';
            return;
        }

        // Create floatable legend window
        const legendWindow = createElem('div', {
            id: windowId,
            style: `
                position: fixed;
                top: 200px;
                left: 500px;
                background: white;
                border: 2px solid #0052A5;
                border-radius: 8px;
                z-index: 10001;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                min-width: 200px;
                max-width: 400px;
            `
        });

        // Create header with title and close button
        const header = createElem('div', {
            style: `
                background: #0052A5;
                color: white;
                padding: 8px 12px;
                border-radius: 6px 6px 0 0;
                display: flex;
                justify-content: space-between;
                align-items: center;
                cursor: move;
                user-select: none;
            `
        });

        const title = createElem('span', {
            textContent: 'Selite: ' + layerConfig.title,
            style: 'font-size: 14px; font-weight: bold;'
        });

        const closeBtn = createElem('button', {
            innerHTML: '✕',
            style: `
                background: none;
                border: none;
                color: white;
                font-size: 16px;
                cursor: pointer;
                padding: 0;
                width: 20px;
                height: 20px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
            `
        });

        closeBtn.addEventListener('mouseenter', function () {
            this.style.background = 'rgba(255,255,255,0.2)';
        });

        closeBtn.addEventListener('mouseleave', function () {
            this.style.background = 'none';
        });

        let mouseMoveHandler = null;
        let mouseUpHandler = null;

        closeBtn.addEventListener('click', function () {
            // Remove drag event listeners to prevent memory leaks
            if (mouseMoveHandler) {
                document.removeEventListener('mousemove', mouseMoveHandler);
            }
            if (mouseUpHandler) {
                document.removeEventListener('mouseup', mouseUpHandler);
            }
            legendWindow.remove();
        });

        header.appendChild(title);
        header.appendChild(closeBtn);

        // Create content area
        const content = createElem('div', {
            style: 'padding: 12px; text-align: center;'
        });

        const loadingText = createElem('div', {
            textContent: 'Ladataan selitettä...',
            style: 'color: #666; font-size: 13px;'
        });
        content.appendChild(loadingText);

        // Create image element
        const legendImg = createElem('img', {
            src: legendUrl,
            style: 'max-width: 100%; height: auto; display: none;'
        });

        legendImg.addEventListener('load', function () {
            loadingText.style.display = 'none';
            this.style.display = 'block';
        });

        legendImg.addEventListener('error', function () {
            loadingText.textContent = 'Selitettä ei voitu ladata';
            loadingText.style.color = '#d32f2f';
            console.warn('Failed to load legend for ' + layerConfig.title + ':', legendUrl);
        });

        content.appendChild(legendImg);
        legendWindow.appendChild(header);
        legendWindow.appendChild(content);

        // Make window draggable
        let isDragging = false;
        let dragOffset = { x: 0, y: 0 };

        header.addEventListener('mousedown', function (e) {
            isDragging = true;
            dragOffset.x = e.clientX - legendWindow.offsetLeft;
            dragOffset.y = e.clientY - legendWindow.offsetTop;
            legendWindow.style.zIndex = '10001';
        });

        mouseMoveHandler = function (e) {
            if (isDragging) {
                legendWindow.style.left = (e.clientX - dragOffset.x) + 'px';
                legendWindow.style.top = (e.clientY - dragOffset.y) + 'px';
            }
        };

        document.addEventListener('mousemove', mouseMoveHandler);

        mouseUpHandler = function () {
            isDragging = false;
        };

        document.addEventListener('mouseup', mouseUpHandler);

        document.body.appendChild(legendWindow);
    }

    function createLayerItem(layer, index, isQuickAccess, isActiveSection = false) {
        // Check WMS or WFS active state depending on mode
        const isActive = wfsTooltipMode ? activeWfsLayers.has(layer.name) : activeLayers.has(layer.name);
        const backgroundColor = isActiveSection ?
            (index % 2 === 0 ? '#fff5f5' : '#ffebeb') :
            (isActive && !isQuickAccess ?
                (index % 2 === 0 ? '#f0fff0' : '#e8f5e8') :
                (index % 2 === 0 ? '#f9f9f9' : 'white'));

        const item = createElem('div', {
            'data-layer-name': layer.name,
            style: `padding: 4px 6px; border-bottom: 1px solid #eee; background: ${backgroundColor}; ${isActive && !isQuickAccess && !isActiveSection ? 'border-left: 3px solid #4caf50;' : ''}`
        });

        const header = createElem('div', {
            style: 'display: flex; align-items: center; margin-bottom: 2px; gap: 4px;'
        });

        // Layer visibility checkbox
        const visibilityCheckbox = createElem('input', {
            type: 'checkbox',
            style: 'margin-right: 6px; accent-color: #0052A5; width: 16px; height: 16px; flex-shrink: 0;'
        });
        visibilityCheckbox.checked = isActive;
        visibilityCheckbox.addEventListener('change', (e) => {
            const shouldActivate = e.target.checked;

            // Handle WFS mode toggle carefully
            // When turning OFF: check both WMS and WFS, deactivate whichever is active
            // When turning ON: use WFS if mode is ON and layer supports it
            if (!shouldActivate) {
                // Deactivating - check both modes
                const isWmsActive = activeLayers.has(layer.name);
                const isWfsActive = activeWfsLayers.has(layer.name);

                if (isWfsActive) {
                    toggleWfsLayer(layer, false);
                }
                if (isWmsActive) {
                    toggleLayer(layer, false);
                }

                // If neither was active, sync checkbox to actual state
                if (!isWmsActive && !isWfsActive) {
                    console.warn(`WME Väylävirasto: Layer ${layer.name} was not active`);
                }
            } else {
                // Activating - use WFS mode if enabled and layer supports it
                if (wfsTooltipMode && layer.supportsWFS) {
                    toggleWfsLayer(layer, true);
                } else {
                    toggleLayer(layer, true);
                }
            }
        });

        // Layer title with active indicator
        const titleContainer = createElem('span', {
            style: 'flex: 1; display: flex; align-items: center; gap: 4px;'
        });

        const title = createElem('span', {
            style: 'font-weight: bold; font-size: 11px;',
            textContent: layer.title
        });

        titleContainer.appendChild(title);

        // Add WFS badge for layers that support WFS
        if (layer.supportsWFS) {
            const wfsBadge = createElem('span', {
                style: 'background: #FF6600; color: white; font-size: 9px; padding: 1px 4px; border-radius: 2px; font-weight: bold;',
                textContent: 'WFS',
                title: 'Tuki vekorimuodolle (WFS) - käytettävissä Phase 4:n jälkeen'
            });
            titleContainer.appendChild(wfsBadge);
        }

        // Add active indicator in main list (not in active or quick access sections)
        if (!isQuickAccess && !isActiveSection && isActive) {
            const activeIndicator = createElem('span', {
                style: 'color: #4caf50; font-size: 10px; font-weight: bold;',
                textContent: '●',
                title: 'Taso on aktiivinen'
            });
            titleContainer.appendChild(activeIndicator);
        }

        // Legend button
        const legendBtn = createElem('button', {
            innerHTML: 'ℹ️',
            title: 'Näytä selite',
            style: `
                width: 16px;
                height: 16px;
                padding: 0;
                background: #f0f0f0;
                border: 1px solid #ccc;
                border-radius: 3px;
                cursor: pointer;
                font-size: 10px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s;
                flex-shrink: 0;
            `
        });

        legendBtn.addEventListener('mouseenter', function () {
            this.style.background = '#e0e0e0';
            this.style.transform = 'scale(1.1)';
        });

        legendBtn.addEventListener('mouseleave', function () {
            this.style.background = '#f0f0f0';
            this.style.transform = 'scale(1)';
        });

        legendBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            openLegendWindow(layer);
        });

        // Quick access toggle (in main list and quick access section, but not in active section)
        if (!isActiveSection) {
            const isQuickAccessItem = quickAccessLayers.has(layer.name);
            const quickToggle = createElem('button', {
                style: `
                    width: 16px;
                    height: 16px;
                    padding: 0;
                    font-size: 9px;
                    border: 1px solid #0052A5;
                    border-radius: 2px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                    ${isQuickAccessItem ? 'background: #0052A5; color: white;' : 'background: white; color: #0052A5;'}
                `,
                textContent: isQuickAccessItem ? '★' : '☆',
                title: isQuickAccessItem ? 'Poista pika-aktivoinnista' : 'Lisää pika-aktivointiin'
            });
            quickToggle.addEventListener('click', () => {
                toggleQuickAccess(layer);
            });
            header.appendChild(quickToggle);
        }

        // Show quick access status in active section
        if (isActiveSection && quickAccessLayers.has(layer.name)) {
            const quickAccessIndicator = createElem('span', {
                style: `
                    width: 16px;
                    height: 16px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 9px;
                    color: #0052A5;
                    flex-shrink: 0;
                `,
                textContent: '★',
                title: 'Taso on pika-aktivoinnissa'
            });
            header.appendChild(quickAccessIndicator);
        }

        header.appendChild(visibilityCheckbox);
        header.appendChild(titleContainer);
        header.appendChild(legendBtn);
        item.appendChild(header);

        // Layer details
        const details = createElem('div', {
            style: 'font-size: 9px; color: #666; margin-left: 20px;'
        });

        const layerName = createElem('div', {
            style: 'font-family: monospace; margin-bottom: 1px; font-size: 9px;',
            textContent: layer.name
        });
        details.appendChild(layerName);

        if (layer.abstract) {
            const abstract = createElem('div', {
                style: 'font-size: 9px;',
                textContent: (layer.abstract || '').substring(0, 80) + ((layer.abstract || '').length > 80 ? '...' : '')
            });
            details.appendChild(abstract);
        }

        item.appendChild(details);

        // Opacity slider (only if layer is active)
        if (activeLayers.has(layer.name)) {
            const opacityContainer = createElem('div', {
                style: 'margin: 4px 0 0 20px; display: flex; align-items: center;'
            });

            const opacityLabel = createElem('span', {
                style: 'font-size: 9px; margin-right: 4px;',
                textContent: 'Läpinäkyvyys:'
            });

            const opacitySlider = createElem('input', {
                type: 'range',
                min: '0.1',
                max: '1',
                step: '0.1',
                value: layer.opacity.toString(),
                style: 'flex: 1; margin-right: 4px; height: 12px;'
            });

            const opacityValue = createElem('span', {
                style: 'font-size: 9px; min-width: 25px;',
                textContent: Math.round(layer.opacity * 100) + '%'
            });

            let opacityTimeout;
            opacitySlider.addEventListener('input', (e) => {
                const opacity = parseFloat(e.target.value);
                layer.opacity = opacity;
                opacityValue.textContent = Math.round(opacity * 100) + '%';

                const wmsLayer = activeLayers.get(layer.name);
                if (wmsLayer) {
                    wmsLayer.setOpacity(opacity);
                }

                // Debounce save for opacity changes
                clearTimeout(opacityTimeout);
                opacityTimeout = setTimeout(() => savePreferences(), 1000);
            });

            opacityContainer.appendChild(opacityLabel);
            opacityContainer.appendChild(opacitySlider);
            opacityContainer.appendChild(opacityValue);
            item.appendChild(opacityContainer);
        }

        return item;
    }

    /**
     * Update WFS mode button appearance (v2.3.1)
     */
    function updateWfsModeButton() {
        const toggle = document.getElementById('wfs-mode-toggle');
        if (!toggle) return;

        if (wfsTooltipMode) {
            toggle.textContent = 'WFS: Käytössä';
            toggle.style.background = '#4caf50';
            toggle.style.color = 'white';
            toggle.style.borderColor = '#388e3c';
        } else {
            toggle.textContent = 'WFS: Ei käytössä';
            toggle.style.background = '#ccc';
            toggle.style.color = '#333';
        }
        updateFloatingPanelModeButton(); // Sync floating panel button
    }

    /**
     * Update floating panel mode toggle button appearance (v2.3.2)
     */
    function updateFloatingPanelModeButton() {
        const toggle = document.getElementById('floating-mode-toggle');
        if (!toggle) return;

        if (wfsTooltipMode) {
            toggle.textContent = '🔍 WFS-tila (vihjetekstit)';
            toggle.style.background = '#ff9800'; // Orange for WFS mode
        } else {
            toggle.textContent = '🗺️ WMS-tila (kartta)';
            toggle.style.background = '#0052A5'; // Blue for WMS mode
        }
    }

    function toggleLayer(layerConfig, visible) {
        if (visible && !activeLayers.has(layerConfig.name)) {
            // Add layer
            const wmsLayer = createWMSLayer(layerConfig);
            if (wmsLayer) {
                try {
                    W.map.getOLMap().addLayer(wmsLayer);
                    activeLayers.set(layerConfig.name, wmsLayer);
                    layerConfig.visible = true;
                } catch (error) {
                    console.error(`WME Väylävirasto: Failed to add layer ${layerConfig.title}:`, error);
                }
            }
        } else if (!visible && activeLayers.has(layerConfig.name)) {
            // Remove layer
            const wmsLayer = activeLayers.get(layerConfig.name);
            try {
                W.map.getOLMap().removeLayer(wmsLayer);
                activeLayers.delete(layerConfig.name);
                layerConfig.visible = false;
            } catch (error) {
                console.error(`WME Väylävirasto: Failed to remove layer ${layerConfig.title}:`, error);
            }
        }

        savePreferences(); // Save when layer visibility changes
        if (sidebarPanel) {
            renderLayerList(sidebarPanel.searchInput.value);
        }
        const floatingPanel = document.getElementById('vayla-floating-panel');
        if (floatingPanel) {
            updateFloatingButton(floatingPanel);
        }
    }

    function createWMSLayer(layerConfig) {
        try {
            const wmsLayer = new OpenLayers.Layer.WMS(
                `Väylävirasto: ${layerConfig.title}`,
                WMS_CONFIG.baseUrl,
                {
                    layers: layerConfig.name,
                    transparent: true,
                    format: 'image/png',
                    version: WMS_CONFIG.version,
                    crs: WMS_CONFIG.crs
                },
                {
                    isBaseLayer: false,
                    visibility: true,
                    opacity: layerConfig.opacity,
                    displayInLayerSwitcher: false,
                    transitionEffect: null,
                    tileOptions: {
                        crossOriginKeyword: null
                    },
                    singleTile: false,
                    ratio: 1,
                    buffer: 0,
                    numZoomLevels: 20
                }
            );

            // Add event listeners
            wmsLayer.events.register('tileerror', wmsLayer, function (evt) {
                // Silently ignore tile errors - network issues are common and transient
            });

            return wmsLayer;
        } catch (error) {
            console.error(`Failed to create layer ${layerConfig.title}:`, error);
            return null;
        }
    }

    function toggleQuickAccess(layer) {
        if (quickAccessLayers.has(layer.name)) {
            quickAccessLayers.delete(layer.name);
        } else {
            quickAccessLayers.add(layer.name);
        }
        savePreferences(); // Save when quick access changes
        renderLayerList(sidebarPanel.searchInput.value);
    }

    function createFloatingButton() {
        // Remove existing button and panel
        if (floatingButton) {
            floatingButton.remove();
        }
        const existingPanel = document.getElementById('vayla-floating-panel');
        if (existingPanel) {
            existingPanel.remove();
        }

        // Create toggle button
        floatingButton = createElem('button', {
            id: 'vayla-toggle-btn',
            style: `
                position: fixed;
                top: 64px;
                left: 415px;
                z-index: 10000;
                width: 40px;
                height: 40px;
                padding: 0;
                background: #0052A5;
                color: white;
                border: 2px solid #333;
                border-radius: 6px;
                cursor: grab;
                font-size: 22px;
                box-shadow: 0 3px 8px rgba(0,0,0,0.4);
                transition: all 0.2s;
                display: flex;
                align-items: center;
                justify-content: center;
            `,
            innerHTML: '🇫🇮',
            title: 'Näytä/piilota Väylävirasto pika-aktivointi'
        });

        // Create floating panel
        const floatingPanel = createElem('div', {
            id: 'vayla-floating-panel',
            style: `
                position: fixed;
                top: 125px;
                left: 10px;
                background: white;
                border: 2px solid #0052A5;
                border-radius: 8px;
                padding: 10px;
                z-index: 10000;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                max-width: 250px;
                display: none;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 12px;
            `
        });

        updateFloatingButton(floatingPanel);
        setupFloatingButtonEvents(floatingPanel);

        document.body.appendChild(floatingButton);
        document.body.appendChild(floatingPanel);

        // Load saved button position
        loadButtonPosition();
    }

    function updateFloatingButton(floatingPanel) {
        if (!floatingButton || !floatingPanel) return;

        const quickLayers = availableLayers.filter(layer => quickAccessLayers.has(layer.name));

        // Always keep button as simple flag icon
        floatingButton.innerHTML = '🇫🇮';

        // Update panel content
        floatingPanel.innerHTML = '';

        if (quickLayers.length === 0) {
            const emptyMsg = createElem('div', {
                style: 'color: #666; font-size: 11px; text-align: center; padding: 10px;',
                textContent: 'Ei pika-aktivointi tasoja. Valitse tasoja sivupaneelista.'
            });
            floatingPanel.appendChild(emptyMsg);
            return;
        }

        // Panel header
        const header = createElem('div', {
            style: 'font-weight: bold; margin-bottom: 8px; font-size: 13px; color: #0052A5; border-bottom: 1px solid #0052A5; padding-bottom: 4px;',
            innerHTML: '<strong>Väylävirasto Tasot</strong>'
        });
        floatingPanel.appendChild(header);

        // Mode toggle button (v2.3.2)
        const modeToggleBtn = createElem('button', {
            id: 'floating-mode-toggle',
            style: 'width: 100%; padding: 8px; margin-bottom: 10px; background: #0052A5; color: white; border: none; border-radius: 4px; font-size: 12px; font-weight: bold; cursor: pointer; transition: background 0.2s;',
            textContent: wfsTooltipMode ? '🔍 WFS-tila (vihjetekstit)' : '🗺️ WMS-tila (kartta)'
        });
        modeToggleBtn.onclick = () => {
            wfsTooltipMode = !wfsTooltipMode;
            updateFloatingPanelModeButton();
            updateWfsModeButton(); // Sync sidebar button too
            if (!wfsTooltipMode) {
                hideRoadNameTooltip();
            }
            savePreferences();
            // Refresh layer checkboxes to show correct active state
            updateFloatingButton(floatingPanel);
        };
        floatingPanel.appendChild(modeToggleBtn);

        // Add quick access layers
        quickLayers.forEach((layer, index) => {
            const toggle = createElem('div', {
                'data-layer-name': layer.name,
                'class': 'quick-access-item',
                style: `display: flex; align-items: center; margin-bottom: 6px; padding: 4px; border-radius: 3px; transition: background-color 0.2s; background-color: ${index % 2 === 0 ? '#f9f9f9' : 'white'}; gap: 4px;`
            });

            toggle.addEventListener('mouseenter', function () {
                this.style.backgroundColor = '#e3f2fd';
            });

            toggle.addEventListener('mouseleave', function () {
                this.style.backgroundColor = index % 2 === 0 ? '#f9f9f9' : 'white';
            });

            const checkbox = createElem('input', {
                type: 'checkbox',
                style: 'margin-right: 6px; accent-color: #0052A5; width: 16px; height: 16px; flex-shrink: 0;'
            });
            // Check WMS or WFS active state depending on mode
            const isActive = wfsTooltipMode ? activeWfsLayers.has(layer.name) : activeLayers.has(layer.name);
            checkbox.checked = isActive;
            checkbox.addEventListener('change', (e) => {
                const shouldActivate = e.target.checked;

                // Handle WFS mode toggle carefully
                // When turning OFF: check both WMS and WFS, deactivate whichever is active
                // When turning ON: use WFS if mode is ON and layer supports it
                if (!shouldActivate) {
                    // Deactivating - check both modes
                    const isWmsActive = activeLayers.has(layer.name);
                    const isWfsActive = activeWfsLayers.has(layer.name);

                    if (isWfsActive) {
                        toggleWfsLayer(layer, false);
                    }
                    if (isWmsActive) {
                        toggleLayer(layer, false);
                    }
                } else {
                    // Activating - use WFS mode if enabled and layer supports it
                    if (wfsTooltipMode && layer.supportsWFS) {
                        toggleWfsLayer(layer, true);
                    } else {
                        toggleLayer(layer, true);
                    }
                }
            });

            const label = createElem('span', {
                textContent: layer.title,
                style: 'user-select: none; font-size: 11px; color: #333; flex: 1; cursor: pointer;'
            });

            // Make label clickable for checkbox
            label.addEventListener('click', () => {
                const newState = !checkbox.checked;
                checkbox.checked = newState;

                // Handle WFS mode toggle carefully
                // When turning OFF: check both WMS and WFS, deactivate whichever is active
                // When turning ON: use WFS if mode is ON and layer supports it
                if (!newState) {
                    // Deactivating - check both modes
                    const isWmsActive = activeLayers.has(layer.name);
                    const isWfsActive = activeWfsLayers.has(layer.name);

                    if (isWfsActive) {
                        toggleWfsLayer(layer, false);
                    }
                    if (isWmsActive) {
                        toggleLayer(layer, false);
                    }
                } else {
                    // Activating - use WFS mode if enabled and layer supports it
                    if (wfsTooltipMode && layer.supportsWFS) {
                        toggleWfsLayer(layer, true);
                    } else {
                        toggleLayer(layer, true);
                    }
                }
            });

            // Legend button for floating panel
            const legendBtn = createElem('button', {
                innerHTML: 'ℹ️',
                title: 'Näytä selite',
                style: `
                    width: 16px;
                    height: 16px;
                    padding: 0;
                    background: #f0f0f0;
                    border: 1px solid #ccc;
                    border-radius: 3px;
                    cursor: pointer;
                    font-size: 10px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s;
                    flex-shrink: 0;
                `
            });

            legendBtn.addEventListener('mouseenter', function () {
                this.style.background = '#e0e0e0';
                this.style.transform = 'scale(1.1)';
            });

            legendBtn.addEventListener('mouseleave', function () {
                this.style.background = '#f0f0f0';
                this.style.transform = 'scale(1)';
            });

            legendBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                openLegendWindow(layer);
            });

            toggle.appendChild(checkbox);
            toggle.appendChild(label);
            toggle.appendChild(legendBtn);
            floatingPanel.appendChild(toggle);
        });

        // Info section
        const infoDiv = createElem('div', {
            style: 'margin-top: 8px; padding-top: 8px; border-top: 1px solid #ddd; font-size: 9px; color: #666;',
            innerHTML: '<strong>Lähde:</strong> Väylävirasto Avoin API'
        });
        floatingPanel.appendChild(infoDiv);
    }

    function setupFloatingButtonEvents(floatingPanel) {
        let isDragging = false;
        let mouseMoveHandler = null;
        let mouseUpHandler = null;

        floatingButton.addEventListener('mouseenter', function () {
            if (!isDragging) {
                this.style.transform = 'scale(1.1)';
                this.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
            }
        });

        floatingButton.addEventListener('mouseleave', function () {
            if (!isDragging) {
                this.style.transform = 'scale(1)';
                this.style.boxShadow = '0 3px 8px rgba(0,0,0,0.4)';
            }
        });

        // Toggle panel visibility
        floatingButton.addEventListener('click', function () {
            if (isDragging) return;

            if (floatingPanel.style.display === 'none' || floatingPanel.style.display === '') {
                // Position panel relative to button
                const buttonTop = parseInt(floatingButton.style.top) || 64;
                floatingPanel.style.left = floatingButton.style.left;
                floatingPanel.style.top = (buttonTop + 45) + 'px';
                floatingPanel.style.display = 'block';
                this.style.borderColor = '#0052A5';
                this.style.borderWidth = '3px';
            } else {
                floatingPanel.style.display = 'none';
                this.style.borderColor = '#333';
                this.style.borderWidth = '2px';
            }
        });

        // Drag functionality
        floatingButton.addEventListener('mousedown', function (e) {
            e.preventDefault();
            isDragging = false;

            const shiftX = e.clientX - floatingButton.getBoundingClientRect().left;
            const shiftY = e.clientY - floatingButton.getBoundingClientRect().top;

            function moveAt(pageX, pageY) {
                isDragging = true;
                floatingButton.style.left = (pageX - shiftX) + 'px';
                floatingButton.style.top = (pageY - shiftY) + 'px';
                // Panel follows if visible
                if (floatingPanel.style.display === 'block') {
                    floatingPanel.style.left = floatingButton.style.left;
                    const buttonTop = parseInt(floatingButton.style.top) || 64;
                    floatingPanel.style.top = (buttonTop + 45) + 'px';
                }
            }

            mouseMoveHandler = function (e) {
                moveAt(e.pageX, e.pageY);
            };

            mouseUpHandler = function () {
                document.removeEventListener('mousemove', mouseMoveHandler);
                document.removeEventListener('mouseup', mouseUpHandler);
                mouseMoveHandler = null;
                mouseUpHandler = null;

                // Save button position after dragging
                if (isDragging) {
                    savePreferences();
                    setTimeout(() => isDragging = false, 100);
                }
            };

            document.addEventListener('mousemove', mouseMoveHandler);
            document.addEventListener('mouseup', mouseUpHandler);
        });

        floatingButton.addEventListener('dragstart', () => false);
    }

    
    // Coordinate Transformation Utilities    

    // Define Finnish EPSG:3067 projection (ETRS-TM35FIN)
    if (typeof proj4 !== 'undefined') {
        proj4.defs('EPSG:3067', '+proj=utm +zone=35 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
    }

    /**
     * Get WFS BBOX from WME viewport
     * Returns BBOX string in EPSG:3067 for WFS requests
     *
     * @returns {string} BBOX parameter string for WFS
     */
    function getWfsBbox() {
        try {
            const extent = W.map.getOLMap().getExtent();
            // extent is OpenLayers.Bounds object with left, bottom, right, top in EPSG:3857

            // Transform to EPSG:3067
            const min3067 = proj4('EPSG:3857', 'EPSG:3067', [extent.left, extent.bottom]);
            const max3067 = proj4('EPSG:3857', 'EPSG:3067', [extent.right, extent.top]);

            // Return bbox string for WFS: minX,minY,maxX,maxY,urn:ogc:def:crs:EPSG::3067
            return `${min3067[0]},${min3067[1]},${max3067[0]},${max3067[1]},urn:ogc:def:crs:EPSG::3067`;
        } catch (error) {
            console.error('WME Väylävirasto: Failed to get WFS BBOX:', error);
            return null;
        }
    }

    /**
     * Build WFS GetFeature URL
     *
     * @param {string} layerName - WFS layer name (e.g., 'digiroad:dr_nopeusrajoitus')
     * @param {string} bbox - BBOX string from getWfsBbox()
     * @param {number} count - Maximum features to return
     * @returns {string} Full WFS GetFeature URL
     */
    function buildWfsUrl(layerName, bbox, count) {
        const params = new URLSearchParams({
            service: 'WFS',
            version: WFS_CONFIG.version,
            request: 'GetFeature',
            typeNames: layerName,
            bbox: bbox,
            srsName: WFS_CONFIG.sourceCRS,  // Request coordinates in EPSG:3067
            outputFormat: WFS_CONFIG.outputFormat,
            count: count || WFS_CONFIG.defaultCount
        });
        return `${WFS_CONFIG.baseUrl}?${params.toString()}`;
    }

    /**
     * Fetch WFS GetCapabilities document from Väylävirasto API
     * Discovers available WFS feature types
     *
     * @returns {Promise<void>} Resolves when capabilities are fetched and parsed
     */
    async function fetchWFSCapabilities() {
        try {
            const capabilitiesUrl = `${WFS_CONFIG.baseUrl}?SERVICE=WFS&REQUEST=GetCapabilities&VERSION=${WFS_CONFIG.version}`;

            // Use GM_xmlhttpRequest if available, otherwise fetch
            if (typeof GM_xmlhttpRequest !== 'undefined') {
                return new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: capabilitiesUrl,
                        timeout: WFS_CONFIG.timeout,
                        onload: function (response) {
                            try {
                                if (response.status === 200) {
                                    parseWFSCapabilities(response.responseText);
                                    resolve();
                                } else {
                                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                                }
                            } catch (error) {
                                console.error('WME Väylävirasto: Failed to parse WFS capabilities:', error);
                                reject(error);
                            }
                        },
                        onerror: function () {
                            const error = new Error('Network error fetching WFS GetCapabilities');
                            console.error('WME Väylävirasto:', error.message);
                            reject(error);
                        },
                        ontimeout: function () {
                            const error = new Error('Timeout fetching WFS GetCapabilities');
                            console.error('WME Väylävirasto:', error.message);
                            reject(error);
                        }
                    });
                });
            } else {
                // Fallback to regular fetch if GM_xmlhttpRequest not available
                const response = await fetch(capabilitiesUrl, {
                    mode: 'cors',
                    credentials: 'omit'
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const xmlText = await response.text();
                parseWFSCapabilities(xmlText);
            }

        } catch (error) {
            console.error('WME Väylävirasto: Failed to fetch WFS capabilities:', error);
            // Fallback to hardcoded layers if fetch fails
            useFallbackWFSLayers();
        }
    }

    /**
     * Parse WFS GetCapabilities XML response
     * Extracts feature types and populates availableLayers array
     *
     * @param {string} xmlText - WFS GetCapabilities XML response
     */
    function parseWFSCapabilities(xmlText) {
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

            // WFS 2.0.0 uses FeatureTypeList/FeatureType structure
            // Try to find FeatureType elements
            const featureTypes = xmlDoc.querySelectorAll('FeatureType');

            if (featureTypes.length === 0) {
                console.warn('WME Väylävirasto: No FeatureType elements found in WFS GetCapabilities');
                useFallbackWFSLayers();
                return;
            }

            // Clear existing WFS layers and add new ones
            // Note: We merge with existing WMS layers
            const wfsLayers = [];

            featureTypes.forEach(ft => {
                // Extract feature type metadata
                const nameElem = ft.querySelector('Name');
                const titleElem = ft.querySelector('Title');
                const abstractElem = ft.querySelector('Abstract');
                const crsElem = ft.querySelector('DefaultCRS');

                if (!nameElem) {
                    return; // Skip if no name
                }

                const name = nameElem.textContent;
                const title = titleElem?.textContent || name;
                const abstract = abstractElem?.textContent || '';
                const crs = crsElem?.textContent || 'EPSG:3067';

                // Create layer config with WFS support
                const layerConfig = {
                    name: name,
                    title: title,
                    abstract: abstract,
                    crs: crs,
                    supportsWFS: true,
                    visible: false,
                    opacity: 0.8,
                    properties: [],          // Field schemas for attribute display
                    propertiesLoaded: false   // Track if properties have been loaded
                };

                wfsLayers.push(layerConfig);
            });

            // Merge WFS layers with existing availableLayers
            // For layers that exist in both, add WFS support
            let wfsOnlyCount = 0;
            let hybridCount = 0;
            const wfsOnlyLayers = [];

            wfsLayers.forEach(wfsLayer => {
                const existing = availableLayers.find(l => l.name === wfsLayer.name);
                if (existing) {
                    // Update existing layer with WFS support
                    existing.supportsWFS = true;
                    existing.crs = wfsLayer.crs;
                    if (!existing.properties) {
                        existing.properties = [];
                    }
                    if (typeof existing.propertiesLoaded === 'undefined') {
                        existing.propertiesLoaded = false;
                    }
                    hybridCount++;
                } else {
                    // Add new WFS-only layer
                    availableLayers.push(wfsLayer);
                    wfsOnlyCount++;
                    wfsOnlyLayers.push(wfsLayer.title || wfsLayer.name);
                }
            });

            // Re-render UI if already initialized
            if (sidebarPanel) {
                renderLayerList(sidebarPanel.searchInput.value);
                populateProviderFilter();
            }

            loadWfsModePreference();

        } catch (error) {
            console.error('WME Väylävirasto: Failed to parse WFS GetCapabilities:', error);
            useFallbackWFSLayers();
        }
    }

    /**
     * Use fallback WFS layers when GetCapabilities fails
     * Ensures script continues to function even if API is temporarily unavailable
     */
    function useFallbackWFSLayers() {

        // Clone fallback layers to avoid reference issues
        availableLayers = FALLBACK_WFS_LAYERS.map(layer => ({...layer}));

        // Load preferences and initialize UI
        loadPreferences();
        loadWfsModePreference();
        initializeUI();
    }

    /**
     * Infer feature properties from GeoJSON response
     * Used to populate layerConfig.properties for attribute display in Phase 4
     *
     * @param {Object} geoJson - GeoJSON FeatureCollection
     * @returns {Array} Array of property definitions {name, type, label}
     */
    function inferFeatureProperties(geoJson) {
        if (!geoJson || !geoJson.features || geoJson.features.length === 0) {
            return [];
        }

        // Get first feature as sample
        const sampleFeature = geoJson.features[0];
        if (!sampleFeature.properties) {
            return [];
        }

        // Infer types from values
        const properties = [];
        for (const [key, value] of Object.entries(sampleFeature.properties)) {
            let type = 'string';
            if (typeof value === 'number') {
                type = Number.isInteger(value) ? 'integer' : 'number';
            } else if (typeof value === 'boolean') {
                type = 'boolean';
            }

            properties.push({
                name: key,
                type: type,
                label: key // Will be translated to human-readable in Phase 4
            });
        }

        return properties;
    }

    /**
     * Transform GeoJSON coordinates from EPSG:3067 to EPSG:3857
     * Handles all geometry types: Point, LineString, Polygon, Multi*
     *
     * @param {Object} geoJson - GeoJSON FeatureCollection
     * @returns {Object} Transformed GeoJSON
     */
    function transformGeoJsonCoordinates(geoJson) {
        if (!geoJson || !geoJson.features) {
            return geoJson;
        }

        geoJson.features.forEach(feature => {
            if (feature.geometry && feature.geometry.coordinates) {
                feature.geometry.coordinates = transformCoordinatesRecursive(
                    feature.geometry.coordinates,
                    feature.geometry.type
                );
            }
        });

        return geoJson;
    }

    /**
     * Recursively transform coordinates based on geometry type
     *
     * @param {Array} coords - Coordinate array
     * @param {string} geometryType - GeoJSON geometry type
     * @returns {Array} Transformed coordinates
     */
    function transformCoordinatesRecursive(coords, geometryType) {
        if (typeof proj4 === 'undefined') {
            console.warn('WME Väylävirasto: proj4js not available, skipping coordinate transform');
            return coords;
        }

        // Handle Z-coordinate (elevation) if present
        const transformPoint = function(pt) {
            if (pt.length >= 2) {
                const transformed = proj4('EPSG:3067', 'EPSG:3857', [pt[0], pt[1]]);
                // Preserve Z-coordinate if present
                return pt.length >= 3 ? [transformed[0], transformed[1], pt[2]] : transformed;
            }
            return pt;
        };

        switch (geometryType) {
            case 'Point':
                return transformPoint(coords);

            case 'MultiPoint':
            case 'LineString':
                return coords.map(transformPoint);

            case 'MultiLineString':
            case 'Polygon':
                return coords.map(ring => ring.map(transformPoint));

            case 'MultiPolygon':
                return coords.map(polygon => polygon.map(ring => ring.map(transformPoint)));

            default:
                console.warn('WME Väylävirasto: Unknown geometry type:', geometryType);
                return coords;
        }
    }

    /**
     * Create geometry-specific StyleMap for WFS vector layers
     * Different colors for points (blue), lines (orange), polygons (green)
     * Polygons render as outline only (fillOpacity: 0) to keep base map visible
     *
     * @returns {OpenLayers.StyleMap} StyleMap with geometry-specific rules
     */
    function createGeometryStyleMap() {
        // Point style: Blue, medium size (5px radius)
        const pointStyle = {
            pointRadius: 5,
            fillColor: '#2196F3',
            fillOpacity: 0.8,
            strokeColor: '#1976D2',
            strokeWidth: 1
        };

        // Line style: Orange, medium thickness (2px)
        const lineStyle = {
            strokeColor: '#FF9800',
            strokeWidth: 2,
            strokeOpacity: 0.8
        };

        // Polygon style: Green, outline only (no fill)
        const polygonStyle = {
            strokeColor: '#4CAF50',
            strokeWidth: 2,
            strokeOpacity: 0.8,
            fillOpacity: 0  // Outline only - keeps WME base map visible
        };

        return new OpenLayers.StyleMap({
            'default': new OpenLayers.Style(
                // Default fallback style
                OpenLayers.Util.applyDefaults(
                    { strokeColor: '#FF6600', strokeWidth: 2 },
                    OpenLayers.Feature.Vector.style['default']
                ),
                {
                    rules: [
                        // Point geometries
                        new OpenLayers.Rule({
                            filter: new OpenLayers.Filter.Comparison({
                                type: OpenLayers.Filter.Comparison.EQUAL_TO,
                                property: 'geometryType',
                                value: 'OpenLayers.Geometry.Point'
                            }),
                            symbolizer: OpenLayers.Util.applyDefaults(
                                pointStyle,
                                OpenLayers.Feature.Vector.style['default']
                            )
                        }),
                        // MultiPoint geometries (same style as Point)
                        new OpenLayers.Rule({
                            filter: new OpenLayers.Filter.Comparison({
                                type: OpenLayers.Filter.Comparison.EQUAL_TO,
                                property: 'geometryType',
                                value: 'OpenLayers.Geometry.MultiPoint'
                            }),
                            symbolizer: OpenLayers.Util.applyDefaults(
                                pointStyle,
                                OpenLayers.Feature.Vector.style['default']
                            )
                        }),
                        // LineString geometries
                        new OpenLayers.Rule({
                            filter: new OpenLayers.Filter.Comparison({
                                type: OpenLayers.Filter.Comparison.EQUAL_TO,
                                property: 'geometryType',
                                value: 'OpenLayers.Geometry.LineString'
                            }),
                            symbolizer: OpenLayers.Util.applyDefaults(
                                lineStyle,
                                OpenLayers.Feature.Vector.style['default']
                            )
                        }),
                        // MultiLineString geometries (same style as LineString)
                        new OpenLayers.Rule({
                            filter: new OpenLayers.Filter.Comparison({
                                type: OpenLayers.Filter.Comparison.EQUAL_TO,
                                property: 'geometryType',
                                value: 'OpenLayers.Geometry.MultiLineString'
                            }),
                            symbolizer: OpenLayers.Util.applyDefaults(
                                lineStyle,
                                OpenLayers.Feature.Vector.style['default']
                            )
                        }),
                        // Polygon geometries
                        new OpenLayers.Rule({
                            filter: new OpenLayers.Filter.Comparison({
                                type: OpenLayers.Filter.Comparison.EQUAL_TO,
                                property: 'geometryType',
                                value: 'OpenLayers.Geometry.Polygon'
                            }),
                            symbolizer: OpenLayers.Util.applyDefaults(
                                polygonStyle,
                                OpenLayers.Feature.Vector.style['default']
                            )
                        }),
                        // MultiPolygon geometries (same style as Polygon)
                        new OpenLayers.Rule({
                            filter: new OpenLayers.Filter.Comparison({
                                type: OpenLayers.Filter.Comparison.EQUAL_TO,
                                property: 'geometryType',
                                value: 'OpenLayers.Geometry.MultiPolygon'
                            }),
                            symbolizer: OpenLayers.Util.applyDefaults(
                                polygonStyle,
                                OpenLayers.Feature.Vector.style['default']
                            )
                        })
                    ]
                }
            )
        });
    }

    /**
     * Create OpenLayers Vector Layer from WFS GeoJSON
     * Creates styled vector layer and adds it to the map
     *
     * @param {Object} layerConfig - Layer configuration
     * @param {Object} geoJson - Transformed GeoJSON data (EPSG:3857)
     * @returns {OpenLayers.Layer.Vector|null} Vector layer or null if failed
     */
    function createWfsVectorLayer(layerConfig, geoJson) {

        // Create vector layer with unique name
        const vectorLayer = new OpenLayers.Layer.Vector(
            `Väylävirasto: ${layerConfig.title} (WFS)`,
            {
                displayInLayerSwitcher: false,
                uniqueName: `wfs-${layerConfig.name}`,
                styleMap: createGeometryStyleMap(),
                projection: new OpenLayers.Projection('EPSG:3857')
            }
        );

        // Transform coordinates and manually create OpenLayers features
        // This bypasses the GeoJSON parser which has issues with EPSG:3857 coordinates
        const features = [];

        if (!geoJson.features || geoJson.features.length === 0) {
            console.warn('WME Väylävirasto: No features to add to layer');
            return null;
        }

        geoJson.features.forEach((geoFeature, index) => {
            if (!geoFeature.geometry) return;

            let geometry = null;
            const coords = geoFeature.geometry.coordinates;
            const geomType = geoFeature.geometry.type;

            // Transform coordinates from EPSG:3067 to EPSG:3857
            const transformPoint = (pt) => {
                if (typeof proj4 !== 'undefined') {
                    const t = proj4('EPSG:3067', 'EPSG:3857', [pt[0], pt[1]]);
                    return pt.length >= 3 ? new OpenLayers.Geometry.Point(t[0], t[1]) : new OpenLayers.Geometry.Point(t[0], t[1]);
                }
                return new OpenLayers.Geometry.Point(pt[0], pt[1]);
            };

            try {
                switch (geomType) {
                    case 'Point':
                        const pt = transformPoint(coords);
                        geometry = pt;
                        break;

                    case 'LineString':
                        const points = coords.map(c => {
                            const t = typeof proj4 !== 'undefined' ? proj4('EPSG:3067', 'EPSG:3857', [c[0], c[1]]) : [c[0], c[1]];
                            return new OpenLayers.Geometry.Point(t[0], t[1]);
                        });
                        geometry = new OpenLayers.Geometry.LineString(points);
                        break;

                    case 'Polygon':
                        const rings = coords.map(ring => {
                            const ringPts = ring.map(c => {
                                const t = typeof proj4 !== 'undefined' ? proj4('EPSG:3067', 'EPSG:3857', [c[0], c[1]]) : [c[0], c[1]];
                                return new OpenLayers.Geometry.Point(t[0], t[1]);
                            });
                            return new OpenLayers.Geometry.LinearRing(ringPts);
                        });
                        geometry = new OpenLayers.Geometry.Polygon(rings);
                        break;

                    case 'MultiLineString':
                        const lineStrings = coords.map(line => {
                            const linePts = line.map(c => {
                                const t = typeof proj4 !== 'undefined' ? proj4('EPSG:3067', 'EPSG:3857', [c[0], c[1]]) : [c[0], c[1]];
                                return new OpenLayers.Geometry.Point(t[0], t[1]);
                            });
                            return new OpenLayers.Geometry.LineString(linePts);
                        });
                        geometry = new OpenLayers.Geometry.MultiLineString(lineStrings);
                        break;

                    case 'MultiPolygon':
                        const polygons = coords.map(poly => {
                            const polyRings = poly.map(ring => {
                                const ringPts = ring.map(c => {
                                    const t = typeof proj4 !== 'undefined' ? proj4('EPSG:3067', 'EPSG:3857', [c[0], c[1]]) : [c[0], c[1]];
                                    return new OpenLayers.Geometry.Point(t[0], t[1]);
                                });
                                return new OpenLayers.Geometry.LinearRing(ringPts);
                            });
                            return new OpenLayers.Geometry.Polygon(polyRings);
                        });
                        geometry = new OpenLayers.Geometry.MultiPolygon(polygons);
                        break;

                    default:
                        console.warn('  Unknown geometry type:', geomType);
                        return;
                }

                if (geometry) {
                    const feature = new OpenLayers.Feature.Vector(geometry, geoFeature.properties, geoFeature.id);
                    features.push(feature);
                }
            } catch (e) {
                console.error('  Error creating feature', index, ':', e);
            }
        });

        if (features.length === 0) {
            console.warn('WME Väylävirasto: No features to add to layer');
            return null;
        }

        // Add features to layer
        vectorLayer.addFeatures(features);

        // Log geometry types for verification
        const geometryTypes = new Set();
        features.forEach(feature => {
            if (feature.geometry && feature.geometry.CLASS_NAME) {
                geometryTypes.add(feature.geometry.CLASS_NAME);
            }
        });
        if (geometryTypes.size > 0) {
        }

        // Add layer to map
        W.map.getOLMap().addLayer(vectorLayer);

        return vectorLayer;
    }

    /**
     * Fetch WFS GetFeature data
     * Returns Promise resolving to GeoJSON FeatureCollection
     *
     * @param {string} layerName - WFS layer name (e.g., 'digiroad:dr_nopeusrajoitus')
     * @param {string} bbox - Optional BBOX string in EPSG:3067. If not provided, uses current viewport
     * @param {number} count - Maximum features to return (default: WFS_CONFIG.defaultCount)
     * @returns {Promise<Object>} Promise resolving to GeoJSON FeatureCollection
     */
    function fetchWfsFeature(layerName, bbox, count) {
        return new Promise((resolve, reject) => {
            // Get BBOX if not provided
            if (!bbox) {
                bbox = getWfsBbox();
                if (!bbox) {
                    reject(new Error('Failed to get WFS BBOX'));
                    return;
                }
            }

            // Build URL using existing buildWfsUrl()
            const url = buildWfsUrl(layerName, bbox, count || WFS_CONFIG.defaultCount);

            // Log request

            // Use GM_xmlhttpRequest for CORS-enabled requests
            if (typeof GM_xmlhttpRequest !== 'undefined') {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    timeout: WFS_CONFIG.timeout,
                    onload: function(response) {
                        if (response.status !== 200) {
                            reject(new Error(`HTTP ${response.status}: ${response.statusText}`));
                            return;
                        }
                        try {
                            const data = JSON.parse(response.responseText);
                            const validated = validateWFSGeoJSON(data);
                            resolve(validated);
                        } catch (e) {
                            reject(new Error('Invalid JSON response'));
                        }
                    },
                    onerror: function() {
                        reject(new Error('Network error'));
                    },
                    ontimeout: function() {
                        reject(new Error('Request timeout'));
                    }
                });
            }
            // Fallback to regular fetch (may fail CORS)
            else {
                fetch(url)
                    .then(r => {
                        if (!r.ok) throw new Error(`HTTP ${r.status}`);
                        return r.json();
                    })
                    .then(data => {
                        const validated = validateWFSGeoJSON(data);
                        resolve(validated);
                    })
                    .catch(reject);
            }
        });
    }

    /**
     * Validate WFS GeoJSON response
     * Ensures response structure is correct and returns safe defaults
     *
     * @param {Object} data - Parsed JSON response from WFS
     * @returns {Object} Validated GeoJSON FeatureCollection (or empty features array)
     */
    function validateWFSGeoJSON(data) {
        // Check if data exists
        if (!data || typeof data !== 'object') {
            console.warn('WME Väylävirasto: Invalid WFS response - not an object');
            return { features: [] };
        }

        // Check if features array exists
        if (!data.features || !Array.isArray(data.features)) {
            console.warn('WME Väylävirasto: Invalid WFS response - no features array');
            return { features: [] };
        }

        // Log feature count

        return data;
    }

    /**
     * Toggle WFS layer visibility
     * Manages WFS vector layer lifecycle: fetch, transform, create, add/remove
     *
     * @param {Object} layerConfig - Layer configuration
     * @param {boolean} visible - Desired visibility
     */
    function toggleWfsLayer(layerConfig, visible) {
        if (visible) {
            // Layer should be active - fetch and display

            // Setup interaction handlers on first WFS activation
            setupInteractionHandlers();

            // Check if already active
            if (activeWfsLayers.has(layerConfig.name)) {
                return;
            }

            // Fetch features (async - will create layer when data arrives)
            fetchWfsFeature(layerConfig.name)
                .then(geoJson => {
                    if (!geoJson || !geoJson.features || geoJson.features.length === 0) {
                        // Uncheck the checkbox since activation failed
                        updateCheckboxState(layerConfig.name, false);
                        layerConfig.visible = false;
                        return;
                    }

                    // Create vector layer (OpenLayers handles coordinate transformation)
                    const vectorLayer = createWfsVectorLayer(layerConfig, geoJson);

                    if (vectorLayer) {
                        activeWfsLayers.set(layerConfig.name, vectorLayer);
                    } else {
                        // Layer creation failed - uncheck checkbox
                        console.warn('WME Väylävirasto: Failed to create vector layer for', layerConfig.name);
                        updateCheckboxState(layerConfig.name, false);
                        layerConfig.visible = false;
                    }
                })
                .catch(error => {
                    console.error('WME Väylävirasto: Failed to activate WFS layer:', error);
                    // Uncheck the checkbox since activation failed
                    updateCheckboxState(layerConfig.name, false);
                    layerConfig.visible = false;
                });

        } else {
            // Layer should be inactive - remove from map

            // Clear any pending interaction fetch
            if (interactionTimeout) {
                clearTimeout(interactionTimeout);
                interactionTimeout = null;
            }

            const vectorLayer = activeWfsLayers.get(layerConfig.name);
            if (vectorLayer) {
                W.map.getOLMap().removeLayer(vectorLayer);
                vectorLayer.destroy(); // Clean up memory
                activeWfsLayers.delete(layerConfig.name);
            }

            // Clear cache for this layer (memory cleanup)
            featureAreaCache.forEach((cached, areaKey) => {
                if (cached.layers.has(layerConfig.name)) {
                    cached.layers.delete(layerConfig.name);
                    cached.features.delete(layerConfig.name);

                    // Remove cache entry if no layers remain
                    if (cached.layers.size === 0) {
                        featureAreaCache.delete(areaKey);
                    }
                }
            });
        }
    }

    /**
     * Setup interaction-based WFS fetching handlers
     * Registers hover event on WME map for tooltip display
     * Only registers once (checked via interactionHandlersRegistered flag)
     */
    function setupInteractionHandlers() {
        if (interactionHandlersRegistered) {
            return; // Already registered
        }

        const olMap = W.map.getOLMap();

        // Register hover handler (longer debounce)
        olMap.events.register('mousemove', null, handleMapHover);

        // Setup map movement handlers for auto-hide
        setupMapMovementHandlers();

        interactionHandlersRegistered = true;
    }

    /**
     * Handle map hover events
     * Fetches features for 25m radius around hover point (200ms debounce per requirement)
     * Also implements shorter re-entry delay (100ms) when revisiting same area
     *
     * @param {Object} evt - OpenLayers event object
     */
    function handleMapHover(evt) {
        const xy = evt.xy;
        const lonlat = W.map.getOLMap().getLonLatFromPixel(xy);
        const areaKey = getAreaKey(lonlat.lon, lonlat.lat);
        const now = Date.now();

        // Check for re-entry to same area within 2 seconds (use 100ms delay)
        if (areaKey === lastHoverAreaKey && (now - lastHoverTime) < 2000) {
            scheduleInteractionFetch(evt, 100); // Shorter re-entry delay
            return;
        }

        // Standard hover delay (200ms per original requirement)
        scheduleInteractionFetch(evt, HOVER_DEBOUNCE_MS);
    }

    /**
     * Schedule interaction-based feature fetch with debounce
     * Clears existing timeout before scheduling new fetch
     *
     * @param {Object} evt - OpenLayers event object
     * @param {number} delay - Debounce delay in milliseconds
     */
    function scheduleInteractionFetch(evt, delay) {
        // Clear existing timeout (debounce pattern)
        if (interactionTimeout) {
            clearTimeout(interactionTimeout);
        }

        // Schedule new fetch
        interactionTimeout = setTimeout(() => {
            const xy = evt.xy;
            const lonlat = W.map.getOLMap().getLonLatFromPixel(xy);
            // getLonLatFromPixel returns EPSG:3857 (map projection), need to convert to EPSG:4326
            const lonlat4326 = proj4('EPSG:3857', 'EPSG:4326', [lonlat.lon, lonlat.lat]);
            fetchFeaturesForArea(lonlat4326[0], lonlat4326[1]);
        }, delay);
    }

    /**
     * Extract road name from feature properties
     * Uses fallback chain: tienimi_su → nimi_suomi → nimi
     *
     * @param {Object} properties - GeoJSON feature properties
     * @returns {string|null} Road name or null if not found
     */
    function extractRoadName(properties) {
        if (!properties) return null;
        return properties.tienimi_su || properties.nimi_suomi || properties.nimi || null;
    }

    /**
     * Position tooltip near cursor with edge detection (v2.3.2)
     * Flips tooltip to left/top when near screen edges
     *
     * @param {number} x - Cursor X position in pixels
     * @param {number} y - Cursor Y position in pixels
     */
    function positionTooltip(x, y) {
        if (!tooltipElement) return;

        const offsetX = 15;
        const offsetY = 15;

        // Calculate default position
        let left = x + offsetX;
        let top = y + offsetY;

        // Get viewport and tooltip dimensions
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const tooltipRect = tooltipElement.getBoundingClientRect();
        const tooltipWidth = tooltipRect.width || 200; // fallback to max-width
        const tooltipHeight = tooltipRect.height || 50; // approximate height

        // Edge detection: flip to left if near right edge
        if (left + tooltipWidth > viewportWidth) {
            left = x - tooltipWidth - offsetX;
        }

        // Edge detection: flip to top if near bottom edge
        if (top + tooltipHeight > viewportHeight) {
            top = y - tooltipHeight - offsetY;
        }

        // Apply position
        tooltipElement.style.left = `${left}px`;
        tooltipElement.style.top = `${top}px`;
    }

    /**
     * Display road name tooltip in visual DOM element (v2.3.2)
     * Shows road name prominently with distance below
     *
     * @param {string} roadName - Road name to display
     * @param {string} layerName - WFS layer name
     * @param {string} featureId - Feature identifier
     * @param {number} lon - Hover longitude
     * @param {number} lat - Hover latitude
     * @param {number} distance - Distance to feature in meters (optional)
     */
    function displayRoadNameTooltip(roadName, layerName, featureId, lon, lat, distance = null) {
        if (!tooltipElement) {
            return;
        }

        while (tooltipElement.firstChild) {
            tooltipElement.removeChild(tooltipElement.firstChild);
        }

        const strong = document.createElement('strong');
        strong.textContent = roadName;
        tooltipElement.appendChild(strong);

        const olMap = W.map.getOLMap();
        const point3857 = proj4('EPSG:4326', 'EPSG:3857', [lon, lat]);
        const lonLat3857 = new OpenLayers.LonLat(point3857[0], point3857[1]);
        const pixel = olMap.getPixelFromLonLat(lonLat3857);

        if (olMap.div.contains(tooltipElement)) {
            positionTooltip(pixel.x, pixel.y);
        } else {
            const mapRect = olMap.div.getBoundingClientRect();
            positionTooltip(pixel.x + mapRect.left, pixel.y + mapRect.top);
        }

        tooltipElement.style.display = 'block';
        void tooltipElement.offsetWidth;
        tooltipElement.style.opacity = '1';

        lastHoverAreaKey = getAreaKey(lon, lat);
        lastHoverTime = Date.now();
    }

    /**
     * Escape HTML special characters to prevent XSS
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Hide road name tooltip (v2.3.2)
     * Fades out tooltip and resets tracking state
     */
    function hideRoadNameTooltip() {
        if (tooltipElement && tooltipElement.style.display !== 'none') {
            // Fade out
            tooltipElement.style.opacity = '0';

            // Hide after transition completes (200ms)
            setTimeout(() => {
                if (tooltipElement) {
                    tooltipElement.style.display = 'none';
                }
            }, 200);
        }

        // Clear tracking state
        lastHoverAreaKey = null;
        lastHoverTime = 0;
    }

    /**
     * Setup map movement handlers for auto-hide
     * Hides tooltip when map is moved or zoomed
     */
    function setupMapMovementHandlers() {
        const olMap = W.map.getOLMap();

        // Hide on map move
        olMap.events.register('move', null, () => {
            hideRoadNameTooltip();
        });

        // Hide on zoom change
        olMap.events.register('zoomend', null, () => {
            hideRoadNameTooltip();
        });

    }

    /**
     * Update checkbox state for a layer (v2.3.1)
     * Used to sync checkbox when layer activation fails asynchronously
     *
     * @param {string} layerName - Layer name to find
     * @param {boolean} checked - New checkbox state
     */
    function updateCheckboxState(layerName, checked) {
        // sidebarPanel is an object with DOM element references, not a DOM element itself
        // Query the actual DOM lists: layerList, quickAccessList, activeLayersList
        const sidebarLists = [sidebarPanel.layerList, sidebarPanel.quickAccessList, sidebarPanel.activeLayersList];

        sidebarLists.forEach(list => {
            if (!list) return;
            const items = list.querySelectorAll('[data-layer-name]');
            items.forEach(item => {
                if (item.getAttribute('data-layer-name') === layerName) {
                    const checkbox = item.querySelector('input[type="checkbox"]');
                    if (checkbox) {
                        checkbox.checked = checked;
                    }
                }
            });
        });

        // Find checkbox in floating panel (get by ID since floatingPanel is local)
        const floatingPanel = document.getElementById('vayla-floating-panel');
        if (floatingPanel) {
            const quickAccessItems = floatingPanel.querySelectorAll('.quick-access-item');
            quickAccessItems.forEach(item => {
                if (item.getAttribute('data-layer-name') === layerName) {
                    const checkbox = item.querySelector('input[type="checkbox"]');
                    if (checkbox) {
                        checkbox.checked = checked;
                    }
                }
            });
        }
    }

    /**
     * Fetch WFS features for area around interaction point
     * Calculates 25m radius BBOX with buffer, fetches for all active WFS layers
     *
     * @param {number} lon - Longitude in EPSG:4326
     * @param {number} lat - Latitude in EPSG:4326
     */
    function fetchFeaturesForArea(lon, lat) {
        // Only fetch if WFS tooltip mode is enabled
        if (!wfsTooltipMode) {
            return;
        }

        // Only fetch if there are active WFS layers
        if (activeWfsLayers.size === 0) {
            return;
        }

        // Validate input coordinates
        if (!isFinite(lon) || !isFinite(lat)) {
            console.warn('WME Väylävirasto: Invalid coordinates:', lon, lat);
            return;
        }

        // Convert to EPSG:3857 for meter-based calculations
        const point3857 = proj4('EPSG:4326', 'EPSG:3857', [lon, lat]);

        // Validate transformed coordinates
        if (!isFinite(point3857[0]) || !isFinite(point3857[1])) {
            console.warn('WME Väylävirasto: Coordinate transformation failed:', point3857);
            return;
        }

        // Calculate BBOX with radius + buffer (in EPSG:3857, units are meters)
        const radius = FETCH_RADIUS_METERS + BUFFER_METERS;
        const minx = point3857[0] - radius;
        const miny = point3857[1] - radius;
        const maxx = point3857[0] + radius;
        const maxy = point3857[1] + radius;

        // Convert BBOX to EPSG:3067 for WFS request
        const min3067 = proj4('EPSG:3857', 'EPSG:3067', [minx, miny]);
        const max3067 = proj4('EPSG:3857', 'EPSG:3067', [maxx, maxy]);

        // Build WFS BBOX string (minx,miny,maxx,maxy,CRS)
        const bbox = `${min3067[0]},${min3067[1]},${max3067[0]},${max3067[1]},urn:ogc:def:crs:EPSG::3067`;

        // Check cache first (avoid redundant fetch)
        const areaKey = getAreaKey(lon, lat);
        if (featureAreaCache.has(areaKey)) {
            displayCachedFeatures(areaKey);
            // Also display road name from cached features
            displayRoadNameFromCache(areaKey, lon, lat);
            return;
        }

        // Silent fetch - no loading indicator per context
        // Fetch for all active WFS layers
        activeWfsLayers.forEach((vectorLayer, layerName) => {
            fetchWfsFeature(layerName, bbox, WFS_CONFIG.defaultCount)
                .then(geoJson => {
                    if (!geoJson || !geoJson.features || geoJson.features.length === 0) {
                        return;
                    }

                    // Extract and display road names from features (no transformation needed for property extraction)
                    for (const feature of geoJson.features) {
                        const roadName = extractRoadName(feature.properties);
                        if (roadName) {
                            const featureId = feature.id || feature.properties?.link_id || 'unknown';
                            // Calculate approximate distance (simplified - bbox distance)
                            const distance = calculateDistanceToFeature(lon, lat, feature);
                            displayRoadNameTooltip(roadName, layerName, featureId, lon, lat, distance);
                            // Display first road name found (closest feature wins)
                            break;
                        }
                    }

                    // Manually create OpenLayers features (bypassing GeoJSON parser)
                    const features = [];
                    geoJson.features.forEach(geoFeature => {
                        if (!geoFeature.geometry) return;

                        let geometry = null;
                        const coords = geoFeature.geometry.coordinates;
                        const geomType = geoFeature.geometry.type;

                        try {
                            switch (geomType) {
                                case 'Point':
                                    const t = typeof proj4 !== 'undefined' ? proj4('EPSG:3067', 'EPSG:3857', [coords[0], coords[1]]) : [coords[0], coords[1]];
                                    geometry = new OpenLayers.Geometry.Point(t[0], t[1]);
                                    break;
                                case 'LineString':
                                    const points = coords.map(c => {
                                        const t = typeof proj4 !== 'undefined' ? proj4('EPSG:3067', 'EPSG:3857', [c[0], c[1]]) : [c[0], c[1]];
                                        return new OpenLayers.Geometry.Point(t[0], t[1]);
                                    });
                                    geometry = new OpenLayers.Geometry.LineString(points);
                                    break;
                                case 'Polygon':
                                    const rings = coords.map(ring => {
                                        const ringPts = ring.map(c => {
                                            const t = typeof proj4 !== 'undefined' ? proj4('EPSG:3067', 'EPSG:3857', [c[0], c[1]]) : [c[0], c[1]];
                                            return new OpenLayers.Geometry.Point(t[0], t[1]);
                                        });
                                        return new OpenLayers.Geometry.LinearRing(ringPts);
                                    });
                                    geometry = new OpenLayers.Geometry.Polygon(rings);
                                    break;
                                case 'MultiLineString':
                                    const lineStrings = coords.map(line => {
                                        const linePts = line.map(c => {
                                            const t = typeof proj4 !== 'undefined' ? proj4('EPSG:3067', 'EPSG:3857', [c[0], c[1]]) : [c[0], c[1]];
                                            return new OpenLayers.Geometry.Point(t[0], t[1]);
                                        });
                                        return new OpenLayers.Geometry.LineString(linePts);
                                    });
                                    geometry = new OpenLayers.Geometry.MultiLineString(lineStrings);
                                    break;
                                case 'MultiPolygon':
                                    const polygons = coords.map(poly => {
                                        const polyRings = poly.map(ring => {
                                            const ringPts = ring.map(c => {
                                                const t = typeof proj4 !== 'undefined' ? proj4('EPSG:3067', 'EPSG:3857', [c[0], c[1]]) : [c[0], c[1]];
                                                return new OpenLayers.Geometry.Point(t[0], t[1]);
                                            });
                                            return new OpenLayers.Geometry.LinearRing(ringPts);
                                        });
                                        return new OpenLayers.Geometry.Polygon(polyRings);
                                    });
                                    geometry = new OpenLayers.Geometry.MultiPolygon(polygons);
                                    break;
                            }

                            if (geometry) {
                                const feature = new OpenLayers.Feature.Vector(geometry, geoFeature.properties, geoFeature.id);
                                features.push(feature);
                            }
                        } catch (e) {
                            console.error('  Error creating feature:', e);
                        }
                    });

                    if (features.length > 0) {
                        vectorLayer.addFeatures(features);
                        // Cache for this area (LRU with eviction)
                        cacheFeaturesForArea(areaKey, geoJson, layerName, features);
                    }
                })
                .catch(error => {
                    console.error('WME Väylävirasto: Area fetch failed for', layerName, ':', error);
                });
        });
    }

    /**
     * Display road name from cached features
     *
     * @param {string} areaKey - Cache area key
     * @param {number} lon - Hover longitude
     * @param {number} lat - Hover latitude
     */
    function displayRoadNameFromCache(areaKey, lon, lat) {
        const cached = featureAreaCache.get(areaKey);
        if (!cached) return;

        // Iterate through cached layers to find road names
        for (const [layerName, features] of cached.features.entries()) {
            for (const feature of features) {
                if (feature.attributes) {
                    const roadName = extractRoadName(feature.attributes);
                    if (roadName) {
                        const featureId = feature.attributes.link_id || feature.id || 'unknown';
                        displayRoadNameTooltip(roadName, layerName, featureId, lon, lat);
                        return; // Display first match
                    }
                }
            }
        }
    }

    /**
     * Calculate approximate distance from hover point to feature
     * Simplified bbox distance calculation
     *
     * @param {number} lon - Hover longitude
     * @param {number} lat - Hover latitude
     * @param {Object} feature - GeoJSON feature
     * @returns {number} Approximate distance in meters
     */
    function calculateDistanceToFeature(lon, lat, feature) {
        // Simplified: use bbox center distance
        // For more accurate results, would use point-to-line distance
        if (!feature.bbox) return 0;

        const bbox = feature.bbox;
        // bbox is in EPSG:3067, convert hover point to 3067
        const hover3067 = proj4('EPSG:4326', 'EPSG:3067', [lon, lat]);

        const bboxCenterX = (bbox[0] + bbox[2]) / 2;
        const bboxCenterY = (bbox[1] + bbox[3]) / 2;

        const dx = hover3067[0] - bboxCenterX;
        const dy = hover3067[1] - bboxCenterY;

        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Generate cache key from coordinates
     * Creates grid cell key by rounding coordinates
     *
     * @param {number} lon - Longitude in EPSG:4326
     * @param {number} lat - Latitude in EPSG:4326
     * @returns {string} Cache key for this area
     */
    function getAreaKey(lon, lat) {
        // Round to 5 decimal places (~1 meter precision at Finnish latitudes)
        // This creates grid cells for geographic caching
        const precision = 5;
        return `${lon.toFixed(precision)}_${lat.toFixed(precision)}`;
    }

    /**
     * Cache features for geographic area with LRU eviction
     * Stores transformed GeoJSON and OpenLayers features per layer
     *
     * @param {string} areaKey - Geographic area cache key
     * @param {Object} geoJson - Transformed GeoJSON FeatureCollection
     * @param {string} layerName - WFS layer name
     * @param {Array} features - OpenLayers Feature objects
     */
    function cacheFeaturesForArea(areaKey, geoJson, layerName, features) {
        const timestamp = Date.now();

        if (featureAreaCache.has(areaKey)) {
            // Area exists in cache - update timestamp and add features
            const cached = featureAreaCache.get(areaKey);
            cached.timestamp = timestamp;
            cached.features.set(layerName, features);
            cached.layers.add(layerName);
        } else {
            // New area - create cache entry
            featureAreaCache.set(areaKey, {
                timestamp: timestamp,
                features: new Map([[layerName, features]]),
                layers: new Set([layerName])
            });

            // Evict oldest if over limit
            if (featureAreaCache.size > MAX_CACHED_AREAS) {
                evictOldestArea();
            }
        }

    }

    /**
     * Evict oldest cached area (LRU eviction)
     * Removes features from map layers and deletes cache entry
     */
    function evictOldestArea() {
        // Sort cache entries by timestamp (oldest first)
        const sorted = Array.from(featureAreaCache.entries())
            .sort((a, b) => a[1].timestamp - b[1].timestamp);

        // Calculate how many to remove
        const toRemove = sorted.slice(0, featureAreaCache.size - MAX_CACHED_AREAS);

        toRemove.forEach(([key, cached]) => {

            // Remove features from map layers (memory cleanup)
            cached.features.forEach((features, layerName) => {
                const vectorLayer = activeWfsLayers.get(layerName);
                if (vectorLayer) {
                    try {
                        vectorLayer.removeFeatures(features);
                    } catch (e) {
                        console.warn('  Failed to remove features from', layerName, ':', e);
                    }
                }
            });

            // Delete cache entry
            featureAreaCache.delete(key);
        });

    }

    /**
     * Display cached features for area
     * Adds cached features back to map layers if not already present
     *
     * @param {string} areaKey - Geographic area cache key
     */
    function displayCachedFeatures(areaKey) {
        const cached = featureAreaCache.get(areaKey);
        if (!cached) {
            return;
        }

        // Update timestamp (LRU refresh)
        cached.timestamp = Date.now();

        // Add features to layers if not already present
        cached.features.forEach((features, layerName) => {
            const vectorLayer = activeWfsLayers.get(layerName);
            if (vectorLayer) {
                // Check if features are already in layer to avoid duplicates
                const existingFeatures = vectorLayer.features || [];
                const featuresToAdd = features.filter(f => !existingFeatures.includes(f));

                if (featuresToAdd.length > 0) {
                    vectorLayer.addFeatures(featuresToAdd);
                } else {
                }
            }
        });
    }

    
    /**
     * Initialize script using WME SDK
     *
     * SDK Initialization:
     * 1. Use unsafeWindow.SDK_INITIALIZED.then() since we have @grant GM_xmlhttpRequest
     * 2. Call getWmeSdk() to get SDK instance
     * 3. Use SDK.Events.once() to wait for wme-ready
     * 4. Initialize UI and fetch WMS capabilities
     */
    function initScript() {

        // Check if getWmeSdk is available
        if (typeof getWmeSdk === 'undefined') {
            console.error('WME Väylävirasto: WME SDK not available. This script requires WME with SDK support.');
            return;
        }

        // Initialize SDK
        wmeSDK = getWmeSdk({
            scriptId: 'wme-vaylavirasto',
            scriptName: 'WME Väylävirasto'
        });

        wmeSDK.Events.once({ eventName: 'wme-ready' })
            .then(() => {
                // Initialize UI components first
                initializeUI();
                // Fetch WMS capabilities first (legacy layers)
                fetchWMSCapabilities().then(() => {
                    // After WMS completes, fetch WFS capabilities (vector layers with attributes)
                    // WFS layers will be merged into availableLayers
                    fetchWFSCapabilities().catch((error) => {
                        console.error('WME Väylävirasto: Failed to fetch WFS capabilities during init:', error);
                        // Continue anyway - WMS layers are already loaded
                    });
                }).catch((error) => {
                    console.error('WME Väylävirasto: Failed to fetch WMS capabilities:', error);
                });
            })
            .catch((error) => {
                console.error('WME Väylävirasto: Failed to wait for wme-ready:', error);
            });
    }

   
    // Start initialization using SDK

    if (typeof unsafeWindow !== 'undefined' && unsafeWindow.SDK_INITIALIZED) {
        unsafeWindow.SDK_INITIALIZED.then(initScript).catch((error) => {
            console.error('WME Väylävirasto: SDK initialization failed:', error);
        });
    } else {
        console.error('WME Väylävirasto: SDK_INITIALIZED not found on unsafeWindow. WME SDK may not be available.');
    }

})();
