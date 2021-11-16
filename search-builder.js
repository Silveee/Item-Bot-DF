const lunr = require("lunr");

const builder = new lunr.Builder();
builder.field("name");
builder.ref("name");
builder.pipeline.add(lunr.stopWordFilter);

module.exports = builder;
