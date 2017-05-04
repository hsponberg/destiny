var vm = require("vm");
var http = require('http');
var https = require('https');
var querystring = require('querystring');
var util = require('util');
var apiUtil = require('../hs/Util');
var uuid = require('uuid');
var path = require('path');
var fs = require('fs');

var responseCacheKey = undefined;

var clientCacheKeyPrefix = "_client:";

function ProcessRequest(req, res) {

	this.req = req;
	this.res = res;

	var log = this.initLog();
	log._level = (sails.config.destiny.apiLogLevel === undefined) ? { default: log._kLevelOff } : sails.config.destiny.apiLogLevel;
	log._httpAppLoggingThreshold = (sails.config.destiny.httpLog.appLoggingThreshold === undefined) ?  log._kLevelError : sails.config.destiny.httpLog.appLoggingThreshold;

	this.LOG = log;	
}
module.exports = ProcessRequest;

ProcessRequest.prototype.processRequest = function(source) {

	this.startTime = Date.now();
	this.source = source;

	this.workflow = this.initWorkflow(this);
	this.workflow._idPath = source.idPath;
	this.workflow._idMap = source.idMap;

	this.context = this.initContext(this.LOG);
	this.findMock = source.findMock;
	this.testConfig = source.testConfig;

	vm.runInContext(source.endPoints, this.context);

	var self = this;
	//this.safe(function() {
	// Don't run in safe context because we won't get the error message stack trace
	var endpoint = source.currentEndpoint;
	vm.runInContext(endpoint.content, self.context, { filename: endpoint.filename, displayErrors: true, lineOffset: 0, columnOffset: 0 });
	//});

	if (this.context.input === undefined) {
		return this.renderError("server", "var input is missing in " + endpoint.filename);
	} else if (this.context.output === undefined) {
		return this.renderError("server", "var output is missing in " + endpoint.filename);
	} else {
		if (this.context.output.type === undefined) {
			this.context.output.type = "object;"
		} else if (!(	this.context.output.type === "raw" ||
						this.context.output.type === "string" ||
						this.context.output.type === "array" ||
						this.context.output.type === "object") ) {
			return this.renderError("server_error", "var output type is not valid in " + endpoint.filename);
		}
	}

	if (this.context.destiny_config === undefined) {
		this.context.destiny_config = {};
	}

	this.processHttpHeaderParameters();

	this.processMiddleware();
}

ProcessRequest.prototype.processRequestAfterMiddleware = function(source) {

	if (this.processInput(this.req)) {
		this.workflow.req.headers = this.req.headers;
		this.workflow.req.method = this.req.method;

		var cacheResponseDuration = this.context.destiny_config.cache_response_duration;
		if (sails._destiny.redis.enabled && cacheResponseDuration >= 0) {
			this.makeResponseCacheKey();
			this.checkCache();
		} else {
			this.callEndpointRequest();
		}
	}
}

ProcessRequest.prototype.processMiddleware = function() {

	var middleware = [];
	for (var i in this.context.destiny_config.middleware) {
		middleware.push(this.context.destiny_config.middleware[i]);
	}
	this.processMiddlewareHelper(middleware);
}

ProcessRequest.prototype.processMiddlewareHelper = function(middleware) {

	if (middleware.length === 0) {
		return this.processRequestAfterMiddleware();
	}

	var self = this;

	var name = middleware.shift();
	var module = this.source.middleware[name];
	module.request(this.req, this.workflow, this.context, function() {

		if (self.workflow.hasError()) {
			return self.renderResponse();
		}

		self.processMiddlewareHelper(middleware);
	});
}

ProcessRequest.prototype.processHttpHeaderParameters = function() {

	this.workflow.outputHeader('X-Powered-By', 'Destiny');

	// generator supports:
	// static - static value provided after :
	// guid - generate a guid
	// ip - client's ip address
	// forward - forwards from the http request header
	// forward-else-guid - forwards if exists in the http request header, else guid from above
	// forward-else-ip - forwards if exists, else ip from above

	for (var i in sails.config.destiny.httpHeaderParameters) {

		var val = undefined;

		var hp = sails.config.destiny.httpHeaderParameters[i];
		if (hp.generator.indexOf("static:") === 0) {
			val = hp.generator.substring(7).trim();
		} else if (hp.generator.indexOf("forward") === 0) {
			val = this.req.headers[hp.name.toLowerCase()];
		}
		if (val === undefined) {
			if (hp.generator.indexOf('guid') >= 0) {
				val = uuid.v4();
			} else if (hp.generator.indexOf('ip') >= 0) {
				val = this.req.ip;
			}
		}

		if (val === undefined) {
			continue;
		}
		if (hp.returnInResponse) {
			this.workflow.outputHeader(hp.name, val);
		} else {
			this.workflow._outputHeadersNotInResponse[hp.name] = val;
		}
	}
}

ProcessRequest.prototype.callEndpointRequest = function() {
	var self = this;
	this.safe(this.source.currentEndpoint, "request()", function() {
		self.LOG.debug("destiny.request", "Request for {0}: {1}", self.req.baseUrl, self.req.originalUrl);
		self.context._request(self.workflow.req, self.workflow); 
	});
	this.renderResponseIfReady();
}

ProcessRequest.prototype.makeResponseCacheKey = function() {

	// ECMAScript 6 guarantees object properties are traversed in the order they are added
	// Destiny appends parameters in the order specified in the endpoint
	// querystring creates the string in the traversal order of the object
	// Therefore, we do not need to sort the parameters here
	var s = querystring.stringify(this.workflow.req.params); 

	// this.req.url contains the url path with restful ids
	// ie. /api/v1.0.0/race/raceevent/7
	this.responseCacheKey = this.req.url + '?' + s;
}

ProcessRequest.prototype.checkCache = function() {
	var self = this;
	sails._destiny.redis.client.get(self.responseCacheKey, function(err, reply) {
	    if (!err && reply) {
	    	// Cache hit
	    	var object = JSON.parse(reply);
	    	for (var i in object.outputHeaders) {
	    		if (self.workflow._outputHeaders[i] === undefined) {
	    			self.workflow._outputHeaders[i] = object.outputHeaders[i];
	    		}
	    	}
	    	self.workflow._output = object.output;
	    	self.renderResponse(true);
	    } else {
	    	// Cache miss
	    	self.callEndpointRequest();
	    }
	});
}

