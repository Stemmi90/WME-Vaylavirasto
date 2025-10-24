// ==UserScript==
// @name         WME Väylävirasto
// @namespace    https://waze.com
// @version      1.5
// @description  Suomen Väyläviraston WMS‑tasot Waze Map Editoria varten (v1.5: Rate limiting protection)
// @author       Stemmi
// @match        https://*.waze.com/*editor*
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/553221/WME%20V%C3%A4yl%C3%A4virasto.user.js
// @updateURL https://update.greasyfork.org/scripts/553221/WME%20V%C3%A4yl%C3%A4virasto.meta.js
// ==/UserScript==

(function () {
    'use strict';

    // Debounce function to limit rapid requests
    function debounce(func, wait) {
        var timeout;
        return function executedFunction() {
            var context = this;
            var args = arguments;
            var later = function() {
                timeout = null;
                func.apply(context, args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Wait for WME to load
    function init() {
        if (typeof W === 'undefined' || typeof W.map === 'undefined' || typeof OpenLayers === 'undefined') {
            setTimeout(init, 500);
            return;
        }

        console.log('WME Väylävirasto Layers: Initializing...');

        // Get the OpenLayers map object from WME
        var map = W.map.getOLMap();

        // Configuration for Väylävirasto WMS layers - CORRECTED BASED ON GETCAPABILITIES
        var wmsConfig = {
            baseUrl: 'https://avoinapi.vaylapilvi.fi/vaylatiedot/wms',
            layers: [
                {
                    name: 'Liikennemäärät 2023',
                    layerId: 'tiestotiedot:liikennemaarat_2023',
                    visible: false,
                    opacity: 0.9
                },
                {
                    name: 'Nopeusrajoitukset',
                    layerId: 'digiroad:dr_nopeusrajoitus',
                    visible: false,
                    opacity: 0.9
                },
                {
                    name: 'Liikennemerkit',
                    layerId: 'digiroad:dr_liikennemerkit',
                    visible: false,
                    opacity: 0.9
                },
                {
                    name: 'Päällystetyt tiet',
                    layerId: 'digiroad:dr_paallystetty_tie',
                    visible: false,
                    opacity: 0.9
                },
                {
                    name: 'Talvinopeusrajoitus',
                    layerId: 'digiroad:dr_talvinopeusrajoitus',
                    visible: false,
                    opacity: 0.9
                },
                {
                    name: 'Nopeusrajoituspäätökset',
                    layerId: 'tiestotiedot:nopeusrajoituspaatokset',
                    visible: false,
                    opacity: 0.9
                },
                {
                    name: 'Solmu',
                    layerId: 'digiroad:dr_solmu',
                    visible: false,
                    opacity: 0.9
                },
                {
                    name: 'Tielinkin tyyppi',
                    layerId: 'digiroad:dr_tielinkki_tielinkin_tyyppi',
                    visible: false,
                    opacity: 0.9
                },
                {
                    name: 'Tiekunnalliset yksityistiet',
                    layerId: 'digiroad:tiekunnalliset_yksityistiet',
                    visible: false,
                    opacity: 0.9
                }
            ]
        };

        // Create WMS layers with request throttling
        var wmsLayers = [];
        var requestQueue = [];
        var activeRequests = 0;
        var maxConcurrentRequests = 3; // Limit concurrent requests per layer

        wmsConfig.layers.forEach(function (layerConfig) {
            try {
                console.log('Creating layer: ' + layerConfig.name + ' (' + layerConfig.layerId + ')');

                // Create OpenLayers WMS layer with correct parameters
                var wmsLayer = new OpenLayers.Layer.WMS(
                    "Väylävirasto: " + layerConfig.name,
                    wmsConfig.baseUrl,
                    {
                        layers: layerConfig.layerId,
                        transparent: true,
                        format: 'image/png',
                        version: '1.3.0',
                        crs: 'EPSG:3857'
                    },
                    {
                        isBaseLayer: false,
                        visibility: layerConfig.visible,
                        opacity: layerConfig.opacity,
                        displayInLayerSwitcher: true,
                        transitionEffect: null,
                        tileOptions: {
                            crossOriginKeyword: null,
                            maxGetUrlLength: 2048
                        },
                        singleTile: false,
                        ratio: 1.5,
                        buffer: 2,
                        numZoomLevels: 20,
                        // Rate limiting optimizations
                        maxExtent: new OpenLayers.Bounds(-20037508, -20037508, 20037508, 20037508),
                        tileSize: new OpenLayers.Size(512, 512), // Larger tiles = fewer requests
                        serverResolutions: null,
                        // Add request throttling
                        requestEncoding: 'REST',
                        gutter: 15
                    }
                );

                // Add request throttling and error handling
                var originalGetURL = wmsLayer.getURL;
                wmsLayer.getURL = function(bounds) {
                    // Add small delay between requests to prevent rate limiting
                    var self = this;
                    var args = arguments;
                    
                    if (activeRequests >= maxConcurrentRequests) {
                        // Queue the request
                        requestQueue.push(function() {
                            return originalGetURL.apply(self, args);
                        });
                        return null;
                    }
                    
                    activeRequests++;
                    setTimeout(function() {
                        activeRequests--;
                        // Process queued requests
                        if (requestQueue.length > 0) {
                            var nextRequest = requestQueue.shift();
                            nextRequest();
                        }
                    }, 100); // 100ms delay between requests
                    
                    return originalGetURL.apply(this, args);
                };

                // Add event listener for tile load errors with retry logic
                wmsLayer.events.register('tileerror', wmsLayer, function (evt) {
                    console.warn('Tile load error for ' + layerConfig.name + ':', evt);
                    console.warn('URL that failed:', evt.url);
                    
                    // Check if it's a rate limiting error (HTTP 429 or 503)
                    if (evt.url && (evt.url.includes('429') || evt.url.includes('503'))) {
                        console.warn('⚠️ Rate limiting detected for ' + layerConfig.name + '. Retrying in 2 seconds...');
                        setTimeout(function() {
                            wmsLayer.redraw(true);
                        }, 2000);
                    }
                });

                // Add event listener for successful tile loads
                wmsLayer.events.register('tileloaded', wmsLayer, function (evt) {
                    console.log('Tile loaded successfully for ' + layerConfig.name);
                });

                wmsLayers.push({
                    layer: wmsLayer,
                    config: layerConfig
                });
                map.addLayer(wmsLayer);

                console.log('✓ Added layer: ' + layerConfig.name + ' (' + layerConfig.layerId + ')');
            } catch (e) {
                console.error('✗ Failed to add layer ' + layerConfig.name + ':', e);
            }
        });

        // Add map event listeners to handle rapid panning/zooming
        var isMapMoving = false;
        var mapMoveTimeout;
        
        // Debounced function to re-enable layer updates after map stops moving
        var enableLayerUpdates = debounce(function() {
            isMapMoving = false;
            console.log('Map movement stopped, re-enabling layer updates');
            wmsLayers.forEach(function(layerObj) {
                if (layerObj.layer.visibility) {
                    layerObj.layer.redraw(true);
                }
            });
        }, 500); // Wait 500ms after map stops moving
        
        // Listen for map movement events
        map.events.register('movestart', map, function() {
            isMapMoving = true;
            console.log('Map movement detected, throttling layer requests');
        });
        
        map.events.register('moveend', map, function() {
            enableLayerUpdates();
        });
        
        map.events.register('zoomend', map, function() {
            enableLayerUpdates();
        });

        // Create UI panel for layer control
        createControlPanel(wmsLayers);

        console.log('WME Väylävirasto Layers: Successfully loaded ' + wmsLayers.length + ' layers with rate limiting protection');

        // Add help message
        console.log('%cℹ️ USAGE TIPS:', 'color: blue; font-weight: bold;');
        console.log('• Click the 🇫🇮 button (top-left) to toggle the layer panel');
        console.log('• Some layers only visible at certain zoom levels');
        console.log('• Check Network tab (F12) if layers don\'t appear');
        console.log('• Look for tile URLs like: ...wms?SERVICE=WMS&...');
    }

    function openLegendWindow(layerConfig) {
        var legendUrl = 'https://avoinapi.vaylapilvi.fi/vaylatiedot/ows?service=WMS&version=1.3.0&request=GetLegendGraphic&format=image/png&layer=' + layerConfig.layerId;
        
        // Check if window already exists for this layer
        var windowId = 'legend-' + layerConfig.layerId.replace(/[^a-zA-Z0-9]/g, '-');
        var existingWindow = document.getElementById(windowId);
        
        if (existingWindow) {
            // Bring existing window to front
            existingWindow.style.zIndex = '10001';
            return;
        }

        // Create floatable legend window
        var legendWindow = document.createElement('div');
        legendWindow.id = windowId;
        legendWindow.style.position = 'fixed';
        legendWindow.style.top = '200px';
        legendWindow.style.left = '500px';
        legendWindow.style.background = 'white';
        legendWindow.style.border = '2px solid #0052A5';
        legendWindow.style.borderRadius = '8px';
        legendWindow.style.zIndex = '10001';
        legendWindow.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
        legendWindow.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        legendWindow.style.minWidth = '200px';
        legendWindow.style.maxWidth = '400px';

        // Create header with title and close button
        var header = document.createElement('div');
        header.style.background = '#0052A5';
        header.style.color = 'white';
        header.style.padding = '8px 12px';
        header.style.borderRadius = '6px 6px 0 0';
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.cursor = 'move';
        header.style.userSelect = 'none';

        var title = document.createElement('span');
        title.textContent = 'Selite: ' + layerConfig.name;
        title.style.fontSize = '14px';
        title.style.fontWeight = 'bold';

        var closeBtn = document.createElement('button');
        closeBtn.innerHTML = '✕';
        closeBtn.style.background = 'none';
        closeBtn.style.border = 'none';
        closeBtn.style.color = 'white';
        closeBtn.style.fontSize = '16px';
        closeBtn.style.cursor = 'pointer';
        closeBtn.style.padding = '0';
        closeBtn.style.width = '20px';
        closeBtn.style.height = '20px';
        closeBtn.style.borderRadius = '50%';
        closeBtn.style.display = 'flex';
        closeBtn.style.alignItems = 'center';
        closeBtn.style.justifyContent = 'center';

        closeBtn.addEventListener('mouseenter', function () {
            this.style.background = 'rgba(255,255,255,0.2)';
        });

        closeBtn.addEventListener('mouseleave', function () {
            this.style.background = 'none';
        });

        closeBtn.addEventListener('click', function () {
            legendWindow.remove();
        });

        header.appendChild(title);
        header.appendChild(closeBtn);

        // Create content area
        var content = document.createElement('div');
        content.style.padding = '12px';
        content.style.textAlign = 'center';

        var loadingText = document.createElement('div');
        loadingText.textContent = 'Ladataan selitettä...';
        loadingText.style.color = '#666';
        loadingText.style.fontSize = '13px';
        content.appendChild(loadingText);

        // Create image element
        var legendImg = document.createElement('img');
        legendImg.src = legendUrl;
        legendImg.style.maxWidth = '100%';
        legendImg.style.height = 'auto';
        legendImg.style.display = 'none';

        legendImg.addEventListener('load', function () {
            loadingText.style.display = 'none';
            this.style.display = 'block';
        });

        legendImg.addEventListener('error', function () {
            loadingText.textContent = 'Selitettä ei voitu ladata';
            loadingText.style.color = '#d32f2f';
            console.warn('Failed to load legend for ' + layerConfig.name + ':', legendUrl);
        });

        content.appendChild(legendImg);

        legendWindow.appendChild(header);
        legendWindow.appendChild(content);

        // Make window draggable
        var isDragging = false;
        var dragOffset = { x: 0, y: 0 };

        header.addEventListener('mousedown', function (e) {
            isDragging = true;
            dragOffset.x = e.clientX - legendWindow.offsetLeft;
            dragOffset.y = e.clientY - legendWindow.offsetTop;
            legendWindow.style.zIndex = '10001';
        });

        document.addEventListener('mousemove', function (e) {
            if (isDragging) {
                legendWindow.style.left = (e.clientX - dragOffset.x) + 'px';
                legendWindow.style.top = (e.clientY - dragOffset.y) + 'px';
            }
        });

        document.addEventListener('mouseup', function () {
            isDragging = false;
        });

        document.body.appendChild(legendWindow);
        
        console.log('✓ Opened legend window for: ' + layerConfig.name);
        console.log('  Legend URL: ' + legendUrl);
    }

    function createControlPanel(layers) {
        // Remove any existing elements first
        var existingBtn = document.getElementById('vayla-toggle-btn');
        var existingPanel = document.getElementById('vayla-layers-panel');
        if (existingBtn) existingBtn.remove();
        if (existingPanel) existingPanel.remove();

        // Create a collapsible button
        var toggleBtn = document.createElement('button');
        toggleBtn.id = 'vayla-toggle-btn';
        toggleBtn.innerHTML = '🇫🇮';
        toggleBtn.title = 'Näytä/piilota Väylävirasto tasot';

        // Set styles individually to avoid template literal issues
        toggleBtn.style.position = 'fixed';
        toggleBtn.style.top = '64px';
        toggleBtn.style.left = '415px';
        toggleBtn.style.zIndex = '10000';
        toggleBtn.style.width = '40px';
        toggleBtn.style.height = '40px';
        toggleBtn.style.padding = '0';
        toggleBtn.style.background = '#0052A5';
        toggleBtn.style.color = 'white';
        toggleBtn.style.border = '2px solid #333';
        toggleBtn.style.borderRadius = '6px';
        toggleBtn.style.cursor = 'grab';
        toggleBtn.style.fontSize = '22px';
        toggleBtn.style.boxShadow = '0 3px 8px rgba(0,0,0,0.4)';
        toggleBtn.style.transition = 'all 0.2s';
        toggleBtn.style.display = 'flex';
        toggleBtn.style.alignItems = 'center';
        toggleBtn.style.justifyContent = 'center';

        toggleBtn.addEventListener('mouseenter', function () {
            this.style.transform = 'scale(1.1)';
            this.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
        });

        toggleBtn.addEventListener('mouseleave', function () {
            this.style.transform = 'scale(1)';
            this.style.boxShadow = '0 3px 8px rgba(0,0,0,0.4)';
        });

        // Create container for the control panel
        var panel = document.createElement('div');
        panel.id = 'vayla-layers-panel';

        // Set panel styles individually
        panel.style.position = 'fixed';
        panel.style.top = '125px';
        panel.style.left = '10px';
        panel.style.background = 'white';
        panel.style.border = '2px solid #0052A5';
        panel.style.borderRadius = '8px';
        panel.style.padding = '14px';
        panel.style.zIndex = '10000';
        panel.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
        panel.style.maxWidth = '300px';
        panel.style.display = 'none';
        panel.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

        var header = document.createElement('div');
        header.innerHTML = '<strong>Väylävirasto Tasot</strong>';
        header.style.margin = '0 0 12px 0';
        header.style.fontSize = '16px';
        header.style.color = '#0052A5';
        header.style.borderBottom = '2px solid #0052A5';
        header.style.paddingBottom = '8px';
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        panel.appendChild(header);

        // Add checkbox for each layer
        layers.forEach(function (layerObj, index) {
            var layerContainer = document.createElement('div');
            layerContainer.style.display = 'flex';
            layerContainer.style.alignItems = 'center';
            layerContainer.style.marginBottom = '10px';
            layerContainer.style.padding = '6px';
            layerContainer.style.borderRadius = '4px';
            layerContainer.style.transition = 'background-color 0.2s';
            layerContainer.style.backgroundColor = index % 2 === 0 ? '#f9f9f9' : 'white';

            layerContainer.addEventListener('mouseenter', function () {
                this.style.backgroundColor = '#e3f2fd';
            });

            layerContainer.addEventListener('mouseleave', function () {
                this.style.backgroundColor = index % 2 === 0 ? '#f9f9f9' : 'white';
            });

            var label = document.createElement('label');
            label.style.display = 'flex';
            label.style.alignItems = 'center';
            label.style.cursor = 'pointer';
            label.style.flex = '1';

            var checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = layerObj.layer.visibility;
            checkbox.style.marginRight = '10px';
            checkbox.style.width = '18px';
            checkbox.style.height = '18px';
            checkbox.style.cursor = 'pointer';
            checkbox.style.accentColor = '#0052A5';

            checkbox.addEventListener('change', function () {
                var isVisible = this.checked;
                layerObj.layer.setVisibility(isVisible);

                console.log('%c' + (isVisible ? '👁️ ENABLED' : '🚫 DISABLED') + ': ' + layerObj.config.name,
                    'color: ' + (isVisible ? 'green' : 'red') + '; font-weight: bold;');

                if (isVisible) {
                    console.log('  Layer ID: ' + layerObj.config.layerId);
                    console.log('  Opacity: ' + layerObj.config.opacity);
                    console.log('  ⚠️ If not visible: zoom in/out or check Network tab for tile requests');
                }

                // Force redraw
                layerObj.layer.redraw(true);
            });

            var span = document.createElement('span');
            span.textContent = layerObj.config.name;
            span.style.fontSize = '13px';
            span.style.color = '#333';
            span.style.userSelect = 'none';
            span.style.flex = '1';

            // Create legend button
            var legendBtn = document.createElement('button');
            legendBtn.innerHTML = 'ℹ️';
            legendBtn.title = 'Näytä selite';
            legendBtn.style.marginLeft = '8px';
            legendBtn.style.width = '24px';
            legendBtn.style.height = '24px';
            legendBtn.style.padding = '0';
            legendBtn.style.background = '#f0f0f0';
            legendBtn.style.border = '1px solid #ccc';
            legendBtn.style.borderRadius = '4px';
            legendBtn.style.cursor = 'pointer';
            legendBtn.style.fontSize = '12px';
            legendBtn.style.display = 'flex';
            legendBtn.style.alignItems = 'center';
            legendBtn.style.justifyContent = 'center';
            legendBtn.style.transition = 'all 0.2s';

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
                openLegendWindow(layerObj.config);
            });

            label.appendChild(checkbox);
            label.appendChild(span);
            layerContainer.appendChild(label);
            layerContainer.appendChild(legendBtn);
            panel.appendChild(layerContainer);
        });

        // Add info section
        var infoDiv = document.createElement('div');
        infoDiv.style.marginTop = '12px';
        infoDiv.style.paddingTop = '12px';
        infoDiv.style.borderTop = '1px solid #ddd';
        infoDiv.style.fontSize = '11px';
        infoDiv.style.color = '#666';
        infoDiv.style.lineHeight = '1.4';
        infoDiv.innerHTML = '<div style="margin-bottom: 6px;"><strong>Lähde:</strong> Väylävirasto Avoin API</div>';
        panel.appendChild(infoDiv);

        // Simple toggle function
        toggleBtn.onclick = function () {
            console.log('Button clicked, panel display:', panel.style.display);
            if (panel.style.display === 'none' || panel.style.display === '') {
                // Position panel relative to button
                panel.style.left = toggleBtn.style.left;
                panel.style.top = (parseInt(toggleBtn.style.top) + 45) + 'px';
                panel.style.display = 'block';
                this.style.borderColor = '#0052A5';
                this.style.borderWidth = '3px';
                console.log('Panel opened');
            } else {
                panel.style.display = 'none';
                this.style.borderColor = '#333';
                this.style.borderWidth = '2px';
                console.log('Panel closed');
            }
        };

        // Drag logic: menu follows
        var isDragging = false;

        toggleBtn.onmousedown = function (e) {
            e.preventDefault();
            isDragging = false;
            console.log('Mouse down on button');

            var shiftX = e.clientX - toggleBtn.getBoundingClientRect().left;
            var shiftY = e.clientY - toggleBtn.getBoundingClientRect().top;

            function moveAt(pageX, pageY) {
                isDragging = true;
                toggleBtn.style.left = (pageX - shiftX) + 'px';
                toggleBtn.style.top = (pageY - shiftY) + 'px';
                // Panel follows if visible
                if (panel.style.display === 'block') {
                    panel.style.left = toggleBtn.style.left;
                    panel.style.top = (parseInt(toggleBtn.style.top) + 45) + 'px';
                }
            }

            function mouseMoveHandler(e) {
                moveAt(e.pageX, e.pageY);
            }

            function mouseUpHandler() {
                document.removeEventListener('mousemove', mouseMoveHandler);
                document.removeEventListener('mouseup', mouseUpHandler);
                console.log('Drag ended, was dragging:', isDragging);

                // Small delay to prevent click event if we were dragging
                if (isDragging) {
                    setTimeout(function () {
                        isDragging = false;
                    }, 100);
                }
            }

            document.addEventListener('mousemove', mouseMoveHandler);
            document.addEventListener('mouseup', mouseUpHandler);
        };

        // Override the click handler to check if we were dragging
        var originalOnClick = toggleBtn.onclick;
        toggleBtn.onclick = function (e) {
            if (isDragging) {
                console.log('Click prevented - was dragging');
                return;
            }
            originalOnClick.call(this, e);
        };

        toggleBtn.ondragstart = function () {
            return false;
        };

        document.body.appendChild(toggleBtn);
        document.body.appendChild(panel);

        console.log('✓ Control panel created with ' + layers.length + ' layers');
    }

    // Start initialization
    console.log('WME Väylävirasto: Starting userscript...');
    init();
})();

