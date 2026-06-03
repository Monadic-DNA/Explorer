import { NextRequest, NextResponse } from "next/server";

const cache = new Map<string, { abstract: string; title: string; fetchedAt: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function GET(request: NextRequest) {
  const pmid = request.nextUrl.searchParams.get("pmid");
  if (!pmid || !/^\d+$/.test(pmid)) {
    return NextResponse.json({ error: "Invalid PMID" }, { status: 400 });
  }

  const cached = cache.get(pmid);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({ abstract: cached.abstract, title: cached.title });
  }

  try {
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/article/MED/${pmid}?resultType=core&format=json`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Europe PMC returned ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    const article = data?.result;
    if (!article) {
      return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    const abstract: string = article.abstractText ?? "";
    const title: string = article.title ?? "";

    cache.set(pmid, { abstract, title, fetchedAt: Date.now() });
    return NextResponse.json({ abstract, title });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
