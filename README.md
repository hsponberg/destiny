# destiny

An Experience Layer API Framework

The purpose of the experience layer API is provide an API targeted for a specific user experience - such as an api that serves a mobile app

The experience layer is mostly an aggregator, but also contains some business logic. It is stateless, doesn't require any databases, etc. and usually relies on services provided by backend teams.

It has several goals:

* Reduce the amount of http calls mobile apps make
* Cut down on the amount of traffic between mobile apps and the API
* Facilitate development of features for mobile apps (Objective-C/Swift and Java) before underlying services are ready to be deployed to UAT or Production
* Facilitate testing of mobile apps by serving mocks or dynamically intercepting the modifying responses, to return predefined condition

## Setup

This framework isn't intended to be installed standalone, but bundled as a dependency of an API implementation that uses this framework. Please see the sample repository. TODO: link to sample

## Endpoints and DependPoints

For the purposes of this document and to facilitate clear communication while discussing the experience layer, the following definitions are used:

* Endpoints are endpoints written in the experience layer
* DependPoints are endpoints that the experience layer calls. They are endpoints the experience layer depends on.

## Writing an Endpoint

To create a new endpoint, create a new javascript file, under the endpoints folder structure (more on that below).

#### Handling the initial Request

Implement the request handler function, by calling ```request``` and passing in your handler. This is the first function invoked when a request is made to an Endpoint. The function accepts these parameters:

* **req**: contains request information such as request parameters and headers
* **workflow**: this object controls the lifetime flow of the call made to this Endpoint. You can use this object to make calls to DependPoints and write data to your response.

In the example below, when the Endpoint is hit, it makes a request to the sport DependPoint. It passes along the sportId parameter from the request.

```javascript
request(function(req, workflow) {
    workflow.call(SPORT, {
		params: {
		    sportId: req.sportId
		}
	});
});
```

#### Handling the Response to a call

Implement the response handler function, by calling ```results``` and passing in the DependPoint and your handler. This function is invoked when a successful response has been received from a call made to a DependPoint. The function accepts these parameters:

* **status**: contains the response http status code and response headers
* **response**: contains the response body (usually a JSON object)
* **workflow**: this object controls the lifetime flow of the call made to this Endpoint. You can use this object to make calls to DependPoints and write data to your response.

In the example below, when the call to the sport DependPoint returns a successful response, the sport's name is written to the output (what the Endpoint will return).

```javascript
results(SPORT, function(status, response, workflow) {
	workflow.output("sport-name", response.sportName);
});
```

#### Handling an Exception to a call

Implement the exception handler function, by calling ```exception``` and passing in the DependPoint and your handler. This function is invoked when the call times out or the http response code is not 200-299 from a call made to a DependPoint. The function accepts these parameters:

* **status**: contains the response http status code and response headers
* **response**: contains the response body (usually a JSON object)
* **workflow**: this object controls the lifetime flow of the call made to this Endpoint. You can use this object to make calls to DependPoints and write data to your response.

In the example below, when the call to the sport DependPoint returns a non-successful response, the sport's name is written to the output as 'Unknown'.

```javascript
exception(SPORT, function(status, response, workflow) {
	workflow.output("sport-name", "Unknown");
});
```

In another exception example below, the Endpoint responds with an error

```javascript
exception(SPORT, function(status, response, workflow) {
	workflow.error( { key: "no-sport", message: "Unable to locate sport" } );
});
```

#### Finalizing a Response

After all calls have resulted, and if no errors have been posted to the workflow, the finalize function will be invoked. Implement the finalize handler function by calling ```finalize``` and passing in your handler. The function accepts the workflow as the only parameter.

```javascript
finalize(function(workflow) {
	workflow.output('last-chance', someVariable);
});
```

#### Specifying the Input and Output

The Input and Output must be specified in order for the Endpoint to work. These are specified through ```input``` and ```output``` variables defined in the Endpoint js. The best practice is to put these at the top of the Endpoint js file, as a form of self-documenting code.

Each object specifies which parameters are required, or optional, as well as the data type.

