define([
    'backbone',
    'underscore',
    'shared',
    'collections/location_site',
    'collections/cluster',
    'collections/cluster_biological',
    'views/map_control_panel',
    'views/side_panel',
    'ol',
    'jquery',
    'layerSwitcher',
    'views/olmap_basemap',
    'views/olmap_layers',
    'views/geocontext',
    'views/right_panel/location_site_detail',
    'views/right_panel/taxon_detail',
    'views/right_panel/records_detail',
    'views/right_panel/multiple_location_sites_details',
    'views/bug_report',
    'views/detail_dashboard/taxon_detail',
    'views/detail_dashboard/site_detail',
    'htmlToCanvas'
], function (Backbone, _, Shared, LocationSiteCollection, ClusterCollection,
             ClusterBiologicalCollection, MapControlPanelView, SidePanelView,
             ol, $, LayerSwitcher, Basemap, Layers, Geocontext,
             LocationSiteDetail, TaxonDetail, RecordsDetail, MultipleLocationSitesDetail, BugReportView,
             TaxonDetailDashboard, SiteDetailedDashboard, HtmlToCanvas) {
    return Backbone.View.extend({
        template: _.template($('#map-template').html()),
        className: 'map-wrapper',
        map: null,
        uploadDataState: false,
        isBoundaryEnabled: false,
        // attributes
        mapInteractionEnabled: false,
        previousZoom: 0,
        sidePanelView: null,
        initZoom: 8,
        numInFlightTiles: 0,
        scaleLineControl: null,
        mapIsReady: false,
        polygonDrawn: false,
        initCenter: [22.948492328125, -31.12543669218031],
        apiParameters: _.template(Shared.SearchURLParametersTemplate),

        // NEW: Performance optimization properties
        coordinateCache: new Map(),
        activeXHRRequests: [],
        lastMapMoveTime: 0,
        tileMonitoringEnabled: false,
        currentFilteredSiteIds: [],  // Track currently visible site IDs from search results

        events: {
            'click .zoom-in': 'zoomInMap',
            'click .zoom-out': 'zoomOutMap',
            'click .layer-control': 'layerControlClicked',
            'click #map-legend-wrapper': 'mapLegendClicked',
            'click .print-map-control': 'downloadMap',
            'click #start-tutorial': 'startTutorial',
        },

        clusterLevel: {
            5: 'country',
            7: 'province',
            8: 'district',
            9: 'municipal'
        },

        initialize: function () {
            if (defaultCenterMap) {
                this.initCenter = [];
                let center = defaultCenterMap.split(',');
                for (let d=0; d<center.length; d++) {
                    this.initCenter.push(parseFloat(center[d]));
                }
            }

            // Ensure methods keep the `this` references to the view itself
            _.bindAll(this, 'render');
            this.layers = new Layers({parent: this});
            this.locationSiteCollection = new LocationSiteCollection();
            this.clusterCollection = new ClusterCollection();
            this.geocontext = new Geocontext();
            new LocationSiteDetail();
            new TaxonDetail();
            new RecordsDetail();
            new MultipleLocationSitesDetail();
            this.taxonDetailDashboard = new TaxonDetailDashboard();
            this.siteDetailedDashboard = new SiteDetailedDashboard({parent: this});

            Shared.CurrentState.FETCH_CLUSTERS = true;

            // NEW: Lazy event listener registration
            this.setupEventListeners();

            this.render();
            this.clusterBiologicalCollection = new ClusterBiologicalCollection(this);
            this.showInfoPopup();

            this.pointVectorSource = new ol.source.Vector({});
            this.pointLayer = new ol.layer.Vector({
                source: this.pointVectorSource,
                style: [
                    new ol.style.Style({
                        stroke: new ol.style.Stroke({
                            color: 'blue',
                            width: 3
                        }),
                        fill: new ol.style.Fill({
                            color: 'rgba(0, 0, 255, 0.1)'
                        })
                    })]
            });
            this.pointLayer.setZIndex(1000);
            this.map.addLayer(this.pointLayer);
        },

        // NEW: Optimized event listener setup
        setupEventListeners: function () {
            // Core events - register immediately
            Shared.Dispatcher.on('map:showPopup', this.showPopup, this);
            Shared.Dispatcher.on('map:closePopup', this.hidePopup, this);
            Shared.Dispatcher.on('map:zoomToCoordinates', this.zoomToCoordinates, this);
            Shared.Dispatcher.on('map:toggleMapInteraction', this.toggleMapInteraction, this);

            // Dashboard events - register immediately (commonly used)
            this.registerDashboardEvents();

            // Feature events - lazy load
            this.featureEventsRegistered = false;

            // Layer events - lazy load
            this.layerEventsRegistered = false;
        },

        // NEW: Register feature events when needed
        registerFeatureEvents: function () {
            if (this.featureEventsRegistered) return;

            Shared.Dispatcher.on('map:addBiodiversityFeatures', this.addBiodiversityFeatures, this);
            Shared.Dispatcher.on('map:addLocationSiteClusterFeatures', this.addLocationSiteClusterFeatures, this);
            Shared.Dispatcher.on('map:closeHighlight', this.closeHighlight, this);
            Shared.Dispatcher.on('map:addHighlightFeature', this.addHighlightFeature, this);
            Shared.Dispatcher.on('map:switchHighlight', this.switchHighlight, this);
            Shared.Dispatcher.on('map:addHighlightPinnedFeature', this.addHighlightPinnedFeature, this);
            Shared.Dispatcher.on('map:removeHighlightPinnedFeature', this.removeHighlightPinnedFeature, this);
            Shared.Dispatcher.on('map:switchHighlightPinned', this.switchHighlightPinned, this);
            Shared.Dispatcher.on('map:closeHighlightPinned', this.closeHighlightPinned, this);
            Shared.Dispatcher.on('map:zoomToHighlightPinnedFeatures', this.zoomToHighlightPinnedFeatures, this);
            Shared.Dispatcher.on('map:filterPinnedSites', this.filterPinnedSitesByCurrentFilters, this);
            Shared.Dispatcher.on('map:updateFilteredSiteIds', this.updateFilteredSiteIds, this);

            this.featureEventsRegistered = true;
        },

        // NEW: Register layer events when needed
        registerLayerEvents: function () {
            if (this.layerEventsRegistered) return;

            Shared.Dispatcher.on('map:drawPoint', this.drawPoint, this);
            Shared.Dispatcher.on('map:clearPoint', this.clearPoint, this);
            Shared.Dispatcher.on('map:zoomToExtent', this.zoomToExtent, this);
            Shared.Dispatcher.on('map:reloadXHR', this.reloadXHR, this);
            Shared.Dispatcher.on('map:boundaryEnabled', this.boundaryEnabled, this);
            Shared.Dispatcher.on('map:zoomToDefault', this.zoomToDefault, this);
            Shared.Dispatcher.on('map:clearAllLayers', this.clearAllLayers, this);
            Shared.Dispatcher.on('map:addLayer', this.addLayer, this);
            Shared.Dispatcher.on('map:removeLayer', this.removeLayer, this);
            Shared.Dispatcher.on('map:updateBiodiversityLayerParams', this.updateBiodiversityLayerParams, this);
            Shared.Dispatcher.on('map:updateClusterBiologicalCollectionTaxon', this.updateClusterBiologicalCollectionTaxonID, this);
            Shared.Dispatcher.on('map:resetSitesLayer', this.resetSitesLayer, this);
            Shared.Dispatcher.on('map:setPolygonDrawn', this.setPolygonDrawn, this);

            this.layerEventsRegistered = true;
        },

        // NEW: Register dashboard events when needed
        registerDashboardEvents: function () {
            if (this.dashboardEventsRegistered) return;

            Shared.Dispatcher.on('map:showMapLegends', this.showMapLegends, this);
            Shared.Dispatcher.on('map:showTaxonDetailedDashboard', this.showTaxonDetailedDashboard, this);
            Shared.Dispatcher.on('map:showSiteDetailedDashboard', this.showSiteDetailedDashboard, this);
            Shared.Dispatcher.on('map:closeDetailedDashboard', this.closeDetailedDashboard, this);
            Shared.Dispatcher.on('map:downloadMap', this.downloadMap, this);

            this.dashboardEventsRegistered = true;
        },

        zoomInMap: function (e) {
            var view = this.map.getView();
            var zoom = view.getZoom();
            view.animate({
                zoom: zoom - 1,
                duration: 250
            })
        },

        boundaryEnabled: function (value) {
            this.isBoundaryEnabled = value;
        },

        zoomOutMap: function (e) {
            var view = this.map.getView();
            var zoom = view.getZoom();
            view.animate({
                zoom: zoom + 1,
                duration: 250
            })
        },

        zoomToCoordinates: function (coordinates, zoomLevel) {
            this.previousZoom = this.getCurrentZoom();
            this.map.getView().setCenter(coordinates);
            if (typeof zoomLevel !== 'undefined') {
                this.map.getView().setZoom(zoomLevel);
            }
        },

        drawPoint: function (coordinates, zoomLevel) {
            this.registerLayerEvents(); // Lazy load layer events
            this.zoomToCoordinates(coordinates, zoomLevel);
            var circle = new ol.geom.Circle(coordinates, 1000);
            var circleFeature = new ol.Feature(circle);
            this.pointVectorSource.addFeature(circleFeature);
        },

        clearPoint: function () {
            if (this.pointVectorSource) {
                this.pointVectorSource.clear();
            }
        },

        zoomToExtent: function (coordinates, shouldTransform=true, updateZoom=true) {
            if (this.isBoundaryEnabled) {
                this.fetchingRecords();
                return false;
            }
            this.previousZoom = this.getCurrentZoom();
            let ext = coordinates;
            if (shouldTransform) {
                ext = ol.proj.transformExtent(coordinates, ol.proj.get('EPSG:4326'), ol.proj.get('EPSG:3857'));
            }
            if (this.polygonDrawn) {
                ext = this.polygonDrawn;
            }
            this.map.getView().fit(ext, {
                size: this.map.getSize(), padding: [
                    0, $('.right-panel').width(), 0, 250
                ]
            });
            if (updateZoom && !this.polygonDrawn) {
                if (this.map.getView().getZoom() > 8) {
                    this.map.getView().setZoom(8);
                }
            }
        },

        setPolygonDrawn: function (polygon) {
           this.polygonDrawn = polygon
        },

        // NEW: Optimized map click with debouncing and caching
        mapClicked: _.debounce(function (e) {
            const self = this;
            if (this.mapInteractionEnabled) {
                return;
            }

            // Cancel any active requests
            this.cancelActiveRequests();

            this.layers.highlightVectorSource.clear();
            this.hidePopup();

            // Get lat and long map
            let lonlat = ol.proj.transform(e.coordinate, 'EPSG:3857', 'EPSG:4326');
            let lon = lonlat[0];
            let lat = lonlat[1];

            // NEW: Check cache first
            const cacheKey = `${Math.round(lon * 1000)},${Math.round(lat * 1000)}`;
            if (this.coordinateCache.has(cacheKey)) {
                const cachedResult = this.coordinateCache.get(cacheKey);
                this.handleCachedMapClick(cachedResult, e, lon, lat);
                return;
            }

            let layer = this.layers.layers['Sites'];
            let siteVisible = layer['layer'].getVisible();

            // If default bims site layer is visible then check whether user click on the
            // site point or not
            if (siteVisible) {
                let view = this.map.getView();
                let queryLayer = layer['layer'].getSource().getParams()['LAYERS'];
                let layerSource = layer['layer'].getSource().getGetFeatureInfoUrl(
                    e.coordinate,
                    view.getResolution(),
                    view.getProjection(),
                    {'INFO_FORMAT': 'application/json'}
                );
                layerSource += '&QUERY_LAYERS=' + queryLayer;

                const request = $.ajax({
                    type: 'POST',
                    url: '/get_feature/',
                    data: {
                        'layerSource': layerSource
                    },
                    success: function (data) {
                        self.handleFeatureInfoResponse(data, e, lon, lat, cacheKey);
                    },
                    error: function() {
                        self.showFeature(self.map.getFeaturesAtPixel(e.pixel), lon, lat);
                    }
                });

                this.activeXHRRequests.push(request);
            } else {
                self.showFeature(self.map.getFeaturesAtPixel(e.pixel), lon, lat);
            }
        }, 150), // Debounce map clicks by 150ms

        // NEW: Handle cached map click results
        handleCachedMapClick: function(cachedResult, e, lon, lat) {
            if (cachedResult.type === 'zoom') {
                this.zoomToCoordinates(e.coordinate, this.getCurrentZoom() + 2);
            } else if (cachedResult.type === 'site') {
                Shared.Dispatcher.trigger('siteDetail:show', cachedResult.siteId, cachedResult.siteCode);
            } else {
                this.showFeature(this.map.getFeaturesAtPixel(e.pixel), lon, lat);
            }
        },

        // NEW: Handle feature info response with caching
        handleFeatureInfoResponse: function(data, e, lon, lat, cacheKey) {
            const self = this;
            let objectData = {};
            if (data.constructor === Object) {
                objectData = data;
            } else {
                try {
                    objectData = JSON.parse(data);
                } catch (e) {
                    console.log(e);
                    return;
                }
            }

            let features = objectData['features'];
            if (features.length === 0) {
                const cacheData = { type: 'features', features: [] };
                this.coordinateCache.set(cacheKey, cacheData);
                self.showFeature(self.map.getFeaturesAtPixel(e.pixel), lon, lat);
                return;
            }

            let count = features[0]['properties']['count'];
            if (count > 1) {
                const cacheData = { type: 'zoom' };
                this.coordinateCache.set(cacheKey, cacheData);
                self.zoomToCoordinates(e.coordinate, self.getCurrentZoom() + 2);
            } else if (count === 1) {
                // Check if the feature is a single location site point
                if (features[0]['id'].includes('location_site_view')) {
                    let siteId = features[0]['id'].indexOf('fid') > -1 ?
                        features[0]['properties']['site_id'] :
                        features[0]['id'].split('.')[1];

                    const cacheData = { type: 'site', siteId: siteId, siteCode: '' };
                    this.coordinateCache.set(cacheKey, cacheData);
                    Shared.Dispatcher.trigger('siteDetail:show', siteId, '');
                }
                let initialRadius = 5;
                self.getSiteByCoordinateOptimized(lat, lon, initialRadius, function () {
                    self.showFeature(self.map.getFeaturesAtPixel(e.pixel), lon, lat, true);
                });
            } else {
                if (features[0]['id'].includes('location_site_view')) {
                    let siteId = features[0]['id'].indexOf('fid') > -1 ?
                        features[0]['properties']['site_id'] :
                        features[0]['id'].split('.')[1];

                    const cacheData = { type: 'site', siteId: siteId, siteCode: '' };
                    this.coordinateCache.set(cacheKey, cacheData);
                    Shared.Dispatcher.trigger('siteDetail:show', siteId, '');
                } else {
                    self.showFeature(self.map.getFeaturesAtPixel(e.pixel), lon, lat);
                }
            }
        },

        // NEW: Optimized coordinate search with caching and request management
        getSiteByCoordinateOptimized: function (lat, lon, radius, callback = null) {
            let url = '';
            const self = this;
            const maxRadius = 30;
            const radiusIncrement = 5;

            // NEW: Check cache first
            const cacheKey = `site_${Math.round(lat * 1000)}_${Math.round(lon * 1000)}_${radius}`;
            if (this.coordinateCache.has(cacheKey)) {
                const cachedResult = this.coordinateCache.get(cacheKey);
                if (cachedResult.found && cachedResult.data.length > 0) {
                    if (this.uploadDataState) {
                        this.mapControlPanel.showUploadDataModal(lon, lat, cachedResult.data[0]);
                    } else {
                        Shared.Dispatcher.trigger('siteDetail:show', cachedResult.data[0]['id'], cachedResult.data[0]['site_code'], false, false);
                        if (callback && typeof callback === 'function') {
                            callback();
                        }
                    }
                    return;
                }
            }

            if (Shared.CurrentState.SEARCH) {
                filterParameters['siteId'] = '';
                url = '/api/get-site-by-coord/' + self.apiParameters(filterParameters) + '&lon=' + lon + '&lat=' + lat + '&radius=' + radius + '&search_mode=True';
            } else {
                url = '/api/get-site-by-coord/?lon=' + lon + '&lat=' + lat + '&radius=' + radius
            }

            const request = $.ajax({
                url: url,
                success: function (data) {
                    // Cache the result
                    const cacheData = { found: data.length > 0, data: data };
                    self.coordinateCache.set(cacheKey, cacheData);

                    if (self.uploadDataState) {
                        self.mapControlPanel.showUploadDataModal(lon, lat, data[0]);
                    } else if (data.length > 0) {
                         Shared.Dispatcher.trigger('siteDetail:show', data[0]['id'], data[0]['site_code'], false, false);
                         if (callback && typeof callback === 'function') {
                             callback();
                         }
                    } else {
                        let nextRadius = radius + radiusIncrement;
                        if (nextRadius < maxRadius) {
                            self.getSiteByCoordinateOptimized(lat, lon, nextRadius, callback);
                        } else {
                            Shared.Dispatcher.trigger('siteDetail:closeSidePanel');
                        }
                    }
                },
                error: function() {
                    Shared.Dispatcher.trigger('siteDetail:closeSidePanel');
                }
            });

            this.activeXHRRequests.push(request);
        },

        // NEW: Cancel active XHR requests
        cancelActiveRequests: function() {
            this.activeXHRRequests.forEach(function(request) {
                if (request && request.readyState !== 4) {
                    request.abort();
                }
            });
            this.activeXHRRequests = [];
        },

        showFeature: function (features, lon, lat, siteExist = false) {
            let featuresClickedResponseData = [];
            const self = this;
            // Point of interest flag
            let poiFound = false;
            let featuresData = '';

            this.registerFeatureEvents(); // Lazy load feature events

            if (features) {
                $.each(features, function (index, feature) {
                    const geometry = feature.getGeometry();
                    const geometryType = geometry.getType();

                    if (geometryType === 'Point') {
                        featuresClickedResponseData = self.featureClicked(
                            feature, self.uploadDataState);
                        poiFound = featuresClickedResponseData[0];
                        featuresData = featuresClickedResponseData[1];
                        self.zoomToCoordinates(geometry.getCoordinates());
                        // increase zoom level if it is clusters
                        if (feature.getProperties()['count'] &&
                            feature.getProperties()['count'] > 1) {
                            self.map.getView().setZoom(self.getCurrentZoom() + 1);
                            poiFound = true;
                        }
                        if (feature.getProperties().hasOwnProperty('features')) {
                            if (feature.getProperties()['features'].length > 0) {
                                poiFound = true;
                            }
                        }
                    }
                });
            }
            if (!poiFound) {
                // Show feature info
                Shared.Dispatcher.trigger('third_party_layers:showFeatureInfo', lon, lat, siteExist, featuresData);
                Shared.Dispatcher.trigger('layers:showFeatureInfo', lon, lat, siteExist);
            }
        },

        featureClicked: function (feature, uploadDataState) {
            var properties = feature.getProperties();
            if (properties.hasOwnProperty('station')) {
                return [false, feature];
            }

            if (properties.hasOwnProperty('features')) {
                if (properties['features'].length > 1) {
                    this.zoomToCoordinates(
                        feature.getGeometry().getCoordinates(),
                        this.getCurrentZoom() + 2
                    );
                } else {
                    var _properties = properties['features'][0].getProperties();
                    Shared.Dispatcher.trigger('locationSite-' + _properties.id + ':clicked');
                }
            }

            if (!properties.hasOwnProperty('record_type')) {
                return [false, ''];
            }

            if (uploadDataState) {
                return [false, feature];
            }

            if (properties['record_type'] === 'site') {
                Shared.Dispatcher.trigger('locationSite-' + properties.id + ':clicked');
            } else {
                Shared.Dispatcher.trigger('cluster-biology' + properties.id + ':clicked');
            }
            this.layers.highlightVectorSource.clear();
            if (this.layers.layerStyle.isIndividialCluster(feature)) {
                this.addHighlightFeature(feature);
            }
            return [true, properties];
        },

        hidePopup: function () {
            this.popup.setPosition(undefined);
        },

        showPopup: function (coordinates, html) {
            $('#popup').html(html);
            this.popup.setPosition(coordinates);
        },

        layerControlClicked: function (e) {
        },

        mapLegendClicked: function (e) {
            this.registerDashboardEvents(); // Lazy load dashboard events
            var $mapLegend = this.$mapLegendWrapper.find('#map-legend');

            if ($mapLegend.is(':visible')) {
                this.hideMapLegends(true);
            } else {
                this.showMapLegends(true);
            }
        },

        showMapLegends: function (showTooltip) {
            let legendsDisplayed = Shared.StorageUtil.getItem('legendsDisplayed');
            if (!legendsDisplayed) {
                Shared.StorageUtil.setItem('legendsDisplayed', true);
            }
            if (Shared.LegendsDisplayed === true) {
                return true;
            }
            Shared.LegendsDisplayed = true;
            var $mapLegend = this.$mapLegendWrapper.find('#map-legend');
            var $mapLegendSymbol = this.$mapLegendWrapper.find('#map-legend-symbol');

            this.$mapLegendWrapper.removeClass('hide-legend');
            this.$mapLegendWrapper.addClass('show-legend');
            $mapLegendSymbol.hide();
            $mapLegend.show();
            this.$mapLegendWrapper.attr('data-original-title', 'Click to hide legends <br/>Drag to move legends').tooltip('hide');

            if (showTooltip) {
                this.$mapLegendWrapper.tooltip('show');
            }
        },

        hideMapLegends: function (showTooltip) {
            let legendsDisplayed = Shared.StorageUtil.getItem('legendsDisplayed');
            if (typeof legendsDisplayed === 'undefined' || legendsDisplayed === true) {
                Shared.StorageUtil.setItem('legendsDisplayed', false);
            }
            if (Shared.LegendsDisplayed === false) {
                return true;
            }
            Shared.LegendsDisplayed = false;
            var $mapLegend = this.$mapLegendWrapper.find('#map-legend');
            var $mapLegendSymbol = this.$mapLegendWrapper.find('#map-legend-symbol');

            this.$mapLegendWrapper.addClass('hide-legend');
            this.$mapLegendWrapper.removeClass('show-legend');
            $mapLegendSymbol.show();
            $mapLegend.hide();
            this.$mapLegendWrapper.attr('data-original-title', 'Show legends').tooltip('hide');

            if (showTooltip) {
                this.$mapLegendWrapper.tooltip('show');
            }
        },

        getCurrentZoom: function () {
            return this.map.getView().getZoom();
        },

        getCurrentBbox: function () {
            var ext = this.map.getView().calculateExtent(this.map.getSize());
            return ol.proj.transformExtent(ext, ol.proj.get('EPSG:3857'), ol.proj.get('EPSG:4326'));
        },

        render: function () {
            var self = this;
            this.$el.html(this.template());
            $('#map-container').append(this.$el);
            this.loadMap();

            this.map.on('click', function (e) {
                self.mapClicked(e);
            });

            this.sidePanelView = new SidePanelView();
            this.mapControlPanel = new MapControlPanelView({
                parent: this
            });

            this.$el.append(this.mapControlPanel.render().$el);
            this.$el.append(this.sidePanelView.render().$el);

            this.mapControlPanel.searchView.initDateFilter();

            // add layer switcher
            var layerSwitcher = new LayerSwitcher();
            this.map.addControl(layerSwitcher);
            $(layerSwitcher.element).addClass('layer-switcher-custom');
            $(layerSwitcher.element).attr('data-toggle', 'popover');
            $(layerSwitcher.element).attr('data-placement', 'right');
            $(layerSwitcher.element).attr('data-trigger', 'hover');
            $(layerSwitcher.element).attr('data-content', 'Change Basemap');
            $(layerSwitcher.element).removeClass('ol-control');
            $('.layer-switcher-custom').click(function () {
                $(this).popover('hide');
            });
            $('.layer-switcher-custom .panel').mouseenter(function () {
                $('.layer-switcher-custom').popover('disable');
            }).mouseleave(function () {
                $('.layer-switcher-custom').popover('enable');
            });
            this.mapControlPanel.addPanel($(layerSwitcher.element));

            // NEW: Optimized map move handler with debouncing
            this.map.on('moveend', _.debounce(function (evt) {
                self.mapMoved();
            }, 300));

            this.bugReportView = new BugReportView();
            this.$el.append(this.bugReportView.render().$el);
            this.$el.append(this.taxonDetailDashboard.render().$el);
            this.$el.append(this.siteDetailedDashboard.render().$el);

            this.$mapLegendWrapper = $('#map-legend-wrapper');
            this.$mapLegendWrapper.draggable({
                containment: '#map',
                start: function (event, ui) {
                    self.$mapLegendWrapper.css('bottom', 'auto');
                    $("[data-toggle=tooltip]").tooltip('hide');
                },
                stop: function (event, ui) {
                    var legend_position = self.$mapLegendWrapper.position();
                    var bottom = $('#map').height() - legend_position.top - self.$mapLegendWrapper.outerHeight();
                    self.$mapLegendWrapper.css('bottom', bottom + 'px').css('top', 'auto');
                }
            });

            // NEW: Conditional tile monitoring
            this.setupTileMonitoring();

            // NEW: Optimized postrender handler
            this.map.on('postrender', _.throttle(function (evt) {
                if (!evt.frameState) return;

                var numHeldTiles = 0;
                var wanted = evt.frameState.wantedTiles;
                for (var layer in wanted)
                    if (wanted.hasOwnProperty(layer))
                        numHeldTiles += Object.keys(wanted[layer]).length;

                var ready = self.numInFlightTiles === 0 && numHeldTiles === 0;
                if (self.mapIsReady !== ready)
                    self.mapIsReady = ready;
            }, 100));

            return this;
        },

        // NEW: Setup tile monitoring only when needed
        setupTileMonitoring: function() {
            if (this.tileMonitoringEnabled) return;

            const self = this;
            this.map.getLayers().forEach(function (layer) {
                try {
                    var source = layer.getSource();
                    if (source instanceof ol.source.TileImage && layer.getVisible()) {
                        source.on('tileloadstart', function () {
                            ++self.numInFlightTiles
                        });
                        source.on('tileloadend', function () {
                            --self.numInFlightTiles
                        });
                        source.on('tileloaderror', function () {
                            --self.numInFlightTiles
                        });
                    }
                } catch (err) {
                    console.warn('Error setting up tile monitoring:', err);
                }
            });

            this.tileMonitoringEnabled = true;
        },

        // NEW: Optimized map moved handler
        mapMoved: function () {
            const currentTime = Date.now();
            this.lastMapMoveTime = currentTime;

            // Debounce administrative layer changes
            setTimeout(() => {
                if (currentTime === this.lastMapMoveTime) {
                    let administrative = this.checkAdministrativeLevel();
                    if (administrative !== 'detail') {
                        this.layers.changeLayerAdministrative(administrative);
                    }
                }
            }, 200);
        },

        loadMap: function () {
            var self = this;
            var mousePositionControl = new ol.control.MousePosition({
                projection: 'EPSG:4326',
                target: document.getElementById('mouse-position-wrapper'),
                coordinateFormat: function (coordinate) {
                    return ol.coordinate.format(coordinate, '{y},{x}', 4);
                }
            });
            var basemap = new Basemap();

            var center = this.initCenter;
            if (centerPointMap) {
                var centerArray = centerPointMap.split(',');
                for (var i in centerArray) {
                    centerArray[i] = parseFloat(centerArray[i]);
                }
                center = centerArray;
            }

            // Add scaleline control
            let scalelineControl = new ol.control.ScaleLine({
                units: 'metric',
                bar: true,
                steps: 4,
                text: true,
                minWidth: 140
            })

            let extent = defaultExtentMap.split(',');
            let newExtent = [];
            for (let e=0; e < extent.length; e++) {
                newExtent.push(parseFloat(extent[e]));
            }
            extent = ol.proj.transformExtent(newExtent, 'EPSG:4326', 'EPSG:3857');

            this.map = new ol.Map({
                target: 'map',
                layers: basemap.getBaseMaps(),
                view: new ol.View({
                    center: ol.proj.fromLonLat(center),
                    zoom: this.initZoom,
                    minZoom: 5,
                    maxZoom: 19, // prevent zooming past 50m
                }),
                controls: ol.control.defaults({
                    zoom: false
                }).extend(
                    [
                        mousePositionControl,
                        scalelineControl
                    ])
            });

            this.map.getView().fit(extent);

            // Create a popup overlay which will be used to display feature info
            this.popup = new ol.Overlay({
                element: document.getElementById('popup'),
                positioning: 'bottom-center',
                offset: [0, -10]
            });
            this.map.addOverlay(this.popup);
            this.layers.addLayersToMap(this.map);
            this.initExtent = this.getCurrentBbox();
        },

        removeLayer: function (layer) {
            this.map.removeLayer(layer);
        },

        addLayer: function (layer) {
            this.map.addLayer(layer);
            // Setup tile monitoring for new layer if it's visible
            if (layer.getVisible() && layer.getSource() instanceof ol.source.TileImage) {
                this.setupTileMonitoringForLayer(layer);
            }
        },

        // NEW: Setup tile monitoring for individual layers
        setupTileMonitoringForLayer: function(layer) {
            const self = this;
            try {
                var source = layer.getSource();
                if (source instanceof ol.source.TileImage) {
                    source.on('tileloadstart', function () {
                        ++self.numInFlightTiles
                    });
                    source.on('tileloadend', function () {
                        --self.numInFlightTiles
                    });
                    source.on('tileloaderror', function () {
                        --self.numInFlightTiles
                    });
                }
            } catch (err) {
                console.warn('Error setting up tile monitoring for layer:', err);
            }
        },

        reloadXHR: function () {
            this.cancelActiveRequests();
            this.clearCache();
            this.previousZoom = -1;
            this.clusterCollection.administrative = null;
            this.fetchingRecords();
            $('#fetching-error .call-administrator').show();
        },

        // NEW: Clear caches
        clearCache: function() {
            this.coordinateCache.clear();
        },

        checkAdministrativeLevel: function () {
            var self = this;
            var zoomLevel = this.map.getView().getZoom();
            var administrative = 'detail';
            $.each(Object.keys(this.clusterLevel), function (index, value) {
                if (zoomLevel <= value) {
                    administrative = self.clusterLevel[value];
                    return false;
                }
            });
            return administrative;
        },

        resetAdministrativeLayers: function () {
            var administrative = this.checkAdministrativeLevel();
            if (administrative !== 'detail') {
                if (administrative === this.clusterCollection.administrative) {
                    return
                }
                this.layers.changeLayerAdministrative(administrative);
            } else {
                this.clusterCollection.administrative = null;
            }
        },

        fetchingRecords: function () {
            // get records based on administration
            var self = this;
            return;
            if (!this.layers.isBiodiversityLayerLoaded()) {
                return
            }
            self.updateClusterBiologicalCollectionZoomExt();
        },

        updateClusterBiologicalCollectionTaxonID: function (taxonID, taxonName) {
            this.closeHighlight();
            if (!this.sidePanelView.isSidePanelOpen() && !this.mapControlPanel.searchView.searchPanel.isPanelOpen()) {
                return
            }
        },

        updateClusterBiologicalCollectionZoomExt: function () {
            this.clusterBiologicalCollection.updateZoomAndBBox(
                this.getCurrentZoom(), this.getCurrentBbox());
        },

        addBiodiversityFeatures: function (features) {
            // this.layers.biodiversitySource.addFeatures(features);
        },

        addLocationSiteClusterFeatures: function (features) {
            this.layers.locationSiteClusterSource.addFeatures(features);
        },

        isAllLayersReady: function () {
            if (this.layers.locationSiteClusterSource && this.layers.highlightVectorSource && this.layers.highlightPinnedVectorSource) {
                return true;
            }
            return false;
        },

        switchHighlight: function (features, ignoreZoom) {
            var self = this;
            this.closeHighlight();
            $.each(features, function (index, feature) {
                self.addHighlightFeature(feature);
            });
            if (!ignoreZoom) {
                var extent = this.layers.highlightVectorSource.getExtent();
                this.map.getView().fit(extent, {
                    size: this.map.getSize(), padding: [
                        0, $('.right-panel').width(), 0, 250
                    ]
                });
                if (this.getCurrentZoom() > 8) {
                    this.map.getView().setZoom(8);
                }
            }
        },

        addHighlightFeature: function (feature) {
            this.layers.highlightVectorSource.addFeature(feature);
        },

        closeHighlight: function () {
            this.hidePopup();
            if (this.layers.highlightVectorSource) {
                this.layers.highlightVectorSource.clear();
            }
        },

        switchHighlightPinned: function (features, ignoreZoom) {
            var self = this;
            this.closeHighlightPinned();
            $.each(features, function (index, feature) {
                self.addHighlightPinnedFeature(feature);
            });
        },

        zoomToHighlightPinnedFeatures: function () {
            this.map.getView().fit(
                this.layers.highlightPinnedVectorSource.getExtent(),
                {
                    size: this.map.getSize(),
                    padding: [
                        0, $('.right-panel').width(), 0, 250
                    ]
                });
        },

        addHighlightPinnedFeature: function (feature) {
            this.layers.highlightPinnedVectorSource.addFeature(feature);
        },

        removeHighlightPinnedFeature: function (id) {
            var self = this;
            self.layers.highlightPinnedVectorSource.getFeatures().forEach(function (feature) {
                var feature_id = feature.getProperties()['id'];
                if (feature_id === id) {
                    self.layers.highlightPinnedVectorSource.removeFeature(feature);
                }
            });
        },

        closeHighlightPinned: function () {
            this.hidePopup();
            if (this.layers.highlightPinnedVectorSource) {
                this.layers.highlightPinnedVectorSource.clear();
            }
        },

        filterPinnedSitesByCurrentFilters: function () {
            var self = this;
            if (!this.layers.highlightPinnedVectorSource) {
                console.log('No highlightPinnedVectorSource');
                return;
            }

            var allFeatures = this.layers.highlightPinnedVectorSource.getFeatures();
            console.log('Total pinned features:', allFeatures.length);
            console.log('Current filtered site IDs:', this.currentFilteredSiteIds);
            console.log('Has active filters:', this.hasActiveFilters());

            // If no filters are applied, keep all pinned sites
            if (!this.hasActiveFilters()) {
                console.log('No active filters - keeping all pinned sites');
                return;
            }

            // Remove pinned sites that are not in the current filtered results
            var featuresToRemove = [];
            this.layers.highlightPinnedVectorSource.getFeatures().forEach(function (feature) {
                var featureId = feature.get('id');
                console.log('Checking feature with ID:', featureId, 'Type:', typeof featureId);

                if (!featureId) {
                    console.log('Feature has no ID - skipping');
                    return;
                }

                // Note: Administrative boundary features (starting with 'adminArea-') will also be filtered
                // They will be removed if no sites match the current filters

                // Check if this site ID is in the current filtered results
                var featureIdNum = parseInt(featureId);
                var featureIdStr = featureId.toString();
                var isInFilteredResults = self.currentFilteredSiteIds.indexOf(featureIdNum) !== -1 ||
                                         self.currentFilteredSiteIds.indexOf(featureIdStr) !== -1 ||
                                         self.currentFilteredSiteIds.indexOf(featureId) !== -1;

                console.log('Feature', featureId, 'in filtered results:', isInFilteredResults);

                if (!isInFilteredResults) {
                    console.log('Marking feature', featureId, 'for removal');
                    featuresToRemove.push(feature);
                }
            });

            console.log('Features to remove:', featuresToRemove.length);

            // Remove features that don't match filters
            featuresToRemove.forEach(function (feature) {
                console.log('Removing feature:', feature.get('id'));
                self.layers.highlightPinnedVectorSource.removeFeature(feature);
            });
        },

        updateFilteredSiteIds: function (siteIds) {
            console.log('Updating filtered site IDs:', siteIds);
            // Update the list of currently visible site IDs
            this.currentFilteredSiteIds = siteIds || [];
            console.log('Stored site IDs:', this.currentFilteredSiteIds);

            // Automatically filter pinned sites after updating IDs
            this.filterPinnedSitesByCurrentFilters();
        },

        hasActiveFilters: function () {
            // Check if any filters are currently active
            return !(
                !filterParameters['search'] &&
                !filterParameters['collector'] &&
                !filterParameters['validated'] &&
                !filterParameters['category'] &&
                !filterParameters['yearFrom'] &&
                !filterParameters['yearTo'] &&
                !filterParameters['userBoundary'] &&
                !filterParameters['referenceCategory'] &&
                !filterParameters['reference'] &&
                !filterParameters['endemic'] &&
                !filterParameters['modules'] &&
                !filterParameters['conservationStatus'] &&
                !filterParameters['spatialFilter'] &&
                !filterParameters['ecologicalCategory'] &&
                !filterParameters['sourceCollection'] &&
                !filterParameters['abioticData'] &&
                !filterParameters['polygon'] &&
                !filterParameters['boundary'] &&
                !filterParameters['dst'] &&
                !filterParameters['thermalModule']
            );
        },

        showInfoPopup: function () {
            if (!hideBimsInfo && bimsInfoContent) {
                $('#general-info-modal').fadeIn()
            }
        },

        zoomToDefault: function () {
            var center = this.initCenter;
            if (centerPointMap) {
                var centerArray = centerPointMap.split(',');
                for (var i in centerArray) {
                    centerArray[i] = parseFloat(centerArray[i]);
                }
                center = centerArray;
            }
            this.zoomToCoordinates(ol.proj.fromLonLat(center), this.initZoom);
        },

        updateBiodiversityLayerParams: function (query) {
            console.log('Updating biodiversity layer with query:', query);
            query = query.replaceAll(',', '\\,');
            query = query.replaceAll(';', '\\;');
            let newParams = {
                layers: locationSiteGeoserverLayer,
                format: 'image/png',
                viewparams: 'where:"' + query + '"',
                t: new Date().getTime()  // Cache buster to force new tiles from GeoServer
            };
            this.layers.biodiversitySource.updateParams(newParams);
            this.layers.biodiversitySource.refresh();  // Force refresh to fetch new tiles
            console.log('Biodiversity layer updated with new query');
        },

        clearAllLayers: function () {
            console.log('Clearing all layers');
            let newParams = {
                layers: locationSiteGeoserverLayer,
                format: 'image/png',
                viewparams: 'where:' + emptyWMSSiteParameter,
                t: new Date().getTime()
            };
            this.layers.biodiversitySource.updateParams(newParams);
            this.layers.biodiversitySource.refresh();
        },

        resetSitesLayer: function () {
            console.log('Resetting sites layer to default');
            let newParams = {
                layers: locationSiteGeoserverLayer,
                format: 'image/png',
                viewparams: 'where:' + defaultWMSSiteParameters,
                t: new Date().getTime()
            };
            this.layers.biodiversitySource.updateParams(newParams);
            this.layers.biodiversitySource.refresh();
        },

        toggleMapInteraction: function (enabled) {
            this.mapInteractionEnabled = enabled;
        },

        showTaxonDetailedDashboard: function (data) {
            this.registerDashboardEvents();
            this.taxonDetailDashboard.show(data);
        },

        showSiteDetailedDashboard: function (data) {
            this.registerDashboardEvents();
            this.siteDetailedDashboard.show(data);
        },

        closeDetailedDashboard: function () {
            this.taxonDetailDashboard.closeDashboard();
            this.siteDetailedDashboard.closeDashboard();
        },

        whenMapIsReady: function (callback) {
            var self = this;
            if (this.mapIsReady)
                callback();
            else {
                setTimeout(function () {
                    self.map.once('change:ready', self.whenMapIsReady.bind(null, callback));
                    self.whenMapIsReady(callback);
                }, 100)
            }
        },

        // NEW: Optimized download map with better resource management
        downloadMap: function () {
            var that = this;
            var downloadMap = true;

            this.registerDashboardEvents();

            that.map.once('postcompose', function (event) {
                var canvas = event.context.canvas;
                try {
                    canvas.toBlob(function (blob) {
                        // Test blob creation
                    })
                }
                catch (error) {
                    $('#error-modal').modal('show');
                    downloadMap = false
                }
            });
            that.map.renderSync();

            if (downloadMap) {
                $('#ripple-loading').show();
                $('.map-control-panel').hide();
                $('.zoom-control').hide();
                $('.bug-report-wrapper').hide();
                $('.print-map-control').addClass('control-panel-selected');

                that.whenMapIsReady(function () {
                    var canvas = document.getElementsByClassName('map-wrapper');
                    var $mapWrapper = $('.map-wrapper');
                    var divHeight = $mapWrapper.height();
                    var divWidth = $mapWrapper.width();
                    var ratio = divHeight / divWidth;

                    html2canvas(canvas, {
                        useCORS: true,
                        background: '#FFFFFF',
                        allowTaint: false,
                        onrendered: function (canvas) {
                            var link = document.createElement('a');
                            link.setAttribute("type", "hidden");
                            link.href = canvas.toDataURL("image/png");
                            link.download = 'map.png';
                            document.body.appendChild(link);
                            link.click();
                            link.remove();

                            // Restore UI
                            $('.zoom-control').show();
                            $('.map-control-panel').show();
                            $('#ripple-loading').hide();
                            $('.bug-report-wrapper').show();
                            $('.print-map-control').removeClass('control-panel-selected');
                        }
                    })
                });
            }
        },

        startTutorial: function() {
            startIntro();
        },

        // NEW: Cleanup method for better memory management
        destroy: function() {
            this.cancelActiveRequests();
            this.clearCache();

            // Remove event listeners
            if (this.map) {
                this.map.un('click');
                this.map.un('moveend');
                this.map.un('postrender');
            }

            // Clear dispatcher events
            Shared.Dispatcher.off(null, null, this);

            // Call parent destroy
            Backbone.View.prototype.destroy.call(this);
        }
    })
});