ProcessRequest.prototype.mockRequest = function(mock, result, path, currentEndpoint) {

	var self = this;

	var content;

	if (mock.type == "js") {
		var filename = currentEndpoint.replace("endpoints", "endpointsMocks");
		// cut off 'js' ending and replace it with mock/
		filename = filename.substring(0, filename.length - 2) + "mock/" + mock.filename;
		var context = this.initJsMockContext(this.LOG, filename);

		var loaded = self.safe(mock.filename, 'load', function() {
			vm.runInContext(mock.content, context, { filename: filename, displayErrors: true, lineOffset: 0, columnOffset: 0 });
		});

		if (!loaded) {
			return;
		}

		self.safe(mock.filename, 'getResults("' + path + '")', function() { 
			content = context.getResults(self.req.allParams(), result);
		});
	} else {

		content = JSON.parse(mock.content);
	}						

	setTimeout(function() {
		if (result.headers) {
			self.res.set(result.headers);
		}
		self.res.send(result.statusCode, content);
	}, result.latency);
}

ProcessRequest.prototype.safe = function(endpoint, method, func) {

	try {

		func();
		return true;
	} catch (err) {

		if (this.LOG._level['destiny'] <= this.LOG._kLevelError) {

			var lineForFileI = 1;

			if (err.errorTag = 'destiny') {
				lineForFileI = 2;
			}

			var trace = err.stack.split('\n');

			var i = trace[lineForFileI].lastIndexOf('(');
			var lineNumberI = trace[lineForFileI].indexOf(':', i);
			var columnNumberI = trace[lineForFileI].indexOf(':', lineNumberI + 1);
			var i2 = trace[lineForFileI].indexOf(')', columnNumberI);

			var lineOfCode;
			if (trace[lineForFileI].substring(i + 1, lineNumberI) != "vm.js") {

				var lineNumber = trace[lineForFileI].substring(lineNumberI + 1, columnNumberI);
				var columnNumber = trace[lineForFileI].substring(columnNumberI + 1, i2);

				lineOfCode = String(endpoint.content).split('\n')[lineNumber - 1]

				if (!lineOfCode) {
					// Something went wrong with framework code
					this.LOG.error("destiny", trace);

					this.logHttpError('Server Error', {
						trace: trace
					});
					return this.renderError("server", "server framework error");
				}

				lineOfCode = lineOfCode.trim();
			}

			this.LOG.error("destiny", trace[0]);
			this.LOG.error("destiny", "\tat {0} {1}", lineOfCode, trace[lineForFileI].substring(i, i2 + 1));
			this.LOG.error("destiny", "\tin {0}.{1}", endpoint.filename, method);

			this.logHttpError('Server Error', {
				trace: trace[0] + "\n\tat " + lineOfCode + " " + trace[lineForFileI].substring(i, i2 + 1) + '\n\t' + endpoint.filename + '.' + method
			});			
		}

		return this.renderError("server", "server error");
	}
}

ProcessRequest.prototype.makeCall = function(endpointProcessId, endpoint, spec) {

	var self = this;

	var makeRealCall = function() {
		return self.makeRealCall(endpointProcessId, endpoint, spec);
	};

	var mockKeyPaths = [];

	var key;

	if (this.testConfig) {

		key = sails._destiny.dependencies.findParameter(self.source.version, endpoint);

		self.workflow._callMocks[endpointProcessId] = {}; // no interceptor allowed in testing

		var testConfig = this.testConfig[endpointProcessId.toUpperCase()];
		if (!testConfig) {
			testConfig = this.testConfig[key];
		}
		// If no testConfig then make real call
		if (testConfig) {
			var results = {};
			results.mock = {};
			results.mock.mock = testConfig.mock;
			results.mock.latency = (testConfig.latency === undefined) ? 0 : testConfig.latency;
			results.mock.statusCode = (testConfig.status === undefined) ? 200 : testConfig.status;
			if (testConfig.headers) {
				results.mock.headers = testConfig.headers;
			}
			return this.makeMockOrRealCall(endpointProcessId, endpoint, spec, key, results.mock, makeRealCall);
		} else if (this.testConfig.mockOnly) {
			self.LOG.warn("destiny", "mock not found for " + key + " and mock only mode is enabled");
			return self.renderError("server", "mock not found for " + key + " and mock only mode is enabled");
		}
	} else if (this.findMock) {

		if (self.source.version !== "dev") {
			throw "findMock should not be available outside of dev";
		}

		key = sails._destiny.dependencies.findParameter(self.source.version, endpoint);

		var findDependMock = sails._destiny.dependencies && sails._destiny.dependencies.mocksMap(self.source.version, endpoint) !== undefined;
		if (findDependMock) {
			mockKeyPaths.push(this.source.mockVersion + ":" + key.toLowerCase());
		}

		var findDependIntercept = sails._destiny.dependencies && sails._destiny.dependencies.interceptorsMap(self.source.version, endpoint) !== undefined;
		if (findDependIntercept) {
			mockKeyPaths.push(this.source.mockVersion + ":int/" + key.toLowerCase());
		}
	}

	if (mockKeyPaths.length == 0) {
		return makeRealCall();
	}

	this.findMock(mockKeyPaths, function(err, results) {
		
		if (err) {
			self.LOG.warn("destiny", err);
			return self.renderError("server", "server error (2)");
		}

		self.workflow._callMocks[endpointProcessId] = results;

		if (!results.mock || results.mock.mock == -1) {
			return makeRealCall();
		}

		self.makeMockOrRealCall(endpointProcessId, endpoint, spec, key, results.mock, makeRealCall);
	});
}

