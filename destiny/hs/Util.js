module.exports = {

	format : function(str, args, offset) {

		args = args === undefined ? arguments : args;
		offset = offset === undefined ? 0 : offset;

	    return str.replace(/\{(\d+)\}/g, function(v) {
	    	var i = parseInt(v.substring(1));
	    	if (args[i + offset] !== undefined) {
	    		return args[i + offset];
	    	} else {
	    		return v;
	    	}
	    });
	}
}
