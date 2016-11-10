var shelljs = require('shelljs');
var path = require("path");
var repoPath = require("./config/local").destiny.repo;
repoPath = path.resolve(__dirname, repoPath);
var childProcess = require('child_process');

var pwd = shelljs.pwd();
shelljs.cd(repoPath);

var result;

var staging_tag_name;
var new_tag_name;

var nextVersion;

result = shelljs.exec('git tag -l', {silent:true});

if (result.code !== 0) {
	console.log('Error: Git list failed');
	shelljs.exit(1);
}

var list = result.stdout.slice(0, -1).split('\n');

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
	console.log("There is no staged version");
	shelljs.exit(1);
}
for (var i in list) {
	if (list[i].indexOf("_api_v" + nextVersion) == 0) {
		console.log("version " + nextVersion + " already exists");
		shelljs.exit(1);
	}
}

result = shelljs.exec('git tag -a -m "staging version" ' + new_tag_name + ' ' + staging_tag_name, {silent:true});

if (result.code !== 0) {
	console.log('Error: unable to tag')
	shelljs.exit(1);
}

result = shelljs.exec('git tag -d ' + staging_tag_name, {silent:true});

if (result.code !== 0) {
	console.log('Error: unable to remove staging tag')
	shelljs.exit(1);
}

console.log("Released " + nextVersion);
console.log("Installing Api");
childProcess.fork(pwd + "/installApi.js");

