/**
 * Development environment settings
 *
 * This file can include shared settings for a development team,
 * such as API keys or remote database passwords.  If you're using
 * a version control solution for your Sails app, this file will
 * be committed to your repository unless you add it to your .gitignore
 * file.  If your repository will be publicly viewable, don't add
 * any private information to this file!
 *
 */

module.exports = {

  /***************************************************************************
   * Set the default database connection for models in the development       *
   * environment (see config/connections.js and config/models.js )           *
   ***************************************************************************/

  // models: {
  //   connection: 'someMongodbServer'
  // }


   port: 8081,

  /***************************************************************************
   * Set the log level in production environment to "silent"                 *
   ***************************************************************************/

  models: {
    connection: 'localDiskDb',
     migrate: 'alter'
   },  

  publishDev: true, // Publishes /dev and makes dev mocks available

  appName: 'SampleApi',

  destiny: {

    httpLogFile: 'logs/http.json',
    durationWarningLimit: 400, // millis
  }

  // In local.js, specify:
  //repo: "../path-to-repo",
  //apiLogLevel: {
  //  default: 3, // 0 = debug, 1 = info, 2 = warn, 3 = error, 4 = off
  //  destiny: 3,
  //  customTag: 0,
  //},
};