ProcessRequest.prototype.makeMockOrRealCall = function(endpointProcessId, endpoint, spec, key, resultsMock, makeRealCall) {

	var self = this;

	var mocksMap = sails._destiny.mockDependencies.routeMap[self.source.version][key]._mocks;

	var mock = resultsMock === undefined ? undefined : mocksMap[resultsMock.mock];
	if (!mock && resultsMock !== undefined) {
		return self.renderError("server", "No mock " + resultsMock.mock);
	}

	if (mock) {
		if (mock.type == "js") {
			return self.respondWithJsMock(endpointProcessId, endpoint, spec, mock, resultsMock);
		} else if (mock.type == "raw") {
			return self.respondWithMock(endpointProcessId, endpoint, spec, String(mock.content), resultsMock.latency, resultsMock.statusCode, resultsMock.headers);
		} else {
			var content = JSON.parse(mock.content);
			return self.respondWithMock(endpointProcessId, endpoint, spec, content, resultsMock.latency, resultsMock.statusCode, resultsMock.headers);
		}					
	} else {
		return makeRealCall();
	}
}

ProcessRequest.prototype.makeCallCacheGet = function(key) {

	var self = this;

	var redisKey = clientCacheKeyPrefix + key;

	if (!sails._destiny.redis.enabled) {
		process.nextTick(function() {
			self.safe(self.source.currentEndpoint, 'cacheGetException("' + key + '")', function() { 
				self.processCacheGetExceptionHelper(key);
			});
		});
	} else {
		sails._destiny.redis.client.get(redisKey, function(err, reply) {
		    if (!err && reply) {
		    	// Cache hit
		    	self.safe(self.source.currentEndpoint, 'cacheGetResults("' + key + '")', function() { 
					self.processCacheGetResultsHelper(key, reply);
				});
		    } else {
		    	// Cache miss
		    	self.safe(self.source.currentEndpoint, 'cacheGetException("' + key + '")', function() { 
					self.processCacheGetExceptionHelper(key);
				});	    	
		    }
		});			
	}
}

ProcessRequest.prototype.makeCallCachePut = function(key, value, expirationInSeconds) {

	if (!sails._destiny.redis.enabled) {
		return;
	}

	if (expirationInSeconds === undefined) {
		expirationInSeconds = 0;
	}

	var self = this;

	var redisKey = clientCacheKeyPrefix + key;

	if (expirationInSeconds > 0) {
		sails._destiny.redis.client.setex(redisKey, expirationInSeconds, value);
	} else {
		sails._destiny.redis.client.set(redisKey, value);
	}
}

ProcessRequest.prototype.makeRealCall = function(endpointProcessId, endpoint, spec) {

	this.workflow._callsInProgressMeta[endpointProcessId].startTime = Date.now();

	var saveEndpoint = endpoint;

	var self = this;

	var isHttps = endpoint.indexOf("https") == 0;

	var slashI = endpoint.indexOf("://");
	endpoint = endpoint.substring(slashI + 3);

	slashI = endpoint.indexOf("/");
	var host;
	var path;
	if (slashI != -1) {
		host = endpoint.substring(0, slashI);
		path = endpoint.substring(slashI);
	}

	var port;
	var colonI = host.indexOf(':');
	if (colonI > 0) {
		port = host.substring(colonI + 1);
		host = host.substring(0, colonI);
	} else {
		port = (isHttps) ? 443 : 80;
	}

	var restParamI = 0;
	var sINext = 0;
	var sI = path.indexOf("$");
	while (sI != -1) {
		if (path.indexOf("$" + restParamI, sINext) != sI) {
			var err = "Invalid dependency URI with rest parameter in " + path + " " + restParamI;
			err += " restIds: ";
			err += JSON.stringify(spec.restIds, true, 2);
			return self.renderError("server", "Invalid dependency URI with rest parameter",
				err);
		}
		var restId = spec.restIds[restParamI];
		if (restId === undefined) {
			var err = "No rest id for index " + restParamI + " in " + endpoint;
			return self.renderError("server", "No rest id", err);				
		}
		var s = restParamI + '';
		sINext = sI + 1 + s.length;
		path = path.substring(0, sI) + restId + path.substring(sINext);
		sI = path.indexOf("$", sINext);
		restParamI++;
	}

	if (!spec.method) {
		spec.method = "GET";
	}

	var headers = {};

	for (var i in sails.config.destiny.httpHeaderParameters) {
		var hp = sails.config.destiny.httpHeaderParameters[i];
		if (hp.forwardToDepends === true) {
			var val;
			if (hp.returnInResponse) {
				val = this.workflow._outputHeaders[hp.name];
			} else {
				val = this.workflow._outputHeadersNotInResponse[hp.name];
			}
			if (val !== undefined) {
				headers[hp.name] = val;
			}
		}
	}

	for (var i in spec.headers) {
		if (spec.headers[i] !== undefined) {
			headers[i] = spec.headers[i];
		} else {
			delete headers[i];
		}
	}

	var options = {
	    host: host,
	    port: port,
	    path: path,
	    method: spec.method,
	    headers: headers
	};

	var query = querystring.stringify(spec.params);
	if (options.method.toLowerCase() == "post") {

		var contentType = 'application/x-www-form-urlencoded';
		if (spec.bodyEncoding == 'application/json') {
		  contentType = 'application/json';
		  query = JSON.stringify(spec.params);
		}

		options.headers['Content-Type'] = contentType;
		options.headers['Content-Length'] = Buffer.byteLength(query);
	} else if (query !== '') {
		var sep = options.path.indexOf('?') != -1 ? '&' : '?';
		options.path = options.path + sep + query;
	}

	var protocol = isHttps ? https : http;

	self.LOG.debug("destiny", "calling {0}{1}", options.host, options.path);

	var req = protocol.request(options, function(res) {

		var body = '';

		res.setEncoding('utf8');
		res.on('data', function(chunk) {
			body += chunk;
		});
		res.on('end', function() {

			if (!self.shouldProcess(endpointProcessId)) {
				return;
			}

			if (spec.expectsJson === undefined || spec.expectsJson == true) {
				try {
					body = JSON.parse(body);						
				} catch (Error) {
					// Ignore - not a json response
				}
			}
			var status = {};
			status.code = res.statusCode;
			status.headers = res.headers;

			if (status.code >= 200 && status.code < 300) {
				self.processResults(endpointProcessId, saveEndpoint, status, body, spec, host + path);
			} else {
				self.processNotOk(endpointProcessId, status.code, undefined, body, spec.allowError, host + path);
			}
		});
	});
	req.on('error', function(error) {
		if (!self.shouldProcess(endpointProcessId)) {
			return;
		}
		self.processNotOk(endpointProcessId, 0, error, undefined, spec.allowError, host + path);
	});
	if (options.method.toLowerCase() == "post") {
		req.write(query);
	} else {
		req.write('');
	}
	req.end();

	if (spec.timeout > 0) {
		setTimeout(function() {
			if (self.shouldProcess(endpointProcessId)) {
				req.abort();
				self.safe(self.source.currentEndpoint, 'exception("' + endpointProcessId + '")', function() { 
					self.processTimeout(endpointProcessId, spec.allowTimeout, spec.timeout, options.host + options.path);
				});					
			}
		}, spec.timeout);
	}
}