The framework will only parse parameters that are specified in the Input object, and only output parameters that are specified in the Output object. Attempting to write a parameter that is not defined in the Output object will result in a server error.

The allowed data types are: ```string, number, object, boolean, and array```

Input parameters will be cast into the specified data type. Output parameters will be validated that they conform the specified data type.

Example

```javascript
var input = {
	required: {
		dateFrom : { type: "string" }
	},
	optional: {
		limit: { type: "number" }
	}
}

var output = {
	required: {
		transactions: { type: "array" },
	},
	optional: {
	}
}
```

Sometimes an Endpoint will return an array instead of an object. In that case, the Output object can specify it's type to be ```array```, for example:

```javascript
var output = {
	type: "array"
};
```

#### Complete Example

To see an example of it all put together, view the TODO: link to sample

## Calling a DependPoint

A DependPoint can be called in the function handlers for

* request, or
* results

The call takes 2 parameters. The first parameter is the global const of the DependPoint to call. The second parameter is the call options object. All options are optional.

The options object can specify:

| Option        | Description   | Default |
| ------------- | ------------- | ------- |
| timeout       | The amount of time allowed for a DependPoint call. 0 means no timeout. | 0 |
| method        | The http method. One of 'GET', 'POST', 'PUT', 'DELETE' | 'GET' |
| restIds       | Array of rest ids to populate restful wildcards in the DependPoint URL | Empty array |
| params        | Object of parameters to pass in the request. If using GET, they are passed in the request URL. If using POST, they are passed in the body as url form encoded | Empty object|
| headers       | Parameters to pass in the request header | Empty object |
| expectsJson   | Boolean flag; if true will parse the response into a json object | true |
| allowError    | If a call returns an http response code >= 300, and an exception handler isn't registered, then the framework will respond with an error if allowError is false, or ignore the error if allowError is true | false |
| allowTimeout    | If a call times out, and an exception handler isn't registered, then the framework will respond with an error if allowTimeout is false, or ignore the timeout if allowTimeout is true | false |

## How the project is organized into folders

The experience layer api framework leverages convention over configuration. It looks for the following folders

* **endpoints** - Our Endpoints
* **endpointsMocks** - Mock files for Endpoints (json or js)
* **dependMocks** - Mock files for DependPoints (json or js)
* **dependInterceptors** - Interceptors for DependPoints (more on that below)

#### How the experience layer api framework resolves Endpoint paths

The URL for all Endpoints is formed as follows:

```
http(s)://${baseURL}/api/${version}/${path-to-endpoint}
```

The version is either 'dev' for the currently development sandbox, or a released or staged version number prefixed with 'v'.

For example, running on localhost port 8081 in development

```
http(s)://localhost:8081/api/dev/${path-to-endpoint}
```

Another example with released version 1.1.0

```
http(s)://localhost:8081/api/v1.1/${path-to-endpoint}
```

The ${path-to-endpoint} is the directory hierarchy under the Endpoints folder. For example, suppose the directory structure is:

```
endpoints/color.js  
endpoints/color/blue.js
```

Then the url path to resolve color.js is

```
http(s)://localhost:8081/api/dev/color
```

And the url path to resolve blue.js is

```
http(s)://localhost:8081/api/dev/color/blue
```

#### Restful Wildcards in the Endpoint path

You can use a ```$``` to specify a wildcard in the Endpoint path, which get parsed into restful ids. The $ is used as a suffix to either a file or a folder. For example, suppose the directory structure is:

```
endpoints/color.js
endpoints/color$.js
endpoints/color$/rgb.js
endpoints/library$/book$/author.js
```

Then the url path to resolve color$.js is

```
http(s)://localhost:8081/api/dev/color/${colorId}
or
http(s)://localhost:8081/api/dev/color/blue
```

And the url path to resolve rgb.js is

```
http(s)://localhost:8081/api/dev/color/$(colorId}/rgb
or
http(s)://localhost:8081/api/dev/color/blue/rgb
```

The **req** parameter passed into the function handler for **request** will make the restful id path available. The restful ids are parsed into an array in the order of occurrence. You can query for the whole array, or one of the ids by index.

