// ==UserScript==
// @name         WME Väylävirasto
// @namespace    https://waze.com
// @version      1.3
// @description  Suomen Väyläviraston WMS‑tasot Waze Map Editoria varten
// @author       Stemmi
// @match        https://*.waze.com/*editor*
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/553221/WME%20V%C3%A4yl%C3%A4virasto.user.js
// @updateURL https://update.greasyfork.org/scripts/553221/WME%20V%C3%A4yl%C3%A4virasto.meta.js
// ==/UserScript==

(function () {
    'use strict';

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
                    opacity: 0.7
                },
                {
                    name: 'Nopeusrajoitukset',
                    layerId: 'digiroad:dr_nopeusrajoitus',
                    visible: false,
                    opacity: 0.8
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
                    opacity: 0.7
                },
                {
                    name: 'Talvinopeusrajoitus',
                    layerId: 'digiroad:dr_talvinopeusrajoitus',
                    visible: false,
                    opacity: 0.8
                },
                {
                    name: 'Nopeusrajoituspäätökset',
                    layerId: 'tiestotiedot:nopeusrajoituspaatokset',
                    visible: false,
                    opacity: 0.8
                },
                {
                    name: 'Solmu',
                    layerId: 'digiroad:dr_solmu',
                    visible: false,
                    opacity: 0.8
                },
                {
                    name: 'Tielinkin tyyppi',
                    layerId: 'digiroad:dr_tielinkki_tielinkin_tyyppi',
                    visible: false,
                    opacity: 0.8
                },
                {
                    name: 'Tiekunnalliset yksityistiet',
                    layerId: 'digiroad:tiekunnalliset_yksityistiet',
                    visible: false,
                    opacity: 0.8
                }
            ]
        };

        // Create WMS layers
        var wmsLayers = [];

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
                            crossOriginKeyword: null
                        },
                        singleTile: false,
                        ratio: 1,
                        buffer: 0,
                        numZoomLevels: 20
                    }
                );

                // Add event listener for tile load errors
                wmsLayer.events.register('tileerror', wmsLayer, function (evt) {
                    console.warn('Tile load error for ' + layerConfig.name + ':', evt);
                    console.warn('URL that failed:', evt.url);
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

        // Create UI panel for layer control
        createControlPanel(wmsLayers);

        console.log('WME Väylävirasto Layers: Successfully loaded ' + wmsLayers.length + ' layers');

        // Add help message
        console.log('%cℹ️ USAGE TIPS:', 'color: blue; font-weight: bold;');
        console.log('• Click the 🇫🇮 button (top-left) to toggle the layer panel');
        console.log('• Some layers only visible at certain zoom levels');
        console.log('• Check Network tab (F12) if layers don\'t appear');
        console.log('• Look for tile URLs like: ...wms?SERVICE=WMS&...');
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
            var label = document.createElement('label');
            label.style.display = 'flex';
            label.style.alignItems = 'center';
            label.style.marginBottom = '10px';
            label.style.cursor = 'pointer';
            label.style.padding = '6px';
            label.style.borderRadius = '4px';
            label.style.transition = 'background-color 0.2s';
            label.style.backgroundColor = index % 2 === 0 ? '#f9f9f9' : 'white';

            label.addEventListener('mouseenter', function () {
                this.style.backgroundColor = '#e3f2fd';
            });

            label.addEventListener('mouseleave', function () {
                this.style.backgroundColor = index % 2 === 0 ? '#f9f9f9' : 'white';
            });

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

            label.appendChild(checkbox);
            label.appendChild(span);
            panel.appendChild(label);
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

