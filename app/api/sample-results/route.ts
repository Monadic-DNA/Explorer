import { NextResponse } from "next/server";

const SAMPLE_RESULTS_URL = "https://monadic-dna-explorer.nyc3.cdn.digitaloceanspaces.com/monadic_dna_explorer_results_2026-05-19.tsv";

export async function GET() {
  try {
    const upstream = await fetch(SAMPLE_RESULTS_URL, {
      method: "GET",
      cache: "no-store",
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Sample results upstream failed with status ${upstream.status}` },
        { status: 502 }
      );
    }

    const data = await upstream.arrayBuffer();
    const contentType = upstream.headers.get("content-type") || "text/tab-separated-values; charset=utf-8";
    const contentLength = upstream.headers.get("content-length") || String(data.byteLength);

    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": contentLength,
        "Content-Disposition": "inline; filename=\"monadic_dna_explorer_results_2026-05-19.tsv\"",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[sample-results] Failed to fetch sample results:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch sample results" },
      { status: 500 }
    );
  }
}
