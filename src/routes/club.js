const express = require("express");
const router = express.Router();
const cc = require("../controllers/clubController");
const authenticate = require("../middleware/auth");
const multer = require("multer");

const upload = multer({ storage: multer.memoryStorage() });

router.use(authenticate);

router.get("/", cc.getClub);
router.post("/", upload.single("thumbnail"), cc.createClub);
router.get("/info", cc.getClubInfo);

module.exports = router;
