module.exports = {

	format : function(str, args, offset) {

		args = args === undefined ? arguments : args;
		offset = offset === undefined ? 0 : offset;

	    return str.replace(/\{(\d+)\}/g, function(v) {
	    	var i = parseInt(v.substring(1));
	    	if (args[i + offset] !== undefined) {
	    		var arg = args[i + offset];
	    		if (typeof arg == "object") {
	    			var cache = [];
	    			// handles circular references
	    			var replacer = function(key, value) {
	    				if (typeof value === 'object' && value !== null) {
	    					if (cache.indexOf(value) !== -1) {
	    						// Circular reference found, discard key
	    						return;
	    					}
	    					// Store value in our collection
	    					cache.push(value);
	    				}
	    				return value;
	    			};

	    			if (sails.config.destiny.logPrettyFormat == true) {
	    				arg = JSON.stringify(arg, replacer, 2);
	    			} else {
	    				arg = JSON.stringify(arg, replacer);
	    			}
	    			cache = null; // Enable garbage collection
	    		}
	    		return arg;
	    	} else {
	    		return v;
	    	}
	    });
	}
}
