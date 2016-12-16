/**
 * Bootstrap
 * (sails.config.bootstrap)
 *
 * An asynchronous bootstrap function that runs before your Sails app gets lifted.
 * This gives you an opportunity to set up your data model, run jobs, or perform some special logic.
 *
 * For more information on bootstrapping your app, check out:
 * http://sailsjs.org/#/documentation/reference/sails.config/sails.config.bootstrap.html
 */

var fs = require("fs");
var path = require('path');
var chokidar = require('chokidar');
var Redis = require('ioredis');
var bunyan = require('bunyan');

module.exports.bootstrap = function(cb) {

	var destiny = {
		redis: {
			enabled: false
		}
	};
	sails._destiny = destiny;

	destiny.versions = {};
	destiny.findEndpointFromPath = findEndpointFromPath;
	destiny.versionToMaxMinorVersion = {};
	destiny.versionToMaxBugVersion = {};
	destiny.maxVersionKey = 0;
	destiny.globals = {};

	var env = sails.config.dependEnvironment === undefined ? "production" : sails.config.dependEnvironment;
	destiny.dependPointsEnvironment = env;

	if (sails.config.destiny.appName === undefined) {
		throw "Must define appName in env js";
	}

	var date = new Date();
	var dateformat = "-" + date.getFullYear() + (date.getMonth() + 1) + date.getDate() + "-" + date.getTime();

	var logFile = sails.config.destiny.httpLog.file;
	if (sails.config.destiny.httpLog.fileInsertDate) {
		logFile += dateformat;
	}
	if (sails.config.destiny.httpLog.fileInsertProcessId) {
		logFile += '_' + process.pid;		
	}
	logFile += '.' + sails.config.destiny.httpLog.fileExtension;

	destiny.httpLog = bunyan.createLogger( { 
		name: sails.config.destiny.appName,
		streams: [
		    {
		    	path: path.resolve(sails.config.destiny.repo, logFile)
		    }
		  ]
	} );

	createDependencyMap();

	buildRouteMaps();

	loadResources();

	var chokidarWatch = [];
	if (sails.config.destiny.publishDev) {
		
		buildRouteMap();

		var devPath = sails.config.destiny.repo + '/endpoints';
		var mockPath = sails.config.destiny.repo + '/endpointsMocks';
		var mockDependenciesPath = sails.config.destiny.repo + '/dependMocks';
		var dependsInterceptorsPath = sails.config.destiny.repo + '/dependInterceptors';
		chokidarWatch = chokidarWatch.concat([devPath, mockPath, mockDependenciesPath, dependsInterceptorsPath]);
	}

	if (chokidarWatch.length > 0) {
		chokidar.watch(chokidarWatch, 
			{ ignoreInitial: true })
		.on('all', (event, path) => {
			buildRouteMap();
		});
	}

	var outputPath = path.join(sails.config.destiny.repo, ".tmp");
	chokidar.watch(['lastModified.txt'], { cwd: outputPath, awaitWriteFinish: true, ignoreInitial: true })
	.on('all', (event, path) => {
		buildRouteMaps();
	});

	parseDestinyConfig(destiny);

	cb();
};

function buildRouteMaps() {

	for (var k in sails._destiny.versions) {
		if (k == "dev") {
			continue;
		}
		delete sails._destiny.versions[k];
	}

	var s = new Date().getTime();

	var endpointPath = path.join(sails.config.destiny.repo, ".tmp");
	fs.readdirSync(endpointPath).filter(function(file) {
		if (!fs.statSync(path.join(endpointPath, file)).isDirectory()) {
			return;
		}
		var isStaging = file.indexOf("s") == 0;
		if (isStaging && sails.config.destiny.publishStaging !== true) {
			return;
		}
		var versionPath = path.join(endpointPath, file);
		if (isStaging) {
			file = file.substring(1);
		}
		versionKey = getVersionKey("v" + file, !isStaging);
		if (isStaging) {
			sails._destiny.stagingVersionKey = versionKey;
		}
		buildVersionRouteMap(versionKey, path.join(versionPath, "endpoints"));
		if (sails.config.destiny.enableReleaseTesting) {
			buildDependencyMap(versionKey);
			buildDependencyMockMap(versionKey, path.join(versionPath, "dependMocks"));
		}
	});
	var e = new Date().getTime();
	console.log("Reloaded versions files in " + (e - s) + " millis");
}

