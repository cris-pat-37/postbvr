import { NextResponse } from 'next/server';
import { getQzCertificate } from '../../../../src/server/qzSigning.js';

export const runtime = 'nodejs';

export async function GET() {
  const certificate = await getQzCertificate();
  if (!certificate) {
    return new NextResponse('QZ certificate is not configured.', { status: 404 });
  }

  return new NextResponse(certificate, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
