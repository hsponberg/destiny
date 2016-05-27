var Git = require("nodegit");
var fs = require('fs');
var path = require("path");
var childProcess = require('child_process');
var repoPath = require("./config/local").repo;

var nextVersion = process.argv[2];

if (!nextVersion) {
	console.log("No version specified");
	return;
} else {
	var isValid = /^[0-9.]*$/.test(nextVersion);
	if (nextVersion.split('.').length != 3 || !isValid) {
		console.log("Version format must be {version}.{subversion}.{bugversion} ex. 1.0.2");
		return;
	}	
}

var tag_name = "_api_staging_v" + nextVersion;
var signature = Git.Signature.now("destiny", "noreply@destiny");
var message = "tag message"
var overwrite = 0; // 1 will overwrite

var repo;

Git.Repository.open(path.resolve(repoPath))
.then(function(repoResult) {
  repo = repoResult;
  return Git.Tag.list(repo);
})
.then(function(list) {

	return new Promise(function(fulfill, reject) {
	  for (var i in list) {
	    if (list[i].indexOf("_api_staging_v") == 0) {
	    	return reject("a version is already staged");
	    } else if (list[i].indexOf("_api_v" + nextVersion) == 0) {
	    	return reject("version " + nextVersion + " already exists");
	    }
	  }
	  fulfill();
	});
})
.then(function() {
  return repo.getHeadCommit();
})
.then(function(commit) {
	return Git.Tag.create(repo, tag_name, commit, signature, message, overwrite);
})
.then(function(oid) {
	console.log("Staged " + nextVersion);
	console.log("Installing Api");
	childProcess.fork("./installApi.js");
})
.catch(function(error) {
  console.log(error);
});
