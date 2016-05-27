var Git = require("nodegit");
var fs = require('fs');
var path = require("path");
var childProcess = require('child_process');
var repoPath = require("./config/local").repo;

var staging_tag_name;
var new_tag_name;
var signature = Git.Signature.now("destiny", "noreply@destiny");
var message = "tag message"
var overwrite = 0;

var repo;

var nextVersion;

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
		    	nextVersion = list[i].substring(14);
		    	tagName = list[i];
		    	new_tag_name = '_api_v' + nextVersion;
		    	staging_tag_name = list[i];
		    	break;
		    }
		}
		if (!nextVersion) {
			reject("There is no staged version");
		}
		for (var i in list) {
			if (list[i].indexOf("_api_v" + nextVersion) == 0) {
				return reject("version " + nextVersion + " already exists");
			}
		}
		fulfill(tagName);
	});
})
.then(function(tagName) {
  return repo.getTagByName(tagName);
})
.then(function(tag) {
	return repo.getCommit(tag.targetId());
})
.then(function(commit) {
	return Git.Tag.create(repo, new_tag_name, commit, signature, message, overwrite);
})
.then(function() {
	return Git.Tag.delete(repo, staging_tag_name);
})
.then(function(oid) {
	console.log("Released " + nextVersion);
	console.log("Installing Api");
	childProcess.fork("./installApi.js");
})
.catch(function(error) {
  console.log(error);
});