ProcessRequest.prototype.respondWithMock = function(endpointProcessId, endpoint, spec, mock, latency, statusCode, headers, type) {

	this.workflow._callsInProgressMeta[endpointProcessId].startTime = Date.now();

	type = (type === undefined) ? '' : type;

	var self = this;

	self.LOG.debug("destiny", "mocking {0}{1}", type, endpoint);

	process.nextTick(function() {
		setTimeout(function() {
			if (!self.shouldProcess(endpointProcessId)) {
				return;
			}
			// Process if it didn't time out
			if (self.workflow._callsInProgress[endpointProcessId]) {

				var status = {};
				status.code = statusCode;
				status.headers = headers;

				if (statusCode >= 200 && statusCode < 300) {
					self.processResults(endpointProcessId, endpoint, status, mock, spec, type + endpoint);
				} else {
					self.processNotOk(endpointProcessId, status.code, undefined, mock, spec.allowError, type + endpoint);
				}
			}
		}, latency);
	});	
	if (spec.timeout > 0) {
		setTimeout(function() {
			if (self.shouldProcess(endpointProcessId)) {
				self.safe(self.source.currentEndpoint, 'exception("' + endpointProcessId + '")', function() { 
					self.processTimeout(endpointProcessId, spec.allowTimeout, spec.timeout, type + endpoint);
				});
			}
		}, spec.timeout);
	}		
}

ProcessRequest.prototype.respondWithJsMock = function(endpointProcessId, endpoint, spec, mock, resultsMock) {

	var key = sails._destiny.dependencies.findParameter(this.source.version, endpoint);
	var filename = "/dependMocks/" + key + ".mock/" + mock.filename;
	var context = this.initJsMockContext(this.LOG, filename);

	var self = this;

	var loaded = self.safe(mock.filename, 'load', function() {
		vm.runInContext(mock.content, context, { filename: filename, displayErrors: true, lineOffset: 0, columnOffset: 0 });
	});

	if (!loaded) {
		return;
	}

	var content;
	self.safe(mock.filename, 'getResults("' + endpointProcessId + '")', function() { 
		content = context.getResults(spec.params, resultsMock);
	});

	return self.respondWithMock(endpointProcessId, endpoint, spec, content, resultsMock.latency, resultsMock.statusCode, resultsMock.headers, '[JS] ');
}

ProcessRequest.prototype.interceptResults = function(mockResult, mock, endpointProcessId, spec, status, response) {

	var context = this.initInterceptContext(this.LOG);

	var self = this;

	var loaded = self.safe(mock.filename, 'load', function() { 
		vm.runInContext(mock.content, context, { filename: mock.filename, displayErrors: true, lineOffset: 0, columnOffset: 0 });
	});

	if (!loaded) {
		return;
	}

	if (!self.shouldProcess(endpointProcessId)) {
		return;
	}

	self.safe(mock.filename, 'interceptResults("' + endpointProcessId + '")', function() { 
		context._interceptResults(spec.params, status, response);
	});

	if (mockResult.statusCode >= 200 && mockResult.statusCode < 300) {
		self.safe(self.source.currentEndpoint, 'results("' + endpointProcessId + '")', function() { 
			self.processResultsHelper(endpointProcessId, mockResult.statusCode, response);
		});
	} else {
		self.safe(self.source.currentEndpoint, 'exception("' + endpointProcessId + '")', function() { 
			self.processNotOkHelper(endpointProcessId, mockResult.statusCode, undefined, response, spec.allowError);
		});
	}
};

ProcessRequest.prototype.setCallEndTime = function(endpointProcessId, dependUrl, timedOut) {
	if (this.workflow._callsInProgressMeta[endpointProcessId].endTime === undefined) {
		this.workflow._callsInProgressMeta[endpointProcessId].endTime = Date.now();		
		this.workflow._callsInProgressMeta[endpointProcessId].dependUrl = dependUrl;
		if (timedOut) {
			this.workflow._callsInProgressMeta[endpointProcessId].timedOut = true;
		}
	}
}

ProcessRequest.prototype.processResults = function(endpointProcessId, endpoint, status, response, spec, dependUrl) {

	var self = this;

	self.setCallEndTime(endpointProcessId, dependUrl);

	var processResults = function() {
		self.safe(self.source.currentEndpoint, 'results("' + endpointProcessId + '")', function() { 
			self.processResultsHelper(endpointProcessId, status, response);
		});
		self.workflow._callsInProgress[endpointProcessId] = false;
	};

	var mockResult;
	if (self.workflow._callMocks[endpointProcessId]) {
		mockResult = self.workflow._callMocks[endpointProcessId].interceptor;
	}

	if (this.findMock && mockResult && mockResult.mock != -1) {

		if (self.source.version !== "dev") {
			throw "findMock should only be provided in dev";
		}

		var key = sails._destiny.dependencies.findParameter(self.source.version, endpoint);
		var mocksMap = sails._destiny.dependInterceptors.routeMap[key]._interceptors;

		var mock = mockResult.mock === undefined ? undefined : mocksMap[mockResult.mock];
		if (!mock && mockResult.mock !== undefined) {
			return self.renderError("server", "No mock " + mockResult.mock);
		}

		if (mock) {

			setTimeout(function() {
				self.interceptResults(mockResult, mock, endpointProcessId, spec, status, response);
			}, mockResult.latency);
		} else {

			processResults();
		}
	} else {

		processResults();
	}
}

ProcessRequest.prototype.processResultsHelper = function(endpointProcessId, status, response) {

    this.LOG.debug("destiny.dependResult", "Result for {0}: {1}", endpointProcessId, response);
	this.context._processResultsMap[endpointProcessId](status, response, this.workflow);
	this.workflow._callsInProgress[endpointProcessId] = false;
	this.renderResponseIfReady();
}

