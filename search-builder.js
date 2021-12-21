const lunr = require("lunr");

const builder = new lunr.Builder();
builder.field("name");
builder.ref("name");

function stripTrailingS(token) {
  return token.update((tokenStr) =>
    tokenStr.length > 2 && tokenStr.slice(-1) === "s"
      ? tokenStr.slice(0, -1)
      : tokenStr
  );
}
builder.pipeline.add(lunr.stopWordFilter);
builder.pipeline.add(stripTrailingS);
builder.searchPipeline.add(lunr.stopWordFilter);
builder.searchPipeline.add(stripTrailingS);

module.exports = builder;
