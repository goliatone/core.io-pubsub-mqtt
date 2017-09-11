module.exports = function(data){
    if(!data.timestamp) data.timestamp = Date.now();
    return data;
};
