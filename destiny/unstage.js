var shelljs = require('shelljs');
var path = require("path");
var repoPath = require("./config/local").destiny.repo;
repoPath = path.resolve(__dirname, repoPath);
var childProcess = require('child_process');

var pwd = shelljs.pwd();
shelljs.cd(repoPath);

var result;

result = shelljs.exec('git tag -l', {silent:true});

if (result.code !== 0) {
	console.log('Error: Git list failed');
	shelljs.exit(1);
}

var list = result.stdout.slice(0, -1).split('\n');

var tagName;
for (var i in list) {
    if (list[i].indexOf("_api_staging_v") == 0) {
    	tagName = list[i];
    	break;
    }
}
if (!tagName) {
	console.log("There is no staged version");
	shelljs.exit(1);
}

var result = shelljs.exec('git tag -d ' + tagName, {silent:true});

if (result.code !== 0) {
	console.log('Error: unable to delete tag')
	shelljs.exit(1);
}

console.log("Unstaged");
console.log("Installing Api");
childProcess.fork(pwd + "/installApi.js");

