/**
* Mock.js
*
* @description :: TODO: You might write a short summary of how this model works and what it represents here.
* @docs        :: http://sailsjs.org/#!documentation/models
*/

module.exports = {

  attributes: {

    keypath : { type: 'string', primaryKey: true, unique: true }, // version:path ; version is 'dev' or 'staging'

    mock : { type: 'string', required: false },

    statusCode : { type: 'integer', required: true, defaultsTo: 200 },

    latency: { type: 'integer', required: true, defaultsTo: 0 },

  }
};

