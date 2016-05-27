var Git = require("nodegit");
var fs = require('fs');
var path = require("path");
var repoPath = require("./config/local").repo;

var repo;

Git.Repository.open(path.resolve(repoPath))
.then(function(repoResult) {
  repo = repoResult;
  return Git.Tag.list(repo);
})
.then(function(list) {

  for (var i in list) {
    if (list[i].indexOf("_api_staging_v") == 0) {
    	console.log(list[i].substring(14) + " staged");
    } else if (list[i].indexOf("_api_v") == 0) {
    	console.log(list[i].substring(6));
    }
  }
})
.catch(function(error) {
  console.log(error);
});
