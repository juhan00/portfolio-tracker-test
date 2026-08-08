export default async function handler(req, res) {
  const { symbol } = req.query;

  if (!symbol) {
    return res.status(400).json({ error: "symbol 파라미터가 필요합니다" });
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?interval=1d&range=5d`;

    const upstream = await fetch(url, {
      headers: {
        // 일부 종목에서 Yahoo가 브라우저 UA 없이는 응답을 거부하는 경우가 있어 지정
        "User-Agent": "Mozilla/5.0 (compatible; PortfolioTracker/1.0)",
      },
    });

    if (!upstream.ok) {
      return res.status(502).json({ error: "야후 파이낸스 조회 실패", status: upstream.status });
    }

    const data = await upstream.json();
    const result = data?.chart?.result?.[0];

    if (!result || typeof result.meta?.regularMarketPrice !== "number") {
      return res.status(502).json({ error: "가격 데이터 없음" });
    }

    const price = result.meta.regularMarketPrice;
    const prevClose = result.meta.previousClose ?? result.meta.chartPreviousClose ?? price;
    const currency = result.meta.currency || null;

    // 짧은 캐싱: 같은 종목을 여러 사용자가 요청해도 Yahoo에 매번 안 가도록
    res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=30");
    return res.status(200).json({ symbol, price, prevClose, currency });
  } catch (e) {
    return res.status(500).json({ error: "서버 오류", detail: String(e) });
  }
}
