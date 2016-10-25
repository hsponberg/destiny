var shelljs = require('shelljs');
var path = require("path");
var repoPath = require("./config/local").repo;
repoPath = path.resolve(__dirname, repoPath);
var childProcess = require('child_process');

var pwd = shelljs.pwd();
shelljs.cd(repoPath);

var result;

var nextVersion = process.argv[2];

if (!nextVersion) {
	console.log("No version specified");
	shelljs.exit(1);
} else {
	var isValid = /^[0-9.]*$/.test(nextVersion);
	if (nextVersion.split('.').length != 3 || !isValid) {
		console.log("Version format must be {version}.{subversion}.{bugversion} ex. 1.0.2");
		shelljs.exit(1);
	}	
}

var tag_name = "_api_staging_v" + nextVersion;

result = shelljs.exec('git tag -l', {silent:true});

if (result.code !== 0) {
	console.log('Error: Git list failed');
	shelljs.exit(1);
}

var list = result.stdout.slice(0, -1).split('\n');

for (var i in list) {
	if (list[i].indexOf("_api_staging_v") == 0) {
		console.log("a version is already staged");
		shelljs.exit(1);
	} else if (list[i].indexOf("_api_v" + nextVersion) == 0) {
		console.log("version " + nextVersion + " already exists");
		shelljs.exit(1);
	}
}

var result = shelljs.exec('git tag -a -m "staging version" ' + tag_name, {silent:true});

if (result.code !== 0) {
	console.log('Error: unable to tag')
	shelljs.exit(1);
}

console.log("Staged " + nextVersion);
console.log("Installing Api");
childProcess.fork(pwd + "/installApi.js");