For example, if the url to resolve author.js is 

```
http(s)://localhost:8081/api/dev/library/5/book/727/author
```

Then

```javascript
req.idPath(0); // returns 5
req.idPath(1); // returns 727
req.idPath();  // returns [5, 727]
```

## Defining DependPoints

All DependPoints are specified in 

```
endpoints/_global/dependPoints.js
```

Each DependPoint has a global const assigned to the URL. The URL may contain restful wildcards which a call would need to populate.

An example DependPoint definition

```javascript
var WUNDERGROUND_TIDE = "http://api.wunderground.com/api/$0/tide/q/CA/San_Francisco.json";
```

In all Endpoint js files, the DependPoint can now be referred to by the global const ```WUNDERGROUND_TIDE```

Since this URL has a restful wildcard, the call to this DependPoint must provide the restful id path when making the request. For example,

```javascript
workflow.call(WUNDERGROUND_TIDE, {
    restIds: [ config.wundergroundApiKey ]
});
```

Other DependPoint environments can also be specified by adding files with environment in the filename. For example, the uat environment can be provided with ```dependPoints.uat.js```

## Includes Modules

Node Modules can be written and made available to all Endpoints, JS mocks, and Interceptors. All files placed into the endpoints/_global folder are available using the include function. 

Modules are created when the server starts and lives in memory

For example, in an Endpoint js, to include the node module in endpoints/_global/util.js

```javascript
var util = include("util");
util.myFunction();
```

## Config Parameters

Config parameters can be specified and are made available to all Endpoints, JS mocks, and Interceptors. The framework is built on top of SailsJS. In either the sails local.js file, or one of the environment settings files such as development.js or production.js, the config parameters can be specified in ```apiContextConfig```

For example, in local.js

```javascript
apiContextConfig: {
    myApiKey: 'z80771ce87218A8f'
},
```

Then in an Endpoint

```javascript
workflow.call(MY_SECURE_ENDPOINT, {
    headers: {
        'api-key': config.myApiKey
    }
});
```

## Logging

A logging mechanism is provided, with support for logging levels. 

The logging levels are

```
Debug
Info
Warn
Error
Off
```

Logging levels cascade - If the logging level is set at debug, you will get logging messages for all levels. If the logging level is set at warn, you will only get logging messages for warn and error.

Logging messages are tagged with a category, so categories can have different logging levels.

In order to improve performance, the best practice is to not concatenate strings to form your logging message. Instead, create variables within your logging message between parens.

The logger is provided as the global const ```LOG``` to all Endpoints, JS mocks, and Interceptors

Example

```javascript
LOG.debug('myTag', 'You passed parameter {0}', req.parameter);
LOG.error('myTag', 'You request for {0} failed due to {1}', resource, message);
```

The logging levels can be specified in the ```apiLogLevel``` object in local.js, or a sails environment js file.

Example

```javascript
apiLogLevel: {
    myTag: 0,
    default: 3, // 0 = debug, 1 = info, 2 = warn, 3 = error, 4 = off
  },
```

## Mocks and Interceptors

DependPoints and Endpoints can be mocked using static JSON files or dynamic JS files. Mocking enables developers to code and test their mobile app code, either when the DependPoints aren't ready yet, or a specific condition is to be tested.

DependPoints can be intercepted, and the response modified, before the Endpoint renders a response.

These can be selected on the fly in your browser at http://localhost:8081/api/apiAdmin

In addition to selecting a mock or interceptor, you can select the http response code and the latency

### Mocks

Endpoints can be mocked, but this should be used sparingly, since the Endpoint code is not being executed. This can be useful for quickly developing the mobile app code before you get a chance to code the Endpoint.

It is preferable to write the Endpoint and provide mocks for the DependPoints. 

The path is resolved using the directory structure under the corresponding mock folder, with the final path part resolving to a folder that ends with .mock

Inside the .mock folder contains all files that provide a mock for the matching DependPoint or Endpoint

#### JSON Mocks

1. Just place the static .json file in the .mock folder

#### JS Mocks

1. Place the .js file in the .mock folder
1. Implement the ```getResults``` function

