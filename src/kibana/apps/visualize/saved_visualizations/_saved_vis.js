define(function (require) {
  var _ = require('lodash');
  var inherits = require('utils/inherits');

  var configCats = require('apps/visualize/saved_visualizations/_config_categories');
  var typeDefs = require('apps/visualize/saved_visualizations/_type_defs');

  var module = require('modules').get('app/visualize');

  module.factory('SavedVis', function (config, $injector, courier, indexPatterns, Promise, savedSearches, Private) {
    var aggs = Private(require('apps/visualize/saved_visualizations/_aggs'));

    function SavedVis(opts) {
      var vis = this;
      opts = opts || {};

      if (typeof opts !== 'object') {
        opts = {
          id: opts
        };
      }

      var defaultParent = opts.parentSearchSource;

      courier.SavedObject.call(vis, {
        type: 'visualization',

        id: opts.id,

        mapping: {
          title: 'string',
          typeName: 'string',
          stateJSON: 'string',
          description: 'string',
          savedSearchId: 'string',
          indexPattern: 'string'
        },

        defaults: {
          title: '',
          typeName: opts.type || 'histogram',
          stateJSON: null,
          description: '',
          savedSearchId: opts.savedSearchId,
          indexPattern: opts.indexPattern
        },

        searchSource: true,

        afterESResp: function setVisState() {
          if (!vis.typeDef || vis.typeName !== vis.typeDef.name) {
            // refresh the typeDef
            vis.typeDef = typeDefs.byName[vis.typeName];
            // refresh the defaults for all config categories
            configCats.forEach(function (category) {
              vis._initConfigCategory(category, vis[category.name]);
            });
          }

          // get the saved state
          var state;
          if (vis.stateJSON) try { state = JSON.parse(vis.stateJSON); } catch (e) {}

          // set the state on the vis
          if (state) vis.setState(state);

          var relatedSearch = vis.savedSearchId;
          var relatedPattern = !relatedSearch && vis.indexPattern;

          var promisedParent = (function () {
            if (relatedSearch) {
              // returns a promise
              return savedSearches.get(vis.savedSearchId);
            }

            var fakeSavedSearch = {
              searchSource: courier.createSource('search')
            };

            if (relatedPattern) {
              return indexPatterns.get(relatedPattern)
              .then(function (indexPattern) {
                fakeSavedSearch.searchSource.index(indexPattern);
                return fakeSavedSearch;
              });
            }

            return Promise.resolve(fakeSavedSearch);

          }());

          return promisedParent
          .then(function (parent) {
            vis.savedSearch = parent;

            vis.searchSource
              .inherits(parent.searchSource)
              .size(0)
              // reads the vis' config and write the agg to the searchSource
              .aggs(function () {
                // stores the config objects in queryDsl
                var dsl = {};
                // counter to ensure unique agg names
                var i = 0;
                // start at the root, but the current will move
                var current = dsl;

                // continue to nest the aggs under each other
                // writes to the dsl object
                vis.getConfig().forEach(function (config) {
                  current.aggs = {};
                  var key = '_agg_' + (i++);

                  var aggDsl = {};
                  aggDsl[config.agg] = config.aggParams;

                  current = current.aggs[key] = aggDsl;
                });

                // set the dsl to the searchSource
                return dsl.aggs || {};
              });

            vis._fillConfigsToMinimum();

            _.assign(vis, vis.typeDef.listeners);

            return vis;
          });
        }
      });

      vis.addConfig = function (categoryName) {
        var category = configCats.byName[categoryName];
        var config = _.defaults({}, category.configDefaults);

        vis[category.name].configs.push(config);

        return config;
      };

      vis.removeConfig = function (config) {
        if (!config) return;
        configCats.forEach(function (category) {
          _.pull(vis[category.name].configs, config);
        });
      };

      vis._fillConfigsToMinimum = function () {

        // satify the min count for each category
        configCats.fetchOrder.forEach(function (category) {
          var myCat = vis[category.name];

          if (myCat.configs.length < myCat.min) {
            _.times(myCat.min - myCat.configs.length, function () {
              vis.addConfig(category.name);
            });
          }
        });
      };

      // init the config category, optionally pass in an existing category to refresh
      // it's defaults based on the
      vis._initConfigCategory = function (category, cat) {
        cat = cat || {};

        if (vis.typeDef) _.assign(cat, category, vis.typeDef.config[category.name]);
        cat.configDefaults = _.clone(category.configDefaults),
        cat.configs = cat.config || [];

        vis[category.name] = cat;

        return cat;
      };

      vis.setState = function (state) {
        configCats.forEach(function (category) {
          var categoryStates = state[category.name] || [];
          vis[category.name].configs.splice(0);
          categoryStates.forEach(function (configState) {
            var config = vis.addConfig(category.name);
            _.assign(config, configState);
          });
        });

        vis._fillConfigsToMinimum();
      };

      vis.getState = function () {
        return _.transform(configCats, function (state, category) {
          var configs = state[category.name] = [];

          [].push.apply(configs, vis[category.name].configs.map(function (config) {
            return _.pick(config, function (val, key) {
              return key.substring(0, 2) !== '$$';
            });
          }));
        }, {});
      };

      /**
       * Create a list of config objects, which are ready to be turned into aggregations,
       * in the order which they should be executed.
       *
       * @return {Array} - The list of config objects
       */
      vis.getConfig = Private(require('apps/visualize/saved_visualizations/_read_config'));
      /**
       * Transform an ES Response into data for this visualization
       * @param  {object} resp The elasticsearch response
       * @return {array} An array of flattened response rows
       */
      vis.buildChartDataFromResponse = Private(require('apps/visualize/saved_visualizations/_build_chart_data'));
    }
    inherits(SavedVis, courier.SavedObject);

    return SavedVis;
  });
});
