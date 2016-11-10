var shelljs = require('shelljs');
var path = require("path");
var repoPath = require("./config/local").destiny.repo;
repoPath = path.resolve(__dirname, repoPath);

shelljs.cd(repoPath);

var result;

result = shelljs.exec('git tag -l', {silent:true});

if (result.code !== 0) {
	echo('Error: Git list failed');
	exit(1);
}

var list = result.stdout.slice(0, -1).split('\n');

for (var i in list) {

	if (list[i].indexOf("_api_staging_v") == 0) {
    	console.log(list[i].substring(14) + " staged");
    } else if (list[i].indexOf("_api_v") == 0) {
    	console.log(list[i].substring(6));
    }
}