ProcessRequest.prototype.processCacheGetResultsHelper = function(key, value) {

	this.context._processCacheGetResultsMap[key](value, this.workflow);
	this.workflow._cacheCallsInProgress[key] = false;
	this.renderResponseIfReady();
}

ProcessRequest.prototype.processTimeout = function(endpointProcessId, allowTimeout, timeout, dependUrl) {

	var self = this;

	self.setCallEndTime(endpointProcessId, dependUrl, true);

	this.logHttpError('Dependpoint timed out', {
		dependUrl: dependUrl,
		dependTimeout: timeout
	});	

	self.safe(self.source.currentEndpoint, 'exception("' + endpointProcessId + '")', function() { 
		self.processTimeoutHelper(endpointProcessId, allowTimeout);
	});					
	this.workflow._callsInProgress[endpointProcessId] = false;
}

ProcessRequest.prototype.processTimeoutHelper = function(endpointProcessId, allowTimeout) {

    this.LOG.debug("destiny.processException", "timeout for: {0}.", endpointProcessId);
	if (this.context._processExceptionMap[endpointProcessId]) {
		var status = {};
		status.code = 0;
		status.timedOut = true;
		this.context._processExceptionMap[endpointProcessId](status, undefined, this.workflow);
	} else if (!allowTimeout) {
		this.LOG.info("destiny", "request timed out: {0}", endpointProcessId);
		this.workflow._error = { error: "timeout", msg: "request timed out" };
	} else {
		// Ignore
	}

	this.workflow._callsInProgress[endpointProcessId] = false;
	this.renderResponseIfReady();
}

ProcessRequest.prototype.processNotOk = function(endpointProcessId, code, error, response, allowError, dependUrl) {

	var self = this;

	self.setCallEndTime(endpointProcessId, dependUrl); 

	this.logHttpError('Dependpoint not ok', {
		dependUrl: dependUrl,
		code: code,
		error: error
	});	

	self.safe(self.source.currentEndpoint, 'exception("' + endpointProcessId + '")', function() { 
		self.processNotOkHelper(endpointProcessId, code, error, response, allowError);
	});
	this.workflow._callsInProgress[endpointProcessId] = false;
}

ProcessRequest.prototype.processNotOkHelper = function(endpointProcessId, code, error, response, allowError) {

    this.LOG.debug("destiny.processException", "request error for: {0}. {1} {2} response: {3}", endpointProcessId, code, error, response);
	if (this.context._processExceptionMap[endpointProcessId]) {
		var status = {};
		status.code = code;
		status.error = error;
		this.context._processExceptionMap[endpointProcessId](status, response, this.workflow);
	} else if (!allowError) {
		this.workflow._error = { error: "error", msg: "request error for: " + endpointProcessId };
	} else {
		// Ignore
	}

	this.workflow._callsInProgress[endpointProcessId] = false;
	this.renderResponseIfReady();
}

ProcessRequest.prototype.processCacheGetExceptionHelper = function(key) {

	this.context._processCacheGetExceptionMap[key](this.workflow);
	this.workflow._cacheCallsInProgress[key] = false;
	this.renderResponseIfReady();
}

ProcessRequest.prototype.renderResponseIfReady = function() {
	if (this.workflow.hasError()) {
		return this.renderResponse();
	}
	for (var k in this.workflow._callsInProgress) {
		if (this.workflow._callsInProgress[k]) {
			return;
		}
	}
	for (var k in this.workflow._cacheCallsInProgress) {
		if (this.workflow._cacheCallsInProgress[k]) {
			return;
		}
	}
	this.workflow._finalizing = true;
	var self = this;
	if (this.context._finalize) {
		this.safe(this.source.currentEndpoint, 'finalize()', function() { 
			self.context._finalize(self.workflow); // can set an error
		});
	}
	if (!this.workflow.hasError()) {
		this.checkOutput();
	}
	this.renderResponse();
}

ProcessRequest.prototype.processInput = function(req) {
	for (var k in this.context.input.required) {
		if (req.param(k) === undefined) {
			this.workflow._error = { error: "input", msg: "required input missing: " + k };
			this.renderResponse();
			return false;
		} else {
			var result = this.castInputParam(req.param(k), k, this.context.input.required[k].type);
			if (result.error) {
				return;
			}
			this.workflow.req.params[k] = result.val;
		}
	}
	for (var k in this.context.input.optional) {
		if (req.param(k) !== undefined) {
			var result = this.castInputParam(req.param(k), k, this.context.input.optional[k].type);
			if (result.error) {
				return;
			}
			this.workflow.req.params[k] = result.val;
		}
	}
	return true;
}

ProcessRequest.prototype.castInputParam = function(val, k, type) {

	var result = {
		error: false
	};

	if (type == "string") {
		result.val = val;
	} else if (type == "boolean") {
		if (val.toLowerCase() == "true") {
			result.val = true;
		} else if (val.toLowerCase() == "false") {
			result.val = false;
		} else {
			this.renderError("input", "input is wrong type (" + type + "), was: " + k + ' = ' + val);
			result.error = true;
		}
	} else if (type == "number") {
		if (isNaN(val)) {
			this.renderError("input", "input is wrong type (" + type + "), was: " + k + ' = ' + val);
			result.error = true;
		} else {
			result.val = +val;
		}
	} else if (type == "array") {
		if (util.isArray(val)) {
			result.val = val;
		} else {
			this.renderError("input", "input is wrong type (" + type + "), was: " + k + ' = ' + val);
			result.error = true;
		}
	} else if (type == "object") {
		if (util.isObject(val)) {
			result.val = val;
		} else {
			this.renderError("input", "input is wrong type (" + type + "), was: " + k + ' = ' + val);
			result.error = true;
		}
    } else {
		this.renderError("server", "input type (" + type + ") is not supported");
		result.error = true;
	}

	return result;
}

ProcessRequest.prototype.checkType = function(k, val, type, mode) {
	if (type == "dictionary" || type == "map") {
		type = "object";
	}
	if ((type == "array" && !util.isArray(val)) ||
		(type != "array" && typeof val != type)) {

		return this.renderError("input", mode + " is wrong type (" + type + "), was: " + k + ' = ' + val);
	} else {
		return true;		
	}
}

