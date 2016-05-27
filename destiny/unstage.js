var Git = require("nodegit");
var fs = require('fs');
var path = require("path");
var childProcess = require('child_process');
var repoPath = require("./config/local").repo;

var message = "tag message"
var overwrite = 0;

var repo;

Git.Repository.open(path.resolve(repoPath))
.then(function(repoResult) {
  repo = repoResult;
  return Git.Tag.list(repo);
})
.then(function(list) {

	return new Promise(function(fulfill, reject) {
		var tagName;
		for (var i in list) {
		    if (list[i].indexOf("_api_staging_v") == 0) {
		    	tagName = list[i];
		    	break;
		    }
		}
		if (!tagName) {
			reject("There is no staged version");
		}
		fulfill(tagName);
	});
})
.then(function(tagName) {
	return Git.Tag.delete(repo, tagName);
})
.then(function(oid) {
	console.log("Unstaged");
	console.log("Installing Api");
	childProcess.fork("./installApi.js");
})
.catch(function(error) {
  console.log(error);
});
