const supabase = require("../config/supabaseClient");

// 유저가 가입된 동아리 목록 가져오기
exports.getClub = async (req, res) => {
  try {
    const profileId =
      (req.user && req.user.id) ||
      req.query.profile_id ||
      req.params.profile_id;
    if (!profileId) {
      return res.status(400).json({ error: "profile_id가 필요합니다." });
    }
    const { data, error } = await supabase
      .from("club_members")
      .select(
        `
        club_id,
        ord,
        club:clubs (
          id,
          name,
          description,
          location,
          members:club_members(count)
        )
      `
      )
      .eq("profile_id", profileId)
      .eq("club.club_members.status", "active")
      .order("ord", { ascending: true });

    if (error) {
      throw error;
    }

    const rows = (data ?? []).map((item) => ({
      id: item.club_id,
      name: item.club?.name,
      description: item.club?.description,
      location: item.club?.location,
      members: item.club?.members?.[0]?.count ?? 0,
      ord: item.ord,
    }));

    res.json(rows);
  } catch (err) {
    console.error("GET /api/club Error:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.createClub = async (req, res) => {
  try {
    const { name, description } = req.body;
    const profileId = (req.user && req.user.id) || req.body.profile_id;
    if (!name || !profileId) {
      return res.status(400).json({ error: "name과 profile_id가 필요합니다." });
    }
    const { data: club, error: clubErr } = await supabase
      .from("clubs")
      .insert({
        name,
        description: description || null,
        created_by: profileId,
      })
      .select("id, name, description, created_by, created_at, updated_at")
      .single();
    if (clubErr) {
      throw clubErr;
    }
    const { data: membership, error: memErr } = await supabase
      .from("club_members")
      .insert({
        club_id: club.id,
        profile_id: profileId,
        role: "president",
        status: "active",
        officer_title: null,
        joined_at: new Date().toISOString(),
        ord: 1,
      })
      .select(
        "club_id, profile_id, role, status, officer_title, joined_at, ord"
      )
      .single();
    if (memErr) {
      throw memErr;
    }
    res.status(201).json({ club, membership });
  } catch (err) {
    console.error("POST /api/club Error:", err);
    res.status(500).json({ error: err.message });
  }
};
