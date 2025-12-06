const supabase = require("../config/supabaseClient");

// 유저가 가입된 동아리 목록 가져오기
exports.getClub = async (req, res) => {
  try {
    const profileId = (req.user && req.user.id) || req.query.profile_id || req.params.profile_id;
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
      .eq("status", "active")
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

      const fileExt = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";

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
        throw new Error(`${uploadErr.message}: 동아리 썸네일 업로드에 실패했습니다.`);
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
      .select("club_id, profile_id, role, status, officer_title, joined_at, ord")
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

exports.getClubInfo = async (req, res) => {
  try {
    const { clubId } = req.query;

    if (!clubId) {
      return res.status(400).json({ error: "clubId가 필요합니다." });
    }

    const { data, error } = await supabase
      .from("clubs")
      .select("id, name, thumbnail_url")
      .eq("id", clubId)
      .single();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({ error: "동아리를 찾을 수 없습니다." });
    }

    res.json({
      name: data.name,
      thumbnailUrl: data.thumbnail_url ?? null,
    });
  } catch (err) {
    console.error("GET /api/club/info Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// 동아리 멤버 목록 가져오기 (운영진, 일반, 졸업자 분리)
exports.getClubMembers = async (req, res) => {
  try {
    const { clubId } = req.query;
    const profileId = (req.user && req.user.id) || req.query.profile_id;

    if (!clubId) {
      return res.status(400).json({ error: "clubId가 필요합니다." });
    }

    // club_members에서 해당 동아리의 모든 활성 멤버 가져오기
    const { data: members, error } = await supabase
      .from("club_members")
      .select(
        `
        club_id,
        profile_id,
        role,
        officer_title,
        is_graduate,
        status,
        profile:profiles (
          id,
          name,
          email,
          phone
        )
      `
      )
      .eq("club_id", clubId)
      .eq("status", "active");

    if (error) {
      throw error;
    }

    // 운영진, 일반, 졸업자로 분류
    const officers = [];
    const generalMembers = [];
    const graduatedMembers = [];

    (members || []).forEach((member) => {
      const memberData = {
        id: member.profile_id,
        name: member.profile?.name || "",
        position: member.role === "president" ? "회장" : member.officer_title || "일반",
        graduationStatus: member.is_graduate ? "졸업" : "재학",
        phone: member.profile?.phone || "",
        email: member.profile?.email || "",
        isMe: profileId ? member.profile_id === profileId : false,
        isPresident: member.role === "president",
      };

      if (member.role === "officer") {
        officers.push(memberData);
      } else if (member.role === "member") {
        if (member.is_graduate) {
          graduatedMembers.push(memberData);
        } else {
          generalMembers.push(memberData);
        }
      } else if (member.role === "president") {
        // 회장도 운영진에 포함
        officers.push(memberData);
      }
    });

    res.json({
      officers,
      generalMembers,
      graduatedMembers,
    });
  } catch (err) {
    console.error("GET /api/club/members Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// 이메일로 유저 검색 (동아리 초대용)
exports.searchUsersByEmail = async (req, res) => {
  try {
    const { email, clubId } = req.query;
    const profileId = (req.user && req.user.id) || req.query.profile_id;

    if (!email) {
      return res.status(400).json({ error: "email이 필요합니다." });
    }

    if (!clubId) {
      return res.status(400).json({ error: "clubId가 필요합니다." });
    }

    // 1) profiles 테이블에서 이메일로 검색 (부분 일치)
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, name, email, phone")
      .ilike("email", `%${email}%`)
      .limit(10);

    if (profileError) {
      throw profileError;
    }

    if (!profiles || profiles.length === 0) {
      return res.json([]);
    }

    // 2) 해당 동아리에 이미 가입/초대된 멤버 확인
    const profileIds = profiles.map((p) => p.id);
    const { data: existingMembers, error: memberError } = await supabase
      .from("club_members")
      .select("profile_id")
      .eq("club_id", clubId)
      .in("profile_id", profileIds);

    if (memberError) {
      throw memberError;
    }

    const invitedProfileIds = new Set((existingMembers || []).map((m) => m.profile_id));

    // 3) 응답 형식으로 변환
    const results = profiles.map((profile) => ({
      user: {
        id: profile.id,
        name: profile.name || "",
        position: "일반",
        graduationStatus: "재학",
        phone: profile.phone || "",
        email: profile.email || "",
        isMe: profileId ? profile.id === profileId : false,
        isPresident: false,
      },
      is_invited: invitedProfileIds.has(profile.id),
    }));

    res.json(results);
  } catch (err) {
    console.error("GET /api/club/search-users Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// 동아리 멤버 초대
exports.inviteMember = async (req, res) => {
  try {
    const { clubId, profileId } = req.body;

    if (!clubId) {
      return res.status(400).json({ error: "clubId가 필요합니다." });
    }

    if (!profileId) {
      return res.status(400).json({ error: "profileId가 필요합니다." });
    }

    // 1) 이미 해당 동아리에 가입/초대된 멤버인지 확인
    const { data: existingMember, error: checkError } = await supabase
      .from("club_members")
      .select("id, status")
      .eq("club_id", clubId)
      .eq("profile_id", profileId)
      .maybeSingle();

    if (checkError) {
      throw checkError;
    }

    // 이미 초대/가입된 경우
    if (existingMember) {
      // pending 상태면 이미 초대됨
      if (existingMember.status === "pending") {
        return res.status(400).json({ error: "이미 초대된 회원입니다." });
      }
      // active 상태면 이미 가입됨
      if (existingMember.status === "active") {
        return res.status(400).json({ error: "이미 가입된 회원입니다." });
      }
    }

    // 2) 동아리 내 최대 ord 값 가져오기
    const { data: maxOrdData, error: ordError } = await supabase
      .from("club_members")
      .select("ord")
      .eq("club_id", clubId)
      .order("ord", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (ordError) {
      throw ordError;
    }

    const nextOrd = maxOrdData ? maxOrdData.ord + 1 : 1;

    // 3) club_members에 초대 추가 (status: pending)
    const { data: invitation, error: inviteError } = await supabase
      .from("club_members")
      .insert({
        club_id: clubId,
        profile_id: profileId,
        role: "member",
        status: "pending",
        officer_title: null,
        is_graduate: false,
        ord: nextOrd,
        invited_at: new Date().toISOString(),
      })
      .select("club_id, profile_id, role, status, ord, invited_at")
      .single();

    if (inviteError) {
      throw inviteError;
    }

    res.status(201).json({
      message: "초대가 전송되었습니다.",
      invitation,
    });
  } catch (err) {
    console.error("POST /api/club/invite Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// 초대 알림 목록 가져오기
exports.getInvitations = async (req, res) => {
  try {
    const profileId = (req.user && req.user.id) || req.query.profile_id || req.params.profile_id;
    if (!profileId) {
      return res.status(400).json({ error: "profile_id가 필요합니다." });
    }

    // 현재 사용자에게 온 초대 목록 조회 (status: pending)
    const { data, error } = await supabase
      .from("club_members")
      .select(
        `
        id,
        club_id,
        role,
        joined_at,
        invited_at,
        club:clubs (
          id,
          name,
          thumbnail_url
        )
      `
      )
      .eq("profile_id", profileId)
      .eq("status", "pending")
      .order("invited_at", { ascending: false });

    if (error) {
      throw error;
    }

    // 응답 형식으로 변환
    const invitations = (data ?? []).map((item) => ({
      id: item.id,
      clubId: item.club_id,
      clubName: item.club?.name || "",
      invitedAt: item.invited_at,
    }));

    res.json(invitations);
  } catch (err) {
    console.error("GET /api/club/invitations Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// 초대 수락/삭제
exports.handleInvitation = async (req, res) => {
  try {
    const { invitationId } = req.params;
    const { action } = req.body;
    const profileId = (req.user && req.user.id) || req.body.profile_id;

    if (!invitationId) {
      return res.status(400).json({ error: "invitationId가 필요합니다." });
    }

    if (!action || (action !== "accept" && action !== "reject")) {
      return res.status(400).json({ error: "action은 'accept' 또는 'reject'여야 합니다." });
    }

    if (!profileId) {
      return res.status(400).json({ error: "profile_id가 필요합니다." });
    }

    // 1) 초대가 존재하고 현재 사용자의 것인지 확인
    const { data: invitation, error: checkError } = await supabase
      .from("club_members")
      .select("id, club_id, profile_id, status")
      .eq("id", invitationId)
      .eq("profile_id", profileId)
      .eq("status", "pending")
      .single();

    if (checkError || !invitation) {
      return res.status(404).json({ error: "초대를 찾을 수 없습니다." });
    }

    // 2) action에 따라 처리
    if (action === "accept") {
      // 수락: status를 pending에서 active로 변경하고 joined_at 설정
      const { data: updatedInvitation, error: updateError } = await supabase
        .from("club_members")
        .update({
          status: "active",
          joined_at: new Date().toISOString(),
        })
        .eq("id", invitationId)
        .eq("profile_id", profileId)
        .select("id, club_id, profile_id, status, joined_at")
        .single();

      if (updateError) {
        throw updateError;
      }

      res.json({
        message: "초대를 수락했습니다.",
        invitation: updatedInvitation,
      });
    } else if (action === "reject") {
      // 삭제: 레코드 삭제
      const { error: deleteError } = await supabase
        .from("club_members")
        .delete()
        .eq("id", invitationId)
        .eq("profile_id", profileId);

      if (deleteError) {
        throw deleteError;
      }

      res.json({
        message: "초대를 삭제했습니다.",
      });
    }
  } catch (err) {
    console.error("PATCH /api/club/invitations/:invitationId Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// 동아리 역할 목록 가져오기
exports.getClubOfficers = async (req, res) => {
  try {
    const { clubId } = req.query;

    if (!clubId) {
      return res.status(400).json({ error: "clubId가 필요합니다." });
    }

    // club_officers에서 해당 동아리의 역할 목록 조회
    const { data, error } = await supabase.from("club_officers").select("*").eq("club_id", clubId);

    if (error) {
      throw error;
    }

    // 역할 목록 반환 ["회장", "부회장", "회계", "홍보", "일반"]
    const officers = (data ?? []).map((item) => item.name);

    res.json(officers);
  } catch (err) {
    console.error("GET /api/club/officers Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// 동아리 멤버 정보 업데이트
exports.updateClubMemberPositionsGraduation = async (req, res) => {
  try {
    const { clubId, profileId } = req.body;
    const { position, graduationStatus } = req.body;
    const requesterId = (req.user && req.user.id) || req.body.requester_id;

    if (!clubId) {
      return res.status(400).json({ error: "clubId가 필요합니다." });
    }

    if (!profileId) {
      return res.status(400).json({ error: "profileId가 필요합니다." });
    }

    // 업데이트할 필드 구성
    const updateData = {};

    // 직급(position) 변경 처리
    if (position !== undefined) {
      if (position === "회장") {
        updateData.role = "president";
        updateData.officer_title = null;
      } else if (position === "일반") {
        updateData.role = "member";
        updateData.officer_title = null;
      } else {
        // 운영진 역할 (부회장, 회계, 홍보 등)
        updateData.role = "officer";
        updateData.officer_title = position;
      }
    }

    // 졸업 상태 변경 처리
    if (graduationStatus !== undefined) {
      updateData.is_graduate = graduationStatus === "졸업";
    }

    // 업데이트할 필드가 없으면 에러
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "업데이트할 필드가 없습니다." });
    }

    // 멤버가 존재하는지 확인
    const { data: existingMember, error: checkError } = await supabase
      .from("club_members")
      .select("id, club_id, profile_id, role, status")
      .eq("club_id", clubId)
      .eq("profile_id", profileId)
      .eq("status", "active")
      .single();

    if (checkError || !existingMember) {
      return res.status(404).json({ error: "멤버를 찾을 수 없습니다." });
    }

    // 회장은 role을 변경할 수 없도록 체크 (선택사항)
    if (existingMember.role === "president" && position === "일반") {
      return res.status(400).json({ error: "회장의 직급은 변경할 수 없습니다." });
    }

    // 업데이트 실행
    const { data: updatedMember, error: updateError } = await supabase
      .from("club_members")
      .update(updateData)
      .eq("club_id", clubId)
      .eq("profile_id", profileId)
      .select("club_id, profile_id, role, officer_title, is_graduate")
      .single();

    if (updateError) {
      throw updateError;
    }

    res.json({
      message: "멤버 정보가 업데이트되었습니다.",
      member: updatedMember,
    });
  } catch (err) {
    console.error("PATCH /api/club/members Error:", err);
    res.status(500).json({ error: err.message });
  }
};