ProcessRequest.prototype.checkOutput = function() {

	if (this.context.output.type == "raw") {
		return;
	}

	if (this.context.output.type == "string") {

		if (!util.isString(this.workflow._output)) {
			
			return this.renderError("server", "output must be a string");
		}

		return;
	}

	if (this.context.output.type == "array") {

		if (!util.isArray(this.workflow._output)) {
			
			return this.renderError("server", "output must be an array");
		}

		return;
	}

	for (var k in this.context.output.required) {
		if (this.workflow._output[k] === undefined) {
			return this.renderError("server", "required output missing: " + k);
		} else {
			if (!this.checkType(k, this.workflow._output[k], this.context.output.required[k].type, "output")) {
				return;
			}
		}
	}
	for (var k in this.context.output.optional) {
		if (this.workflow._output[k] !== undefined) {
			if (!this.checkType(k, this.workflow._output[k], this.context.output.optional[k].type, "output")) {
				return;
			}
		}
	}
}

ProcessRequest.prototype.renderResponse = function(usingCachedValue) {

	if (this.workflow.hasRenderedResponse()) {
		return;
	}

	this.workflow._finalizing = true;
	this.workflow._renderedResponse = true;

    this.logHttpEvent();

	usingCachedValue = usingCachedValue === undefined ? false : usingCachedValue;

	if (this.workflow.hasError()) {
		this.LOG.debug("destiny.response", "Error response for {0}{1}: {2}", this.req.baseUrl, this.req.originalUrl, this.workflow._error);

		// Remove all error properties started with '_' - they considered as internal and we need them just for logging but not in response
		for (var k in this.workflow._error) {
			if (this.workflow._error.hasOwnProperty(k) && k.startsWith("_")) {
				delete this.workflow._error[k];
			}
		}

		// Server Errors are logged by Sails
		if (this.workflow._error.code !== undefined) {
			var code = this.workflow._error.code;
			delete this.workflow._error.code;
			this.res.send(code, this.workflow._error);
		} else {
			this.res.serverError(this.workflow._error);			
		}
	} else if (this.workflow.hasRedirect()) {
		this.LOG.debug("destiny.response", "Redirected from {0}{1} to {2}", this.req.baseUrl, this.req.originalUrl, this.workflow._redirectUrl);
		this.res.set('Location', this.workflow._redirectUrl);
		this.res.send(301, 'Redirecting to ' + encodeURI(this.workflow._redirectUrl));
	} else if (this.workflow.hasFileToSend()) {
		this.LOG.debug("destiny.response", "Sending file {0} for {1}{2}", this.workflow._fileToSend, this.req.baseUrl, this.req.originalUrl);
		this.res.set(this.workflow._outputHeaders);
		var fileLocation = path.join(sails.config.destiny.repo, "resources", this.workflow._fileToSend);
		fs.createReadStream(fileLocation).pipe(this.res);
	} else {
		this.LOG.debug("destiny.response", "Response for {0}{1}: {2}", this.req.baseUrl, this.req.originalUrl, this.workflow._output);
		this.res.set(this.workflow._outputHeaders);

		this.res.ok(this.workflow._output);

		if (!sails._destiny.redis.enabled || usingCachedValue) {
			return;
		}

		var cacheResponseDuration = this.context.destiny_config.cache_response_duration;
		if (cacheResponseDuration >= 0) {

			var key = this.responseCacheKey;

			var object = {
				headers : this.workflow._outputHeaders,
				output : this.workflow._output
			}

			var value = JSON.stringify(object);

			if (cacheResponseDuration > 0) {
				sails._destiny.redis.client.setex(key, cacheResponseDuration, value);
			} else if (cacheResponseDuration == 0) {
				sails._destiny.redis.client.set(key, value);
			}
		}		
	}
};

ProcessRequest.prototype.logHttpEvent = function() {
	var duration = Date.now() - this.startTime;
	var props = {
		duration: duration,
		code: 200
	};
	if (this.workflow.hasError()) {
		if (this.workflow._error.code !== undefined) {
			props.code = this.workflow._error.code;
		} else {
			props.code = 500;
		}
	} else if (this.workflow.hasRedirect()) {
		props.code = 301;
		props.redirectUrl = this.workflow._redirectUrl;
	}
	if (sails.config.destiny.httpLog.logEveryRequestDetails || duration > sails.config.destiny.httpLog.durationWarningLimit) {
		props.durationLimit = sails.config.destiny.httpLog.durationWarningLimit;
		props.dependPoints = [];
		for (var i in this.workflow._callsInProgressMeta) {
			var callInfo = this.workflow._callsInProgressMeta[i];
			var obj = {
				dependPoint: callInfo.dependUrl,
				duration: callInfo.endTime - callInfo.startTime
			};
			if (callInfo.timedOut) {
				obj.timedOut = true;
			}
			props.dependPoints.push(obj);
		}
	}

	if (!this.workflow._supressLog) {
		if (this.workflow.hasError()) {
			props.serverError = this.workflow._error;
			this.logHttpError('Server error', props);
		} else if (duration > sails.config.destiny.httpLog.durationWarningLimit) {
			this.logHttpError('Duration exceeded limit', props);
		} else if (sails.config.destiny.httpLog.logEveryRequest) {
			this.logHttpError('req handled', props);
		}
	}
	this.workflow._supressLog = false;
};

ProcessRequest.prototype.shouldProcess = function(endpointProcessId) {

	return !this.workflow._renderedResponse && this.workflow._callsInProgress[endpointProcessId];
}

ProcessRequest.prototype.renderError = function(errorCode, errorMessage, moreErrorMessage) {

	if (moreErrorMessage) {
		this.LOG.warn("destiny", moreErrorMessage);
	}
	this.workflow._error = { error: errorCode, msg: errorMessage };
	this.renderResponseIfReady();
	return false;
}