The getResults function takes 2 parameters: params and status 

* **params** are parameters passed in the request
* **status** is an object that contains headers and the response status code that will be returned in the response

The getResults function can return an array or an object

Example

```javascript
function getResults(params, status) {
    var results = {};
    results.message = "Your name is " + params.name;
    return results;
}
```

### Interceptors

Interceptors are more dynamic than mocks because they actually make the call to the DependPoint, and then modify the result before the Endpoint response is returned.

For path resolution, it follows the same rules as Mocks, except the folder extension is .int instead of .mock

Interceptors can be specified for DependPoints but not Endpoints.

Implement the intercept handler function, by calling ```interceptResults``` and passing in your handler. This function is invoked when a successful response has been received from a call made to a DependPoint. The function accepts these parameters:

* **params**: contains the DependPoint request parameters
* **status**: contains the DependPoint response http status code and response headers
* **results**: contains the response body (usually a JSON object)

In the example below, an array of tides in intercepted, and the height for each tide set to 0

```javascript
interceptResults(function(params, status, results) {
	results.tides.forEach(function(tide) {
		tide.height = 0;
	});
});
```

## Staging and Releasing

The experience layer api framework leverages git tags to version the api. When a server is deployed, it will use special tags to check out and deploy every released version.

To release a version, it must first be staged.

#### Staging a version

From the terminal, run: ```npm run stage ${versionNumber}``` to stage a specific version number

A version number by convention must be three number separated by dots in the format of ```${version number}```.```${subversion number}```.```${bug fix version number}```

The best practice is for a user of the api, such as a mobile app, to reference the api by only the first 2 numbers: ```${version number}```.```${subversion number}```

The framework will serve up the latest bug fix version for the request. For example, suppose we have versions 1.0.0, fix 1.0.1, and 1.2.0. If the user requests 1.0 they will be served 1.0.1

The above refers only to released versions. In the above example, if version 1.0.1 is staged but not released, the user would be served 1.0.0. The only way to be served a staged version is to specifically ask for it with the full 3 number version.

Under to hood, the framework will tag the repo with _api_staging_v${full version number}, and then publish the tagged files as a staged version

#### Releasing a staged version

From the terminal, run: ```npm run release```

Releasing is permanent, and cannot be rolled back. The version will be published with the version number that was used in staging.

Under to hood, the framework will replace the staging tag with _api_v${full version number}, and then publish the tagged files as a released version

#### Unstaging a staged version

From the terminal, run: ```npm run unstage```

Under to hood, the framework will delete the tag _api_staging_v${full version number}, and then un-publish the staged version

## Automated Testing Support

The browser admin page to configure mocks and interceptors is not available in production. Automated testing of the mobile app sometimes needs the ability to request a specific set of data. This is made possible in the request header.

In order to use this functionality, the request header must contain a test authorization token, ```hsapi-test-auth```

This must match the ```testAuthToken``` configured in sails local.js or production.js

Then any number of mocks may be specified, by passing in request header parameters in the format of ```hsapi-test-x``` where x starts at 1 and goes up to the number of mocks specified.

The value is a JSON string object that contains the following parameters

* **depend** - The global const DependPoint being mocked
* **mock** - The corresponding mock
* **status** (optional) - The http response code
* **latency** (latency) - The latency of the request

Example unit test using tape and supertest

```javascript
var test = require('tape');
var supertest = require('supertest');
var api = supertest('http://localhost:8081');

test('Low tide', function(t) {
	api.get('/api/dev/wunderground')
		.set('hsapi-test-auth', authToken)
		.set('hsapi-test-1', JSON.stringify({ depend: 'wunderground_tide', mock: 'lowTide.json'}))
		.set('hsapi-test-2', JSON.stringify({ depend: 'wunderground_conditions', mock: 'default.json'}))
		.expect(200)
		.expect('Content-Type', /json/)
		.end(function(err, res) {
		  t.error(err, "no error");
		  t.same(res.body.tide, '0.01 ft at Low Tide');
		  t.same(res.body.next_tide, '1.02 ft at High Tide');
		  t.end();
		});
});
```
