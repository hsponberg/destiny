/**
 * sessionAuth
 *
 * @module      :: Policy
 * @description :: Simple policy to allow any authenticated user
 *                 Assumes that your login action in one of your controllers sets `req.session.authenticated = true;`
 * @docs        :: http://sailsjs.org/#!documentation/policies
 *
 */
module.exports = function(req, res, next) {

  // Proceed to the next policy, 
  // or if this is the last policy, the controller
  if (sails.config.environment === 'development') {
    return next();
  }

  return res.notFound();
};
