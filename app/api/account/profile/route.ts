import { NextResponse } from "next/server";
import { accountFetch, getAccountSessionState } from "@/lib/accountStore";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { getAuthenticatedUser, normalizeNickname } from "@/lib/userAuth";

interface ProfilePatchBody {
  nickname?: unknown;
  englishLevel?: unknown;
  readingInterests?: unknown;
  birthYear?: unknown;
  gender?: unknown;
}

const allowedLevels = new Set(["高中", "四级", "六级", "考研", "雅思/托福"]);
const allowedInterests = new Set(["science", "nature", "culture", "current", "business", "growth", "literature", "health"]);

export async function PATCH(request: Request) {
  const user = await getAuthenticatedUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "请先登录。" }, { status: 401 });

  let body: ProfilePatchBody;
  try {
    body = await readJsonBody<ProfilePatchBody>(request, 12 * 1024);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RequestBodyTooLargeError ? "请求内容过大。" : "请求格式不正确。" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (Object.hasOwn(body, "nickname")) {
    const nickname = normalizeNickname(String(body.nickname ?? ""));
    if (!nickname) return NextResponse.json({ error: "昵称不能为空。" }, { status: 400 });
    patch.nickname = nickname;
  }
  if (Object.hasOwn(body, "englishLevel")) {
    const level = String(body.englishLevel ?? "");
    if (level && !allowedLevels.has(level)) return NextResponse.json({ error: "英语水平选项无效。" }, { status: 400 });
    patch.english_level = level;
  }
  if (Object.hasOwn(body, "readingInterests")) {
    if (!Array.isArray(body.readingInterests)) return NextResponse.json({ error: "阅读偏好格式不正确。" }, { status: 400 });
    const interests = [...new Set(body.readingInterests.filter((item): item is string => typeof item === "string" && allowedInterests.has(item)))];
    if (interests.length !== body.readingInterests.length) return NextResponse.json({ error: "阅读偏好包含无效选项。" }, { status: 400 });
    patch.reading_interests = interests;
  }
  if (Object.hasOwn(body, "birthYear")) {
    if (body.birthYear === null || body.birthYear === "") patch.birth_year = null;
    else {
      const year = Number(body.birthYear);
      if (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear()) return NextResponse.json({ error: "出生年份无效。" }, { status: 400 });
      patch.birth_year = year;
    }
  }
  if (Object.hasOwn(body, "gender")) {
    const gender = body.gender === null || body.gender === "" ? null : body.gender;
    if (gender !== null && gender !== "male" && gender !== "female") return NextResponse.json({ error: "性别选项无效。" }, { status: 400 });
    patch.gender = gender;
  }

  if (Object.keys(patch).length === 1) return NextResponse.json({ error: "没有可保存的资料。" }, { status: 400 });
  try {
    await accountFetch(`account_profiles?user_id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });
    return NextResponse.json({ account: await getAccountSessionState(user) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "资料暂时无法保存，请稍后重试。" }, { status: 503 });
  }
}
