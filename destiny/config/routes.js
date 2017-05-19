/**
 * Route Mappings
 * (sails.config.routes)
 *
 * Your routes map URLs to views and controllers.
 *
 * If Sails receives a URL that doesn't match any of the routes below,
 * it will check for matching files (images, scripts, stylesheets, etc.)
 * in your assets directory.  e.g. `http://localhost:1337/images/foo.jpg`
 * might match an image file: `/assets/images/foo.jpg`
 *
 * Finally, if those don't match either, the default 404 handler is triggered.
 * See `api/responses/notFound.js` to adjust your app's 404 logic.
 *
 * Note: Sails doesn't ACTUALLY serve stuff from `assets`-- the default Gruntfile in Sails copies
 * flat files from `assets` to `.tmp/public`.  This allows you to do things like compile LESS or
 * CoffeeScript for the front-end.
 *
 * For more information on configuring custom routes, check out:
 * http://sailsjs.org/#/documentation/concepts/Routes/RouteTargetSyntax.html
 */

module.exports.routes = {

  /***************************************************************************
  *                                                                          *
  * Make the view located at `views/homepage.ejs` (or `views/homepage.jade`, *
  * etc. depending on your default view engine) your home page.              *
  *                                                                          *
  * (Alternatively, remove this and add an `index.html` file in your         *
  * `assets` directory)                                                      *
  *                                                                          *
  ***************************************************************************/

  '/api/apiadmin': {
    policy: 'isDev',
    view: 'homepage',
    locals: {
      layout: 'layout'
    }
  },
  '/api/apiadmin/features': {
    policy: 'isDev',
    view: 'features',
    locals: {
      layout: 'layout'
    }
  },
  '/api/endpoints' : {
    policy: 'isDev',
    controller: 'ApiController',
    action: 'endpoints'
  },
  '/api/dependPoints' : {
    policy: 'isDev',
    controller: 'ApiController',
    action: 'dependPoints'
  },
  '/api/dependPointEnvironments' : {
    policy: 'isDev',
    controller: 'ApiController',
    action: 'dependPointEnvironments'
  },
  '/api/features' : {
    policy: 'isDev',
    controller: 'ApiController',
    action: 'features'
  },
  'PUT /api/mock' : {
    policy: 'isDev',
    controller: 'ApiController',
    action: 'putMock'
  },
  'GET /api/mock' : {
    policy: 'isDev',
    controller: 'MockController',
    action: 'find'
  },
  'PUT /api/dependPointEnvironment' : {
    policy: 'isDev',
    controller: 'ApiController',
    action: 'putDependPointEnvironment'
  },
  'PUT /api/feature' : {
    policy: 'isDev',
    controller: 'ApiController',
    action: 'putFeature'
  },
  '/api/status': {
    response: 'ok'
  },
  '/health/pool.txt': {
    controller: 'ApiController',
    action: 'healthPool'
  },
  '/api/*' : {
    controller: 'ApiController',
    action: 'request',
    skipAssets: true,
    skipRegex: /^\/mock$/
  },

  /***************************************************************************
  *                                                                          *
  * Custom routes here...                                                    *
  *                                                                          *
  *  If a request to a URL doesn't match any of the custom routes above, it  *
  * is matched against Sails route blueprints. See `config/blueprints.js`    *
  * for configuration options and examples.                                  *
  *                                                                          *
  ***************************************************************************/

};
