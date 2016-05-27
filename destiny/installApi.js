var Git = require("nodegit");
var fs = require('fs-extra');
var path = require("path");
var repoPath = require("./config/local").repo;

var outputPath = path.join(repoPath, ".tmp");
var endpointPath = "endpoints";
var dependMocksPath = "dependMocks";

fs.removeSync(outputPath);
fs.mkdirSync(outputPath);

var repo;

var tags;

var tagI;

var myRef;

var myTag;

var currentTagName;

var currentRef;

var signature = Git.Signature.now("destiny api", "noreply@destiny");
 
var stashed;

Git.Repository.open(path.resolve(repoPath))
.then(function(repoResult) {
  repo = repoResult;
  return repo.getCurrentBranch();
})
.then(function(ref) {
  currentRef = ref;
  console.log("On " + ref.shorthand() + " (" + ref.target() + ")");
})
.then(function() {
  return new Promise(function(fulfill, reject) {
    Git.Stash.save(repo, signature, "Stashing to install API", Git.Stash.FLAGS.DEFAULT)
    .then(function() {
      console.log("Stashed changes");
      stashed = true;
      fulfill();
    })
    .catch(function(error) {
      error = error + '';
      stashed = false;
      if (error.indexOf("There is nothing to stash") != -1) {
        fulfill();
      } else {
        reject(error);
      }
    });
  });
})
.then(function() {
  return Git.Tag.list(repo);
})
.then(function(list) {

  tags = [];
  for (var i in list) {
    if (list[i].indexOf("_api_v") == 0 || list[i].indexOf("_api_staging_v") == 0) {
      tags.push(list[i]);
    }
  }

  tagI = 0;
})
.then(function() {
  processNextTag();
})
.catch(function(error) {
  console.log(error);
});

function processNextTag() {

  if (tagI >= tags.length) {

    repo.checkoutRef(currentRef, { checkoutStrategy: Git.Checkout.STRATEGY.SAFE } )
    .then(function() {
      if (stashed) {
        console.log("Applying and popping stashed changes");
        return Git.Stash.pop(repo, 0);
      }
    })
    .then(function() {
      // The API server watches lastModified.txt and reloads the endpoints
      return fs.writeFileSync(path.join(outputPath, 'lastModified.txt'), '' + new Date().getTime());
      console.log("Done ");
    })
    .catch(function(error) {
      console.log(error);
    });

    return;
  }

  var currentTagName = tags[tagI++];
  var currentCommit;
  console.log("Processing tag " + currentTagName);

  repo.getTagByName(currentTagName)
  .then(function(tag) {
    myTag = tag;
    return repo.getCommit(tag.targetId());
  })
  .then(function(commit) {

    // TODO: evaluate STRATEGY.FORCE - should probably use safe when developing, but force on prod server

    currentCommit = commit;
    return Git.Checkout.tree(repo, commit, { checkoutStrategy: Git.Checkout.STRATEGY.SAFE } );
  })
  .then(function(a) {
    //return repo.setHeadDetached(myTag.targetId().tostrS(), repo.defaultSignature, "Checkout: HEAD " + myTag.targetId().tostrS());
    return repo.setHead('refs/tags/' + myTag.name());
  })
  .then(function() {
      return currentCommit.getTree();
  })
  .then(function(tree) {

    var sI = currentTagName.indexOf("_v"); 
    var stagingPrefix = currentTagName.indexOf("staging") == -1 ? "" : "s";
    var versionPath = currentTagName.substring(sI + 2); // remove _api_v or _api_staging_v
    var dest = path.join(outputPath, stagingPrefix + versionPath, endpointPath);
    var dependMocksDest = path.join(outputPath, stagingPrefix + versionPath, dependMocksPath);

    return new Promise(function(fulfill, reject) {
        var walker = tree.walk();
        walker.on("entry", function(entry) {
          var file = entry.path();
          if (file.startsWith("endpoints/")) {

            if (file.indexOf('/dependPoints.') != -1 && file.indexOf('/dependPoints.js') == -1) {
              // Another environment like uat
              return;
            }

            var err = copyFile(file, dest);
            if (err) {
              return reject(err);
            }
          } else if (file.startsWith("dependMocks/")) {
            var err = copyFile(file, dependMocksDest);
            if (err) {
              return reject(err);
            }
          }
        });
        walker.on("end", function() {
          fulfill();
        });
        walker.start();
    });
  })
  .then(function() {
    process.nextTick(function() {
      processNextTag();      
    })
  })
  .catch(function(error) {
    console.log(error);
  });  
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