ProcessRequest.prototype.initWorkflow = function(self) {
	var workflow = {
		_callsInProgress : {},
		_callsInProgressMeta : {},
		_cacheCallsInProgress : {},
		_callMocks : {},
		_output : {},
		_error : undefined,
		_redirectUrl : undefined,
		_fileToSend : undefined,
		_renderedResponse : false,
		_finalizing: false,
		_idPath: [],
		_idMap: {},
		_outputHeaders : {},
		_outputHeadersNotInResponse : {},
		_supressLog : false,
		data : {},
		req : {
			headers: {},
			params: {}
		},
		_loggingMetaParams : {},
		hasError : function() {
			return self.workflow._error !== undefined;
		},
		hasRedirect : function() {
			return self.workflow._redirectUrl !== undefined;
		},
		hasFileToSend : function() {
			return self.workflow._fileToSend !== undefined;
		},
		hasRenderedResponse : function() {
			return self.workflow._renderedResponse;
		},
		supressLog : function() {
			self.workflow._supressLog = true;
		},
		setLoggingMetaParam : function(name, value) {
			var prevValue = self.workflow._loggingMetaParams[name];
			self.workflow._loggingMetaParams[name] = value;
			return prevValue;
		},
		call : function(endpoint, spec, endpointProcessId) {
			self.LOG.debug("destiny.call", "Call {0} with ids:{1} and params {2}", endpoint, spec.restIds, spec.params);
			if (self.workflow._finalizing) {
				return self.renderError("server", "call not allowed after finalizing",
					"call not allowed after finalizing: " + endpoint);
			} else {
				if (spec === undefined) {
					spec = {};
				}
				if (!spec.timeout && sails.config.destiny.defaultTimeout) {
					spec.timeout = sails.config.destiny.defaultTimeout;
				}
				endpointProcessId = (endpointProcessId === undefined) ? endpoint : endpointProcessId;
				self.workflow._callsInProgress[endpointProcessId] = true;
				self.workflow._callsInProgressMeta[endpointProcessId] = {};
				self.makeCall(endpointProcessId, endpoint, spec);	
			}
		},
		output : function(param, value) {

			if (self.workflow.hasRedirect()) {
				return self.renderError("server", "output not allowed after redirect was called");
			}

			if (self.workflow.hasFileToSend()) {
				return self.renderError("server", "output not allowed after sendFile was called");
			}

			if (self.context.output.type == "raw") {
				self.workflow._output = param;
				return;
			}

			if (self.context.output.type == "string") {
				if (!util.isString(param)) {
					return self.renderError("server", "output must be a string");
				}
				if (util.isString(self.workflow._output)) {
					self.LOG.warn("destiny", "output already written");
				}
				self.workflow._output = param;
				return;
			}

			if (self.context.output.type == "array") {
				if (!util.isArray(param)) {
					return self.renderError("server", "output must be an array");
				}
				if (util.isArray(self.workflow._output)) {
					self.LOG.warn("destiny", "output already written");
				}
				self.workflow._output = param;
				return;
			}

			if (self.workflow._output[param]) {
				self.LOG.warn("destiny", "{0} already written", param);
			}

			var found = false;
			for (var k in self.context.output.required) {
				if (k == param) {
					found = true;
					break;
				}
			}
			if (!found) {
				for (var k in self.context.output.optional) {
					if (k == param) {
						found = true;
						break;
					}
				}
			}

			if (!found) {
				return self.renderError(param + " not allowed in output");
			}

			self.workflow._output[param] = value;
		},
		outputHeader : function(param, value) {
			self.workflow._outputHeaders[param] = value;
		},
		httpHeaderParameter : function(param, value) {
			if (self.workflow._outputHeaders[param] !== undefined) {
				return self.workflow._outputHeaders[param];
			} else {
				return self.workflow._outputHeadersNotInResponse[param];
			}
		},
		redirect : function(url) {
			if (Object.keys(self.workflow._output).length > 0) {
				return self.renderError("server", "redirect call not allowed after data output");
			}
			if (self.workflow.hasFileToSend()) {
				return self.renderError("server", "redirect call not allowed after sendFile call");
			}
			self.workflow._redirectUrl = url;
		},
		sendFile : function(fileName) {
			if (Object.keys(self.workflow._output).length > 0) {
				return self.renderError("server", "sendFile call not allowed after data output");
			}
			if (self.workflow.hasRedirect()) {
				return self.renderError("server", "sendFile call not allowed after redirect call");
			}
			self.workflow._fileToSend = fileName;
		},
		error : function(errorObject) {
			self.workflow._hasError = true;
			self.workflow._error = errorObject;
			self.renderResponse();
		},
		idPath: function(index) {
			if (index === undefined) {
				// Return array
				return self.workflow._idPath;
			} else if (!self.workflow._idPath || index >= self.workflow._idPath.length) {
				return undefined;
			} else {
				return self.workflow._idPath[index];
			}
		},
		idMap: function(paramName) {
			return self.workflow._idMap[paramName];
		},
		cacheGet: function(key) {
			if (self.workflow._finalizing) {
				return self.renderError("server", "cache call not allowed after finalizing",
					"cache call not allowed after finalizing: " + endpoint);
			} else {
				self.workflow._cacheCallsInProgress[key] = true;
				self.makeCallCacheGet(key);
			}
		},
		cachePut: function(key, value, expirationInSeconds) {
			if (self.workflow._finalizing) {
				return self.renderError("server", "cache call not allowed after finalizing",
					"cache call not allowed after finalizing: " + endpoint);
			} else {
				self.makeCallCachePut(key, value, expirationInSeconds);
			}
		}
	}
	return workflow;
}

ProcessRequest.prototype.initLog = function() {
	var self = this;
	var LOG = {
		_kLevelDebug : 0,
		_kLevelInfo : 1,
		_kLevelWarn : 2,
		_kLevelError : 3,
		_kLevelOff : 4,
		_level: { default: 4 },
		debug : function(tagOrMsg, msg) {
			self.log(LOG._kLevelDebug, "DEBUG", tagOrMsg, msg, arguments);
		},
		info : function(tagOrMsg, msg) {
			self.log(LOG._kLevelInfo, "INFO", tagOrMsg, msg, arguments);
		},
		warn : function(tagOrMsg, msg) {
			self.log(LOG._kLevelWarn, "WARN", tagOrMsg, msg, arguments);
		},
		error : function(tagOrMsg, msg) {
			self.log(LOG._kLevelError, "ERROR", tagOrMsg, msg, arguments);
		},
	}
	return LOG;
}

