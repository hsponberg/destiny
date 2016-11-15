var shelljs = require('shelljs');
var fs = require('fs-extra');
var path = require("path");
var repoPath = require("./config/local").destiny.repo;
repoPath = path.resolve(__dirname, repoPath);

var pwd = shelljs.pwd();
shelljs.cd(repoPath);

var result;

var outputPath = path.join(repoPath, ".tmp");
var endpointPath = "endpoints";
var dependMocksPath = "dependMocks";

fs.removeSync(outputPath);
fs.mkdirSync(outputPath);

result = shelljs.exec('git rev-parse --abbrev-ref HEAD', {silent:true});

if (result.code !== 0) {
	console.log('Error: Unable to determine current branch. More details:');
	console.log('\t' + result.stdout);
	console.log('\t' + result.stderr);
	shelljs.exit(1);
}

var currentBranch = result.stdout.slice(0, -1); // Remove final \n

if (currentBranch == "HEAD") {
	console.log("Error: You are in detached HEAD state. This script requires you to be on a branch.");
	shelljs.exit(1);
} else {
	console.log("On " + currentBranch);
}

result = shelljs.exec('git stash create', {silent:true});

if (result.code !== 0) {
	console.log('Error: Unable to stash');
	shelljs.exit(1);
}

var stashCommit = result.stdout.slice(0, -1); // Remove final \n

var stashed = stashCommit.length > 0;

if (stashed) {

	console.log("Stashed changes");

	result = shelljs.exec('git stash store -m "Stashing to install API" ' + stashCommit, {silent:true});

	if (result.code !== 0) {
		console.log('Error: Unable to stash store');
		shelljs.exit(1);
	}

	result = shelljs.exec('git reset --hard', {silent:true});

	if (result.code !== 0) {
		console.log('Error: Unable to reset to HEAD');
		shelljs.exit(1);
	}
}

result = shelljs.exec('git tag -l', {silent:true});

if (result.code !== 0) {
	console.log('Error: Git list failed');
	shelljs.exit(1);
}

var list = result.stdout.slice(0, -1).split('\n');

var tags = [];
var tagI = 0;

for (var i in list) {

	if (list[i].indexOf("_api_v") == 0 || list[i].indexOf("_api_staging_v") == 0) {
    	tags.push(list[i]);
    }
}

for (var i in tags) {
	processTag(i);
}

exit(0); // And pop stash

function processTag(index) {

	var currentTagName = tags[index];

	console.log("Processing tag " + currentTagName);

	var result = shelljs.exec('git checkout ' + currentTagName, {silent:true});

	if (result.code !== 0) {
		console.log('Error: Unable to checkout ' + currentTagName);
		exit(1);
	}

    var sI = currentTagName.indexOf("_v"); 
    var stagingPrefix = currentTagName.indexOf("staging") == -1 ? "" : "s";
    var versionPath = currentTagName.substring(sI + 2); // remove _api_v or _api_staging_v
    var dest = path.join(outputPath, stagingPrefix + versionPath, endpointPath);
    var dependMocksDest = path.join(outputPath, stagingPrefix + versionPath, dependMocksPath);

	result = shelljs.exec('git ls-tree --full-tree -r HEAD', {silent:true});

	if (result.code !== 0) {
		console.log('Error: Unable to checkout ' + currentTagName);
		exit(1);
	}

	var files = result.stdout.slice(0, -1).split('\n');
	for (var fI in files) {
		var file = files[fI].split('\t')[1];

		if (!file) {
			continue;
		} else if (file.startsWith("endpoints/")) {

            if (file.indexOf('/dependPoints.') != -1 && file.indexOf('/dependPoints.js') == -1) {
            	// Another environment like uat
            	continue;
            }

            var err = copyFile(file, dest);
            if (err) {
            	exit(1, err);
            }
        } else if (file.startsWith("dependMocks/")) {
          	var err = copyFile(file, dependMocksDest);
          	if (err) {
            	exit(1, err);
            }
        }
	}
}

function copyFile(file, dest) {

	// Remove (.*)/ (endpoints for dependMocks)
	var slashI = file.indexOf('/');
	var fileWithout = file.substring(slashI);

	var dirI = fileWithout.lastIndexOf('/');
	var dir = fileWithout.substring(0, dirI);

	var destDir = dest + '/' + dir;

	try {
		fs.ensureDirSync(destDir);
	} catch (err) {
		return err;
	}

	var dest = dest + '/' + fileWithout;

	file = path.resolve(repoPath, file);

	try {
		fs.copySync(file, dest);
		return;
	} catch (err) {
		return err;
	}
}

function exit(code, message) {

	if (message) {
		console.log(message);
	}

	var result = shelljs.exec('git checkout ' + currentBranch, {silent:true});

	if (result.code !== 0) {
		console.log('Error: Unable to checkout ' + currentBranch);
		shelljs.exit(1);
	}

	if (stashed) {

		console.log("Applying and popping stashed changes");
		result = shelljs.exec('git stash pop', {silent:true});

		if (result.code !== 0) {
			console.log('Error: Unable to pop git stash');
			shelljs.exit(1);
		}
	}

	if (code == 0) {
		// The API server watches lastModified.txt and reloads the endpoints
		fs.writeFileSync(path.join(outputPath, 'lastModified.txt'), '' + new Date().getTime());
		console.log("Done");		
	}

	shelljs.exit(code);
}
