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

// 동아리 멤버 관리
router.get("/members", cc.getClubMembers);
router.get("/search-users", cc.searchUsersByEmail);
router.post("/invite", cc.inviteMember);
router.get("/invitations", cc.getInvitations);
router.patch("/invitations/:invitationId", cc.handleInvitation);
router.get("/officers", cc.getClubOfficers);
router.patch("/positions-graduation", cc.updateClubMemberPositionsGraduation);

// 동아리 직급 관리
router.get("/positions", cc.getClubPositions);
router.post("/positions", cc.createClubPosition);
router.patch("/positions/:id", cc.updateClubPosition);
router.delete("/positions/:id", cc.deleteClubPosition);

module.exports = router;