function buildRouteMap() {
	var s = new Date().getTime();
	buildVersionRouteMap("dev", sails.config.destiny.repo + '/endpoints');
	buildMockMap(sails.config.destiny.repo + '/endpointsMocks');
	buildDependencyMap("dev");
	buildDependencyMockMap("dev", sails.config.destiny.repo + '/dependMocks');
	buildDependencyInterceptorsMap(sails.config.destiny.repo + '/dependInterceptors');
	var e = new Date().getTime();
	console.log("Reloaded dev files in " + (e - s) + " millis");
}

function findEndpointFromPath(path, testAuthorized) {

	// First try absolute path
	// Second, assume restful, alternating between resource and id

	var destiny = sails._destiny;

	var tokens = path.split('/');
	var v = tokens[1];

	var versionKey = getVersionKey(v);

	var version = destiny.versions[versionKey];

	if (!version) {
		return undefined;
	}

	var tokenStartI = 2;
	var ids = [];
	var path = [];
	var idMap = {};
	var currentEndpoint = findEndpointRecursive(destiny.versions[versionKey].routeMap, tokens, tokenStartI, path, ids, idMap);

	if (!currentEndpoint) {
		return undefined;
	}

	var sources = {};
	sources.endPoints = destiny.versions[versionKey].endPoints[destiny.dependPointsEnvironment] + '';
	sources.currentEndpoint = currentEndpoint;
	sources.path = makePath(path, 0);
	sources.idPath = ids;
	sources.idMap = idMap;
	sources.globals = destiny.globals[versionKey];
	sources.resources = destiny.resources;
	sources.mocks = undefined;
	sources.mockVersion = undefined;
	sources.version = versionKey;

	if (sails.config.destiny.publishDev && v == "dev") {

		// mocks and interceptors from the local database

		sources.mocks = findMocksRecursive(destiny.mock.routeMap, tokens, tokenStartI);
		sources.mockVersion = "dev";
	}

	return sources;
}

function makePath(tokens, i) {
	var path = '';
	for (; i < tokens.length; i++) {
		path += '/' + tokens[i];
	}
	return path;
}

function findEndpointRecursive(obj, tokens, i, path, ids, idMap) {
	if (obj == null) {
		return undefined;
	} else if (i == tokens.length - 1) {
		if (obj._files[tokens[i]] === undefined && obj._files["$"] !== undefined) {
			path.push("$");
			var restId = asNumOrStr(tokens[i]);
			ids.push(restId);
			if (obj.restParamName) {
				idMap[obj.restParamName] = restId;
			}
			return obj._files["$"];
		} else {
			path.push(tokens[i]);
			return obj._files[tokens[i]];
		}
	} else {
		if (obj[tokens[i]] === undefined && obj["$"] !== undefined) {
			path.push("$");
			var restId = asNumOrStr(tokens[i]);
			ids.push(restId);
			if (obj.restParamName) {
				idMap[obj.restParamName] = restId;
			}
			return findEndpointRecursive(obj["$"], tokens, i + 1, path, ids, idMap);			
		} else {
			path.push(tokens[i]);
			return findEndpointRecursive(obj[tokens[i]], tokens, i + 1, path, ids, idMap);			
		}
	}
}

function asNumOrStr(val) {
	if (isNaN(val)) {
		return val;
	} else {
		return +val;
	}
}

function buildVersionRouteMap(v, versionPath) {

	var destiny = sails._destiny;

	destiny.versions[v] = {};
	destiny.versions[v].endPoints = findEndpointEnvironments(v, versionPath);
	destiny.versions[v].routeMap = {}; // Key for each folder, _files has map of files to content
	destiny.versions[v].routeMap._files = {};

	buildMapRecursive(versionPath, destiny.versions[v].routeMap);

	loadGlobals(v, versionPath);
}

