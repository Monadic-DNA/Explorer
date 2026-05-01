import { NextResponse } from 'next/server';
import { inflateRawSync } from 'node:zlib';

const SAMPLE_DATA_URL = 'https://drive.google.com/uc?export=download&id=1WK3zZbqmu3_m6LvoQCylyIbWBkoO5pGI';

const textDecoder = new TextDecoder();

function isZipPayload(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && bytes[2] === 0x03
    && bytes[3] === 0x04;
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minOffset = Math.max(0, bytes.length - 0xffff - 22);

  for (let offset = bytes.length - 22; offset >= minOffset; offset -= 1) {
    if (
      bytes[offset] === 0x50
      && bytes[offset + 1] === 0x4b
      && bytes[offset + 2] === 0x05
      && bytes[offset + 3] === 0x06
    ) {
      return offset;
    }
  }

  return -1;
}

function extractFirstZipEntry(bytes: Uint8Array): { filename: string; data: Uint8Array } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(bytes);

  if (eocdOffset < 0) return null;

  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  if (centralDirectoryOffset + 46 > bytes.length) return null;
  if (view.getUint32(centralDirectoryOffset, true) !== 0x02014b50) return null;

  const compressionMethod = view.getUint16(centralDirectoryOffset + 10, true);
  const compressedSize = view.getUint32(centralDirectoryOffset + 20, true);
  const fileNameLength = view.getUint16(centralDirectoryOffset + 28, true);
  const extraLength = view.getUint16(centralDirectoryOffset + 30, true);
  const commentLength = view.getUint16(centralDirectoryOffset + 32, true);
  const localHeaderOffset = view.getUint32(centralDirectoryOffset + 42, true);
  const filenameStart = centralDirectoryOffset + 46;
  const filenameEnd = filenameStart + fileNameLength;

  if (filenameEnd > bytes.length) return null;

  const filename = textDecoder.decode(bytes.slice(filenameStart, filenameEnd));
  const nextEntryOffset = filenameEnd + extraLength + commentLength;
  if (nextEntryOffset > bytes.length) return null;

  if (localHeaderOffset + 30 > bytes.length) return null;
  if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) return null;

  const localNameLength = view.getUint16(localHeaderOffset + 26, true);
  const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
  const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
  const dataEnd = dataStart + compressedSize;

  if (dataEnd > bytes.length) return null;

  const compressed = bytes.slice(dataStart, dataEnd);

  if (compressionMethod === 0) {
    return { filename, data: compressed };
  }

  if (compressionMethod === 8) {
    return { filename, data: inflateRawSync(compressed) };
  }

  return null;
}

function collectCookieHeader(response: Response): string {
  const header = response.headers.get('set-cookie');
  if (!header) return '';
  return header
    .split(/,(?=[^;]+=[^;]+)/)
    .map((cookie) => cookie.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

function extractConfirmedDownloadUrl(html: string): string | null {
  const formMatch = html.match(/<form[^>]+id="download-form"[^>]+action="([^"]+)"/i);
  if (formMatch) {
    const action = formMatch[1];
    const url = new URL(action, 'https://drive.google.com');
    const inputRegex = /<input[^>]+type="hidden"[^>]+name="([^"]+)"[^>]+value="([^"]*)"/gi;
    let inputMatch: RegExpExecArray | null;

    while ((inputMatch = inputRegex.exec(html)) !== null) {
      url.searchParams.set(inputMatch[1], inputMatch[2]);
    }

    return url.toString();
  }

  const hrefMatch = html.match(/href="(\/uc\?export=download[^"]+)"/i);
  if (hrefMatch) {
    return new URL(hrefMatch[1].replace(/&amp;/g, '&'), 'https://drive.google.com').toString();
  }

  return null;
}

export async function GET() {
  try {
    let upstream = await fetch(SAMPLE_DATA_URL, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Sample data upstream failed with status ${upstream.status}` },
        { status: 502 }
      );
    }

    let contentType = upstream.headers.get('content-type') || 'text/plain; charset=utf-8';

    if (contentType.includes('text/html')) {
      const html = await upstream.text();
      const confirmedUrl = extractConfirmedDownloadUrl(html);

      if (!confirmedUrl) {
        return NextResponse.json(
          { error: 'Sample data upstream returned an HTML confirmation page instead of the genotype file.' },
          { status: 502 }
        );
      }

      upstream = await fetch(confirmedUrl, {
        method: 'GET',
        redirect: 'follow',
        cache: 'no-store',
        headers: {
          Cookie: collectCookieHeader(upstream),
        },
      });

      if (!upstream.ok) {
        return NextResponse.json(
          { error: `Sample data confirmed download failed with status ${upstream.status}` },
          { status: 502 }
        );
      }

      contentType = upstream.headers.get('content-type') || 'text/plain; charset=utf-8';
    }

    const data = await upstream.arrayBuffer();
    let outputBytes = new Uint8Array(data);
    let outputFileName = 'monadicdna-sample-data.txt';

    if (isZipPayload(outputBytes)) {
      const extracted = extractFirstZipEntry(outputBytes);

      if (!extracted) {
        return NextResponse.json(
          { error: 'Sample data upstream returned a ZIP archive that could not be unpacked.' },
          { status: 502 }
        );
      }

      outputBytes = new Uint8Array(extracted.data) as unknown as Uint8Array<ArrayBuffer>;
      outputFileName = extracted.filename || outputFileName;
      contentType = 'text/plain; charset=utf-8';
    }

    return new NextResponse(outputBytes, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${outputFileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[sample-genotype] Failed to fetch sample data:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch sample genotype data' },
      { status: 500 }
    );
  }
}
