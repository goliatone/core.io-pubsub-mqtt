module.exports = function(data){
    if(!data.uuid) data.uuid = require('uuid').v4();
    return data;
};