function buildMapRecursive(versionPath, obj) {

	fs.readdirSync(versionPath).filter(function(file) {
		if (file.indexOf(".") == 0) {
			return;
		} else if (file.indexOf("_") == 0) {
			return;
		} else if (fs.statSync(path.join(versionPath, file)).isDirectory()) {

			var filePath = file;

			var restParamName = undefined;
			var wI = file.indexOf('$');
			if (wI !== -1) {
				restParamName = file.substring(wI + 1);
				if (restParamName === '') {
					restParamName = undefined;
				}
			}

			if (file.indexOf("$") > 0 && file.length > 1) { // contains $ and is not just $ (doesn't start with $)
				
				var newObj = getOrCreateIdGroup(obj, file);

				if (restParamName !== undefined) {
					newObj.restParamName = restParamName;
				}

				file = "$";

				var newObj2 = {};
				newObj2._files = {};
				newObj[file] = newObj2;
				buildMapRecursive(path.join(versionPath, filePath), newObj2);
			} else {

				if (file.indexOf("$") === 0) {
					if (restParamName !== undefined) {
						obj.restParamName = restParamName;
					}					
					file = "$";
				}

				var newObj = {};
				newObj._files = {};
				obj[file] = newObj;
				buildMapRecursive(path.join(versionPath, filePath), newObj);							
			}
		} else {
			var filePath = file;
			var i = file.indexOf('.js'); // Remove .js
			file = file.substring(0, i);

			var restParamName = undefined;
			var wI = file.indexOf('$');
			if (wI !== -1) {
				restParamName = file.substring(wI + 1);
				if (restParamName === '') {
					restParamName = undefined;
				}
			}

			if (file.indexOf("$") > 0 && file.length > 1) { // contains $ and is not just $ (doesn't start with $)
				
				var newObj = getOrCreateIdGroup(obj, file);

				if (restParamName !== undefined) {
					newObj.restParamName = restParamName;
				}

				newObj._files['$'] = {
					filename: filePath,
					content: fs.readFileSync(path.join(versionPath, filePath))
				};
			} else {

				if (file.indexOf("$") === 0) {
					if (restParamName !== undefined) {
						obj.restParamName = restParamName;
					}					
					file = "$";
				}

				obj._files[file.substring(0, i)] = {
					filename: filePath,
					content: fs.readFileSync(path.join(versionPath, filePath))
				}
			}
		}
	});
}

function findEndpointEnvironments(v, versionPath) {

	var globalPath = path.join(versionPath, "_global");

	var endpoints = {};

	endpoints.production = fs.readFileSync(path.join(versionPath, "_global", "dependPoints.js"));

	if (v != "dev") {
		return endpoints;
	}

	fs.readdirSync(globalPath).filter(function(file) {

		if (!file.startsWith("dependPoints") || file == "dependPoints.js") {
			return;
		}

		var i = file.indexOf('.');
		var i2 = file.indexOf('.', i + 1);
		if (i2 == -1 || file.indexOf('.js') != i2) {
			return;
		}
		var environment = file.substring(i + 1, i2);

		endpoints[environment] = fs.readFileSync(path.join(globalPath, file));
	});		

	return endpoints;
}

function buildMockMap(versionPath) {

	var destiny = sails._destiny;

	destiny.mock = {};
	destiny.mock.routeMap = {}; // Key for each folder, _files has map of mocks to content
	destiny.mock.routeMap._mocks = {};

	buildMockMapRecursive(versionPath, destiny.mock.routeMap, "mock", "_mocks", ["json", "js"]);
}

function buildDependencyMockMap(version, versionPath) {

	var destiny = sails._destiny;

	// TODO change mockDependencies to dependMocks
	if (destiny.mockDependencies === undefined) {
		destiny.mockDependencies = {};		
	}
	if (destiny.mockDependencies.routeMap === undefined) {
		destiny.mockDependencies.routeMap = {}; // Key for each folder, _mocks has map of mocks to content		
	}
	var obj = destiny.mockDependencies.routeMap[version] = {};
	obj._mocks = {};

	buildMockMapRecursive(versionPath, obj, "mock", "_mocks", ["json", "js"]);
}

