/**
 * Search Result View
 * Handles rendering and interaction for individual search results (sites and taxa)
 */
define([
    'backbone',
    'models/search_result',
    'shared',
    'underscore',
    'jquery'
], function (Backbone, SearchResult, Shared, _, $) {
    return Backbone.View.extend({

        events: {
            'click': 'clicked'
        },

        initialize: function () {
            this.render();
        },

        /**
         * Handle click events on search results
         * Dispatches appropriate events based on result type
         */
        clicked: function (e) {
            const resultType = this.model.get('record_type');

            switch(resultType) {
                case 'taxa':
                    Shared.Dispatcher.trigger('searchResult:taxonClicked', this.model.attributes);
                    break;

                case 'site':
                    Shared.Dispatcher.trigger('searchResult:siteClicked', this.model.attributes);
                    break;

                case 'show-more-site':
                    $(e.target).parent().remove();
                    Shared.Dispatcher.trigger('search:showMoreSites');
                    break;

                case 'show-more-taxa':
                    $(e.target).parent().remove();
                    Shared.Dispatcher.trigger('search:showMoreTaxa');
                    break;
            }
        },

        /**
         * Render the search result item
         * Uses appropriate template based on result type
         */
        render: function () {
            const resultType = this.model.get('record_type');
            const config = this.getTemplateConfig(resultType);

            if (config) {
                const template = _.template($(config.template).html());
                this.$el.html(template(this.model.attributes));
                $(config.container).append(this.$el);
            }
        },

        /**
         * Get template and container configuration for a result type
         * @param {string} resultType - The type of search result
         * @returns {Object} Configuration object with template and container selectors
         */
        getTemplateConfig: function(resultType) {
            const templateMap = {
                'taxa': {
                    template: '#search-result-taxa-template',
                    container: '#taxa-list'
                },
                'site': {
                    template: '#search-result-site-template',
                    container: '#site-list'
                },
                'show-more-site': {
                    template: '#show-more-result-site-template',
                    container: '#site-list'
                },
                'show-more-taxa': {
                    template: '#show-more-result-site-template',
                    container: '#taxa-list'
                }
            };

            return templateMap[resultType];
        },

        /**
         * Clean up view and model
         */
        destroy: function () {
            this.unbind();
            this.model.destroy();
            return Backbone.View.prototype.remove.call(this);
        }
    })
});
