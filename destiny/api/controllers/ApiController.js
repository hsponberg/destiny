/**
 * ApiController
 *
 * @description :: Server-side logic for managing Apis
 * @help        :: See http://links.sailsjs.org/docs/controllers
 */

var ProcessRequest = require("../../hs/ProcessRequest");
var fs = require("fs");

module.exports = {

	request : function(req, res) {

		var i = req.path.indexOf("/api/");
		if (i != 0) {
			return res.serverError("Server error, path doesn't start with api");
		}

		var path = req.path.substring(4); // Remove /api

		var testAuthorized = false;
		var testAuthToken = req.headers["destiny-test-auth"];
		if (testAuthToken) {
			if (testAuthToken !== sails.config.destiny.testAuthToken) {
				var delay = Math.random() * 3000;
				setTimeout(function() {
					return res.send(403);
				}, delay);
				return;
			}
			testAuthorized = true;
		}

		var sources = sails._destiny.findEndpointFromPath(path, testAuthorized);

		if (!sources) {
			return res.notFound();
		}

		if (sources.mockVersion) {
			sources.findMock = findMock;
		}

		if (testAuthorized) {

			sources.testConfig = {};

			var x = 1;
			var testConfig = req.headers["destiny-test-" + x++];
			while (testConfig !== undefined) {
				testConfig = JSON.parse(testConfig);
				if (testConfig.mock === undefined) {
					return response.badRequest(testConfig.depend + " has no mock specific");
				}
				sources.testConfig[testConfig.depend.toUpperCase()] = testConfig;
				delete sources.testConfig[testConfig.depend.toUpperCase()].depend;
				testConfig = req.headers["destiny-test-" + x++];
			}
		}

		if (sources.mocks && sources.mockVersion == "dev") {
			respondWithMock(req, res, sources);
		} else {
			// Production
			new ProcessRequest(req, res).processRequest(sources);
		}
	},

	endpoints : function(req, res) {

		var list = [];

		var restParamMap = {};

		var v = "dev";

		listEndpointsRecursive(sails._destiny.versions[v].routeMap, '', list, restParamMap);

		list.sort(compareByPath);

		var result = {};
		result.list = list;
		result.restParamMap = restParamMap;

		res.ok(result);
	},

	dependPoints : function(req, res) {

		var list = [];

		var depends = sails._destiny.dependencies.list("dev");
		for (var k in depends) {
			var d = {};
			d.path = depends[k].toLowerCase();
			
			var mocksMap = findMocksRecursive(sails._destiny.mockDependencies.routeMap["dev"], [depends[k]], 0, "_mocks");
			var mocks = [];
			for (var m in mocksMap) {
				mocks.push({ name: m, type: mocksMap[m].type});
			}
			d.mocks = mocks;

			var intMap = findMocksRecursive(sails._destiny.dependInterceptors.routeMap, [depends[k]], 0, "_interceptors");
			var interceptors = [];
			for (var m in intMap) {
				interceptors.push({ name: m, type: intMap[m].type});
			}
			d.dependInterceptors = interceptors;

			list.push(d);
		}

		list.sort(compareByPath);

		res.ok(list);
	},

	putMock : function(req, res) {

		var mock = req.param("mock");

		createOrUpdateAndRespond(res, mock);
	},
	
	dependPointEnvironments : function(req, res) {

		var list = [];
		for (k in sails._destiny.versions["dev"].endPoints) {
			if (k == "production") {
				continue;
			}
			list.push(k);
		}
		var env = {
			selected: sails._destiny.dependPointsEnvironment,
			list: list
		};

		return res.ok(env);
	},

	putDependPointEnvironment : function(req, res) {

		var env = req.param("env");

		sails._destiny.dependPointsEnvironment = env;

		return res.ok();
	},

};

function respondWithMock(req, res, sources) {

	sources.findMock = findMock;

	var criteria = { keypath: sources.mockVersion + ":" + sources.path };

	Mock.findOne(criteria, function(err, result) {
		if (err) {
			return res.serverError(err);
		} else if (result) {
			
			if (result.mock == -1) {
				return new ProcessRequest(req, res).processRequest(sources);
			}

			var mock = sources.mocks[result.mock];
			if (mock) {
				new ProcessRequest(req, res).mockRequest(mock, result, sources.path);
			} else {
				return res.badRequest("No mock " + result.mock);
			}
		} else {
			new ProcessRequest(req, res).processRequest(sources);
		}
	});
}

function findMock(keyPathArray, cb) {

	var criteria = { keypath: keyPathArray };

	Mock.find(criteria, function(err, results) {
		if (err) {
			return cb(err);
		} else {
			var mocks = {};
			for (r in results) {
				if (results[r].keypath.indexOf('int/') != -1) {
					mocks.interceptor = results[r];
				} else {
					mocks.mock = results[r];
				}
			}
			cb(undefined, mocks);
		}
	});
}

function listEndpointsRecursive(obj, path, list, restParamMap) {

	for (k in obj._files) {
		if (k == "_endPoints") {
			continue;
		}
		var filePath = path + '/' + k;
		if (k == "$" && obj.restParamName !== undefined) {
			var basePath = restParamMap[path];
			if (basePath === undefined) {
				basePath = filePath;
			} else {
				basePath += '/$';
			}
			restParamMap[filePath] = basePath + obj.restParamName;
		}
		var mocksMap = findMocksRecursive(sails._destiny.mock.routeMap, filePath.split('/'), 1, '_mocks');
		var mocks = [];
		for (var m in mocksMap) {
			mocks.push({ name: m, type: mocksMap[m].type});
		}
		var endpoint = {};
		endpoint.path = filePath;
		endpoint.mocks = mocks;
		list.push(endpoint);
	}

	for (k in obj) {
		var filePath = path + '/' + k;
		if (k == "$" && obj.restParamName !== undefined) {
			var basePath = restParamMap[path];
			if (basePath === undefined) {
				basePath = filePath;
			} else {
				basePath += '/$';
			}
			restParamMap[filePath] = basePath + obj.restParamName;
		}
		if (k == '_files' || k == "restParamName") {
			continue;
		}
		listEndpointsRecursive(obj[k], filePath, list, restParamMap);
	}
}

function findMocksRecursive(obj, tokens, i, param) { // param = _mocks
	if (obj == null) {
		return undefined;
	} else if (i == tokens.length) {
		return obj[param];
	} else {
		return findMocksRecursive(obj[tokens[i]], tokens, i + 1, param);
	}
}

function compareByPath(a, b) {
	return a.path.localeCompare(b.path);
}

function createOrUpdateAndRespond(res, mock) {

	var criteria = { keypath: mock.keypath };

	Mock.findOne(criteria, function(err, result) {
		if (err) {
			return res.serverError(err);
		} else {

			if (result) {

				Mock.update(criteria, mock, function(err) {
					if (err) {
						return res.serverError(err);
					} else {
						return res.ok();
					}
				});
			} else {

				Mock.create(mock, function(err) {
					if (err) {
						return res.serverError(err);
					} else {
						return res.ok();
					}
				});
			}
		}
	});	
}