function buildDependencyInterceptorsMap(versionPath) {

	var destiny = sails._destiny;

	destiny.dependInterceptors = {};
	destiny.dependInterceptors.routeMap = {}; // Key for each folder, _files has map of mocks to content
	destiny.dependInterceptors.routeMap._interceptors = {};

	buildMockMapRecursive(versionPath, destiny.dependInterceptors.routeMap, "int", "_interceptors", ["js"]);
}

function buildMockMapRecursive(versionPath, obj, folderExt, prop, allowedFileTypes) { // folderExt = "mock", prop = _mocks

	fs.readdirSync(versionPath).filter(function(file) {
		if (file.indexOf(".") == 0) {
			return;
		} else if (file.indexOf("_") == 0) {
			return;
		}
		var fileStat = fs.statSync(path.join(versionPath, file));
		if (!fileStat.isDirectory()) {
			return;
		}
		var i = file.indexOf('.'); // Remove .mock or .int
		var pathName = file;
		if (i != -1) {
			pathName = file.substring(0, i);
		}
		var o = obj[pathName];
		if (!o) {
			o = {};
			o[prop] = {};
			obj[pathName] = o;
		}
		if (file.endsWith('.' + folderExt)) {
			addMockFiles(path.join(versionPath, file), o, prop, allowedFileTypes);
		} else {
			buildMockMapRecursive(path.join(versionPath, file), o, folderExt, prop, allowedFileTypes);			
		}
	});
}

function addMockFiles(dir, obj, prop, allowedFileTypes) {
	fs.readdirSync(dir).filter(function(file) {
		if (file.indexOf(".") == 0) {
			return;
		} else if (file.indexOf("_") == 0) {
			return;
		} else if (!isFileAllowedType(file, allowedFileTypes)) {
			return;
		}
		var type;
		if (file.endsWith(".json")) {
			type = "json";
		} else if (file.endsWith(".js")) {
			type = "js";
		} else {
			throw "not supported";
		}
		var fileStat = fs.statSync(path.join(dir, file));
		if (fileStat.isDirectory()) {
			return;
		}
		var i = file.indexOf('.'); // Remove .json
		var buf = fs.readFileSync(path.join(dir, file));
		obj[prop][file] = { content: buf, type: type, filename: file };
	});
}

function isFileAllowedType(file, allowedFileTypes) {
	var i = file.lastIndexOf('.');
	if (i == -1) {
		return false;
	}
	i = allowedFileTypes.indexOf(file.substring(i + 1));
	return i != -1;
}

function findMocksRecursive(obj, tokens, i) {
	if (obj == null) {
		return undefined;
	} else if (i == tokens.length) {
		return obj._mocks;
	} else {
		if (obj[tokens[i]] === undefined && obj["$"] !== undefined) {
			return findMocksRecursive(obj["$"], tokens, i + 1);	
		} else {
			return findMocksRecursive(obj[tokens[i]], tokens, i + 1);			
		}
	}
}

function createDependencyMap() {

	var destiny = sails._destiny;

	var dpMap = {
		_urlToParameter: {
		},
		_dependPointEnvMap: {
		},
		findParameter : function(version, endpoint) {
			if (destiny.dependPointsEnvironment === "production") {
				return this._urlToParameter[version][endpoint];
			} else {
				var prodEndpoint = this._dependPointEnvMap[version][destiny.dependPointsEnvironment][endpoint];
				return this._urlToParameter[version][prodEndpoint];
			}
		},
		mocksMap : function(version, endpoint) {
			var key = this.findParameter(version, endpoint);
			var routeMap = sails._destiny.mockDependencies.routeMap[version][key];
			if (routeMap !== undefined) {
				return routeMap._mocks;
			} else {
				return undefined;
			}
		},
		interceptorsMap : function(version, endpoint) {
			if (version != "dev") {
				throw "May only call interceptorsMap with 'dev' version";
			}
			var key = this.findParameter(version, endpoint);
			var routeMap = sails._destiny.dependInterceptors.routeMap[key];
			if (routeMap !== undefined) {
				return routeMap._interceptors;
			} else {
				return undefined;
			}
		},
		list : function(version) {
			return this._urlToParameter[version];
		}
	};

	sails._destiny.dependencies = dpMap;
}

