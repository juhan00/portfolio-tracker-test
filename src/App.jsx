import React, { useState, useEffect, useCallback } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { RefreshCw, Plus, Trash2, Wallet, AlertCircle, X } from "lucide-react";

const MARKET_OPTIONS = ["코스피", "코스닥", "해외상장", "코인"];
const BUY_TYPES = ["현금", "신용"];

const MARKET_COLOR = {
  "코스피": "#10b981",
  "코스닥": "#34d399",
  "해외상장": "#3b82f6",
  "코인": "#f59e0b",
  "예수금": "#94a3b8",
  "기타자산": "#8b5cf6",
};

function toYahooSymbol(ticker, market) {
  const t = ticker.trim();
  if (!t) return "";
  if (t.includes(".") || t.includes("-")) return t;
  if (market === "코스피") return `${t}.KS`;
  if (market === "코스닥") return `${t}.KQ`;
  return t;
}

function won(n) {
  const v = Math.round(n || 0);
  const sign = v < 0 ? "-" : "";
  return `${sign}₩${Math.abs(v).toLocaleString("ko-KR")}`;
}

function pct(n) {
  const v = n || 0;
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function changeColor(n) {
  if (n > 0) return "text-red-400";
  if (n < 0) return "text-blue-400";
  return "text-slate-400";
}

function authHeaders() {
  const token = import.meta.env.VITE_ACCESS_TOKEN;
  return token ? { "x-access-token": token } : {};
}

async function loadFromDB() {
  try {
    const res = await fetch("/api/portfolio", { headers: authHeaders() });
    if (!res.ok) return { data: null, ok: false };
    const json = await res.json();
    return { data: json.data, ok: true };
  } catch (e) {
    return { data: null, ok: false };
  }
}

async function saveToDB(data) {
  try {
    const res = await fetch("/api/portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(data),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

async function fetchQuote(symbol) {
  // 1순위: 이 앱과 함께 배포된 Vercel 서버리스 프록시 (/api/quote).
  // 서버 대 서버 요청이라 CORS 문제가 없고, claude.ai 미리보기 밖에서 배포했을 때만 응답합니다.
  try {
    const res = await fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`);
    if (res.ok) {
      const json = await res.json();
      if (typeof json.price === "number") {
        return { price: json.price, prevClose: json.prevClose ?? json.price };
      }
    }
  } catch (e) {
    // 프록시가 없는 환경(예: claude.ai 미리보기)이면 아래 직접 호출로 폴백
  }

  // 2순위: 직접 호출 (대부분 CORS로 실패하지만, 배포 환경에 따라 될 수도 있어 시도)
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const tryFetch = async (u) => {
    const res = await fetch(u);
    if (!res.ok) throw new Error("bad status");
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error("no result");
    const price = result.meta.regularMarketPrice;
    const prevClose = result.meta.previousClose ?? result.meta.chartPreviousClose ?? price;
    if (typeof price !== "number") throw new Error("no price");
    return { price, prevClose };
  };
  try {
    return await tryFetch(url);
  } catch (e) {
    try {
      const proxied = "https://api.allorigins.win/raw?url=" + encodeURIComponent(url);
      return await tryFetch(proxied);
    } catch (e2) {
      return null;
    }
  }
}

export default function PortfolioTracker() {
  const [holdings, setHoldings] = useState([]);
  const [accounts, setAccounts] = useState(["계좌1"]);
  const [cashMap, setCashMap] = useState({ "계좌1": 0 });
  const [otherMap, setOtherMap] = useState({ "계좌1": 0 });
  const [filter, setFilter] = useState("전체");
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [failedTickers, setFailedTickers] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [saveStatus, setSaveStatus] = useState("");
  const [storageBroken, setStorageBroken] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");

  const [form, setForm] = useState({
    name: "",
    ticker: "",
    market: "코스피",
    buyType: "현금",
    account: "계좌1",
    qty: "",
    avgPrice: "",
  });

  useEffect(() => {
    (async () => {
      const { data, ok } = await loadFromDB();
      if (!ok) setStorageBroken(true);
      if (data) {
        setHoldings(data.holdings || []);
        setAccounts(data.accounts && data.accounts.length ? data.accounts : ["계좌1"]);
        setCashMap(data.cashMap || { "계좌1": 0 });
        setOtherMap(data.otherMap || { "계좌1": 0 });
        if (data.accounts && data.accounts.length) {
          setForm((f) => ({ ...f, account: data.accounts[0] }));
        }
      }
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(async () => {
      const ok = await saveToDB({ holdings, accounts, cashMap, otherMap });
      setStorageBroken(!ok);
      if (ok) {
        setSaveStatus("저장됨");
        setTimeout(() => setSaveStatus(""), 1200);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [holdings, accounts, cashMap, otherMap, loaded]);

  const addAccount = () => {
    const name = newAccountName.trim();
    if (!name || accounts.includes(name)) return;
    setAccounts((prev) => [...prev, name]);
    setCashMap((prev) => ({ ...prev, [name]: 0 }));
    setOtherMap((prev) => ({ ...prev, [name]: 0 }));
    setNewAccountName("");
  };

  const removeAccount = (name) => {
    if (accounts.length <= 1) return;
    if (holdings.some((h) => h.account === name)) return;
    setAccounts((prev) => prev.filter((a) => a !== name));
    setCashMap((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    setOtherMap((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    if (filter === name) setFilter("전체");
  };

  const addHolding = () => {
    const qty = parseFloat(form.qty);
    const avgPrice = parseFloat(form.avgPrice);
    if (!form.name.trim() || !qty || !avgPrice) return;
    const newHolding = {
      id: Date.now().toString(),
      name: form.name.trim(),
      ticker: form.ticker.trim(),
      market: form.market,
      buyType: form.buyType,
      account: form.account,
      qty,
      avgPrice,
      currentPrice: avgPrice,
      prevClose: avgPrice,
    };
    setHoldings((prev) => [...prev, newHolding]);
    setForm((f) => ({ ...f, name: "", ticker: "", qty: "", avgPrice: "" }));
  };

  const removeHolding = (id) => setHoldings((prev) => prev.filter((h) => h.id !== id));

  const NUMERIC_FIELDS = ["currentPrice", "prevClose", "avgPrice", "qty"];

  const updateHolding = (id, field, value) => {
    setHoldings((prev) =>
      prev.map((h) => (h.id === id ? { ...h, [field]: NUMERIC_FIELDS.includes(field) ? parseFloat(value) || 0 : value } : h))
    );
  };

  const loadSample = () => {
    setAccounts(["계좌1", "계좌2"]);
    setHoldings([
      { id: "s1", name: "삼성전자", ticker: "005930", market: "코스피", buyType: "현금", account: "계좌1", qty: 20, avgPrice: 66000, currentPrice: 71000, prevClose: 70200 },
      { id: "s2", name: "SK하이닉스", ticker: "000660", market: "코스피", buyType: "신용", account: "계좌1", qty: 2, avgPrice: 130000, currentPrice: 188000, prevClose: 179000 },
      { id: "s3", name: "Apple", ticker: "AAPL", market: "해외상장", buyType: "현금", account: "계좌2", qty: 10, avgPrice: 200, currentPrice: 215, prevClose: 213 },
      { id: "s4", name: "엔비디아", ticker: "NVDA", market: "해외상장", buyType: "현금", account: "계좌2", qty: 10, avgPrice: 90, currentPrice: 118, prevClose: 117 },
      { id: "s5", name: "비트코인", ticker: "BTC-USD", market: "코인", buyType: "현금", account: "계좌1", qty: 0.04, avgPrice: 82000000, currentPrice: 83000000, prevClose: 84000000 },
    ]);
    setCashMap({ "계좌1": 2000000, "계좌2": 1200000 });
    setOtherMap({ "계좌1": 7000000, "계좌2": 0 });
  };

  const refreshAll = useCallback(async () => {
    if (holdings.length === 0) return;
    setRefreshing(true);
    const failed = [];
    const updated = await Promise.all(
      holdings.map(async (h) => {
        if (!h.ticker) return h;
        const symbol = toYahooSymbol(h.ticker, h.market);
        const quote = await fetchQuote(symbol);
        if (quote) {
          return { ...h, currentPrice: quote.price, prevClose: quote.prevClose };
        }
        failed.push(h.name);
        return h;
      })
    );
    setHoldings(updated);
    setFailedTickers(failed);
    setLastUpdated(new Date());
    setRefreshing(false);
  }, [holdings]);

  // 계좌 필터 적용
  const visibleHoldings = filter === "전체" ? holdings : holdings.filter((h) => h.account === filter);
  const visibleCash = filter === "전체" ? Object.values(cashMap).reduce((s, v) => s + (v || 0), 0) : cashMap[filter] || 0;
  const visibleOther = filter === "전체" ? Object.values(otherMap).reduce((s, v) => s + (v || 0), 0) : otherMap[filter] || 0;

  // 계산
  const principal = visibleHoldings.reduce((s, h) => s + h.qty * h.avgPrice, 0);
  const evalValue = visibleHoldings.reduce((s, h) => s + h.qty * h.currentPrice, 0);
  const totalPnL = evalValue - principal;
  const totalPnLPct = principal ? (totalPnL / principal) * 100 : 0;
  const todayPnL = visibleHoldings.reduce((s, h) => s + h.qty * (h.currentPrice - h.prevClose), 0);
  const todayBase = evalValue - todayPnL;
  const todayPnLPct = todayBase ? (todayPnL / todayBase) * 100 : 0;
  const totalAssets = evalValue + visibleCash + visibleOther;

  // 자산배분
  const byMarket = {};
  visibleHoldings.forEach((h) => {
    byMarket[h.market] = (byMarket[h.market] || 0) + h.qty * h.currentPrice;
  });
  if (visibleCash > 0) byMarket["예수금"] = visibleCash;
  if (visibleOther > 0) byMarket["기타자산"] = visibleOther;
  const allocData = Object.entries(byMarket)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));
  const allocTotal = allocData.reduce((s, d) => s + d.value, 0);

  if (!loaded) {
    return (
      <div className="min-h-[200px] flex items-center justify-center bg-slate-950 text-slate-400 rounded-xl p-8">
        불러오는 중...
      </div>
    );
  }

  return (
    <div className="w-full bg-slate-950 text-slate-100 rounded-2xl p-4 sm:p-6 space-y-5">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">내 포트폴리오</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {lastUpdated ? `마지막 갱신 ${lastUpdated.toLocaleTimeString("ko-KR")}` : "종목을 추가하고 새로고침을 눌러보세요"}
            {saveStatus && <span className="ml-2 text-emerald-500">{saveStatus}</span>}
          </p>
        </div>
        <button
          onClick={refreshAll}
          disabled={refreshing || holdings.length === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-sm font-medium transition"
        >
          <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "실시간 시세 조회 중..." : "새로고침 (실시간 시세)"}
        </button>
      </div>

      {storageBroken && (
        <div className="flex items-start gap-2 bg-amber-950/40 border border-amber-800/50 text-amber-300 text-xs rounded-lg p-3">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>
            서버 데이터베이스에 연결하지 못했어요. claude.ai 미리보기에서는 /api 라우트가 동작하지 않아 항상 이렇게 뜨는 게 정상이에요.
            Vercel에 배포하고 KV 데이터베이스를 연결하면 해결됩니다 (아래 배포 안내 참고). 지금 입력한 내용은 이 화면을 벗어나면 사라져요.
          </span>
        </div>
      )}

      {failedTickers.length > 0 && (
        <div className="flex items-start gap-2 bg-amber-950/40 border border-amber-800/50 text-amber-300 text-xs rounded-lg p-3">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>
            {failedTickers.join(", ")} 시세를 자동으로 가져오지 못했어요. 아래 종목 테이블의 현재가 칸에 직접 입력하면 바로 계산에 반영돼요.
          </span>
        </div>
      )}

      {/* 계좌 탭 */}
      <div className="flex flex-wrap items-center gap-2">
        {["전체", ...accounts].map((a) => (
          <button
            key={a}
            onClick={() => setFilter(a)}
            className={`px-3 py-1.5 rounded-lg text-sm transition flex items-center gap-1.5 ${
              filter === a ? "bg-emerald-600 text-white" : "bg-slate-900 text-slate-400 hover:text-slate-200"
            }`}
          >
            {a}
            {a !== "전체" && accounts.length > 1 && !holdings.some((h) => h.account === a) && (
              <X
                size={12}
                className="opacity-60 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  removeAccount(a);
                }}
              />
            )}
          </button>
        ))}
        <div className="flex items-center gap-1">
          <input
            value={newAccountName}
            onChange={(e) => setNewAccountName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addAccount()}
            placeholder="계좌 이름"
            className="bg-slate-900 text-slate-100 text-sm rounded-lg px-2 py-1.5 w-24 outline-none"
          />
          <button onClick={addAccount} className="p-1.5 rounded-lg bg-slate-900 text-slate-400 hover:text-slate-200">
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-slate-900 rounded-xl p-4">
          <div className="text-xs text-slate-500 mb-1">총자산</div>
          <div className="text-xl font-semibold">{won(totalAssets)}</div>
        </div>
        <div className="bg-slate-900 rounded-xl p-4">
          <div className="text-xs text-slate-500 mb-1">투자원금</div>
          <div className="text-xl font-semibold">{won(principal)}</div>
        </div>
        <div className="bg-slate-900 rounded-xl p-4">
          <div className="text-xs text-slate-500 mb-1">평가손익 (누적)</div>
          <div className={`text-xl font-semibold ${changeColor(totalPnL)}`}>{won(totalPnL)}</div>
          <div className={`text-xs ${changeColor(totalPnL)}`}>{pct(totalPnLPct)}</div>
        </div>
        <div className="bg-slate-900 rounded-xl p-4">
          <div className="text-xs text-slate-500 mb-1">오늘</div>
          <div className={`text-xl font-semibold ${changeColor(todayPnL)}`}>{won(todayPnL)}</div>
          <div className={`text-xs ${changeColor(todayPnL)}`}>{pct(todayPnLPct)}</div>
        </div>
        <div className="bg-slate-900 rounded-xl p-4">
          <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
            <Wallet size={12} /> 예수금 · 기타자산
          </div>
          {filter === "전체" ? (
            <div className="text-sm text-slate-400 mt-1">
              <div>{won(visibleCash)}</div>
              <div className="text-xs text-slate-600">계좌 탭에서 계좌별로 수정하세요</div>
            </div>
          ) : (
            <div className="flex flex-col gap-1 mt-1">
              <input
                type="number"
                value={cashMap[filter] || ""}
                onChange={(e) => setCashMap((prev) => ({ ...prev, [filter]: parseFloat(e.target.value) || 0 }))}
                placeholder="예수금"
                className="bg-slate-800 text-slate-100 text-sm rounded px-2 py-1 outline-none w-full"
              />
              <input
                type="number"
                value={otherMap[filter] || ""}
                onChange={(e) => setOtherMap((prev) => ({ ...prev, [filter]: parseFloat(e.target.value) || 0 }))}
                placeholder="기타자산 (퇴직연금 등)"
                className="bg-slate-800 text-slate-100 text-sm rounded px-2 py-1 outline-none w-full"
              />
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* 자산배분 */}
        <div className="lg:col-span-2 bg-slate-900 rounded-xl p-4">
          <div className="text-sm font-medium text-slate-300 mb-3">자산 배분</div>
          {allocData.length === 0 ? (
            <div className="text-sm text-slate-600 py-8 text-center">종목을 추가하면 배분이 표시돼요.</div>
          ) : (
            <>
              <div style={{ width: "100%", height: 200 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={allocData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {allocData.map((entry, idx) => (
                        <Cell key={idx} fill={MARKET_COLOR[entry.name] || "#64748b"} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => won(value)}
                      contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12, color: "#e2e8f0" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5 mt-2">
                {allocData
                  .sort((a, b) => b.value - a.value)
                  .map((d) => (
                    <div key={d.name} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-slate-300">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: MARKET_COLOR[d.name] || "#64748b" }} />
                        {d.name}
                      </span>
                      <span className="text-slate-400">{allocTotal ? ((d.value / allocTotal) * 100).toFixed(0) : 0}%</span>
                    </div>
                  ))}
              </div>
            </>
          )}
        </div>

        {/* 보유 종목 테이블 */}
        <div className="lg:col-span-3 bg-slate-900 rounded-xl p-4 overflow-x-auto">
          <div className="text-sm font-medium text-slate-300 mb-3">
            보유 종목 {filter !== "전체" && <span className="text-slate-500 font-normal">· {filter}</span>}
          </div>
          {visibleHoldings.length === 0 ? (
            <div className="text-sm text-slate-600 py-8 text-center space-y-3">
              <p>{holdings.length === 0 ? "아직 등록된 종목이 없어요." : "이 계좌에는 등록된 종목이 없어요."}</p>
              {holdings.length === 0 && (
                <button onClick={loadSample} className="text-emerald-500 hover:text-emerald-400 underline underline-offset-2">
                  예시 데이터 불러오기
                </button>
              )}
            </div>
          ) : (
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="text-slate-500 text-xs border-b border-slate-800">
                  <th className="text-left font-normal py-2">종목</th>
                  <th className="text-left font-normal py-2">구분</th>
                  <th className="text-right font-normal py-2">수량</th>
                  <th className="text-right font-normal py-2">평단가</th>
                  <th className="text-right font-normal py-2">현재가</th>
                  <th className="text-right font-normal py-2">평가액</th>
                  <th className="text-right font-normal py-2">누적손익</th>
                  <th className="text-right font-normal py-2">오늘</th>
                  <th className="text-right font-normal py-2">비중</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {visibleHoldings.map((h) => {
                  const value = h.qty * h.currentPrice;
                  const pnl = h.qty * (h.currentPrice - h.avgPrice);
                  const pnlPct = h.avgPrice ? ((h.currentPrice - h.avgPrice) / h.avgPrice) * 100 : 0;
                  const todayChange = h.qty * (h.currentPrice - h.prevClose);
                  const weight = evalValue ? (value / evalValue) * 100 : 0;
                  return (
                    <tr key={h.id} className="border-b border-slate-800/60 last:border-0">
                      <td className="py-2">
                        <div className="text-slate-100">{h.name}</div>
                        <div className="text-xs text-slate-500">
                          {h.market}{h.ticker ? ` · ${h.ticker}` : ""}{filter === "전체" ? ` · ${h.account}` : ""}
                        </div>
                      </td>
                      <td className="py-2">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${
                            h.buyType === "신용" ? "bg-orange-950/50 text-orange-400" : "bg-slate-800 text-slate-400"
                          }`}
                        >
                          {h.buyType}
                        </span>
                      </td>
                      <td className="text-right py-2 text-slate-300">{h.qty.toLocaleString("ko-KR")}</td>
                      <td className="text-right py-2">
                        <input
                          type="number"
                          value={h.avgPrice}
                          onChange={(e) => updateHolding(h.id, "avgPrice", e.target.value)}
                          className="bg-slate-800 text-slate-100 text-right text-sm rounded px-2 py-1 w-24 outline-none"
                        />
                      </td>
                      <td className="text-right py-2">
                        <input
                          type="number"
                          value={h.currentPrice}
                          onChange={(e) => updateHolding(h.id, "currentPrice", e.target.value)}
                          className="bg-slate-800 text-slate-100 text-right text-sm rounded px-2 py-1 w-24 outline-none"
                        />
                      </td>
                      <td className="text-right py-2 text-slate-200">{won(value)}</td>
                      <td className={`text-right py-2 ${changeColor(pnl)}`}>
                        {won(pnl)}
                        <div className="text-xs">{pct(pnlPct)}</div>
                      </td>
                      <td className={`text-right py-2 ${changeColor(todayChange)}`}>{won(todayChange)}</td>
                      <td className="text-right py-2 text-slate-400">{weight.toFixed(0)}%</td>
                      <td className="py-2 text-right">
                        <button onClick={() => removeHolding(h.id)} className="text-slate-600 hover:text-red-400">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* 종목 추가 */}
      <div className="bg-slate-900 rounded-xl p-4">
        <div className="text-sm font-medium text-slate-300 mb-3">종목 추가</div>
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
          <input
            placeholder="종목명 (예: 삼성전자)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="bg-slate-800 text-slate-100 text-sm rounded px-3 py-2 outline-none col-span-2 sm:col-span-1"
          />
          <input
            placeholder="티커 (005930, AAPL, BTC-USD)"
            value={form.ticker}
            onChange={(e) => setForm({ ...form, ticker: e.target.value })}
            className="bg-slate-800 text-slate-100 text-sm rounded px-3 py-2 outline-none col-span-2 sm:col-span-1"
          />
          <select
            value={form.market}
            onChange={(e) => setForm({ ...form, market: e.target.value })}
            className="bg-slate-800 text-slate-100 text-sm rounded px-3 py-2 outline-none"
          >
            {MARKET_OPTIONS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <select
            value={form.buyType}
            onChange={(e) => setForm({ ...form, buyType: e.target.value })}
            className="bg-slate-800 text-slate-100 text-sm rounded px-3 py-2 outline-none"
          >
            {BUY_TYPES.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          <select
            value={form.account}
            onChange={(e) => setForm({ ...form, account: e.target.value })}
            className="bg-slate-800 text-slate-100 text-sm rounded px-3 py-2 outline-none"
          >
            {accounts.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <input
            type="number"
            placeholder="수량"
            value={form.qty}
            onChange={(e) => setForm({ ...form, qty: e.target.value })}
            className="bg-slate-800 text-slate-100 text-sm rounded px-3 py-2 outline-none"
          />
          <input
            type="number"
            placeholder="평단가"
            value={form.avgPrice}
            onChange={(e) => setForm({ ...form, avgPrice: e.target.value })}
            className="bg-slate-800 text-slate-100 text-sm rounded px-3 py-2 outline-none"
          />
        </div>
        <button
          onClick={addHolding}
          className="mt-3 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm transition"
        >
          <Plus size={14} /> 종목 추가
        </button>
        <p className="text-xs text-slate-600 mt-2">
          티커: 국내 종목은 코드 6자리(예 005930), 해외 종목은 티커(예 AAPL, NVDA), 코인은 BTC-USD 형식으로 입력하면 새로고침 시 자동 조회됩니다.
          구분에서 신용(미수·신용거래)과 현금 매수를 구분해 표시할 수 있어요.
        </p>
      </div>
    </div>
  );
}