ProcessRequest.prototype.log = function(threshold, mode, tagOrMsg, msg, arguments) {

	var level;
	var tag = undefined;
	if (msg === undefined) {
		level = this.LOG._level.default;
		msg = tagOrMsg;
	} else {
		level = this.walkTreeForLevel(tagOrMsg);
		if (level === undefined) {
			level = this.LOG._level.default;
		} else {
			tag = tagOrMsg;
		}
	}
	if (level > threshold) {
		return;
	}
	if (typeof msg == "object") {
		if (sails.config.destiny.logPrettyFormat == true) {
			msg = JSON.stringify(msg, true, 2);
		} else {
			msg = JSON.stringify(msg);
		}
	} else if (typeof msg == "string") {
		msg = apiUtil.format(msg, arguments, 2);	
	}
	if (tag) {
		msg = "[" + tag + "] " + msg;
	} else {
		msg = " " + msg;
	}
	
	var color;
	switch (threshold) {
		case this.LOG._kLevelError:
			color = "\x1b[31m%s\x1b[0m"; // red
			break;
		case this.LOG._kLevelWarn:
			color = "\x1b[33m%s\x1b[0m"; // yellow
			break;
		case this.LOG._kLevelInfo:
			color = "\x1b[32m%s\x1b[0m"; // green
			break;
		default:
			color = "\x1b[36m%s\x1b[0m"; // cyan
			break;
	}
	console.log(color, new Date() + " " + mode + "\t" + msg);

	var httpLoggingThreshold = this.LOG._httpAppLoggingThreshold;
	if (threshold >= httpLoggingThreshold) {
		this.logHttpError('Application Msg', {
			level: mode,
			msg: msg
		});
	}
}

ProcessRequest.prototype.walkTreeForLevel = function(tag) {

	var level = this.LOG._level[tag];
	var i = tag.lastIndexOf('.');
	while (level === undefined && i !== -1) {
		tag = tag.substring(0, i);
		level = this.LOG._level[tag];
		i = tag.lastIndexOf('.');
	}
	return level;
}

ProcessRequest.prototype.initContext = function(log) {

	var self = this;

	var sandbox = {
		_request : undefined,
		_processResultsMap : {},
		_processExceptionMap : {},
		_processCacheGetResultsMap : {},
		_processCacheGetExceptionMap : {},
		_finalize: undefined,
		config : sails.config.destiny.apiContextConfig,
		LOG : log,
		request: function(func) {
			if (sandbox._request !== undefined) {
				var obj = new Error("request already called");
				obj.errorTag = "destiny";
				throw obj;
			}
			sandbox._request = func;
		},
		results : function(endpoint, func) {
			if (sandbox._processResultsMap[endpoint] !== undefined) {
				var obj = new Error("results already called with key " + endpoint);
				obj.errorTag = "destiny";
				throw obj;
			}
			sandbox._processResultsMap[endpoint] = func;
		},
		exception : function(endpoint, func) {
			if (sandbox._processExceptionMap[endpoint] !== undefined) {
				var obj = new Error("exception already called with key " + endpoint);
				obj.errorTag = "destiny";
				throw obj;
			}
			sandbox._processExceptionMap[endpoint] = func;
		},
		finalize: function(func) {
			if (sandbox._finalize !== undefined) {
				var obj = new Error("finalize already called");
				obj.errorTag = "destiny";
				throw obj;
			}
			sandbox._finalize = func;
		},
		include: function(name) {
			return self.source.globals[name];
		},
		resource: function(name) {
			if (self.source.resources[name] === undefined) {
				var obj = new Error("there is no resource: " + name);
				obj.errorTag = "destiny";
				throw obj;
			} else {
				return self.source.resources[name];				
			}
		},
		cacheGetResults : function(key, func) {
			if (sandbox._processCacheGetResultsMap[key] !== undefined) {
				var obj = new Error("cache get results already called with key " + key);
				obj.errorTag = "destiny";
				throw obj;
			}
			sandbox._processCacheGetResultsMap[key] = func;
		},
		cacheGetException : function(key, func) {
			if (sandbox._processCacheGetExceptionMap[key] !== undefined) {
				var obj = new Error("cache get exception already called with key " + key);
				obj.errorTag = "destiny";
				throw obj;
			}
			sandbox._processCacheGetExceptionMap[key] = func;
		}	
	};

	var context = vm.createContext(sandbox);
	return context;
}

ProcessRequest.prototype.initInterceptContext = function(log) {

	var self = this;

	var sandbox = {
		_interceptResults : undefined,
		config : sails.config.destiny.apiContextConfig,
		LOG : log,
		interceptResults: function(func) {
			sandbox._interceptResults = func;
		},
		include: function(name) {
			return self.source.globals[name];
		}
	};

	var context = vm.createContext(sandbox);
	return context;
}

ProcessRequest.prototype.initJsMockContext = function(log, filename) {

	var self = this;

	var sandbox = {
		config : sails.config.destiny.apiContextConfig,
		LOG : log,
		include: function(name) {
			return self.source.globals[name];
		},
		loadJson: function(name) {
			var testDir = filename.substring(0, filename.lastIndexOf("/") + 1);
			var filePath = path.join(sails.config.destiny.repo, testDir, name);
			return JSON.parse(fs.readFileSync(filePath));
		}
	};

	var context = vm.createContext(sandbox);
	return context;
}

ProcessRequest.prototype.logHttpError = function(msg, props) {

	var self = this;

	var obj = {
		url: self.source.path,
		apiVersion: self.source.version,
		meta: Object.assign(props, this.workflow._loggingMetaParams)
	};

	for (var i in sails.config.destiny.httpHeaderParameters) {

		var hp = sails.config.destiny.httpHeaderParameters[i];
		if (hp.httpLog === true) {
			if (hp.returnInResponse) {
				obj[hp.name] = this.workflow._outputHeaders[hp.name];
			} else {
				obj[hp.name] = this.workflow._outputHeadersNotInResponse[hp.name];
			}
		}
	}

	sails._destiny.httpLog.error(obj, msg);
}

// The unit testing will exercise processRequest with a variety of conditions that are automatically generated
// If a number uses negative, zero, positive, within range and outside of range
// If a string uses null, empty, small string, big string
// If optional, sometimes pass, sometimes not