function buildDependencyMap(version) {

	var dpMap = sails._destiny.dependencies;
	dpMap._urlToParameter[version] = {};
	dpMap._dependPointEnvMap[version] = {};

	var destiny = sails._destiny;

	var endPoints = destiny.versions[version].endPoints.production + '';

	var lines = endPoints.split('\n');

	var tmpParameterToUrl = {};

	for (var i in lines) {
		var line = lines[i].trim();
		if (line == '') {
			continue;
		}
		var eqIndex = line.indexOf("=");
		if (eqIndex == -1) {
			continue;
		}
		var parameter = line.substring(0, eqIndex).trim();
		var n = parameter.split(" ");
    	parameter = n[n.length - 1];
		
		// Remove quotes and semicolon
    	var url = line.substring(eqIndex + 1).trim();
    	url = url.substring(1);
    	url = url.substring(0, url.length - 2);
    	
    	dpMap._urlToParameter[version][url] = parameter;

    	tmpParameterToUrl[parameter] = url;
	}

	// For other endpoint environments, map the url to the production url
	for (var env in destiny.versions[version].endPoints) {

		if (env == "production") {
			continue;
		}

		dpMap._dependPointEnvMap[version][env] = {};

		var endPoints = destiny.versions[version].endPoints[env] + '';

		var lines = endPoints.split('\n');

		for (var i in lines) {
			var line = lines[i].trim();
			if (line == '') {
				continue;
			}
			var eqIndex = line.indexOf("=");
			if (eqIndex == -1) {
				continue;
			}
			var parameter = line.substring(0, eqIndex).trim();
			var n = parameter.split(" ");
	    	parameter = n[n.length - 1];
			
			// Remove quotes and semicolon
	    	var url = line.substring(eqIndex + 1).trim();
	    	url = url.substring(1);
	    	url = url.substring(0, url.length - 2);
	    	
	    	dpMap._dependPointEnvMap[version][env][url] = tmpParameterToUrl[parameter];
		}		
	}
}

function getVersionKey(name, buildVersionToMaxBugVersion) {

	buildVersionToMaxBugVersion = buildVersionToMaxBugVersion === undefined ? false : buildVersionToMaxBugVersion;

	if (name == "dev") {
		return name;
	} else if (name == "test") {
		if (sails.config.destiny.publishDev) {
			return "dev";
		} else if (sails._destiny.stagingVersionKey) {
			return sails._destiny.stagingVersionKey;
		} else {
			return sails._destiny.maxVersionKey;
		}
	} else if (name.indexOf("v") != 0) {
		return undefined;
	}

	var tokens = name.substring(1).split(".");

	var keyInt = 0;
	if (tokens.length > 0) {
		keyInt += tokens[0] * 1000000;
	} else {
		return undefined;
	}
	var versionWithoutMinor = keyInt;
	if (tokens.length > 1) {
		keyInt += tokens[1] * 1000;
	} else {
		var maxVersion = sails._destiny.versionToMaxMinorVersion[versionWithoutMinor];
		if (maxVersion) {
			keyInt = maxVersion;
		}		
	}
	var versionWithoutBug = keyInt;
	if (tokens.length > 2) {
		keyInt += tokens[2];
	} else if (tokens.length == 2) {
		var maxVersion = sails._destiny.versionToMaxBugVersion[versionWithoutBug];
		if (maxVersion) {
			keyInt = maxVersion;
		}
	}

	if (buildVersionToMaxBugVersion) {
		var maxVersion = sails._destiny.versionToMaxBugVersion[versionWithoutBug];
		if (!maxVersion || maxVersion < keyInt) {
			sails._destiny.versionToMaxBugVersion[versionWithoutBug] = keyInt;
		}
		maxVersion = sails._destiny.versionToMaxMinorVersion[versionWithoutMinor];
		if (!maxVersion || maxVersion < keyInt) {
			sails._destiny.versionToMaxMinorVersion[versionWithoutMinor] = keyInt;
		}
	}

	if (sails._destiny.maxVersionKey < keyInt) {
		sails._destiny.maxVersionKey = keyInt;
	}

	return keyInt;
}

