import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const KEY = "portfolio-data";

function checkAuth(req, res) {
  const required = process.env.ACCESS_TOKEN;
  if (!required) return true; // 토큰을 설정하지 않았으면 인증 생략 (개인 배포용 기본값)
  const given = req.headers["x-access-token"];
  if (given !== required) {
    res.status(401).json({ error: "인증 실패: 토큰이 올바르지 않습니다" });
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return res.status(500).json({
      error: "환경변수 미설정: KV_REST_API_URL / KV_REST_API_TOKEN 이 없습니다. Upstash 연동을 확인하세요.",
    });
  }

  if (!checkAuth(req, res)) return;

  if (req.method === "GET") {
    try {
      const data = await redis.get(KEY);
      return res.status(200).json({ data: data || null });
    } catch (e) {
      return res.status(500).json({ error: "DB 조회 실패", detail: String(e) });
    }
  }

  if (req.method === "POST") {
    try {
      const body = req.body;
      if (!body || typeof body !== "object") {
        return res.status(400).json({ error: "잘못된 요청 본문" });
      }
      await redis.set(KEY, body);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: "DB 저장 실패", detail: String(e) });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).json({ error: "허용되지 않는 메서드" });
}