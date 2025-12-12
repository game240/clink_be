const base = require("./base.json");
const components = require("./components.json");
const upload = require("./paths/upload.json");
const pages = require("./paths/pages.json");
const search = require("./paths/search.json");
const recent = require("./paths/recent.json");
const diff = require("./paths/diff.json");
const club = require("./paths/club.json");

module.exports = {
  ...base,
  components,
  paths: {
    ...upload,
    ...pages,
    ...search,
    ...recent,
    ...diff,
    ...club,
  },
};
