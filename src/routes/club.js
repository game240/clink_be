const express = require("express");
const router = express.Router();
const cc = require("../controllers/clubController");
const authenticate = require("../middleware/auth");

router.use(authenticate);

router.get("/", cc.getClub);
router.post("/", cc.createClub);

module.exports = router;