function getOrCreateIdGroup(obj, file) {

	var origFile = file;

	var i = file.indexOf('$');

	file = file.substring(0, i);

	var exists = obj[file];
	if (exists !== undefined) {
		return exists;
	}

	var newObj = {};
	newObj._files = {};
	obj[file] = newObj;
	return newObj;
}

function printRouteMap(obj, tab) {

	var tabs = '';
	for (var i = 0; i < tab; i++) {
		tabs += '\t';
	}

	for (var i in obj._files) {
		console.log(tabs + i);
	}

	for (var i in obj) {
		if (i == '_files') {
			continue;
		}
		console.log(tabs + i + " [Dir]");
		printRouteMap(obj[i], tab + 1);
	}
}

function printMockRouteMap(obj, tab) {

	var tabs = '';
	for (var i = 0; i < tab; i++) {
		tabs += '\t';
	}

	for (var i in obj._mocks) {
		console.log(tabs + i);
	}

	for (var i in obj) {
		if (i == '_mocks') {
			continue;
		}
		console.log(tabs + i + " [Dir]");
		printMockRouteMap(obj[i], tab + 1);
	}
}

function loadGlobals(v, versionPath) {

	sails._destiny.globals[v] = {};

	fs.readdirSync(path.join(versionPath, "_global")).filter(function(file) {
		var filePath = path.join(versionPath, "_global", file);
		if (file.startsWith("dependPoints.") ||
			fs.statSync(filePath).isDirectory()) {
			return;
		}
		var g = require(path.resolve(filePath));
		i = file.indexOf('.js');
		var key = file.substring(0, i);
		sails._destiny.globals[v][key] = g;
	});	
}

function loadResources() {

	sails._destiny.resources = {};

	var resourcesExists = false;
	try {
	    stats = fs.lstatSync(path.join(sails.config.destiny.repo, "resources"));
	    if (stats.isDirectory()) {
	        resourcesExists = true;
	    }
	} catch (e) {}

	if (!resourcesExists) {
		return;
	}

	loadResourcesHelper('');
}

function loadResourcesHelper(dirPath) {

	var basePath = path.join(sails.config.destiny.repo, "resources", dirPath);

	fs.readdirSync(basePath).filter(function(file) {
		var filePath = path.join(basePath, file);
		if (fs.statSync(filePath).isDirectory()) {
			var prefix = dirPath === '' ? '' : dirPath + '/';
			loadResourcesHelper(prefix + file);
		} else {
			var data = fs.readFileSync(filePath);
			var key = dirPath === '' ? file : dirPath + '/' + file;
			sails._destiny.resources[key] = data;
		}
	});
}

function parseDestinyConfig(destiny) {

	if (sails.config.destiny === undefined) {
		return;
	}

	var redisConfig = sails.config.destiny.redisOutputCache;
	if (redisConfig &&
		redisConfig.enabled == true) {

		destiny.redis.enabled = true;

		destiny.redis.client = new Redis.Cluster([redisConfig.connectionOptions],
			{
				keyPrefix: redisConfig.keyPrefix,
				redisOptions: {
					keyPrefix: redisConfig.keyPrefix,
				},
				enableOfflineQueue: false,
				clusterRetryStrategy: function (times) {
				  var delay = Math.pow(2, times) * 50;
				  delay = Math.min(delay, 15000);
				  return delay;
				}
			});

		destiny.redis.client.on('error', function (channel, message) {
			var obj = {
				meta: {
					channel: channel,
					message: message
				}
			}
			console.log(obj);
			sails._destiny.httpLog.error(obj, 'Redis Error');
		});
	}
}
