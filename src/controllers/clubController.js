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
          thumbnail_url,
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
      thumbnailUrl: item.club?.thumbnail_url ?? null,
      ord: item.ord,
    }));

    res.json(rows);
  } catch (err) {
    console.error("GET /api/club Error:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.createClub = async (req, res) => {
  let club = null;

  try {
    const { name, location, description } = req.body;
    const profileId = (req.user && req.user.id) || req.body.profile_id;

    if (!name || !profileId) {
      return res.status(400).json({ error: "name과 profile_id가 필요합니다." });
    }

    // 1) clubs 생성
    const { data: clubData, error: clubErr } = await supabase
      .from("clubs")
      .insert({
        name,
        location,
        description: description || null,
        created_by: profileId,
      })
      .select("id, name, description, created_by, created_at, updated_at")
      .single();

    if (clubErr) {
      throw clubErr;
    }

    // 롤백용으로 id 보관
    club = clubData;

    // 2) 썸네일이 있는 경우: 먼저 Storage 업로드 + clubs 업데이트
    if (req.file) {
      const fileBuffer = req.file.buffer;
      const mimeType = req.file.mimetype; // 'image/png', 'image/jpeg', ...

      const fileExt =
        mimeType === "image/png"
          ? "png"
          : mimeType === "image/webp"
          ? "webp"
          : "jpg";

      const filePath = `club/club_thumbnail/${club.id}.${fileExt}`;

      const { error: uploadErr } = await supabase.storage
        .from("clink")
        .upload(filePath, fileBuffer, {
          contentType: mimeType,
          upsert: true,
        });

      if (uploadErr) {
        // 이미지 업로드 실패: 동아리 삭제 후 에러 반환
        await supabase.from("clubs").delete().eq("id", club.id);
        throw new Error(
          `${uploadErr.message}: 동아리 썸네일 업로드에 실패했습니다.`
        );
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("clink").getPublicUrl(filePath);

      const nowIso = new Date().toISOString();

      const { data: updatedClub, error: updateErr } = await supabase
        .from("clubs")
        .update({
          thumbnail_url: publicUrl,
          thumbnail_updated_at: nowIso,
        })
        .eq("id", club.id)
        .select(
          "id, name, description, created_by, created_at, updated_at, thumbnail_url, thumbnail_updated_at"
        )
        .single();

      if (updateErr) {
        // DB 업데이트 실패: 동아리 삭제 후 에러 반환
        await supabase.from("clubs").delete().eq("id", club.id);
        throw new Error("동아리 썸네일 정보 저장에 실패했습니다.");
      }

      club = updatedClub;
    }

    // 3) club_members에 회장 membership 생성
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
      // membership 생성 실패: club_members/clubs 정리
      await supabase.from("club_members").delete().eq("club_id", club.id);
      await supabase.from("clubs").delete().eq("id", club.id);
      throw new Error("동아리 멤버십 생성에 실패했습니다.");
    }

    res.status(201).json({ club, membership });
  } catch (err) {
    console.error("POST /api/club Error:", err);
    res.status(500).json({ error: err.message });
  }
};
