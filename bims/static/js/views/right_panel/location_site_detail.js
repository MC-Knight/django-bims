define(['backbone', 'ol', 'shared', 'chartJs', 'jquery'], function (Backbone, ol, Shared, ChartJs, $) {
    return Backbone.View.extend({
        id: 0,
        currentSpeciesSearchResult: [],
        siteChartData: {},
        siteId: null,
        siteName: null,
        siteDetailData: null,
        features: null,
        charts: [],
        originLegends: {},
        endemismLegends: {},
        consStatusLegends: {},
        
        // Complete protection system with extensive logging
        isLoading: false,
        requestTimeout: null,
        currentRequestId: null,
        _requestLock: false,
        _lockTimeout: null,
        _requestCount: 0,
        _lastRequestTime: 0,
        _debugMode: true, // Set to false in production if needed
        
        apiParameters: _.template(Shared.SearchURLParametersTemplate),
        months: {
            'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6,
            'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12
        },
        chartBackgroundColours: ['#8D2641', '#D7CD47', '#18A090', '#A2CE89', '#4E6440', '#525351'],
        
        log: function(message, data) {
            if (this._debugMode) {
                const timestamp = new Date().toISOString();
                console.log(`[SiteDetail ${timestamp}] ${message}`, data || '');
            }
        },
        
        logError: function(message, error) {
            const timestamp = new Date().toISOString();
            console.error(`[SiteDetail ERROR ${timestamp}] ${message}`, error);
            if (error && error.stack) {
                console.error('Stack trace:', error.stack);
            }
        },
        
        logState: function(action) {
            this.log(`STATE ${action}:`, {
                isLoading: this.isLoading,
                requestLock: this._requestLock,
                currentRequestId: this.currentRequestId,
                siteId: this.siteId,
                requestCount: this._requestCount,
                lastRequestTime: this._lastRequestTime,
                timeSinceLastRequest: Date.now() - this._lastRequestTime
            });
        },
        
        initialize: function () {            
            // Ensure only ONE instance exists globally
            if (window._globalSiteDetailView) {
                this.logError('CRITICAL: Another SiteDetailView already exists! Destroying previous instance.');
                try {
                    window._globalSiteDetailView.destroy();
                } catch (e) {
                    this.logError('Failed to destroy previous instance', e);
                }
            }
            window._globalSiteDetailView = this;
            
            // Track instance count for debugging
            if (window._siteDetailViewCount) {
                window._siteDetailViewCount++;
                this.logError(`WARNING: Multiple SiteDetailView instances! Count: ${window._siteDetailViewCount}`);
            } else {
                window._siteDetailViewCount = 1;
            }
            
            try {
                this.listenTo(Shared.Dispatcher, 'siteDetail:show', this.show);
                this.listenTo(Shared.Dispatcher, 'siteDetail:panelClosed', this.panelClosed);
                this.listenTo(Shared.Dispatcher, 'siteDetail:updateCurrentSpeciesSearchResult', this.updateCurrentSpeciesSearchResult);
            } catch (e) {
                this.logError('INITIALIZE: Failed to set up event listeners', e);
            }
        },
        
        destroy: function() {
            this.resetLoadingState('DESTROY');
            this.stopListening();
            if (this.$el) {
                this.$el.remove();
            }
            if (window._globalSiteDetailView === this) {
                window._globalSiteDetailView = null;
            }
        },
        
        resetLoadingState: function(reason) {            
            this.isLoading = false;
            this._requestLock = false;
            
            if (this.requestTimeout) {
                clearTimeout(this.requestTimeout);
                this.requestTimeout = null;
            }
            
            if (this._lockTimeout) {
                clearTimeout(this._lockTimeout);
                this._lockTimeout = null;
            }
            
            this.currentRequestId = null;
        },
        
        updateCurrentSpeciesSearchResult: function (newList) {
            this.currentSpeciesSearchResult = newList;
        },
        
        show: function (id, name, zoomToObject, addMarker) {
            const currentTime = Date.now();
            this._requestCount++;
                        
            
            // Rapid fire detection
            if (currentTime - this._lastRequestTime < 100) {
                this.logError(`RAPID FIRE DETECTED! Time diff: ${currentTime - this._lastRequestTime}ms`);
            }
            this._lastRequestTime = currentTime;
            
            // Immediate class-level lock
            if (this._requestLock) {
                return false;
            }
            this._requestLock = true;
            
            // Double-check loading state
            if (this.isLoading) {
                this._requestLock = false;
                return false;
            }
            this.isLoading = true;
            
            // Check for same site
            if (this.siteId === id && this.siteDetailData) {
                this.resetLoadingState('SAME_SITE_ALREADY_LOADED');
                return false;
            }
            
            // Check existing XHR
            if (Shared.LocationSiteDetailXHRRequest) {
                try {
                    Shared.LocationSiteDetailXHRRequest.abort();
                    Shared.LocationSiteDetailXHRRequest = null;
                } catch (e) {
                    this.logError('FAILED TO ABORT EXISTING XHR', e);
                }
            }
            
            // Generate unique request ID
            const requestId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            this.currentRequestId = requestId;
            
            // Clear any existing timeout
            if (this.requestTimeout) {
                clearTimeout(this.requestTimeout);
            }
            
            // Set timeouts with extensive logging
            this.requestTimeout = setTimeout(() => {
                if (this.currentRequestId === requestId) {
                    this.resetLoadingState('REQUEST_TIMEOUT');
                } else {
                    this.log('REQUEST TIMEOUT IGNORED - STALE REQUEST ID');
                }
            }, 10000); // Increased timeout to 10 seconds
            
            // Lock timeout failsafe
            this._lockTimeout = setTimeout(() => {
                if (this._requestLock) {
                    this.logError('LOCK TIMEOUT - FORCE RELEASING');
                    this._requestLock = false;
                }
            }, 12000); // Increased lock timeout
            
            // Set instance variables
            this.originLegends = {};
            this.endemismLegends = {};
            this.consStatusLegends = {};
            this.siteId = id;
            this.siteName = name;
            this.zoomToObject = zoomToObject;
            
            if (typeof addMarker === 'undefined' || addMarker === null) {
                this.addMarker = false;
            }
            
            this.parameters = filterParameters;
            this.parameters['siteId'] = id;
            filterParameters = $.extend(true, {}, this.parameters);
            this.url = '/api/location-site-detail/' + this.apiParameters(this.parameters);
            
            try {
                this.showDetail(name, zoomToObject, requestId);
                this.log('SHOW_DETAIL CALLED SUCCESSFULLY');
            } catch (e) {
                this.logError('SHOW_DETAIL FAILED', e);
                this.resetLoadingState('SHOW_DETAIL_ERROR');
            }
        },
        
        panelClosed: function (e) {            
            this.resetLoadingState('PANEL_CLOSED');
            this.siteDetailData = null;
            
            if (!Shared.CurrentState.SEARCH) {
                Shared.Router.updateUrl('', false);
            } else {
                filterParameters['siteIdOpen'] = '';
            }
        },
        
        showDetail: function (name, zoomToObject, requestId) {
            var self = this;
            
            
            if (this.currentRequestId !== requestId) {
                this.logError(`SHOW_DETAIL: Stale request detected! Current: ${this.currentRequestId}, Received: ${requestId}`);
                return;
            }
            
            // Direct DOM cleanup without triggering events
            try {
                // Direct DOM manipulation to avoid triggering panelClosed event
                $('.right-panel').each(function(index) {
                    if (index > 0) {
                        $(this).remove();
                        self.log(`SHOW_DETAIL: Removed duplicate right-panel ${index}`);
                    }
                });
                
                // Ensure the main panel is visible and clear its content
                $('.right-panel').show();
                $('#content-panel').empty();
                $('.right-panel-title').html('<i class="fa fa-map-marker"></i> Loading...');
                $('.right-panel-loading').show();
                
            } catch (e) {
                this.logError('SHOW_DETAIL: Error cleaning up existing panels', e);
            }
            
            // Continue immediately without timeout to avoid race conditions
            this.continueShowDetail(name, zoomToObject, requestId);
        },
        
        continueShowDetail: function(name, zoomToObject, requestId) {
            var self = this;
            
            
            if (this.currentRequestId !== requestId) {
                this.logError(`CONTINUE_SHOW_DETAIL: Stale request! Current: ${this.currentRequestId}, Received: ${requestId}`);
                return;
            }
            
            // Create wrapper content
            var $siteDetailWrapper = $('<div></div>');
            $siteDetailWrapper.append(
                '<div id="site-detail" class="search-results-wrapper">' +
                '<div class="search-results-total" data-visibility="false"> ' +
                '<span class="search-result-title"> Site Details </span> ' +
                '<i class="fa fa-angle-down pull-right filter-icon-arrow"></i></div></div>');
            $siteDetailWrapper.append(
                '<div id="biodiversity-data" class="search-results-wrapper">' +
                '<div class="search-results-total" data-visibility="false"> ' +
                '<span class="search-result-title"> Biodiversity Data </span> ' +
                '<i class="fa fa-angle-down pull-right filter-icon-arrow"></i></div></div>');
            $siteDetailWrapper.append(
                '<div id="climate-data" class="search-results-wrapper">' +
                '<div class="search-results-total" data-visibility="false"> ' +
                '<span class="search-result-title"> Climate Data </span> ' +
                '<i class="fa fa-angle-down pull-right filter-icon-arrow"></i></div></div>');
            
            try {
                if ($('.right-panel').length === 0) {
                    this.logError('CRITICAL: No right-panel found in DOM!');
                    this.resetLoadingState('NO_RIGHT_PANEL');
                    return;
                }
                
                // Ensure panel is visible and populate content
                $('.right-panel').show();
                $('#content-panel').html($siteDetailWrapper);
                $siteDetailWrapper.find('.search-results-total').click(self.hideAll);
                $siteDetailWrapper.find('.search-results-total').click();
                
                
                // Trigger dispatcher events for side panel
                Shared.Dispatcher.trigger('sidePanel:openSidePanel', {});
                Shared.Dispatcher.trigger('sidePanel:fillSidePanelHtml', $siteDetailWrapper);
                Shared.Dispatcher.trigger('sidePanel:updateSidePanelTitle', '<i class="fa fa-map-marker"></i> Loading...');
                
            } catch (e) {
                this.logError('CONTINUE_SHOW_DETAIL: Failed to setup side panel', e);
                this.resetLoadingState('PANEL_SETUP_ERROR');
                return;
            }

            // Final XHR check and abort if needed
            if (Shared.LocationSiteDetailXHRRequest) {
                try {
                    Shared.LocationSiteDetailXHRRequest.abort();
                    Shared.LocationSiteDetailXHRRequest = null;
                } catch (e) {
                    this.logError('CONTINUE_SHOW_DETAIL: Failed to abort XHR', e);
                }
            }
            
            const ajaxStartTime = Date.now();
            
            Shared.LocationSiteDetailXHRRequest = $.get({
                url: this.url,
                dataType: 'json',
                timeout: 15000, // Increased timeout
                beforeSend: function(xhr, settings) {
                    self.log('AJAX BEFORE_SEND:', settings.url);
                },
                success: function (data) {
                    const ajaxDuration = Date.now() - ajaxStartTime;
                    self.log(`AJAX SUCCESS: Duration ${ajaxDuration}ms - RequestID: ${requestId}`);
                    
                    if (self.currentRequestId !== requestId) {
                        self.logError(`AJAX SUCCESS: Ignoring stale response! Current: ${self.currentRequestId}, Response: ${requestId}`);
                        return;
                    }
                    
                    $('.right-panel-loading').hide();
                    self.log('AJAX SUCCESS: Processing response data');
                    self.resetLoadingState('AJAX_SUCCESS');
                    
                    try {
                        self.siteDetailData = data;
                        Shared.Dispatcher.trigger('sidePanel:updateSiteDetailData', self.siteDetailData);

                        if (Shared.CurrentState.SEARCH) {
                            filterParameters['siteIdOpen'] = data['id'];
                            self.log('AJAX SUCCESS: Updated filter parameters');
                        }
                        
                        let updatedUrl = Shared.UrlUtil.updateUrlParams(window.location.href, 'site', 'siteIdOpen', data['id']);
                        if (updatedUrl) {
                            Shared.Router.updateUrl(updatedUrl, false);
                            self.log('AJAX SUCCESS: Updated router URL');
                        }

                        if (data['geometry']) {
                            self.log('AJAX SUCCESS: Processing geometry data');
                            let feature = {
                                id: data['id'],
                                type: "Feature",
                                geometry: JSON.parse(data['geometry']),
                                properties: {}
                            };
                            let features = new ol.format.GeoJSON().readFeatures(feature, {
                                featureProjection: 'EPSG:3857'
                            });

                            if (zoomToObject) {
                                Shared.Dispatcher.trigger('map:switchHighlight', features, !zoomToObject);
                            } else {
                                Shared.Dispatcher.trigger('map:switchHighlight', features, true);
                            }
                            self.log('AJAX SUCCESS: Map highlight triggered');
                        }
                        
                        let sidePanelTitle = '<i class="fa fa-map-marker"></i> ' + data['site_detail_info']['site_code'];
                        if (isStaff || ( userID !== null && userID === data['owner']) ) {
                            sidePanelTitle += '<a href="/location-site-form/update/?id=' + data['id'] + '" style="float: right; padding-top: 5px">Edit</a>';
                        }
                        
                        Shared.Dispatcher.trigger('sidePanel:updateSidePanelTitle', sidePanelTitle);
                        $('.right-panel-title').html(sidePanelTitle);
                        self.log('AJAX SUCCESS: Side panel title updated');

                        self.log('AJAX SUCCESS: Starting to render components');
                        $('#site-detail').append(self.renderSiteDetailInfo(data));
                        self.renderBiodiversityDataSection($('#biodiversity-data'), data);
                        self.renderCharts();
                        self.renderLegends(self.originLegends, $('.origin-legends'));
                        self.renderLegends(self.endemismLegends, $('.endemism-legends'));
                        self.renderLegends(self.consStatusLegends, $('.cons-status-legends'));
                        self.renderClimateData(data, $('#climate-data'));
                        self.log('AJAX SUCCESS: All components rendered');

                        Shared.LocationSiteDetailXHRRequest = null;

                        if (data['site_detail_info'] && data['site_detail_info']['site_coordinates']) {
                            let siteCoordinates = data['site_detail_info']['site_coordinates'].split(',');
                            let lon = siteCoordinates[0].trim();
                            let lat = siteCoordinates[1].trim();
                            Shared.Dispatcher.trigger('layers:showFeatureInfo', lon, lat, true);
                            self.log('AJAX SUCCESS: Feature info triggered');
                        }
                        
                        self.log('AJAX SUCCESS: Complete processing finished successfully');
                        
                    } catch (e) {
                        self.logError('AJAX SUCCESS: Error during processing', e);
                        self.resetLoadingState('AJAX_SUCCESS_ERROR');
                    }
                },
                error: function (req, err) {
                    const ajaxDuration = Date.now() - ajaxStartTime;
                    self.log(`AJAX ERROR: Duration ${ajaxDuration}ms - RequestID: ${requestId}`, {
                        status: req.status, statusText: req.statusText, error: err
                    });
                    
                    $('.right-panel-loading').hide();
                    
                    if (self.currentRequestId !== requestId) {
                        self.log('AJAX ERROR: Ignoring stale error response');
                        return;
                    }
                    
                    self.resetLoadingState('AJAX_ERROR');
                    
                    if (req.statusText !== 'abort') {
                        self.logError('AJAX ERROR: Site detail loading failed', {
                            status: req.status, statusText: req.statusText, responseText: req.responseText
                        });
                        
                        let errorTitle = '<i class="fa fa-map-marker"></i> Error loading site';
                        Shared.Dispatcher.trigger('sidePanel:updateSidePanelTitle', errorTitle);
                        $('.right-panel-title').html(errorTitle);
                        
                        try {
                            Shared.Dispatcher.trigger('sidePanel:updateSidePanelHtml', {});
                            $('#content-panel').html('<div class="alert alert-danger">Failed to load site details. Please try again.</div>');
                        } catch (e) {
                            self.logError('AJAX ERROR: Failed to update side panel HTML', e);
                        }
                    } else {
                        self.log('AJAX ERROR: Request was aborted (ignored)');
                    }
                },
            });
            
        },
        
        hideAll: function (e) {
            var className = $(e.target).attr('class');
            var target = $(e.target);
            if (className === 'search-result-title') {
                target = target.parent();
            }
            if (target.data('visibility')) {
                target.find('.filter-icon-arrow').addClass('fa-angle-down').removeClass('fa-angle-up');
                target.nextAll().hide();
                target.data('visibility', false)
            } else {
                target.find('.filter-icon-arrow').addClass('fa-angle-up').removeClass('fa-angle-down');
                target.nextAll().show();
                target.data('visibility', true)
            }
        },
        
        renderPieChart: function (data, speciesType, chartName, chartCanvas) {
            if (typeof data == 'undefined') {
                return null;
            }
            
            var chartConfig = {
                type: 'pie',
                data: {
                    datasets: [{
                        data: data[speciesType][chartName + '_chart']['data'],
                        backgroundColor: this.chartBackgroundColours
                    }],
                    labels: data[speciesType][chartName + '_chart']['keys']
                },
                options: {
                    responsive: false, legend: {display: false}, title: {display: false},
                    hover: {mode: 'nearest', intersect: false}, borderWidth: 0,
                }
            };
            
            chartCanvas = this.resetCanvas(chartCanvas);
            var ctx = chartCanvas.getContext('2d');
            new ChartJs(ctx, chartConfig);

            var dataKeys = data[speciesType][chartName + '_chart']['keys'];
            var chart_labels = {};
            chart_labels[chartName] = '';
            for (var i = 0; i < dataKeys.length; i++) {
                chart_labels[chartName] += '<div><span style="color:' +
                    this.chartBackgroundColours[i] + ';">■</span>' +
                    '<span class="species-ssdd-legend-title">&nbsp;' +
                    dataKeys[i] + '</span></div>'
            }
            $(`#rp-${chartName}-legend`).html(chart_labels[chartName]);
        },
        
        renderSiteDetailInfo: function (data) {
            var $detailWrapper = $('<div></div>');
            if (data.hasOwnProperty('site_detail_info')) {
                let siteDetailsTemplate = _.template($('#site-details-template').html());
                $detailWrapper.append(siteDetailsTemplate(data));
            } else {
                this.log('RENDER_SITE_DETAIL_INFO: No site_detail_info found');
            }
            return $detailWrapper;
        },
        
        renderClimateData: function (data, containerElement) {
            if (data.hasOwnProperty('climate_data')) {
                let singleClimateDataTemplate = _.template($('#climate-data-template').html());
                for (let climateKey of Object.keys(data['climate_data'])) {
                    this.log(`RENDER_CLIMATE_DATA: Processing ${climateKey}`);
                    containerElement.append(singleClimateDataTemplate({
                        'title': data['climate_data'][climateKey]['title'],
                        'key': climateKey,
                        'data': data['climate_data'][climateKey],
                        'wrapper': climateKey + '-wrapper'
                    }))
                    this.renderMonthlyLineChart(data['climate_data'][climateKey], climateKey);
                }
            } else {
                this.log('RENDER_CLIMATE_DATA: No climate_data found');
            }
        },
        
        createDataSummary: function (data) {
            var bio_data = data['biodiversity_data'];
            this.renderPieChart(bio_data, 'fish', 'origin', document.getElementById('fish-rp-origin-pie'));
            this.renderPieChart(bio_data, 'fish', 'endemism', document.getElementById('fish-rp-endemism-pie'));
            this.renderPieChart(bio_data, 'fish', 'cons_status', document.getElementById('fish-rp-conservation-status-pie'));
        },
        
        resetCanvas: function (chartCanvas) {
            var chartParent = chartCanvas.parentElement;
            var newCanvas = document.createElement("CANVAS");
            var chartId = chartCanvas.id;
            newCanvas.id = chartId;
            chartCanvas.remove();
            chartParent.append(newCanvas);
            return document.getElementById(chartId);
        },
        
        renderMonthlyLineChart: function (climateData, canvasId) {
            let chartConfig = {
                type: 'line',
                data: {
                    datasets: [{
                        data: climateData['values'], backgroundColor: '#D7CD47',
                        borderColor: '#D7CD47', fill: false
                    }],
                    labels: climateData['keys']
                },
                options: {
                    responsive: true, legend: {display: false}, title: {display: false},
                    hover: {mode: 'point', intersect: false}, tooltips: {mode: 'point'}, borderWidth: 0,
                    scales: {
                        xAxes: [{display: true, scaleLabel: {display: false, labelString: ''}}],
                        yAxes: [{display: true, scaleLabel: {display: true, labelString: '(mm)'}}]
                    }
                }
            };
            let chartCanvas = this.resetCanvas(document.getElementById(canvasId));
            let ctx = chartCanvas.getContext('2d');
            new ChartJs(ctx, chartConfig);
        },
        
        parseNameFromAliases: function (alias, alias_type, data) {
            var name = alias;
            var choices = [];
            if (alias_type === 'cons_status') choices = this.flatten_arr(data['iucn_name_list']);
            if (alias_type === 'origin') choices = this.flatten_arr(data['origin_name_list']);
            if (choices.length > 0) {
                var index = choices.indexOf(alias) + 1;
                name = choices[index];
            }
            return name;
        },
        
        renderBiodiversityDataSection: function (container, data) {
            let self = this;
            let biodiversitySectionTemplate = _.template($('#biodiversity-data-template-new').html());
            container.append(biodiversitySectionTemplate({ 
                data: data.biodiversity_data,
                is_sass_enabled: is_sass_enabled,
                is_water_temperature_enabled: is_water_temperature_enabled,
                sass_exist: data.sass_exist, add_data: true,
                water_temperature_exist: data.water_temperature_exist,
                physico_chemical_exist: data.physico_chemical_exist,
            }));
            
            $.each(data['biodiversity_data'], function (key, value) {
                self.log(`RENDER_BIODIVERSITY: Processing module ${value.module}`);
                self.charts.push({
                    'canvas': $("#origin-chart-" + value.module),
                    'data': value['origin'], 'legends': self.originLegends
                });
                self.charts.push({
                    'canvas': $("#endemism-chart-" + value.module),
                    'data': value['endemism'], 'legends': self.endemismLegends
                });
                self.charts.push({
                    'canvas': $("#cons-chart-" + value.module),
                    'data': value['cons_status'], 'legends': self.consStatusLegends
                });
            });
            
            // Event handlers with logging
            $('.sp-open-dashboard').click(function (e) {
                self.log('SP_OPEN_DASHBOARD clicked');
                let parameters = $.extend(true, {}, filterParameters);
                const $target = $(e.target);
                if ($target.hasClass("disabled")) {
                    self.log('SP_OPEN_DASHBOARD: Target disabled, returning false');
                    return false;
                }
                parameters['modules'] = $target.data('module')
                Shared.Router.updateUrl('site-detail/' + self.apiParameters(parameters).substr(1), true);
            });
            
            $('.sp-add-record').click(function (e) {
                self.log('SP_ADD_RECORD clicked');
                const $target = $(e.target);
                if ($target.hasClass("disabled")) return false;
                
                const moduleId = $target.data('module-id');
                const moduleName = $target.data('module-name');
                let url = '#';
                
                if (moduleName.toLowerCase() === 'fish') {
                    url = '/fish-form/?siteId=' + self.siteId;
                } else if (moduleName.toLowerCase() === 'invertebrates') {
                    url = '/invert-form/?siteId=' + self.siteId;
                } else if (moduleName.toLowerCase() === 'algae') {
                    url = '/algae-form/?siteId=' + self.siteId;
                } else {
                    url = `/module-form/?siteId=${self.siteId}&module=${moduleId}`;
                }
                self.log(`SP_ADD_RECORD: Navigating to ${url}`);
                window.location = url;
            });
            
            $('.sp-sass-dashboard').click(function () {
                self.log('SP_SASS_DASHBOARD clicked');
                let sassUrl = typeof self.siteId !== 'undefined' ? '/sass/dashboard/' + self.siteId + '/' : '/sass/dashboard-multi-sites/';
                sassUrl += self.apiParameters(filterParameters);
                window.location.href = sassUrl;
            });
            
            $('.sp-add-sass').click(function () {
                self.log('SP_ADD_SASS clicked');
                window.location.href = '/sass/' + self.siteId;
            });
            
            $('.sp-add-water-temperature').click(function () {
                self.log('SP_ADD_WATER_TEMPERATURE clicked');
                window.location.href = '/water-temperature-form/?siteId=' + self.siteId;
            });
            
            $('.sp-add-physico-chemical-data').click(function () {
                self.log('SP_ADD_PHYSICO_CHEMICAL_DATA clicked');
                window.location.href = '/physico-chemical-form/?siteId=' + self.siteId;
            });
            
            $('.sp-water-temperature').click(function (e) {
                self.log('SP_WATER_TEMPERATURE clicked');
                if (typeof self.siteId !== 'undefined') {
                    let waterTemperatureUrl = '/water-temperature/' + self.siteId + '/' + self.apiParameters(filterParameters);
                    window.location.href = waterTemperatureUrl;
                }
            });
            
            $('.sp-physico-chemical').click(function (e) {
                self.log('SP_PHYSICO_CHEMICAL clicked');
                let url = '/physico-chemical/' + self.siteId + '/' + self.apiParameters(filterParameters);
                window.location.href = url;
            });
        },
        
        flatten_arr: function (arr) {
            let self = this;
            return arr.reduce(function (flat, toFlatten) {
                return flat.concat(Array.isArray(toFlatten) ? self.flatten_arr(toFlatten) : toFlatten);
            }, []);
        },
        
        renderCharts: function () {
            let self = this;
            $.each(this.charts, function (index, chart) {
                if (chart['data'].length > 0) {
                    self.log(`RENDER_CHARTS: Processing chart ${index}`);
                    self.createPieChart(chart);
                }
            });
        },
        
        createPieChart: function (chartData) {
            let self = this;
            let labels = [];
            let dataset = [];
            let colours = [];
            let data = chartData['data'];
            let chartCanvas = chartData['canvas'];
            let legends = chartData['legends'];
            
            $.each(data, function (key, value) {
                labels.push(value['name']);
                dataset.push(value['count']);

                if (legends.hasOwnProperty(value['name'])) {
                    colours.push(legends[value['name']]);
                } else {
                    let length = Object.keys(legends).length;
                    colours.push(self.chartBackgroundColours[length]);
                    legends[value['name']] = self.chartBackgroundColours[length];
                }
            });

            let chartConfig = {
                type: 'pie',
                data: {
                    datasets: [{data: dataset, backgroundColor: colours}],
                    labels: labels
                },
                options: {
                    responsive: false, legend: {display: false}, title: {display: false},
                    hover: {mode: 'nearest', intersect: false}, borderWidth: 0,
                }
            };
            
            let ctx = chartCanvas[0].getContext('2d');
            new ChartJs(ctx, chartConfig);
        },
        
        renderLegends: function (legends, container) {
            $.each(legends, function (key, value) {
                container.append('<div><span style="color:' + value + ';">■</span>' +
                    '<span style="font-style: italic;">' + key + '</span></div>');
            });
        },
    })
});