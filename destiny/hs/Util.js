module.exports = {

	format : function(str, args, offset) {

		args = args === undefined ? arguments : args;
		offset = offset === undefined ? 0 : offset;

	    return str.replace(/\{(\d+)\}/g, function(v) {
	    	var i = parseInt(v.substring(1));
	    	if (args[i + offset] !== undefined) {
	    		return args[i + offset];
	    		if (typeof arg == "object") {
	    			if (sails.config.destiny.logPrettyFormat == true) {
	    				arg = JSON.stringify(arg, true, 2);
	    			} else {
	    				arg = JSON.stringify(arg);
	    			}
	    		}
	    		return arg;
	    	} else {
	    		return v;
	    	}
	    });
	}
}
